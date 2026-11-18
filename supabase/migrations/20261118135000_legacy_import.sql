-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-IMPORT: legacy import (FA-54; spec §20 steps 3-5 and 7;
-- AC21). An admin-run script (`pnpm import:legacy`, scripts/import/) reads a
-- folder and a CSV manifest and imports each file through these functions,
-- with the service role only.
--
--   Provenance  media_assets.provenance: 'upload' (every existing and app
--               upload) or 'legacy_import'; media_assets.import_batch_id
--               names the batch. Both are fixed at creation.
--   Batch       public.media_import_batches: one row per manifest, keyed by
--               the manifest's SHA-256, so re-running the same manifest finds
--               the same batch (idempotent).
--   Items       public.media_import_items: one row per manifest line that was
--               imported or skipped as an exact duplicate (same SHA-256 as a
--               live, ready asset at the same venue, FA-35). A duplicate row
--               keeps its own contributor, legacy label and folder next to the
--               asset it duplicates, so both attributions survive. A failed
--               line has no row and is tried again on the next run.
--   Reserve     public.legacy_import_reserve: the asset row ('uploading',
--               legacy_import), at a key the script already stored. The
--               storage write guard only checks keys a reservation owns, so
--               the script stores the original first and reserves second.
--   Complete    public.legacy_import_complete: under the asset lock, rechecks
--               the duplicate rule, stores hash and capture time (manifest:
--               'supplied'; file metadata: 'metadata'; else unknown, never
--               invented), runs finalise's core (ready), stages the matched
--               label and records the item, in one transaction. No review
--               decision is ever written: an import is always awaiting review
--               (spec §20 step 4), whatever its legacy folder says.
--   Labels      A legacy label that matched exactly one current dish, place
--               or amenity (matched by the script) is staged as a staff-style
--               label: a dish through private.save_media_labels_as, a place as
--               a media_area_labels row, an amenity as the item's staged
--               check (read by private.amenity_photo_rows, 20261118135100).
--               Otherwise the photo stays unlabelled and the legacy label is
--               kept as its note.
--
-- Every function here is security definer with an empty search_path and
-- execute for service_role only: the import is an owner/admin operation run
-- from the command line, never from the browser. The tables have RLS on and
-- admins may read them.
--
-- Rollback: a forward migration dropping the functions and tables and the
-- two columns (imported assets stay as ordinary uploads).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.media_import_batches (
  id uuid primary key default gen_random_uuid(),
  manifest_sha256 text not null
    constraint media_import_batches_manifest_format check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  label text not null check (length(label) between 1 and 120 and label = btrim(label)),
  source_folder text check (source_folder is null or length(source_folder) between 1 and 500),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  last_run_at timestamptz not null default now(),
  constraint media_import_batches_manifest_key unique (manifest_sha256)
);

comment on table public.media_import_batches is
  'FA-54: one legacy import manifest. The same manifest (same SHA-256) is always the same batch.';

create table public.media_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.media_import_batches (id) on delete restrict,
  line_no integer not null check (line_no >= 1),
  file_path text not null check (length(file_path) between 1 and 1000),
  venue_id uuid not null references public.venues (id) on delete restrict,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  contributor_email text check (contributor_email is null or length(contributor_email) between 3 and 320),
  contributor_id uuid references public.profiles (id) on delete restrict,
  manifest_captured_at timestamptz,
  legacy_label text check (legacy_label is null or length(legacy_label) between 1 and 200),
  legacy_folder text check (legacy_folder is null or length(legacy_folder) between 1 and 500),
  outcome text not null check (outcome in ('imported', 'duplicate')),
  -- imported: the new asset; duplicate: the earlier asset with the same bytes.
  asset_id uuid not null,
  staged_kind text check (staged_kind in ('dish', 'place', 'amenity')),
  staged_id uuid,
  created_at timestamptz not null default now(),
  constraint media_import_items_line_key unique (batch_id, line_no),
  constraint media_import_items_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_import_items_staged_pair check ((staged_kind is null) = (staged_id is null)),
  constraint media_import_items_staged_imported check (staged_kind is null or outcome = 'imported')
);

create index media_import_items_asset_idx on public.media_import_items (asset_id);
create index media_import_items_staged_idx on public.media_import_items (staged_id) where staged_kind = 'amenity';

comment on table public.media_import_items is
  'FA-54: one imported or duplicate-skipped manifest line, with its legacy attribution. Failed lines are not recorded and are retried.';

alter table public.media_import_batches enable row level security;
alter table public.media_import_items enable row level security;

create policy media_import_batches_admin_read on public.media_import_batches
  for select to authenticated using ((select private.is_active_admin()));
