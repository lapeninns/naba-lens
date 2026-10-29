-- Idempotent upload reservations (spec v0.2 §5: "Retry the same asset ID safely so
-- network retries do not create duplicate gallery records").
-- Contract amendment (docs/fanout/CONTRACT.md): the only column beyond spec §6.
--
-- The browser sends one idempotency key per file and reuses it on every retry.
-- reserve_media_asset stores it with the reservation and, for a repeated key from the
-- same uploader, returns the existing asset instead of inserting a second row. The key
-- is scoped to the uploader, so one person's key can never address another's asset.

alter table public.media_assets
  add column client_upload_key text
    check (client_upload_key is null or client_upload_key ~ '^[A-Za-z0-9_-]{8,128}$');

comment on column public.media_assets.client_upload_key is
  'Browser idempotency key for the reservation, unique per uploader. Not trusted for anything else.';

create unique index media_assets_uploader_client_key_idx
  on public.media_assets (uploader_id, client_upload_key)
  where client_upload_key is not null;

-- The key is fixed at reservation, like the owner and object key.
create or replace function private.media_assets_key_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_upload_key is distinct from old.client_upload_key then
    raise exception 'media_asset_reservation_immutable' using errcode = '42501',
      detail = 'The client upload key is fixed at reservation.';
  end if;
  return new;
end;
$$;

revoke all on function private.media_assets_key_guard() from public, anon;
grant execute on function private.media_assets_key_guard() to authenticated, service_role;

create trigger media_assets_key_guard
  before update on public.media_assets
  for each row execute function private.media_assets_key_guard();

-- Replace the four-argument function: one more (optional) parameter and two more
-- result columns. Callers that omit p_client_upload_key keep the old behaviour.
drop function public.reserve_media_asset(public.media_type, text, text, bigint);

create function public.reserve_media_asset(
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
  -- True when an earlier call with the same key already reserved this asset.
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
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  if p_client_upload_key is not null and p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;

  -- A retry returns the original reservation, whatever the caller's venue is now:
  -- the venue snapshot belongs to the first reservation.
  if p_client_upload_key is not null then
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
