-- B04-a (b04-design §4, §19.2 S1): declared menu sources, immutable source
-- snapshots, the per-venue field authority manifest and the reviewed crosswalk
-- between NabaLens item/variant ids and source entries, with the manifest read.
--
-- Additive only. No existing table, row or function changes: the catalogue,
-- photo, label and credit objects are untouched (§13.2), and
-- private.monthly_venue_completion_counts is not re-created.
-- Inert: tooling only proposes crosswalk rows; a row is confirmed only by a
-- named reviewer. Field authority rows start at the §4.4 design defaults
-- (OD-B4-1, owner to confirm) and no field can be switched to `nabalens`
-- beyond the two that already are (identity, photos) until B04-05 lands.
--
-- Lock order (§3): request key, venue menu lock (shared), the source's
-- crosswalk lock, then crosswalk head rows.
--
-- Rollback (§13.1): revoke execute on the public functions below; the tables
-- and their history stay.
--
-- Mirrored in TypeScript by lib/menus/trading/crosswalk.ts (matcher, snapshot
-- validator, content hash, variant locators, decision provenance);
-- tests/security/menus-crosswalk.test.ts pins both.

-- ---------------------------------------------------------------------------
-- Closed sets and pure helpers
-- ---------------------------------------------------------------------------

create function private.menu_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'identity', 'name', 'description', 'section', 'variants', 'price', 'portion',
    'availability', 'temporary_unavailability', 'modifiers', 'dietary', 'allergens', 'photos'
  ];
$$;

-- §4.4 defaults (OD-B4-1, owner to confirm): today's authority for each field.
create function private.menu_default_field_authority(p_field text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_field in ('identity', 'photos') then 'nabalens'
    when p_field in ('name', 'description', 'section', 'variants') then 'source_document'
    when p_field in ('price', 'portion', 'availability', 'temporary_unavailability', 'modifiers', 'dietary')
      then 'venue_website'
    when p_field = 'allergens' then 'not_published'
  end;
$$;

-- The crosswalk name key, as nameKey in lib/menus/import/matching.ts: NFC,
-- lower case, JavaScript whitespace as one space, anything but letters, digits
-- and spaces removed, spaces collapsed and trimmed. Not private.menu_name_key
-- (the photo rule), which keeps punctuation.
create function private.menu_crosswalk_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(normalize(coalesce(p_name, ''), nfc)),
        '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'),
      '[^[:alnum:] ]', '', 'g'),
    ' +', ' ', 'g'));
$$;

-- An entry's content hash (§4.3): name, description, variants, labels and price
-- text. The locator is not part of it. contentHashInput in crosswalk.ts writes
-- the same text.
create function private.menu_crosswalk_content_hash(p_entry jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_array(
    p_entry -> 'name',
    p_entry -> 'description',
    coalesce(p_entry -> 'variants', '[]'::jsonb),
    coalesce(p_entry -> 'labels', '[]'::jsonb),
    p_entry -> 'priceText'
  )::text, 'UTF8')), 'hex');
$$;

