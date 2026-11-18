-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-UPLOAD: the upload pipeline (spec §5.1, §5.6, §10, §11,
-- §12; decisions FA-35 and FA-42; docs/plans/full-app-v1/checklist.md).
--
--   Limits     Photos up to 25 MiB, videos up to 250 MiB (spec §12.1). The
--              reservation limits move into private.media_upload_max_bytes so
--              they are defined once in SQL; lib/config/media.ts holds the same
--              numbers for the app. The media bucket and the archive receipt
--              check rise to 250 MiB. The 60 s video limit is checked from the
--              stored bytes by finalise (lib/server/media/finalise.ts).
--   Batch      media_assets.client_batch_id: the client's stable batch ID
--              (spec §12.2 step 1), stored by the first reservation of each
--              file and never changed. Retries of the same file keep it.
--   Hash       media_assets.content_sha256: SHA-256 of the stored original,
--              computed by finalise from the validated bytes (FA-35).
--   Duplicate  media_assets.duplicate_of_asset_id: set at finalise when an
--              earlier, live, ready asset at the SAME venue has the same hash
--              (spec §12.4, AC21, AC23). Other venues' media is never compared,
--              so nothing about it is revealed. A duplicate keeps its own row,
--              uploader and history; private.monthly_credit_items no longer
--              credits it, so contribution counts do not inflate.
--   Captured   media_assets.captured_at and captured_at_source (metadata,
--              supplied, estimated or unknown), separate from created_at, the
--              upload time (spec §5.1, §11). Finalise reads it from the file's
--              own metadata; public.set_media_captured_at records a correction
--              ('supplied') or clears it to unknown.
--   Renditions public.media_renditions: one row per derivative (kind, key,
--              type, dimensions, settings, pipeline version), written by
--              finalise (spec §12.3). Existing previews and thumbnails are
--              backfilled as pipeline 'legacy' with unknown dimensions.
--   Access     Finalise and the storage write now recheck the uploader's
--              CURRENT venue (spec §12.4, AC12): a staff member moved to
--              another venue, deactivated, or whose venue closed can no
--              longer store or finish a reservation made for the old venue.
--              One rule, private.media_upload_venue_allowed, is used by the
--              storage insert policy, the storage write trigger and
--              complete_media_finalise. Before, only a manager account was
--              rechecked; staff only had to be active.
--
-- complete_media_finalise keeps its body: the old function moves to
-- private.complete_media_finalise_core, and a new public function with the
-- same leading arguments (plus hash and capture time) locks the asset, checks
-- the venue rule, stores hash, duplicate and capture time, then calls it.
-- reserve_media_asset keeps the 20261110095911 body with the batch argument
-- added and the limits read from the helper.
--
-- Rollback: a forward migration restoring reserve_media_asset (20261110095911),
-- complete_media_finalise (move the core back), can_upload_media_object and
-- guard_media_original_write (20261110090145), monthly_credit_items (rename
-- the base back) and the 200 MiB bucket. The new columns and table stay
-- (nullable, no data loss).

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

