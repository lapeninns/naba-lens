-- B02-c review repairs (docs/knowledge/b02-design.md §7.2a; OD-9).
--
-- * M1: the community reads key on the uploader's current role, so after
--   convert_manager_to_staff a manager-era general upload would reach
--   colleagues' Photos. community_readable_assets, community_media_page and
--   community_members (its media count) are re-created from
--   20261107130000_amenity_media_purpose.sql with one filter on the community
--   arm: uploader_role is distinct from 'manager'. The uploader's own access
--   and admin access are unchanged. (The media_assets_select_community
--   policy was dropped in 20261102160000 and has no successor, so no policy
--   changes.)
-- * L1: the manager pending-label policies read and delete only drafts of
--   manager-era uploads. After a revoke the account keeps reading its own
--   uploads and labels and may discard its own drafts; it can no longer
--   upload, stage or save labels.
-- * L3: the uploader_role guard runs before every update of media_assets, not
--   only when the column is named, and compares OLD with NEW.
--
-- Nothing else changes; the credit trigger, the evidence-withdrawn trigger
-- and the credit functions are untouched.
--
-- Rollback: a forward migration restores the 20261107130000 bodies of the
-- three community reads, the 20261110090145 policy expressions and the
-- column-scoped trigger. No data changes.
-- ---------------------------------------------------------------------------
-- M1: manager-era uploads never reach the community reads
-- ---------------------------------------------------------------------------

create or replace function public.community_readable_assets(p_asset_ids uuid[])
returns table (
  id uuid, uploader_id uuid, venue_id uuid, media_type public.media_type,
  validated_mime_type text, size_bytes bigint, width integer, height integer,
  duration_seconds numeric, has_preview boolean, has_thumbnail boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_ids' using errcode = '22023',
      detail = 'Between 0 and 100 asset ids.';
  end if;
  return query
  select a.id, a.uploader_id, a.venue_id, a.media_type, a.validated_mime_type,
    a.size_bytes, a.width, a.height, a.duration_seconds,
    a.preview_path is not null, a.thumbnail_path is not null, a.created_at
  from public.media_assets a
  where a.id = any(p_asset_ids)
    and a.upload_state = 'ready' and a.deleted_at is null
    and (select private.is_active_staff() or private.is_active_admin())
    and (
      a.uploader_id = (select auth.uid())
      or (select private.is_active_admin())
      or (
        private.is_community_member(a.uploader_id)
        and a.uploader_role is distinct from 'manager'
        and (
          (
            a.purpose = 'general'
            and not exists (
              select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
            )
          )
          or exists (
            select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
          )
          or exists (
            select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
          )
        )
      )
    )
  order by a.id;
end;
$$;

create or replace function public.community_media_page(
  p_venue uuid default null,
  p_uploader uuid default null,
  p_type public.media_type default null,
  p_department text default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  id uuid, uploader_id uuid, contributor_name text, venue_name text,
  media_type public.media_type, has_thumbnail boolean, has_preview boolean,
  validated_mime_type text, original_filename text, created_at timestamptz,
  width integer, height integer, duration_seconds numeric, size_bytes bigint
)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.uploader_id, p.display_name, v.name, a.media_type,
    a.thumbnail_path is not null, a.preview_path is not null,
    a.validated_mime_type,
    case when a.uploader_id = (select auth.uid()) then a.original_filename end,
    a.created_at, a.width, a.height, a.duration_seconds, a.size_bytes
  from public.media_assets a
  join public.profiles p on p.id = a.uploader_id and p.active and p.role = 'staff'
  join public.venues v on v.id = a.venue_id
  where (select private.is_active_staff() or private.is_active_admin())
    and a.upload_state = 'ready' and a.deleted_at is null
    and a.uploader_role is distinct from 'manager'
    and (
      (
        a.purpose = 'general'
        and not exists (
          select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
        )
      )
      or exists (
        select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
      )
      or exists (
        select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
      )
    )
    and (p_venue is null or a.venue_id = p_venue)
    and (p_uploader is null or a.uploader_id = p_uploader)
    and (p_type is null or a.media_type = p_type)
    and (p_department is null or p.department = p_department)
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101);
$$;

create or replace function public.community_members(
  p_venue uuid default null,
  p_member uuid default null,
  p_department text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, display_name text, job_title text, department text,
  venue_id uuid, venue_name text, avatar_path text, media_count bigint
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.job_title, p.department,
    p.venue_id, v.name, p.avatar_path,
    (select count(*) from public.media_assets a
      where a.uploader_id = p.id and a.upload_state = 'ready' and a.deleted_at is null
        and a.uploader_role is distinct from 'manager'
        and (
          (
            a.purpose = 'general'
            and not exists (
              select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
            )
          )
          or exists (
            select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
          )
          or exists (
            select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
          )
        ))
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  where (select private.is_active_staff() or private.is_active_admin())
    and p.active and p.role = 'staff'
    and (p_venue is null or p.venue_id = p_venue)
    and (p_member is null or p.id = p_member)
    and (p_department is null or p.department = p_department)
    and (p_query is null or strpos(lower(p.display_name), lower(left(p_query, 80))) > 0)
  order by p.display_name, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 101)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;


-- ---------------------------------------------------------------------------
-- L1: manager drafts of manager-era uploads only
-- ---------------------------------------------------------------------------

alter policy media_pending_labels_select_own_manager on public.media_pending_labels
  using (
    uploader_id = (select auth.uid())
    and (select private.is_active_manager())
    and exists (
      select 1 from public.media_assets a
      where a.id = asset_id and a.uploader_role = 'manager'
    )
  );

alter policy media_pending_labels_delete_own_manager on public.media_pending_labels
  using (
    uploader_id = (select auth.uid())
    and (select private.is_active_manager())
    and exists (
      select 1 from public.media_assets a
      where a.id = asset_id and a.uploader_role = 'manager'
    )
  );

-- ---------------------------------------------------------------------------
-- L3: the uploader role is fixed on every update
-- ---------------------------------------------------------------------------

drop trigger media_assets_uploader_role_guard on public.media_assets;
create trigger media_assets_uploader_role_guard
  before update on public.media_assets
  for each row execute function private.media_assets_uploader_role_guard();

-- ---------------------------------------------------------------------------
-- Function privileges (create or replace keeps them; restated as before)
-- ---------------------------------------------------------------------------

revoke all on function public.community_readable_assets(uuid[]) from public, anon;
grant execute on function public.community_readable_assets(uuid[]) to authenticated, service_role;
revoke all on function public.community_media_page(uuid, uuid, public.media_type, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.community_media_page(uuid, uuid, public.media_type, text, timestamptz, uuid, integer) to authenticated, service_role;
revoke all on function public.community_members(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.community_members(uuid, uuid, text, text, integer, integer) to authenticated, service_role;
