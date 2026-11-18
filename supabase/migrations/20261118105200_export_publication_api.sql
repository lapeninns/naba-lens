-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- S1-EXPORT: the commands and reads over 20261118105000 (export packages) and
-- 20261118105100 (publication records). Every function is security definer
-- with an empty search_path, executable by authenticated only, and checks the
-- caller itself:
--
--   export_profiles             active admins and venue managers
--   export_profile_set          admins
--   export_candidates           the venue's manager (public) or an admin
--   export_package_create       the same, per item's venue; internal: admins
--   export_package_download_start / _finish / export_package_rebuild
--                               anyone who may open the package now
--   export_packages_list, export_package_detail, export_asset_status
--                               the same (managers: their venue's packages)
--   publication_destination_save, publication_record
--                               admins (§3.3: only admins publish externally)
--   publication_overview        admins (any venue) and the venue's manager
--
-- Errors: export_not_allowed / publication_not_allowed (42501) for a caller
-- without access; *_not_found (P0002) for an unknown or unreadable record;
-- 22023 for invalid input; stale_revision (40001) for a lost edit.
--
-- Rollback: revoke execute on the public functions below.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create function private.export_profile_json(p public.export_profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('key', p.key, 'label', p.label, 'format', p.format,
    'maxWidth', p.max_width, 'maxHeight', p.max_height, 'quality', p.quality,
    'revision', p.revision, 'updatedAt', p.updated_at);
$$;

create function public.export_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user()
     or not (private.is_active_admin() or private.my_manager_venue_id() is not null) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.export_profile_json(p) order by p.position)
    from public.export_profiles p
  ), '[]'::jsonb));
end;
$$;

-- Change a preset. Original keeps its format (only its label changes);
-- Website and Social need a size; Custom's size is chosen per package.
create function public.export_profile_set(
  p_key text,
  p_label text,
  p_format text,
  p_max_width integer,
  p_max_height integer,
  p_quality integer,
  p_expected_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.export_profiles;
  v_label text := btrim(coalesce(p_label, ''));
begin
  if v_uid is null or not private.is_active_admin() then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  select p.* into v_row from public.export_profiles p where p.key = p_key for update;
  if not found then
    raise exception 'export_profile_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is distinct from v_row.revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if v_row.label = v_label and v_row.format = p_format
     and v_row.max_width is not distinct from p_max_width
     and v_row.max_height is not distinct from p_max_height
     and v_row.quality is not distinct from p_quality then
    return private.export_profile_json(v_row) || jsonb_build_object('changed', false);
  end if;
  begin
    update public.export_profiles p
    set label = v_label, format = p_format, max_width = p_max_width, max_height = p_max_height,
      quality = p_quality, revision = p.revision + 1, updated_by = v_uid, updated_at = now()
    where p.key = p_key
    returning p.* into v_row;
  exception when check_violation then
    raise exception 'export_profile_invalid' using errcode = '22023';
  end;
  insert into public.export_profile_events (key, label, format, max_width, max_height, quality, revision, changed_by)
  values (v_row.key, v_row.label, v_row.format, v_row.max_width, v_row.max_height, v_row.quality, v_row.revision, v_uid);
  return private.export_profile_json(v_row) || jsonb_build_object('changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Selection
-- ---------------------------------------------------------------------------

-- What may be exported from one venue. Public mode by default: only
-- public-approved, current photos. Internal mode (admins) adds photos
-- waiting for review or asked again, each marked by its level.
create function public.export_candidates(p_venue_id uuid, p_mode text default 'public')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if p_mode is null or p_mode not in ('public', 'internal') then
    raise exception 'export_mode_invalid' using errcode = '22023';
  end if;
  if not private.export_can_use_venue(p_venue_id, p_mode) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  select v.* into v_venue from public.venues v where v.id = p_venue_id;
  if not found then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'venueId', v_venue.id, 'venueName', v_venue.name, 'mode', p_mode,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'assetId', c.asset_id, 'subjectKind', c.subject_kind, 'subjectId', c.subject_id,
          'subjectLabel', c.subject_label, 'category', c.category,
          'approvalKind', c.approval_kind, 'approvalId', c.approval_id,
          'approvalVersion', c.approval_version, 'approvalLevel', c.approval_level,
          'uploadedAt', c.uploaded_at, 'width', c.width, 'height', c.height,
          'publication', private.publication_asset_state(c.asset_id))
        order by c.category, lower(c.subject_label), c.subject_id, c.uploaded_at desc, c.asset_id)
      from private.export_candidate_rows(v_venue.id, p_mode) c
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Packages
-- ---------------------------------------------------------------------------

