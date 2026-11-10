-- B04-b1 (b04-design §5, §10, A1-4, A1-5, §18 L2/L4, §19.2 S2): trading lines,
-- append-only trading assertions and decisions, availability schedules and
-- exceptions, temporary unavailability, the price parser, the read-time
-- resolver, and the b1 menu recheck foundation.
--
-- Additive only. No catalogue, label, photo or credit object changes: no
-- function here writes menu_items, menu_variants, menu_versions,
-- menu_entries, menu_entry_variants, menu_item_photos, menu_item_photo_events
-- or media_label_items, and private.monthly_venue_completion_counts is not
-- re-created (§13.2). One constraint is added to an S1 table:
-- menu_source_snapshots (id, venue_id) unique, so a source-mapped assertion's
-- snapshot is structurally the same venue's (§3).
-- Inert (no reader): nothing consumes these values until a release is
-- activated for a venue (B04-05/06). No row is written by this migration.
--
-- Values. A price is integer minor units plus currency (GBP only, OD-B4-4),
-- `fixed` only (OD-B4-5). The parser reads decimal text exactly, never
-- floating point. A source-mapped price whose text is "MP", "from 9.95" or
-- "4.30 / 2.40" is kept as an `ambiguous` proposal that can be declined or
-- withdrawn but never confirmed; any other caller gets invalid_price.
-- The resolver never reads menu_entries.source_meta (§5.2 #2).
--
-- Resolution (§5.5, A1-6) at an instant t, per line and field: an assertion
-- counts once confirmed at or before t; it starts at the later of its
-- confirmation and venue-local midnight of effective_from, and ends at
-- local midnight after effective_to. A confirmed assertion in force at some
-- moment (not withdrawn before it started) and covering t is "covering".
-- Every ancestor (supersedes chain) of a covering assertion drops out, so a
-- correction replaces what it supersedes only on its own dates, and a
-- withdrawal never brings an older value back. Of what remains, exactly one
-- unwithdrawn assertion is the value; two or more read
-- unavailable / disputed / conflict; only withdrawn ones read
-- unavailable / withdrawn / value_withdrawn; none reads
-- unavailable / unknown / not_recorded. Mirrored by resolveField in
-- lib/menus/trading/resolve.ts.
--
-- Availability: temporary unavailability first (in force before `until` →
-- temporarily_unavailable; at or after `until` → needs_checking, reason
-- stale / recheck_requested, with no job), then the confirmed availability
-- assertion: always, not_offered, or a schedule. A local schedule expands
-- through B03's shared private.schedule_occurrences (A27) over the previous
-- and current local dates, so a window past midnight belongs to its start
-- date and local times hold across clock changes. A schedule linked to a
-- same-venue B03 service check (knowledge_check_id) reads that check's B03
-- status and value (a deliberate stop in effect reads No, A40) and its
-- occurrences from public.knowledge_occurrences; B03 keeps that service's
-- recheck, and no menu task is opened for it (A1-4).
--
-- Decisions (§5.4, OD-B4-3 defaults): admin, the venue's manager, or a staff
-- account with a legacy manager grant (OD-B4-17, private.can_manage_venue)
-- confirm, decline or withdraw; one person may propose and confirm, recorded
-- as self_confirmed. A confirmation records stated_on (A1-2) and
-- stated_on_source (L2): form_default (the venue's today) or chosen (up to
-- 30 days earlier). Staff of the venue (private.staff_can_label_venue)
-- report price and temporary unavailability on active items only; a report
-- stays proposed, writes no credit input, and the command returns the line's
-- confirmed value separately (L4).
--
-- Lock order (§3): request key, venue menu lock (shared), line rows by id,
-- then a compare-and-set on the line revision (menu_trading_conflict, 40001).
-- Actor and venue scope are re-read before a request key replays.
--
-- Rechecks (A1-4, A1-5): public.menu_trading_recheck_tasks; the b1 cause is
-- temporary_until_passed. private.menu_open_rechecks(p_now) is idempotent
-- (one task per subject, cause, due time and use) and closes a task only once
-- the resolver no longer reads that passed `until`; a pending or declined
-- proposal leaves it open. private.menu_open_recheck_rows(p_venue_id) is the
-- A1-5 helper for WS1's triage union. Time never moves a photo (A1-1).
--
-- Rollback (§13.1): revoke execute on the public functions below; the tables
-- and their history stay.

-- ---------------------------------------------------------------------------
-- Closed sets and pure helpers (one list per side; lib/menus/trading/types.ts)
-- ---------------------------------------------------------------------------

create function private.menu_trading_currencies()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['GBP'];
$$;

-- ASCII letters to lower case only, so no locale changes a comparison
-- (asciiLower in price.ts).
create function private.menu_ascii_lower(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(p_text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
$$;

-- The price parser (§5.7, B04-02e; parsePrice in price.ts). Input: a JSON
-- string or number, read as its decimal text (a number by its jsonb text; the
-- server sends prices as strings). Outer U+0020 spaces are removed. Accepted:
-- an optional £, 1 to 6 ASCII digits, optionally a point and 1 or 2 digits.
-- Returns { ok: true, amountMinor, currency }, { ok: false, error:
-- 'ambiguous_price', form: market | from | multiple } for "MP", "M/P",
-- "market price", "from <price>" and "<price> / <price>", or { ok: false,
-- error: 'invalid_price' } (more than two decimals, a sign, free text, a
-- currency outside the list).
create function private.menu_parse_price(p_input jsonb, p_currency text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_lower text;
  v_match text[];
  v_price constant text := '£?[0-9]{1,6}(\.[0-9]{1,2})?';
begin
  if coalesce(p_currency, 'GBP') <> all (private.menu_trading_currencies()) then
    return jsonb_build_object('ok', false, 'error', 'invalid_price');
  end if;
  if jsonb_typeof(p_input) = 'number' then
    v_text := p_input::text;
  elsif jsonb_typeof(p_input) = 'string' then
    v_text := p_input #>> '{}';
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_price');
  end if;
  v_text := btrim(v_text, ' ');
  if length(v_text) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_price');
  end if;
  v_match := regexp_match(v_text, '^£?([0-9]{1,6})(\.([0-9]{1,2}))?$');
  if v_match is not null then
    return jsonb_build_object('ok', true,
      'amountMinor', v_match[1]::bigint * 100 + case
        when v_match[3] is null then 0
        when length(v_match[3]) = 1 then v_match[3]::bigint * 10
        else v_match[3]::bigint end,
      'currency', coalesce(p_currency, 'GBP'));
  end if;
  v_lower := private.menu_ascii_lower(v_text);
  if v_lower in ('mp', 'm/p', 'market price') then
    return jsonb_build_object('ok', false, 'error', 'ambiguous_price', 'form', 'market');
  end if;
  if v_lower ~ ('^from ' || v_price || '$') then
    return jsonb_build_object('ok', false, 'error', 'ambiguous_price', 'form', 'from');
  end if;
  if v_text ~ ('^' || v_price || ' ?/ ?' || v_price || '$') then
    return jsonb_build_object('ok', false, 'error', 'ambiguous_price', 'form', 'multiple');
  end if;
  return jsonb_build_object('ok', false, 'error', 'invalid_price');
end;
$$;

-- Sorted keys of a JSON object.
create function private.menu_json_keys(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k order by k collate "C"), '{}') from jsonb_object_keys(p_value) as k;
$$;

-- The stored value schema per field (§5.3; tradingValueProblem in types.ts).
-- Null when valid, else a short problem name.
--   price: { kind: 'fixed', amountMinor: 0..99999999, currency: 'GBP' } or,
--     source-mapped only, { kind: 'ambiguous', form }
--   availability: { state: 'always' | 'not_offered' } or
--     { state: 'scheduled', scheduleId }
--   temporary_unavailability: { state: 'temporarily_unavailable',
--     until: 'YYYY-MM-DDTHH:MM:SSZ' | null } or { state: 'back_in_service' }
create function private.menu_trading_value_problem(p_field text, p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'object' then 'not_an_object'
    when p_field = 'price' then case
      when p_value ->> 'kind' = 'fixed' then case
        when private.menu_json_keys(p_value) <> array['amountMinor', 'currency', 'kind'] then 'keys'
        -- 0 to 99999999 (8 digits): exact in SQL and in a JavaScript number
        -- (PRICE_MAX_MINOR in types.ts).
        when jsonb_typeof(p_value -> 'amountMinor') <> 'number'
          or (p_value ->> 'amountMinor') !~ '^[0-9]{1,8}$' then 'amount'
        when jsonb_typeof(p_value -> 'currency') <> 'string'
          or (p_value ->> 'currency') <> all (private.menu_trading_currencies()) then 'currency'
      end
      when p_value ->> 'kind' = 'ambiguous' then case
        when private.menu_json_keys(p_value) <> array['form', 'kind'] then 'keys'
        when jsonb_typeof(p_value -> 'form') <> 'string'
          or (p_value ->> 'form') not in ('market', 'from', 'multiple') then 'form'
      end
      else 'kind'
    end
    when p_field = 'availability' then case
      when p_value ->> 'state' in ('always', 'not_offered') then case
        when private.menu_json_keys(p_value) <> array['state'] then 'keys'
      end
      when p_value ->> 'state' = 'scheduled' then case
        when private.menu_json_keys(p_value) <> array['scheduleId', 'state'] then 'keys'
        when jsonb_typeof(p_value -> 'scheduleId') <> 'string'
          or (p_value ->> 'scheduleId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then 'schedule'
      end
      else 'state'
    end
    when p_field = 'temporary_unavailability' then case
      when p_value ->> 'state' = 'temporarily_unavailable' then case
        when private.menu_json_keys(p_value) <> array['state', 'until'] then 'keys'
        when jsonb_typeof(p_value -> 'until') = 'null' then null
        when jsonb_typeof(p_value -> 'until') <> 'string'
          or (p_value ->> 'until') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' then 'until'
      end
      when p_value ->> 'state' = 'back_in_service' then case
        when private.menu_json_keys(p_value) <> array['state'] then 'keys'
      end
      else 'state'
    end
    else 'field'
  end;
$$;

-- An instant as stored in a temporary unavailability value: UTC, whole
-- seconds (untilText in types.ts).
create function private.menu_until_text(p_until timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(date_trunc('second', p_until) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

-- ---------------------------------------------------------------------------
-- S1 table: a same-venue key for source-mapped assertions (§3)
-- ---------------------------------------------------------------------------

alter table public.menu_source_snapshots
  add constraint menu_source_snapshots_id_venue_key unique (id, venue_id);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One sellable combination (§5.3, B04-02a): item, at most one variant, a
-- portion and a channel. Never deleted; identity never changes; retired once.
create table public.menu_trading_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  item_id uuid not null,
  variant_id uuid,
  portion_label text check (portion_label is null
    or (length(portion_label) between 1 and 40 and btrim(portion_label) = portion_label)),
  portion_quantity numeric(10, 3) check (portion_quantity is null or portion_quantity > 0),
  portion_unit text check (portion_unit is null
    or portion_unit in ('ml', 'cl', 'l', 'pint', 'g', 'kg', 'oz', 'piece')),
  channel text not null default 'all' check (channel in ('all', 'dine_in', 'takeaway')),
  -- Reserved for a modifier price-delta line (B04-03a, S5 adds the foreign
  -- key and lifts this check). No b1 write can set it.
  modifier_option_id uuid,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  constraint menu_trading_lines_id_venue_key unique (id, venue_id),
  -- Venue scope is structural (§3).
  constraint menu_trading_lines_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_trading_lines_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint menu_trading_lines_identity_key
    unique nulls not distinct (item_id, variant_id, portion_label, channel, modifier_option_id),
  constraint menu_trading_lines_modifier_reserved check (modifier_option_id is null),
  constraint menu_trading_lines_portion check (
    (portion_quantity is null) = (portion_unit is null)
    and (portion_quantity is null or portion_label is not null)
  ),
  constraint menu_trading_lines_retired check ((retired_at is null) = (retired_by is null))
);

create index menu_trading_lines_item_idx on public.menu_trading_lines (item_id);
create index menu_trading_lines_venue_idx on public.menu_trading_lines (venue_id);

comment on table public.menu_trading_lines is
  'Identity of one sellable line (item, optional variant, portion, channel). Never deleted; revision is the compare-and-set for trading writes.';

-- Availability schedules (B04-02c): B03 §6.1 shape, or a link to a same-venue
-- B03 service check. Append-only versions.
create table public.menu_availability_schedules (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null references public.venues (id) on delete restrict,
  timezone text not null default 'Europe/London' check (length(timezone) between 1 and 64),
  recurrence jsonb,
  windows jsonb,
  knowledge_check_id uuid,
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  supersedes uuid,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  command_key uuid not null,
  constraint menu_availability_schedules_id_venue_key unique (id, venue_id),
  constraint menu_availability_schedules_check_fkey foreign key (knowledge_check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  constraint menu_availability_schedules_supersedes_fkey foreign key (supersedes, venue_id)
    references public.menu_availability_schedules (id, venue_id) on delete restrict,
  -- Either an own schedule (recurrence and windows) or a linked service.
  constraint menu_availability_schedules_kind check (
    (recurrence is null) = (windows is null)
    and (knowledge_check_id is null) = (recurrence is not null)
  ),
  constraint menu_availability_schedules_shape check (
    recurrence is null or jsonb_array_length(private.schedule_problems('schedule',
      jsonb_strip_nulls(jsonb_build_object('effectiveFrom', to_char(effective_from, 'YYYY-MM-DD'),
        'effectiveTo', to_char(effective_to, 'YYYY-MM-DD'), 'recurrence', recurrence,
        'windows', windows)))) = 0
  )
);

comment on table public.menu_availability_schedules is
  'Append-only menu availability schedules: B03 schedule shape and expansion, or a link to a same-venue B03 service check whose status, stop and recheck stay B03''s.';

-- Dated exceptions on an own schedule: one per local date (as B03).
create table public.menu_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  schedule_id uuid not null,
  venue_id uuid not null,
  local_date date not null,
  kind text not null check (kind in ('cancelled', 'changed_window', 'extra')),
  windows jsonb,
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  command_key uuid not null,
  constraint menu_availability_exceptions_schedule_fkey foreign key (schedule_id, venue_id)
    references public.menu_availability_schedules (id, venue_id) on delete restrict,
  constraint menu_availability_exceptions_windows check (
    (kind = 'cancelled') = (windows is null)
    and (windows is null or jsonb_array_length(private.schedule_window_problems('windows', windows)) = 0)
  ),
  constraint menu_availability_exceptions_once unique (schedule_id, local_date)
);

comment on table public.menu_availability_exceptions is
  'Append-only dated exceptions (cancelled, changed window, extra) on an own menu schedule; notes are internal.';

-- Trading assertions (B04-02b): append-only. raw_text, source_locator and
-- reason are internal (admin; reason also manager).
create table public.menu_trading_assertions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  line_id uuid not null,
  venue_id uuid not null,
  field text not null check (field in ('price', 'availability', 'temporary_unavailability')),
  value jsonb not null,
  effective_from date,
  effective_to date,
  basis text not null check (basis in ('source_mapping', 'manager_statement', 'staff_report', 'correction', 'rollback')),
  snapshot_id uuid,
  source_locator text check (source_locator is null
    or (length(source_locator) between 1 and 1152 and octet_length(source_locator) <= 1532)),
  raw_text text check (raw_text is null or length(raw_text) between 1 and 80),
  stated_by uuid not null references public.profiles (id) on delete restrict,
  stated_at timestamptz not null default now(),
  observed_on date,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  supersedes uuid,
  command_key uuid not null,
  constraint menu_trading_assertions_line_key unique (id, line_id, field),
  constraint menu_trading_assertions_line_fkey foreign key (line_id, venue_id)
    references public.menu_trading_lines (id, venue_id) on delete restrict,
  constraint menu_trading_assertions_snapshot_fkey foreign key (snapshot_id, venue_id)
    references public.menu_source_snapshots (id, venue_id) on delete restrict,
  -- A correction supersedes an assertion of the same line and field.
  constraint menu_trading_assertions_supersedes_fkey foreign key (supersedes, line_id, field)
    references public.menu_trading_assertions (id, line_id, field) on delete restrict,
  constraint menu_trading_assertions_value check (private.menu_trading_value_problem(field, value) is null),
  constraint menu_trading_assertions_dates check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint menu_trading_assertions_temporary_dates check (
    field <> 'temporary_unavailability' or (effective_from is null and effective_to is null)
  ),
  -- A source-derived value cites its snapshot, locator and raw text.
  constraint menu_trading_assertions_source check (
    (basis = 'source_mapping') = (snapshot_id is not null)
    and (snapshot_id is null) = (source_locator is null)
    and (snapshot_id is null) = (raw_text is null)
  ),
  constraint menu_trading_assertions_ambiguous check (
    value ->> 'kind' is distinct from 'ambiguous' or basis = 'source_mapping'
  ),
  constraint menu_trading_assertions_staff check (
    basis <> 'staff_report' or field in ('price', 'temporary_unavailability')
  )
);

create index menu_trading_assertions_line_idx on public.menu_trading_assertions (line_id, field, seq);
create index menu_trading_assertions_supersedes_idx on public.menu_trading_assertions (supersedes)
  where supersedes is not null;

comment on table public.menu_trading_assertions is
  'Append-only trading assertions (price, availability, temporary unavailability). A value is current only through a confirmed decision; source text and locators are internal.';

-- Decisions (B04-02d): append-only.
create table public.menu_trading_decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  assertion_id uuid not null,
  line_id uuid not null,
  venue_id uuid not null,
  field text not null,
  decision text not null check (decision in ('confirmed', 'declined', 'withdrawn')),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  rule_version integer not null default 1 check (rule_version >= 1),
  self_confirmed boolean not null default false,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  -- A1-2 / L2: the freshness basis of a confirmed value.
  stated_on date,
  stated_on_source text check (stated_on_source in ('form_default', 'chosen')),
  line_revision integer not null check (line_revision >= 1),
  command_key uuid not null,
  constraint menu_trading_decisions_assertion_fkey foreign key (assertion_id, line_id, field)
    references public.menu_trading_assertions (id, line_id, field) on delete restrict,
  constraint menu_trading_decisions_line_fkey foreign key (line_id, venue_id)
    references public.menu_trading_lines (id, venue_id) on delete restrict,
  constraint menu_trading_decisions_stated check (
    (decision = 'confirmed') = (stated_on is not null)
    and (stated_on is null) = (stated_on_source is null)
  ),
  constraint menu_trading_decisions_self check (decision = 'confirmed' or not self_confirmed)
);

-- One confirmation and one end (declined or withdrawn) per assertion.
create unique index menu_trading_decisions_one_confirmation
  on public.menu_trading_decisions (assertion_id) where decision = 'confirmed';
create unique index menu_trading_decisions_one_end
  on public.menu_trading_decisions (assertion_id) where decision in ('declined', 'withdrawn');
create index menu_trading_decisions_line_idx on public.menu_trading_decisions (line_id, seq);

comment on table public.menu_trading_decisions is
  'Append-only decisions on trading assertions. A confirmation records stated_on and its source (form_default or chosen) as the freshness basis.';

-- Menu recheck tasks (A1-4): B03's shape, subject a line (statement_id is
-- reserved for S5 statements). Opened idempotently; closed once.
create table public.menu_trading_recheck_tasks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  line_id uuid,
  statement_id uuid,
  assertion_id uuid references public.menu_trading_assertions (id) on delete restrict,
  cause text not null check (cause in (
    'due_soon', 'expired', 'basis_missing', 'temporary_until_passed', 'material_change'
  )),
  use text not null check (use in ('internal', 'public')),
  due_at timestamptz not null,
  state text not null default 'open' check (state in ('open', 'done', 'cancelled')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint menu_trading_recheck_tasks_line_fkey foreign key (line_id, venue_id)
    references public.menu_trading_lines (id, venue_id) on delete restrict,
  constraint menu_trading_recheck_tasks_subject check (line_id is not null and statement_id is null),
  constraint menu_trading_recheck_tasks_once
    unique nulls not distinct (line_id, statement_id, cause, due_at, use),
  constraint menu_trading_recheck_tasks_closed check ((state = 'open') = (closed_at is null))
);

create index menu_trading_recheck_tasks_open
  on public.menu_trading_recheck_tasks (venue_id, due_at) where state = 'open';

comment on table public.menu_trading_recheck_tasks is
  'Menu trading recheck tasks (A1-4): one per subject, cause, due time and use. No credit effect; time never moves a photo.';

-- Idempotency: one result per request key (B03 §14.1).
create table public.menu_trading_commands (
  request_key uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  command text not null check (command in (
    'propose', 'decide', 'set_temporarily_unavailable', 'schedule_add', 'schedule_exception_add'
  )),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  venue_id uuid not null references public.venues (id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.menu_trading_commands is
  'Append-only record of each B04-b1 command and its first result, replayed for the same key, actor, command and request hash after the actor''s venue scope is re-read.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'menu_trading_assertions', 'menu_trading_decisions', 'menu_availability_schedules',
    'menu_availability_exceptions', 'menu_trading_commands'
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

-- A line's identity never changes and it is never deleted. Every write moves
-- the revision by one; a retired line is never written again.
create function private.menu_trading_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'menu_trading_line_immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.retired_at is not null then
      raise exception 'menu_trading_line_immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.retired_at is not null
     or new.revision <> old.revision + 1
     or (to_jsonb(new) - array['revision', 'updated_at', 'retired_at', 'retired_by'])
        is distinct from (to_jsonb(old) - array['revision', 'updated_at', 'retired_at', 'retired_by']) then
    raise exception 'menu_trading_line_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_trading_lines_guard
  before insert or update or delete on public.menu_trading_lines
  for each row execute function private.menu_trading_lines_guard();
create trigger menu_trading_lines_no_truncate
  before truncate on public.menu_trading_lines
  for each statement execute function private.append_only_guard();

-- An assertion is written on a live line, and a scheduled availability value
-- names a schedule of the same venue.
create function private.menu_trading_assertions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.menu_trading_lines l where l.id = new.line_id and l.retired_at is not null) then
    raise exception 'menu_trading_line_retired' using errcode = 'P0001';
  end if;
  if new.field = 'availability' and new.value ->> 'state' = 'scheduled'
     and private.menu_trading_value_problem(new.field, new.value) is null
     and not exists (
       select 1 from public.menu_availability_schedules s
       where s.id = (new.value ->> 'scheduleId')::uuid and s.venue_id = new.venue_id) then
    raise exception 'menu_schedule_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger menu_trading_assertions_guard
  before insert on public.menu_trading_assertions
  for each row execute function private.menu_trading_assertions_guard();

-- A decision is recorded against the line revision it produced; a
-- confirmation never applies to an ambiguous price.
create function private.menu_trading_decisions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.decision = 'confirmed' and exists (
    select 1 from public.menu_trading_assertions a
    where a.id = new.assertion_id and a.value ->> 'kind' = 'ambiguous') then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger menu_trading_decisions_guard
  before insert on public.menu_trading_decisions
  for each row execute function private.menu_trading_decisions_guard();

-- Never deleted; an open task is closed once (state, closed_*), nothing else.
create function private.menu_trading_recheck_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.state <> 'open' or new.state = 'open'
     or (to_jsonb(new) - array['state', 'closed_at', 'closed_by'])
        is distinct from (to_jsonb(old) - array['state', 'closed_at', 'closed_by']) then
    raise exception 'menu_trading_recheck_task_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_trading_recheck_tasks_guard
  before update or delete on public.menu_trading_recheck_tasks
  for each row execute function private.menu_trading_recheck_tasks_guard();
create trigger menu_trading_recheck_tasks_no_truncate
  before truncate on public.menu_trading_recheck_tasks
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: no direct client access; SECURITY DEFINER functions only
-- ---------------------------------------------------------------------------

revoke all on
  public.menu_trading_lines, public.menu_trading_assertions, public.menu_trading_decisions,
  public.menu_availability_schedules, public.menu_availability_exceptions,
  public.menu_trading_recheck_tasks, public.menu_trading_commands
from public, anon, authenticated, service_role;

grant select on
  public.menu_trading_lines, public.menu_trading_assertions, public.menu_trading_decisions,
  public.menu_availability_schedules, public.menu_availability_exceptions,
  public.menu_trading_recheck_tasks, public.menu_trading_commands
to service_role;

alter table public.menu_trading_lines enable row level security;
alter table public.menu_trading_assertions enable row level security;
alter table public.menu_trading_decisions enable row level security;
alter table public.menu_availability_schedules enable row level security;
alter table public.menu_availability_exceptions enable row level security;
alter table public.menu_trading_recheck_tasks enable row level security;
alter table public.menu_trading_commands enable row level security;

-- ---------------------------------------------------------------------------
-- Scope, idempotency and catalogue helpers
-- ---------------------------------------------------------------------------

-- How the caller may act on a venue's trading data, re-read on every call:
-- 'admin'; 'manager' (a manager account or a staff account holding an
-- effective legacy grant, OD-B4-17); 'staff' (writes: active staff of this
-- venue; reads: private.staff_can_label_venue, §10); or null.
create function private.menu_trading_role(p_venue_id uuid, p_write boolean)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or p_venue_id is null or not private.is_active_user() then null
    when private.is_active_admin() then 'admin'
    when private.can_manage_venue(p_venue_id) then 'manager'
    when p_write and private.active_staff_venue_id() = p_venue_id then 'staff'
    when not p_write and private.staff_can_label_venue(p_venue_id)
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff') then 'staff'
  end;
$$;

-- An item (and optionally a variant) on the venue's active menu: not
-- archived, listed by the active version (and that entry lists the variant).
create function private.menu_trading_item_active(p_item_id uuid, p_variant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.menu_items i
    join public.menu_entries e on e.item_id = i.id
      and e.version_id = private.active_menu_version_id(i.venue_id)
    where i.id = p_item_id
      and i.archived_at is null
      and (p_variant_id is null or exists (
        select 1 from public.menu_entry_variants ev
        where ev.entry_id = e.id and ev.variant_id = p_variant_id))
  );
$$;

-- The venue's local date at an instant.
create function private.menu_venue_date(p_venue_id uuid, p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_at at time zone private.venue_timezone(p_venue_id))::date;
$$;

-- Lock order step 1: the key's advisory lock, then the replay lookup. Callers
-- have already re-read the actor's scope on the target venue.
create function private.menu_trading_replay(p_key uuid, p_actor uuid, p_command text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior public.menu_trading_commands;
begin
  if p_key is null then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_menu_trading:' || p_key::text, 0));
  select c.* into v_prior from public.menu_trading_commands c where c.request_key = p_key;
  if not found then
    return null;
  end if;
  if v_prior.actor_id <> p_actor or v_prior.command <> p_command or v_prior.request_hash <> p_hash then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  return v_prior.result || jsonb_build_object('replayed', true);
end;
$$;

create function private.menu_trading_record(
  p_key uuid, p_actor uuid, p_command text, p_hash text, p_venue_id uuid, p_result jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.menu_trading_commands (request_key, actor_id, command, request_hash, venue_id, result)
  values (p_key, p_actor, p_command, p_hash, p_venue_id, p_result)
  returning result;
$$;

-- ---------------------------------------------------------------------------
-- Resolution (§5.5, A1-6; resolveField in resolve.ts)
-- ---------------------------------------------------------------------------

-- The state of one field of a line at p_at, from confirmed assertions only:
--   { status: 'available', assertionId, value, updatedBy, effectiveFrom,
--     effectiveTo, startsAt, endsAt, confirmedAt, statedOn, statedOnSource }
--   { status: 'unavailable', reason: 'disputed', detail: 'conflict', assertionIds }
--   { status: 'unavailable', reason: 'withdrawn', detail: 'value_withdrawn' }
--   { status: 'unavailable', reason: 'unknown', detail: 'not_recorded' }
-- updatedBy is 'menu_source' or 'manager', never a person (§10, D3).
create function private.menu_trading_field_state(p_line_id uuid, p_field text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive
  venue_zone as (
    select private.venue_timezone(l.venue_id) as name
    from public.menu_trading_lines l where l.id = p_line_id
  ),
  confirmed as (
    select a.id, a.supersedes, a.value, a.basis, a.effective_from, a.effective_to,
      c.decided_at as confirmed_at, c.stated_on, c.stated_on_source,
      w.decided_at as withdrawn_at,
      greatest(c.decided_at,
        coalesce(a.effective_from::timestamp at time zone z.name, c.decided_at)) as starts_at,
      coalesce((a.effective_to + 1)::timestamp at time zone z.name, 'infinity'::timestamptz) as ends_at
    from public.menu_trading_assertions a
    cross join venue_zone z
    join public.menu_trading_decisions c
      on c.assertion_id = a.id and c.decision = 'confirmed' and c.decided_at <= p_at
    left join public.menu_trading_decisions w
      on w.assertion_id = a.id and w.decision = 'withdrawn' and w.decided_at <= p_at
    where a.line_id = p_line_id and a.field = p_field
  ),
  -- In force at some moment (not withdrawn before it started) and covering p_at.
  covering as (
    select x.* from confirmed x
    where x.starts_at <= p_at and x.ends_at > p_at
      and (x.withdrawn_at is null or x.withdrawn_at > x.starts_at)
  ),
  ancestors (id) as (
    select x.supersedes from covering x where x.supersedes is not null
    union
    select a.supersedes
    from ancestors an
    join public.menu_trading_assertions a on a.id = an.id
    where a.supersedes is not null
  ),
  heads as (
    select x.* from covering x where not exists (select 1 from ancestors an where an.id = x.id)
  ),
  live as (
    select h.* from heads h where h.withdrawn_at is null
  )
  select case
    when (select count(*) from live) = 1 then (
      select jsonb_build_object(
        'status', 'available',
        'assertionId', l.id,
        'value', l.value,
        'updatedBy', case when l.basis = 'source_mapping' then 'menu_source' else 'manager' end,
        'effectiveFrom', l.effective_from,
        'effectiveTo', l.effective_to,
        'startsAt', l.starts_at,
        'endsAt', case when l.ends_at = 'infinity'::timestamptz then null else l.ends_at end,
        'confirmedAt', l.confirmed_at,
        'statedOn', l.stated_on,
        'statedOnSource', l.stated_on_source)
      from live l)
    when (select count(*) from live) > 1 then jsonb_build_object(
      'status', 'unavailable', 'reason', 'disputed', 'detail', 'conflict',
      'assertionIds', (select jsonb_agg(l.id order by l.confirmed_at, l.id) from live l))
    when exists (select 1 from heads) then jsonb_build_object(
      'status', 'unavailable', 'reason', 'withdrawn', 'detail', 'value_withdrawn')
    else jsonb_build_object('status', 'unavailable', 'reason', 'unknown', 'detail', 'not_recorded')
  end;
$$;

-- The assertion a new proposal on (line, field) supersedes: the latest
-- confirmed, unwithdrawn assertion that no confirmed assertion supersedes
-- (a successor withdrawn before it started does not count). Null when none.
-- tradingHead in resolve.ts.
create function private.menu_trading_head(p_line_id uuid, p_field text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with venue_zone as (
    select private.venue_timezone(l.venue_id) as name
    from public.menu_trading_lines l where l.id = p_line_id
  ),
  confirmed as (
    select a.id, a.supersedes, c.seq as confirmed_seq, w.decided_at as withdrawn_at,
      greatest(c.decided_at,
        coalesce(a.effective_from::timestamp at time zone z.name, c.decided_at)) as starts_at
    from public.menu_trading_assertions a
    cross join venue_zone z
    join public.menu_trading_decisions c on c.assertion_id = a.id and c.decision = 'confirmed'
    left join public.menu_trading_decisions w on w.assertion_id = a.id and w.decision = 'withdrawn'
    where a.line_id = p_line_id and a.field = p_field
  )
  select x.id
  from confirmed x
  where x.withdrawn_at is null
    and not exists (
      select 1 from confirmed s
      where s.supersedes = x.id and (s.withdrawn_at is null or s.withdrawn_at > s.starts_at))
  order by x.confirmed_seq desc
  limit 1;
$$;

-- Temporary unavailability at p_at (§5.5 step 2, A1-6), or null when none
-- applies (none recorded, back in service, or withdrawn):
--   { state: 'temporarily_unavailable', until, assertionId, updatedBy }
--   { state: 'needs_checking', reason: 'stale', detail: 'recheck_requested', until, assertionId }
--   { state: 'unknown', reason: 'disputed', detail: 'conflict', field: 'temporary_unavailability' }
create function private.menu_trading_temporary_state(p_line_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := private.menu_trading_field_state(p_line_id, 'temporary_unavailability', p_at);
  v_until timestamptz;
begin
  if v_state ->> 'status' = 'available' then
    if v_state #>> '{value,state}' <> 'temporarily_unavailable' then
      return null;
    end if;
    v_until := (v_state #>> '{value,until}')::timestamptz;
    if v_until is null or p_at < v_until then
      return jsonb_build_object('state', 'temporarily_unavailable', 'until', v_until,
        'assertionId', v_state -> 'assertionId', 'updatedBy', v_state -> 'updatedBy');
    end if;
    return jsonb_build_object('state', 'needs_checking', 'reason', 'stale', 'detail', 'recheck_requested',
      'until', v_until, 'assertionId', v_state -> 'assertionId');
  end if;
  if v_state ->> 'reason' = 'disputed' then
    return jsonb_build_object('state', 'unknown', 'reason', 'disputed', 'detail', 'conflict',
      'field', 'temporary_unavailability');
  end if;
  return null;
end;
$$;

-- A schedule at p_at (availabilityFromSchedule in availability.ts):
--   { state: 'available' | 'cancelled', occurrence: { localDate, startsAt, endsAt, state } }
--   { state: 'outside_window' }
--   { state: 'not_offered', detail: 'not_started' | 'schedule_ended' | 'service_not_offered' }
--   { state: 'unknown', reason, detail }   (linked service not available)
-- plus source: 'menu_schedule' or 'service'. The previous and current local
-- dates are expanded, so a window past midnight belongs to its start date.
-- A linked schedule reads the B03 check's status and value at p_at (a
-- deliberate stop in effect reads No, A40) and its occurrences through
-- public.knowledge_occurrences, within the menu schedule's own dates; when
-- the caller may not read the check, the state is unknown.
create function private.menu_trading_schedule_state(p_schedule_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_schedule public.menu_availability_schedules;
  v_check public.venue_amenity_checks;
  v_slot record;
  v_day date;
  v_source text;
  v_open jsonb;
  v_cancelled jsonb;
begin
  select s.* into v_schedule from public.menu_availability_schedules s where s.id = p_schedule_id;
  if not found then
    return jsonb_build_object('state', 'unknown', 'reason', 'unknown', 'detail', 'not_recorded');
  end if;
  v_day := (p_at at time zone v_schedule.timezone)::date;
  if v_schedule.knowledge_check_id is null then
    v_source := 'menu_schedule';
    select
      (array_agg(jsonb_build_object('localDate', o.local_date, 'startsAt', o.starts_at,
          'endsAt', o.ends_at, 'state', o.state) order by o.starts_at, o.ends_at)
        filter (where o.state <> 'cancelled'))[1],
      (array_agg(jsonb_build_object('localDate', o.local_date, 'startsAt', o.starts_at,
          'endsAt', o.ends_at, 'state', o.state) order by o.starts_at, o.ends_at)
        filter (where o.state = 'cancelled'))[1]
    into v_open, v_cancelled
    from private.schedule_occurrences(v_schedule.timezone, v_schedule.effective_from,
      v_schedule.effective_to, v_schedule.recurrence, v_schedule.windows,
      (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'localDate', to_char(e.local_date, 'YYYY-MM-DD'), 'kind', e.kind, 'windows', e.windows))
          order by e.seq), '[]'::jsonb)
       from public.menu_availability_exceptions e
       where e.schedule_id = v_schedule.id and e.created_at <= p_at),
      v_day - 1, v_day) o
    where o.starts_at <= p_at and o.ends_at > p_at;
  else
    v_source := 'service';
    select c.* into v_check from public.venue_amenity_checks c where c.id = v_schedule.knowledge_check_id;
    select st.status, st.reason, st.detail, st.value into v_slot
    from private.knowledge_slot_state_b03(v_check.venue_id, array[v_check.template_key], p_at) st;
    if v_slot.status is distinct from 'available' then
      return jsonb_build_object('state', 'unknown', 'reason', coalesce(v_slot.reason, 'unknown'),
        'detail', coalesce(v_slot.detail, 'not_checked'), 'source', v_source);
    end if;
    if v_slot.value = 'no' then
      return jsonb_build_object('state', 'not_offered', 'detail', 'service_not_offered', 'source', v_source);
    end if;
    if v_slot.value is distinct from 'yes' then
      return jsonb_build_object('state', 'unknown', 'reason', 'unknown', 'detail', 'not_checked',
        'source', v_source);
    end if;
    begin
      select
        (array_agg(jsonb_build_object('localDate', o.local_date, 'startsAt', o.starts_at,
            'endsAt', o.ends_at, 'state', o.state) order by o.starts_at, o.ends_at)
          filter (where o.state <> 'cancelled'))[1],
        (array_agg(jsonb_build_object('localDate', o.local_date, 'startsAt', o.starts_at,
            'endsAt', o.ends_at, 'state', o.state) order by o.starts_at, o.ends_at)
          filter (where o.state = 'cancelled'))[1]
      into v_open, v_cancelled
      from public.knowledge_occurrences(v_check.id, v_day - 1, v_day) o
      where o.starts_at <= p_at and o.ends_at > p_at
        and o.local_date >= v_schedule.effective_from
        and (v_schedule.effective_to is null or o.local_date <= v_schedule.effective_to);
    exception when others then
      return jsonb_build_object('state', 'unknown', 'reason', 'unknown', 'detail', 'service_unreadable',
        'source', v_source);
    end;
  end if;
  if v_open is not null then
    return jsonb_build_object('state', 'available', 'occurrence', v_open, 'source', v_source);
  end if;
  if v_cancelled is not null then
    return jsonb_build_object('state', 'cancelled', 'occurrence', v_cancelled, 'source', v_source);
  end if;
  if v_day < v_schedule.effective_from then
    return jsonb_build_object('state', 'not_offered', 'detail', 'not_started', 'source', v_source);
  end if;
  if v_schedule.effective_to is not null and v_day > v_schedule.effective_to then
    return jsonb_build_object('state', 'not_offered', 'detail', 'schedule_ended', 'source', v_source);
  end if;
  return jsonb_build_object('state', 'outside_window', 'source', v_source);
end;
$$;

-- Availability of a line at p_at (§5.5 step 2; resolveAvailability in
-- resolve.ts): temporary unavailability first, then the confirmed
-- availability assertion. States: available, outside_window, cancelled,
-- not_offered, temporarily_unavailable, needs_checking, unknown.
create function private.menu_trading_availability(p_line_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_temporary jsonb := private.menu_trading_temporary_state(p_line_id, p_at);
  v_state jsonb;
begin
  if v_temporary is not null then
    return v_temporary;
  end if;
  v_state := private.menu_trading_field_state(p_line_id, 'availability', p_at);
  if v_state ->> 'status' <> 'available' then
    return jsonb_build_object('state', 'unknown', 'reason', v_state -> 'reason', 'detail', v_state -> 'detail');
  end if;
  return case v_state #>> '{value,state}'
    when 'always' then jsonb_build_object('state', 'available', 'source', 'always')
    when 'not_offered' then jsonb_build_object('state', 'not_offered', 'detail', 'not_offered')
    else private.menu_trading_schedule_state((v_state #>> '{value,scheduleId}')::uuid, p_at)
      || jsonb_build_object('scheduleId', v_state #> '{value,scheduleId}')
  end || jsonb_build_object('assertionId', v_state -> 'assertionId', 'updatedBy', v_state -> 'updatedBy');
end;
$$;

-- An assertion's resolution as of p_at (§3 states): proposed, current,
-- confirmed (scheduled or ended), superseded, declined or withdrawn.
create function private.menu_trading_resolution(p_assertion_id uuid, p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.menu_trading_decisions d
                 where d.assertion_id = a.id and d.decision = 'withdrawn' and d.decided_at <= p_at)
      then 'withdrawn'
    when exists (select 1 from public.menu_trading_decisions d
                 where d.assertion_id = a.id and d.decision = 'declined' and d.decided_at <= p_at)
      then 'declined'
    when not exists (select 1 from public.menu_trading_decisions d
                     where d.assertion_id = a.id and d.decision = 'confirmed' and d.decided_at <= p_at)
      then 'proposed'
    when private.menu_trading_field_state(a.line_id, a.field, p_at) ->> 'assertionId' = a.id::text
      then 'current'
    when exists (select 1 from public.menu_trading_assertions s
                 join public.menu_trading_decisions sd
                   on sd.assertion_id = s.id and sd.decision = 'confirmed' and sd.decided_at <= p_at
                 where s.supersedes = a.id)
      then 'superseded'
    else 'confirmed'
  end
  from public.menu_trading_assertions a
  where a.id = p_assertion_id;
$$;

-- One line as read by p_role at p_at. Everyone: identity, revision, the
-- price and availability states. Admin and manager: pending proposals (with
-- notes and actor ids) and open recheck tasks; admin also the snapshot,
-- locator and raw text. Staff: only their own pending proposals, without
-- notes, source text or any actor (§10, V11).
create function private.menu_trading_line_json(p_line public.menu_trading_lines, p_role text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lineId', p_line.id,
    'revision', p_line.revision,
    'itemId', p_line.item_id,
    'variantId', p_line.variant_id,
    'portion', case when p_line.portion_label is null then null else jsonb_strip_nulls(jsonb_build_object(
      'label', p_line.portion_label, 'quantity', p_line.portion_quantity, 'unit', p_line.portion_unit)) end,
    'channel', p_line.channel,
    'retiredAt', p_line.retired_at,
    'price', private.menu_trading_field_state(p_line.id, 'price', p_at),
    'availability', private.menu_trading_availability(p_line.id, p_at))
  || case when p_role in ('admin', 'manager') then jsonb_build_object(
    'pending', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'assertionId', a.id, 'field', a.field, 'value', a.value, 'basis', a.basis,
          'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to, 'observedOn', a.observed_on,
          'statedAt', a.stated_at, 'statedBy', a.stated_by, 'reason', a.reason, 'supersedes', a.supersedes)
        || case when p_role = 'admin' then jsonb_build_object(
          'snapshotId', a.snapshot_id, 'sourceLocator', a.source_locator, 'rawText', a.raw_text)
          else '{}'::jsonb end
        order by a.seq)
      from public.menu_trading_assertions a
      where a.line_id = p_line.id
        and not exists (select 1 from public.menu_trading_decisions d where d.assertion_id = a.id)), '[]'::jsonb),
    'rechecks', coalesce((
      select jsonb_agg(jsonb_build_object('taskId', t.id, 'cause', t.cause, 'use', t.use, 'dueAt', t.due_at,
          'createdAt', t.created_at) order by t.due_at, t.id)
      from public.menu_trading_recheck_tasks t
      where t.line_id = p_line.id and t.state = 'open'), '[]'::jsonb))
  else jsonb_build_object(
    'myPending', coalesce((
      select jsonb_agg(jsonb_build_object('assertionId', a.id, 'field', a.field, 'value', a.value,
          'statedAt', a.stated_at) order by a.seq)
      from public.menu_trading_assertions a
      where a.line_id = p_line.id and a.stated_by = auth.uid()
        and not exists (select 1 from public.menu_trading_decisions d where d.assertion_id = a.id)), '[]'::jsonb))
  end;
$$;

-- ---------------------------------------------------------------------------
-- Recheck closing (A1-4)
-- ---------------------------------------------------------------------------

-- Closes a line's open temporary_until_passed tasks once the resolver no
-- longer reads that passed `until` (back in service, a new `until`, or a
-- withdrawal). A pending or declined proposal changes nothing, so the task
-- stays open. Returns the number closed.
create function private.menu_close_rechecks(p_line_id uuid, p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task public.menu_trading_recheck_tasks;
  v_state jsonb;
  v_closed integer := 0;
begin
  if not exists (select 1 from public.menu_trading_recheck_tasks t where t.line_id = p_line_id and t.state = 'open') then
    return 0;
  end if;
  v_state := private.menu_trading_temporary_state(p_line_id, p_now);
  for v_task in
    select t.* from public.menu_trading_recheck_tasks t
    where t.line_id = p_line_id and t.state = 'open' and t.cause = 'temporary_until_passed'
    order by t.created_at, t.id
    for update
  loop
    if not coalesce(v_state ->> 'state' = 'needs_checking'
                    and (v_state ->> 'until')::timestamptz = v_task.due_at, false) then
      update public.menu_trading_recheck_tasks t
      set state = 'done', closed_at = now(),
          closed_by = (select p.id from public.profiles p where p.id = auth.uid())
      where t.id = v_task.id;
      v_closed := v_closed + 1;
    end if;
  end loop;
  return v_closed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Commands (§5.6)
-- ---------------------------------------------------------------------------

-- Propose a value for a line (§5.6, B04-02b/d). The line is p_line, or the
-- identity (p_item, p_variant, p_portion { label, quantity?, unit? },
-- p_channel), created on first use (staff: only the plain line, no portion,
-- channel all). p_value per field:
--   price: { amount: "10.50" | 10.5 | "£10.50", currency?: 'GBP' }
--   availability: { state: 'always' | 'not_offered' } or { state: 'scheduled', scheduleId }
--   temporary_unavailability: { state: 'temporarily_unavailable', until?: instant | null }
--     or { state: 'back_in_service' }
-- p_source (admin only, price only, p_value null): { snapshotId, locator,
-- rawText }: the price comes from rawText through the parser; an ambiguous
-- text is kept as an ambiguous proposal. Staff: price and temporary
-- unavailability reports only. The proposal supersedes the field's head.
-- Returns { assertionId, lineId, lineRevision, field, state: 'proposed',
-- value, current } where current is the field's confirmed state now (L4).
create function public.menu_trading_propose(
  p_line uuid,
  p_item uuid,
  p_variant uuid,
  p_portion jsonb,
  p_channel text,
  p_field text,
  p_value jsonb,
  p_effective_from date,
  p_effective_to date,
  p_observed_on date,
  p_reason text,
  p_source jsonb,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_line public.menu_trading_lines;
  v_item public.menu_items;
  v_venue uuid;
  v_item_id uuid;
  v_variant uuid;
  v_role text;
  v_channel text := coalesce(p_channel, 'all');
  v_label text;
  v_quantity numeric;
  v_unit text;
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_parse jsonb;
  v_value jsonb;
  v_basis text;
  v_snapshot public.menu_source_snapshots;
  v_locator text;
  v_raw text;
  v_today date;
  v_until timestamptz;
  v_head uuid;
  v_id uuid;
  v_revision integer;
  v_result jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_line is not null then
    if p_item is not null or p_variant is not null or p_portion is not null or p_channel is not null then
      raise exception 'invalid_trading_line' using errcode = '22023';
    end if;
    select l.* into v_line from public.menu_trading_lines l where l.id = p_line;
    if not found then
      raise exception 'menu_trading_line_not_found' using errcode = 'P0002';
    end if;
    v_venue := v_line.venue_id;
    v_item_id := v_line.item_id;
    v_variant := v_line.variant_id;
  else
    if p_item is null then
      raise exception 'invalid_trading_line' using errcode = '22023';
    end if;
    select i.* into v_item from public.menu_items i where i.id = p_item;
    if not found then
      raise exception 'menu_item_not_found' using errcode = 'P0002';
    end if;
    v_venue := v_item.venue_id;
    v_item_id := v_item.id;
    v_variant := p_variant;
    if p_variant is not null
       and not exists (select 1 from public.menu_variants mv where mv.id = p_variant and mv.item_id = p_item) then
      raise exception 'menu_variant_not_found' using errcode = 'P0002';
    end if;
  end if;
  -- Scope is re-read before any replay.
  v_role := private.menu_trading_role(v_venue, true);
  if v_role is null then
    raise exception 'not_venue_member' using errcode = '42501';
  end if;
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'line', p_line, 'item', p_item, 'variant', p_variant, 'portion', p_portion, 'channel', p_channel,
    'field', p_field, 'value', p_value, 'effectiveFrom', p_effective_from, 'effectiveTo', p_effective_to,
    'observedOn', p_observed_on, 'reason', v_reason, 'source', p_source));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'propose', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  if p_field is null or p_field not in ('price', 'availability', 'temporary_unavailability') then
    raise exception 'invalid_trading_field' using errcode = '22023';
  end if;
  if v_role = 'staff' and p_field not in ('price', 'temporary_unavailability') then
    raise exception 'staff_field_not_allowed' using errcode = '42501';
  end if;
  if p_source is not null and v_role <> 'admin' then
    raise exception 'source_mapping_admin_only' using errcode = '42501';
  end if;
  if not private.menu_trading_item_active(v_item_id, null) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  if v_variant is not null and not private.menu_trading_item_active(v_item_id, v_variant) then
    raise exception 'menu_variant_not_on_active_menu' using errcode = 'P0001';
  end if;

  -- The line identity (a new line only).
  if p_line is null then
    if v_channel not in ('all', 'dine_in', 'takeaway') then
      raise exception 'invalid_trading_channel' using errcode = '22023';
    end if;
    if p_portion is not null then
      if jsonb_typeof(p_portion) <> 'object'
         or not (private.menu_json_keys(p_portion) <@ array['label', 'quantity', 'unit'])
         or jsonb_typeof(p_portion -> 'label') is distinct from 'string'
         or length(btrim(p_portion ->> 'label')) not between 1 and 40
         or (p_portion ? 'quantity' and jsonb_typeof(p_portion -> 'quantity') <> 'null'
             and (jsonb_typeof(p_portion -> 'quantity') <> 'number'
                  or (p_portion ->> 'quantity') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$'
                  or (p_portion ->> 'quantity')::numeric <= 0))
         or (p_portion ? 'unit' and jsonb_typeof(p_portion -> 'unit') <> 'null'
             and (jsonb_typeof(p_portion -> 'unit') <> 'string'
                  or (p_portion ->> 'unit') not in ('ml', 'cl', 'l', 'pint', 'g', 'kg', 'oz', 'piece'))) then
        raise exception 'invalid_portion' using errcode = '22023';
      end if;
      v_label := btrim(p_portion ->> 'label');
      v_quantity := (p_portion ->> 'quantity')::numeric;
      v_unit := p_portion ->> 'unit';
      if (v_quantity is null) <> (v_unit is null) then
        raise exception 'invalid_portion' using errcode = '22023';
      end if;
    end if;
  end if;

  -- The value.
  if p_source is not null then
    if p_field <> 'price' or p_value is not null or jsonb_typeof(p_source) <> 'object'
       or private.menu_json_keys(p_source) <> array['locator', 'rawText', 'snapshotId']
       or jsonb_typeof(p_source -> 'snapshotId') <> 'string'
       or (p_source ->> 'snapshotId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(p_source -> 'locator') <> 'string'
       or length(p_source ->> 'locator') not between 1 and 1152
       or jsonb_typeof(p_source -> 'rawText') <> 'string'
       or length(p_source ->> 'rawText') not between 1 and 80 then
      raise exception 'invalid_trading_source' using errcode = '22023';
    end if;
    select s.* into v_snapshot from public.menu_source_snapshots s
    where s.id = (p_source ->> 'snapshotId')::uuid and s.venue_id = v_venue;
    if not found then
      raise exception 'menu_source_snapshot_not_found' using errcode = 'P0002';
    end if;
    v_locator := p_source ->> 'locator';
    v_raw := p_source ->> 'rawText';
    if not exists (
      select 1 from jsonb_array_elements(v_snapshot.document) as x(e)
      where x.e ->> 'locator' = v_locator
         or exists (select 1 from private.menu_crosswalk_variants(x.e) v where v.locator = v_locator)) then
      raise exception 'menu_source_locator_not_found' using errcode = '22023';
    end if;
    v_parse := private.menu_parse_price(to_jsonb(v_raw), 'GBP');
    if (v_parse ->> 'ok')::boolean then
      v_value := jsonb_build_object('kind', 'fixed', 'amountMinor', (v_parse ->> 'amountMinor')::bigint,
        'currency', v_parse ->> 'currency');
    elsif v_parse ->> 'error' = 'ambiguous_price' then
      v_value := jsonb_build_object('kind', 'ambiguous', 'form', v_parse ->> 'form');
    else
      raise exception 'invalid_price' using errcode = '22023';
    end if;
    v_basis := 'source_mapping';
  else
    if p_value is null or jsonb_typeof(p_value) <> 'object' then
      raise exception 'invalid_trading_value' using errcode = '22023';
    end if;
    if p_field = 'price' then
      if not (private.menu_json_keys(p_value) <@ array['amount', 'currency'])
         or not (p_value ? 'amount')
         or (p_value ? 'currency' and jsonb_typeof(p_value -> 'currency') <> 'string') then
        raise exception 'invalid_price' using errcode = '22023';
      end if;
      v_parse := private.menu_parse_price(p_value -> 'amount', coalesce(p_value ->> 'currency', 'GBP'));
      if not (v_parse ->> 'ok')::boolean then
        raise exception 'invalid_price' using errcode = '22023',
          detail = jsonb_strip_nulls(jsonb_build_object('form', v_parse -> 'form'))::text;
      end if;
      v_value := jsonb_build_object('kind', 'fixed', 'amountMinor', (v_parse ->> 'amountMinor')::bigint,
        'currency', v_parse ->> 'currency');
    elsif p_field = 'availability' then
      v_value := p_value;
      if p_value ->> 'state' = 'scheduled' and private.menu_trading_value_problem(p_field, p_value) is null
         and not exists (select 1 from public.menu_availability_schedules s
                         where s.id = (p_value ->> 'scheduleId')::uuid and s.venue_id = v_venue) then
        raise exception 'menu_schedule_not_found' using errcode = 'P0002';
      end if;
    else
      if p_value ->> 'state' = 'temporarily_unavailable' then
        if not (private.menu_json_keys(p_value) <@ array['state', 'until']) then
          raise exception 'invalid_trading_value' using errcode = '22023';
        end if;
        if jsonb_typeof(p_value -> 'until') = 'string' then
          begin
            v_until := (p_value ->> 'until')::timestamptz;
          exception when others then
            raise exception 'invalid_until' using errcode = '22023';
          end;
          if v_until <= now() then
            raise exception 'invalid_until' using errcode = '22023';
          end if;
        elsif p_value ? 'until' and jsonb_typeof(p_value -> 'until') <> 'null' then
          raise exception 'invalid_until' using errcode = '22023';
        end if;
        v_value := jsonb_build_object('state', 'temporarily_unavailable', 'until', private.menu_until_text(v_until));
      else
        v_value := p_value;
      end if;
    end if;
    v_basis := case when v_role = 'staff' then 'staff_report' else 'manager_statement' end;
  end if;
  if private.menu_trading_value_problem(p_field, v_value) is not null then
    raise exception 'invalid_trading_value' using errcode = '22023';
  end if;

  -- Dates (§5.2 #6, A1-2): local dates; no retroactive start.
  v_today := private.menu_venue_date(v_venue, now());
  if p_field = 'temporary_unavailability' then
    if p_effective_from is not null or p_effective_to is not null then
      raise exception 'invalid_effective_dates' using errcode = '22023';
    end if;
  elsif (p_effective_from is not null and p_effective_from < v_today)
     or (p_effective_to is not null and p_effective_to < coalesce(p_effective_from, v_today)) then
    raise exception 'invalid_effective_dates' using errcode = '22023';
  end if;
  if p_observed_on is not null and p_observed_on not between v_today - 30 and v_today then
    raise exception 'invalid_observed_on' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_trading_reason' using errcode = '22023';
  end if;

  -- Locks: venue menu (shared), then the line row.
  perform private.lock_venue_menu(v_venue, true);
  if p_line is not null then
    select l.* into v_line from public.menu_trading_lines l where l.id = p_line for update;
  else
    select l.* into v_line from public.menu_trading_lines l
    where l.item_id = v_item_id and l.variant_id is not distinct from v_variant
      and l.portion_label is not distinct from v_label and l.channel = v_channel
      and l.modifier_option_id is null
    for update;
    if not found then
      if v_role = 'staff' and (v_label is not null or v_channel <> 'all') then
        raise exception 'menu_trading_line_not_found' using errcode = 'P0002';
      end if;
      insert into public.menu_trading_lines (
        venue_id, item_id, variant_id, portion_label, portion_quantity, portion_unit, channel, created_by
      )
      values (v_venue, v_item_id, v_variant, v_label, v_quantity, v_unit, v_channel, v_uid)
      on conflict on constraint menu_trading_lines_identity_key do nothing;
      select l.* into v_line from public.menu_trading_lines l
      where l.item_id = v_item_id and l.variant_id is not distinct from v_variant
        and l.portion_label is not distinct from v_label and l.channel = v_channel
        and l.modifier_option_id is null
      for update;
    end if;
    -- A measure, when given, must be the line's; a label alone names the line.
    if v_quantity is not null
       and (v_line.portion_quantity is distinct from v_quantity or v_line.portion_unit is distinct from v_unit) then
      raise exception 'invalid_portion' using errcode = '22023';
    end if;
  end if;
  if v_line.retired_at is not null then
    raise exception 'menu_trading_line_retired' using errcode = 'P0001';
  end if;

  v_head := private.menu_trading_head(v_line.id, p_field);
  insert into public.menu_trading_assertions (
    line_id, venue_id, field, value, effective_from, effective_to, basis, snapshot_id, source_locator,
    raw_text, stated_by, observed_on, reason, supersedes, command_key
  )
  values (
    v_line.id, v_venue, p_field, v_value, p_effective_from, p_effective_to, v_basis, v_snapshot.id,
    v_locator, v_raw, v_uid, p_observed_on, v_reason, v_head, p_request_key
  )
  returning id into v_id;
  update public.menu_trading_lines l
  set revision = l.revision + 1, updated_at = now()
  where l.id = v_line.id
  returning l.revision into v_revision;

  v_result := jsonb_build_object(
    'assertionId', v_id, 'lineId', v_line.id, 'lineRevision', v_revision, 'field', p_field,
    'state', 'proposed', 'value', v_value,
    'current', private.menu_trading_field_state(v_line.id, p_field, now()),
    'replayed', false);
  return private.menu_trading_record(p_request_key, v_uid, 'propose', v_hash, v_venue, v_result);
end;
$$;

-- Confirm, decline or withdraw one assertion (§5.6, B04-02d, §5.4). Admin or
-- the venue's manager (legacy grant holders as manager). p_expected is the
-- line revision the decider saw; a competing write gets
-- menu_trading_conflict (40001). Confirm: a proposed assertion, not an
-- ambiguous price, still superseding the field's head
-- (menu_trading_proposal_outdated otherwise); p_stated_on null records the
-- venue's today as form_default, a date up to 30 days earlier is chosen
-- (A1-2, L2). Decline: a proposed assertion. Withdraw: a confirmed one.
create function public.menu_trading_decide(
  p_assertion uuid,
  p_expected_line_revision integer,
  p_decision text,
  p_reason text,
  p_stated_on date,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assertion public.menu_trading_assertions;
  v_line public.menu_trading_lines;
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_today date;
  v_stated_on date;
  v_source text;
  v_id uuid;
  v_revision integer;
  v_result jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select a.* into v_assertion from public.menu_trading_assertions a where a.id = p_assertion;
  if not found then
    raise exception 'menu_trading_assertion_not_found' using errcode = 'P0002';
  end if;
  if coalesce(private.menu_trading_role(v_assertion.venue_id, true), 'none') not in ('admin', 'manager') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'assertion', p_assertion, 'expected', p_expected_line_revision, 'decision', p_decision,
    'reason', v_reason, 'statedOn', p_stated_on));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'decide', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_decision is null or p_decision not in ('confirmed', 'declined', 'withdrawn') then
    raise exception 'invalid_trading_decision' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_trading_reason' using errcode = '22023';
  end if;
  if p_decision <> 'confirmed' and p_stated_on is not null then
    raise exception 'invalid_stated_on' using errcode = '22023';
  end if;

  perform private.lock_venue_menu(v_assertion.venue_id, true);
  select l.* into v_line from public.menu_trading_lines l where l.id = v_assertion.line_id for update;
  if p_expected_line_revision is null or v_line.revision <> p_expected_line_revision then
    raise exception 'menu_trading_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_line.revision)::text;
  end if;
  if v_line.retired_at is not null then
    raise exception 'menu_trading_line_retired' using errcode = 'P0001';
  end if;

  v_today := private.menu_venue_date(v_assertion.venue_id, now());
  if p_decision in ('confirmed', 'declined') then
    if exists (select 1 from public.menu_trading_decisions d where d.assertion_id = v_assertion.id) then
      raise exception 'menu_trading_not_proposed' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.menu_trading_decisions d
                    where d.assertion_id = v_assertion.id and d.decision = 'confirmed')
     or exists (select 1 from public.menu_trading_decisions d
                where d.assertion_id = v_assertion.id and d.decision = 'withdrawn') then
    raise exception 'menu_trading_not_confirmed' using errcode = 'P0001';
  end if;
  if p_decision = 'confirmed' then
    if v_assertion.value ->> 'kind' = 'ambiguous' then
      raise exception 'invalid_price' using errcode = '22023',
        detail = jsonb_build_object('form', v_assertion.value -> 'form')::text;
    end if;
    if v_assertion.effective_to is not null and v_assertion.effective_to < v_today then
      raise exception 'invalid_effective_dates' using errcode = '22023';
    end if;
    if v_assertion.supersedes is distinct from private.menu_trading_head(v_line.id, v_assertion.field) then
      raise exception 'menu_trading_proposal_outdated' using errcode = 'P0001';
    end if;
    if p_stated_on is null then
      v_stated_on := v_today;
      v_source := 'form_default';
    elsif p_stated_on between v_today - 30 and v_today then
      v_stated_on := p_stated_on;
      v_source := 'chosen';
    else
      raise exception 'invalid_stated_on' using errcode = '22023';
    end if;
  end if;

  update public.menu_trading_lines l
  set revision = l.revision + 1, updated_at = now()
  where l.id = v_line.id
  returning l.revision into v_revision;
  insert into public.menu_trading_decisions (
    assertion_id, line_id, venue_id, field, decision, decided_by, self_confirmed, reason, stated_on,
    stated_on_source, line_revision, command_key
  )
  values (
    v_assertion.id, v_line.id, v_line.venue_id, v_assertion.field, p_decision, v_uid,
    p_decision = 'confirmed' and v_assertion.stated_by = v_uid, v_reason, v_stated_on, v_source,
    v_revision, p_request_key
  )
  returning id into v_id;
  perform private.menu_close_rechecks(v_line.id, now());

  v_result := jsonb_build_object(
    'decisionId', v_id, 'assertionId', v_assertion.id, 'lineId', v_line.id, 'lineRevision', v_revision,
    'decision', p_decision, 'statedOn', v_stated_on, 'statedOnSource', v_source,
    'current', private.menu_trading_field_state(v_line.id, v_assertion.field, now()),
    'replayed', false);
  return private.menu_trading_record(p_request_key, v_uid, 'decide', v_hash, v_line.venue_id, v_result);
end;
$$;

-- A manager's own statement, current at once (§5.4, §5.6): every live line
-- of the item (or of p_variant) becomes temporarily unavailable until p_until
-- (null: until further notice; else a future instant). With no line yet, the
-- plain line (p_variant, no portion, channel all) is created. One assertion
-- and one confirmation per line, stated today (form_default), lines locked
-- by id after the venue menu lock.
create function public.menu_set_temporarily_unavailable(
  p_item uuid,
  p_variant uuid,
  p_until timestamptz,
  p_reason text,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.menu_items;
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_value jsonb;
  v_today date;
  v_line public.menu_trading_lines;
  v_assertion uuid;
  v_decision uuid;
  v_revision integer;
  v_lines jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(v_item.venue_id, true);
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'item', p_item, 'variant', p_variant, 'until', p_until, 'reason', v_reason));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'set_temporarily_unavailable', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_variant is not null
     and not exists (select 1 from public.menu_variants mv where mv.id = p_variant and mv.item_id = p_item) then
    raise exception 'menu_variant_not_found' using errcode = 'P0002';
  end if;
  if not private.menu_trading_item_active(p_item, null) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  if p_variant is not null and not private.menu_trading_item_active(p_item, p_variant) then
    raise exception 'menu_variant_not_on_active_menu' using errcode = 'P0001';
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'invalid_until' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_trading_reason' using errcode = '22023';
  end if;
  v_value := jsonb_build_object('state', 'temporarily_unavailable', 'until', private.menu_until_text(p_until));
  v_today := private.menu_venue_date(v_item.venue_id, now());

  perform private.lock_venue_menu(v_item.venue_id, true);
  if not exists (
    select 1 from public.menu_trading_lines l
    where l.item_id = p_item and l.retired_at is null
      and (p_variant is null or l.variant_id = p_variant)) then
    insert into public.menu_trading_lines (venue_id, item_id, variant_id, channel, created_by)
    values (v_item.venue_id, p_item, p_variant, 'all', v_uid)
    on conflict on constraint menu_trading_lines_identity_key do nothing;
  end if;
  for v_line in
    select l.* from public.menu_trading_lines l
    where l.item_id = p_item and l.retired_at is null
      and (p_variant is null or l.variant_id = p_variant)
    order by l.id
    for update
  loop
    insert into public.menu_trading_assertions (
      line_id, venue_id, field, value, basis, stated_by, reason, supersedes, command_key
    )
    values (
      v_line.id, v_line.venue_id, 'temporary_unavailability', v_value, 'manager_statement', v_uid,
      v_reason, private.menu_trading_head(v_line.id, 'temporary_unavailability'), p_request_key
    )
    returning id into v_assertion;
    update public.menu_trading_lines l
    set revision = l.revision + 1, updated_at = now()
    where l.id = v_line.id
    returning l.revision into v_revision;
    insert into public.menu_trading_decisions (
      assertion_id, line_id, venue_id, field, decision, decided_by, self_confirmed, reason, stated_on,
      stated_on_source, line_revision, command_key
    )
    values (
      v_assertion, v_line.id, v_line.venue_id, 'temporary_unavailability', 'confirmed', v_uid, true,
      v_reason, v_today, 'form_default', v_revision, p_request_key
    )
    returning id into v_decision;
    perform private.menu_close_rechecks(v_line.id, now());
    v_lines := v_lines || jsonb_build_object('lineId', v_line.id, 'lineRevision', v_revision,
      'assertionId', v_assertion, 'decisionId', v_decision);
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'menu_trading_line_retired' using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object('itemId', p_item, 'variantId', p_variant, 'until', p_until,
    'lines', v_lines, 'replayed', false);
  return private.menu_trading_record(p_request_key, v_uid, 'set_temporarily_unavailable', v_hash,
    v_item.venue_id, v_result);
end;
$$;

-- Add an availability schedule (B04-02c), admin or the venue's manager.
-- Own schedule: p_schedule is B03's { effectiveFrom, effectiveTo?,
-- recurrence, windows } (B03 validation and field paths). Linked:
-- p_knowledge_check_id names an active check of the same venue and
-- p_schedule is { effectiveFrom, effectiveTo? }, the dates the menu follows
-- that service. p_timezone defaults to the venue's (Europe/London, OD-16).
create function public.menu_availability_schedule_add(
  p_venue uuid,
  p_schedule jsonb,
  p_timezone text,
  p_knowledge_check_id uuid,
  p_supersedes uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_timezone text;
  v_hash text;
  v_prior jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_key text;
  v_from date;
  v_to date;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(p_venue, true);
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  v_timezone := coalesce(nullif(btrim(p_timezone), ''), private.venue_timezone(p_venue));
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'venue', p_venue, 'schedule', p_schedule, 'timezone', v_timezone, 'check', p_knowledge_check_id,
    'supersedes', p_supersedes));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'schedule_add', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_knowledge_check_id is null then
    v_fields := private.schedule_problems('schedule', p_schedule);
  elsif jsonb_typeof(p_schedule) is distinct from 'object' then
    v_fields := jsonb_build_array(jsonb_build_object('path', 'schedule', 'problem', 'invalid'));
  else
    for v_key in select k from jsonb_object_keys(p_schedule) k order by k collate "C" loop
      if v_key not in ('effectiveFrom', 'effectiveTo') then
        v_fields := v_fields || jsonb_build_object('path', 'schedule.' || v_key, 'problem', 'not_allowed');
      end if;
    end loop;
    if not (p_schedule ? 'effectiveFrom') then
      v_fields := v_fields || jsonb_build_object('path', 'schedule.effectiveFrom', 'problem', 'required');
    else
      v_from := case when jsonb_typeof(p_schedule -> 'effectiveFrom') = 'string'
        then private.knowledge_safe_date(p_schedule ->> 'effectiveFrom') end;
      if v_from is null then
        v_fields := v_fields || jsonb_build_object('path', 'schedule.effectiveFrom', 'problem', 'invalid');
      end if;
    end if;
    if p_schedule ? 'effectiveTo' then
      v_to := case when jsonb_typeof(p_schedule -> 'effectiveTo') = 'string'
        then private.knowledge_safe_date(p_schedule ->> 'effectiveTo') end;
      if v_to is null then
        v_fields := v_fields || jsonb_build_object('path', 'schedule.effectiveTo', 'problem', 'invalid');
      elsif v_from is not null and v_to < v_from then
        v_fields := v_fields || jsonb_build_object('path', 'schedule.effectiveTo', 'problem', 'out_of_range');
      end if;
    end if;
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  if p_knowledge_check_id is not null and not exists (
    select 1 from public.venue_amenity_checks c
    where c.id = p_knowledge_check_id and c.venue_id = p_venue and c.status = 'active') then
    raise exception 'knowledge_check_not_found' using errcode = 'P0002';
  end if;
  if p_supersedes is not null and not exists (
    select 1 from public.menu_availability_schedules s where s.id = p_supersedes and s.venue_id = p_venue) then
    raise exception 'menu_schedule_not_found' using errcode = 'P0002';
  end if;

  perform private.lock_venue_menu(p_venue, true);
  insert into public.menu_availability_schedules (
    venue_id, timezone, recurrence, windows, knowledge_check_id, effective_from, effective_to,
    supersedes, created_by, command_key
  )
  values (
    p_venue, v_timezone,
    case when p_knowledge_check_id is null then p_schedule -> 'recurrence' end,
    case when p_knowledge_check_id is null then p_schedule -> 'windows' end,
    p_knowledge_check_id, (p_schedule ->> 'effectiveFrom')::date, (p_schedule ->> 'effectiveTo')::date,
    p_supersedes, v_uid, p_request_key
  )
  returning id into v_id;
  v_result := jsonb_build_object('scheduleId', v_id, 'replayed', false);
  return private.menu_trading_record(p_request_key, v_uid, 'schedule_add', v_hash, p_venue, v_result);
end;
$$;

-- A dated exception on an own schedule (B04-02c): cancelled, changed_window
-- or extra, one per local date, within the schedule's dates. A linked
-- schedule's exceptions belong to its B03 service (menu_schedule_linked).
create function public.menu_availability_exception_add(
  p_schedule uuid,
  p_local_date date,
  p_kind text,
  p_windows jsonb,
  p_note text,
  p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_schedule public.menu_availability_schedules;
  v_role text;
  v_note text := nullif(btrim(p_note), '');
  v_hash text;
  v_prior jsonb;
  v_fields jsonb;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select s.* into v_schedule from public.menu_availability_schedules s where s.id = p_schedule;
  if not found then
    raise exception 'menu_schedule_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(v_schedule.venue_id, true);
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  v_hash := private.menu_source_request_hash(jsonb_build_object(
    'schedule', p_schedule, 'localDate', p_local_date, 'kind', p_kind, 'windows', p_windows, 'note', v_note));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'schedule_exception_add', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if v_schedule.knowledge_check_id is not null then
    raise exception 'menu_schedule_linked' using errcode = 'P0001';
  end if;
  v_fields := private.schedule_exception_problems('exceptions', jsonb_build_array(jsonb_strip_nulls(
    jsonb_build_object('localDate', to_char(p_local_date, 'YYYY-MM-DD'), 'kind', p_kind, 'windows', p_windows))));
  if jsonb_array_length(v_fields) = 0 and (p_local_date < v_schedule.effective_from
     or (v_schedule.effective_to is not null and p_local_date > v_schedule.effective_to)) then
    v_fields := jsonb_build_array(jsonb_build_object('path', 'exceptions[0].localDate', 'problem', 'out_of_range'));
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  perform private.lock_venue_menu(v_schedule.venue_id, true);
  begin
    insert into public.menu_availability_exceptions (
      schedule_id, venue_id, local_date, kind, windows, note, created_by, command_key
    )
    values (
      v_schedule.id, v_schedule.venue_id, p_local_date, p_kind,
      case when p_kind = 'cancelled' then null else p_windows end, v_note, v_uid, p_request_key
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'menu_schedule_exception_exists' using errcode = 'P0001';
  end;
  v_result := jsonb_build_object('exceptionId', v_id, 'replayed', false);
  return private.menu_trading_record(p_request_key, v_uid, 'schedule_exception_add', v_hash,
    v_schedule.venue_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (§5.6): one STABLE statement each (T9b)
-- ---------------------------------------------------------------------------

-- An item's trading lines as read now: admin; the venue's manager; staff of
-- the venue (private.staff_can_label_venue) for an item on the active menu,
-- live lines only. Anyone else, and an unknown item, get menu_item_not_found
-- (no existence oracle).
create function public.menu_trading_lines_for_item(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items;
  v_role text;
  v_at timestamptz := now();
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select i.* into v_item from public.menu_items i where i.id = p_item;
  v_role := case when found then private.menu_trading_role(v_item.venue_id, false) end;
  if v_role is null or (v_role = 'staff' and not private.menu_trading_item_active(v_item.id, null)) then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'itemId', v_item.id,
    'venueId', v_item.venue_id,
    'view', v_role,
    'at', v_at,
    'lines', coalesce((
      select jsonb_agg(private.menu_trading_line_json(l, v_role, v_at)
        order by l.variant_id nulls first, l.portion_label nulls first, l.channel, l.id)
      from public.menu_trading_lines l
      where l.item_id = v_item.id
        and (v_role <> 'staff' or (l.retired_at is null
          and (l.variant_id is null or private.menu_trading_item_active(v_item.id, l.variant_id))))
    ), '[]'::jsonb));
end;
$$;

-- A line's history (§5.2 #7): admin and the venue's manager. The price,
-- availability and temporary unavailability in force at p_at (default now;
-- a later instant projects today's records, so a future-dated value can be
-- read at its local start), and every assertion stated by p_at with its
-- decisions made by p_at and its resolution then. Managers see notes and
-- actor ids; only admins see snapshots, locators and raw source text.
create function public.menu_trading_history(p_line uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line public.menu_trading_lines;
  v_role text;
  v_at timestamptz := coalesce(p_at, now());
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select l.* into v_line from public.menu_trading_lines l where l.id = p_line;
  if not found then
    raise exception 'menu_trading_line_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(v_line.venue_id, false);
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lineId', v_line.id,
    'itemId', v_line.item_id,
    'variantId', v_line.variant_id,
    'portion', case when v_line.portion_label is null then null else jsonb_strip_nulls(jsonb_build_object(
      'label', v_line.portion_label, 'quantity', v_line.portion_quantity, 'unit', v_line.portion_unit)) end,
    'channel', v_line.channel,
    'view', v_role,
    'at', v_at,
    'price', private.menu_trading_field_state(v_line.id, 'price', v_at),
    'availability', private.menu_trading_availability(v_line.id, v_at),
    'temporaryUnavailability', private.menu_trading_field_state(v_line.id, 'temporary_unavailability', v_at),
    'assertions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'assertionId', a.id, 'field', a.field, 'value', a.value, 'basis', a.basis,
          'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to, 'observedOn', a.observed_on,
          'statedAt', a.stated_at, 'statedBy', a.stated_by, 'reason', a.reason, 'supersedes', a.supersedes,
          'resolution', private.menu_trading_resolution(a.id, v_at),
          'decisions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'decisionId', d.id, 'decision', d.decision, 'decidedAt', d.decided_at,
                'decidedBy', d.decided_by, 'reason', d.reason, 'statedOn', d.stated_on,
                'statedOnSource', d.stated_on_source, 'selfConfirmed', d.self_confirmed,
                'ruleVersion', d.rule_version) order by d.seq)
            from public.menu_trading_decisions d
            where d.assertion_id = a.id and d.decided_at <= v_at), '[]'::jsonb))
        || case when v_role = 'admin' then jsonb_build_object(
          'snapshotId', a.snapshot_id, 'sourceLocator', a.source_locator, 'rawText', a.raw_text)
          else '{}'::jsonb end
        order by a.seq)
      from public.menu_trading_assertions a
      where a.line_id = v_line.id and a.stated_at <= v_at), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechecks (A1-4, A1-5)
