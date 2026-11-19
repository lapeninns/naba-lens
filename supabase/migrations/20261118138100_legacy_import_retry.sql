-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-R3 (S5 review Y6; FA-54): a failed import line can be
-- imported again under the same manifest after the 24-hour cleanup.
--
-- A line that failed after its reservation (archive receipt, derivatives or
-- renditions) leaves an 'uploading' row. public.prepare_media_cleanup
-- tombstones such a row after 24 hours and removes its objects. The row is
-- never hard-deleted, and legacy_import_reserve returned it unchanged, so
-- every later run of the same manifest landed on the dead row and failed.
--
-- Decision (S5-R3 report): a tombstoned reservation is never revived. Its
-- objects may be mid-removal by a cleanup run, and the storage write guard
-- (private.guard_media_original_write) refuses an original written to a key
-- a closed or admin-held reservation owns. The script instead moves the line
-- to its next attempt id (importAssetId(batch, line, attempt): still derived
-- from batch and line, so reruns stay idempotent), stores the original there
-- before reserving, as on a first run.
--
--   Reserve     public.legacy_import_reserve refuses a tombstoned row of the
--               batch ('import_reservation_closed') instead of returning it
--               as reusable, so no caller finishes against a dead row. A live
--               row that is not ready yet is touched (updated_at) when it is
--               reused, so a cleanup pass cannot tombstone it while this run
--               is finishing it.
--
-- Body from 20261118135000 (the only definition). Signature unchanged.
--
-- Rollback: re-apply the 20261118135000 body.

create or replace function public.legacy_import_reserve(
  p_batch_id uuid,
  p_asset_id uuid,
  p_uploader uuid,
  p_venue_id uuid,
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint
)
returns table (id uuid, original_path text, upload_state public.upload_state, reused boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ext text := lower(btrim(p_extension, '. '));
  v_existing public.media_assets;
  v_path text;
  v_role public.app_role;
begin
  if not exists (select 1 from public.media_import_batches b where b.id = p_batch_id) then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  end if;
  if p_asset_id is null then
    raise exception 'invalid_asset' using errcode = '22023';
  end if;

  select a.* into v_existing from public.media_assets a where a.id = p_asset_id;
  if found then
    if v_existing.import_batch_id is distinct from p_batch_id then
      raise exception 'import_asset_conflict' using errcode = '23505';
    end if;
    -- S5-R3 (Y6): a tombstoned reservation (cleanup, or a duplicate found at
    -- completion) is closed; the script moves the line to its next attempt.
    if v_existing.deleted_at is not null then
      raise exception 'import_reservation_closed' using errcode = '55000';
    end if;
    -- A live reservation being finished again: keep cleanup off it.
    if v_existing.upload_state <> 'ready' then
      update public.media_assets a set updated_at = now() where a.id = v_existing.id;
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.upload_state, true;
    return;
  end if;

  select p.role into v_role from public.profiles p where p.id = p_uploader;
  if not found then
    raise exception 'import_uploader_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
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

  v_path := p_uploader::text || '/' || p_asset_id::text || '/original.' || v_ext;
  insert into public.media_assets as a (
    id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes,
    purpose, uploader_role, provenance, import_batch_id
  )
  values (
    p_asset_id, p_uploader, p_venue_id, v_path,
    left(coalesce(nullif(btrim(p_original_filename), ''), 'import.' || v_ext), 255),
    p_media_type, p_size_bytes, 'general', v_role, 'legacy_import', p_batch_id
  );
  return query select p_asset_id, v_path, 'uploading'::public.upload_state, false;
end;
$$;

revoke all on function public.legacy_import_reserve(uuid, uuid, uuid, uuid, public.media_type, text, text, bigint) from public, anon, authenticated;
grant execute on function public.legacy_import_reserve(uuid, uuid, uuid, uuid, public.media_type, text, text, bigint) to service_role;