create function public.export_package_create(
  p_request_key text,
  p_mode text,
  p_profile_key text,
  p_items jsonb,
  p_custom_width integer default null,
  p_custom_height integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.export_profiles;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_hash text;
  v_existing public.export_packages;
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('public', 'internal') then
    raise exception 'export_mode_invalid' using errcode = '22023';
  end if;
  if p_mode = 'internal' and not private.is_active_admin() then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  select p.* into v_profile from public.export_profiles p where p.key = p_profile_key;
  if not found then
    raise exception 'export_profile_unknown' using errcode = '22023';
  end if;
  if v_profile.key = 'custom' then
    if p_custom_width is null or p_custom_height is null
       or p_custom_width not between 64 and 8192 or p_custom_height not between 64 and 8192 then
      raise exception 'export_size_invalid' using errcode = '22023';
    end if;
  elsif p_custom_width is not null or p_custom_height is not null then
    raise exception 'export_size_invalid' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'export_items_invalid' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'export_text_too_long' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_array(p_mode, p_profile_key, p_items, p_custom_width, p_custom_height, v_note)::text);
  select p.* into v_existing from public.export_packages p
  where p.created_by = v_uid and p.request_key = p_request_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'request_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('packageId', v_existing.id, 'itemCount', v_existing.item_count, 'replayed', true);
  end if;

  v_snapshot := private.export_profile_json(v_profile) - 'updatedAt';
  if v_profile.key = 'custom' then
    v_snapshot := v_snapshot || jsonb_build_object('maxWidth', p_custom_width, 'maxHeight', p_custom_height);
  end if;
  v_id := private.export_package_insert(v_uid, p_request_key, v_hash, p_mode, v_snapshot, p_items, v_note, null);
  return jsonb_build_object('packageId', v_id,
    'itemCount', (select p.item_count from public.export_packages p where p.id = v_id), 'replayed', false);
end;
$$;

-- The package's state now: invalidated, needs_rebuild (an item is no longer
-- eligible; the next download attempt invalidates it), exported (a finished
-- download) or ready.
create function private.export_package_json(p public.export_packages, p_with_stale boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stale uuid[] := '{}';
  v_exported timestamptz;
begin
  if p.invalidated_at is null and p_with_stale then
    v_stale := private.export_package_stale(p.id);
  end if;
  select max(d.completed_at) into v_exported
  from public.export_package_downloads d where d.package_id = p.id and d.completed_at is not null;
  return jsonb_build_object(
    'id', p.id, 'venueId', p.venue_id,
    'venueName', (select v.name from public.venues v where v.id = p.venue_id),
    'mode', p.mode, 'profile', p.profile, 'note', p.note, 'itemCount', p.item_count,
    'createdAt', p.created_at,
    'createdBy', (select pr.display_name from public.profiles pr where pr.id = p.created_by),
    'rebuiltFrom', p.rebuilt_from,
    'state', case
      when p.invalidated_at is not null then 'invalidated'
      when cardinality(v_stale) > 0 then 'needs_rebuild'
      when v_exported is not null then 'exported'
      else 'ready' end,
    'staleAssets', to_jsonb(coalesce(p.invalidated_assets, v_stale)),
    'invalidatedAt', p.invalidated_at, 'invalidatedReason', p.invalidated_reason,
    'lastExportedAt', v_exported);
end;
$$;

create function public.export_packages_list(p_venue_id uuid default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user()
     or not (private.is_active_admin() or private.my_manager_venue_id() is not null) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  if p_venue_id is not null and not private.can_manage_venue(p_venue_id) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.export_package_json(p, true) order by p.created_at desc, p.id)
    from (
      select p.* from public.export_packages p
      where (private.is_active_admin() or p.venue_id is null or private.can_manage_venue(p.venue_id))
        and private.export_package_access(p.id)
        and (p_venue_id is null or exists (
          select 1 from public.export_package_items i where i.package_id = p.id and i.venue_id = p_venue_id))
      order by p.created_at desc, p.id
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) p
  ), '[]'::jsonb));
