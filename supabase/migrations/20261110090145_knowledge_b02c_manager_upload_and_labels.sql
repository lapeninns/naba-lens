-- B02-c: manager accounts upload, label and group their own photos and videos
-- at their managed venue (docs/knowledge/b02-design.md W3, W4, §7.2; owner
-- decisions Q1 and Q4, 10 Nov 2026).
--
-- Scope approved by the owner: a dedicated manager account (role 'manager'
-- with an effective grant) may upload photos and videos for menu items and
-- venue-question evidence, label its own uploads and group them, at its
-- managed venue only. Its new uploads are visible to it and to authorised
-- reviewers until reviewed. Unchanged by this approval and by this migration:
-- menu self-review (a manager account still never decides its own menu
-- photo), target credit, manager recognition, admin capture and cross-venue
-- visibility. Staff, staff holding a legacy grant, and admins behave exactly
-- as before.
--
-- * media_assets.uploader_role (OD-8 default): the uploader's role, recorded
--   by reserve_media_asset, fixed afterwards; null on earlier rows. Every new
--   manager rule below requires uploader_role = 'manager', so a manager
--   account's staff-era uploads keep today's rules (hidden from it, not
--   labelled by it).
-- * Upload chain, changed together so no path disagrees:
--   private.uploadable_venue_id (a manager account's effective grant venue),
--   public.reserve_media_asset (admits manager accounts and records the role),
--   private.can_upload_media_object (the storage insert policy) and
--   private.guard_media_original_write (the storage write trigger). The size,
--   type and 20-open-upload limits are unchanged.
-- * Own uploads: a new select policy on media_assets lets a manager account
--   read its own manager-era rows (finalise, its own media routes, its
--   knowledge evidence picker). Community reads still require a staff
--   uploader, so a manager's uploads never reach colleagues' Photos (OD-9).
-- * Labels: private.save_media_labels_as and public.stage_media_labels admit
--   a manager account for its own manager-era uploads at its grant venue;
--   media_pending_labels gains manager own-row policies; the label catalogue
--   helpers (staff_can_label_venue, staff_can_read_menu_item/_variant) and
--   can_read_asset_labels admit a manager account at its grant venue only.
-- * B02 reads re-created: my_label_work counts a manager account's own
--   manager-era uploads; my_venue_capabilities reports canLabel for a manager
--   account at its grant venue (canUpload follows uploadable_venue_id).
--   contribution_group_start and _add use uploadable_venue_id, so a manager
--   account groups at its managed venue without change.
-- * Not touched: delete_media_asset (manager accounts still cannot delete),
--   the credit trigger media_assets_amenity_evidence_lost,
--   media_assets_knowledge_evidence_withdrawn, the credit functions, the
--   menu self-review trigger and the community reads.
--
-- Rollback: a forward migration restores the earlier bodies (reserve from
-- 20261107130000, save_media_labels_as and stage_media_labels from
-- 20261107140000, can_upload_media_object from 20261029120200,
-- guard_media_original_write from 20261030100000, uploadable_venue_id from
-- 20261029120100, staff_can_label_venue from 20261030120000,
-- staff_can_read_menu_item/_variant from 20261030120100, can_read_asset_labels
-- from 20261030120100, my_label_work and my_venue_capabilities from
-- 20261110010123) and drops the three manager policies. Uploads and labels
-- already made stay; the column stays (nullable, no data loss).

-- ---------------------------------------------------------------------------
-- Uploader role (OD-8)
-- ---------------------------------------------------------------------------

alter table public.media_assets add column uploader_role public.app_role;

comment on column public.media_assets.uploader_role is
  'The uploader''s role when the upload was reserved (staff or manager); null for uploads reserved before B02-c. Fixed at reservation.';

create function private.media_assets_uploader_role_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.uploader_role is distinct from old.uploader_role then
    raise exception 'media_asset_reservation_immutable' using errcode = '42501',
      detail = 'The uploader role is fixed at reservation.';
  end if;
  return new;
end;
$$;

create trigger media_assets_uploader_role_guard
  before update of uploader_role on public.media_assets
  for each row execute function private.media_assets_uploader_role_guard();

revoke all on function private.media_assets_uploader_role_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upload chain
-- ---------------------------------------------------------------------------

-- A manager account's upload venue: its effective grant venue (always its
-- profile venue, active), while the account is active with role 'manager'.
-- Takes the user so the storage write trigger can check a token upload,
-- which carries no auth.uid().
create function private.manager_upload_venue_id(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.effective_manager_venue_id(p.id)
  from public.profiles p
  where p.id = p_user and p.active and p.role = 'manager';
$$;

revoke all on function private.manager_upload_venue_id(uuid) from public, anon, authenticated;

-- The caller's venue when they may upload: active staff at an active venue
-- (unchanged), or a manager account at its managed venue.
create or replace function private.uploadable_venue_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.venue_id
      from public.profiles p
      join public.venues v on v.id = p.venue_id and v.active
      where p.id = (select auth.uid()) and p.active and p.role = 'staff'
    ),
    private.manager_upload_venue_id((select auth.uid()))
  );
