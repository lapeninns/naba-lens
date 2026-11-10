-- B02-c group read repair (docs/knowledge/b02-design.md W1, OD-7, §7.2a).
-- Group reads only; no table, policy, trigger, grant or other function
-- changes.
--
-- * private.viewer_sees_asset (20261110095909 body): a manager account
--   (private.is_active_manager()) never sees its own upload whose recorded
--   uploader_role is not 'manager' (staff or null), whatever other arm would
--   admit it. Before, the own-upload arm left such uploads out but the
--   amenity evidence arm (amenity_evidence_asset's uploader candidate arm)
--   still let them through, so contribution_groups_for_assets and
--   contribution_group showed a manager account its staff-era group member.
--   Other viewers, staff, staff holding a grant and admins are unchanged, and
--   so are the gates it calls (amenity_evidence_asset, task_evidence_asset,
--   menu_item_photo_asset, community_readable_assets).
-- * public.contribution_group (20261110013723 body): a task subject's id and
--   title are returned only when the viewer may read that task at the group's
--   venue: the coverage_requirements_select policy and
--   coverage_requirement_progress predicates (admin, the venue's effective
--   manager, the venue's current staff, or the caller's own photos on that
--   task). Otherwise the subject reads { kind: 'none', id: null, name: null }.
--   Members, the not-found rule and the menu item, question and none subjects
--   are unchanged. Conservative OD-7 default, pending owner confirmation.
-- * Not touched: contribution_groups_for_assets (it reads through
--   viewer_sees_asset), contribution_group_start, contribution_group_add, the
--   group tables and their append-only guards, the community reads, every B01
--   function, the credit functions and triggers.
--
-- Rollback: a forward migration restores the 20261110095909 body of
-- private.viewer_sees_asset and the 20261110013723 body of
-- public.contribution_group. No data changes.

-- The caller may already see this asset through an existing gate. A group
-- read shows a member only when this holds, so groups never widen visibility.
-- A manager account's own upload counts only when made as a manager, before
-- any other arm is asked.
create or replace function private.viewer_sees_asset(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and not (
      private.is_active_manager()
      and exists (
        select 1 from public.media_assets a
        where a.id = p_asset_id
          and a.uploader_id = (select auth.uid())
          and a.uploader_role is distinct from 'manager'
      )
    )
    and (
      exists (
        select 1 from public.media_assets a
        where a.id = p_asset_id and a.deleted_at is null
          and (
            (a.uploader_id = (select auth.uid())
              and (a.uploader_role = 'manager' or not private.is_active_manager()))
            or private.is_active_admin()
          )
      )
      or exists (select 1 from public.community_readable_assets(array[p_asset_id]))
      or exists (select 1 from public.menu_item_photo_asset(p_asset_id))
      or exists (select 1 from public.task_evidence_asset(p_asset_id))
      or exists (select 1 from public.amenity_evidence_asset(p_asset_id))
    );
$$;

-- One group: its subject and the members the viewer may already see, each
-- with its own state. A group with no member visible to the viewer reads as
-- not found, except to its creator (a group just started has no members). A
-- task subject the viewer may not read reads as no subject.
create or replace function public.contribution_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_group public.media_contribution_groups;
  v_members jsonb;
  v_subject jsonb;
begin
  select g.* into v_group from public.media_contribution_groups g where g.id = p_group_id;
  if found then
    select jsonb_agg(jsonb_build_object(
        'assetId', a.id, 'position', m.position, 'mediaType', a.media_type,
        'uploadState', a.upload_state, 'mine', a.uploader_id = v_uid)
        order by m.position)
    into v_members
    from public.media_contribution_group_members m
    join public.media_assets a on a.id = m.asset_id
    where m.group_id = v_group.id and private.viewer_sees_asset(a.id);
  end if;
  if v_group.id is null or (v_members is null and v_group.created_by is distinct from v_uid) then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;
  if v_group.subject_kind = 'task' then
    -- This task row only, at the group's venue, under the task read rules.
    select jsonb_build_object('kind', 'task', 'id', r.id, 'name', r.title)
    into v_subject
    from public.coverage_requirements r
    where r.id = v_group.subject_id and r.venue_id = v_group.venue_id
      and (
        private.can_manage_venue(r.venue_id)
        or coalesce(private.active_staff_venue_id() = r.venue_id, false)
        or r.id in (select private.own_item_requirement_ids())
      );
    v_subject := coalesce(v_subject, jsonb_build_object('kind', 'none', 'id', null, 'name', null));
  else
    v_subject := jsonb_build_object(
      'kind', v_group.subject_kind,
      'id', v_group.subject_id,
      'name', case v_group.subject_kind
        when 'menu_item' then (
          select e.name from public.menu_entries e
          join public.menu_versions v on v.id = e.version_id
          where v.venue_id = v_group.venue_id and v.status = 'active' and e.item_id = v_group.subject_id
          limit 1)
        when 'question' then (
          select t.question from public.venue_amenity_checks c
          join public.amenity_catalogue t on t.key = c.template_key
          where c.id = v_group.subject_id)
      end
    );
  end if;
  return jsonb_build_object(
    'groupId', v_group.id,
    'venueId', v_group.venue_id,
    'createdAt', v_group.created_at,
    'mine', v_group.created_by = v_uid,
    'subject', v_subject,
    'members', coalesce(v_members, '[]'::jsonb)
  );
end;
$$;

-- create or replace keeps privileges; restated as in 20261110013723.
revoke all on function private.viewer_sees_asset(uuid) from public, anon, authenticated;
revoke all on function public.contribution_group(uuid) from public, anon, service_role;
grant execute on function public.contribution_group(uuid) to authenticated;
