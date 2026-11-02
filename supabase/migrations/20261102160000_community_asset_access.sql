-- Changes community read access to colleagues' media. The table policy from
-- 20261102120000 returned whole media rows (storage paths, original filename,
-- upload key, size) to every active user. It is dropped: colleagues now read a
-- narrow projection through community_readable_assets, and colleague listings
-- (community_media_page) no longer carry the original filename. The own and
-- admin row policies are unchanged.

drop policy media_assets_select_community on public.media_assets;

-- Ready, undeleted assets the caller may view: their own, any active staff
-- member's (the organization community), or any as an active admin. No storage
-- paths, filename or upload key: the server signs or streams with the service
-- role only after this check.
create function public.community_readable_assets(p_asset_ids uuid[])
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
    and (select private.is_active_user())
    and (
      a.uploader_id = (select auth.uid())
      or (select private.is_active_admin())
      or private.is_community_member(a.uploader_id)
    )
  order by a.id;
end;
$$;
revoke all on function public.community_readable_assets(uuid[]) from public, anon;
grant execute on function public.community_readable_assets(uuid[]) to authenticated, service_role;

-- Same page, but the original filename only reaches its uploader.
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
  where (select private.is_active_user())
    and a.upload_state = 'ready' and a.deleted_at is null
    and (p_venue is null or a.venue_id = p_venue)
    and (p_uploader is null or a.uploader_id = p_uploader)
    and (p_type is null or a.media_type = p_type)
    and (p_department is null or p.department = p_department)
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101);
$$;
