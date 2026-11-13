-- B05-m6: internal evidence documents (contracts/b05-design.md §2A, tasks
-- B05-02h to B05-02k). Needed before B04-c, whose menu_allergen_evidence
-- references (id, venue_id) here.
--
-- * public.evidence_documents: PDF evidence (purpose menu_allergen_evidence),
--   kept apart from media_assets so a document can never be granted,
--   derived, grouped, searched, archived or shown in Photos: every one of
--   those tables has a foreign key to media_assets.
-- * A private `documents` bucket (10 MiB, application/pdf). The only client
--   storage policy is the insert of a reserved key by its uploader; reads go
--   through the download route with the service role.
-- * Document holders (OD-B5-17 default): an active admin, the venue's
--   effective manager, or the venue's named allergen authority. B04-c
--   supplies the authority by re-creating private.evidence_document_authority,
--   which is false here (no authority until OD-B4-7). Staff have no access.
-- * Functions: evidence_document_reserve, evidence_document_finalise_target,
--   evidence_document_meta, evidence_document_download_target,
--   evidence_document_delete (callers); evidence_document_complete,
--   evidence_document_fail and prepare_document_cleanup (service role).
-- * A referenced document cannot be deleted or cleaned up. References are
--   read from B04's menu_allergen_evidence once it exists; an unknown shape
--   fails closed.
-- * Nothing existing is re-created; no credit input is touched.
--
-- Rollback: the app's evidenceDocuments switch hides upload. Documents stay
-- readable to their holders and statements keep their references.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.evidence_documents (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploader_role public.app_role not null,
  purpose text not null check (purpose in ('menu_allergen_evidence')),
  object_path text not null unique,
  original_filename text not null check (length(original_filename) between 1 and 255),
  declared_size_bytes bigint not null check (declared_size_bytes between 1 and 10485760),
  validated_mime_type text check (validated_mime_type in ('application/pdf')),
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  upload_state text not null default 'uploading' check (upload_state in ('uploading', 'ready', 'failed')),
  client_upload_key text not null check (client_upload_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint evidence_documents_upload_key unique (uploaded_by, client_upload_key),
  constraint evidence_documents_id_venue_key unique (id, venue_id),
  constraint evidence_documents_path check (object_path ~ ('^' || venue_id::text || '/' || id::text || '/document\.pdf$')),
  constraint evidence_documents_ready check (
    upload_state <> 'ready' or (validated_mime_type is not null and size_bytes is not null and sha256 is not null))
);
create index evidence_documents_venue_idx on public.evidence_documents (venue_id, created_at desc) where deleted_at is null;
create index evidence_documents_abandoned_idx on public.evidence_documents (updated_at)
  where deleted_at is null and upload_state in ('uploading', 'failed');

comment on table public.evidence_documents is
  'Internal PDF evidence (B05-m6). Never a media asset: cannot be granted, derived, grouped, searched or archived. Functions only.';

-- Reservation facts are fixed; a ready document's content is fixed; a
-- tombstone is never cleared.
create function private.evidence_documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'row_immutable' using errcode = '42501', detail = 'Documents are tombstoned, never deleted.';
  end if;
  if new.id is distinct from old.id or new.venue_id is distinct from old.venue_id
     or new.uploaded_by is distinct from old.uploaded_by or new.uploader_role is distinct from old.uploader_role
     or new.purpose is distinct from old.purpose or new.object_path is distinct from old.object_path
     or new.original_filename is distinct from old.original_filename
     or new.declared_size_bytes is distinct from old.declared_size_bytes
     or new.client_upload_key is distinct from old.client_upload_key
     or new.created_at is distinct from old.created_at then
    raise exception 'document_reservation_immutable' using errcode = '42501';
  end if;
  if old.upload_state = 'ready' and (new.upload_state is distinct from old.upload_state
     or new.sha256 is distinct from old.sha256 or new.size_bytes is distinct from old.size_bytes
     or new.validated_mime_type is distinct from old.validated_mime_type) then
    raise exception 'document_ready_immutable' using errcode = '42501';
  end if;
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'document_ready_immutable' using errcode = '42501', detail = 'A tombstone is permanent.';
  end if;
  return new;
end;
$$;

create trigger evidence_documents_guard
  before update or delete on public.evidence_documents
  for each row execute function private.evidence_documents_guard();
create trigger evidence_documents_no_truncate
  before truncate on public.evidence_documents
  for each statement execute function private.append_only_guard();
create trigger evidence_documents_set_updated_at
  before update on public.evidence_documents
  for each row execute function private.set_updated_at();

revoke all on public.evidence_documents from public, anon, authenticated, service_role;
grant select on public.evidence_documents to service_role;
alter table public.evidence_documents enable row level security;
revoke all on function private.evidence_documents_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bucket and storage policy
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Holders and references
-- ---------------------------------------------------------------------------

-- The venue's named allergen authority (OD-B4-7). B04-c re-creates this with
-- its authority rule; until then nobody holds it.
create function private.evidence_document_authority(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false and p_venue_id is not null;
$$;

-- A document holder at the venue (OD-B5-17 default).
create function private.evidence_document_holder(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and (
    private.is_active_admin()
    or coalesce(private.effective_manager_venue_id((select auth.uid())) = p_venue_id, false)
    or private.evidence_document_authority(p_venue_id)
  );
$$;

-- How many B04 evidence rows refer to the document. Zero before B04-c. If
-- the table exists with an unexpected shape this raises, so deletion and
-- cleanup fail closed.
create function private.evidence_document_reference_count(p_document_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_column text;
  v_count bigint;
begin
  if to_regclass('public.menu_allergen_evidence') is null then
    return 0;
  end if;
  select c.column_name into v_column from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'menu_allergen_evidence'
    and c.column_name in ('document_id', 'document_ref')
  order by c.column_name = 'document_id' desc
  limit 1;
  if v_column is null then
    raise exception 'document_reference_unknown' using errcode = 'P0001';
  end if;
  execute format('select count(*) from public.menu_allergen_evidence where %I = $1', v_column)
    into v_count using p_document_id;
  return v_count;
end;
$$;

create function private.can_upload_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_documents d
    join public.venues v on v.id = d.venue_id and v.active
    where d.object_path = p_name
      and d.uploaded_by = (select auth.uid())
      and d.upload_state = 'uploading'
      and d.deleted_at is null
      and private.evidence_document_holder(d.venue_id)
  );
$$;

create policy documents_insert_reserved on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (select private.can_upload_document_object(name)));

-- ---------------------------------------------------------------------------
-- Commands and reads (callers)
-- ---------------------------------------------------------------------------

-- Reserves an upload. Idempotent by the caller's key; the same key with
-- another venue, purpose, filename or size is idempotency_key_reused. At most
-- five open reservations per person.
create function public.evidence_document_reserve(
  p_key text, p_venue_id uuid, p_purpose text, p_filename text, p_size bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_doc public.evidence_documents;
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_filename, ''));
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;
  if p_venue_id is null or not private.evidence_document_holder(p_venue_id) then
    raise exception 'not_document_holder' using errcode = '42501';
  end if;
  if p_purpose is distinct from 'menu_allergen_evidence' then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 255 then
    raise exception 'invalid_filename' using errcode = '22023';
  end if;
  if p_size is null or p_size not between 1 and 10485760 then
    raise exception 'invalid_size' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_evidence_document:' || v_uid::text, 0));
  select d.* into v_doc from public.evidence_documents d
  where d.uploaded_by = v_uid and d.client_upload_key = p_key;
  if found then
    if v_doc.venue_id <> p_venue_id or v_doc.purpose <> p_purpose
       or v_doc.original_filename <> v_name or v_doc.declared_size_bytes <> p_size then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
    if v_doc.deleted_at is not null then
      raise exception 'document_not_found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('documentId', v_doc.id, 'objectPath', v_doc.object_path,
      'state', v_doc.upload_state, 'replayed', true);
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_inactive' using errcode = '42501';
  end if;
  if (select count(*) from public.evidence_documents d
      where d.uploaded_by = v_uid and d.upload_state = 'uploading' and d.deleted_at is null) >= 5 then
    raise exception 'too_many_open_uploads' using errcode = 'P0001';
  end if;
  insert into public.evidence_documents (id, venue_id, uploaded_by, uploader_role, purpose, object_path,
    original_filename, declared_size_bytes, client_upload_key)
  select v_id, p_venue_id, v_uid, p.role, p_purpose,
    p_venue_id::text || '/' || v_id::text || '/document.pdf', v_name, p_size, p_key
  from public.profiles p where p.id = v_uid
  returning * into v_doc;
  return jsonb_build_object('documentId', v_doc.id, 'objectPath', v_doc.object_path,
    'state', v_doc.upload_state, 'replayed', false);
