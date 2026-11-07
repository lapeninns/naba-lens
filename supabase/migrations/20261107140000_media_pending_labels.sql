-- Labels stored on the server while a photo is still uploading (upload flow
-- Phase 2), plus a label-coverage measurement view (Phase 3).
--
-- Staff can label a photo as soon as they pick it. Until now the browser kept
-- those labels and saved them only once the photo was ready, so closing the
-- tab, logging out or losing the connection dropped them. Now:
--
-- * public.media_pending_labels: one row per asset holding the uploader's
--   complete SaveLabelsInput (lib/menus/types.ts) until the asset is ready.
--   status 'pending' = waiting for the asset; 'needs_attention' = applying it
--   failed (code = the SaveLabelsErrorCode, e.g. catalogue_changed) and the
--   uploader must fix it. RLS: the uploader (active staff) reads and deletes
--   only their own rows. Nobody else reads them, admins and managers
--   included. Every write goes through the SECURITY DEFINER functions below.
-- * stage_media_labels (caller: the uploader) locks the asset row, then stores
--   the draft while the asset is uploading or processing, or failed with its
--   original still stored (a temporary failure: a Retry finalises it again),
--   or answers 'ready' so the caller saves through save_media_labels at once.
--   Deleted, amenity, other venues' and other people's assets, and failed
--   ones whose original is gone (can never be used), are not found.
-- * complete_media_finalise (service role, called by finalise) makes the
--   asset ready AND applies a stored draft in one transaction, attributed to
--   the uploader through the same validation and audit trail as
--   save_media_labels. A failed apply never blocks the photo: the row becomes
--   needs_attention. Ordering: both functions take the asset row lock, so a
--   draft stored before the asset is ready is applied by finalise, and one
--   arriving after it is saved directly. No draft can be dropped in between.
--   The apply waits at most 3 s for a lock (the venue menu lock, held by a
--   menu activation): longer, and the draft becomes needs_attention
--   'unavailable' instead of the whole finalise failing.
-- * save_media_labels now runs private.save_media_labels_as(actor, ...): the
--   same body (20261107100200_manager_staff_denials.sql) with the actor as an
--   argument, plus one rule: a successful save by the uploader deletes their
--   stored draft of the asset (pending or needs_attention): the direct POST,
--   "Fix labels" and finalise's apply all save as the uploader. An admin's
--   save leaves it, so the uploader's labels never vanish from their Me list
--   unseen; they fix or discard it themselves.
-- * A draft goes with its asset: on delete cascade, and the tombstone trigger
--   below for user removals and the 24 h abandoned-upload cleanup, which
--   tombstone rows rather than deleting them. finalise deletes the draft of a
--   file that can never be used (validation failure; its original is removed,
--   so stage_media_labels refuses it from then on). A temporary failure keeps
--   the draft for the Retry.
-- * Accepted risk: a stored draft has no version of its own. A POST the
--   browser gave up on (network error) that still reaches the server after a
--   newer POST replaces the newer draft. The browser sends one POST per photo
--   at a time, so this needs a request that failed on the phone yet arrived
--   late. finalise then applies the older labels and reports exactly what it
--   applied, so the phone shows what the photo really has, but the newer
--   choice is lost. Closing it needs a per-photo sequence sent by the browser
--   (a contract change), not worth it for a request that must fail and still
--   land.
-- * public.upload_label_metrics: admin-only measurement, see the view.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.media_pending_labels (
  asset_id uuid primary key,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null,
  -- The complete SaveLabelsInput as the browser sent it, checked for shape by
  -- the server before it is stored. save_media_labels validates it in full
  -- when it is applied.
  input jsonb not null check (
    jsonb_typeof(input) = 'object' and octet_length(input::text) <= 16384
  ),
  catalogue_version_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'needs_attention')),
  -- SaveLabelsErrorCode of the failed apply; message: the database error
  -- behind it (diagnostics only, the app shows its own text for the code).
  code text check (code in (
    'conflict', 'unavailable_items', 'not_found', 'forbidden', 'invalid',
    'catalogue_changed', 'unavailable'
  )),
  message text check (message is null or length(message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_pending_labels_status_code check ((status = 'pending') = (code is null)),
  -- Same venue as the asset (its upload-time venue), like media_labels.
  constraint media_pending_labels_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete cascade
);

create index media_pending_labels_uploader_idx
  on public.media_pending_labels (uploader_id, updated_at desc);
create index media_pending_labels_attention_idx
  on public.media_pending_labels (venue_id) where status = 'needs_attention';

comment on table public.media_pending_labels is
  'Labels chosen while a photo was still uploading: applied by finalise when the photo is ready, or kept as needs_attention when they could not be.';

create trigger media_pending_labels_set_updated_at
  before update on public.media_pending_labels
  for each row execute function private.set_updated_at();

revoke all on public.media_pending_labels from public, anon, authenticated;
grant select, delete on public.media_pending_labels to authenticated;
grant select, insert, update, delete on public.media_pending_labels to service_role;

alter table public.media_pending_labels enable row level security;

create policy media_pending_labels_select_own on public.media_pending_labels
  for select to authenticated
  using (uploader_id = (select auth.uid()) and (select private.is_active_staff()));
create policy media_pending_labels_delete_own on public.media_pending_labels
  for delete to authenticated
  using (uploader_id = (select auth.uid()) and (select private.is_active_staff()));

-- ---------------------------------------------------------------------------
-- save_media_labels with an explicit actor
-- ---------------------------------------------------------------------------

-- Body as public.save_media_labels in 20261107100200_manager_staff_denials.sql,
-- with v_uid taken from p_actor instead of auth.uid(), plus the delete of the
-- actor's own stored draft before the result. Not callable by API roles: the
-- actor is trusted.
create function private.save_media_labels_as(
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
  if v_role not in ('staff', 'admin') then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  -- Serialises every label save of this asset with finalise/delete. No column changes.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.deleted_at is not null
     or v_asset.upload_state <> 'ready'
     or (v_role = 'staff' and v_asset.uploader_id <> v_uid) then
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

revoke all on function private.save_media_labels_as(uuid, uuid, integer, text[], text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;

-- Same signature, result and errors as before: the caller is the actor.
create or replace function public.save_media_labels(
  p_asset_id uuid,
  p_expected_revision integer,
  p_content_types text[],
  p_note text,
  p_items jsonb,
  p_missing_item text default null,
  p_catalogue_version_id uuid default null
)
returns table (revision integer, has_labels boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select s.revision, s.has_labels
  from private.save_media_labels_as(
    (select auth.uid()), p_asset_id, p_expected_revision, p_content_types,
    p_note, p_items, p_missing_item, p_catalogue_version_id
  ) as s;
$$;

-- ---------------------------------------------------------------------------
-- Error codes
-- ---------------------------------------------------------------------------

-- The SaveLabelsErrorCode of a save_media_labels error: the same mapping as
-- classify() in lib/server/labels/index.ts (by message, then SQLSTATE).
create function private.label_save_error_code(p_message text, p_sqlstate text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message = 'label_conflict' then 'conflict'
    when p_message = 'menu_catalogue_conflict' then 'catalogue_changed'
    when p_message = 'menu_item_unavailable' then 'unavailable_items'
    when p_message = 'media_asset_not_found' or p_sqlstate = 'P0002' then 'not_found'
    when p_message = 'not_active_user' or p_sqlstate = '42501' then 'forbidden'
    when p_message = 'menu_item_wrong_venue'
      or p_message like 'invalid\_%'
      or p_message like '%\_too\_long'
      or p_sqlstate in ('22023', '22P02', '22003', '22004') then 'invalid'
    else 'unavailable'
  end;
$$;

revoke all on function private.label_save_error_code(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- stage_media_labels: store a draft, or say the asset is ready
-- ---------------------------------------------------------------------------

-- The caller's own general-purpose asset at p_venue_id (its upload-time
-- venue), not deleted, and if failed then only temporarily: its original is
-- still in storage, so finalise can run again (it removes the original of a
-- file that can never be used). Anything else is media_asset_not_found, like
-- an unknown id. 'pending': the draft is stored (a repeat replaces it and
-- clears any earlier problem). 'ready': nothing is stored; save through
-- save_media_labels now. The asset row lock orders this with
-- complete_media_finalise (see the top of this file).
create function public.stage_media_labels(
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
  if v_uid is null or not private.is_active_staff() then
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

revoke all on function public.stage_media_labels(uuid, uuid, jsonb) from public, anon;
grant execute on function public.stage_media_labels(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- complete_media_finalise: ready + stored draft, one transaction
-- ---------------------------------------------------------------------------

-- finalise's last step (lib/server/media/finalise.ts), service role only. Sets
-- the validated metadata and `ready` on a `processing`, non-deleted asset (the
-- compare-and-set finalise used to do through PostgREST; a NULL path keeps the
-- stored one). became_ready = false: nothing matched (deleted, or another
-- finalise took the claim over); nothing else changed. Then, under the same
-- asset row lock, applies the asset's stored draft as its uploader:
--   labels_state null:              no stored draft;
--   labels_state 'saved':           applied, draft deleted; labels_revision
--                                   and labels_has_labels as save_media_labels
--                                   returns them;
--   labels_state 'needs_attention': not applied, draft kept with labels_code.
-- The apply runs in a subtransaction, so its failure never undoes `ready`.
-- It waits at most 3 s for any lock (lock_timeout, this transaction only): a
-- longer wait, e.g. behind a menu activation holding the venue lock, is
-- 55P03, caught like any failed apply ('unavailable'), rather than running
-- into a statement timeout or cancel (57014), which `when others` does not
-- catch and which would roll back `ready` too.
create function public.complete_media_finalise(
  p_asset_id uuid,
  p_validated_mime_type text,
  p_size_bytes bigint,
  p_width integer default null,
  p_height integer default null,
  p_duration_seconds numeric default null,
  p_preview_path text default null,
  p_thumbnail_path text default null
)
returns table (
  became_ready boolean,
  labels_state text,
  labels_code text,
  labels_revision integer,
  labels_has_labels boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uploader uuid;
  v_pending public.media_pending_labels;
  v_input jsonb;
  v_types text[];
  v_code text;
  v_message text;
  v_state text;
  v_revision integer;
  v_has boolean;
  v_lock_timeout text := current_setting('lock_timeout');
begin
  update public.media_assets a
  set upload_state = 'ready',
      validated_mime_type = p_validated_mime_type,
      size_bytes = p_size_bytes,
      width = p_width,
      height = p_height,
      duration_seconds = p_duration_seconds,
      preview_path = coalesce(p_preview_path, a.preview_path),
      thumbnail_path = coalesce(p_thumbnail_path, a.thumbnail_path)
  where a.id = p_asset_id
    and a.upload_state = 'processing'
    and a.deleted_at is null
  returning a.uploader_id into v_uploader;
  if not found then
    return query select false, null::text, null::text, null::integer, null::boolean;
    return;
  end if;

  select pl.* into v_pending
  from public.media_pending_labels pl
  where pl.asset_id = p_asset_id
  for update;
  if not found then
    return query select true, null::text, null::text, null::integer, null::boolean;
    return;
  end if;

  begin
    -- Undone with the subtransaction on failure; restored below on success.
    perform set_config('lock_timeout', '3s', true);
    v_input := v_pending.input;
    select coalesce(array_agg(t.value), '{}') into v_types
    from jsonb_array_elements_text(coalesce(v_input -> 'contentTypes', '[]'::jsonb)) as t(value);
    -- Deletes the draft on success (save_media_labels_as).
    select s.revision, s.has_labels into v_revision, v_has
    from private.save_media_labels_as(
      v_uploader,
      p_asset_id,
      (v_input ->> 'expectedRevision')::integer,
      v_types,
      v_input ->> 'note',
      coalesce(v_input -> 'items', '[]'::jsonb),
      v_input ->> 'missingItem',
      v_pending.catalogue_version_id
    ) as s;
    v_state := 'saved';
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_code := private.label_save_error_code(v_message, sqlstate);
    update public.media_pending_labels pl
    set status = 'needs_attention', code = v_code, message = left(v_message, 500)
    where pl.asset_id = p_asset_id;
    v_state := 'needs_attention';
  end;
  perform set_config('lock_timeout', v_lock_timeout, true);

  return query select true, v_state, v_code, v_revision, v_has;
end;
$$;

revoke all on function public.complete_media_finalise(uuid, text, bigint, integer, integer, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_media_finalise(uuid, text, bigint, integer, integer, numeric, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- A draft goes with its asset
-- ---------------------------------------------------------------------------

-- Removal (delete_media_asset) and the abandoned-upload cleanup
-- (prepare_media_cleanup) tombstone the asset; its draft can never apply.
create function private.media_assets_discard_pending_labels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.media_pending_labels pl where pl.asset_id = new.id;
  return null;
end;
$$;

create trigger media_assets_discard_pending_labels
  after update of deleted_at on public.media_assets
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.media_assets_discard_pending_labels();

revoke all on function private.media_assets_discard_pending_labels() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Measurement (Phase 3): public.upload_label_metrics
-- ---------------------------------------------------------------------------

-- Current needs_attention drafts per venue and upload day (London), for the
-- view below. Counts only, and only for an active admin: nobody else learns
-- anything about other people's drafts.
create function private.pending_label_attention_counts()
returns table (venue_id uuid, day date, needs_attention bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select pl.venue_id, (a.created_at at time zone 'Europe/London')::date, count(*)
  from public.media_pending_labels pl
  join public.media_assets a on a.id = pl.asset_id
  where pl.status = 'needs_attention'
    and a.deleted_at is null
    and (select private.is_active_admin())
  group by pl.venue_id, (a.created_at at time zone 'Europe/London')::date;
$$;

revoke all on function private.pending_label_attention_counts() from public, anon;
grant execute on function private.pending_label_attention_counts() to authenticated, service_role;

-- Label coverage per venue and upload day (Europe/London), read-only and
-- in-database only (no third-party service). Rows for an active admin only:
-- everyone else, managers included, reads nothing. security_invoker, so the
-- caller's own RLS applies to every table read (admins read ready assets,
-- their labels and the label audit).
--   uploads                 ready, non-deleted general (portfolio) uploads
--                           reserved that day;
--   uploads_labelled        of those, how many have labels now (has_labels);
--   share_labelled          uploads_labelled / uploads (0..1, 4 places);
--   median_seconds_to_label, p90_seconds_to_label
--                           seconds from reservation (media_assets.created_at,
--                           the closest stored proxy for "photo picked") to
--                           the first save that gave the asset any item or
--                           content type (media_label_events), over the
--                           uploads that have one;
--   needs_attention         current needs_attention drafts of that venue/day.
-- Example: select * from upload_label_metrics where day >= current_date - 14;
create view public.upload_label_metrics
with (security_invoker = true)
as
with uploads as (
  select
    a.venue_id,
    (a.created_at at time zone 'Europe/London')::date as day,
    coalesce(l.has_labels, false) as labelled,
    extract(epoch from (
      select min(e.created_at)
      from public.media_label_events e
      where e.asset_id = a.id
        and e.action = 'labels_saved'
        and (
          jsonb_array_length(coalesce(e.after -> 'items', '[]'::jsonb)) > 0
          or jsonb_array_length(coalesce(e.after -> 'contentTypes', '[]'::jsonb)) > 0
        )
    ) - a.created_at) as seconds_to_label
  from public.media_assets a
  left join public.media_labels l on l.asset_id = a.id
  where a.purpose = 'general'
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and (select private.is_active_admin())
),
per_day as (
  select
    u.venue_id,
    u.day,
    count(*) as uploads,
    count(*) filter (where u.labelled) as uploads_labelled,
    percentile_cont(0.5) within group (order by u.seconds_to_label)
      filter (where u.seconds_to_label is not null) as median_seconds,
    percentile_cont(0.9) within group (order by u.seconds_to_label)
      filter (where u.seconds_to_label is not null) as p90_seconds
  from uploads u
  group by u.venue_id, u.day
)
select
  coalesce(d.venue_id, n.venue_id) as venue_id,
  v.name as venue_name,
  coalesce(d.day, n.day) as day,
  coalesce(d.uploads, 0) as uploads,
  coalesce(d.uploads_labelled, 0) as uploads_labelled,
  round(d.uploads_labelled::numeric / nullif(d.uploads, 0), 4) as share_labelled,
  round(d.median_seconds::numeric, 1) as median_seconds_to_label,
  round(d.p90_seconds::numeric, 1) as p90_seconds_to_label,
  coalesce(n.needs_attention, 0) as needs_attention
from per_day d
full join private.pending_label_attention_counts() n
  on n.venue_id = d.venue_id and n.day = d.day
left join public.venues v on v.id = coalesce(d.venue_id, n.venue_id);

comment on view public.upload_label_metrics is
  'Admin-only label coverage per venue and London day: uploads, labelled share, time from reservation to first label, needs_attention drafts.';

revoke all on public.upload_label_metrics from public, anon, authenticated;
grant select on public.upload_label_metrics to authenticated, service_role;