$$;

-- Storage insert policy: as 20261029120200, plus a manager account's own
-- manager-era reservation at its managed venue.
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
    join public.venues v on v.id = a.venue_id and v.active
    where a.id = private.media_asset_id_from_key(p_name)
      and a.original_path = p_name
      and a.uploader_id = (select auth.uid())
      and a.upload_state = 'uploading'
      and a.deleted_at is null
      and (
        private.is_active_staff()
        or (
          a.uploader_role = 'manager'
          and private.manager_upload_venue_id((select auth.uid())) = a.venue_id
        )
      )
  );
$$;

-- Storage write trigger: as 20261030100000, with the same manager rule
-- checked against the reservation's own uploader.
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
    join public.profiles p on p.id = a.uploader_id and p.active
    join public.venues v on v.id = a.venue_id and v.active
    where a.id = private.media_asset_id_from_key(new.name)
      and a.original_path = new.name
      and a.upload_state = 'uploading'
      and a.deleted_at is null
      and (
        p.role = 'staff'
        or (
          p.role = 'manager'
          and a.uploader_role = 'manager'
          and private.manager_upload_venue_id(p.id) = a.venue_id
        )
      )
  ) then
    raise exception 'media_reservation_closed' using errcode = '42501',
      detail = 'The reservation for this key is no longer accepting an upload.';
  end if;

  return new;
end;
$$;