end;
$$;

create function public.export_package_detail(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pkg public.export_packages;
  v_json jsonb;
  v_stale uuid[];
begin
  if p_package_id is null or not private.export_package_access(p_package_id) then
    raise exception 'export_package_not_found' using errcode = 'P0002';
  end if;
  select p.* into v_pkg from public.export_packages p where p.id = p_package_id;
  v_json := private.export_package_json(v_pkg, true);
  v_stale := array(select jsonb_array_elements_text(v_json -> 'staleAssets')::uuid);
  return v_json || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'position', i.position, 'assetId', i.asset_id, 'venueId', i.venue_id,
          'subjectKind', i.subject_kind, 'subjectId', i.subject_id, 'subjectLabel', i.subject_label,
          'category', i.category, 'approvalKind', i.approval_kind, 'approvalId', i.approval_id,
          'approvalVersion', i.approval_version, 'approvalLevel', i.approval_level,
          'filenameStem', i.filename_stem, 'altText', i.alt_text, 'caption', i.caption,
          'useRestrictions', to_jsonb(i.use_restrictions), 'uploadedAt', i.uploaded_at,
          'eligible', not (i.asset_id = any(v_stale)),
          'publication', private.publication_asset_state(i.asset_id))
        order by i.position)
      from public.export_package_items i where i.package_id = p_package_id
    ), '[]'::jsonb),
    'downloads', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', d.id, 'downloadedBy', pr.display_name, 'startedAt', d.started_at,
          'completedAt', d.completed_at, 'failedAt', d.failed_at,
          'fileCount', case when d.files is null then null else jsonb_array_length(d.files) end)
        order by d.started_at desc, d.id)
      from public.export_package_downloads d
      join public.profiles pr on pr.id = d.downloaded_by
      where d.package_id = p_package_id
    ), '[]'::jsonb));
end;
$$;

-- Before a ZIP is built: recheck access (else not found) and every item's
-- eligibility. A package with an item no longer eligible is invalidated and
-- nothing is returned (AC32); otherwise a download row is started and the
-- snapshot returned for the manifest.
create function public.export_package_download_start(p_package_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pkg public.export_packages;
  v_stale uuid[];
  v_download uuid;
begin
  if v_uid is null or p_package_id is null or not private.export_package_access(p_package_id) then
    raise exception 'export_package_not_found' using errcode = 'P0002';
  end if;
  select p.* into v_pkg from public.export_packages p where p.id = p_package_id for update;
  if v_pkg.invalidated_at is null then
    v_stale := private.export_package_stale(p_package_id);
    if cardinality(v_stale) > 0 then
      update public.export_packages p
      set invalidated_at = now(), invalidated_reason = 'item_withdrawn', invalidated_assets = v_stale
      where p.id = p_package_id
      returning p.* into v_pkg;
    end if;
  end if;
  if v_pkg.invalidated_at is not null then
    return jsonb_build_object('state', 'invalidated', 'packageId', v_pkg.id,
      'reason', v_pkg.invalidated_reason, 'removed', to_jsonb(v_pkg.invalidated_assets));
  end if;

  insert into public.export_package_downloads (package_id, downloaded_by)
  values (v_pkg.id, v_uid)
  returning id into v_download;

  return jsonb_build_object(
    'state', 'ready', 'downloadId', v_download, 'packageId', v_pkg.id, 'mode', v_pkg.mode,
    'profile', v_pkg.profile, 'note', v_pkg.note, 'createdAt', v_pkg.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'position', i.position, 'assetId', i.asset_id, 'venueId', i.venue_id,
          'venueName', v.name, 'sourceVenueId', a.venue_id,
          'subjectKind', i.subject_kind, 'subjectId', i.subject_id, 'subjectLabel', i.subject_label,
          'category', i.category, 'approvalKind', i.approval_kind, 'approvalId', i.approval_id,
          'approvalVersion', i.approval_version, 'approvalLevel', i.approval_level,
          'filenameStem', i.filename_stem, 'altText', i.alt_text, 'caption', i.caption,
          'useRestrictions', to_jsonb(i.use_restrictions), 'uploadedAt', i.uploaded_at,
          -- Capture time is not recorded yet (S1-UPLOAD adds it).
          'capturedAt', null, 'captureTimeSource', 'unknown')
        order by i.position)
      from public.export_package_items i
      join public.venues v on v.id = i.venue_id
      join public.media_assets a on a.id = i.asset_id
      where i.package_id = v_pkg.id
    ), '[]'::jsonb));