-- Largest original per media type, in bytes. Same numbers as
-- MEDIA_LIMITS.maxPhotoBytes / maxVideoBytes in lib/config/media.ts.
create function private.media_upload_max_bytes(p_media_type public.media_type)
returns bigint
language sql
immutable
set search_path = ''
as $$
  -- (No CASE expression: the Supabase CLI's statement splitter misreads it.)
  select 25::bigint * 1024 * 1024 where p_media_type = 'image'
  union all
  select 250::bigint * 1024 * 1024 where p_media_type = 'video';
$$;

revoke all on function private.media_upload_max_bytes(public.media_type) from public, anon, authenticated;

update storage.buckets
set file_size_limit = 262144000
where id = 'media';

alter table public.media_archive_receipts
  drop constraint if exists media_archive_receipts_size_bytes_check;
alter table public.media_archive_receipts
  add constraint media_archive_receipts_size_bytes_check
  check (size_bytes between 1 and 262144000);

-- ---------------------------------------------------------------------------
-- New asset columns
-- ---------------------------------------------------------------------------

alter table public.media_assets
  add column client_batch_id text
    constraint media_assets_client_batch_id_format
    check (client_batch_id is null or client_batch_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  add column content_sha256 text
    constraint media_assets_content_sha256_format
    check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  -- No foreign keys on the two uuid columns: a second media_assets ->
  -- profiles (or self) relationship would make PostgREST's existing
  -- media_assets/profiles embeds ambiguous. Both are written only by the
  -- functions below.
  add column duplicate_of_asset_id uuid,
  add column captured_at timestamptz,
  add column captured_at_source text not null default 'unknown'
    constraint media_assets_captured_at_source_check
    check (captured_at_source in ('metadata', 'supplied', 'estimated', 'unknown')),
  add column captured_at_set_by uuid,
  add constraint media_assets_captured_at_known
    check ((captured_at is null) = (captured_at_source = 'unknown')),
  add constraint media_assets_not_own_duplicate
    check (duplicate_of_asset_id is distinct from id);

comment on column public.media_assets.client_batch_id is
  'The client''s stable batch ID from the first reservation (spec §12.2). Fixed once set.';
comment on column public.media_assets.content_sha256 is
  'SHA-256 (hex) of the validated original, set by finalise (FA-35). Fixed once set.';
comment on column public.media_assets.duplicate_of_asset_id is
  'An earlier live ready asset at the same venue with the same content_sha256, found at finalise. A duplicate earns no contribution credit (AC21).';
comment on column public.media_assets.captured_at is
  'When the photo or video was taken, if known. Not the upload time (created_at).';
comment on column public.media_assets.captured_at_source is
  'Where captured_at came from: metadata (the file), supplied (a person corrected it), estimated, or unknown.';

-- Duplicate lookup and batch receipts.
create index media_assets_venue_sha256_idx
  on public.media_assets (venue_id, content_sha256)
  where content_sha256 is not null and deleted_at is null;
create index media_assets_uploader_batch_idx
  on public.media_assets (uploader_id, client_batch_id)
  where client_batch_id is not null;
create index media_assets_duplicate_of_idx
  on public.media_assets (duplicate_of_asset_id)
  where duplicate_of_asset_id is not null;

-- Batch, hash and duplicate are set once and never changed afterwards.
create function private.media_assets_pipeline_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The duplicate link may only be cleared, never moved, and never added
  -- once ready.
  if (old.client_batch_id is not null
        and new.client_batch_id is distinct from old.client_batch_id)
     or (old.content_sha256 is not null
        and new.content_sha256 is distinct from old.content_sha256)
     or (old.duplicate_of_asset_id is not null
        and new.duplicate_of_asset_id is not null
        and new.duplicate_of_asset_id is distinct from old.duplicate_of_asset_id)
     or (old.upload_state = 'ready'
        and old.duplicate_of_asset_id is null
        and new.duplicate_of_asset_id is not null) then
    raise exception 'media_asset_pipeline_immutable' using errcode = '42501',
      detail = 'Batch, content hash and duplicate link are fixed once set.';
  end if;
  return new;
end;
$$;

revoke all on function private.media_assets_pipeline_guard() from public, anon, authenticated;

create trigger media_assets_pipeline_guard
  before update on public.media_assets
  for each row execute function private.media_assets_pipeline_guard();

-- ---------------------------------------------------------------------------
-- Renditions
-- ---------------------------------------------------------------------------

create table public.media_renditions (
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  kind text not null check (kind in ('preview', 'thumbnail')),
  object_key text not null unique,
  mime_type text not null check (length(mime_type) between 3 and 100),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  pipeline_version text not null check (length(pipeline_version) between 1 and 40),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 2048),
  created_at timestamptz not null default now(),
  constraint media_renditions_pkey primary key (asset_id, kind)
);

comment on table public.media_renditions is
  'Derivatives of an asset (spec §12.3): kind, key, output type, dimensions, settings and processing version. The original is never changed. Written by finalise (service role); read through the server.';

alter table public.media_renditions enable row level security;
revoke all on public.media_renditions from public, anon, authenticated;
grant all on public.media_renditions to service_role;

insert into public.media_renditions (asset_id, kind, object_key, mime_type, pipeline_version)
select a.id, 'preview', a.preview_path, 'image/webp', 'legacy'
from public.media_assets a
where a.preview_path is not null
on conflict do nothing;

insert into public.media_renditions (asset_id, kind, object_key, mime_type, pipeline_version)
select a.id, 'thumbnail', a.thumbnail_path, 'image/webp', 'legacy'
from public.media_assets a
where a.thumbnail_path is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The current-venue rule (spec §12.4, AC12)
-- ---------------------------------------------------------------------------

-- May this uploader still store or finish a reservation at this venue, with
-- the role it was reserved under? Staff: an active staff account currently
-- assigned to the (active) venue. Manager account: its manager-era
-- reservation at the venue it manages now. Anything else: no.
create function private.media_upload_venue_allowed(
  p_uploader uuid,
  p_uploader_role public.app_role,
  p_venue uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uploader is not null and p_venue is not null and (
    exists (
      select 1
      from public.profiles p
      join public.venues v on v.id = p.venue_id and v.active
      where p.id = p_uploader
        and p.active
        and p.role = 'staff'
        and p.venue_id = p_venue
        and p_uploader_role is distinct from 'manager'
    )
    or (
      p_uploader_role = 'manager'
      and coalesce(private.manager_upload_venue_id(p_uploader) = p_venue, false)
    )
  );
$$;

revoke all on function private.media_upload_venue_allowed(uuid, public.app_role, uuid) from public, anon, authenticated;

-- Storage insert policy: as 20261110090145, with the current-venue rule for
-- staff too.
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
    where a.id = private.media_asset_id_from_key(p_name)
      and a.original_path = p_name
      and a.uploader_id = (select auth.uid())
      and a.upload_state = 'uploading'
      and a.deleted_at is null
      and private.media_upload_venue_allowed(a.uploader_id, a.uploader_role, a.venue_id)
  );
$$;

-- Storage write trigger: as 20261110090145, with the same rule.
create or replace function private.guard_media_original_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id <> 'media' then
    return new;
  end if;

  -- Only keys that some reservation owns as its original are checked here.
  if not exists (
    select 1 from public.media_assets a
    where a.id = private.media_asset_id_from_key(new.name)
      and a.original_path = new.name
  ) then
    return new;
  end if;

  if not exists (
    select 1
    from public.media_assets a
    where a.id = private.media_asset_id_from_key(new.name)
      and a.original_path = new.name
      and a.upload_state = 'uploading'
      and a.deleted_at is null
      and private.media_upload_venue_allowed(a.uploader_id, a.uploader_role, a.venue_id)
  ) then
    raise exception 'media_reservation_closed' using errcode = '42501',
      detail = 'The reservation for this key is no longer accepting an upload.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_media_asset: batch ID, limits from the helper
-- ---------------------------------------------------------------------------

drop function public.reserve_media_asset(public.media_type, text, text, bigint, text, text);

create function public.reserve_media_asset(
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint default null,
  p_client_upload_key text default null,
  p_purpose text default 'general',
  p_client_batch_id text default null
)
returns table (
  id uuid,
  original_path text,
  venue_id uuid,
  upload_state public.upload_state,
  reused boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_manager boolean := private.is_active_manager();
  v_venue uuid;
  v_id uuid := gen_random_uuid();
  v_ext text := lower(btrim(p_extension, '. '));
  v_path text;
  v_existing public.media_assets;
  v_open integer;
  c_max_open constant integer := 20;
begin
  if v_uid is null or not (private.is_active_staff() or v_manager) then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  if p_client_upload_key is null or p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;

  if p_client_batch_id is not null and p_client_batch_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_batch_id' using errcode = '22023';
  end if;

  if p_purpose is null or p_purpose not in ('general', 'amenity') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;

  -- A manager account reuses only within its current scope, so its venue
  -- comes first.
  if v_manager then
    v_venue := private.manager_upload_venue_id(v_uid);
    if v_venue is null then
      raise exception 'venue_unavailable' using errcode = 'P0001',
        detail = 'Staff must be assigned to an active venue before uploading.';
    end if;
  end if;

  -- A retry returns the original reservation (its batch included); storage
  -- and finalise recheck the venue (private.media_upload_venue_allowed).
  select a.* into v_existing
  from public.media_assets a
  where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;

  if found then
    if v_manager and (
      v_existing.uploader_role is distinct from 'manager'
      or v_existing.venue_id is distinct from v_venue
    ) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002',
        detail = 'This upload was removed.';
    end if;
    if v_existing.purpose <> p_purpose then
      raise exception 'reservation_purpose_mismatch' using errcode = '22023',
        detail = 'This upload key was reserved for another purpose.';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end if;

  if not v_manager then
    v_venue := private.uploadable_venue_id();
    if v_venue is null then
      raise exception 'venue_unavailable' using errcode = 'P0001',
        detail = 'Staff must be assigned to an active venue before uploading.';
    end if;
  end if;

  if p_media_type is null
     or (p_media_type = 'image' and v_ext not in ('jpg', 'png', 'webp', 'heic', 'heif'))
     or (p_media_type = 'video' and v_ext not in ('mp4', 'mov', 'webm')) then
    raise exception 'invalid_extension' using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0
     or p_size_bytes > private.media_upload_max_bytes(p_media_type) then
    raise exception 'invalid_size' using errcode = '22023';
  end if;

  -- Serialise this uploader's new reservations so concurrent calls cannot all
  -- pass the count below.
  perform pg_advisory_xact_lock(hashtextextended('nabalens_reserve:' || v_uid::text, 0));
  select count(*) into v_open
  from public.media_assets a
  where a.uploader_id = v_uid
    and a.deleted_at is null
    and a.upload_state <> 'ready';
  if v_open >= c_max_open then
    raise exception 'too_many_open_uploads' using errcode = 'P0001',
      detail = 'Finish, retry or delete earlier uploads before starting more.';
  end if;

  v_path := v_uid::text || '/' || v_id::text || '/original.' || v_ext;

  begin
    insert into public.media_assets as a (
      id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes,
      client_upload_key, purpose, uploader_role, client_batch_id
    )
    values (
      v_id, v_uid, v_venue, v_path,
      left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
      p_media_type, p_size_bytes, p_client_upload_key, p_purpose,
      (select p.role from public.profiles p where p.id = v_uid),
      p_client_batch_id
    );
  exception when unique_violation then
    -- A concurrent call with the same key won the race: return its reservation,
    -- under the same manager scope rule as above.
    select a.* into v_existing
    from public.media_assets a
    where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;
    if not found then
      raise;
    end if;
    if v_manager and (
      v_existing.uploader_role is distinct from 'manager'
      or v_existing.venue_id is distinct from v_venue
    ) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_existing.purpose <> p_purpose then
      raise exception 'reservation_purpose_mismatch' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end;

  return query select v_id, v_path, v_venue, 'uploading'::public.upload_state, false;
end;
$$;

revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- complete_media_finalise: venue recheck, hash, duplicate, capture time
-- ---------------------------------------------------------------------------

alter function public.complete_media_finalise(uuid, text, bigint, integer, integer, numeric, text, text)
  set schema private;
alter function private.complete_media_finalise(uuid, text, bigint, integer, integer, numeric, text, text)
  rename to complete_media_finalise_core;
-- Reached only through the wrapper below (security definer, same owner).
revoke all on function private.complete_media_finalise_core(uuid, text, bigint, integer, integer, numeric, text, text)
  from public, anon, authenticated, service_role;

-- finalise's last step (lib/server/media/finalise.ts), service role only.
-- Under the asset row lock, on a `processing`, non-deleted asset:
--   * the uploader must still be allowed at the asset's venue, else
--     upload_access_ended / 42501 and nothing changes (AC12);
--   * stores the content hash, links the earliest live ready asset at the
--     same venue with the same hash as duplicate_of_asset_id, and stores the
--     capture time read from the file (source 'metadata', or 'unknown');
--   * then runs the earlier body (ready + stored labels), unchanged.
-- Not processing or deleted: became_ready = false and nothing changes, as
-- before.
create function public.complete_media_finalise(
  p_asset_id uuid,
  p_validated_mime_type text,
  p_size_bytes bigint,
  p_width integer default null,
  p_height integer default null,
  p_duration_seconds numeric default null,
  p_preview_path text default null,
  p_thumbnail_path text default null,
  p_content_sha256 text default null,
  p_captured_at timestamptz default null
)
returns table (
  became_ready boolean,
  labels_state text,
  labels_code text,
  labels_revision integer,
  labels_has_labels boolean,
  duplicate_of_asset_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_asset public.media_assets;
  v_duplicate uuid;
begin
  if p_content_sha256 is not null and p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_content_hash' using errcode = '22023';
  end if;

  select a.* into v_asset
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'processing'
    and a.deleted_at is null
  for update;
  if not found then
    return query select false, null::text, null::text, null::integer, null::boolean, null::uuid;
    return;
  end if;

  if not private.media_upload_venue_allowed(v_asset.uploader_id, v_asset.uploader_role, v_asset.venue_id) then
    raise exception 'upload_access_ended' using errcode = '42501',
      detail = 'The uploader can no longer add media at this venue.';
  end if;

  if p_content_sha256 is not null then
    select d.id into v_duplicate
    from public.media_assets d
    where d.venue_id = v_asset.venue_id
      and d.content_sha256 = p_content_sha256
      and d.id <> v_asset.id
      and d.deleted_at is null
      and d.upload_state = 'ready'
    order by d.created_at, d.id
    limit 1;
  end if;

  update public.media_assets a
  set content_sha256 = coalesce(a.content_sha256, p_content_sha256),
      duplicate_of_asset_id = coalesce(a.duplicate_of_asset_id, v_duplicate)
  where a.id = p_asset_id;

  -- A time a person already supplied is kept over the file's own.
  if p_captured_at is not null and v_asset.captured_at_source = 'unknown' then
    update public.media_assets a
    set captured_at = p_captured_at,
        captured_at_source = 'metadata'
    where a.id = p_asset_id;
  end if;

  return query
    select c.became_ready, c.labels_state, c.labels_code, c.labels_revision,
      c.labels_has_labels, v_duplicate
    from private.complete_media_finalise_core(
      p_asset_id, p_validated_mime_type, p_size_bytes, p_width, p_height,
      p_duration_seconds, p_preview_path, p_thumbnail_path
    ) c;
end;
$$;

revoke all on function public.complete_media_finalise(uuid, text, bigint, integer, integer, numeric, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_media_finalise(uuid, text, bigint, integer, integer, numeric, text, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Captured time correction
-- ---------------------------------------------------------------------------

-- Record when a photo or video was really taken ('supplied'), or clear it
-- (null: unknown). Allowed for the uploader (active, own live asset) and for
-- whoever manages the asset's venue (its manager or an admin). Never the
-- upload time. Returns the stored value and source.
create function public.set_media_captured_at(
  p_asset_id uuid,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_asset_id is null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if p_captured_at is not null
     and (p_captured_at > now() + interval '1 day'
          or p_captured_at < timestamptz '1990-01-01 00:00:00+00') then
    raise exception 'invalid_captured_at' using errcode = '22023';
  end if;

  select a.* into v_asset
  from public.media_assets a
  where a.id = p_asset_id and a.deleted_at is null
  for update;
  if not found
     or not (v_asset.uploader_id = v_uid or private.can_manage_venue(v_asset.venue_id)) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  update public.media_assets a
  set captured_at = p_captured_at,
      captured_at_source = coalesce((select 'supplied'::text where p_captured_at is not null), 'unknown'),
      captured_at_set_by = v_uid
  where a.id = p_asset_id
  returning a.* into v_asset;

  return jsonb_build_object(
    'assetId', v_asset.id,
    'capturedAt', v_asset.captured_at,
    'capturedAtSource', v_asset.captured_at_source
  );
end;
$$;

revoke all on function public.set_media_captured_at(uuid, timestamptz) from public, anon;
grant execute on function public.set_media_captured_at(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Duplicates earn no contribution credit (AC21)
-- ---------------------------------------------------------------------------

-- The current body (20261116170000, or whichever later migration last
-- replaced it) keeps working as the base; credit is read through it with
-- exact duplicates left out. Every caller (coverage_staff_progress,
-- month_photo_states, completion targets) reads this name.
alter function private.monthly_credit_items(date) rename to monthly_credit_items_base;

create function private.monthly_credit_items(p_month date)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  decided_at timestamptz,
  evidence_removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.author_id, c.venue_id, c.asset_id, c.decided_at, c.evidence_removed
  from private.monthly_credit_items_base(p_month) c
  join public.media_assets a on a.id = c.asset_id
  where a.duplicate_of_asset_id is null;
$$;

-- Privileges as the earlier body had them (the rename keeps the base's).