-- reserve_media_asset: the 20261107130000 body, admitting a manager account
-- (its venue comes from uploadable_venue_id, so only its managed venue) and
-- recording the uploader's role on the new row.
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
  if v_uid is null or not (private.is_active_staff() or private.is_active_manager()) then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  if p_client_upload_key is null or p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;

  if p_purpose is null or p_purpose not in ('general', 'amenity') then
    raise exception 'invalid_purpose' using errcode = '22023';
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
    if v_existing.purpose <> p_purpose then
      raise exception 'reservation_purpose_mismatch' using errcode = '22023',
        detail = 'This upload key was reserved for another purpose.';
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
      client_upload_key, purpose, uploader_role
    )
    values (
      v_id, v_uid, v_venue, v_path,
      left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
      p_media_type, p_size_bytes, p_client_upload_key, p_purpose,
      (select p.role from public.profiles p where p.id = v_uid)
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

-- A manager account reads its own manager-era uploads in every state, as staff
-- read theirs (media_assets_select_own). Staff-era rows stay hidden from it.
create policy media_assets_select_own_manager on public.media_assets
  for select to authenticated
  using (
    uploader_id = (select auth.uid())
    and uploader_role = 'manager'
    and deleted_at is null
    and (select private.is_active_manager())
  );

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------

-- The venues whose active catalogue the caller may read and label with:
-- staff as before; a manager account its managed venue only.
create or replace function private.staff_can_label_venue(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and (
        (
          p.role = 'staff'
          and (
            p.venue_id = p_venue_id
            or exists (
              select 1 from public.media_assets a
              where a.uploader_id = p.id
                and a.venue_id = p_venue_id
                and a.deleted_at is null
            )
          )
        )
        or (p.role = 'manager' and private.effective_manager_venue_id(p.id) = p_venue_id)
      )
  );
$$;

-- As 20261030120100 for staff; a manager account reads only items on its
-- managed venue's active menu (not items labelled on its staff-era uploads).
create or replace function private.staff_can_read_menu_item(p_item_id uuid, p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    private.is_active_staff() and (
      (
        private.staff_can_label_venue(p_venue_id)
        and exists (
          select 1
          from public.menu_entries e
          join public.menu_versions v on v.id = e.version_id
          where e.item_id = p_item_id and v.status = 'active'
        )
      )
      or exists (
        select 1
        from public.media_label_items li
        join public.media_assets a on a.id = li.asset_id
        where li.item_id = p_item_id
          and a.uploader_id = (select auth.uid())
          and a.deleted_at is null
      )
    )
  ) or (
    private.is_active_manager()
    and private.staff_can_label_venue(p_venue_id)
    and exists (
      select 1
      from public.menu_entries e
      join public.menu_versions v on v.id = e.version_id
      where e.item_id = p_item_id and v.status = 'active'
    )
  );
$$;

create or replace function private.staff_can_read_menu_variant(p_variant_id uuid, p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    private.is_active_staff() and (
      (
        private.staff_can_label_venue(p_venue_id)
        and exists (
          select 1
          from public.menu_entry_variants ev
          join public.menu_entries e on e.id = ev.entry_id
          join public.menu_versions v on v.id = e.version_id
          where ev.variant_id = p_variant_id and v.status = 'active'
        )
      )
      or exists (
        select 1
        from public.media_label_items li
        join public.media_assets a on a.id = li.asset_id
        where li.variant_id = p_variant_id
          and a.uploader_id = (select auth.uid())
          and a.deleted_at is null
      )
    )
  ) or (
    private.is_active_manager()
    and private.staff_can_label_venue(p_venue_id)
    and exists (
      select 1
      from public.menu_entry_variants ev
      join public.menu_entries e on e.id = ev.entry_id
      join public.menu_versions v on v.id = e.version_id
      where ev.variant_id = p_variant_id and v.status = 'active'
    )
  );
$$;

-- As before for staff and admins, plus a manager account's own manager-era
-- uploads. The admin rule is unchanged (library_candidate_ids and
-- menu_label_counts repeat it).
create or replace function private.can_read_asset_labels(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_assets a
    join public.profiles p on p.id = (select auth.uid()) and p.active
    where a.id = p_asset_id
      and a.deleted_at is null
      and (
        (p.role = 'staff' and a.uploader_id = p.id)
        or (p.role = 'admin' and a.upload_state = 'ready')
        or (p.role = 'manager' and a.uploader_id = p.id and a.uploader_role = 'manager')
      )
  );
$$;

-- save_media_labels_as: the 20261107140000 body; a manager account labels
-- only its own manager-era uploads at its managed venue.
create or replace function private.save_media_labels_as(
  p_actor uuid,
  p_asset_id uuid,
  p_expected_revision integer,
  p_content_types text[],
  p_note text,
  p_items jsonb,
  p_missing_item text default null,
  p_catalogue_version_id uuid default null
)
returns table (revision integer, has_labels boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_codes constant text[] := array['dish', 'preparation', 'plating', 'drinks', 'kitchen', 'team', 'venue', 'event'];
  c_max_items constant integer := 20;
  c_max_types constant integer := 4;
  v_uid uuid := p_actor;
  v_role public.app_role;
  v_asset public.media_assets;
  v_label public.media_labels;
  v_revision integer;
  v_types text[];
  v_note text;
  v_missing text;
  v_element jsonb;
  v_item_id uuid;
  v_variant_id uuid;
  v_requested jsonb := '[]'::jsonb;
  v_new jsonb;
  v_new_count integer;
  v_active uuid;
  v_wrong uuid[];
  v_unavailable uuid[];
  v_before jsonb;
  v_after jsonb;
  v_suggestion_before text;
  v_suggestion_after text;
  v_has boolean;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = v_uid and p.active;
  if v_uid is null or v_role is null then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if v_role not in ('staff', 'admin', 'manager') then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  -- Serialises every label save of this asset with finalise/delete. No column changes.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.deleted_at is not null
     or v_asset.upload_state <> 'ready'
     or (v_role = 'staff' and v_asset.uploader_id <> v_uid)
     or (
       v_role = 'manager'
       and (
         v_asset.uploader_id <> v_uid
         or v_asset.uploader_role is distinct from 'manager'
         or private.effective_manager_venue_id(v_uid) is distinct from v_asset.venue_id
       )
     ) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  -- Input validation.
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_revision' using errcode = '22023';
  end if;

  v_types := coalesce(p_content_types, '{}');
  if array_position(v_types, null) is not null or not (v_types <@ c_codes) then
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.code order by c.ord), '{}') into v_types
  from unnest(c_codes) with ordinality as c(code, ord)
  where c.code = any(v_types);
  if cardinality(v_types) > c_max_types then
    raise exception 'invalid_content_type' using errcode = '22023',
      detail = format('At most %s content types.', c_max_types);
  end if;

  v_note := nullif(btrim(p_note), '');
  if length(v_note) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  if p_missing_item is not null then
    v_missing := btrim(p_missing_item);
    if length(v_missing) > 120 then
      raise exception 'missing_item_too_long' using errcode = '22023';
    end if;
  end if;

  if p_items is not null and jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_label_items' using errcode = '22023';
  end if;
  for v_element in select x.value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x(value) loop
    if jsonb_typeof(v_element) is distinct from 'object' then
      raise exception 'invalid_label_items' using errcode = '22023';
    end if;
    v_item_id := private.jsonb_uuid(v_element -> 'itemId');
    if v_item_id is null then
      raise exception 'invalid_label_items' using errcode = '22023', detail = 'itemId';
    end if;
    if coalesce(jsonb_typeof(v_element -> 'variantId'), 'null') = 'null' then
      v_variant_id := null;
    else
      v_variant_id := private.jsonb_uuid(v_element -> 'variantId');
      if v_variant_id is null then
        raise exception 'invalid_label_items' using errcode = '22023', detail = 'variantId';
      end if;
    end if;
    -- Deduplicate exact tuples.
    if not v_requested @> jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'variantId', v_variant_id)) then
      v_requested := v_requested || jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'variantId', v_variant_id));
    end if;
  end loop;
  if jsonb_array_length(v_requested) > c_max_items then
    raise exception 'invalid_label_items' using errcode = '22023',
      detail = format('At most %s menu items per asset.', c_max_items);
  end if;

  -- Revision compare-and-set. A missing row is revision 0; the asset lock above
  -- makes a concurrent first save see the row and fail here, not on a unique key.
  select l.* into v_label from public.media_labels l where l.asset_id = p_asset_id for update;
  v_revision := coalesce(v_label.revision, 0);
  if p_expected_revision <> v_revision then
    raise exception 'label_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;

  -- Lock order for every label save: asset row (above), label row, then the
  -- venue menu lock SHARED, then the caller's open suggestion row. Activation
  -- and suggestion resolution take the venue lock exclusively, so neither can
  -- change the active version or this suggestion until the save commits
  -- (final review I-1: a resolve between read and update lost the edit).
  perform private.lock_venue_menu(v_asset.venue_id, true);

  select s.suggested_name into v_suggestion_before
  from public.menu_item_suggestions s
  where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open'
  for update;

  v_before := jsonb_build_object(
    'revision', v_revision,
    'contentTypes', to_jsonb(coalesce(v_label.content_types, '{}')),
    'note', v_label.note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('itemId', li.item_id, 'variantId', li.variant_id)
        order by li.added_at, li.id)
      from public.media_label_items li where li.asset_id = p_asset_id), '[]'::jsonb),
    'missingItem', v_suggestion_before);

  -- New tuples: requested but not already on the asset (exact match, A1.7).
  select coalesce(jsonb_agg(r.value), '[]'::jsonb) into v_new
  from jsonb_array_elements(v_requested) as r(value)
  where not exists (
    select 1 from public.media_label_items li
    where li.asset_id = p_asset_id
      and li.item_id = (r.value ->> 'itemId')::uuid
      and li.variant_id is not distinct from (r.value ->> 'variantId')::uuid
  );
  v_new_count := jsonb_array_length(v_new);

  if v_new_count > 0 then
    v_active := private.active_menu_version_id(v_asset.venue_id);

    if p_catalogue_version_id is distinct from v_active then
      raise exception 'menu_catalogue_conflict' using errcode = '40001',
        detail = jsonb_build_object('activeVersionId', v_active)::text;
    end if;

    -- Items of another venue are a forged request, not a stale catalogue.
    select array_agg(distinct i.id) into v_wrong
    from jsonb_array_elements(v_new) as n(value)
    join public.menu_items i on i.id = (n.value ->> 'itemId')::uuid
    where i.venue_id <> v_asset.venue_id;
    if v_wrong is not null then
      raise exception 'menu_item_wrong_venue' using errcode = '22023',
        detail = to_jsonb(v_wrong)::text;
    end if;

    -- Each new tuple must be in the active version, not archived, and its
    -- variant (if any) listed on that active entry.
    select array_agg(distinct (n.value ->> 'itemId')::uuid) into v_unavailable
    from jsonb_array_elements(v_new) as n(value)
    where not exists (
      select 1
      from public.menu_items i
      join public.menu_entries e on e.item_id = i.id and e.version_id = v_active
      where i.id = (n.value ->> 'itemId')::uuid
        and i.venue_id = v_asset.venue_id
        and i.archived_at is null
        and (
          n.value ->> 'variantId' is null
          or exists (
            select 1 from public.menu_entry_variants ev
            where ev.entry_id = e.id and ev.variant_id = (n.value ->> 'variantId')::uuid
          )
        )
    );
    if v_unavailable is not null then
      raise exception 'menu_item_unavailable' using errcode = 'P0001',
        detail = to_jsonb(v_unavailable)::text;
    end if;
  end if;

  v_has := jsonb_array_length(v_requested) > 0 or cardinality(v_types) > 0;

  if v_label.asset_id is null then
    insert into public.media_labels as l (asset_id, venue_id, content_types, note, has_labels, revision, updated_by)
    values (p_asset_id, v_asset.venue_id, v_types, v_note, v_has, 1, v_uid);
  else
    update public.media_labels l
    set content_types = v_types, note = v_note, has_labels = v_has,
        revision = l.revision + 1, updated_by = v_uid
    where l.asset_id = p_asset_id;
  end if;

  -- Removed tuples.
  delete from public.media_label_items li
  where li.asset_id = p_asset_id
    and not exists (
      select 1 from jsonb_array_elements(v_requested) as r(value)
      where (r.value ->> 'itemId')::uuid = li.item_id
        and (r.value ->> 'variantId')::uuid is not distinct from li.variant_id
    );

  -- New tuples with their snapshot from the active entry.
  if v_new_count > 0 then
    insert into public.media_label_items (
      asset_id, venue_id, item_id, variant_id, item_name, variant_name,
      section_name, section_slug, version_id, added_by
    )
    select p_asset_id, v_asset.venue_id, e.item_id, ev.variant_id, e.name, ev.name,
      s.name, s.slug, v_active, v_uid
    from jsonb_array_elements(v_new) with ordinality as n(value, ordinality)
    join public.menu_entries e
      on e.version_id = v_active and e.item_id = (n.value ->> 'itemId')::uuid
    join public.menu_sections s on s.id = e.section_id
    left join public.menu_entry_variants ev
      on ev.entry_id = e.id and ev.variant_id = (n.value ->> 'variantId')::uuid
    order by n.ordinality;
  end if;

  -- Missing-item suggestion: null = unchanged, '' = withdraw, text = upsert own open one.
  v_suggestion_after := v_suggestion_before;
  if v_missing is not null then
    if v_missing = '' then
      update public.menu_item_suggestions s
      set status = 'withdrawn'
      where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open';
      v_suggestion_after := null;
    elsif v_suggestion_before is not null then
      update public.menu_item_suggestions s
      set suggested_name = v_missing
      where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open';
      v_suggestion_after := v_missing;
    else
      insert into public.menu_item_suggestions (venue_id, asset_id, suggested_name, created_by)
      values (v_asset.venue_id, p_asset_id, v_missing, v_uid);
      v_suggestion_after := v_missing;
    end if;
  end if;

  v_after := jsonb_build_object(
    'revision', v_revision + 1,
    'contentTypes', to_jsonb(v_types),
    'note', v_note,
    'items', v_requested,
    'missingItem', v_suggestion_after,
    'catalogueVersionId', v_active);

  insert into public.media_label_events (asset_id, venue_id, actor_id, actor_role, action, before, after)
  values (p_asset_id, v_asset.venue_id, v_uid, v_role, 'labels_saved', v_before, v_after);

  -- The uploader's successful save settles their stored upload draft. Anyone
  -- else's (an admin's) leaves it for the uploader to fix or discard.
  delete from public.media_pending_labels pl
  where pl.asset_id = p_asset_id and pl.uploader_id = v_uid;

  return query select v_revision + 1, v_has;
