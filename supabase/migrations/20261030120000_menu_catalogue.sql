-- NabaLens v0.3 venue menu catalogue (docs/spec/NabaLens-Menus-Labels-v0.3.md,
-- docs/fanout/CONTRACT-v0.3-menus.md §3 and amendment A1). Data model notes:
-- docs/menus-data-model.md.
--
-- Shape: a venue has catalogue *versions* (draft -> active -> retired, or
-- draft -> discarded; at most one active). A version's content is sections ->
-- entries -> entry variants. Entries point at *stable identities*
-- (menu_items / menu_variants) that carry across versions, so a label made
-- against one version keeps meaning after a rename, a section move or a
-- re-import.
--
-- End users never write these tables directly: every write is a SECURITY
-- DEFINER RPC below that re-checks the caller's current profile on each call.
-- Composite foreign keys make "same venue" structural rather than a convention.

-- ---------------------------------------------------------------------------
-- Pure helpers used by check constraints
-- ---------------------------------------------------------------------------

-- 0..10 aliases, each 1..80 characters after trimming, no NULL elements.
create or replace function private.menu_aliases_valid(p_aliases text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_aliases is not null
    and cardinality(p_aliases) <= 10
    and array_position(p_aliases, null) is null
    and not exists (
      select 1 from unnest(p_aliases) as a(v)
      where length(btrim(a.v)) not between 1 and 80 or a.v <> btrim(a.v)
    );
$$;

-- True when the array has no NULLs and no repeated values.
create or replace function private.text_array_is_distinct_set(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_values is not null
    and array_position(p_values, null) is null
    and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as u(v));
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.menu_versions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired', 'discarded')),
  title text not null check (length(btrim(title)) between 1 and 120),
  source_kind text not null default 'manual' check (source_kind in ('manual', 'json', 'csv')),
  source_label text check (source_label is null or length(source_label) between 1 and 200),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  source_revision text check (source_revision is null or length(source_revision) between 1 and 80),
  source_captured_at timestamptz,
  source_notes text check (source_notes is null or length(source_notes) between 1 and 1000),
  based_on_version_id uuid,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  activated_by uuid references public.profiles (id) on delete restrict,
  activated_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  retired_at timestamptz,
  constraint menu_versions_id_venue_key unique (id, venue_id),
  -- A draft can only be based on a version of the same venue (A1.2).
  constraint menu_versions_based_on_fkey foreign key (based_on_version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_versions_active_was_activated check (
    status not in ('active', 'retired') or activated_at is not null
  ),
  constraint menu_versions_retired_has_time check (status <> 'retired' or retired_at is not null)
);

-- At most one active catalogue per venue.
create unique index menu_versions_one_active_per_venue
  on public.menu_versions (venue_id) where status = 'active';
create index menu_versions_venue_idx on public.menu_versions (venue_id, created_at desc);

comment on table public.menu_versions is
  'A venue menu at one point in time. Only an explicitly activated version is used for labelling.';

create table public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  venue_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null default 'food' check (kind in ('food', 'drinks', 'other')),
  position integer not null check (position >= 0),
  constraint menu_sections_version_slug_key unique (version_id, slug),
  constraint menu_sections_identity_key unique (id, version_id, venue_id),
  constraint menu_sections_version_fkey foreign key (version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete restrict,
  constraint menu_items_id_venue_key unique (id, venue_id),
  constraint menu_items_archived_by_needs_time check (archived_by is null or archived_at is not null)
);

create index menu_items_venue_idx on public.menu_items (venue_id);

comment on table public.menu_items is
  'Stable identity of one dish/drink of one venue, carried across catalogue versions. Never shared between venues.';

create table public.menu_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  venue_id uuid not null,
  created_at timestamptz not null default now(),
  constraint menu_variants_id_item_key unique (id, item_id),
  constraint menu_variants_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict
);

create index menu_variants_item_idx on public.menu_variants (item_id);

create table public.menu_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  venue_id uuid not null,
  section_id uuid not null,
  item_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) between 1 and 600),
  aliases text[] not null default '{}' check (private.menu_aliases_valid(aliases)),
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9:_-]{0,159}$'),
  source_meta jsonb not null default '{}'::jsonb check (
    jsonb_typeof(source_meta) = 'object' and pg_column_size(source_meta) < 8192
  ),
  position integer not null check (position >= 0),
  needs_review boolean not null default false,
  review_candidates uuid[] not null default '{}' check (
    cardinality(review_candidates) <= 20 and array_position(review_candidates, null) is null
  ),
  review_reason text check (review_reason is null or length(review_reason) between 1 and 200),
  constraint menu_entries_version_item_key unique (version_id, item_id),
  constraint menu_entries_version_source_key_key unique (version_id, source_key),
  constraint menu_entries_id_item_key unique (id, item_id),
  constraint menu_entries_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_entries_version_fkey foreign key (version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  -- The section belongs to the same version and venue (A1.2).
  constraint menu_entries_section_fkey foreign key (section_id, version_id, venue_id)
    references public.menu_sections (id, version_id, venue_id) on delete restrict
);

create index menu_entries_item_idx on public.menu_entries (item_id);
create index menu_entries_version_section_idx
  on public.menu_entries (version_id, section_id, position);

comment on table public.menu_entries is
  'Per-version name, section, description and source metadata of a stable menu item.';

create table public.menu_entry_variants (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  item_id uuid not null,
  variant_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  position integer not null check (position >= 0),
  constraint menu_entry_variants_entry_variant_key unique (entry_id, variant_id),
  -- Entry and variant agree on the item (A1.2).
  constraint menu_entry_variants_entry_fkey foreign key (entry_id, item_id)
    references public.menu_entries (id, item_id) on delete cascade,
  constraint menu_entry_variants_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict
);