-- A snapshot text value: a string of 1..p_max characters without outer spaces;
-- absent or null only when optional.
create function private.menu_snapshot_text_ok(p_value jsonb, p_max integer, p_optional boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then p_optional
    when jsonb_typeof(p_value) <> 'string' then false
    else length(p_value #>> '{}') between 1 and p_max
      and btrim(p_value #>> '{}') = (p_value #>> '{}')
  end;
$$;

-- A snapshot list: absent, or an array of at most p_items such strings.
create function private.menu_snapshot_list_ok(p_value jsonb, p_items integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then true
    when jsonb_typeof(p_value) <> 'array' then false
    when jsonb_array_length(p_value) > p_items then false
    else not exists (
      select 1 from jsonb_array_elements(p_value) as x(v)
      where not private.menu_snapshot_text_ok(x.v, p_max, false)
    )
  end;
$$;

-- The first problem in a normalised snapshot document, as
-- { path, message }, or null. Same checks, order and messages as
-- snapshotDocumentError in crosswalk.ts.
create function private.menu_snapshot_document_error(p_document jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_index bigint;
  v_path text;
  v_key text;
  v_locators text[] := '{}';
begin
  if p_document is null or jsonb_typeof(p_document) <> 'array' then
    return jsonb_build_object('path', '', 'message', 'The document is a list of entries');
  end if;
  if jsonb_array_length(p_document) > 2000 then
    return jsonb_build_object('path', '', 'message', 'At most 2000 entries');
  end if;
  for v_entry, v_index in
    select x.e, x.n - 1 from jsonb_array_elements(p_document) with ordinality as x(e, n) order by x.n
  loop
    v_path := format('[%s]', v_index);
    if jsonb_typeof(v_entry) <> 'object' then
      return jsonb_build_object('path', v_path, 'message', 'Each entry is an object');
    end if;
    -- jsonb keys come back shortest first, then by bytes.
    for v_key in select k from jsonb_object_keys(v_entry) as k loop
      if v_key not in ('locator', 'name', 'section', 'description', 'aliases', 'variants',
                       'priceText', 'labels', 'sourceKey') then
        return jsonb_build_object('path', v_path || '.' || v_key, 'message', 'Unknown field');
      end if;
    end loop;
    -- 900 characters and 1200 bytes: a generated locator whose unencoded form
    -- fit 300 characters, with % and # encoded (SNAPSHOT_LIMITS in
    -- crosswalk.ts gives the derivation).
    if not private.menu_snapshot_text_ok(v_entry -> 'locator', 900, false) then
      return jsonb_build_object('path', v_path || '.locator',
        'message', '1 to 900 characters, no outer spaces');
    end if;
    if octet_length(v_entry ->> 'locator') > 1200 then
      return jsonb_build_object('path', v_path || '.locator', 'message', 'At most 1200 bytes');
    end if;
    if strpos(v_entry ->> 'locator', '#variant=') > 0 then
      return jsonb_build_object('path', v_path || '.locator',
        'message', 'Contains the reserved #variant=');
    end if;
    if not private.menu_snapshot_text_ok(v_entry -> 'name', 120, false) then
      return jsonb_build_object('path', v_path || '.name',
        'message', '1 to 120 characters, no outer spaces');
    end if;
    if not private.menu_snapshot_text_ok(v_entry -> 'section', 120, true) then
      return jsonb_build_object('path', v_path || '.section',
        'message', 'Up to 120 characters, no outer spaces');
    end if;
    if not private.menu_snapshot_text_ok(v_entry -> 'description', 600, true) then
      return jsonb_build_object('path', v_path || '.description',
        'message', 'Up to 600 characters, no outer spaces');
    end if;
    if not private.menu_snapshot_text_ok(v_entry -> 'priceText', 80, true) then
      return jsonb_build_object('path', v_path || '.priceText',
        'message', 'Up to 80 characters, no outer spaces');
    end if;
    if v_entry -> 'sourceKey' is not null and jsonb_typeof(v_entry -> 'sourceKey') <> 'null'
       and not (jsonb_typeof(v_entry -> 'sourceKey') = 'string'
                and (v_entry ->> 'sourceKey') ~ '^[a-z0-9][a-z0-9:_-]{0,159}$') then
      return jsonb_build_object('path', v_path || '.sourceKey', 'message', 'Invalid source key');
    end if;
    if not private.menu_snapshot_list_ok(v_entry -> 'aliases', 10, 80) then
      return jsonb_build_object('path', v_path || '.aliases',
        'message', 'Up to 10 values of 1 to 80 characters');
    end if;
    if not private.menu_snapshot_list_ok(v_entry -> 'variants', 12, 80) then
      return jsonb_build_object('path', v_path || '.variants',
        'message', 'Up to 12 values of 1 to 80 characters');
    end if;
    if not private.menu_snapshot_list_ok(v_entry -> 'labels', 20, 40) then
      return jsonb_build_object('path', v_path || '.labels',
        'message', 'Up to 20 values of 1 to 40 characters');
    end if;
    if (v_entry ->> 'locator') = any (v_locators) then
      return jsonb_build_object('path', v_path || '.locator', 'message', 'Duplicate locator');
    end if;
    v_locators := v_locators || (v_entry ->> 'locator');
  end loop;
  return null;
end;
$$;

create function private.menu_source_request_hash(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
$$;

-- One component of a generated locator, as locatorPart in crosswalk.ts: % and
-- # percent-encoded, so a name never contains the # that starts a delimiter or
-- a repeat suffix.
create function private.menu_locator_part(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(p_text, '%', '%25'), '#', '%23');
$$;

-- An entry's variants in list order, as variantOccurrences in crosswalk.ts:
-- each name, its catalogue key lower(btrim(name)), its occurrence among the
-- entry's variants with that key, and its locator: the entry locator,
-- #variant=, the encoded name and #<n> from the second occurrence on. Distinct
-- occurrences always get distinct locators.
create function private.menu_crosswalk_variants(p_entry jsonb)
returns table (ord bigint, name text, name_key text, occurrence bigint, locator text)
language sql
immutable
set search_path = ''
as $$
  select o.n, o.v, o.k, o.c,
    (p_entry ->> 'locator') || '#variant=' || private.menu_locator_part(o.v)
      || case when o.c > 1 then '#' || o.c::text else '' end
  from (
    select x.n, x.v, lower(btrim(x.v)) as k,
      row_number() over (partition by lower(btrim(x.v)) order by x.n) as c
    from jsonb_array_elements_text(coalesce(p_entry -> 'variants', '[]'::jsonb))
      with ordinality as x(v, n)
  ) o
  order by o.n;
$$;

-- The entry of a snapshot document a crosswalk locator stands for, or null
-- when the document does not list it: the entry itself, or for a variant row
-- (p_entry_locator set) its entry when that lists this variant occurrence.
-- crosswalkOccurrence in crosswalk.ts.
create function private.menu_crosswalk_occurrence(
  p_document jsonb, p_locator text, p_entry_locator text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select x.e
  from jsonb_array_elements(p_document) as x(e)
  where x.e ->> 'locator' = coalesce(p_entry_locator, p_locator)
    and (p_entry_locator is null or exists (
      select 1 from private.menu_crosswalk_variants(x.e) as v where v.locator = p_locator))
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.menu_sources (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  kind text not null check (kind in (
    'venue_website', 'menu_design', 'operator_document', 'pos_export', 'nabalens'
  )),
  label text not null check (length(label) between 1 and 200 and btrim(label) = label),
  locator text check (locator is null or (length(locator) between 1 and 500 and btrim(locator) = locator)),
  declared_by uuid not null references public.profiles (id) on delete restrict,
  declared_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  constraint menu_sources_venue_kind_label_key unique (venue_id, kind, label),
  constraint menu_sources_id_venue_key unique (id, venue_id),
  constraint menu_sources_retired check ((retired_at is null) = (retired_by is null))
);

comment on table public.menu_sources is
  'A declared menu source of one venue (website repository, menu design, operator document, POS export, NabaLens). Declared by venue id only, never resolved by venue name.';

create table public.menu_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  source_id uuid not null,
  venue_id uuid not null,
  source_revision text not null
    check (length(source_revision) between 1 and 80 and btrim(source_revision) = source_revision),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- The source's own time; null when unknown, never the import time (R30).
  captured_at timestamptz,
  retrieved_at timestamptz not null default now(),
  retrieved_by uuid not null references public.profiles (id) on delete restrict,
  document jsonb not null check (jsonb_typeof(document) = 'array'),
  entry_count integer not null check (entry_count between 0 and 2000),
  notes text check (notes is null or length(notes) between 1 and 1000),
  constraint menu_source_snapshots_revision_key unique (source_id, source_revision),
  constraint menu_source_snapshots_id_source_key unique (id, source_id),
  constraint menu_source_snapshots_source_fkey foreign key (source_id, venue_id)
    references public.menu_sources (id, venue_id) on delete restrict,
  constraint menu_source_snapshots_count check (entry_count = jsonb_array_length(document))
);

create index menu_source_snapshots_source_idx on public.menu_source_snapshots (source_id, seq desc);

comment on table public.menu_source_snapshots is
  'Append-only: one normalised read of a source revision. Prices and labels in it are source text, never trading facts.';

create table public.menu_field_authority (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  field text not null check (field in (
    'identity', 'name', 'description', 'section', 'variants', 'price', 'portion',
    'availability', 'temporary_unavailability', 'modifiers', 'dietary', 'allergens', 'photos'
  )),
  channel text not null default 'all' check (channel in ('all', 'dine_in', 'takeaway')),
  authority text not null check (authority in ('source_document', 'venue_website', 'nabalens', 'not_published')),
  source_id uuid,
  effective_from timestamptz not null default now(),
  -- design_default: the §4.4 default, seeded by migration and not yet
  -- confirmed by the owner; owner_approval: recorded by an admin.
  basis text not null check (basis in ('design_default', 'owner_approval')),
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  reason text not null check (length(reason) between 1 and 500),
  supersedes uuid,
  created_at timestamptz not null default now(),
  constraint menu_field_authority_key unique (id, venue_id, field, channel),
  constraint menu_field_authority_source_fkey foreign key (source_id, venue_id)
    references public.menu_sources (id, venue_id) on delete restrict,
  -- A row supersedes the previous row of the same venue, field and channel.
  constraint menu_field_authority_supersedes_fkey foreign key (supersedes, venue_id, field, channel)
    references public.menu_field_authority (id, venue_id, field, channel) on delete restrict,
  constraint menu_field_authority_approval check (
    (basis = 'design_default') = (approved_by is null)
    and (approved_by is null) = (approved_at is null)
  ),
  constraint menu_field_authority_source check (
    case
      when authority in ('nabalens', 'not_published') then source_id is null
      else basis = 'design_default' or source_id is not null
    end
  )
);

-- One chain per (venue, field, channel): one root, and no row superseded twice,
-- so exactly one row (the one nobody supersedes) is in force.
create unique index menu_field_authority_one_root
  on public.menu_field_authority (venue_id, field, channel) where supersedes is null;
create unique index menu_field_authority_one_successor
  on public.menu_field_authority (supersedes) where supersedes is not null;

comment on table public.menu_field_authority is
  'Append-only field authority manifest per venue (§4.4). The row no other row supersedes is in force; seeded rows are design defaults awaiting the owner (OD-B4-1).';

create table public.menu_crosswalk (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null,
  source_id uuid not null,
  snapshot_id uuid not null,
  -- An entry locator (900), #variant= (9), an encoded variant name (3 x 80)
  -- and a repeat suffix (#12): CROSSWALK_LOCATOR_MAX in crosswalk.ts. In
  -- bytes 1200 + 9 + 4 x 80 + 3 (CROSSWALK_LOCATOR_BYTES_MAX), inside a btree
  -- key with the source id and seq.
  locator text not null check (length(locator) between 1 and 1152 and octet_length(locator) <= 1532),
  -- Set on variant rows: the locator of the source entry the variant is part of.
  entry_locator text check (entry_locator is null
    or (length(entry_locator) between 1 and 900 and octet_length(entry_locator) <= 1200)),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  item_id uuid,
  variant_id uuid,
  channel text not null default 'all' check (channel in ('all', 'dine_in', 'takeaway')),
  status text not null check (status in (
    'proposed', 'ambiguous', 'confirmed', 'unmatched', 'not_on_source', 'needs_review', 'rejected', 'carried'
  )),
  basis text not null check (basis in ('source_key_exact', 'name_candidate', 'manual', 'carried')),
  -- Item ids on entry rows, variant ids on variant rows.
  candidates uuid[] not null default '{}' check (
    cardinality(candidates) <= 20 and array_position(candidates, null) is null
  ),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) < 32768
  ),
  proposed_by uuid not null references public.profiles (id) on delete restrict,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  reason text check (reason is null or length(reason) between 1 and 280),
  supersedes uuid references public.menu_crosswalk (id) on delete restrict,
  constraint menu_crosswalk_source_fkey foreign key (source_id, venue_id)
    references public.menu_sources (id, venue_id) on delete restrict,
  constraint menu_crosswalk_snapshot_fkey foreign key (snapshot_id, source_id)
    references public.menu_source_snapshots (id, source_id) on delete restrict,
  -- Venue scope is structural (§3): a cross-venue item cannot be stored.
  constraint menu_crosswalk_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_crosswalk_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint menu_crosswalk_variant_needs_item check (variant_id is null or item_id is not null),
  constraint menu_crosswalk_reviewed check ((reviewed_by is null) = (reviewed_at is null)),
  -- No row is confirmed, carried, rejected or unmatched without a named reviewer.
  constraint menu_crosswalk_decided_reviewed check (
    status not in ('confirmed', 'carried', 'rejected', 'unmatched') or reviewed_by is not null
  ),
  constraint menu_crosswalk_mapped_item check (status not in ('confirmed', 'carried') or item_id is not null),
  constraint menu_crosswalk_carried_basis check (status <> 'carried' or basis = 'carried'),
  constraint menu_crosswalk_ambiguous check (
    status <> 'ambiguous' or (cardinality(candidates) >= 1
      and (case when entry_locator is null then item_id is null else variant_id is null end))
  )
);

create index menu_crosswalk_source_locator_idx on public.menu_crosswalk (source_id, locator, seq desc);

comment on table public.menu_crosswalk is
  'Append-only crosswalk rows between NabaLens items/variants and source entries. Tooling proposes; only a named reviewer confirms. menu_crosswalk_heads holds the row in force per (source, locator).';

-- The row in force per (source_id, locator): the crosswalk's latest row, kept
-- by the crosswalk functions only. Its unique index is the §4.3 rule "one
-- source entry per identity line"; the primary key is "one identity per
-- source entry".
create table public.menu_crosswalk_heads (
  source_id uuid not null,
  locator text not null,
  venue_id uuid not null,
  row_id uuid not null unique references public.menu_crosswalk (id) on delete restrict,
  status text not null,
  item_id uuid,
  variant_id uuid,
  channel text not null,
  entry_locator text,
  content_hash text not null,
  snapshot_id uuid not null,
  candidates uuid[] not null,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (source_id, locator),
  constraint menu_crosswalk_heads_source_fkey foreign key (source_id, venue_id)
    references public.menu_sources (id, venue_id) on delete restrict,
  constraint menu_crosswalk_heads_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_crosswalk_heads_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict
);

create unique index menu_crosswalk_heads_one_entry_per_line
  on public.menu_crosswalk_heads (source_id, item_id, variant_id, channel) nulls not distinct
  where status in ('confirmed', 'carried');
create index menu_crosswalk_heads_item_idx on public.menu_crosswalk_heads (source_id, item_id);
create index menu_crosswalk_heads_entry_idx
  on public.menu_crosswalk_heads (source_id, entry_locator) where entry_locator is not null;
create index menu_crosswalk_heads_candidates_idx on public.menu_crosswalk_heads using gin (candidates);
create index menu_crosswalk_heads_venue_idx on public.menu_crosswalk_heads (venue_id);

-- Idempotency: one result per request key (B03 §14.1).
create table public.menu_source_commands (
  request_key uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  command text not null check (command in (
    'declare_source', 'record_snapshot', 'crosswalk_propose', 'crosswalk_decide', 'set_field_authority'
  )),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  venue_id uuid not null references public.venues (id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.menu_source_commands is
  'Append-only record of each B04-a command and its first result, replayed for the same key, actor, command and request hash.';

-- The snapshots the matcher has run on. A decision needs the source's newest
-- snapshot here (§4.2 #6): rows written from an older one are not decided
-- until the matcher has compared them with the newest.
create table public.menu_crosswalk_runs (
  snapshot_id uuid primary key,
  source_id uuid not null,
  venue_id uuid not null,
  run_by uuid not null references public.profiles (id) on delete restrict,
  run_at timestamptz not null default now(),
  constraint menu_crosswalk_runs_snapshot_fkey foreign key (snapshot_id, source_id)
    references public.menu_source_snapshots (id, source_id) on delete restrict,
  constraint menu_crosswalk_runs_source_fkey foreign key (source_id, venue_id)
    references public.menu_sources (id, venue_id) on delete restrict
);

comment on table public.menu_crosswalk_runs is
  'Append-only: the first matcher run on each snapshot. A source whose newest snapshot has no run awaits reconciliation; its rows cannot be decided.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'menu_source_snapshots', 'menu_field_authority', 'menu_crosswalk', 'menu_source_commands',
    'menu_crosswalk_runs'
  ] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

-- A source's identity never changes; it is retired once, and never deleted.
create function private.menu_sources_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'menu_source_immutable' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.kind is distinct from old.kind
     or new.label is distinct from old.label
     or new.locator is distinct from old.locator
     or new.declared_by is distinct from old.declared_by
     or new.declared_at is distinct from old.declared_at
     or old.retired_at is not null then
    raise exception 'menu_source_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_sources_guard
  before update or delete on public.menu_sources
  for each row execute function private.menu_sources_guard();
create trigger menu_sources_no_truncate
  before truncate on public.menu_sources
  for each statement execute function private.append_only_guard();

-- A head always mirrors its crosswalk row, moves only to the row that
-- supersedes its current one, and is never deleted.
create function private.menu_crosswalk_heads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'menu_crosswalk_head_immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.menu_crosswalk r
    where r.id = new.row_id
      and r.source_id = new.source_id
      and r.locator = new.locator
      and r.venue_id = new.venue_id
      and r.status = new.status
      and r.item_id is not distinct from new.item_id
      and r.variant_id is not distinct from new.variant_id
      and r.channel = new.channel
      and r.entry_locator is not distinct from new.entry_locator
      and r.content_hash = new.content_hash
      and r.snapshot_id = new.snapshot_id
      and r.candidates = new.candidates
      and (case when tg_op = 'UPDATE' then r.supersedes = old.row_id else r.supersedes is null end)
  ) then
    raise exception 'menu_crosswalk_head_mismatch' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.revision <> 1 then
    raise exception 'menu_crosswalk_head_mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.revision <> old.revision + 1 then
    raise exception 'menu_crosswalk_head_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_crosswalk_heads_guard
  before insert or update or delete on public.menu_crosswalk_heads
  for each row execute function private.menu_crosswalk_heads_guard();
create trigger menu_crosswalk_heads_no_truncate
  before truncate on public.menu_crosswalk_heads
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: no direct client access; SECURITY DEFINER functions only
-- ---------------------------------------------------------------------------

revoke all on
  public.menu_sources, public.menu_source_snapshots, public.menu_field_authority,
  public.menu_crosswalk, public.menu_crosswalk_heads, public.menu_source_commands,
  public.menu_crosswalk_runs
from public, anon, authenticated, service_role;

grant select on
  public.menu_sources, public.menu_source_snapshots, public.menu_field_authority,
  public.menu_crosswalk, public.menu_crosswalk_heads, public.menu_source_commands,
  public.menu_crosswalk_runs
to service_role;

alter table public.menu_sources enable row level security;
alter table public.menu_source_snapshots enable row level security;
alter table public.menu_field_authority enable row level security;
alter table public.menu_crosswalk enable row level security;
alter table public.menu_crosswalk_heads enable row level security;
alter table public.menu_source_commands enable row level security;
alter table public.menu_crosswalk_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Seed: §4.4 design defaults for every existing venue (rows, no switch)
-- ---------------------------------------------------------------------------

-- Venues created later read the same defaults from
-- private.menu_default_field_authority until an admin records a row.
insert into public.menu_field_authority (venue_id, field, channel, authority, source_id, basis, reason)
select v.id, f.field, 'all', private.menu_default_field_authority(f.field), null, 'design_default',
  'Design default (b04-design §4.4, OD-B4-1); owner to confirm.'
from public.venues v
cross join unnest(private.menu_fields()) as f(field);

-- ---------------------------------------------------------------------------
-- Command helpers
-- ---------------------------------------------------------------------------

-- Lock order step 1: the key's advisory lock, then the replay lookup.
create function private.menu_source_replay(p_key uuid, p_actor uuid, p_command text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior public.menu_source_commands;
begin
  if p_key is null then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_menu_source:' || p_key::text, 0));
  select c.* into v_prior from public.menu_source_commands c where c.request_key = p_key;
  if not found then
    return null;
  end if;
  if v_prior.actor_id <> p_actor or v_prior.command <> p_command or v_prior.request_hash <> p_hash then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  return v_prior.result || jsonb_build_object('replayed', true);
end;
$$;

create function private.menu_source_record(
  p_key uuid, p_actor uuid, p_command text, p_hash text, p_venue_id uuid, p_result jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.menu_source_commands (request_key, actor_id, command, request_hash, venue_id, result)
  values (p_key, p_actor, p_command, p_hash, p_venue_id, p_result)
  returning result;
$$;

-- Serialises crosswalk writes for one source (after the venue menu lock).
create function private.lock_menu_source_crosswalk(p_source_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('nabalens_menu_crosswalk:' || p_source_id::text, 0));
$$;

-- Appends one crosswalk row superseding the head of (source, locator) and moves
-- the head to it.
create function private.menu_crosswalk_append(
  p_venue_id uuid,
  p_source_id uuid,
  p_snapshot_id uuid,
  p_locator text,
  p_entry_locator text,
  p_content_hash text,
  p_item_id uuid,
  p_variant_id uuid,
  p_channel text,
  p_status text,
  p_basis text,
  p_candidates uuid[],
  p_evidence jsonb,
  p_actor uuid,
  p_reviewed_by uuid,
  p_reviewed_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_id uuid;
begin
  select h.row_id into v_previous
  from public.menu_crosswalk_heads h
  where h.source_id = p_source_id and h.locator = p_locator;

  insert into public.menu_crosswalk (
    venue_id, source_id, snapshot_id, locator, entry_locator, content_hash, item_id, variant_id,
    channel, status, basis, candidates, evidence, proposed_by, reviewed_by, reviewed_at, reason, supersedes
  )
  values (
    p_venue_id, p_source_id, p_snapshot_id, p_locator, p_entry_locator, p_content_hash, p_item_id,
    p_variant_id, p_channel, p_status, p_basis, p_candidates, p_evidence, p_actor, p_reviewed_by,
    p_reviewed_at, p_reason, v_previous
  )
  returning id into v_id;

  -- Callers hold the source's crosswalk lock, so the head cannot appear or move
  -- between the read above and this write.
  if v_previous is null then
    insert into public.menu_crosswalk_heads (
      source_id, locator, venue_id, row_id, status, item_id, variant_id, channel, entry_locator,
      content_hash, snapshot_id, candidates
    )
    values (
      p_source_id, p_locator, p_venue_id, v_id, p_status, p_item_id, p_variant_id, p_channel,
      p_entry_locator, p_content_hash, p_snapshot_id, p_candidates
    );
  else
    update public.menu_crosswalk_heads h set
      row_id = v_id,
      status = p_status,
      item_id = p_item_id,
      variant_id = p_variant_id,
      channel = p_channel,
      entry_locator = p_entry_locator,
      content_hash = p_content_hash,
      snapshot_id = p_snapshot_id,
      candidates = p_candidates,
      revision = h.revision + 1,
      updated_at = now()
    where h.source_id = p_source_id and h.locator = p_locator;
  end if;
  return v_id;
end;
$$;

-- What a reviewer is shown for an entry: its source text (internal).
create function private.menu_crosswalk_entry_evidence(p_entry jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'name', p_entry -> 'name',
    'section', p_entry -> 'section',
    'description', p_entry -> 'description',
    'aliases', p_entry -> 'aliases',
    'variants', p_entry -> 'variants',
    'priceText', p_entry -> 'priceText',
    'labels', p_entry -> 'labels'
  ));
$$;

-- Moves a mapped head to needs_review, or to not_on_source, keeping its
-- identity line as evidence; the reviewer is not carried.
create function private.menu_crosswalk_requeue(
  p_head public.menu_crosswalk_heads, p_snapshot_id uuid, p_status text, p_actor uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous uuid := case when p_head.entry_locator is null then p_head.item_id else p_head.variant_id end;
  v_evidence jsonb;
begin
  select r.evidence into v_evidence from public.menu_crosswalk r where r.id = p_head.row_id;
  perform private.menu_crosswalk_append(
    p_head.venue_id, p_head.source_id, p_snapshot_id, p_head.locator, p_head.entry_locator,
    p_head.content_hash, p_head.item_id, p_head.variant_id, p_head.channel, p_status, 'carried',
    case when p_status = 'needs_review' and v_previous is not null then array[v_previous] else '{}'::uuid[] end,
    coalesce(v_evidence, '{}'::jsonb), p_actor, null, null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

-- Declare a source of one venue, by venue id (§4.6: never by venue name).
create function public.menu_declare_source(
  p_venue uuid, p_kind text, p_label text, p_locator text, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_label text := nullif(btrim(p_label), '');
  v_locator text := nullif(btrim(p_locator), '');
  v_hash text;
  v_prior jsonb;
  v_id uuid;
begin
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'venue', p_venue, 'kind', p_kind, 'label', v_label, 'locator', v_locator));
  v_prior := private.menu_source_replay(p_request_key, v_uid, 'declare_source', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_kind is null or p_kind not in ('venue_website', 'menu_design', 'operator_document', 'pos_export', 'nabalens') then
    raise exception 'invalid_menu_source_kind' using errcode = '22023';
  end if;
  if v_label is null or length(v_label) > 200 then
    raise exception 'invalid_menu_source_label' using errcode = '22023';
  end if;
  if v_locator is not null and length(v_locator) > 500 then
    raise exception 'invalid_menu_source_locator' using errcode = '22023';
  end if;
  begin
    insert into public.menu_sources (venue_id, kind, label, locator, declared_by)
    values (p_venue, p_kind, v_label, v_locator, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'menu_source_exists' using errcode = 'P0001';
  end;
  return private.menu_source_record(p_request_key, v_uid, 'declare_source', v_hash, p_venue,
    jsonb_build_object('sourceId', v_id, 'replayed', false));
end;
$$;

-- Store a normalised snapshot of one source revision (§4.5). The same revision
-- with the same bytes again is a no-op; with different bytes it is refused.
create function public.menu_record_snapshot(
  p_source uuid, p_revision text, p_sha256 text, p_captured_at timestamptz, p_document jsonb,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_revision text := nullif(btrim(p_revision), '');
  v_hash text;
  v_prior jsonb;
  v_source public.menu_sources;
  v_error jsonb;
  v_existing public.menu_source_snapshots;
  v_id uuid;
  v_result jsonb;
begin
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'source', p_source, 'revision', v_revision, 'sha256', p_sha256, 'capturedAt', p_captured_at,
    'document', p_document));
  v_prior := private.menu_source_replay(p_request_key, v_uid, 'record_snapshot', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select s.* into v_source from public.menu_sources s where s.id = p_source;
  if not found then
    raise exception 'menu_source_not_found' using errcode = 'P0002';
  end if;
  if v_source.retired_at is not null then
    raise exception 'menu_source_retired' using errcode = 'P0001';
  end if;
  if v_revision is null or length(v_revision) > 80 then
    raise exception 'invalid_snapshot_revision' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_snapshot_sha256' using errcode = '22023';
  end if;
  v_error := private.menu_snapshot_document_error(p_document);
  if v_error is not null then
    raise exception 'invalid_snapshot_document' using errcode = '22023', detail = v_error::text;
  end if;

  perform private.lock_menu_source_crosswalk(v_source.id);
  select s.* into v_existing
  from public.menu_source_snapshots s
  where s.source_id = v_source.id and s.source_revision = v_revision;
  if found then
    if v_existing.sha256 <> p_sha256 then
      raise exception 'snapshot_revision_conflict' using errcode = 'P0001';
    end if;
    v_result := jsonb_build_object('snapshotId', v_existing.id, 'entryCount', v_existing.entry_count,
      'unchanged', true, 'replayed', false);
  else
    insert into public.menu_source_snapshots (
      source_id, venue_id, source_revision, sha256, captured_at, retrieved_by, document, entry_count
    )
    values (
      v_source.id, v_source.venue_id, v_revision, p_sha256, p_captured_at, v_uid, p_document,
      jsonb_array_length(p_document)
    )
    returning id into v_id;
    v_result := jsonb_build_object('snapshotId', v_id, 'entryCount', jsonb_array_length(p_document),
      'unchanged', false, 'replayed', false);
  end if;
  return private.menu_source_record(p_request_key, v_uid, 'record_snapshot', v_hash,
    v_source.venue_id, v_result);
end;
$$;

-- Run the matcher on the source's latest snapshot (§4.5) and write proposed,
-- ambiguous, carried, needs_review and not_on_source rows; never confirmed.
-- proposeCrosswalk in crosswalk.ts is the same algorithm:
--   1. Entry rows. A head already written from this snapshot is skipped. A
--      confirmed or carried head with the same content hash is carried (the
--      original reviewer kept); with another hash it needs review. A rejected
--      or unmatched head with the same hash keeps its decision. Otherwise a
--      NabaLens-lineage source proposes by exact source key; any source gets
--      name and alias candidates from the active version, and several
--      candidates, or a name the source repeats, make the row ambiguous.
--   2. Variant rows. Every variant the snapshot lists is on the source. While
--      its entry is not mapped, a mapped or removed variant head, or one
--      still in review on other content, needs review on this snapshot's
--      evidence and nothing is proposed; an open proposal (proposed,
--      ambiguous or deferred before) on other content is deferred:
--      needs_review on name_candidate inside its item, no variant, no
--      candidates, and the proposal it supersedes copied into the evidence
--      as deferredProposal (role historical). Under an entry mapped to an
--      item, a head from this snapshot inside that item is skipped unless it
--      is a deferred proposal; a mapped head is carried or needs review as
--      entries are; a rejected or unmatched head with the same hash and item
--      keeps its decision; anything else is matched afresh among that item's
--      variants on the active version.
--   3. not_on_source rows for every locator the snapshot no longer lists.
-- The run is recorded in menu_crosswalk_runs; decisions need it.
create function public.menu_crosswalk_propose(p_snapshot uuid, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_hash text;
  v_prior jsonb;
  v_snapshot public.menu_source_snapshots;
  v_source public.menu_sources;
  v_version uuid;
  v_lineage boolean;
  v_catalogue jsonb;
  v_repeated text[];
  v_entry jsonb;
  v_locator text;
  v_content text;
  v_head public.menu_crosswalk_heads;
  v_has_head boolean;
  v_reviewer uuid;
  v_reviewed_at timestamptz;
  v_exact uuid;
  v_found jsonb;
  v_count integer;
  v_ids uuid[];
  v_single boolean;
  v_listed text[] := '{}';
  v_variant record;
  v_vhead public.menu_crosswalk_heads;
  v_vrow public.menu_crosswalk;
  v_deferred boolean;
  v_parent public.menu_crosswalk_heads;
  v_parent_item uuid;
  v_current boolean;
  v_same_item boolean;
  n_proposed integer := 0;
  n_ambiguous integer := 0;
  n_carried integer := 0;
  n_review integer := 0;
  n_gone integer := 0;
  n_skipped integer := 0;
  v_result jsonb;
begin
  v_hash := private.menu_source_request_hash(jsonb_build_object('snapshot', p_snapshot));
  v_prior := private.menu_source_replay(p_request_key, v_uid, 'crosswalk_propose', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select s.* into v_snapshot from public.menu_source_snapshots s where s.id = p_snapshot;
  if not found then
    raise exception 'menu_source_snapshot_not_found' using errcode = 'P0002';
  end if;
  select s.* into v_source from public.menu_sources s where s.id = v_snapshot.source_id;
  if v_source.retired_at is not null then
    raise exception 'menu_source_retired' using errcode = 'P0001';
  end if;

  perform private.lock_venue_menu(v_snapshot.venue_id, true);
  perform private.lock_menu_source_crosswalk(v_source.id);
  if exists (
    select 1 from public.menu_source_snapshots s
    where s.source_id = v_source.id and s.seq > v_snapshot.seq
  ) then
    raise exception 'snapshot_not_latest' using errcode = 'P0001';
  end if;

  v_version := private.active_menu_version_id(v_snapshot.venue_id);
  v_lineage := v_source.kind in ('menu_design', 'nabalens');

  -- The active version's name and alias keys, each with its entries in
  -- display order: { key: [{ itemId, name, sectionName, ord }] }.
  select coalesce(jsonb_object_agg(k.name_key, k.items), '{}'::jsonb) into v_catalogue
  from (
    select x.name_key, jsonb_agg(jsonb_build_object(
        'itemId', x.item_id, 'name', x.name, 'sectionName', x.section_name, 'ord', x.ord)
        order by x.ord) as items
    from (
      select distinct c.name_key, c.item_id, c.name, c.section_name, c.ord
      from (
        select e.item_id, e.name, sec.name as section_name,
          row_number() over (order by sec.position, e.position) as ord, e.aliases
        from public.menu_entries e
        join public.menu_sections sec on sec.id = e.section_id
        where e.version_id = v_version
      ) c0
      cross join lateral (
        select c0.item_id, c0.name, c0.section_name, c0.ord, private.menu_crosswalk_name_key(n) as name_key
        from unnest(array[c0.name] || c0.aliases) as n
      ) c
      where c.name_key <> ''
    ) x
    group by x.name_key
  ) k;

  -- Name keys the snapshot itself repeats.
  select coalesce(array_agg(d.name_key), '{}') into v_repeated
  from (
    select private.menu_crosswalk_name_key(x.e ->> 'name') as name_key
    from jsonb_array_elements(v_snapshot.document) as x(e)
    group by 1
    having count(*) > 1
  ) d;

  -- 1. Entry rows.
  for v_entry in
    select x.e from jsonb_array_elements(v_snapshot.document) with ordinality as x(e, n) order by x.n
  loop
    v_locator := v_entry ->> 'locator';
    v_listed := v_listed || v_locator;
    v_content := private.menu_crosswalk_content_hash(v_entry);
    select h.* into v_head
    from public.menu_crosswalk_heads h
    where h.source_id = v_source.id and h.locator = v_locator
    for update;
    v_has_head := found;

    if v_has_head and v_head.snapshot_id = p_snapshot then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    if v_has_head and v_head.status in ('confirmed', 'carried') then
      if v_head.content_hash = v_content then
        select r.reviewed_by, r.reviewed_at into v_reviewer, v_reviewed_at
        from public.menu_crosswalk r where r.id = v_head.row_id;
        perform private.menu_crosswalk_append(
          v_source.venue_id, v_source.id, p_snapshot, v_locator, null, v_content,
          v_head.item_id, v_head.variant_id, v_head.channel, 'carried', 'carried', '{}'::uuid[],
          jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry)),
          v_uid, v_reviewer, v_reviewed_at, null);
        n_carried := n_carried + 1;
      else
        perform private.menu_crosswalk_append(
          v_source.venue_id, v_source.id, p_snapshot, v_locator, null, v_content,
          v_head.item_id, v_head.variant_id, v_head.channel, 'needs_review', 'carried',
          case when v_head.item_id is null then '{}'::uuid[] else array[v_head.item_id] end,
          jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry)),
          v_uid, null, null, null);
        n_review := n_review + 1;
      end if;
      continue;
    end if;

    if v_has_head and v_head.status in ('unmatched', 'rejected') and v_head.content_hash = v_content then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    v_exact := null;
    if v_lineage and jsonb_typeof(v_entry -> 'sourceKey') = 'string' and v_version is not null then
      select e.item_id into v_exact
      from public.menu_entries e
      where e.version_id = v_version and e.source_key = (v_entry ->> 'sourceKey');
    end if;

    if v_exact is not null then
      perform private.menu_crosswalk_append(
        v_source.venue_id, v_source.id, p_snapshot, v_locator, null, v_content,
        v_exact, null, 'all', 'proposed', 'source_key_exact', array[v_exact],
        jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
          'candidateCount', 1),
        v_uid, null, null, null);
      n_proposed := n_proposed + 1;
      continue;
    end if;

    -- Name and alias candidates, each item once, in display order.
    select coalesce(jsonb_agg(d.c order by (d.c ->> 'ord')::bigint), '[]'::jsonb) into v_found
    from (
      select distinct on (c.value ->> 'itemId') c.value as c
      from unnest(array[v_entry ->> 'name'] || coalesce(array(
          select jsonb_array_elements_text(v_entry -> 'aliases')), '{}'::text[])) as n(name)
      cross join lateral jsonb_array_elements(
        coalesce(v_catalogue -> private.menu_crosswalk_name_key(n.name), '[]'::jsonb)) as c(value)
      where private.menu_crosswalk_name_key(n.name) <> ''
      order by c.value ->> 'itemId', (c.value ->> 'ord')::bigint
    ) d;
    v_count := jsonb_array_length(v_found);
    select coalesce(array_agg((x.c ->> 'itemId')::uuid order by x.n), '{}') into v_ids
    from jsonb_array_elements(v_found) with ordinality as x(c, n)
    where x.n <= 20;
    v_single := v_count = 1
      and not (private.menu_crosswalk_name_key(v_entry ->> 'name') = any (v_repeated));

    perform private.menu_crosswalk_append(
      v_source.venue_id, v_source.id, p_snapshot, v_locator, null, v_content,
      case when v_single then v_ids[1] end, null, 'all',
      case when v_count = 0 or v_single then 'proposed' else 'ambiguous' end,
      'name_candidate', v_ids,
      jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
        'candidateCount', v_count,
        'candidates', coalesce((
          select jsonb_agg(jsonb_build_object('itemId', x.c -> 'itemId', 'name', x.c -> 'name',
            'sectionName', x.c -> 'sectionName') order by x.n)
          from jsonb_array_elements(v_found) with ordinality as x(c, n)
          where x.n <= 20), '[]'::jsonb)),
      v_uid, null, null, null);
    if v_count = 0 or v_single then
      n_proposed := n_proposed + 1;
    else
      n_ambiguous := n_ambiguous + 1;
    end if;
  end loop;

  -- 2. Variant rows: every listed variant, matched only inside its entry's item.
  for v_entry in
    select x.e from jsonb_array_elements(v_snapshot.document) with ordinality as x(e, n) order by x.n
  loop
    v_locator := v_entry ->> 'locator';
    v_content := private.menu_crosswalk_content_hash(v_entry);
    select h.* into v_parent
    from public.menu_crosswalk_heads h
    where h.source_id = v_source.id and h.locator = v_locator;
    v_parent_item := case
      when found and v_parent.status in ('confirmed', 'carried') and v_parent.variant_id is null
        then v_parent.item_id
    end;
    for v_variant in
      select v.* from private.menu_crosswalk_variants(v_entry) as v order by v.ord
    loop
      v_listed := v_listed || v_variant.locator;
      select h.* into v_vhead
      from public.menu_crosswalk_heads h
      where h.source_id = v_source.id and h.locator = v_variant.locator
      for update;
      v_has_head := found;
      v_vrow := null;
      if v_has_head then
        select r.* into v_vrow from public.menu_crosswalk r where r.id = v_vhead.row_id;
      end if;
      -- A variant proposal deferred while its entry awaited review.
      v_deferred := v_has_head and v_vhead.status = 'needs_review' and v_vrow.basis = 'name_candidate';
      -- Written from this snapshot's evidence already.
      v_current := v_has_head and v_vhead.snapshot_id = p_snapshot and v_vhead.content_hash = v_content;

      if v_parent_item is null then
        -- The entry is not mapped: a mapping (or a removal) the variant had is
        -- reviewed again on this snapshot's evidence, as is a review still
        -- open on older evidence; an open proposal on older evidence is
        -- deferred. Nothing is proposed.
        if v_has_head and v_vhead.content_hash <> v_content
           and (v_vhead.status in ('proposed', 'ambiguous') or v_deferred) then
          perform private.menu_crosswalk_append(
            v_source.venue_id, v_source.id, p_snapshot, v_variant.locator, v_locator, v_content,
            v_vhead.item_id, null, v_vhead.channel, 'needs_review', 'name_candidate', '{}'::uuid[],
            jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
              'variant', v_variant.name,
              -- What was proposed, on the snapshot it was proposed from: not
              -- a candidate on this snapshot. A deferral deferred again keeps
              -- the original proposal.
              'deferredProposal', case
                when v_deferred then v_vrow.evidence -> 'deferredProposal'
                else jsonb_build_object(
                  'role', 'historical',
                  'rowId', v_vrow.id,
                  'snapshotId', v_vrow.snapshot_id,
                  'status', v_vrow.status,
                  'itemId', v_vrow.item_id,
                  'candidates', to_jsonb(v_vrow.candidates),
                  'candidateCount', coalesce(v_vrow.evidence -> 'candidateCount',
                    to_jsonb(cardinality(v_vrow.candidates))))
              end),
            v_uid, null, null, null);
          n_review := n_review + 1;
        elsif v_has_head and not v_current
           and (v_vhead.status in ('confirmed', 'carried', 'not_on_source')
                or (v_vhead.status = 'needs_review' and v_vhead.content_hash <> v_content)) then
          perform private.menu_crosswalk_append(
            v_source.venue_id, v_source.id, p_snapshot, v_variant.locator, v_locator, v_content,
            v_vhead.item_id, v_vhead.variant_id, v_vhead.channel, 'needs_review', 'carried',
            case when v_vhead.variant_id is null then '{}'::uuid[] else array[v_vhead.variant_id] end,
            jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
              'variant', v_variant.name),
            v_uid, null, null, null);
          n_review := n_review + 1;
        end if;
        continue;
      end if;

      v_same_item := v_has_head and v_vhead.item_id is not distinct from v_parent_item;
      -- A deferred proposal is matched afresh once its entry is mapped.
      if v_current and v_same_item and not v_deferred then
        n_skipped := n_skipped + 1;
        continue;
      end if;

      if v_has_head and v_vhead.status in ('confirmed', 'carried') then
        if v_vhead.content_hash = v_content and v_same_item then
          select r.reviewed_by, r.reviewed_at into v_reviewer, v_reviewed_at
          from public.menu_crosswalk r where r.id = v_vhead.row_id;
          perform private.menu_crosswalk_append(
            v_source.venue_id, v_source.id, p_snapshot, v_variant.locator, v_locator, v_content,
            v_vhead.item_id, v_vhead.variant_id, v_vhead.channel, 'carried', 'carried', '{}'::uuid[],
            jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
              'variant', v_variant.name),
            v_uid, v_reviewer, v_reviewed_at, null);
          n_carried := n_carried + 1;
        else
          perform private.menu_crosswalk_append(
            v_source.venue_id, v_source.id, p_snapshot, v_variant.locator, v_locator, v_content,
            v_vhead.item_id, v_vhead.variant_id, v_vhead.channel, 'needs_review', 'carried',
            case when v_vhead.variant_id is null then '{}'::uuid[] else array[v_vhead.variant_id] end,
            jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
              'variant', v_variant.name),
            v_uid, null, null, null);
          n_review := n_review + 1;
        end if;
        continue;
      end if;

      if v_has_head and v_vhead.status in ('unmatched', 'rejected') and v_vhead.content_hash = v_content
         and v_same_item then
        n_skipped := n_skipped + 1;
        continue;
      end if;

      -- New, removed and back, decided on other content, proposed inside
      -- another item (the entry was mapped again), or deferred while the
      -- entry awaited review: matched afresh, only among the variants of the
      -- mapped item on the active version.
      select coalesce(array_agg(ev.variant_id order by ev.position), '{}') into v_ids
      from public.menu_entry_variants ev
      join public.menu_entries e on e.id = ev.entry_id
      where e.version_id = v_version
        and e.item_id = v_parent_item
        and lower(btrim(ev.name)) = v_variant.name_key;
      v_count := cardinality(v_ids);
      v_single := v_count = 1 and v_variant.occurrence = 1;
      perform private.menu_crosswalk_append(
        v_source.venue_id, v_source.id, p_snapshot, v_variant.locator, v_locator, v_content,
        v_parent_item, case when v_single then v_ids[1] end, 'all',
        case when v_count = 0 or v_single then 'proposed' else 'ambiguous' end,
        'name_candidate', v_ids[1:20],
        jsonb_build_object('entry', private.menu_crosswalk_entry_evidence(v_entry),
          'variant', v_variant.name, 'candidateCount', v_count),
        v_uid, null, null, null);
      if v_count = 0 or v_single then
        n_proposed := n_proposed + 1;
      else
        n_ambiguous := n_ambiguous + 1;
      end if;
    end loop;
  end loop;

  -- 3. Locators the snapshot no longer lists, entries and variants alike.
  for v_head in
    select h.* from public.menu_crosswalk_heads h
    where h.source_id = v_source.id
      and h.status <> 'not_on_source'
      and not (h.locator = any (v_listed))
    order by h.locator collate "C"
    for update
  loop
    perform private.menu_crosswalk_requeue(v_head, p_snapshot, 'not_on_source', v_uid);
    n_gone := n_gone + 1;
  end loop;

  insert into public.menu_crosswalk_runs (snapshot_id, source_id, venue_id, run_by)
  values (p_snapshot, v_source.id, v_source.venue_id, v_uid)
  on conflict (snapshot_id) do nothing;

  v_result := jsonb_build_object(
    'snapshotId', p_snapshot,
    'counts', jsonb_build_object(
      'proposed', n_proposed, 'ambiguous', n_ambiguous, 'carried', n_carried,
      'needsReview', n_review, 'notOnSource', n_gone, 'skipped', n_skipped),
    'replayed', false);
  return private.menu_source_record(p_request_key, v_uid, 'crosswalk_propose', v_hash,
    v_source.venue_id, v_result);
end;
$$;

-- Confirm, reject or mark unmatched one crosswalk row (§4.5). Admin only until
-- OD-B4-2. p_row must be the row in force for its locator and p_expected its
-- head revision. Enforces §4.2 #3: one identity per source entry, one source
-- entry per (item, variant, channel), both refused with crosswalk_conflict.
-- Only current source evidence is decided (§4.2 #2, #6): while the source's
-- newest snapshot awaits the matcher, every decision is
-- crosswalk_reconcile_pending; a row whose entry or variant that snapshot does
-- not list (a not_on_source row included) is crosswalk_not_on_source, as is a
-- confirmation whose content hash is not the listed entry's. A replayed
-- request key returns its first result before any of this.
create function public.menu_crosswalk_decide(
  p_row uuid, p_expected integer, p_status text, p_item uuid, p_variant uuid, p_channel text,
  p_reason text, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_channel text := coalesce(p_channel, 'all');
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_row public.menu_crosswalk;
  v_head public.menu_crosswalk_heads;
  v_parent public.menu_crosswalk_heads;
  v_child public.menu_crosswalk_heads;
  v_latest public.menu_source_snapshots;
  v_entry jsonb;
  v_version uuid;
  v_basis text;
  v_item uuid;
  v_variant uuid;
  v_id uuid;
begin
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'row', p_row, 'expected', p_expected, 'status', p_status, 'item', p_item, 'variant', p_variant,
    'channel', v_channel, 'reason', v_reason));
  v_prior := private.menu_source_replay(p_request_key, v_uid, 'crosswalk_decide', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select r.* into v_row from public.menu_crosswalk r where r.id = p_row;
  if not found then
    raise exception 'crosswalk_row_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.menu_sources s where s.id = v_row.source_id and s.retired_at is not null) then
    raise exception 'menu_source_retired' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('confirmed', 'rejected', 'unmatched') then
    raise exception 'invalid_crosswalk_status' using errcode = '22023';
  end if;
  if v_channel not in ('all', 'dine_in', 'takeaway') then
    raise exception 'invalid_crosswalk_channel' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  perform private.lock_venue_menu(v_row.venue_id, true);
  perform private.lock_menu_source_crosswalk(v_row.source_id);
  select h.* into v_head
  from public.menu_crosswalk_heads h
  where h.source_id = v_row.source_id and h.locator = v_row.locator
  for update;
  if not found or v_head.row_id is distinct from p_row or p_expected is null
     or v_head.revision <> p_expected then
    raise exception 'crosswalk_stale' using errcode = '40001',
      detail = jsonb_build_object('rowId', v_head.row_id, 'revision', v_head.revision)::text;
  end if;

  -- Snapshots are recorded under the source's crosswalk lock, so the newest
  -- cannot change before this decision commits.
  select s.* into v_latest
  from public.menu_source_snapshots s
  where s.source_id = v_row.source_id
  order by s.seq desc
  limit 1;
  if not exists (select 1 from public.menu_crosswalk_runs cr where cr.snapshot_id = v_latest.id) then
    raise exception 'crosswalk_reconcile_pending' using errcode = 'P0001';
  end if;
  v_entry := private.menu_crosswalk_occurrence(v_latest.document, v_head.locator, v_head.entry_locator);
  if v_head.status = 'not_on_source' or v_entry is null
     or (p_status = 'confirmed' and private.menu_crosswalk_content_hash(v_entry) <> v_head.content_hash) then
    raise exception 'crosswalk_not_on_source' using errcode = 'P0001';
  end if;

  if p_status = 'confirmed' then
    if p_item is null then
      raise exception 'crosswalk_item_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.menu_items i where i.id = p_item and i.venue_id = v_row.venue_id) then
      raise exception 'menu_item_wrong_venue' using errcode = 'P0001';
    end if;
    v_version := private.active_menu_version_id(v_row.venue_id);
    if not exists (
      select 1 from public.menu_entries e
      join public.menu_items i on i.id = e.item_id
      where e.version_id = v_version and e.item_id = p_item and i.archived_at is null
    ) then
      raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
    end if;
    if p_variant is not null and not exists (
      select 1 from public.menu_entry_variants ev
      join public.menu_entries e on e.id = ev.entry_id
      where e.version_id = v_version and ev.item_id = p_item and ev.variant_id = p_variant
    ) then
      raise exception 'crosswalk_variant_wrong_item' using errcode = 'P0001';
    end if;
    if v_row.entry_locator is not null then
      if p_variant is null then
        raise exception 'crosswalk_variant_required' using errcode = '22023';
      end if;
      select h.* into v_parent
      from public.menu_crosswalk_heads h
      where h.source_id = v_row.source_id and h.locator = v_row.entry_locator;
      if not found or v_parent.status not in ('confirmed', 'carried') or v_parent.item_id <> p_item then
        raise exception 'crosswalk_parent_not_confirmed' using errcode = 'P0001';
      end if;
    end if;
    -- One identity per source entry: undo a mapping before choosing another.
    if v_head.status in ('confirmed', 'carried')
       and (v_head.item_id, v_head.variant_id, v_head.channel)
           is distinct from (p_item, p_variant, v_channel) then
      raise exception 'crosswalk_conflict' using errcode = 'P0001';
    end if;
    -- One source entry per identity line.
    if exists (
      select 1 from public.menu_crosswalk_heads h
      where h.source_id = v_row.source_id
        and h.locator <> v_row.locator
        and h.status in ('confirmed', 'carried')
        and h.item_id = p_item
        and h.variant_id is not distinct from p_variant
        and h.channel = v_channel
    ) then
      raise exception 'crosswalk_conflict' using errcode = 'P0001';
    end if;
    v_item := p_item;
    v_variant := p_variant;
    -- A deferred variant proposal names no candidate, so a variant chosen on
    -- it was not name-matched.
    v_basis := case
      when v_row.entry_locator is not null and v_row.status = 'needs_review'
        and v_row.basis = 'name_candidate'
        then 'manual'
      when v_row.basis <> 'carried'
        and (p_item = v_row.item_id or p_item = any (v_row.candidates)
             or (v_row.entry_locator is not null and p_variant = any (v_row.candidates)))
        then v_row.basis
      else 'manual'
    end;
  else
    if p_item is not null or p_variant is not null then
      raise exception 'invalid_crosswalk_decision' using errcode = '22023';
    end if;
    -- A rejected row keeps what was rejected; an unmatched entry maps nothing.
    -- A variant row keeps the item it was matched inside, so the matcher can
    -- tell a decision under this item from one under an item mapped since.
    v_item := case when p_status = 'rejected' or v_row.entry_locator is not null then v_row.item_id end;
    v_variant := case when p_status = 'rejected' then v_row.variant_id end;
    v_basis := case when p_status = 'rejected' and v_row.basis <> 'carried' then v_row.basis else 'manual' end;
  end if;

  begin
    v_id := private.menu_crosswalk_append(
      v_row.venue_id, v_row.source_id, v_row.snapshot_id, v_row.locator, v_row.entry_locator,
      v_row.content_hash, v_item, v_variant, v_channel, p_status, v_basis, v_row.candidates,
      v_row.evidence, v_uid, v_uid, now(), v_reason);
  exception when unique_violation then
    raise exception 'crosswalk_conflict' using errcode = 'P0001';
  end;

  -- An entry that is no longer mapped sends its mapped variant rows to review.
  if v_row.entry_locator is null and p_status <> 'confirmed'
     and v_head.status in ('confirmed', 'carried') then
    for v_child in
      select h.* from public.menu_crosswalk_heads h
      where h.source_id = v_row.source_id
        and h.entry_locator = v_row.locator
        and h.status in ('confirmed', 'carried')
      order by h.locator collate "C"
      for update
    loop
      perform private.menu_crosswalk_requeue(v_child, v_child.snapshot_id, 'needs_review', v_uid);
    end loop;
  end if;

  return private.menu_source_record(p_request_key, v_uid, 'crosswalk_decide', v_hash, v_row.venue_id,
    jsonb_build_object('rowId', v_id, 'status', p_status, 'revision', v_head.revision + 1,
      'replayed', false));
end;
$$;

-- Append a field authority row (§4.5), recorded as the owner's approval. A
-- switch to `nabalens` is refused for every field that is not NabaLens's
-- already (identity, photos) until B04-05's reconciliation exists (§4.4).
create function public.menu_set_field_authority(
  p_venue uuid, p_field text, p_channel text, p_authority text, p_source uuid, p_reason text,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_channel text := coalesce(p_channel, 'all');
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_source public.menu_sources;
  v_latest public.menu_field_authority;
  v_has_latest boolean;
  v_id uuid;
  v_result jsonb;
begin
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'venue', p_venue, 'field', p_field, 'channel', v_channel, 'authority', p_authority,
    'source', p_source, 'reason', v_reason));
  v_prior := private.menu_source_replay(p_request_key, v_uid, 'set_field_authority', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_field is null or not (p_field = any (private.menu_fields())) then
    raise exception 'invalid_menu_field' using errcode = '22023';
  end if;
  if v_channel not in ('all', 'dine_in', 'takeaway') then
    raise exception 'invalid_crosswalk_channel' using errcode = '22023';
  end if;
  if p_authority is null
     or p_authority not in ('source_document', 'venue_website', 'nabalens', 'not_published') then
    raise exception 'invalid_field_authority' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'invalid_authority_reason' using errcode = '22023';
  end if;
  if p_authority = 'nabalens' and p_field not in ('identity', 'photos') then
    raise exception 'authority_switch_not_enabled' using errcode = 'P0001';
  end if;
  if p_authority in ('source_document', 'venue_website') then
    if p_source is null then
      raise exception 'menu_source_required' using errcode = '22023';
    end if;
    select s.* into v_source
    from public.menu_sources s
    where s.id = p_source and s.venue_id = p_venue and s.retired_at is null;
    if not found then
      raise exception 'menu_source_not_found' using errcode = 'P0002';
    end if;
    if (p_authority = 'venue_website') <> (v_source.kind = 'venue_website')
       or v_source.kind = 'nabalens' then
      raise exception 'menu_source_kind_mismatch' using errcode = '22023';
    end if;
  elsif p_source is not null then
    raise exception 'invalid_field_authority' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'nabalens_menu_authority:' || p_venue::text || ':' || p_field || ':' || v_channel, 0));
  select a.* into v_latest
  from public.menu_field_authority a
  where a.venue_id = p_venue and a.field = p_field and a.channel = v_channel
    and not exists (select 1 from public.menu_field_authority n where n.supersedes = a.id);
  v_has_latest := found;

  if v_has_latest and v_latest.basis = 'owner_approval' and v_latest.authority = p_authority
     and v_latest.source_id is not distinct from p_source then
    v_result := jsonb_build_object('authorityId', v_latest.id, 'unchanged', true, 'replayed', false);
  else
    begin
      insert into public.menu_field_authority (
        venue_id, field, channel, authority, source_id, basis, approved_by, approved_at, reason, supersedes
      )
      values (
        p_venue, p_field, v_channel, p_authority, p_source, 'owner_approval', v_uid, now(), v_reason,
        case when v_has_latest then v_latest.id end
      )
      returning id into v_id;
    exception when unique_violation then
      raise exception 'menu_authority_conflict' using errcode = '40001';
    end;
    v_result := jsonb_build_object('authorityId', v_id, 'unchanged', false, 'replayed', false);
  end if;
  return private.menu_source_record(p_request_key, v_uid, 'set_field_authority', v_hash, p_venue, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Manifest read (B04-01d): admin, or the venue's manager. One snapshot.
-- ---------------------------------------------------------------------------

-- Managers see authorities, sources (without locators), coverage and outcomes;
-- only admins see reasons, approvers, source locators, price text and the
-- review list with evidence. Staff and other venues see nothing.
create function public.menu_manifest(p_venue uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_version uuid;
  v_result jsonb;
begin
  if auth.uid() is null or p_venue is null or not private.can_manage_venue(p_venue) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_admin := private.is_active_admin();
  v_version := private.active_menu_version_id(p_venue);

  with
  latest as (
    select a.*
    from public.menu_field_authority a
    where a.venue_id = p_venue
      and not exists (select 1 from public.menu_field_authority n where n.supersedes = a.id)
  ),
  field_rows as (
    select f.ord, c.cord, f.field, c.channel,
      coalesce(l.authority, private.menu_default_field_authority(f.field)) as authority,
      l.source_id, l.effective_from, coalesce(l.basis, 'design_default') as basis,
      coalesce(l.reason, 'Design default (b04-design §4.4, OD-B4-1); owner to confirm.') as reason,
      l.approved_by, l.approved_at
    from unnest(private.menu_fields()) with ordinality as f(field, ord)
    cross join unnest(array['all', 'dine_in', 'takeaway']) with ordinality as c(channel, cord)
    left join latest l on l.field = f.field and l.channel = c.channel
    where c.channel = 'all' or l.id is not null
  ),
  sources as (
    select s.*
    from public.menu_sources s
    where s.venue_id = p_venue and (v_admin or s.retired_at is null)
  ),
  entries as (
    select e.item_id, e.name, sec.name as section_name, sec.kind as section_kind,
      sec.position as section_position, e.position as entry_position
    from public.menu_entries e
    join public.menu_sections sec on sec.id = e.section_id
    where e.version_id = v_version
  ),
  outcomes as (
    select e.item_id, s.id as source_id, s.declared_at,
      case
        when exists (
          select 1 from public.menu_crosswalk_heads h
          where h.source_id = s.id and h.item_id = e.item_id and h.entry_locator is null
            and h.status in ('confirmed', 'carried')
        ) then 'confirmed'
        when exists (
          select 1 from public.menu_crosswalk_heads h
          where h.source_id = s.id and h.entry_locator is null
            and h.status in ('proposed', 'ambiguous', 'needs_review')
            and (h.item_id = e.item_id or h.candidates @> array[e.item_id])
        ) then 'needs_review'
        when exists (select 1 from public.menu_crosswalk_heads h where h.source_id = s.id)
          then 'not_on_source'
        else 'unmatched'
      end as outcome,
      (
        select r.evidence #>> '{entry,priceText}'
        from public.menu_crosswalk_heads h
        join public.menu_crosswalk r on r.id = h.row_id
        where h.source_id = s.id and h.item_id = e.item_id and h.entry_locator is null
          and h.status in ('confirmed', 'carried', 'proposed', 'needs_review')
        order by (h.status in ('confirmed', 'carried')) desc, h.locator collate "C"
        limit 1
      ) as price_text
    from entries e
    cross join sources s
    where s.retired_at is null
  ),
  review as (
    select h.*, r.basis, r.evidence, r.proposed_at, s.declared_at
    from public.menu_crosswalk_heads h
    join public.menu_crosswalk r on r.id = h.row_id
    join sources s on s.id = h.source_id
    where v_admin and h.status in ('proposed', 'ambiguous', 'needs_review', 'not_on_source')
  )
  select jsonb_build_object(
    'schema', '1.0',
    'venueId', p_venue,
    'view', case when v_admin then 'admin' else 'manager' end,
    'activeVersionId', v_version,
    'fields', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'field', fr.field, 'channel', fr.channel, 'authority', fr.authority,
          'sourceId', fr.source_id, 'sourceKind', src.kind, 'sourceLabel', src.label,
          'effectiveFrom', fr.effective_from, 'basis', fr.basis)
        || case when v_admin then jsonb_build_object(
             'reason', fr.reason, 'approvedBy', fr.approved_by, 'approvedAt', fr.approved_at)
           else '{}'::jsonb end
        order by fr.ord, fr.cord)
      from field_rows fr
      left join public.menu_sources src on src.id = fr.source_id
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sourceId', s.id, 'kind', s.kind, 'label', s.label, 'declaredAt', s.declared_at,
          'retiredAt', s.retired_at,
          'latestSnapshot', (
            select jsonb_build_object('revision', snap.source_revision, 'capturedAt', snap.captured_at,
                'retrievedAt', snap.retrieved_at, 'entryCount', snap.entry_count)
              || case when v_admin then jsonb_build_object('snapshotId', snap.id) else '{}'::jsonb end
            from public.menu_source_snapshots snap
            where snap.source_id = s.id
            order by snap.seq desc
            limit 1),
          -- The rows, outcomes and price text of this source stand for the
          -- newest snapshot the matcher has run on, not a newer one.
          'reconciledSnapshot', (
            select jsonb_build_object('revision', snap.source_revision, 'capturedAt', snap.captured_at,
                'retrievedAt', snap.retrieved_at, 'entryCount', snap.entry_count)
              || case when v_admin then jsonb_build_object('snapshotId', snap.id) else '{}'::jsonb end
            from public.menu_source_snapshots snap
            join public.menu_crosswalk_runs cr on cr.snapshot_id = snap.id
            where snap.source_id = s.id
            order by snap.seq desc
            limit 1),
          'reconciliationPending', coalesce((
            select not exists (select 1 from public.menu_crosswalk_runs cr where cr.snapshot_id = snap.id)
            from public.menu_source_snapshots snap
            where snap.source_id = s.id
            order by snap.seq desc
            limit 1), false),
          'counts', coalesce((
            select jsonb_object_agg(c.status, c.n)
            from (
              select h.status, count(*) as n
              from public.menu_crosswalk_heads h
              where h.source_id = s.id
              group by h.status
            ) c), '{}'::jsonb))
        || case when v_admin then jsonb_build_object('locator', s.locator) else '{}'::jsonb end
        order by s.declared_at, s.id)
      from sources s
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemId', e.item_id, 'name', e.name, 'sectionName', e.section_name,
          'sectionKind', e.section_kind,
          'outcomes', coalesce((
            select jsonb_agg(
              jsonb_build_object('sourceId', o.source_id, 'outcome', o.outcome)
              || case when v_admin then jsonb_build_object('priceText', o.price_text) else '{}'::jsonb end
              order by o.declared_at, o.source_id)
            from outcomes o
            where o.item_id = e.item_id), '[]'::jsonb),
          'priceDisagreement', coalesce((
            select count(distinct o.price_text) > 1 from outcomes o where o.item_id = e.item_id), false))
        order by e.section_position, e.entry_position)
      from entries e
    ), '[]'::jsonb),
    'review', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
          'rowId', x.row_id, 'revision', x.revision, 'sourceId', x.source_id, 'locator', x.locator,
          'entryLocator', x.entry_locator, 'status', x.status, 'basis', x.basis, 'itemId', x.item_id,
          'variantId', x.variant_id, 'channel', x.channel, 'candidates', to_jsonb(x.candidates),
          'evidence', x.evidence, 'proposedAt', x.proposed_at)
        order by x.declared_at, x.source_id, x.locator collate "C")
      from (
        select rv.* from review rv
        order by rv.declared_at, rv.source_id, rv.locator collate "C"
        limit 5000
      ) x
    ), '[]'::jsonb) end,
    'reviewTruncated', (select count(*) > 5000 from review),
    -- Where public.menu_crosswalk_rows continues a truncated review list.
    'reviewNext', (
      select jsonb_build_object('sourceId', x.source_id, 'locator', x.locator)
      from (
        select rv.source_id, rv.locator from review rv
        order by rv.declared_at, rv.source_id, rv.locator collate "C"
        offset 4999 limit 1
      ) x
      where (select count(*) > 5000 from review))
  ) into v_result;
  return v_result;