create policy media_import_items_admin_read on public.media_import_items
  for select to authenticated using ((select private.is_active_admin()));

revoke all on public.media_import_batches from anon;
revoke all on public.media_import_items from anon;
revoke insert, update, delete, truncate on public.media_import_batches from authenticated;
revoke insert, update, delete, truncate on public.media_import_items from authenticated;

-- ---------------------------------------------------------------------------
-- Asset provenance
-- ---------------------------------------------------------------------------

alter table public.media_assets
  add column provenance text not null default 'upload'
    constraint media_assets_provenance_check check (provenance in ('upload', 'legacy_import')),
  add column import_batch_id uuid
    constraint media_assets_import_batch_fkey references public.media_import_batches (id) on delete restrict,
  add constraint media_assets_import_batch_pair
    check ((provenance = 'legacy_import') = (import_batch_id is not null));

create index media_assets_import_batch_idx on public.media_assets (import_batch_id)
  where import_batch_id is not null;

comment on column public.media_assets.provenance is
  'FA-54: upload (the app) or legacy_import (pnpm import:legacy). Fixed at creation.';

-- Provenance and batch never change once the row exists.
create function private.guard_media_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provenance is distinct from old.provenance
     or new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'media_provenance_fixed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_media_provenance() from public, anon, authenticated, service_role;

create trigger media_assets_provenance_fixed
  before update of provenance, import_batch_id on public.media_assets
  for each row execute function private.guard_media_provenance();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The importing admin: an active admin profile, or an error.