end;
$$;

-- What the finalise route may validate: the caller's own, unfinished,
-- live document while they still hold the venue. Otherwise not found.
create function public.evidence_document_finalise_target(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_doc public.evidence_documents;
begin
  select d.* into v_doc from public.evidence_documents d where d.id = p_id;
  if not found or v_doc.uploaded_by <> v_uid or v_doc.deleted_at is not null
     or not private.evidence_document_holder(v_doc.venue_id) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('documentId', v_doc.id, 'objectPath', v_doc.object_path,
    'state', v_doc.upload_state, 'declaredSizeBytes', v_doc.declared_size_bytes);
end;
$$;

-- Metadata for up to 100 documents at venues the caller holds. The original
-- filename goes only to the uploader, admins and the venue's authority. No
-- object path is ever returned.
create function public.evidence_document_meta(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  if p_ids is null or cardinality(p_ids) > 100 then
    raise exception 'invalid_document_ids' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'documentId', d.id,
        'venueId', d.venue_id,
        'purpose', d.purpose,
        'uploadedAt', d.created_at,
        'uploaderFirstName', split_part(btrim(p.display_name), ' ', 1),
        'sizeBytes', d.size_bytes,
        'state', d.upload_state,
        'referencedBy', private.evidence_document_reference_count(d.id),
        'filename', case when d.uploaded_by = v_uid or private.is_active_admin()
          or private.evidence_document_authority(d.venue_id) then d.original_filename end)
        order by d.created_at, d.id)
    from public.evidence_documents d
    join public.profiles p on p.id = d.uploaded_by
    where d.id = any(p_ids) and d.deleted_at is null
      and private.evidence_document_holder(d.venue_id)), '[]'::jsonb);
