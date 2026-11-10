-- B02-c repair: a manager account's reservation retry stays inside its
-- current upload scope (docs/knowledge/b02-design.md W3, §7.2a and the §9
-- "B02-c reservation replay repair" entry).
--
-- 20261110090145 admitted manager accounts to reserve_media_asset but kept
-- the earlier order: a retry with a known client_upload_key returned the
-- caller's existing reservation before the upload venue was resolved. For a
-- manager account that replayed its staff-era reservation, a reservation made
-- before a revoke, or one made at a venue it no longer manages, returning its
-- id, original path, venue and state. Storage, finalise and labels already
-- refused those rows; the receipt itself was the gap.
--
-- Changed here, for a manager account only, in both the ordinary lookup and
-- the unique-violation retry:
-- * its upload venue (private.manager_upload_venue_id, its effective grant
--   venue) is resolved before any reuse; none is venue_unavailable / P0001;
-- * a reusable row must be its own with uploader_role = 'manager' and the
--   current upload venue; any other row is media_asset_not_found / P0002,
--   before any reservation detail is returned.
--
-- Unchanged: the signature, return shape, grants, purpose and key validation,
-- type and size limits, the 20-open-upload cap, same-key idempotency, the
-- recorded uploader_role, and the staff contract (a staff retry, including
-- staff holding a legacy grant, returns its original reservation whatever its
-- venue is now). Storage, finalise, label, community, credit and deletion
-- rules are not touched.
--
-- Rollback: a forward migration restoring the 20261110090145 body.

create or replace function public.reserve_media_asset(
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint default null,
  p_client_upload_key text default null,
  p_purpose text default 'general'
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
  v_max_bytes bigint;
  c_max_open constant integer := 20;
  c_max_image_bytes constant bigint := 20 * 1024 * 1024;
  c_max_video_bytes constant bigint := 200 * 1024 * 1024;
begin
  if v_uid is null or not (private.is_active_staff() or v_manager) then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  if p_client_upload_key is null or p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
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

  -- A staff retry returns the original reservation, whatever the caller's venue
  -- is now: the venue snapshot belongs to the first reservation. A manager
  -- account's retry returns only its manager-era reservation at its current
  -- upload venue.
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
      client_upload_key, purpose, uploader_role
    )
    values (
      v_id, v_uid, v_venue, v_path,
      left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
      p_media_type, p_size_bytes, p_client_upload_key, p_purpose,
      (select p.role from public.profiles p where p.id = v_uid)
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

-- create or replace keeps the privileges; restated as in 20261110090145.
revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text) to authenticated, service_role;