create function private.legacy_import_admin(p_admin uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_admin is null or not exists (
    select 1 from public.profiles p where p.id = p_admin and p.active and p.role = 'admin'
  ) then
    raise exception 'import_admin_required' using errcode = '42501';
  end if;
  return p_admin;
end;
$$;

revoke all on function private.legacy_import_admin(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Context: names in the manifest -> ids (read only)
-- ---------------------------------------------------------------------------

-- Resolves the importing admin's email, the manifest's contributor emails
-- and venue ids or slugs. Unknown values are left out of the maps; emails
-- are compared case-insensitively. Never returns an email it was not given.
create function public.legacy_import_context(
  p_admin_email text,
  p_emails text[] default '{}',
  p_venues text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
begin
  select p.id into v_admin
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(p_admin_email))
    and p.active and p.role = 'admin'
  limit 1;

  return jsonb_build_object(
    'adminId', v_admin,
    'contributors', coalesce((
      select jsonb_object_agg(e.email, jsonb_build_object('id', p.id, 'role', p.role, 'active', p.active))
      from (select distinct lower(btrim(x)) as email from unnest(coalesce(p_emails, '{}')) x
            where x is not null and btrim(x) <> '') e
      join auth.users u on lower(u.email) = e.email
      join public.profiles p on p.id = u.id
    ), '{}'::jsonb),
    'venues', coalesce((
      select jsonb_object_agg(k.key, jsonb_build_object('id', v.id, 'name', v.name, 'active', v.active))
      from (select distinct btrim(x) as key from unnest(coalesce(p_venues, '{}')) x
            where x is not null and btrim(x) <> '') k
      join public.venues v
        -- Compared as text: a slug is never cast to uuid.
        on v.slug = k.key or v.id::text = lower(k.key)
    ), '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Batch
-- ---------------------------------------------------------------------------

-- The batch for this manifest: created on first use, the same row after.
create function public.legacy_import_begin(
  p_admin uuid,
  p_manifest_sha256 text,
  p_label text,
  p_source_folder text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.legacy_import_admin(p_admin);
  if p_manifest_sha256 is null or p_manifest_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_manifest_hash' using errcode = '22023';
  end if;
  insert into public.media_import_batches (manifest_sha256, label, source_folder, created_by)
  values (
    p_manifest_sha256,
    left(coalesce(nullif(btrim(p_label), ''), 'Legacy import'), 120),
    left(nullif(btrim(p_source_folder), ''), 500),
    p_admin
  )
  on conflict (manifest_sha256) do update set last_run_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Duplicate skipped (FA-35): record the line against the earlier asset
-- ---------------------------------------------------------------------------

create function public.legacy_import_record_duplicate(
  p_batch_id uuid,
  p_line_no integer,
  p_file_path text,
  p_venue_id uuid,
  p_content_sha256 text,
  p_duplicate_of uuid,
  p_contributor_email text default null,
  p_contributor_id uuid default null,
  p_captured_at timestamptz default null,
  p_legacy_label text default null,
  p_legacy_folder text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.media_assets a
    where a.id = p_duplicate_of and a.venue_id = p_venue_id
      and a.content_sha256 = p_content_sha256
      and a.deleted_at is null and a.upload_state = 'ready'
  ) then
    raise exception 'duplicate_not_found' using errcode = 'P0002';
  end if;
  insert into public.media_import_items (
    batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
    contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id
  )
  values (
    p_batch_id, p_line_no, left(p_file_path, 1000), p_venue_id, p_content_sha256,
    nullif(btrim(p_contributor_email), ''), p_contributor_id, p_captured_at,
    left(nullif(btrim(p_legacy_label), ''), 200), left(nullif(btrim(p_legacy_folder), ''), 500),
    'duplicate', p_duplicate_of
  )
  on conflict (batch_id, line_no) do nothing;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reserve
-- ---------------------------------------------------------------------------

-- The asset row for one manifest line, at the id and key the script chose
-- (derived from batch and line, so a rerun after a crash finds the same
-- row). Returns the row's state; an existing row is returned unchanged.
create function public.legacy_import_reserve(
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

-- ---------------------------------------------------------------------------
-- Complete
-- ---------------------------------------------------------------------------

-- Makes one reserved import ready and records its manifest line, or, when
-- an earlier live ready asset at the venue has the same bytes, removes the
-- reservation and records the line as a duplicate of that asset. Returns
-- outcome ('imported' or 'duplicate'), the asset the line points at, and the
-- label actually staged (null when the photo was left unlabelled).
create function public.legacy_import_complete(
  p_admin uuid,
  p_asset_id uuid,
  p_line_no integer,
  p_file_path text,
  p_validated_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_captured_source text,
  p_captured_at timestamptz default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_seconds numeric default null,
  p_preview_path text default null,
  p_thumbnail_path text default null,
  p_contributor_email text default null,
  p_contributor_id uuid default null,
  p_manifest_captured_at timestamptz default null,
  p_legacy_label text default null,
  p_legacy_folder text default null,
  p_staged_kind text default null,
  p_staged_id uuid default null
)
returns table (outcome text, asset_id uuid, staged_kind text, staged_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_asset public.media_assets;
  v_duplicate uuid;
  v_ready boolean;
  v_note text;
  v_kind text := p_staged_kind;
  v_staged uuid := p_staged_id;
  v_subject public.knowledge_subjects;
  v_label text := left(nullif(btrim(p_legacy_label), ''), 200);
begin
  perform private.legacy_import_admin(p_admin);
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_content_hash' using errcode = '22023';
  end if;
  if p_captured_source is null or p_captured_source not in ('supplied', 'metadata', 'unknown')
     or ((p_captured_source = 'unknown') <> (p_captured_at is null)) then
    raise exception 'invalid_captured_at' using errcode = '22023';
  end if;
  if (v_kind is null) <> (v_staged is null)
     or (v_kind is not null and v_kind not in ('dish', 'place', 'amenity')) then
    raise exception 'invalid_staged_label' using errcode = '22023';
  end if;

  select a.* into v_asset
  from public.media_assets a
  where a.id = p_asset_id and a.provenance = 'legacy_import' and a.deleted_at is null
  for update;
  if not found then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.upload_state = 'ready' then
    -- Already done by an earlier run: the item was recorded with it.
    return query
      select i.outcome, i.asset_id, i.staged_kind, i.staged_id
      from public.media_import_items i
      where i.batch_id = v_asset.import_batch_id and i.line_no = p_line_no;
    return;
  end if;

  -- Exact duplicate (FA-35, AC21): same venue, same bytes, live and ready.
  select d.id into v_duplicate
  from public.media_assets d
  where d.venue_id = v_asset.venue_id
    and d.content_sha256 = p_content_sha256
    and d.id <> v_asset.id
    and d.deleted_at is null
    and d.upload_state = 'ready'
  order by d.created_at, d.id
  limit 1;

  if v_duplicate is not null then
    -- The reservation never becomes ready; cleanup removes its objects.
    update public.media_assets a
    set upload_state = 'failed', deleted_at = now()
    where a.id = p_asset_id;
    insert into public.media_import_items (
      batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
      contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id
    )
    values (
      v_asset.import_batch_id, p_line_no, left(p_file_path, 1000), v_asset.venue_id,
      p_content_sha256, nullif(btrim(p_contributor_email), ''), p_contributor_id,
      p_manifest_captured_at, v_label, left(nullif(btrim(p_legacy_folder), ''), 500),
      'duplicate', v_duplicate
    )
    on conflict (batch_id, line_no) do nothing;
    return query select 'duplicate'::text, v_duplicate, null::text, null::uuid;
    return;
  end if;

  update public.media_assets a
  set upload_state = 'processing',
      content_sha256 = p_content_sha256,
      captured_at = p_captured_at,
      captured_at_source = p_captured_source,
      captured_at_set_by = (select p_admin where p_captured_source = 'supplied')
  where a.id = p_asset_id;

  select c.became_ready into v_ready
  from private.complete_media_finalise_core(
    p_asset_id, p_validated_mime_type, p_size_bytes, p_width, p_height,
    p_duration_seconds, p_preview_path, p_thumbnail_path
  ) c;
  if not coalesce(v_ready, false) then
    raise exception 'import_not_ready' using errcode = 'P0001';
  end if;

  v_note := left('Imported' || coalesce('. Legacy label: ' || v_label, ''), 280);

  -- Stage the matched label as staff would have saved it. Anything that no
  -- longer fits (dish left the menu, place retired) leaves the photo
  -- unlabelled with its legacy label as the note instead.
  begin
    if v_kind = 'dish' then
      perform private.save_media_labels_as(
        p_admin, p_asset_id, 0, array['dish'], v_note,
        jsonb_build_array(jsonb_build_object('itemId', v_staged, 'variantId', null)),
        null, private.active_menu_version_id(v_asset.venue_id));
    elsif v_kind = 'place' then
      if v_asset.media_type <> 'image' then
        raise exception 'area_label_image_only' using errcode = '22023';
      end if;
      select s.* into v_subject from public.knowledge_subjects s
      where s.id = v_staged and s.venue_id = v_asset.venue_id and s.retired_at is null;
      if not found then
        raise exception 'area_unavailable' using errcode = 'P0001';
      end if;
      insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
      values (p_asset_id, v_asset.venue_id, v_subject.id, v_subject.kind, v_subject.label, p_admin);
    elsif v_kind = 'amenity' then
      if v_asset.media_type <> 'image' or not exists (
        select 1 from public.venue_amenity_checks c
        where c.id = v_staged and c.venue_id = v_asset.venue_id and c.status = 'active'
      ) then
        raise exception 'amenity_unavailable' using errcode = 'P0001';
      end if;
    end if;
  exception when others then
    v_kind := null;
    v_staged := null;
  end;

  if v_kind is null or v_kind = 'amenity' or v_kind = 'place' then
    -- The note keeps the legacy label (spec §20 step 2: ambiguous legacy
    -- labels are identified, not guessed).
    perform private.save_media_labels_as(
      p_admin, p_asset_id,
      coalesce((select l.revision from public.media_labels l where l.asset_id = p_asset_id), 0),
      '{}', v_note, '[]'::jsonb, null, null);
  end if;

  insert into public.media_import_items (
    batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
    contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id,
    staged_kind, staged_id
  )
  values (
    v_asset.import_batch_id, p_line_no, left(p_file_path, 1000), v_asset.venue_id,
    p_content_sha256, nullif(btrim(p_contributor_email), ''), p_contributor_id,
    p_manifest_captured_at, v_label, left(nullif(btrim(p_legacy_folder), ''), 500),
    'imported', p_asset_id, v_kind, v_staged
  );

  return query select 'imported'::text, p_asset_id, v_kind, v_staged;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role only (the import script)
-- ---------------------------------------------------------------------------

revoke all on function public.legacy_import_context(text, text[], text[]) from public, anon, authenticated;
revoke all on function public.legacy_import_begin(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.legacy_import_record_duplicate(uuid, integer, text, uuid, text, uuid, text, uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.legacy_import_reserve(uuid, uuid, uuid, uuid, public.media_type, text, text, bigint) from public, anon, authenticated;
revoke all on function public.legacy_import_complete(uuid, uuid, integer, text, text, bigint, text, text, timestamptz, integer, integer, numeric, text, text, text, uuid, timestamptz, text, text, text, uuid) from public, anon, authenticated;

grant execute on function public.legacy_import_context(text, text[], text[]) to service_role;
grant execute on function public.legacy_import_begin(uuid, text, text, text) to service_role;
grant execute on function public.legacy_import_record_duplicate(uuid, integer, text, uuid, text, uuid, text, uuid, timestamptz, text, text) to service_role;
grant execute on function public.legacy_import_reserve(uuid, uuid, uuid, uuid, public.media_type, text, text, bigint) to service_role;
grant execute on function public.legacy_import_complete(uuid, uuid, integer, text, text, bigint, text, text, timestamptz, integer, integer, numeric, text, text, text, uuid, timestamptz, text, text, text, uuid) to service_role;
