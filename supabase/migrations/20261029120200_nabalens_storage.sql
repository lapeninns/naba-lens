-- NabaLens private storage (spec v0.2 §5, §7).
-- Buckets are private; reads use authenticated downloads or short-lived signed URLs.
-- End users can only:
--   * upload an original to a key reserved for them by public.reserve_media_asset,
--   * read their own *ready* media objects and their own avatar folder,
--   * (admins) read every ready media object and every avatar.
-- No end-user update/delete policies exist, so objects cannot be overwritten (upsert)
-- or removed directly. Derivatives, avatars and removals are written by the server
-- with the service role after it re-checks the caller.

-- Bucket size caps are a coarse outer bound. The product limits (20 MiB photo,
-- 200 MiB video, 5 MiB avatar) live in lib/config/media.ts and are enforced server-side.
-- Content type is validated from bytes by the server, so no client MIME allow-list here
-- (phones send HEIC with empty or generic types).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media', 'media', false, 209715200, null),
  ('avatars', 'avatars', false, 5242880, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Parse `{uploader_id}/{asset_id}/<file>` safely.
create or replace function private.media_asset_id_from_key(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9.]+$'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;

create or replace function private.can_read_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_assets a
    where a.id = private.media_asset_id_from_key(p_name)
      and p_name in (a.original_path, a.preview_path, a.thumbnail_path)
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and (
        private.is_active_admin()
        or (a.uploader_id = (select auth.uid()) and private.is_active_staff())
      )
  );
$$;

create or replace function private.can_upload_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_assets a
    join public.venues v on v.id = a.venue_id and v.active
    where a.id = private.media_asset_id_from_key(p_name)
      and a.original_path = p_name
      and a.uploader_id = (select auth.uid())
      and a.upload_state = 'uploading'
      and a.deleted_at is null
      and private.is_active_staff()
  );
$$;

create or replace function private.can_read_avatar_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_admin()
    or (
      private.is_active_user()
      and split_part(p_name, '/', 1) = (select auth.uid())::text
    );
$$;

revoke all on function
  private.media_asset_id_from_key(text),
  private.can_read_media_object(text),
  private.can_upload_media_object(text),
  private.can_read_avatar_object(text)
from public, anon;
grant execute on function
  private.media_asset_id_from_key(text),
  private.can_read_media_object(text),
  private.can_upload_media_object(text),
  private.can_read_avatar_object(text)
to authenticated, service_role;

create policy nabalens_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (select private.can_read_media_object(name)));

create policy nabalens_media_insert_reserved on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (select private.can_upload_media_object(name)));

create policy nabalens_avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (select private.can_read_avatar_object(name)));

-- ---------------------------------------------------------------------------
-- Retryable cleanup (service role only)
-- ---------------------------------------------------------------------------
-- The media_assets row itself is the tombstone: deleted_at hides it immediately and
-- the row is kept (keys stay unique and auditable). A cleanup worker repeatedly:
--   1. calls prepare_media_cleanup(window, limit), which tombstones abandoned
--      reservations (uploading/failed and untouched for longer than `window`) and
--      returns tombstoned assets whose objects still exist in storage;
--   2. removes the returned object keys through the Storage API (service role);
--   3. repeats on the next run. Failed removals simply reappear next time, because
--      the source of truth is storage.objects itself. Nothing is marked "erased"
--      until the objects are actually gone.
-- The window comes from lib/config/media.ts (24 hours) so limits are not duplicated here.

create or replace function public.prepare_media_cleanup(
  p_abandoned_after interval,
  p_limit integer default 100
)
returns table (asset_id uuid, object_names text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_abandoned_after is null or p_abandoned_after < interval '1 hour' then
    raise exception 'abandoned_window_too_short' using errcode = '22023';
  end if;

  update public.media_assets a
  set deleted_at = now()
  where a.deleted_at is null
    and a.upload_state in ('uploading', 'failed')
    and a.updated_at < now() - p_abandoned_after;

  return query
    select a.id, array_agg(o.name order by o.name)
    from public.media_assets a
    join storage.objects o
      on o.bucket_id = 'media'
     and o.name like a.uploader_id::text || '/' || a.id::text || '/%'
    where a.deleted_at is not null
    group by a.id
    order by min(a.deleted_at)
    limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$$;

revoke all on function public.prepare_media_cleanup(interval, integer) from public, anon, authenticated;
grant execute on function public.prepare_media_cleanup(interval, integer) to service_role;
