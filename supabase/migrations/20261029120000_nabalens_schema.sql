-- NabaLens core schema (spec v0.2 §6).
-- Three domain tables on top of auth.users: venues, profiles, media_assets.
-- Object keys are stored relative to their bucket:
--   bucket `media`:   {uploader_id}/{asset_id}/original.{ext} | preview.webp | thumb.webp
--   bucket `avatars`: {user_id}/{uuid}.webp

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('staff', 'admin');
create type public.media_type as enum ('image', 'video');
create type public.upload_state as enum ('uploading', 'processing', 'ready', 'failed');

-- Internal helpers that must not be exposed through the Data API live here.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index venues_name_lower_key on public.venues (lower(name));

comment on table public.venues is
  'Organisation venues. Production rows come from owner-confirmed supabase/seed/venues.json; no management UI.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  avatar_path text,
  job_title text check (job_title is null or length(btrim(job_title)) between 1 and 80),
  role public.app_role not null default 'staff',
  venue_id uuid references public.venues (id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Staff always have exactly one assigned venue; admins may have none.
  constraint profiles_staff_requires_venue check (role = 'admin' or venue_id is not null),
  -- Avatars live in the user's own folder of the private `avatars` bucket.
  constraint profiles_avatar_path_own_folder check (
    avatar_path is null
    or avatar_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
  )
);

create index profiles_venue_id_idx on public.profiles (venue_id);

comment on table public.profiles is
  'One row per invited account. role/active/venue_id are server-controlled and never read from user metadata.';

-- ---------------------------------------------------------------------------
-- media_assets
-- ---------------------------------------------------------------------------

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles (id) on delete restrict,
  -- Venue snapshot at reservation time; never derived from the uploader's current profile.
  venue_id uuid not null references public.venues (id) on delete restrict,
  original_path text not null unique,
  preview_path text unique,
  thumbnail_path text unique,
  original_filename text not null check (length(original_filename) between 1 and 255),
  media_type public.media_type not null,
  validated_mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric(10, 3) check (duration_seconds is null or duration_seconds >= 0),
  upload_state public.upload_state not null default 'uploading',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Tombstone: set once, hides the row everywhere and drives retryable storage cleanup.
  deleted_at timestamptz,
  constraint media_assets_original_path_key_format check (
    original_path ~ ('^' || uploader_id::text || '/' || id::text || '/original\.[a-z0-9]{2,5}$')
  ),
  constraint media_assets_preview_path_key_format check (
    preview_path is null or preview_path = uploader_id::text || '/' || id::text || '/preview.webp'
  ),
  constraint media_assets_thumbnail_path_key_format check (
    thumbnail_path is null or thumbnail_path = uploader_id::text || '/' || id::text || '/thumb.webp'
  ),
  -- Only validated content can be ready.
  constraint media_assets_ready_is_validated check (
    upload_state <> 'ready' or (validated_mime_type is not null and size_bytes is not null)
  )
);

-- Gallery access patterns with stable (created_at, id) cursor pagination.
-- Staff portfolio: own rows in every technical state.
create index media_assets_uploader_feed_idx
  on public.media_assets (uploader_id, created_at desc, id desc)
  where deleted_at is null;
-- Admin library filtered by venue.
create index media_assets_venue_feed_idx
  on public.media_assets (venue_id, created_at desc, id desc)
  where deleted_at is null and upload_state = 'ready';
-- Admin central feed.
create index media_assets_ready_feed_idx
  on public.media_assets (created_at desc, id desc)
  where deleted_at is null and upload_state = 'ready';
-- Cleanup: abandoned reservations and tombstones awaiting storage removal.
create index media_assets_abandoned_idx
  on public.media_assets (updated_at)
  where deleted_at is null and upload_state in ('uploading', 'failed');
create index media_assets_tombstone_idx
  on public.media_assets (deleted_at)
  where deleted_at is not null;