end;
$$;

-- The object to stream for a ready, live document at a venue the caller
-- holds. Otherwise not found.
create function public.evidence_document_download_target(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc public.evidence_documents;
begin
  perform private.amenity_assert_active_user();
  select d.* into v_doc from public.evidence_documents d where d.id = p_id;
  if not found or v_doc.deleted_at is not null or v_doc.upload_state <> 'ready'
     or not private.evidence_document_holder(v_doc.venue_id) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('documentId', v_doc.id, 'objectPath', v_doc.object_path,
    'sizeBytes', v_doc.size_bytes, 'sha256', v_doc.sha256);
end;
$$;

-- Tombstones an unreferenced document (the uploader while a holder, or an
-- admin). A referenced one is document_referenced. Cleanup removes the
-- object. Repeating it is a no-op.
create function public.evidence_document_delete(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_doc public.evidence_documents;
begin
  select d.* into v_doc from public.evidence_documents d where d.id = p_id for update;
  if not found or not (private.is_active_admin()
     or (v_doc.uploaded_by = v_uid and private.evidence_document_holder(v_doc.venue_id))) then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_doc.deleted_at is not null then
    return jsonb_build_object('documentId', v_doc.id, 'deleted', false);
  end if;
  if private.evidence_document_reference_count(v_doc.id) > 0 then
    raise exception 'document_referenced' using errcode = 'P0001';
  end if;
  update public.evidence_documents set deleted_at = now() where id = v_doc.id;
  return jsonb_build_object('documentId', v_doc.id, 'deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service role (finalise route, cleanup)
-- ---------------------------------------------------------------------------

create function public.evidence_document_complete(p_id uuid, p_size bigint, p_sha256 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc public.evidence_documents;
begin
  select d.* into v_doc from public.evidence_documents d where d.id = p_id for update;
  if not found or v_doc.deleted_at is not null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_doc.upload_state = 'ready' then
    if v_doc.sha256 is distinct from p_sha256 or v_doc.size_bytes is distinct from p_size then
      raise exception 'document_ready_immutable' using errcode = '42501';
    end if;
    return jsonb_build_object('documentId', v_doc.id, 'state', 'ready', 'replayed', true);
  end if;
  update public.evidence_documents
  set upload_state = 'ready', validated_mime_type = 'application/pdf', size_bytes = p_size, sha256 = p_sha256
  where id = v_doc.id;
  return jsonb_build_object('documentId', v_doc.id, 'state', 'ready', 'replayed', false);
end;
$$;

create function public.evidence_document_fail(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc public.evidence_documents;
begin
  select d.* into v_doc from public.evidence_documents d where d.id = p_id for update;
  if not found or v_doc.deleted_at is not null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_doc.upload_state = 'uploading' then
    update public.evidence_documents set upload_state = 'failed' where id = v_doc.id;
  end if;
  return jsonb_build_object('documentId', v_doc.id,
    'state', case when v_doc.upload_state = 'uploading' then 'failed' else v_doc.upload_state end);
end;
$$;

-- Tombstones uploading or failed documents untouched for the window (never
-- a referenced one), then lists tombstoned documents whose object remains.
create function public.prepare_document_cleanup(
  p_abandoned_after interval,
  p_limit integer default 100,
  p_now timestamptz default now(),
  p_exclude_ids uuid[] default '{}'::uuid[]
)
returns table (document_id uuid, object_names text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cutoff timestamptz;
begin
  if p_abandoned_after is null or p_abandoned_after < interval '1 hour' then
    raise exception 'abandoned_window_too_short' using errcode = '22023';
  end if;
  if p_now is null then
    raise exception 'invalid_now' using errcode = '22023';
  end if;
  v_cutoff := p_now - p_abandoned_after;
  update public.evidence_documents d
  set deleted_at = now()
  where d.deleted_at is null
    and d.upload_state in ('uploading', 'failed')
    and d.updated_at < v_cutoff
    and private.evidence_document_reference_count(d.id) = 0
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'documents' and o.name = d.object_path
        and greatest(o.created_at, o.updated_at) >= v_cutoff);
  return query
    select d.id, array_agg(o.name order by o.name)
    from public.evidence_documents d
    join storage.objects o on o.bucket_id = 'documents' and o.name = d.object_path
    where d.deleted_at is not null
      and private.evidence_document_reference_count(d.id) = 0
      and not (d.id = any(coalesce(p_exclude_ids, '{}'::uuid[])))
    group by d.id
    order by min(d.deleted_at), d.id
    limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.evidence_document_authority(uuid),
  private.evidence_document_holder(uuid),
  private.evidence_document_reference_count(uuid)
from public, anon, authenticated, service_role;
-- The storage insert policy evaluates this as the uploading user.
revoke all on function private.can_upload_document_object(text) from public, anon, service_role;
grant execute on function private.can_upload_document_object(text) to authenticated;

revoke all on function
  public.evidence_document_reserve(text, uuid, text, text, bigint),
  public.evidence_document_finalise_target(uuid),
  public.evidence_document_meta(uuid[]),
  public.evidence_document_download_target(uuid),
  public.evidence_document_delete(uuid)
from public, anon, service_role;
grant execute on function
  public.evidence_document_reserve(text, uuid, text, text, bigint),
  public.evidence_document_finalise_target(uuid),
  public.evidence_document_meta(uuid[]),
  public.evidence_document_download_target(uuid),
  public.evidence_document_delete(uuid)
to authenticated;

revoke all on function
  public.evidence_document_complete(uuid, bigint, text),
  public.evidence_document_fail(uuid),
  public.prepare_document_cleanup(interval, integer, timestamptz, uuid[])
from public, anon, authenticated;
grant execute on function
  public.evidence_document_complete(uuid, bigint, text),
  public.evidence_document_fail(uuid),
  public.prepare_document_cleanup(interval, integer, timestamptz, uuid[])
to service_role;
