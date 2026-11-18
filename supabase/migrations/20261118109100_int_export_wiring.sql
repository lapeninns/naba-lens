-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-INT part 2 of 4: exports read the review level, the place
-- photo freshness and the capture time (spec §9.3, §10 inv. 4, §14.1; FA-31;
-- AC16, AC31).
--
--   Eligible   private.export_candidate_rows (S1-EXPORT's one eligibility
--              rule; same signature) is public only for
--                dish     an accepted decision at the public level (S1-COV
--                         review_level); a Keep as reference photo is never
--                         public (AC16)
--                place    a latest accepted decision at the public level
--                         whose photo is current by
--                         private.area_photo_freshness (S1-FACTS): a review
--                         date passed, a reported or known change or an end
--                         date keeps it out of new public packages (§9.3)
--                amenity  the photo's own latest amenity photo decision
--                         (private.amenity_photo_rows) accepted at the public
--                         level, a public-audience grant in force (an internal
--                         grant no longer counts), the question's public media
--                         rule and a current confirmed Yes. The decision id is
--                         the approval, so a later decision makes a package
--                         stale (review R1, R21)
--              Any photo whose public use was withdrawn is internal only,
--              even when an internal grant remains (R21).
--              Internal packages (admins only) still list reference and
--              stale photos, marked internal, as they list photos waiting
--              for review. Packages, staleness, publication records and
--              export_asset_status all read this rule, so a reference photo
--              can never be published (publication_record needs public).
--   Capture    export_package_download_start fills capturedAt and
--              captureTimeSource from media_assets.captured_at and
--              captured_at_source (S1-UPLOAD); unknown when not recorded.
--
-- Rollback: re-apply private.export_candidate_rows from 20261118105000 and
-- public.export_package_download_start from 20261118105200.

-- Amenity items now record the photo decision they were approved through.
alter table public.export_package_items drop constraint export_package_items_approval_kind_check;
alter table public.export_package_items add constraint export_package_items_approval_kind_check
  check (approval_kind in ('menu_item_photo', 'area_photo_decision', 'area_label', 'amenity_submission',
    'amenity_photo_decision'));

