-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R14 (round-2 review X10): an export package item that is
-- no longer eligible says why, instead of every such item reading
-- "Withdrawn since".
--
-- private.export_package_stale marks an item stale whenever no row of
-- private.export_candidate_rows matches it. That happens for many reasons
-- that are not a withdrawal: the review level changed, a newer decision, the
-- dish left the active menu, an area photo is due a check, a place was
-- retired, a facility answer changed. private.export_item_stale_reason reads
-- the same conditions as export_candidate_rows (latest body 20261118116000),
-- in order, and names the first that fails:
--
--   deleted         the photo was deleted or is no longer ready
--   withdrawn       withdrawn in the Library, its use is withdrawn, (public
--                   package) its public use was withdrawn, or the reviewer
--                   withdrew the decision the item was exported under
--   off_menu        the dish left the current menu or its special ended
--   subject_retired the place was retired, or the facility check archived
--                   or taken off the working list
--   label_changed   the photo no longer carries the place label
--   check_due       (public) the area photo is due a check
--   fact_changed    (public) the facility answer is no longer a current
--                   confirmed Yes, or its photos may not be public
--   review_changed  the review decision changed: another level, another
--                   photo asked for, not used, or a newer decision
--   changed         none of these can be named (an invalidated package whose
--                   item has since become eligible again)
--
-- public.export_package_detail (body from 20261118108500, latest) adds
-- `staleReason` to each item that is not eligible, null otherwise. Nothing
-- else changes: eligibility, invalidation and downloads still follow
-- export_package_stale.
--
-- Rollback: a forward migration restoring the 20261118108500 body of
-- export_package_detail and dropping private.export_item_stale_reason.

