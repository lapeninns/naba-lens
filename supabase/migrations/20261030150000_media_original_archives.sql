-- Durable receipts for indefinitely retained, validated media originals.
-- Byte copies and immutable recovery manifests live in a separate private R2
-- bucket. Ordinary users cannot read the archive or these service-only tables.
create table public.media_archive_receipts (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.media_assets(id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 209715200),
  mime_type text not null check (length(mime_type) between 1 and 100),
  source_project_ref text not null check (source_project_ref ~ '^[a-z0-9]{20}$'),
  source_key text not null,
  blob_key text not null,
  manifest_key text not null unique,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 16384),
  archived_at timestamptz not null default now(),
  unique (asset_id, sha256, manifest_sha256)
);
create index media_archive_receipts_asset_idx on public.media_archive_receipts(asset_id);
alter table public.media_archive_receipts enable row level security;
revoke all on public.media_archive_receipts from public, anon, authenticated, service_role;
grant select, insert on public.media_archive_receipts to service_role;
revoke all on sequence public.media_archive_receipts_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.media_archive_receipts_id_seq to service_role;

create function private.media_archive_receipt_guard()
returns trigger language plpgsql set search_path = '' as $$
declare a public.media_assets;
begin
  select * into a from public.media_assets where id = new.asset_id;
  if not found or a.upload_state not in ('processing', 'ready')
     or new.source_key is distinct from a.original_path
     or (a.upload_state = 'ready' and
         (new.size_bytes is distinct from a.size_bytes or new.mime_type is distinct from a.validated_mime_type))
     or new.blob_key is distinct from new.source_project_ref || '/blobs/sha256/' || substr(new.sha256,1,2) || '/' || new.sha256
     or new.manifest_key is distinct from new.source_project_ref || '/manifests/' || a.id::text || '/' || new.sha256 || '/' || new.manifest_sha256 || '.json'
     or new.manifest->>'format' is distinct from 'nabalens-original-archive@1'
     or new.manifest->>'sourceProjectRef' is distinct from new.source_project_ref
     or new.manifest->>'sourceBucket' is distinct from 'media'
     or new.manifest->>'assetId' is distinct from a.id::text
     or new.manifest->>'uploaderId' is distinct from a.uploader_id::text
     or new.manifest->>'venueId' is distinct from a.venue_id::text
     or new.manifest->>'originalPath' is distinct from a.original_path
     or new.manifest->>'originalFilename' is distinct from a.original_filename
     or new.manifest->>'mediaType' is distinct from a.media_type::text
     or new.manifest->>'mimeType' is distinct from new.mime_type
     or new.manifest->>'sizeBytes' is distinct from new.size_bytes::text
     or new.manifest->>'sha256' is distinct from new.sha256
     or new.manifest->>'blobKey' is distinct from new.blob_key then
    raise exception 'invalid_media_archive_receipt' using errcode = '22023';
  end if;
  new.archived_at := now();
  return new;
end;
$$;
create trigger media_archive_receipt_insert_guard before insert on public.media_archive_receipts
  for each row execute function private.media_archive_receipt_guard();
create trigger media_archive_receipts_append_only before update or delete on public.media_archive_receipts
  for each row execute function private.append_only_guard();
create trigger media_archive_receipts_no_truncate before truncate on public.media_archive_receipts
  for each statement execute function private.append_only_guard();
revoke all on function private.media_archive_receipt_guard() from public, anon, authenticated;

create table public.media_archive_audit_state (
  name text primary key check (name = 'originals'),
  cursor_id bigint not null default 0 check (cursor_id >= 0),
  last_run_at timestamptz,
  last_complete_at timestamptz,
  last_error text check (last_error is null or last_error in ('archive_audit_failed'))
);
alter table public.media_archive_audit_state enable row level security;
revoke all on public.media_archive_audit_state from public, anon, authenticated;
grant select, insert, update on public.media_archive_audit_state to service_role;
insert into public.media_archive_audit_state(name) values ('originals');

create function public.media_archive_backfill_candidates(p_limit integer default 10)
returns table(asset_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return query select a.id from public.media_assets a
  where a.upload_state = 'ready'
    and not exists (select 1 from public.media_archive_receipts r where r.asset_id = a.id)
  order by a.created_at, a.id limit greatest(1, least(coalesce(p_limit,10),50));
end;
$$;
create function public.media_archive_missing_count()
returns bigint language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return (select count(*) from public.media_assets a
  where a.upload_state = 'ready'
    and not exists (select 1 from public.media_archive_receipts r where r.asset_id = a.id));
end;
$$;
revoke all on function public.media_archive_backfill_candidates(integer), public.media_archive_missing_count()
  from public, anon, authenticated;
grant execute on function public.media_archive_backfill_candidates(integer), public.media_archive_missing_count()
  to service_role;
