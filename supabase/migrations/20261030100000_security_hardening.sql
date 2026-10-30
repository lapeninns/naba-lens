-- Security hardening from docs/reviews/wave3-review.md (findings 1, 3, 4, 5, 6).

-- ---------------------------------------------------------------------------
-- Finding 1: end users cannot read or sign storage objects directly
-- ---------------------------------------------------------------------------
-- With a SELECT policy, any signed-in user could call Storage's sign endpoint with
-- any `expiresIn` (a year-long bearer link that outlives deactivation and the
-- tombstone). Reads now go only through the app routes (/api/media/[id]/*,
-- /api/avatars/[id]): they authorise the caller and the asset first, then stream
-- the object or sign a MEDIA_LIMITS.signedUrlExpirySeconds (60 s) URL with the
-- service role. End users keep only INSERT to their reserved original key.
-- Without SELECT, end users also cannot list, download or upsert objects.

drop policy if exists nabalens_media_select on storage.objects;
drop policy if exists nabalens_avatars_select on storage.objects;

-- The read helpers no longer back any policy; keep them unreachable by end users.
revoke execute on function
  private.can_read_media_object(text),
  private.can_read_avatar_object(text)
from authenticated;

-- ---------------------------------------------------------------------------
-- Finding 4: every write of an original re-checks its reservation
-- ---------------------------------------------------------------------------
-- The INSERT policy (private.can_upload_media_object) already requires an
-- `uploading`, non-deleted reservation owned by an active staff member at an active
-- venue. Storage evaluates it when a signed upload URL is minted, but NOT when the
-- URL's token is later used (the upload runs without the user's JWT), so a token
-- minted earlier still stored bytes after the reservation was tombstoned or moved
-- to `processing`, or the user was deactivated.
--
-- This trigger runs for every write of a reserved original key, whatever the path
-- (standard upload, signed upload token, TUS completion) and whatever the role, and
-- applies the same reservation rules using the reservation's own uploader (a
-- signed-token upload carries no auth.uid()). The server never writes originals;
-- derivatives (preview/thumb) are not original keys and are written only by the
-- service role, which the INSERT policy already confines.

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
    join public.profiles p on p.id = a.uploader_id and p.active and p.role = 'staff'
    join public.venues v on v.id = a.venue_id and v.active
    where a.id = private.media_asset_id_from_key(new.name)
      and a.original_path = new.name
      and a.upload_state = 'uploading'
      and a.deleted_at is null
  ) then
    raise exception 'media_reservation_closed' using errcode = '42501',
      detail = 'The reservation for this key is no longer accepting an upload.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_media_original_write() from public, anon, authenticated;

create trigger nabalens_guard_media_original_write
  before insert or update on storage.objects
  for each row execute function private.guard_media_original_write();

-- ---------------------------------------------------------------------------
-- Finding 5: reserve_media_asset enforces its own limits
-- ---------------------------------------------------------------------------
-- The RPC stays callable by authenticated staff (it derives owner, venue, key and
-- the idempotent retry from the JWT), but it no longer trusts the route to have
-- checked the request (also upload-path review F5):
--   * a client upload key is required, so every reservation is bound to the
--     finalise that carries the same key (a NULL key disabled that check);
--   * the key extension must be on the media type's allow-list (same list as
--     lib/server/media/reserve.ts; these are formats, not tunable limits), so
--     `original.html` and the like cannot be reserved;
--   * a declared size is required, positive, and within the per-type product cap.
--     The caps mirror MEDIA_LIMITS.maxPhotoBytes / maxVideoBytes in
--     lib/config/media.ts (20 MiB / 200 MiB); tests/security/hardening.test.ts
--     reserves exactly at and one byte over each limit, so a change to one side
--     without the other fails the suite;
--   * an uploader may hold at most 20 open (uploading, processing or failed,
--     non-deleted) reservations. That is two full upload batches
--     (MEDIA_LIMITS.maxBatchFiles = 10); idempotent retries of an existing key do
--     not count. Abandoned ones are tombstoned by cleanup after 24 h, or the user
--     deletes failed ones.
-- Same signature and result as 20261029160000_media_client_upload_key.sql.

create or replace function public.reserve_media_asset(
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint default null,
  p_client_upload_key text default null
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
  v_venue uuid;
  v_id uuid := gen_random_uuid();
  v_ext text := lower(btrim(p_extension, '. '));
  v_path text;
  v_existing public.media_assets;
  v_open integer;
  v_max_bytes bigint;
  c_max_open constant integer := 20;
  c_max_image_bytes constant bigint := 20 * 1024 * 1024;
  c_max_video_bytes constant bigint := 200 * 1024 * 1024;
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  if p_client_upload_key is null or p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;

  -- A retry returns the original reservation, whatever the caller's venue is now:
  -- the venue snapshot belongs to the first reservation.
  select a.* into v_existing
  from public.media_assets a
  where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;

  if found then
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002',
        detail = 'This upload was removed.';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end if;

  v_venue := private.uploadable_venue_id();
  if v_venue is null then
    raise exception 'venue_unavailable' using errcode = 'P0001',
      detail = 'Staff must be assigned to an active venue before uploading.';
  end if;

  if p_media_type is null
     or (p_media_type = 'image' and v_ext not in ('jpg', 'png', 'webp', 'heic', 'heif'))
     or (p_media_type = 'video' and v_ext not in ('mp4', 'mov', 'webm')) then
    raise exception 'invalid_extension' using errcode = '22023';
  end if;

  -- (No CASE expression here: the Supabase CLI's statement splitter misreads it.)
  if p_media_type = 'image' then
    v_max_bytes := c_max_image_bytes;
  else
    v_max_bytes := c_max_video_bytes;
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_max_bytes then
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
      client_upload_key
    )
    values (
      v_id, v_uid, v_venue, v_path,
      left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
      p_media_type, p_size_bytes, p_client_upload_key
    );
  exception when unique_violation then
    -- A concurrent call with the same key won the race: return its reservation.
    select a.* into v_existing
    from public.media_assets a
    where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;
    if not found then
      raise;
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end;

  return query select v_id, v_path, v_venue, 'uploading'::public.upload_state, false;
end;
$$;

revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint, text) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finding 6: stale-claim takeover uses database time only
-- ---------------------------------------------------------------------------
-- finalise claims an asset by moving it to `processing`; the media_assets
-- updated_at trigger stamps the claim with the database clock. A later finalise may
-- take over a claim older than p_stale_after, measured here with now(), so the app
-- host's clock never matters. Compare-and-set: true only for the caller that reset it.

create or replace function public.take_over_stale_media_claim(
  p_asset_id uuid,
  p_stale_after interval
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_stale_after is null or p_stale_after < interval '1 minute' then
    raise exception 'stale_window_too_short' using errcode = '22023';
  end if;

  update public.media_assets a
  set upload_state = 'failed'
  where a.id = p_asset_id
    and a.upload_state = 'processing'
    and a.deleted_at is null
    and a.updated_at < now() - p_stale_after;
  return found;
end;
$$;

revoke all on function public.take_over_stale_media_claim(uuid, interval) from public, anon, authenticated;
grant execute on function public.take_over_stale_media_claim(uuid, interval) to service_role;

-- ---------------------------------------------------------------------------
-- Finding 3: cleanup reaps finalise claims that died mid-flight
-- ---------------------------------------------------------------------------
-- A finalise killed after its claim (timeout, OOM, network) leaves the row in
-- `processing`, and nothing else ever moves it on. The cleanup runner calls this
-- first: claims older than p_stale_after (database clock, from the claim's
-- updated_at stamp) become `failed`, so the uploader sees a real failure and can
-- retry (bytes kept: finalise again) or delete it. The window must comfortably
-- exceed the longest possible finalise (the route's maxDuration), so an in-flight
-- finalise is never touched; the minimum accepted is 10 minutes. Setting `failed`
-- re-stamps updated_at, so the 24 h abandoned-upload window starts afresh.
-- Returns the reaped asset IDs.

create or replace function public.fail_stale_media_processing(
  p_stale_after interval,
  p_limit integer default 1000
)
returns table (asset_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_stale_after is null or p_stale_after < interval '10 minutes' then
    raise exception 'stale_window_too_short' using errcode = '22023';
  end if;

  return query
    with stale as (
      select a.id
      from public.media_assets a
      where a.upload_state = 'processing'
        and a.deleted_at is null
        and a.updated_at < now() - p_stale_after
      order by a.updated_at, a.id
      limit greatest(1, least(coalesce(p_limit, 1000), 1000))
      for update skip locked
    )
    update public.media_assets a
    set upload_state = 'failed'
    from stale
    where a.id = stale.id
      and a.upload_state = 'processing'
    returning a.id;
end;
$$;

revoke all on function public.fail_stale_media_processing(interval, integer) from public, anon, authenticated;
grant execute on function public.fail_stale_media_processing(interval, integer) to service_role;
