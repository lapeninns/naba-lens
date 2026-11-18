-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R27, R28; FA-20, FA-21,
-- OD-9).
--
-- R27  20261118107000 rebuilt community_readable_assets, community_media_page
--      and community_members from the 20261107130000 bodies and so dropped
--      the M1 rule of 20261110091603: a manager-era upload
--      (uploader_role = 'manager') is never a colleague's community photo.
--      After an account went from manager to staff, its accepted manager-era
--      uploads reached colleagues' Photos, the media routes and member
--      counts. The bodies below are those of 20261118107000 with
--      `a.uploader_role is distinct from 'manager'` restored in the same
--      three places as 20261110091603.
-- R28  delete_media_asset decided "not accepted" without locking the asset,
--      so an acceptance committing at the same moment (every acceptance path
--      locks the asset row first) could be followed by the uploader's
--      withdrawal of an accepted original. It now locks the asset row before
--      checking, so it waits for the acceptance and then refuses
--      (media_asset_retained).
--
-- Rollback: re-apply the 20261118107000 / 20261118107100 bodies.

-- ---------------------------------------------------------------------------
-- R27: community reads keep manager-era uploads out (M1, OD-9)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Community reads
-- ---------------------------------------------------------------------------
-- Community reads
-- ---------------------------------------------------------------------------

-- Body as in 20261118107000 (base 20261107130000, M1 filter of 20261110091603 restored); a colleague's asset
-- must also be visible to the caller (accepted at a venue whose album they
-- see, or at a venue they manage: the transitional staff-held manager's
-- Coverage review reads its venue's waiting photos through this function).
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
        and private.media_visible_to_caller(a.id)
      )
    )
  order by a.id;
end;
$$;

-- Body as in 20261118107000 (base 20261107130000, M1 filter of 20261110091603 restored), limited to media the
-- caller can see (FA-20). Own photos stay in the caller's own view.
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
    and private.media_visible_to_caller(a.id)
    and (p_venue is null or a.venue_id = p_venue)
    and (p_uploader is null or a.uploader_id = p_uploader)
    and (p_type is null or a.media_type = p_type)
    and (p_department is null or p.department = p_department)
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101);
$$;

-- Body as in 20261118107000 (base 20261107130000, M1 filter of 20261110091603 restored); media_count counts
-- only what the caller can see, so it matches the member's page.
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
        )
        and private.media_visible_to_caller(a.id))
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
-- R28: withdrawal locks the asset before deciding it is not accepted
-- ---------------------------------------------------------------------------

-- Body as in 20261118107100, except that the asset row is locked first (the
-- same lock order as every acceptance path), so the acceptance check sees an
-- acceptance that committed while this call waited.
create or replace function public.delete_media_asset(p_asset_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_venue uuid;
  v_deleted timestamptz;
begin
  select a.uploader_id, a.venue_id, a.deleted_at into v_owner, v_venue, v_deleted
  from public.media_assets a where a.id = p_asset_id
  for update;

  if v_uid is null or v_owner is null
     or not (private.is_active_admin() or (private.is_active_staff() and v_owner = v_uid)) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  -- Removing a removed asset succeeds again.
  if v_deleted is not null then
    return;
  end if;

  -- FA-21: an accepted original is kept; an admin removes it with a reason.
  if private.asset_is_accepted(p_asset_id) then
    raise exception 'media_asset_retained' using errcode = 'P0001',
      detail = 'Accepted media is kept. Ask an admin to remove it.';
  end if;

  update public.media_assets a
  set deleted_at = now()
  where a.id = p_asset_id and a.deleted_at is null;

  if found then
    insert into public.media_removal_events (asset_id, venue_id, actor_id, action)
    values (p_asset_id, v_venue, v_uid, 'withdrawn');
  end if;
end;
$$;