-- Two variants of one entry may not share a name (A1.3).
create unique index menu_entry_variants_entry_name_key
  on public.menu_entry_variants (entry_id, lower(btrim(name)));
create index menu_entry_variants_variant_idx on public.menu_entry_variants (variant_id);

create table public.menu_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  version_id uuid,
  item_id uuid,
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null check (action in (
    'draft_created', 'draft_saved', 'activated', 'retired', 'discarded',
    'item_archived', 'item_unarchived', 'suggestion_resolved', 'suggestion_dismissed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index menu_events_venue_idx on public.menu_events (venue_id, created_at desc);

comment on table public.menu_events is
  'Append-only audit of catalogue changes. Written only by the catalogue RPCs.';

-- ---------------------------------------------------------------------------
-- Triggers: lifecycle, immutability, append-only audit
-- ---------------------------------------------------------------------------

-- New versions always start as an unreviewed draft, whoever inserts them.
create or replace function private.menu_versions_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft'
     or new.reviewed_by is not null or new.reviewed_at is not null
     or new.activated_by is not null or new.activated_at is not null
     or new.retired_by is not null or new.retired_at is not null then
    raise exception 'menu_version_must_start_draft' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- A1.8: the header identity never changes; title/source/revision change only
-- while draft; status moves only draft -> active | discarded and
-- active -> retired; after leaving draft only the lifecycle fields of that
-- transition change. Applies to every role, including the RPC owner.
create or replace function private.menu_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.based_on_version_id is distinct from old.based_on_version_id then
    raise exception 'menu_version_identity_immutable' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('active', 'discarded'))
       or (old.status = 'active' and new.status = 'retired')
     ) then
    raise exception 'menu_version_invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.status, new.status);
  end if;

  if old.status <> 'draft' and (
       new.title is distinct from old.title
       or new.source_kind is distinct from old.source_kind
       or new.source_label is distinct from old.source_label
       or new.source_sha256 is distinct from old.source_sha256
       or new.source_revision is distinct from old.source_revision
       or new.source_captured_at is distinct from old.source_captured_at
       or new.source_notes is distinct from old.source_notes
       or new.revision is distinct from old.revision
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.activated_by is distinct from old.activated_by
       or new.activated_at is distinct from old.activated_at) then
    raise exception 'menu_version_immutable' using errcode = '42501',
      detail = 'Only the status and retirement fields of a non-draft version change.';
  end if;

  -- Retirement fields belong to active -> retired only.
  if (new.retired_by is distinct from old.retired_by or new.retired_at is distinct from old.retired_at)
     and not (old.status = 'active' and new.status = 'retired') then
    raise exception 'menu_version_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Content (sections, entries, entry variants) of a non-draft version is frozen
-- for every role: activation only flips the header status, so labels made
-- against an active version can always be explained later.
create or replace function private.assert_menu_version_draft(p_version_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.menu_versions v where v.id = p_version_id and v.status = 'draft'
  ) then
    raise exception 'menu_version_not_draft' using errcode = 'P0001',
      detail = 'Only a draft catalogue version can be edited.';
  end if;
end;
$$;

create or replace function private.menu_content_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.assert_menu_version_draft(old.version_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.assert_menu_version_draft(new.version_id);
    return new;
  end if;
  return old;
end;
$$;

-- Entry variants carry no version column: resolve it through the entry. A
-- cascaded delete runs after its entry is already gone (the entry delete was
-- guarded itself), so a missing entry means "part of an allowed delete".
create or replace function private.menu_entry_variants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select e.version_id into v_version from public.menu_entries e where e.id = old.entry_id;
    if found then
      perform private.assert_menu_version_draft(v_version);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select e.version_id into v_version from public.menu_entries e where e.id = new.entry_id;
    perform private.assert_menu_version_draft(v_version);
    return new;
  end if;
  return old;
end;
$$;

-- Stable identities: only the archive fields of an item ever change; variants
-- never change.
create or replace function private.menu_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'menu_item_identity_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.immutable_row_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'row_immutable' using errcode = '42501',
    detail = format('%s rows cannot be changed.', tg_table_name);
end;
$$;

-- Append-only audit: no update, delete or truncate for any role.
create or replace function private.append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_append_only' using errcode = '42501',
    detail = format('%s is append-only.', tg_table_name);
end;
$$;

create trigger menu_versions_insert_guard
  before insert on public.menu_versions
  for each row execute function private.menu_versions_insert_guard();
create trigger menu_versions_guard
  before update on public.menu_versions
  for each row execute function private.menu_versions_guard();
create trigger menu_versions_set_updated_at
  before update on public.menu_versions
  for each row execute function private.set_updated_at();

create trigger menu_sections_content_guard
  before insert or update or delete on public.menu_sections
  for each row execute function private.menu_content_guard();
create trigger menu_entries_content_guard
  before insert or update or delete on public.menu_entries
  for each row execute function private.menu_content_guard();
create trigger menu_entry_variants_content_guard
  before insert or update or delete on public.menu_entry_variants
  for each row execute function private.menu_entry_variants_guard();

create trigger menu_items_guard
  before update on public.menu_items
  for each row execute function private.menu_items_guard();
create trigger menu_variants_immutable
  before update on public.menu_variants
  for each row execute function private.immutable_row_guard();

create trigger menu_events_append_only
  before update or delete on public.menu_events
  for each row execute function private.append_only_guard();
create trigger menu_events_no_truncate
  before truncate on public.menu_events
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- Staff may read (and label with) a venue's active catalogue when they are
-- active staff AND the venue is their current venue OR they own a non-deleted
-- asset there. The second arm keeps a transferred staff member able to label
-- assets uploaded at their previous venue (spec v0.3 §3.1).
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
      and p.role = 'staff'
      and (
        p.venue_id = p_venue_id
        or exists (
          select 1 from public.media_assets a
          where a.uploader_id = p.id
            and a.venue_id = p_venue_id
            and a.deleted_at is null
        )
      )
  );