end;
$$;

-- One page of a venue's crosswalk rows in force (admin only), in the
-- manifest's review order: source declared_at, source id, locator in "C"
-- order. p_statuses defaults to the review list (open and removed rows); with
-- ('confirmed', 'carried') it finds the current mappings, each with its row id
-- and revision, so a reviewer can reject one before choosing another (§4.2
-- #3). p_source and p_item narrow the page. The cursor (p_after_source,
-- p_after_locator) is the previous page's `next`, or the manifest's
-- reviewNext; it is the last row returned, and the page starts after it.
-- p_limit: 1 to 1000 rows, default 100. One STABLE statement.
create function public.menu_crosswalk_rows(
  p_venue uuid,
  p_statuses text[],
  p_source uuid,
  p_item uuid,
  p_after_source uuid,
  p_after_locator text,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_statuses text[] := coalesce(p_statuses,
    array['proposed', 'ambiguous', 'needs_review', 'not_on_source']);
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 1000));
  v_after_at timestamptz;
  v_result jsonb;
begin
  perform private.assert_active_admin();
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if cardinality(v_statuses) = 0 or array_position(v_statuses, null) is not null
     or not (v_statuses <@ array['proposed', 'ambiguous', 'confirmed', 'unmatched', 'not_on_source',
                                 'needs_review', 'rejected', 'carried']) then
    raise exception 'invalid_crosswalk_status' using errcode = '22023';
  end if;
  if p_source is not null
     and not exists (select 1 from public.menu_sources s where s.id = p_source and s.venue_id = p_venue) then
    raise exception 'menu_source_not_found' using errcode = 'P0002';
  end if;
  if (p_after_source is null) <> (p_after_locator is null) then
    raise exception 'invalid_crosswalk_cursor' using errcode = '22023';
  end if;
  if p_after_source is not null then
    select s.declared_at into v_after_at
    from public.menu_sources s
    where s.id = p_after_source and s.venue_id = p_venue;
    if not found then
      raise exception 'invalid_crosswalk_cursor' using errcode = '22023';
    end if;
  end if;

  with page as (
    select h.row_id, h.revision, h.source_id, h.locator, h.entry_locator, h.status, h.item_id,
      h.variant_id, h.channel, h.candidates, r.basis, r.evidence, r.proposed_at, r.reviewed_by,
      r.reviewed_at, r.reason,
      row_number() over (order by s.declared_at, s.id, h.locator collate "C") as n
    from public.menu_crosswalk_heads h
    join public.menu_crosswalk r on r.id = h.row_id
    join public.menu_sources s on s.id = h.source_id
    where s.venue_id = p_venue
      and h.status = any (v_statuses)
      and (p_source is null or h.source_id = p_source)
      and (p_item is null or h.item_id = p_item)
      and (p_after_source is null
        or (s.declared_at, s.id) > (v_after_at, p_after_source)
        or (s.id = p_after_source and h.locator collate "C" > p_after_locator collate "C"))
    order by s.declared_at, s.id, h.locator collate "C"
    limit v_limit + 1
  )
  select jsonb_build_object(
    'venueId', p_venue,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'rowId', x.row_id, 'revision', x.revision, 'sourceId', x.source_id, 'locator', x.locator,
          'entryLocator', x.entry_locator, 'status', x.status, 'basis', x.basis, 'itemId', x.item_id,
          'variantId', x.variant_id, 'channel', x.channel, 'candidates', to_jsonb(x.candidates),
          'evidence', x.evidence, 'proposedAt', x.proposed_at, 'reviewedBy', x.reviewed_by,
          'reviewedAt', x.reviewed_at, 'reason', x.reason)
        order by x.n)
      from page x
      where x.n <= v_limit), '[]'::jsonb),
    'next', (
      select jsonb_build_object('sourceId', x.source_id, 'locator', x.locator)
      from page x
      where x.n = v_limit and exists (select 1 from page y where y.n > v_limit))
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_fields(),
  private.menu_default_field_authority(text),
  private.menu_crosswalk_name_key(text),
  private.menu_crosswalk_content_hash(jsonb),
  private.menu_snapshot_text_ok(jsonb, integer, boolean),
  private.menu_snapshot_list_ok(jsonb, integer, integer),
  private.menu_snapshot_document_error(jsonb),
  private.menu_source_request_hash(jsonb),
  private.menu_locator_part(text),
  private.menu_crosswalk_variants(jsonb),
  private.menu_crosswalk_occurrence(jsonb, text, text),
  private.menu_sources_guard(),
  private.menu_crosswalk_heads_guard(),
  private.menu_source_replay(uuid, uuid, text, text),
  private.menu_source_record(uuid, uuid, text, text, uuid, jsonb),
  private.lock_menu_source_crosswalk(uuid),
  private.menu_crosswalk_append(uuid, uuid, uuid, text, text, text, uuid, uuid, text, text, text, uuid[], jsonb, uuid, uuid, timestamptz, text),
  private.menu_crosswalk_entry_evidence(jsonb),
  private.menu_crosswalk_requeue(public.menu_crosswalk_heads, uuid, text, uuid)
from public, anon, authenticated;

revoke all on function
  public.menu_declare_source(uuid, text, text, text, uuid),
  public.menu_record_snapshot(uuid, text, text, timestamptz, jsonb, uuid),
  public.menu_crosswalk_propose(uuid, uuid),
  public.menu_crosswalk_decide(uuid, integer, text, uuid, uuid, text, text, uuid),
  public.menu_set_field_authority(uuid, text, text, text, uuid, text, uuid),
  public.menu_manifest(uuid),
  public.menu_crosswalk_rows(uuid, text[], uuid, uuid, uuid, text, integer)
from public, anon, service_role;

grant execute on function
  public.menu_declare_source(uuid, text, text, text, uuid),
  public.menu_record_snapshot(uuid, text, text, timestamptz, jsonb, uuid),
  public.menu_crosswalk_propose(uuid, uuid),
  public.menu_crosswalk_decide(uuid, integer, text, uuid, uuid, text, text, uuid),
  public.menu_set_field_authority(uuid, text, text, text, uuid, text, uuid),
  public.menu_manifest(uuid),
  public.menu_crosswalk_rows(uuid, text[], uuid, uuid, uuid, text, integer)
to authenticated;
