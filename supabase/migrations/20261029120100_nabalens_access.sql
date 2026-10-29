-- NabaLens access control (spec v0.2 §7).
-- Every check reads the caller's *current* role/active/venue from public.profiles,
-- so deactivation takes effect on the next request even with an old session token.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, not exposed through the Data API)
-- ---------------------------------------------------------------------------

grant usage on schema private to authenticated, service_role;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  );
$$;

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'staff'
  );
$$;

create or replace function private.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  );
$$;

-- The caller's venue when they may upload: active staff assigned to an active venue.
create or replace function private.uploadable_venue_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.venue_id
  from public.profiles p
  join public.venues v on v.id = p.venue_id and v.active
  where p.id = (select auth.uid()) and p.active and p.role = 'staff';
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_active_user(),
  private.is_active_staff(),
  private.is_active_admin(),
  private.uploadable_venue_id(),
  private.is_end_user_context(),
  private.assert_venue_assignable(uuid),
  private.set_updated_at(),
  private.profiles_guard(),
  private.media_assets_guard(),
  private.media_assets_insert_guard()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function private.profiles_guard();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger media_assets_insert_guard
  before insert on public.media_assets
  for each row execute function private.media_assets_insert_guard();

create trigger media_assets_guard
  before update on public.media_assets
  for each row execute function private.media_assets_guard();

create trigger media_assets_set_updated_at
  before update on public.media_assets
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Table privileges: column-restricted, least privilege
-- ---------------------------------------------------------------------------

revoke all on public.venues, public.profiles, public.media_assets from anon, authenticated;

grant select on public.venues to authenticated;
grant select on public.profiles to authenticated;
grant select on public.media_assets to authenticated;
-- `role`, `id` and timestamps are not updatable by any end user. Staff may only
-- change display_name/avatar_path; profiles_guard limits the rest to admins.
grant update (display_name, avatar_path, job_title, venue_id, active) on public.profiles to authenticated;
-- No direct insert/update/delete on media_assets for end users: reservations and
-- removals go through the RPCs below; processing uses the service role.

grant all on public.venues, public.profiles, public.media_assets to service_role;

alter table public.venues enable row level security;
alter table public.profiles enable row level security;
alter table public.media_assets enable row level security;

-- ---------------------------------------------------------------------------
-- RLS: venues
-- ---------------------------------------------------------------------------

create policy venues_select_active_users on public.venues
  for select to authenticated
  using ((select private.is_active_user()));

-- ---------------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------------

-- Own row is always readable so the app can tell a deactivated user why access is
-- blocked; every other protected read/write below requires an active profile.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select private.is_active_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()))
  with check (id = (select auth.uid()));

-- Admins manage staff profiles (and their own display fields). Other admins'
-- accounts are managed only through the bootstrap procedure.
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select private.is_active_admin()) and (role = 'staff' or id = (select auth.uid())))
  with check (role = 'staff' or id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: media_assets
-- ---------------------------------------------------------------------------

-- Staff see their own non-deleted assets in every technical state (so the UI can
-- show uploading/processing/failed accurately). Storage access is stricter: ready only.
create policy media_assets_select_own on public.media_assets
  for select to authenticated
  using (
    uploader_id = (select auth.uid())
    and deleted_at is null
    and (select private.is_active_staff())
  );

create policy media_assets_select_admin on public.media_assets
  for select to authenticated
  using (
    (select private.is_active_admin())
    and deleted_at is null
    and upload_state = 'ready'
  );

-- ---------------------------------------------------------------------------
-- RPCs callable by signed-in users
-- ---------------------------------------------------------------------------

-- Reserve an upload. Owner and venue are derived from the caller's current profile;
-- the asset ID and object key are generated here. Size/format limits are enforced by
-- the server route using lib/config/media.ts before calling this.
create or replace function public.reserve_media_asset(
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint default null
)
returns table (id uuid, original_path text, venue_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_id uuid := gen_random_uuid();
  v_ext text := lower(btrim(p_extension, '. '));
  v_path text;
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  v_venue := private.uploadable_venue_id();
  if v_venue is null then
    raise exception 'venue_unavailable' using errcode = 'P0001',
      detail = 'Staff must be assigned to an active venue before uploading.';
  end if;

  if v_ext !~ '^[a-z0-9]{2,5}$' then
    raise exception 'invalid_extension' using errcode = '22023';
  end if;

  v_path := v_uid::text || '/' || v_id::text || '/original.' || v_ext;

  insert into public.media_assets as a (
    id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes
  )
  values (
    v_id, v_uid, v_venue, v_path,
    left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
    p_media_type, p_size_bytes
  );

  return query select v_id, v_path, v_venue;
end;
$$;

-- Remove an asset from both views immediately. Idempotent. Staff may remove their
-- own assets; admins any. Physical storage removal is a separate retryable step
-- (see public.prepare_media_cleanup). Unknown and forbidden assets look the same.
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
begin
  select a.uploader_id into v_owner from public.media_assets a where a.id = p_asset_id;

  if v_uid is null or v_owner is null
     or not (private.is_active_admin() or (private.is_active_staff() and v_owner = v_uid)) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  update public.media_assets a
  set deleted_at = now()
  where a.id = p_asset_id and a.deleted_at is null;
end;
$$;

revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint) from public, anon;
revoke all on function public.delete_media_asset(uuid) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint) to authenticated, service_role;
grant execute on function public.delete_media_asset(uuid) to authenticated, service_role;