end;
$$;

-- After the ZIP: the files it held (completed) or that it failed. A completed
-- download is the Exported record. Only the person who started it, once.
create function public.export_package_download_finish(
  p_download_id uuid, p_completed boolean, p_files jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.export_package_downloads;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'export_download_not_found' using errcode = 'P0002';
  end if;
  select d.* into v_row from public.export_package_downloads d
  where d.id = p_download_id and d.downloaded_by = v_uid for update;
  if not found then
    raise exception 'export_download_not_found' using errcode = 'P0002';
  end if;
  if v_row.completed_at is not null or v_row.failed_at is not null then
    return jsonb_build_object('downloadId', v_row.id,
      'state', case when v_row.completed_at is not null then 'completed' else 'failed' end, 'replayed', true);
  end if;
  if p_completed is true then
    if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) not between 1 and 200
       or exists (select 1 from jsonb_array_elements(p_files) f where jsonb_typeof(f) <> 'object') then
      raise exception 'export_files_invalid' using errcode = '22023';
    end if;
    update public.export_package_downloads d set completed_at = now(), files = p_files
    where d.id = v_row.id;
    return jsonb_build_object('downloadId', v_row.id, 'state', 'completed', 'replayed', false);
  end if;
  update public.export_package_downloads d set failed_at = now() where d.id = v_row.id;
  return jsonb_build_object('downloadId', v_row.id, 'state', 'failed', 'replayed', false);
end;
$$;

-- A new package with the items still eligible, same mode, profile, note and
-- texts. The old package is invalidated (if it was not already).
create function public.export_package_rebuild(p_request_key text, p_package_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pkg public.export_packages;
  v_existing public.export_packages;
  v_stale uuid[];
  v_items jsonb;
  v_hash text := md5('rebuild:' || coalesce(p_package_id::text, ''));
  v_id uuid;
begin
  if v_uid is null or p_package_id is null or not private.export_package_access(p_package_id) then
    raise exception 'export_package_not_found' using errcode = 'P0002';
  end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  select p.* into v_existing from public.export_packages p
  where p.created_by = v_uid and p.request_key = p_request_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'request_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('packageId', v_existing.id, 'itemCount', v_existing.item_count, 'replayed', true);
  end if;

  select p.* into v_pkg from public.export_packages p where p.id = p_package_id for update;
  v_stale := array(
    select distinct x from unnest(coalesce(v_pkg.invalidated_assets, '{}') || private.export_package_stale(v_pkg.id)) x);
  select jsonb_agg(jsonb_build_object(
      'assetId', i.asset_id, 'subjectKind', i.subject_kind, 'subjectId', i.subject_id,
      'altText', i.alt_text, 'caption', i.caption) order by i.position)
  into v_items
  from public.export_package_items i
  where i.package_id = v_pkg.id and not (i.asset_id = any(v_stale));
  if v_items is null then
    raise exception 'export_nothing_left' using errcode = '22023';
  end if;
  if v_pkg.invalidated_at is null then
    update public.export_packages p
    set invalidated_at = now(),
      invalidated_reason = case when cardinality(v_stale) > 0 then 'item_withdrawn' else 'rebuilt' end,
      invalidated_assets = v_stale
    where p.id = v_pkg.id;
  end if;
  v_id := private.export_package_insert(v_uid, p_request_key, v_hash, v_pkg.mode, v_pkg.profile, v_items,
    v_pkg.note, v_pkg.id);
  return jsonb_build_object('packageId', v_id,
    'itemCount', (select p.item_count from public.export_packages p where p.id = v_id),
    'removed', to_jsonb(v_stale), 'replayed', false);
end;
$$;

-- Where one asset has gone: the packages that hold it (that the caller may
-- open) and its publication state. For Library asset detail (S2-LIBRARY).
create function public.export_asset_status(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
begin
  select a.venue_id into v_venue from public.media_assets a where a.id = p_asset_id;
  if not found or not private.export_can_use_venue(v_venue, 'public') then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'assetId', p_asset_id,
    'publication', private.publication_asset_state(p_asset_id),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'packageId', p.id, 'mode', p.mode, 'profile', p.profile ->> 'label',
          'createdAt', p.created_at, 'invalidatedAt', p.invalidated_at,
          'exportedAt', (select max(d.completed_at) from public.export_package_downloads d
            where d.package_id = p.id and d.completed_at is not null))
        order by p.created_at desc, p.id)
      from public.export_packages p
      where exists (select 1 from public.export_package_items i where i.package_id = p.id and i.asset_id = p_asset_id)
        and private.export_package_access(p.id)
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication (admins record; admins and the venue's manager read)
-- ---------------------------------------------------------------------------

create function public.publication_destination_save(
  p_destination_id uuid,
  p_venue_id uuid,
  p_label text,
  p_url text,
  p_active boolean,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_row public.publication_destinations;
begin
  if v_uid is null or not private.is_active_admin() then
    raise exception 'publication_not_allowed' using errcode = '42501';
  end if;
  if length(v_label) not between 1 and 120 or p_active is null
     or (v_url is not null and (v_url !~ '^https?://[^[:space:]]+$' or length(v_url) > 500)) then
    raise exception 'publication_destination_invalid' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'publication_destination_invalid' using errcode = '22023';
  end if;
  begin
    if p_destination_id is null then
      insert into public.publication_destinations (venue_id, label, url, active, created_by, updated_by)
      values (p_venue_id, v_label, v_url, p_active, v_uid, v_uid)
      returning * into v_row;
    else
      select d.* into v_row from public.publication_destinations d where d.id = p_destination_id for update;
      if not found then
        raise exception 'publication_destination_not_found' using errcode = 'P0002';
      end if;
      if p_expected_revision is distinct from v_row.revision then
        raise exception 'stale_revision' using errcode = '40001';
      end if;
      if p_venue_id is distinct from v_row.venue_id then
        raise exception 'publication_destination_invalid' using errcode = '22023';
      end if;
      if v_row.label = v_label and v_row.url is not distinct from v_url and v_row.active = p_active then
        return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'changed', false);
      end if;
      update public.publication_destinations d
      set label = v_label, url = v_url, active = p_active, revision = d.revision + 1,
        updated_by = v_uid, updated_at = now()
      where d.id = v_row.id
      returning * into v_row;
    end if;
  exception when unique_violation then
    raise exception 'publication_destination_exists' using errcode = '23505';
  end;
  insert into public.publication_destination_events (destination_id, venue_id, label, url, active, revision, changed_by)
  values (v_row.id, v_row.venue_id, v_row.label, v_row.url, v_row.active, v_row.revision, v_uid);
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'changed', true);
end;
$$;