create function private.export_item_stale_reason(
  p_asset_id uuid,
  p_venue_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_approval_id text,
  p_mode text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_label public.media_area_labels;
  v_decision record;
  v_amenity record;
  v_check public.venue_amenity_checks;
  v_decision_id bigint;
begin
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found or v_asset.deleted_at is not null or v_asset.upload_state <> 'ready'
     or v_asset.venue_id is distinct from p_venue_id then
    return 'deleted';
  end if;
  if exists (select 1 from public.media_asset_withdrawals w where w.asset_id = p_asset_id)
     or private.media_asset_use_state(p_asset_id, now()) = 'withdrawn' then
    return 'withdrawn';
  end if;
  if p_mode = 'public' and (
    select case
        when bool_or(private.media_use_grant_state(g, now()) = 'in_force') then 'in_force'
        when bool_or(private.media_use_grant_state(g, now()) = 'withdrawn') then 'withdrawn'
      end
    from public.media_use_grants g where g.asset_id = p_asset_id and g.audience = 'public'
  ) = 'withdrawn' then
    return 'withdrawn';
  end if;

  if p_subject_kind = 'menu_item' then
    if not private.is_current_photo_item(p_venue_id, p_subject_id, array['food', 'drinks', 'other']) then
      return 'off_menu';
    end if;
    if exists (
      select 1 from public.menu_item_photos p
      where p.id::text = p_approval_id and p.state = 'withdrawn'
    ) then
      return 'withdrawn';
    end if;
    if not exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = p_asset_id and p.item_id = p_subject_id and p.venue_id = p_venue_id
        and p.id::text = p_approval_id
        and ((p.state = 'accepted' and p.review_level = 'public')
          or (p_mode = 'internal' and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')))
    ) then
      return 'review_changed';
    end if;
    return 'changed';
  end if;

  if p_subject_kind = 'place' then
    if not exists (
      select 1 from public.knowledge_subjects s
      where s.id = p_subject_id and s.venue_id = p_venue_id and s.retired_at is null
    ) then
      return 'subject_retired';
    end if;
    select l.* into v_label from public.media_area_labels l
    where l.asset_id = p_asset_id and l.subject_id = p_subject_id and l.venue_id = p_venue_id
      and l.removed_at is null
    order by l.id desc limit 1;
    if not found then
      return 'label_changed';
    end if;
    select d.id, d.action, d.review_level into v_decision
    from public.area_photo_decisions d
    where d.label_id = v_label.id order by d.id desc limit 1;
    if v_decision.action = 'withdrawn' then
      return 'withdrawn';
    end if;
    if p_mode = 'public' then
      if v_decision.id is null or v_decision.action <> 'accepted'
         or v_decision.review_level <> 'public' then
        return 'review_changed';
      end if;
      if private.area_photo_freshness(v_label.id) ->> 'state' is distinct from 'current' then
        return 'check_due';
      end if;
    elsif v_decision.id is not null and v_decision.action not in ('accepted', 'needs_another_photo') then
      return 'review_changed';
    end if;
    if coalesce(v_decision.id::text, v_label.id::text) <> p_approval_id then
      return 'review_changed';
    end if;
    return 'changed';
  end if;

  if p_subject_kind = 'amenity' then
    if not exists (
      select 1 from public.venue_amenity_checks c
      where c.id = p_subject_id and c.venue_id = p_venue_id and c.status = 'active'
        and private.knowledge_in_scope(c.venue_id, c.template_key)
    ) then
      return 'subject_retired';
    end if;
    select r.state, r.review_level into v_amenity
    from private.amenity_photo_rows(p_venue_id) r
    where r.check_id = p_subject_id and r.asset_id = p_asset_id
    order by (r.state in ('accepted', 'pending', 'needs_another_photo')) desc
    limit 1;
    if not found then
      return 'review_changed';
    end if;
    if v_amenity.state = 'withdrawn' then
      return 'withdrawn';
    end if;
    if v_amenity.state not in ('accepted', 'pending', 'needs_another_photo') then
      return 'review_changed';
    end if;
    if p_mode = 'public' then
      if v_amenity.state <> 'accepted' or v_amenity.review_level <> 'public' then
        return 'review_changed';
      end if;
      select c.* into v_check from public.venue_amenity_checks c where c.id = p_subject_id;
      if v_check.progress is distinct from 'complete' or v_check.answer is distinct from 'yes'
         or coalesce((private.knowledge_check_service_end(v_check.id, now()) ->> 'inEffect')::boolean, false)
         or not coalesce((private.knowledge_public_media_eligible(p_venue_id, v_check.template_key)
              ->> 'eligible')::boolean, false) then
        return 'fact_changed';
      end if;
    end if;
    select max(d.id) into v_decision_id from public.amenity_photo_decisions d
    where d.check_id = p_subject_id and d.asset_id = p_asset_id;
    if coalesce(v_decision_id::text, 'pending') <> p_approval_id then
      return 'review_changed';
    end if;
    return 'changed';
  end if;

  return 'changed';
end;
$$;

revoke all on function private.export_item_stale_reason(uuid, uuid, text, uuid, text, text)
from public, anon, authenticated, service_role;

-- Body as in 20261118108500, with each ineligible item's reason.
create or replace function public.export_package_detail(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pkg public.export_packages;
  v_json jsonb;
  v_stale uuid[];
begin
  if p_package_id is null or not private.export_package_access(p_package_id) then
    raise exception 'export_package_not_found' using errcode = 'P0002';
  end if;
  select p.* into v_pkg from public.export_packages p where p.id = p_package_id;
  v_json := private.export_package_json(v_pkg, true);
  v_stale := array(select jsonb_array_elements_text(v_json -> 'staleAssets')::uuid);
  return v_json || jsonb_build_object(
    'items', coalesce((
      with s as materialized (
        select * from private.publication_asset_states(array(
          select distinct i.asset_id from public.export_package_items i where i.package_id = p_package_id))
      )
      select jsonb_agg(jsonb_build_object(
          'position', i.position, 'assetId', i.asset_id, 'venueId', i.venue_id,
          'subjectKind', i.subject_kind, 'subjectId', i.subject_id, 'subjectLabel', i.subject_label,
          'category', i.category, 'approvalKind', i.approval_kind, 'approvalId', i.approval_id,
          'approvalVersion', i.approval_version, 'approvalLevel', i.approval_level,
          'filenameStem', i.filename_stem, 'altText', i.alt_text, 'caption', i.caption,
          'useRestrictions', to_jsonb(i.use_restrictions), 'uploadedAt', i.uploaded_at,
          'eligible', not (i.asset_id = any(v_stale)),
          'staleReason', case when i.asset_id = any(v_stale)
            then private.export_item_stale_reason(i.asset_id, i.venue_id, i.subject_kind,
              i.subject_id, i.approval_id, v_pkg.mode) end,
          'publication', s.publication)
        order by i.position)
      from public.export_package_items i
      left join s on s.asset_id = i.asset_id
      where i.package_id = p_package_id
    ), '[]'::jsonb),
    'downloads', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', d.id, 'downloadedBy', pr.display_name, 'startedAt', d.started_at,
          'completedAt', d.completed_at, 'failedAt', d.failed_at,
          'fileCount', case when d.files is null then null else jsonb_array_length(d.files) end)
        order by d.started_at desc, d.id)
      from public.export_package_downloads d
      join public.profiles pr on pr.id = d.downloaded_by
      where d.package_id = p_package_id
    ), '[]'::jsonb));
end;
$$;