-- ---------------------------------------------------------------------------

-- The job (A1-4): runs from the same hourly scheduler as
-- private.knowledge_open_rechecks (route and schedule: WS1/WS6). b1 opens
-- temporary_until_passed for each live line whose temporary unavailability
-- reads needs_checking at p_now, due at its `until`, once per subject, cause,
-- due time and use; then closes what the resolver no longer reads so. A
-- linked B03 service and a schedule's end open nothing here. Read-time status
-- never waits for this job. Returns the number opened.
create function private.menu_open_rechecks(p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_state jsonb;
  v_count integer;
  v_opened integer := 0;
begin
  for v_line in
    select l.id, l.venue_id
    from public.menu_trading_lines l
    join public.menu_items i on i.id = l.item_id
    where l.retired_at is null and i.archived_at is null
      and exists (select 1 from public.menu_trading_assertions a
                  where a.line_id = l.id and a.field = 'temporary_unavailability')
    order by l.id
  loop
    v_state := private.menu_trading_temporary_state(v_line.id, p_now);
    if v_state ->> 'state' = 'needs_checking' then
      insert into public.menu_trading_recheck_tasks (venue_id, line_id, assertion_id, cause, use, due_at)
      values (v_line.venue_id, v_line.id, (v_state ->> 'assertionId')::uuid, 'temporary_until_passed',
        'internal', (v_state ->> 'until')::timestamptz)
      on conflict on constraint menu_trading_recheck_tasks_once do nothing;
      get diagnostics v_count = row_count;
      v_opened := v_opened + v_count;
    end if;
  end loop;
  for v_line in
    select distinct t.line_id as id from public.menu_trading_recheck_tasks t where t.state = 'open' order by 1
  loop
    perform private.menu_close_rechecks(v_line.id, p_now);
  end loop;
  return v_opened;
end;
$$;

-- A1-5, for WS1's manager_triage_summary `rechecks` union: the venue's open
-- menu tasks on live subjects, with the knowledge queue's rule (open, on an
-- active subject; no due-time filter). No caller check: the triage function
-- has already decided the queue is available. STABLE, one snapshot.
create function private.menu_open_recheck_rows(p_venue_id uuid)
returns table (task_id uuid, due_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.due_at, t.created_at
  from public.menu_trading_recheck_tasks t
  join public.menu_trading_lines l on l.id = t.line_id
  join public.menu_items i on i.id = l.item_id
  where t.venue_id = p_venue_id and t.state = 'open'
    and l.retired_at is null and i.archived_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_trading_currencies(),
  private.menu_ascii_lower(text),
  private.menu_parse_price(jsonb, text),
  private.menu_json_keys(jsonb),
  private.menu_trading_value_problem(text, jsonb),
  private.menu_until_text(timestamptz),
  private.menu_trading_lines_guard(),
  private.menu_trading_assertions_guard(),
  private.menu_trading_decisions_guard(),
  private.menu_trading_recheck_tasks_guard(),
  private.menu_trading_role(uuid, boolean),
  private.menu_trading_item_active(uuid, uuid),
  private.menu_venue_date(uuid, timestamptz),
  private.menu_trading_replay(uuid, uuid, text, text),
  private.menu_trading_record(uuid, uuid, text, text, uuid, jsonb),
  private.menu_trading_field_state(uuid, text, timestamptz),
  private.menu_trading_head(uuid, text),
  private.menu_trading_temporary_state(uuid, timestamptz),
  private.menu_trading_schedule_state(uuid, timestamptz),
  private.menu_trading_availability(uuid, timestamptz),
  private.menu_trading_resolution(uuid, timestamptz),
  private.menu_trading_line_json(public.menu_trading_lines, text, timestamptz),
  private.menu_close_rechecks(uuid, timestamptz),
  private.menu_open_rechecks(timestamptz),
  private.menu_open_recheck_rows(uuid)
from public, anon, authenticated;

revoke all on function
  public.menu_trading_propose(uuid, uuid, uuid, jsonb, text, text, jsonb, date, date, date, text, jsonb, uuid),
  public.menu_trading_decide(uuid, integer, text, text, date, uuid),
  public.menu_set_temporarily_unavailable(uuid, uuid, timestamptz, text, uuid),
  public.menu_availability_schedule_add(uuid, jsonb, text, uuid, uuid, uuid),
  public.menu_availability_exception_add(uuid, date, text, jsonb, text, uuid),
  public.menu_trading_lines_for_item(uuid),
  public.menu_trading_history(uuid, timestamptz)
from public, anon, service_role;

grant execute on function
  public.menu_trading_propose(uuid, uuid, uuid, jsonb, text, text, jsonb, date, date, date, text, jsonb, uuid),
  public.menu_trading_decide(uuid, integer, text, text, date, uuid),
  public.menu_set_temporarily_unavailable(uuid, uuid, timestamptz, text, uuid),
  public.menu_availability_schedule_add(uuid, jsonb, text, uuid, uuid, uuid),
  public.menu_availability_exception_add(uuid, date, text, jsonb, text, uuid),
  public.menu_trading_lines_for_item(uuid),
  public.menu_trading_history(uuid, timestamptz)
to authenticated;