-- Record a person's confirmation for one asset at one destination. Ordered
-- per destination and asset (the destination row is locked), replayable by
-- request key.
create function public.publication_record(
  p_request_key text,
  p_destination_id uuid,
  p_asset_id uuid,
  p_action text,
  p_occurred_on date,
  p_external_url text default null,
  p_external_ref text default null,
  p_note text default null,
  p_package_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_url text := nullif(btrim(coalesce(p_external_url, '')), '');
  v_ref text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_hash text;
  v_existing public.publication_events;
  v_dest public.publication_destinations;
  v_asset public.media_assets;
  v_latest public.publication_events;
  v_cand record;
  v_kind text;
  v_subject uuid;
  v_label text;
  v_approval text;
  v_row public.publication_events;
  v_state text;
begin
  if v_uid is null or not private.is_active_admin() then
    raise exception 'publication_not_allowed' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('published', 'withdrawal_requested', 'withdrawn', 'failed') then
    raise exception 'publication_action_invalid' using errcode = '22023';
  end if;
  if p_occurred_on is null or p_occurred_on < date '2020-01-01'
     or p_occurred_on > (now() at time zone 'Europe/London')::date + 1 then
    raise exception 'publication_date_invalid' using errcode = '22023';
  end if;
  if (v_url is not null and (v_url !~ '^https?://[^[:space:]]+$' or length(v_url) > 500))
     or (v_ref is not null and length(v_ref) > 200) or (v_note is not null and length(v_note) > 500) then
    raise exception 'publication_text_invalid' using errcode = '22023';
  end if;
  if p_action = 'published' and v_url is null and v_ref is null then
    raise exception 'publication_where_required' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_array(p_destination_id, p_asset_id, p_action, p_occurred_on, v_url, v_ref, v_note,
    p_package_id)::text);
  select e.* into v_existing from public.publication_events e
  where e.recorded_by = v_uid and e.request_key = p_request_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'request_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('eventId', v_existing.id, 'generation', v_existing.generation, 'replayed', true);
  end if;

  select d.* into v_dest from public.publication_destinations d where d.id = p_destination_id for update;
  if not found then
    raise exception 'publication_destination_not_found' using errcode = 'P0002';
  end if;
  if p_action = 'published' and not v_dest.active then
    raise exception 'publication_destination_inactive' using errcode = '22023';
  end if;
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_dest.venue_id is not null and v_dest.venue_id <> v_asset.venue_id then
    raise exception 'publication_scope_mismatch' using errcode = '22023';
  end if;
  if p_package_id is not null and not exists (
    select 1 from public.export_package_items i join public.export_packages p on p.id = i.package_id
    where i.package_id = p_package_id and i.asset_id = p_asset_id and p.mode = 'public') then
    raise exception 'publication_package_mismatch' using errcode = '22023';
  end if;

  select e.* into v_latest from public.publication_events e
  where e.destination_id = v_dest.id and e.asset_id = v_asset.id
  order by e.generation desc limit 1;

  if p_action in ('published', 'failed') then
    select c.* into v_cand from private.export_candidate_rows(v_asset.venue_id, 'public') c
    where c.asset_id = v_asset.id
    order by (p_package_id is not null and exists (
        select 1 from public.export_package_items i
        where i.package_id = p_package_id and i.asset_id = c.asset_id
          and i.subject_kind = c.subject_kind and i.subject_id = c.subject_id)) desc,
      c.subject_kind, c.subject_id
    limit 1;
    if found then
      v_kind := v_cand.subject_kind; v_subject := v_cand.subject_id;
      v_label := v_cand.subject_label; v_approval := v_cand.approval_id;
    elsif p_action = 'published' then
      raise exception 'publication_not_eligible' using errcode = '22023';
    end if;
  end if;
  if v_kind is null then
    if v_latest.id is null then
      raise exception 'publication_nothing_published' using errcode = '22023';
    end if;
    v_kind := v_latest.subject_kind; v_subject := v_latest.subject_id;
    v_label := v_latest.subject_label; v_approval := v_latest.approval_id;
  end if;
  if p_action in ('withdrawal_requested', 'withdrawn')
     and (v_latest.id is null or v_latest.action = 'withdrawn') then
    raise exception 'publication_nothing_published' using errcode = '22023';
  end if;

  insert into public.publication_events (destination_id, asset_id, venue_id, generation, action,
    subject_kind, subject_id, subject_label, approval_id, package_id, external_url, external_ref,
    occurred_on, note, recorded_by, request_key, request_hash)
  values (v_dest.id, v_asset.id, v_asset.venue_id, coalesce(v_latest.generation, 0) + 1, p_action,
    v_kind, v_subject, left(v_label, 200), v_approval, p_package_id, v_url, v_ref,
    p_occurred_on, v_note, v_uid, p_request_key, v_hash)
  returning * into v_row;

  select pp.state into v_state from private.publication_pairs(array[v_asset.venue_id]) pp
  where pp.destination_id = v_dest.id and pp.asset_id = v_asset.id;
  return jsonb_build_object('eventId', v_row.id, 'generation', v_row.generation, 'state', v_state,
    'replayed', false);
