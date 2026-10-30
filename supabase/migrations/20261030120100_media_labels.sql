-- NabaLens v0.3 optional media labels (spec v0.3 §2-3, contract §3 + A1).
-- A label describes one asset with 0-20 catalogue items (+ variant), 0-4
-- controlled content types and a short note. Labels never change whether an
-- asset is visible and label code never updates public.media_assets.
--
-- Venue integrity is structural: media_labels (asset_id, venue_id) references
-- media_assets (id, venue_id), and every label item references both its label
-- and its menu item by (…, venue_id), so a label item's item, the asset and the
-- label always belong to the same venue (the asset's upload-time venue).

-- Constraint only (no column change, guard triggers untouched): the target of
-- the composite foreign keys below.
alter table public.media_assets
  add constraint media_assets_id_venue_key unique (id, venue_id);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.media_labels (
  asset_id uuid primary key,
  venue_id uuid not null,
  content_types text[] not null default '{}' check (
    content_types <@ array['dish', 'preparation', 'plating', 'drinks', 'kitchen', 'team', 'venue', 'event']::text[]
    and cardinality(content_types) <= 4
    and private.text_array_is_distinct_set(content_types)
  ),
  note text check (note is null or (length(note) between 1 and 280 and note = btrim(note))),
  has_labels boolean not null default false,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  constraint media_labels_asset_venue_key unique (asset_id, venue_id),
  constraint media_labels_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete cascade
);

create index media_labels_venue_state_idx on public.media_labels (venue_id, has_labels);

comment on table public.media_labels is
  'Optional label of one asset: content types, note and has_labels. Items are in media_label_items.';

create table public.media_label_items (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  venue_id uuid not null,
  item_id uuid not null,
  variant_id uuid,
  -- Snapshot of what the labeller saw (from the active version at the time).
  item_name text not null check (length(item_name) between 1 and 120),
  variant_name text check (variant_name is null or length(variant_name) between 1 and 80),
  section_name text check (section_name is null or length(section_name) between 1 and 120),
  section_slug text check (section_slug is null or length(section_slug) between 1 and 80),
  version_id uuid,
  added_by uuid references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  -- Asset-leading: also the per-asset lookup index (A1.11).
  constraint media_label_items_tuple_key unique nulls not distinct (asset_id, item_id, variant_id),
  constraint media_label_items_label_fkey foreign key (asset_id, venue_id)
    references public.media_labels (asset_id, venue_id) on delete cascade,
  constraint media_label_items_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint media_label_items_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint media_label_items_version_fkey foreign key (version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint media_label_items_variant_snapshot check ((variant_id is null) = (variant_name is null))
);

create index media_label_items_item_idx on public.media_label_items (item_id);
create index media_label_items_variant_idx on public.media_label_items (variant_id)
  where variant_id is not null;
create index media_label_items_section_slug_idx on public.media_label_items (section_slug);

create table public.media_label_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null,
  venue_id uuid not null,
  actor_id uuid references public.profiles (id) on delete restrict,
  actor_role public.app_role,
  action text not null check (action in ('labels_saved')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index media_label_events_asset_idx on public.media_label_events (asset_id, created_at desc);

comment on table public.media_label_events is
  'Append-only audit of label saves with before/after state. Written only by save_media_labels.';

create table public.menu_item_suggestions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  asset_id uuid,
  suggested_name text not null check (
    length(suggested_name) between 1 and 120 and suggested_name = btrim(suggested_name)
  ),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed', 'withdrawn')),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_item_id uuid,
  resolved_by uuid references public.profiles (id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text check (
    resolution_note is null or (length(resolution_note) between 1 and 280)
  ),
  -- The asset belongs to the suggestion's venue (A1.2); a hard-deleted asset
  -- leaves the suggestion with no asset.
  constraint menu_item_suggestions_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete set null (asset_id),
  constraint menu_item_suggestions_item_fkey foreign key (resolved_item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_item_suggestions_resolved_has_item check (
    status <> 'resolved' or resolved_item_id is not null
  )
);

-- One open suggestion per person per asset (save_media_labels upserts it).
create unique index menu_item_suggestions_open_key
  on public.menu_item_suggestions (asset_id, created_by) where status = 'open';
create index menu_item_suggestions_venue_status_idx
  on public.menu_item_suggestions (venue_id, status);

comment on table public.menu_item_suggestions is
  'Missing-item reports from labelling. Never creates catalogue items by itself.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function private.media_labels_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_id is distinct from old.asset_id
     or new.venue_id is distinct from old.venue_id
     or new.created_at is distinct from old.created_at then
    raise exception 'media_label_identity_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.menu_item_suggestions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or (new.asset_id is distinct from old.asset_id and new.asset_id is not null) then
    raise exception 'menu_item_suggestion_identity_immutable' using errcode = '42501';
  end if;
  if old.status <> 'open' and (
       new.status is distinct from old.status
       or new.suggested_name is distinct from old.suggested_name) then
    raise exception 'menu_item_suggestion_closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger media_labels_guard
  before update on public.media_labels
  for each row execute function private.media_labels_guard();
create trigger media_labels_set_updated_at
  before update on public.media_labels
  for each row execute function private.set_updated_at();

-- Label items are replaced, never edited, so their snapshot stays honest.
create trigger media_label_items_immutable
  before update on public.media_label_items
  for each row execute function private.immutable_row_guard();

create trigger menu_item_suggestions_guard
  before update on public.menu_item_suggestions
  for each row execute function private.menu_item_suggestions_guard();
create trigger menu_item_suggestions_set_updated_at
  before update on public.menu_item_suggestions
  for each row execute function private.set_updated_at();

create trigger media_label_events_append_only
  before update or delete on public.media_label_events
  for each row execute function private.append_only_guard();
create trigger media_label_events_no_truncate
  before truncate on public.media_label_events
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- Whether the caller may read an asset's labels: active staff for their own
-- non-deleted asset; active admin for a non-deleted `ready` asset (A1.1).
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
      )
  );
$$;

-- A1.9: staff read a menu item only when it is in an active version they may
-- read, or attached to one of their own non-deleted assets.
create or replace function private.staff_can_read_menu_item(p_item_id uuid, p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_staff() and (
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
  );
$$;

create or replace function private.staff_can_read_menu_variant(p_variant_id uuid, p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_staff() and (
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
  );
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.media_labels, public.media_label_items, public.media_label_events,
  public.menu_item_suggestions
from public, anon, authenticated;

grant select on public.media_labels, public.media_label_items, public.media_label_events,
  public.menu_item_suggestions
to authenticated;

grant all on public.media_labels, public.media_label_items, public.menu_item_suggestions
to service_role;
grant select, insert on public.media_label_events to service_role;
revoke update, delete, truncate on public.media_label_events from service_role;

alter table public.media_labels enable row level security;
alter table public.media_label_items enable row level security;
alter table public.media_label_events enable row level security;
alter table public.menu_item_suggestions enable row level security;

-- One policy each: no unrestricted admin policy on label rows (A1.1).
create policy media_labels_select on public.media_labels
  for select to authenticated using (private.can_read_asset_labels(asset_id));
create policy media_label_items_select on public.media_label_items
  for select to authenticated using (private.can_read_asset_labels(asset_id));

create policy media_label_events_select_admin on public.media_label_events
  for select to authenticated using ((select private.is_active_admin()));

create policy menu_item_suggestions_select_admin on public.menu_item_suggestions
  for select to authenticated using ((select private.is_active_admin()));
create policy menu_item_suggestions_select_own on public.menu_item_suggestions
  for select to authenticated
  using (created_by = (select auth.uid()) and (select private.is_active_user()));

create policy menu_items_select_staff on public.menu_items
  for select to authenticated using (private.staff_can_read_menu_item(id, venue_id));
create policy menu_variants_select_staff on public.menu_variants
  for select to authenticated using (private.staff_can_read_menu_variant(id, venue_id));

-- ---------------------------------------------------------------------------
-- save_media_labels
-- ---------------------------------------------------------------------------

-- Label one asset (complete desired state). Order (A1.4/A1.5): lock the asset
-- row, check caller/asset, lock and compare the label revision, then (only
-- when new tuples are added) take the venue lock shared and validate them
-- against the venue's active version. Existing tuples, exactly
-- (item_id, variant_id), keep their snapshot and added_by/added_at.
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
  v_uid uuid := auth.uid();
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

  return query select v_revision + 1, v_has;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_menu_item_suggestion (active admin)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_menu_item_suggestion(
  p_suggestion_id uuid,
  p_status text,
  p_item_id uuid default null,
  p_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_venue uuid;
  v_status text;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_status is null or p_status not in ('resolved', 'dismissed') then
    raise exception 'invalid_suggestion_status' using errcode = '22023';
  end if;
  if length(v_note) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  if p_status = 'resolved' and p_item_id is null then
    raise exception 'invalid_suggestion_item' using errcode = '22023',
      detail = 'Resolving a suggestion links it to a menu item.';
  end if;

  select s.venue_id into v_venue from public.menu_item_suggestions s where s.id = p_suggestion_id;
  if v_venue is null then
    raise exception 'menu_item_suggestion_not_found' using errcode = 'P0002';
  end if;

  perform private.lock_venue_menu(v_venue);
  select s.status into v_status from public.menu_item_suggestions s where s.id = p_suggestion_id for update;
  if v_status <> 'open' then
    raise exception 'menu_item_suggestion_not_open' using errcode = 'P0001';
  end if;

  if p_status = 'resolved' and not exists (
    select 1 from public.menu_items i where i.id = p_item_id and i.venue_id = v_venue
  ) then
    raise exception 'menu_item_wrong_venue' using errcode = '22023';
  end if;

  update public.menu_item_suggestions s
  set status = p_status,
      resolved_item_id = (select p_item_id where p_status = 'resolved'),
      resolved_by = v_uid,
      resolved_at = now(),
      resolution_note = v_note
  where s.id = p_suggestion_id;

  if p_status = 'resolved' then
    insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
    values (v_venue, p_item_id, v_uid, 'suggestion_resolved',
      jsonb_build_object('suggestionId', p_suggestion_id));
  else
    insert into public.menu_events (venue_id, actor_id, action, detail)
    values (v_venue, v_uid, 'suggestion_dismissed',
      jsonb_build_object('suggestionId', p_suggestion_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- media_label_details (A1.9)
-- ---------------------------------------------------------------------------

-- Display rows for the label items of up to 100 assets the caller may read
-- labels of (same rule as the label RLS). Current-name rule: the venue's
-- active version entry; else the most recently activated (now retired)
-- version's entry; else the label snapshot. Drafts and discarded versions
-- never supply names. state: archived > current (in the active version, with
-- its variant) > not_on_active_menu.
create or replace function public.media_label_details(p_asset_ids uuid[])
returns table (
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  name text,
  variant_name text,
  section_name text,
  section_slug text,
  snapshot_name text,
  snapshot_variant_name text,
  snapshot_section_name text,
  state text,
  added_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if cardinality(p_asset_ids) > 100 then
    raise exception 'too_many_assets' using errcode = '22023';
  end if;

  return query
    select
      li.asset_id,
      li.item_id,
      li.variant_id,
      coalesce(cur.name, li.item_name),
      coalesce(curv.name, li.variant_name),
      coalesce(cur.section_name, li.section_name),
      coalesce(cur.section_slug, li.section_slug),
      li.item_name,
      li.variant_name,
      li.section_name,
      coalesce(
        (select 'archived'::text where i.archived_at is not null),
        (select 'current'::text where cur.is_active and (li.variant_id is null or curv.is_active)),
        'not_on_active_menu'
      ),
      li.added_at
    from (select distinct u.id from unnest(coalesce(p_asset_ids, '{}')) as u(id)) ids
    join public.media_label_items li on li.asset_id = ids.id
    join public.menu_items i on i.id = li.item_id
    left join lateral (
      select e.name, s.name as section_name, s.slug as section_slug, v.status = 'active' as is_active
      from public.menu_entries e
      join public.menu_versions v on v.id = e.version_id
      join public.menu_sections s on s.id = e.section_id
      where e.item_id = li.item_id
        and v.venue_id = li.venue_id
        and v.status in ('active', 'retired')
        and v.activated_at is not null
      order by v.status = 'active' desc, v.activated_at desc
      limit 1
    ) cur on true
    left join lateral (
      select ev.name, v.status = 'active' as is_active
      from public.menu_entry_variants ev
      join public.menu_entries e on e.id = ev.entry_id
      join public.menu_versions v on v.id = e.version_id
      where ev.variant_id = li.variant_id
        and v.venue_id = li.venue_id
        and v.status in ('active', 'retired')
        and v.activated_at is not null
      order by v.status = 'active' desc, v.activated_at desc
      limit 1
    ) curv on li.variant_id is not null
    where private.can_read_asset_labels(li.asset_id)
    order by li.asset_id, li.added_at, li.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- library_assets (A1.10)
-- ---------------------------------------------------------------------------

-- Admin library / portfolio label filters. SECURITY INVOKER, LANGUAGE sql,
-- STABLE, no SET clause and one SELECT, so PostgreSQL inlines it into the
-- caller's query: PostgREST's filters, order, limit and embeds apply to the
-- media_assets rows directly and the caller's RLS applies to every table.
-- Each predicate is an EXISTS, so an asset appears at most once. Every NULL
-- argument is "no filter". Unknown p_label_state / p_content_type values
-- match nothing.
--   p_item / p_variant: a label tuple with that item and/or variant (same tuple);
--   p_category: a label tuple whose snapshot section slug, or whose item's
--     section in the venue's active version, is p_category (asset-wide);
--   p_query: case-insensitive substring (wildcards escaped) of the note, label
--     snapshots, any visible entry name/alias of a labelled item, or an open
--     suggestion visible to the caller.
create or replace function public.library_assets(
  p_item uuid default null,
  p_variant uuid default null,
  p_category text default null,
  p_content_type text default null,
  p_label_state text default null,
  p_query text default null
)
returns setof public.media_assets
language sql
stable
security invoker
as $$
  select a.*
  from public.media_assets a
  cross join lateral (
    -- Escape the LIKE wildcards and the escape character itself (chr(92) is
    -- a backslash, the default ILIKE escape).
    select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
      pg_catalog.btrim(p_query), pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92)),
      '%', pg_catalog.chr(92) || '%'), '_', pg_catalog.chr(92) || '_') || '%' as pattern
  ) q
  where
    (
      (p_item is null and p_variant is null)
      or exists (
        select 1 from public.media_label_items li
        where li.asset_id = a.id
          and (p_item is null or li.item_id = p_item)
          and (p_variant is null or li.variant_id = p_variant)
      )
    )
    and (
      p_category is null
      or exists (
        select 1 from public.media_label_items li
        where li.asset_id = a.id and li.section_slug = p_category
      )
      or exists (
        select 1
        from public.media_label_items li
        join public.menu_entries e on e.item_id = li.item_id
        join public.menu_versions v on v.id = e.version_id
        join public.menu_sections s on s.id = e.section_id
        where li.asset_id = a.id
          and v.venue_id = a.venue_id
          and v.status = 'active'
          and s.slug = p_category
      )
    )
    and (
      p_content_type is null
      or exists (
        select 1 from public.media_labels l
        where l.asset_id = a.id and p_content_type = any (l.content_types)
      )
    )
    and (
      p_label_state is null
      or (
        p_label_state = 'labelled'
        and exists (select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels)
      )
      or (
        p_label_state = 'unlabelled'
        and not exists (select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels)
      )
    )
    and (
      p_query is null
      or pg_catalog.btrim(p_query) = ''
      or exists (
        select 1 from public.media_labels l
        where l.asset_id = a.id and l.note ilike q.pattern
      )
      or exists (
        select 1 from public.media_label_items li
        where li.asset_id = a.id
          and (
            li.item_name ilike q.pattern
            or li.variant_name ilike q.pattern
            or li.section_name ilike q.pattern
          )
      )
      or exists (
        select 1
        from public.media_label_items li
        join public.menu_entries e on e.item_id = li.item_id
        where li.asset_id = a.id
          and (
            e.name ilike q.pattern
            or exists (select 1 from pg_catalog.unnest(e.aliases) as al(alias) where al.alias ilike q.pattern)
          )
      )
      or exists (
        select 1 from public.menu_item_suggestions s
        where s.asset_id = a.id and s.status = 'open' and s.suggested_name ilike q.pattern
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.media_labels_guard(),
  private.menu_item_suggestions_guard(),
  private.can_read_asset_labels(uuid),
  private.staff_can_read_menu_item(uuid, uuid),
  private.staff_can_read_menu_variant(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.media_labels_guard(),
  private.menu_item_suggestions_guard(),
  private.can_read_asset_labels(uuid),
  private.staff_can_read_menu_item(uuid, uuid),
  private.staff_can_read_menu_variant(uuid, uuid)
to authenticated, service_role;

revoke all on function
  public.save_media_labels(uuid, integer, text[], text, jsonb, text, uuid),
  public.resolve_menu_item_suggestion(uuid, text, uuid, text),
  public.media_label_details(uuid[]),
  public.library_assets(uuid, uuid, text, text, text, text)
from public, anon;

grant execute on function
  public.save_media_labels(uuid, integer, text[], text, jsonb, text, uuid),
  public.resolve_menu_item_suggestion(uuid, text, uuid, text),
  public.media_label_details(uuid[]),
  public.library_assets(uuid, uuid, text, text, text, text)
to authenticated, service_role;