comment on table public.media_assets is
  'One record per uploaded file; the staff portfolio and the admin library are two views of the same row.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the statement runs as an end-user Data API role rather than the
-- service role, a migration, or a SECURITY DEFINER function owned by postgres.
create or replace function private.is_end_user_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

create or replace function private.assert_venue_assignable(p_venue_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_venue_id is null then
    return;
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_inactive' using errcode = 'P0001',
      detail = 'An inactive or unknown venue cannot receive staff assignments.';
  end if;
end;
$$;

create or replace function private.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    perform private.assert_venue_assignable(new.venue_id);
    return new;
  end if;

  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'profile_identity_immutable' using errcode = '42501';
  end if;

  if new.venue_id is distinct from old.venue_id then
    perform private.assert_venue_assignable(new.venue_id);
  end if;

  if private.is_end_user_context() then
    -- Roles change only through the controlled bootstrap procedure (service role).
    if new.role is distinct from old.role then
      raise exception 'role_change_forbidden' using errcode = '42501';
    end if;

    if new.job_title is distinct from old.job_title
       or new.venue_id is distinct from old.venue_id
       or new.active is distinct from old.active then
      if not private.is_active_admin() then
        raise exception 'admin_only_fields' using errcode = '42501',
          detail = 'Only an admin can change job title, venue or activation.';
      end if;
      if new.active is distinct from old.active and old.id = v_uid then
        raise exception 'self_deactivation_forbidden' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.media_assets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.uploader_id is distinct from old.uploader_id
     or new.venue_id is distinct from old.venue_id
     or new.original_path is distinct from old.original_path
     or new.original_filename is distinct from old.original_filename
     or new.media_type is distinct from old.media_type
     or new.created_at is distinct from old.created_at then
    raise exception 'media_asset_reservation_immutable' using errcode = '42501',
      detail = 'Owner, venue, type, filename and original key are fixed at reservation.';
  end if;

  -- Derivative keys may be set once, never moved or cleared.
  if (old.preview_path is not null and new.preview_path is distinct from old.preview_path)
     or (old.thumbnail_path is not null and new.thumbnail_path is distinct from old.thumbnail_path) then
    raise exception 'media_asset_derivative_key_immutable' using errcode = '42501';
  end if;

  -- Tombstones are permanent.
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'media_asset_tombstone_permanent' using errcode = '42501';
  end if;

  -- A ready asset's validated facts never change; only the tombstone may be set.
  if old.upload_state = 'ready' and (
       new.upload_state is distinct from old.upload_state
       or new.validated_mime_type is distinct from old.validated_mime_type
       or new.size_bytes is distinct from old.size_bytes
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.duration_seconds is distinct from old.duration_seconds
       or new.preview_path is distinct from old.preview_path
       or new.thumbnail_path is distinct from old.thumbnail_path) then
    raise exception 'media_asset_ready_immutable' using errcode = '42501';
  end if;

  -- Technical state machine: uploading -> processing -> ready | failed; failed may retry.
  if new.upload_state is distinct from old.upload_state and not (
       (old.upload_state = 'uploading' and new.upload_state in ('processing', 'failed'))
       or (old.upload_state = 'processing' and new.upload_state in ('ready', 'failed', 'uploading'))
       or (old.upload_state = 'failed' and new.upload_state in ('uploading', 'processing'))
     ) then
    raise exception 'media_asset_invalid_state_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.upload_state, new.upload_state);
  end if;

  return new;
end;
$$;

create or replace function private.media_assets_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.upload_state <> 'uploading' or new.deleted_at is not null
     or new.preview_path is not null or new.thumbnail_path is not null then
    raise exception 'media_asset_must_start_uploading' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.venues v where v.id = new.venue_id and v.active) then
    raise exception 'venue_inactive' using errcode = 'P0001',
      detail = 'An inactive venue cannot receive uploads.';
  end if;
  return new;
end;
$$;