end;
$$;

-- Destinations, outstanding work (Withdrawal pending, Failed or unknown),
-- what is published and the latest records. Admins: every venue or one.
-- Managers: their venue, read only.
create function public.publication_overview(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := private.is_active_admin();
  v_venues uuid[];
begin
  if not private.is_active_user() then
    raise exception 'publication_not_allowed' using errcode = '42501';
  end if;
  if v_admin then
    v_venues := case when p_venue_id is null then array(select v.id from public.venues v)
      else array[p_venue_id] end;
  else
    v_venues := array[coalesce(p_venue_id, private.my_manager_venue_id())];
    if v_venues[1] is null or not private.can_manage_venue(v_venues[1]) then
      raise exception 'publication_not_allowed' using errcode = '42501';
    end if;
  end if;

  return (
    with pairs as (
      select pp.* from private.publication_pairs(v_venues) pp
    ),
    dests as (
      select d.* from public.publication_destinations d
      where d.venue_id is null or d.venue_id = any(v_venues)
    )
    select jsonb_build_object(
      'canRecord', v_admin,
      'destinations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', d.id, 'venueId', d.venue_id,
            'venueName', (select v.name from public.venues v where v.id = d.venue_id),
            'label', d.label, 'url', d.url, 'active', d.active, 'revision', d.revision,
            'published', (select count(*) from pairs where pairs.destination_id = d.id and pairs.state = 'published_confirmed'),
            'pending', (select count(*) from pairs where pairs.destination_id = d.id and pairs.state = 'withdrawal_pending'),
            'failed', (select count(*) from pairs where pairs.destination_id = d.id and pairs.state = 'failed_unknown'),
            'lastPublishedOn', (select max(pairs.occurred_on) from pairs
              where pairs.destination_id = d.id and pairs.latest_action = 'published'))
          order by d.active desc, lower(d.label), d.id)
        from dests d
      ), '[]'::jsonb),
      'outstanding', coalesce((
        select jsonb_agg(jsonb_build_object(
            'destinationId', pairs.destination_id, 'destinationLabel', d.label,
            'assetId', pairs.asset_id, 'venueId', pairs.venue_id,
            'venueName', (select v.name from public.venues v where v.id = pairs.venue_id),
            'subjectLabel', pairs.subject_label, 'state', pairs.state,
            'requested', pairs.latest_action = 'withdrawal_requested',
            'externalUrl', pairs.external_url, 'externalRef', pairs.external_ref,
            'since', pairs.recorded_at)
          order by pairs.recorded_at, pairs.destination_id, pairs.asset_id)
        from pairs join public.publication_destinations d on d.id = pairs.destination_id
        where pairs.state in ('withdrawal_pending', 'failed_unknown')
      ), '[]'::jsonb),
      'published', coalesce((
        select jsonb_agg(x.j order by x.on_date desc) from (
          select jsonb_build_object(
              'destinationId', pairs.destination_id, 'destinationLabel', d.label,
              'assetId', pairs.asset_id, 'venueId', pairs.venue_id,
              'venueName', (select v.name from public.venues v where v.id = pairs.venue_id),
              'subjectLabel', pairs.subject_label, 'externalUrl', pairs.external_url,
              'externalRef', pairs.external_ref, 'occurredOn', pairs.occurred_on) as j,
            pairs.occurred_on as on_date
          from pairs join public.publication_destinations d on d.id = pairs.destination_id
          where pairs.state = 'published_confirmed'
          order by pairs.occurred_on desc
          limit 200
        ) x
      ), '[]'::jsonb),
      'recent', coalesce((
        select jsonb_agg(x.j order by x.id desc) from (
          select e.id, jsonb_build_object(
              'id', e.id, 'destinationLabel', d.label, 'assetId', e.asset_id,
              'subjectLabel', e.subject_label, 'action', e.action, 'occurredOn', e.occurred_on,
              'recordedAt', e.recorded_at, 'recordedBy', pr.display_name,
              'externalUrl', e.external_url, 'externalRef', e.external_ref, 'note', e.note) as j
          from public.publication_events e
          join public.publication_destinations d on d.id = e.destination_id
          join public.profiles pr on pr.id = e.recorded_by
          where e.venue_id = any(v_venues)
          order by e.id desc
          limit 50
        ) x
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.export_profile_json(public.export_profiles) from public, anon, authenticated, service_role;
revoke all on function private.export_package_json(public.export_packages, boolean) from public, anon, authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.export_profiles()',
    'public.export_profile_set(text, text, text, integer, integer, integer, integer)',
    'public.export_candidates(uuid, text)',
    'public.export_package_create(text, text, text, jsonb, integer, integer, text)',
    'public.export_packages_list(uuid, integer)',
    'public.export_package_detail(uuid)',
    'public.export_package_download_start(uuid)',
    'public.export_package_download_finish(uuid, boolean, jsonb)',
    'public.export_package_rebuild(text, uuid)',
    'public.export_asset_status(uuid)',
    'public.publication_destination_save(uuid, uuid, text, text, boolean, integer)',
    'public.publication_record(text, uuid, uuid, text, date, text, text, text, uuid)',
    'public.publication_overview(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