end;
$$;

-- stage_media_labels: the 20261107140000 body; a manager account stages labels
-- only for its own manager-era uploads at its managed venue.
create or replace function public.stage_media_labels(
  p_asset_id uuid,
  p_venue_id uuid,
  p_input jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_catalogue uuid;
begin
  if v_uid is null or not (private.is_active_staff() or private.is_active_manager()) then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  if p_asset_id is null or p_venue_id is null or p_input is null
     or jsonb_typeof(p_input) is distinct from 'object'
     or octet_length(p_input::text) > 16384
     or private.jsonb_uuid(p_input -> 'assetId') is distinct from p_asset_id then
    raise exception 'invalid_label_draft' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_input -> 'catalogueVersionId'), 'null') = 'null' then
    v_catalogue := null;
  else
    v_catalogue := private.jsonb_uuid(p_input -> 'catalogueVersionId');
    if v_catalogue is null then
      raise exception 'invalid_label_draft' using errcode = '22023',
        detail = 'catalogueVersionId';
    end if;
  end if;

  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.deleted_at is not null
     or v_asset.uploader_id <> v_uid
     or v_asset.purpose <> 'general'
     or v_asset.venue_id <> p_venue_id
     or (
       private.is_active_manager()
       and (
         v_asset.uploader_role is distinct from 'manager'
         or private.my_manager_venue_id() is distinct from v_asset.venue_id
       )
     )
     or (v_asset.upload_state = 'failed' and not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'media' and o.name = v_asset.original_path
     )) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  if v_asset.upload_state = 'ready' then
    return 'ready';
  end if;

  insert into public.media_pending_labels as pl (
    asset_id, uploader_id, venue_id, input, catalogue_version_id
  )
  values (p_asset_id, v_uid, v_asset.venue_id, p_input, v_catalogue)
  on conflict (asset_id) do update
    set input = excluded.input,
        catalogue_version_id = excluded.catalogue_version_id,
        status = 'pending',
        code = null,
        message = null;
  return 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- B02 reads that follow the gates