$$;

-- Supports the second arm above (A1.11).
create index media_assets_uploader_venue_idx
  on public.media_assets (uploader_id, venue_id)
  where deleted_at is null;

-- True when the caller is staff who may read this version: it is the active
-- version of a venue they may label. Drafts, retired and discarded versions
-- are admin-only.
create or replace function private.staff_can_read_menu_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.menu_versions v
    where v.id = p_version_id
      and v.status = 'active'
      and private.staff_can_label_venue(v.venue_id)
  );
$$;

-- The venue's active version, if any.
create or replace function private.active_menu_version_id(p_venue_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.menu_versions v
  where v.venue_id = p_venue_id and v.status = 'active';
$$;

-- A1.4: one lock order for every catalogue/label write. Catalogue writes take
-- the venue lock exclusively; label saves that add new items take it shared,
-- so they never validate against a version that is being replaced.
create or replace function private.lock_venue_menu(p_venue_id uuid, p_shared boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_shared then
    perform pg_advisory_xact_lock_shared(hashtextextended('nabalens_menu:' || p_venue_id::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('nabalens_menu:' || p_venue_id::text, 0));
  end if;
end;
$$;

create or replace function private.assert_active_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.menu_versions, public.menu_sections, public.menu_items,
  public.menu_variants, public.menu_entries, public.menu_entry_variants,
  public.menu_events
from public, anon, authenticated;

grant select on public.menu_versions, public.menu_sections, public.menu_items,
  public.menu_variants, public.menu_entries, public.menu_entry_variants,
  public.menu_events
to authenticated;

grant all on public.menu_versions, public.menu_sections, public.menu_items,
  public.menu_variants, public.menu_entries, public.menu_entry_variants
to service_role;
-- Audit rows are append-only for everyone (A1.13).
grant select, insert on public.menu_events to service_role;
revoke update, delete, truncate on public.menu_events from service_role;

alter table public.menu_versions enable row level security;
alter table public.menu_sections enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_variants enable row level security;
alter table public.menu_entries enable row level security;
alter table public.menu_entry_variants enable row level security;
alter table public.menu_events enable row level security;

create policy menu_versions_select_admin on public.menu_versions
  for select to authenticated using ((select private.is_active_admin()));
create policy menu_versions_select_staff on public.menu_versions
  for select to authenticated
  using (status = 'active' and private.staff_can_label_venue(venue_id));

create policy menu_sections_select_admin on public.menu_sections
  for select to authenticated using ((select private.is_active_admin()));
create policy menu_sections_select_staff on public.menu_sections
  for select to authenticated using (private.staff_can_read_menu_version(version_id));

create policy menu_entries_select_admin on public.menu_entries
  for select to authenticated using ((select private.is_active_admin()));
create policy menu_entries_select_staff on public.menu_entries
  for select to authenticated using (private.staff_can_read_menu_version(version_id));

create policy menu_entry_variants_select_admin on public.menu_entry_variants
  for select to authenticated using ((select private.is_active_admin()));
create policy menu_entry_variants_select_staff on public.menu_entry_variants
  for select to authenticated
  using (exists (
    select 1 from public.menu_entries e
    where e.id = entry_id and private.staff_can_read_menu_version(e.version_id)
  ));

-- Staff policies for menu_items / menu_variants are in 20261030120100 (they
-- also cover identities attached to the caller's own labelled assets).
create policy menu_items_select_admin on public.menu_items
  for select to authenticated using ((select private.is_active_admin()));
create policy menu_variants_select_admin on public.menu_variants
  for select to authenticated using ((select private.is_active_admin()));

create policy menu_events_select_admin on public.menu_events
  for select to authenticated using ((select private.is_active_admin()));

-- ---------------------------------------------------------------------------
-- Draft content writer (shared by create_menu_draft and save_menu_draft)
-- ---------------------------------------------------------------------------

create or replace function private.menu_document_error(p_path text, p_message text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception 'invalid_menu_document' using errcode = '22023',
    detail = jsonb_build_object('path', p_path, 'message', p_message)::text;
end;
$$;

-- A JSON string holding a canonical uuid, else NULL (never a cast error).
create or replace function private.jsonb_uuid(p_value jsonb)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select (p_value #>> '{}')::uuid
  where jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
$$;

-- Replaces a draft's sections/entries/entry variants with a MenuDocument
-- (lib/menus/types.ts). Limits mirror MENU_IMPORT_LIMITS. Identity rules (A1.3):
--   * itemId given  -> must be a menu_items row of the version's venue, once per document;
--   * itemId null   -> a NEW menu_items row (no source-key or name reuse here);
--   * variantId given -> must belong to that item; null -> a NEW menu_variants row;
--   * two variants of one entry may not share lower(btrim(name)).
-- `review` non-null marks the entry needs_review (blocks activation).
-- Returns (sections, entries). The caller holds the venue lock and has locked
-- the draft row.
create or replace function private.write_menu_document(
  p_version_id uuid,
  p_venue_id uuid,
  p_document jsonb,
  p_actor uuid
)
returns table (section_count integer, entry_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_sections constant integer := 100;
  c_max_items constant integer := 2000;
  c_max_variants constant integer := 12;
  c_max_candidates constant integer := 20;
  c_source_meta_max_bytes constant integer := 4096;
  v_sections jsonb;
  v_section jsonb;
  v_section_idx integer;
  v_section_id uuid;
  v_section_path text;
  v_slug text;
  v_kind text;
  v_items jsonb;
  v_item jsonb;
  v_item_idx integer;
  v_item_path text;
  v_item_id uuid;
  v_entry_id uuid;
  v_source_key text;
  v_name text;
  v_description text;
  v_aliases text[];
  v_alias jsonb;
  v_meta jsonb;
  v_meta_key text;
  v_meta_value jsonb;
  v_review jsonb;
  v_candidates uuid[];
  v_candidate jsonb;
  v_candidate_id uuid;
  v_reason text;
  v_variants jsonb;
  v_variant jsonb;
  v_variant_idx integer;
  v_variant_id uuid;
  v_variant_name text;
  v_variant_names text[];
  v_variant_ids uuid[];
  v_seen_slugs text[] := '{}';
  v_seen_keys text[] := '{}';
  v_seen_items uuid[] := '{}';
  v_total_items integer := 0;
  v_section_count integer := 0;
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then
    perform private.menu_document_error('$', 'The document must be an object.');
  end if;

  v_sections := p_document -> 'sections';
  if v_sections is null or jsonb_typeof(v_sections) is distinct from 'array' then
    perform private.menu_document_error('sections', 'Sections must be an array.');
  end if;
  if jsonb_array_length(v_sections) > c_max_sections then
    perform private.menu_document_error('sections', format('At most %s sections.', c_max_sections));
  end if;

  -- Replace the draft content. Entry variants cascade from their entries.
  delete from public.menu_entries e where e.version_id = p_version_id;
  delete from public.menu_sections s where s.version_id = p_version_id;

  for v_section, v_section_idx in
    select x.value, (x.ordinality - 1)::integer
    from jsonb_array_elements(v_sections) with ordinality as x(value, ordinality)
  loop
    v_section_path := format('sections[%s]', v_section_idx);
    if jsonb_typeof(v_section) is distinct from 'object' then
      perform private.menu_document_error(v_section_path, 'A section must be an object.');
    end if;

    if jsonb_typeof(v_section -> 'slug') is distinct from 'string' then
      perform private.menu_document_error(v_section_path || '.slug', 'Slug must be a string.');
    end if;
    v_slug := v_section ->> 'slug';
    if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 80 then
      perform private.menu_document_error(v_section_path || '.slug', 'Slug must be lowercase words joined by hyphens, at most 80 characters.');
    end if;
    if v_slug = any(v_seen_slugs) then
      perform private.menu_document_error(v_section_path || '.slug', 'Section slugs must be unique.');
    end if;
    v_seen_slugs := v_seen_slugs || v_slug;

    if jsonb_typeof(v_section -> 'name') is distinct from 'string'
       or length(btrim(v_section ->> 'name')) not between 1 and 120 then
      perform private.menu_document_error(v_section_path || '.name', 'Section name must be 1 to 120 characters.');
    end if;

    v_kind := coalesce(v_section ->> 'kind', 'food');
    if jsonb_typeof(coalesce(v_section -> 'kind', '"food"'::jsonb)) is distinct from 'string'
       or v_kind not in ('food', 'drinks', 'other') then
      perform private.menu_document_error(v_section_path || '.kind', 'Kind must be food, drinks or other.');
    end if;

    v_items := v_section -> 'items';
    if v_items is null or jsonb_typeof(v_items) is distinct from 'array' then
      perform private.menu_document_error(v_section_path || '.items', 'Items must be an array.');
    end if;
    v_total_items := v_total_items + jsonb_array_length(v_items);
    if v_total_items > c_max_items then
      perform private.menu_document_error(v_section_path || '.items', format('At most %s items in a menu.', c_max_items));
    end if;

    insert into public.menu_sections (version_id, venue_id, slug, name, kind, position)
    values (p_version_id, p_venue_id, v_slug, btrim(v_section ->> 'name'), v_kind, v_section_idx)
    returning id into v_section_id;
    v_section_count := v_section_count + 1;

    for v_item, v_item_idx in
      select x.value, (x.ordinality - 1)::integer
      from jsonb_array_elements(v_items) with ordinality as x(value, ordinality)
    loop
      v_item_path := format('%s.items[%s]', v_section_path, v_item_idx);
      if jsonb_typeof(v_item) is distinct from 'object' then
        perform private.menu_document_error(v_item_path, 'An item must be an object.');
      end if;

      -- Identity.
      if coalesce(jsonb_typeof(v_item -> 'itemId'), 'null') = 'null' then
        v_item_id := null;
      else
        v_item_id := private.jsonb_uuid(v_item -> 'itemId');
        if v_item_id is null then
          perform private.menu_document_error(v_item_path || '.itemId', 'itemId must be a uuid or null.');
        end if;
        if not exists (
          select 1 from public.menu_items i where i.id = v_item_id and i.venue_id = p_venue_id
        ) then
          raise exception 'menu_item_wrong_venue' using errcode = '22023',
            detail = jsonb_build_object('path', v_item_path || '.itemId', 'itemId', v_item_id)::text;
        end if;
        if v_item_id = any(v_seen_items) then
          perform private.menu_document_error(v_item_path || '.itemId', 'An item may appear only once in a menu.');
        end if;
      end if;

      -- Source key.
      if jsonb_typeof(v_item -> 'sourceKey') is distinct from 'string' then
        perform private.menu_document_error(v_item_path || '.sourceKey', 'sourceKey must be a string.');
      end if;
      v_source_key := v_item ->> 'sourceKey';
      if v_source_key !~ '^[a-z0-9][a-z0-9:_-]{0,159}$' then
        perform private.menu_document_error(v_item_path || '.sourceKey', 'sourceKey must be a lowercase key of at most 160 characters.');
      end if;
      if v_source_key = any(v_seen_keys) then
        perform private.menu_document_error(v_item_path || '.sourceKey', 'Source keys must be unique within a menu.');
      end if;
      v_seen_keys := v_seen_keys || v_source_key;

      -- Name and description.
      if jsonb_typeof(v_item -> 'name') is distinct from 'string'
         or length(btrim(v_item ->> 'name')) not between 1 and 120 then
        perform private.menu_document_error(v_item_path || '.name', 'Item name must be 1 to 120 characters.');
      end if;
      v_name := btrim(v_item ->> 'name');

      if coalesce(jsonb_typeof(v_item -> 'description'), 'null') = 'null' then
        v_description := null;
      elsif jsonb_typeof(v_item -> 'description') is distinct from 'string' then
        perform private.menu_document_error(v_item_path || '.description', 'Description must be a string or null.');
      else
        v_description := nullif(btrim(v_item ->> 'description'), '');
        if length(v_description) > 600 then
          perform private.menu_document_error(v_item_path || '.description', 'Description must be at most 600 characters.');
        end if;
      end if;

      -- Aliases.
      v_aliases := '{}';
      if coalesce(jsonb_typeof(v_item -> 'aliases'), 'null') <> 'null' then
        if jsonb_typeof(v_item -> 'aliases') is distinct from 'array' then
          perform private.menu_document_error(v_item_path || '.aliases', 'Aliases must be an array.');
        end if;
        if jsonb_array_length(v_item -> 'aliases') > 10 then
          perform private.menu_document_error(v_item_path || '.aliases', 'At most 10 aliases.');
        end if;
        for v_alias in select x.value from jsonb_array_elements(v_item -> 'aliases') as x(value) loop
          if jsonb_typeof(v_alias) is distinct from 'string' or length(btrim(v_alias #>> '{}')) not between 1 and 80 then
            perform private.menu_document_error(v_item_path || '.aliases', 'Each alias must be 1 to 80 characters.');
          end if;
          v_aliases := v_aliases || btrim(v_alias #>> '{}');
        end loop;
      end if;

      -- Source metadata: provenance only (string | number | boolean | null | string[]).
      v_meta := coalesce(v_item -> 'sourceMeta', '{}'::jsonb);
      if jsonb_typeof(v_meta) = 'null' then
        v_meta := '{}'::jsonb;
      end if;
      if jsonb_typeof(v_meta) is distinct from 'object' then
        perform private.menu_document_error(v_item_path || '.sourceMeta', 'sourceMeta must be an object.');
      end if;
      if octet_length(v_meta::text) > c_source_meta_max_bytes then
        perform private.menu_document_error(v_item_path || '.sourceMeta', format('sourceMeta must be at most %s bytes.', c_source_meta_max_bytes));
      end if;
      for v_meta_key, v_meta_value in select e.key, e.value from jsonb_each(v_meta) as e loop
        if jsonb_typeof(v_meta_value) = 'array' then
          if exists (
            select 1 from jsonb_array_elements(v_meta_value) as x(value)
            where jsonb_typeof(x.value) is distinct from 'string'
          ) then
            perform private.menu_document_error(v_item_path || '.sourceMeta.' || v_meta_key, 'Lists in sourceMeta may hold only strings.');
          end if;
        elsif jsonb_typeof(v_meta_value) = 'object' then
          perform private.menu_document_error(v_item_path || '.sourceMeta.' || v_meta_key, 'sourceMeta values must be text, numbers, booleans, null or lists of text.');
        end if;
      end loop;

      -- Review (uncertain match the admin must resolve before activation).
      v_review := v_item -> 'review';
      v_candidates := '{}';
      v_reason := null;
      if coalesce(jsonb_typeof(v_review), 'null') <> 'null' then
        if jsonb_typeof(v_review) is distinct from 'object' then
          perform private.menu_document_error(v_item_path || '.review', 'review must be an object or null.');
        end if;
        if coalesce(jsonb_typeof(v_review -> 'candidates'), 'null') <> 'null' then
          if jsonb_typeof(v_review -> 'candidates') is distinct from 'array'
             or jsonb_array_length(v_review -> 'candidates') > c_max_candidates then
            perform private.menu_document_error(v_item_path || '.review.candidates', format('candidates must be a list of at most %s item ids.', c_max_candidates));
          end if;
          for v_candidate in select x.value from jsonb_array_elements(v_review -> 'candidates') as x(value) loop
            v_candidate_id := private.jsonb_uuid(v_candidate);
            if v_candidate_id is null then
              perform private.menu_document_error(v_item_path || '.review.candidates', 'Each candidate must be an item id.');
            end if;
            if not exists (
              select 1 from public.menu_items i where i.id = v_candidate_id and i.venue_id = p_venue_id
            ) then
              raise exception 'menu_item_wrong_venue' using errcode = '22023',
                detail = jsonb_build_object('path', v_item_path || '.review.candidates', 'itemId', v_candidate_id)::text;
            end if;
            if not v_candidate_id = any(v_candidates) then
              v_candidates := v_candidates || v_candidate_id;
            end if;
          end loop;
        end if;
        if coalesce(jsonb_typeof(v_review -> 'reason'), 'null') <> 'null' then
          if jsonb_typeof(v_review -> 'reason') is distinct from 'string' then
            perform private.menu_document_error(v_item_path || '.review.reason', 'reason must be text.');
          end if;
          v_reason := nullif(btrim(v_review ->> 'reason'), '');
          if length(v_reason) > 200 then
            perform private.menu_document_error(v_item_path || '.review.reason', 'reason must be at most 200 characters.');
          end if;
        end if;
      end if;

      -- Variants: validate before creating any identity.
      v_variants := coalesce(v_item -> 'variants', '[]'::jsonb);
      if jsonb_typeof(v_variants) = 'null' then
        v_variants := '[]'::jsonb;
      end if;
      if jsonb_typeof(v_variants) is distinct from 'array' then
        perform private.menu_document_error(v_item_path || '.variants', 'Variants must be an array.');
      end if;
      if jsonb_array_length(v_variants) > c_max_variants then
        perform private.menu_document_error(v_item_path || '.variants', format('At most %s variants per item.', c_max_variants));
      end if;
      v_variant_names := '{}';
      v_variant_ids := '{}';
      for v_variant, v_variant_idx in
        select x.value, (x.ordinality - 1)::integer
        from jsonb_array_elements(v_variants) with ordinality as x(value, ordinality)
      loop
        if jsonb_typeof(v_variant) is distinct from 'object' then
          perform private.menu_document_error(format('%s.variants[%s]', v_item_path, v_variant_idx), 'A variant must be an object.');
        end if;
        if jsonb_typeof(v_variant -> 'name') is distinct from 'string'
           or length(btrim(v_variant ->> 'name')) not between 1 and 80 then
          perform private.menu_document_error(format('%s.variants[%s].name', v_item_path, v_variant_idx), 'Variant name must be 1 to 80 characters.');
        end if;
        if lower(btrim(v_variant ->> 'name')) = any(v_variant_names) then
          perform private.menu_document_error(format('%s.variants[%s].name', v_item_path, v_variant_idx), 'Two variants of one item cannot share a name.');
        end if;
        v_variant_names := v_variant_names || lower(btrim(v_variant ->> 'name'));
        if coalesce(jsonb_typeof(v_variant -> 'variantId'), 'null') <> 'null' then
          v_variant_id := private.jsonb_uuid(v_variant -> 'variantId');
          if v_variant_id is null then
            perform private.menu_document_error(format('%s.variants[%s].variantId', v_item_path, v_variant_idx), 'variantId must be a uuid or null.');
          end if;
          if v_item_id is null or not exists (
            select 1 from public.menu_variants mv where mv.id = v_variant_id and mv.item_id = v_item_id
          ) then
            perform private.menu_document_error(format('%s.variants[%s].variantId', v_item_path, v_variant_idx), 'variantId does not belong to this item.');
          end if;
          if v_variant_id = any(v_variant_ids) then
            perform private.menu_document_error(format('%s.variants[%s].variantId', v_item_path, v_variant_idx), 'A variant may appear only once per item.');
          end if;
          v_variant_ids := v_variant_ids || v_variant_id;
        end if;
      end loop;

      -- Write.
      if v_item_id is null then
        insert into public.menu_items (venue_id, created_by)
        values (p_venue_id, p_actor)
        returning id into v_item_id;
      end if;
      v_seen_items := v_seen_items || v_item_id;

      insert into public.menu_entries (
        version_id, venue_id, section_id, item_id, name, description, aliases,
        source_key, source_meta, position, needs_review, review_candidates, review_reason
      )
      values (
        p_version_id, p_venue_id, v_section_id, v_item_id, v_name, v_description, v_aliases,
        v_source_key, v_meta, v_item_idx, v_review is not null and jsonb_typeof(v_review) = 'object',
        v_candidates, v_reason
      )
      returning id into v_entry_id;

      for v_variant, v_variant_idx in
        select x.value, (x.ordinality - 1)::integer
        from jsonb_array_elements(v_variants) with ordinality as x(value, ordinality)
      loop
        v_variant_name := btrim(v_variant ->> 'name');
        v_variant_id := private.jsonb_uuid(v_variant -> 'variantId');
        if v_variant_id is null then
          insert into public.menu_variants (item_id, venue_id)
          values (v_item_id, p_venue_id)
          returning id into v_variant_id;
        end if;
        insert into public.menu_entry_variants (entry_id, item_id, variant_id, name, position)
        values (v_entry_id, v_item_id, v_variant_id, v_variant_name, v_variant_idx);
      end loop;
    end loop;
  end loop;

  return query select v_section_count, v_total_items;
end;
$$;

-- p_source (MenuSource) -> validated columns. NULL means a manual draft.
create or replace function private.parse_menu_source(p_source jsonb)
returns table (
  kind text,
  label text,
  sha256 text,
  revision text,
  captured_at timestamptz,
  notes text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind text := 'manual';
  v_label text;
  v_sha text;
  v_revision text;
  v_captured timestamptz;
  v_notes text;
  v_key text;
begin
  if p_source is null or jsonb_typeof(p_source) = 'null' then
    return query select v_kind, v_label, v_sha, v_revision, v_captured, v_notes;
    return;
  end if;
  if jsonb_typeof(p_source) is distinct from 'object' then
    raise exception 'invalid_menu_source' using errcode = '22023', detail = 'source must be an object';
  end if;
  foreach v_key in array array['kind', 'label', 'sha256', 'revision', 'capturedAt', 'notes'] loop
    if coalesce(jsonb_typeof(p_source -> v_key), 'null') not in ('null', 'string') then
      raise exception 'invalid_menu_source' using errcode = '22023',
        detail = format('%s must be text or null', v_key);
    end if;
  end loop;

  v_kind := coalesce(p_source ->> 'kind', 'manual');
  if v_kind not in ('manual', 'json', 'csv') then
    raise exception 'invalid_menu_source' using errcode = '22023', detail = 'kind';
  end if;
  v_label := nullif(btrim(p_source ->> 'label'), '');
  if length(v_label) > 200 then
    raise exception 'invalid_menu_source' using errcode = '22023', detail = 'label';
  end if;
  v_sha := nullif(lower(btrim(p_source ->> 'sha256')), '');
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_menu_source' using errcode = '22023', detail = 'sha256';
  end if;
  v_revision := nullif(btrim(p_source ->> 'revision'), '');
  if length(v_revision) > 80 then
    raise exception 'invalid_menu_source' using errcode = '22023', detail = 'revision';
  end if;
  v_notes := nullif(btrim(p_source ->> 'notes'), '');
  if length(v_notes) > 1000 then
    raise exception 'invalid_menu_source' using errcode = '22023', detail = 'notes';
  end if;
  if nullif(btrim(p_source ->> 'capturedAt'), '') is not null then
    begin
      v_captured := (p_source ->> 'capturedAt')::timestamptz;
    exception when others then
      raise exception 'invalid_menu_source' using errcode = '22023', detail = 'capturedAt';
    end;
  end if;

  return query select v_kind, v_label, v_sha, v_revision, v_captured, v_notes;
end;
$$;

create or replace function private.menu_document_title(p_document jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then
    perform private.menu_document_error('$', 'The document must be an object.');
  end if;
  if jsonb_typeof(p_document -> 'title') is distinct from 'string'
     or length(btrim(p_document ->> 'title')) not between 1 and 120 then
    perform private.menu_document_error('title', 'Title must be 1 to 120 characters.');
  end if;
  return btrim(p_document ->> 'title');
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalogue RPCs (active admin)
-- ---------------------------------------------------------------------------

-- New draft for a venue. The title is p_title; the document's own title must
-- still be valid (it is what later saves write).
create or replace function public.create_menu_draft(
  p_venue_id uuid,
  p_title text,
  p_source jsonb,
  p_document jsonb,
  p_based_on uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_src record;
  v_id uuid;
  v_counts record;
begin
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120 then
    perform private.menu_document_error('title', 'Title must be 1 to 120 characters.');
  end if;
  perform private.menu_document_title(p_document);
  select * into v_src from private.parse_menu_source(p_source);

  perform private.lock_venue_menu(p_venue_id);

  if p_based_on is not null and not exists (
    select 1 from public.menu_versions v where v.id = p_based_on and v.venue_id = p_venue_id
  ) then
    raise exception 'menu_version_not_found' using errcode = 'P0002',
      detail = 'based_on must be a version of the same venue';
  end if;

  insert into public.menu_versions (
    venue_id, title, source_kind, source_label, source_sha256, source_revision,
    source_captured_at, source_notes, based_on_version_id, created_by
  )
  values (
    p_venue_id, btrim(p_title), v_src.kind, v_src.label, v_src.sha256, v_src.revision,
    v_src.captured_at, v_src.notes, p_based_on, v_uid
  )
  returning id into v_id;

  select * into v_counts from private.write_menu_document(v_id, p_venue_id, p_document, v_uid);

  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (p_venue_id, v_id, v_uid, 'draft_created', jsonb_build_object(
    'revision', 1, 'sections', v_counts.section_count, 'items', v_counts.entry_count,
    'sourceKind', v_src.kind, 'basedOn', p_based_on));

  return v_id;
end;
$$;

-- Replace a draft's content (compare-and-set on revision). Returns the new revision.
create or replace function public.save_menu_draft(
  p_version_id uuid,
  p_expected_revision integer,
  p_document jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_venue uuid;
  v_version public.menu_versions;
  v_title text;
  v_counts record;
begin
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;
  v_title := private.menu_document_title(p_document);

  perform private.lock_venue_menu(v_venue);
  select v.* into v_version from public.menu_versions v where v.id = p_version_id for update;

  if v_version.status <> 'draft' then
    raise exception 'menu_version_not_draft' using errcode = 'P0001';
  end if;
  if p_expected_revision is distinct from v_version.revision then
    raise exception 'menu_version_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_version.revision)::text;
  end if;

  select * into v_counts from private.write_menu_document(p_version_id, v_venue, p_document, v_uid);

  update public.menu_versions v
  set title = v_title, revision = v.revision + 1
  where v.id = p_version_id;

  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (v_venue, p_version_id, v_uid, 'draft_saved', jsonb_build_object(
    'revision', v_version.revision + 1, 'sections', v_counts.section_count,
    'items', v_counts.entry_count));

  return v_version.revision + 1;
end;
$$;

-- Make a reviewed draft the venue's catalogue for labelling; the previous
-- active version (if any) is retired in the same transaction.
create or replace function public.activate_menu_version(
  p_version_id uuid,
  p_expected_revision integer
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
  v_version public.menu_versions;
  v_previous uuid;
begin
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;

  perform private.lock_venue_menu(v_venue);
  select v.* into v_version from public.menu_versions v where v.id = p_version_id for update;

  if v_version.status <> 'draft' then
    raise exception 'menu_version_not_draft' using errcode = 'P0001';
  end if;
  if p_expected_revision is distinct from v_version.revision then
    raise exception 'menu_version_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_version.revision)::text;
  end if;
  if exists (select 1 from public.menu_entries e where e.version_id = p_version_id and e.needs_review) then
    raise exception 'menu_review_pending' using errcode = 'P0001',
      detail = 'Resolve every uncertain match before activating.';
  end if;
  if not exists (select 1 from public.menu_entries e where e.version_id = p_version_id) then
    raise exception 'menu_empty' using errcode = 'P0001';
  end if;

  select v.id into v_previous
  from public.menu_versions v
  where v.venue_id = v_venue and v.status = 'active'
  for update;

  if v_previous is not null then
    update public.menu_versions v
    set status = 'retired', retired_by = v_uid, retired_at = now()
    where v.id = v_previous;
    insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
    values (v_venue, v_previous, v_uid, 'retired', jsonb_build_object('replacedBy', p_version_id));
  end if;

  update public.menu_versions v
  set status = 'active',
      reviewed_by = v_uid, reviewed_at = now(),
      activated_by = v_uid, activated_at = now()
  where v.id = p_version_id;

  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (v_venue, p_version_id, v_uid, 'activated', jsonb_build_object(
    'revision', v_version.revision, 'replaced', v_previous));
end;
$$;

-- Active -> retired: the venue has no catalogue until another is activated.
create or replace function public.retire_menu_version(p_version_id uuid)
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
begin
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;

  perform private.lock_venue_menu(v_venue);
  select v.status into v_status from public.menu_versions v where v.id = p_version_id for update;
  if v_status <> 'active' then
    raise exception 'menu_version_not_active' using errcode = 'P0001';
  end if;

  update public.menu_versions v
  set status = 'retired', retired_by = v_uid, retired_at = now()
  where v.id = p_version_id;

  insert into public.menu_events (venue_id, version_id, actor_id, action)
  values (v_venue, p_version_id, v_uid, 'retired');
end;
$$;

create or replace function public.discard_menu_draft(p_version_id uuid)
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
begin
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;

  perform private.lock_venue_menu(v_venue);
  select v.status into v_status from public.menu_versions v where v.id = p_version_id for update;
  if v_status <> 'draft' then
    raise exception 'menu_version_not_draft' using errcode = 'P0001';
  end if;

  update public.menu_versions v set status = 'discarded' where v.id = p_version_id;

  insert into public.menu_events (venue_id, version_id, actor_id, action)
  values (v_venue, p_version_id, v_uid, 'discarded');
end;
$$;

-- Archiving stops new labels with the item; existing labels stay. Idempotent:
-- a call that changes nothing writes no event.
create or replace function public.set_menu_item_archived(p_item_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_venue uuid;
  v_archived_at timestamptz;
begin
  if p_archived is null then
    raise exception 'invalid_archived_flag' using errcode = '22023';
  end if;
  select i.venue_id into v_venue from public.menu_items i where i.id = p_item_id;
  if v_venue is null then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;

  perform private.lock_venue_menu(v_venue);
  select i.archived_at into v_archived_at from public.menu_items i where i.id = p_item_id for update;

  if p_archived = (v_archived_at is not null) then
    return;
  end if;

  if p_archived then
    update public.menu_items i set archived_at = now(), archived_by = v_uid where i.id = p_item_id;
    insert into public.menu_events (venue_id, item_id, actor_id, action)
    values (v_venue, p_item_id, v_uid, 'item_archived');
  else
    update public.menu_items i set archived_at = null, archived_by = null where i.id = p_item_id;
    insert into public.menu_events (venue_id, item_id, actor_id, action)
    values (v_venue, p_item_id, v_uid, 'item_unarchived');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_aliases_valid(text[]),
  private.text_array_is_distinct_set(text[]),
  private.menu_versions_insert_guard(),
  private.menu_versions_guard(),
  private.assert_menu_version_draft(uuid),
  private.menu_content_guard(),
  private.menu_entry_variants_guard(),
  private.menu_items_guard(),
  private.immutable_row_guard(),
  private.append_only_guard(),
  private.staff_can_label_venue(uuid),
  private.staff_can_read_menu_version(uuid),
  private.active_menu_version_id(uuid),
  private.lock_venue_menu(uuid, boolean),
  private.assert_active_admin(),
  private.menu_document_error(text, text),
  private.jsonb_uuid(jsonb),
  private.write_menu_document(uuid, uuid, jsonb, uuid),
  private.parse_menu_source(jsonb),
  private.menu_document_title(jsonb)
from public, anon, authenticated;

-- Used by check constraints, triggers and RLS policies evaluated as the caller.
grant execute on function
  private.menu_aliases_valid(text[]),
  private.text_array_is_distinct_set(text[]),
  private.menu_versions_insert_guard(),
  private.menu_versions_guard(),
  private.assert_menu_version_draft(uuid),
  private.menu_content_guard(),
  private.menu_entry_variants_guard(),
  private.menu_items_guard(),
  private.immutable_row_guard(),
  private.append_only_guard(),
  private.staff_can_label_venue(uuid),
  private.staff_can_read_menu_version(uuid)
to authenticated, service_role;

revoke all on function
  public.create_menu_draft(uuid, text, jsonb, jsonb, uuid),
  public.save_menu_draft(uuid, integer, jsonb),
  public.activate_menu_version(uuid, integer),
  public.retire_menu_version(uuid),
  public.discard_menu_draft(uuid),
  public.set_menu_item_archived(uuid, boolean)
from public, anon;

grant execute on function
  public.create_menu_draft(uuid, text, jsonb, jsonb, uuid),
  public.save_menu_draft(uuid, integer, jsonb),
  public.activate_menu_version(uuid, integer),
  public.retire_menu_version(uuid),
  public.discard_menu_draft(uuid),
  public.set_menu_item_archived(uuid, boolean)
to authenticated, service_role;