create or replace function private.export_candidate_rows(p_venue_id uuid, p_mode text)
returns table (
  asset_id uuid,
  venue_id uuid,
  subject_kind text,
  subject_id uuid,
  subject_label text,
  subject_slug text,
  category text,
  approval_kind text,
  approval_id text,
  approval_version text,
  approval_level text,
  uploaded_at timestamptz,
  width integer,
  height integer,
  use_baseline text
)
language sql
stable
security definer
set search_path = ''
as $$
  with assets as (
    select a.id, a.venue_id, a.created_at, a.width, a.height, a.use_baseline,
      private.media_asset_use_state(a.id, now()) as use_state,
      -- The public audience alone (review R21): in_force, withdrawn or null.
      (select case
          when bool_or(private.media_use_grant_state(g, now()) = 'in_force') then 'in_force'
          when bool_or(private.media_use_grant_state(g, now()) = 'withdrawn') then 'withdrawn'
        end
        from public.media_use_grants g where g.asset_id = a.id and g.audience = 'public') as public_use
    from public.media_assets a
    where a.venue_id = p_venue_id
      and a.upload_state = 'ready'
      and a.deleted_at is null
      and a.media_type = 'image'
  ),
  usable as (
    select * from assets where use_state is distinct from 'withdrawn'
  ),
  menu as (
    select distinct on (p.asset_id, p.item_id)
      p.asset_id, p.item_id, e.name, s.kind, p.id as photo_id, p.revision, p.state, p.review_level
    from public.menu_item_photos p
    join usable u on u.id = p.asset_id
    join public.menu_items i on i.id = p.item_id and i.archived_at is null
    join public.menu_versions v on v.venue_id = p.venue_id and v.status = 'active'
    join public.menu_entries e on e.version_id = v.id and e.item_id = p.item_id
    join public.menu_sections s on s.id = e.section_id and s.version_id = v.id
    where p.venue_id = p_venue_id
      and ((p.state = 'accepted' and p.review_level = 'public')
        or (p_mode = 'internal' and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')))
    order by p.asset_id, p.item_id, (p.state = 'accepted' and p.review_level = 'public') desc,
      (p.state = 'accepted') desc, p.decided_at desc, p.id
  ),
  area as (
    select l.asset_id, l.subject_id, s.label, l.id as label_id, d.id as decision_id, d.action,
      (d.action = 'accepted' and d.review_level = 'public'
        and private.area_photo_freshness(l.id) ->> 'state' = 'current') as public_ok
    from public.media_area_labels l
    join usable u on u.id = l.asset_id
    join public.knowledge_subjects s on s.id = l.subject_id and s.venue_id = l.venue_id and s.retired_at is null
    left join lateral (
      select d.id, d.action, d.review_level from public.area_photo_decisions d
      where d.label_id = l.id order by d.id desc limit 1
    ) d on true
    where l.venue_id = p_venue_id
      and l.removed_at is null
      and (d.action = 'accepted'
        or (p_mode = 'internal' and (d.action is null or d.action = 'needs_another_photo')))
  ),
  -- Amenity photos from their own review (FA-32, review R1/R21): the
  -- latest amenity_photo_decisions row per (check, photo). Public needs an
  -- acceptance at the public level, a public-audience grant in force (an
  -- internal grant is not enough), the question's public media rule and a
  -- current confirmed Yes.
  amenity_photo as (
    select r.check_id, r.asset_id, r.state, r.review_level,
      (select max(d.id) from public.amenity_photo_decisions d
        where d.check_id = r.check_id and d.asset_id = r.asset_id) as decision_id
    from private.amenity_photo_rows(p_venue_id) r
    join usable u on u.id = r.asset_id
    where r.state in ('accepted', 'pending', 'needs_another_photo')
  ),
  amenity_rated as (
    select ap.asset_id, c.id as check_id, c.template_key, cat.question, ap.decision_id,
      (ap.state = 'accepted' and ap.review_level = 'public'
        and u.public_use = 'in_force'
        and c.progress = 'complete' and c.answer = 'yes'
        and coalesce((private.knowledge_check_service_end(c.id, now()) ->> 'inEffect')::boolean, false) = false
        and coalesce((private.knowledge_public_media_eligible(p_venue_id, c.template_key) ->> 'eligible')::boolean, false)
      ) as public_ok
    from amenity_photo ap
    join usable u on u.id = ap.asset_id
    join public.venue_amenity_checks c on c.id = ap.check_id
    join public.amenity_catalogue cat on cat.key = c.template_key
  ),
  rows as (
    select m.asset_id, 'menu_item'::text as subject_kind, m.item_id as subject_id, m.name as subject_label,
      m.name as slug_source,
      case m.kind when 'food' then 'food' when 'drinks' then 'drinks' else 'other' end as category,
      'menu_item_photo'::text as approval_kind, m.photo_id::text as approval_id, m.revision::text as approval_version,
      case when m.state = 'accepted' and m.review_level = 'public' then 'public' else 'internal' end as approval_level
    from menu m
    union all
    select ar.asset_id, 'place', ar.subject_id, ar.label, ar.label, 'spaces',
      case when ar.decision_id is null then 'area_label' else 'area_photo_decision' end,
      coalesce(ar.decision_id::text, ar.label_id::text),
      coalesce(ar.decision_id::text, ar.label_id::text),
      case when ar.public_ok then 'public' else 'internal' end
    from area ar
    union all
    select r.asset_id, 'amenity', r.check_id, r.question, replace(r.template_key, '_', ' '), 'facilities',
      'amenity_photo_decision', coalesce(r.decision_id::text, 'pending'), coalesce(r.decision_id::text, 'pending'),
      case when r.public_ok then 'public' else 'internal' end
    from amenity_rated r
  )
  select r.asset_id, p_venue_id, r.subject_kind, r.subject_id, r.subject_label,
    coalesce(nullif(private.export_slug(r.slug_source, 60), ''), 'photo'),
    r.category, r.approval_kind, r.approval_id, r.approval_version, x.level,
    u.created_at, u.width, u.height, u.use_baseline
  from rows r
  join usable u on u.id = r.asset_id
  -- A withdrawn public use keeps any photo out of public packages, whatever
  -- internal grant remains (review R21).
  cross join lateral (
    select case when r.approval_level = 'public' and u.public_use is distinct from 'withdrawn'
      then 'public' else 'internal' end as level
  ) x
  where p_mode = 'internal' or x.level = 'public';
$$;

create or replace function public.export_package_download_start(p_package_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pkg public.export_packages;
  v_stale uuid[];
  v_download uuid;
begin
  if v_uid is null or p_package_id is null or not private.export_package_access(p_package_id) then
    raise exception 'export_package_not_found' using errcode = 'P0002';
  end if;
  select p.* into v_pkg from public.export_packages p where p.id = p_package_id for update;
  if v_pkg.invalidated_at is null then
    v_stale := private.export_package_stale(p_package_id);
    if cardinality(v_stale) > 0 then
      update public.export_packages p
      set invalidated_at = now(), invalidated_reason = 'item_withdrawn', invalidated_assets = v_stale
      where p.id = p_package_id
      returning p.* into v_pkg;
    end if;
  end if;
  if v_pkg.invalidated_at is not null then
    return jsonb_build_object('state', 'invalidated', 'packageId', v_pkg.id,
      'reason', v_pkg.invalidated_reason, 'removed', to_jsonb(v_pkg.invalidated_assets));
  end if;

  insert into public.export_package_downloads (package_id, downloaded_by)
  values (v_pkg.id, v_uid)
  returning id into v_download;

  return jsonb_build_object(
    'state', 'ready', 'downloadId', v_download, 'packageId', v_pkg.id, 'mode', v_pkg.mode,
    'profile', v_pkg.profile, 'note', v_pkg.note, 'createdAt', v_pkg.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'position', i.position, 'assetId', i.asset_id, 'venueId', i.venue_id,
          'venueName', v.name, 'sourceVenueId', a.venue_id,
          'subjectKind', i.subject_kind, 'subjectId', i.subject_id, 'subjectLabel', i.subject_label,
          'category', i.category, 'approvalKind', i.approval_kind, 'approvalId', i.approval_id,
          'approvalVersion', i.approval_version, 'approvalLevel', i.approval_level,
          'filenameStem', i.filename_stem, 'altText', i.alt_text, 'caption', i.caption,
          'useRestrictions', to_jsonb(i.use_restrictions), 'uploadedAt', i.uploaded_at,
          -- S1-UPLOAD's capture time and its source; unknown when not recorded.
          'capturedAt', a.captured_at, 'captureTimeSource', coalesce(a.captured_at_source, 'unknown'))
        order by i.position)
      from public.export_package_items i
      join public.venues v on v.id = i.venue_id
      join public.media_assets a on a.id = i.asset_id
      where i.package_id = v_pkg.id
    ), '[]'::jsonb));
end;
$$;

revoke all on function private.export_candidate_rows(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.export_package_download_start(uuid) from public, anon, service_role;
grant execute on function public.export_package_download_start(uuid) to authenticated;