-- ---------------------------------------------------------------------------

-- R1: a manager account counts its own manager-era uploads, as staff count
-- theirs; anyone else still gets zeros.
create or replace function public.my_label_work()
returns table (needs_labels integer, needs_attention integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  if not (private.is_active_staff() or private.is_active_manager()) then
    return query select 0, 0;
    return;
  end if;
  return query
  select
    (select count(*)::integer from public.media_assets a
     where a.uploader_id = v_uid and private.asset_needs_labels(a.id)
       and (a.uploader_role = 'manager' or not private.is_active_manager())),
    (select count(*)::integer
     from public.media_pending_labels pl
     join public.media_assets a on a.id = pl.asset_id
     where pl.uploader_id = v_uid and pl.status = 'needs_attention' and a.deleted_at is null);
end;
$$;

-- R8: canLabel restates the label role rule above (staff, admin, and a manager
-- account at its managed venue); canUpload already follows uploadable_venue_id.
create or replace function public.my_venue_capabilities(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_role text;
  v_admin boolean := private.is_active_admin();
  v_grant uuid := private.my_manager_venue_id();
  v_kind text;
  v_venue uuid;
  v_basis text;
  v_manage boolean;
begin
  select p.role::text into v_role from public.profiles p where p.id = v_uid;
  v_kind := case
    when v_admin then 'admin'
    when v_role = 'manager' then 'manager'
    when v_grant is not null then 'staff_with_grant'
    else 'staff'
  end;
  if v_admin then
    if p_venue_id is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.venues v where v.id = p_venue_id) then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    v_venue := p_venue_id;
  else
    v_venue := coalesce(v_grant, private.active_staff_venue_id());
    if p_venue_id is not null and p_venue_id is distinct from v_venue then
      raise exception 'wrong_venue' using errcode = '42501';
    end if;
  end if;
  v_basis := private.knowledge_basis(v_venue);
  v_manage := coalesce(private.can_manage_venue(v_venue), false);
  return jsonb_build_object(
    'accountKind', v_kind,
    'venueId', v_venue,
    'canUpload', v_venue is not null and coalesce(private.uploadable_venue_id() = v_venue, false),
    'canLabel', coalesce(v_role in ('staff', 'admin') or (v_role = 'manager' and v_grant = v_venue), false),
    'canSendFindings', v_basis is not null and exists (
      select 1 from public.knowledge_working_list w where w.venue_id = v_venue and w.disabled_at is null
    ),
    'canConfirmFindings', coalesce(v_basis in ('venue_manager', 'admin'), false),
    'canSelfConfirm', coalesce((
      select jsonb_object_agg(w.question_key,
        coalesce(v_basis in ('venue_manager', 'admin'), false)
        and (coalesce(r.confirmation, 'none') = 'none' or coalesce(r.self_confirmation_allowed, false)))
      from public.knowledge_working_list w
      left join lateral (select x.* from private.knowledge_rule(w.question_key) x) r on true
      where w.venue_id = v_venue and w.disabled_at is null
    ), '{}'::jsonb),
    'canReviewMenuPhotos', v_manage,
    'canDecideOwnMenuPhoto', v_manage
      and private.menu_photo_reviewable_uploader(v_uid, v_admin)
      and not private.menu_photo_self_blocked(v_uid),
    'canReviewChecklist', v_manage and not private.is_active_manager(),
    'canBeAssigned', v_venue is not null and exists (
      select 1 from public.profiles p
      where p.id = v_uid and p.active and p.role = 'staff' and p.venue_id = v_venue
    )
  );
end;
$$;

create policy media_pending_labels_select_own_manager on public.media_pending_labels
  for select to authenticated
  using (uploader_id = (select auth.uid()) and (select private.is_active_manager()));
create policy media_pending_labels_delete_own_manager on public.media_pending_labels
  for delete to authenticated
  using (uploader_id = (select auth.uid()) and (select private.is_active_manager()));

-- ---------------------------------------------------------------------------
-- Function privileges (create or replace keeps them; restated for the new)
-- ---------------------------------------------------------------------------

revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text) to authenticated, service_role;
revoke all on function public.stage_media_labels(uuid, uuid, jsonb) from public, anon;
grant execute on function public.stage_media_labels(uuid, uuid, jsonb) to authenticated, service_role;
revoke all on function private.save_media_labels_as(uuid, uuid, integer, text[], text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.my_label_work(), public.my_venue_capabilities(uuid) from public, anon, service_role;
grant execute on function public.my_label_work(), public.my_venue_capabilities(uuid) to authenticated;
