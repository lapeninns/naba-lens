-- Organization-wide portfolio discovery. This deployment represents one parent
-- organization; venue is an organizational unit, not an independent tenant.
-- Raw profile rows remain own/admin-only. Public organization profile fields
-- are exposed through a narrow RPC, and inactive colleagues are not discoverable.

create or replace function private.is_community_member(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.active and p.role = 'staff'
  );
$$;
revoke all on function private.is_community_member(uuid) from public, anon;
grant execute on function private.is_community_member(uuid) to authenticated, service_role;

create policy media_assets_select_community on public.media_assets
  for select to authenticated
  using (
    (select private.is_active_user())
    and upload_state = 'ready' and deleted_at is null
    and private.is_community_member(uploader_id)
  );

create index profiles_community_name_idx
  on public.profiles (display_name, id) where active and role = 'staff';

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
      where a.uploader_id = p.id and a.upload_state = 'ready' and a.deleted_at is null)
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  where (select private.is_active_user())
    and p.active and p.role = 'staff'
    and (p_venue is null or p.venue_id = p_venue)
    and (p_member is null or p.id = p_member)
    and (p_department is null or p.department = p_department)
    and (p_query is null or strpos(lower(p.display_name), lower(left(p_query, 80))) > 0)
  order by p.display_name, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 101)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;
revoke all on function public.community_members(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.community_members(uuid, uuid, text, text, integer, integer) to authenticated, service_role;

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
    a.validated_mime_type, a.original_filename, a.created_at,
    a.width, a.height, a.duration_seconds, a.size_bytes
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
revoke all on function public.community_media_page(uuid, uuid, public.media_type, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.community_media_page(uuid, uuid, public.media_type, text, timestamptz, uuid, integer) to authenticated, service_role;
