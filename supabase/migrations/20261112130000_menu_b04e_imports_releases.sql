-- B04-e (b04-design §8, §13.2 "Activation guard", §18 L1, §19.2 S6; task
-- B04-05): import runs with a dry-run comparison, trading proposals with
-- per-line review, trading releases bound to a catalogue version, and
-- activation of a version with its release in one transaction.
--
-- Parse and match stay today's (§8.1 B04-05a): a file is parsed and matched
-- in TypeScript, recorded as an S1 source snapshot (menu_record_snapshot, which
-- already refuses the same revision with other bytes:
-- snapshot_revision_conflict) and matched by the S1 crosswalk
-- (menu_crosswalk_propose / _decide). The catalogue draft is created by
-- today's create_menu_draft. This migration adds the steps after that:
--
--   menu_import_dry_run(snapshot)      the comparison report and one trading
--                                      proposal per entry with price text;
--                                      the same file again (same sha256 for
--                                      the venue, already applied) reports
--                                      already_imported with the earlier run
--   menu_trading_proposal_decide /     per-line review: accepted, edited or
--   menu_trading_proposals_accept_exact rejected; bulk accept only for an
--                                      exact source-key identity and an
--                                      exact price parse (§8.2 #3)
--   menu_import_apply(run, draft)      within 24 hours of the dry run and on
--                                      an unchanged base (active version and
--                                      current release), binds the draft
--                                      version to a new draft release
--   menu_release_confirm(release, hash) the release is confirmed for exactly
--                                      the content whose hash the reviewer
--                                      saw (§8.2 #4)
--   menu_activate_with_release         activates the version (today's
--                                      activate_menu_version, unchanged) and
--                                      then writes the release in the same
--                                      transaction: one source_mapping (or
--                                      correction) price assertion with its
--                                      confirmation per changed line, release
--                                      lines carrying unchanged values, and
--                                      tombstones for lines whose dish or
--                                      option left the menu. Any error leaves
--                                      the previous version and release
--                                      current; a retry with the same key
--                                      replays (§8.2 #5)
--
-- Vocabulary (GAP-16 scope guard): a release is *confirmed*, not "approved";
-- the contract's menu_release_approve is menu_release_confirm here.
--
-- Activation guard (§13.2, L1). menu_versions_require_release (before update
-- of status, draft -> active) does nothing while no trading field (price,
-- portion, availability, temporary_unavailability, modifiers) of the venue
-- has authority nabalens: today's path is unchanged, and S1 still refuses
-- switching those fields (authority_switch_not_enabled), so it is inert until
-- the owner decides OD-B4-1. Otherwise it requires the transaction-local
-- setting nabalens.menu_release_id, which only menu_activate_with_release
-- sets, and re-reads that release: confirmed, this venue and version, and an
-- unchanged lines hash; anything else is menu_release_required. The setting
-- alone grants nothing.
--
-- Credit and photos are untouched: releases write trading rows only, and the
-- activation's photo reconcile runs once, inside activate_menu_version.
--
-- Rollback (§13.1): drop the trigger and revoke the new commands; the old
-- path keeps working. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.menu_import_runs (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null references public.venues (id) on delete restrict,
  source_id uuid not null,
  snapshot_id uuid not null,
  mode text not null check (mode in ('dry_run', 'apply')),
  dry_run_id uuid references public.menu_import_runs (id) on delete restrict,
  base_version_id uuid,
  base_release_id uuid,
  draft_version_id uuid,
  release_id uuid,
  started_by uuid not null references public.profiles (id) on delete restrict,
  started_at timestamptz not null default now(),
  constraint menu_import_runs_id_venue_key unique (id, venue_id),
  constraint menu_import_runs_snapshot_fkey foreign key (snapshot_id, source_id)
    references public.menu_source_snapshots (id, source_id) on delete restrict,
  constraint menu_import_runs_source_fkey foreign key (source_id, venue_id)
    references public.menu_sources (id, venue_id) on delete restrict,
  constraint menu_import_runs_base_fkey foreign key (base_version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_import_runs_draft_fkey foreign key (draft_version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_import_runs_mode check (
    (mode = 'apply') = (dry_run_id is not null)
    and (mode = 'apply') = (draft_version_id is not null)
  ),
  constraint menu_import_runs_one_apply unique (dry_run_id)
);

create index menu_import_runs_venue_idx on public.menu_import_runs (venue_id, started_at desc);

create table public.menu_trading_releases (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  release_number integer not null check (release_number >= 1),
  menu_version_id uuid not null,
  run_id uuid,
  kind text not null check (kind in ('import', 'edit', 'rollback')),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'current', 'superseded', 'discarded')),
  lines_hash text check (lines_hash is null or lines_hash ~ '^[0-9a-f]{64}$'),
  based_on_release_id uuid references public.menu_trading_releases (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  activated_by uuid references public.profiles (id) on delete restrict,
  activated_at timestamptz,
  constraint menu_trading_releases_id_venue_key unique (id, venue_id),
  constraint menu_trading_releases_number_key unique (venue_id, release_number),
  constraint menu_trading_releases_version_fkey foreign key (menu_version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_trading_releases_run_fkey foreign key (run_id, venue_id)
    references public.menu_import_runs (id, venue_id) on delete restrict,
  constraint menu_trading_releases_confirmed check (
    (status = 'draft' or status = 'discarded' and confirmed_at is null) = (confirmed_at is null)
    and (confirmed_by is null) = (confirmed_at is null)
    and (confirmed_at is null) = (lines_hash is null)
  ),
  constraint menu_trading_releases_activated check (
    (status in ('current', 'superseded')) = (activated_at is not null)
    and (activated_by is null) = (activated_at is null)
  )
);

create unique index menu_trading_releases_one_current
  on public.menu_trading_releases (venue_id) where status = 'current';
create unique index menu_trading_releases_one_per_version
  on public.menu_trading_releases (menu_version_id) where status <> 'discarded';

alter table public.menu_import_runs add constraint menu_import_runs_release_fkey
  foreign key (release_id, venue_id) references public.menu_trading_releases (id, venue_id) on delete restrict;
alter table public.menu_import_runs add constraint menu_import_runs_base_release_fkey
  foreign key (base_release_id, venue_id) references public.menu_trading_releases (id, venue_id) on delete restrict;

create table public.menu_trading_proposals (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  run_id uuid not null,
  venue_id uuid not null,
  locator text not null,
  item_id uuid,
  variant_id uuid,
  channel text not null default 'all' check (channel in ('all', 'dine_in', 'takeaway')),
  identity_basis text check (identity_basis is null
    or identity_basis in ('source_key_exact', 'name_candidate', 'manual', 'carried')),
  raw_text text not null check (length(raw_text) between 1 and 80),
  parsed jsonb,
  parse_status text not null check (parse_status in ('exact', 'ambiguous', 'unparseable')),
  current_value jsonb,
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'edited', 'rejected')),
  edited_value jsonb,
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  constraint menu_trading_proposals_run_fkey foreign key (run_id, venue_id)
    references public.menu_import_runs (id, venue_id) on delete restrict,
  constraint menu_trading_proposals_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_trading_proposals_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint menu_trading_proposals_once unique (run_id, locator, channel),
  constraint menu_trading_proposals_parsed check ((parse_status = 'exact') = (parsed is not null)),
  constraint menu_trading_proposals_decided check (
    (decision = 'pending') = (decided_by is null) and (decided_by is null) = (decided_at is null)
    and (decision = 'edited') = (edited_value is not null)
    and (decision not in ('accepted', 'edited') or item_id is not null)
    and (decision <> 'accepted' or parse_status = 'exact')
  )
);

create index menu_trading_proposals_run_idx on public.menu_trading_proposals (run_id, seq);

create table public.menu_trading_release_lines (
  release_id uuid not null,
  venue_id uuid not null,
  line_id uuid not null,
  assertion_ids uuid[] not null default '{}' check (array_position(assertion_ids, null) is null),
  withdrawn boolean not null default false,
  proposal_id uuid references public.menu_trading_proposals (id) on delete restrict,
  primary key (release_id, line_id),
  constraint menu_trading_release_lines_release_fkey foreign key (release_id, venue_id)
    references public.menu_trading_releases (id, venue_id) on delete restrict,
  constraint menu_trading_release_lines_line_fkey foreign key (line_id, venue_id)
    references public.menu_trading_lines (id, venue_id) on delete restrict,
  constraint menu_trading_release_lines_tombstone check (not withdrawn or cardinality(assertion_ids) = 0)
);

create table public.menu_trading_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null references public.venues (id) on delete restrict,
  kind text not null check (kind in (
    'import_dry_run', 'import_apply', 'proposal_decided', 'proposals_bulk_accepted', 'release_confirmed',
    'release_activated'
  )),
  run_id uuid,
  release_id uuid,
  proposal_id uuid,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) < 8192)
);

create index menu_trading_events_venue_idx on public.menu_trading_events (venue_id, seq);

comment on table public.menu_import_runs is
  'Import runs (B04-05a/b): a dry run (its report is computed from the snapshot, base and proposals by menu_import_run) and the apply that binds a draft version to a draft release. Append-only.';
comment on table public.menu_trading_proposals is
  'One trading proposal per priced source entry per dry run (B04-05c). Only the decision columns change, until the release is activated; raw text is internal.';
comment on table public.menu_trading_releases is
  'Trading releases (B04-05d): the reviewed lines bound to one catalogue version, confirmed for one lines hash, current once activated with it.';
comment on table public.menu_trading_release_lines is
  'Immutable lines of an activated release: the confirmed assertions it includes, or a tombstone carried into every later release.';
comment on table public.menu_trading_events is
  'Append-only audit of every B04-e command.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['menu_import_runs', 'menu_trading_release_lines', 'menu_trading_events'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

-- A proposal changes only its decision (revision + 1), and never once its
-- run's release is active or retired.
create function private.menu_trading_proposals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or new.revision <> old.revision + 1
     or (to_jsonb(new) - array['decision', 'edited_value', 'decided_by', 'decided_at', 'revision'])
        is distinct from (to_jsonb(old) - array['decision', 'edited_value', 'decided_by', 'decided_at', 'revision'])
     or exists (select 1 from public.menu_import_runs a join public.menu_trading_releases r on r.id = a.release_id
                where a.dry_run_id = old.run_id and r.status in ('current', 'superseded')) then
    raise exception 'menu_trading_proposal_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_trading_proposals_guard
  before update or delete on public.menu_trading_proposals
  for each row execute function private.menu_trading_proposals_guard();
create trigger menu_trading_proposals_no_truncate
  before truncate on public.menu_trading_proposals
  for each statement execute function private.append_only_guard();

-- Release status moves draft -> confirmed -> current -> superseded, or
-- draft/confirmed -> discarded; confirmed may go back to draft only by
-- discarding. Nothing else changes after creation except those columns.
create function private.menu_trading_releases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(new) - array['status', 'lines_hash', 'confirmed_by', 'confirmed_at', 'activated_by', 'activated_at'])
        is distinct from (to_jsonb(old) - array['status', 'lines_hash', 'confirmed_by', 'confirmed_at', 'activated_by',
          'activated_at'])
     or not ((old.status, new.status) in (('draft', 'confirmed'), ('confirmed', 'confirmed'), ('confirmed', 'current'),
       ('current', 'superseded'), ('draft', 'discarded'), ('confirmed', 'discarded'))) then
    raise exception 'menu_trading_release_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_trading_releases_guard
  before update or delete on public.menu_trading_releases
  for each row execute function private.menu_trading_releases_guard();
create trigger menu_trading_releases_no_truncate
  before truncate on public.menu_trading_releases
  for each statement execute function private.append_only_guard();

revoke all on
  public.menu_import_runs, public.menu_trading_proposals, public.menu_trading_releases,
  public.menu_trading_release_lines, public.menu_trading_events
from public, anon, authenticated, service_role;
grant select on
  public.menu_import_runs, public.menu_trading_proposals, public.menu_trading_releases,
  public.menu_trading_release_lines, public.menu_trading_events
to service_role;
alter table public.menu_import_runs enable row level security;
alter table public.menu_trading_proposals enable row level security;
alter table public.menu_trading_releases enable row level security;
alter table public.menu_trading_release_lines enable row level security;
alter table public.menu_trading_events enable row level security;

alter table public.menu_trading_commands drop constraint menu_trading_commands_command_check;
alter table public.menu_trading_commands add constraint menu_trading_commands_command_check check (command in (
  'propose', 'decide', 'set_temporarily_unavailable', 'schedule_add', 'schedule_exception_add',
  'modifier_group_add', 'modifier_option_add', 'modifier_attach', 'modifier_retire', 'modifier_line',
  'dietary_propose', 'dietary_decide', 'allergen_propose', 'allergen_evidence', 'allergen_decide',
  'import_dry_run', 'import_apply', 'proposal_decide', 'proposals_accept_exact', 'release_confirm',
  'activate_with_release'
));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The venue's current release, or null.
create function private.menu_current_release_id(p_venue_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.menu_trading_releases r where r.venue_id = p_venue_id and r.status = 'current';
$$;

-- Whether any trading field of the venue has authority nabalens in force
-- (the row no other row supersedes).
create function private.menu_trading_authority_nabalens(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.menu_field_authority a
    where a.venue_id = p_venue_id and a.authority = 'nabalens'
      and a.field in ('price', 'portion', 'availability', 'temporary_unavailability', 'modifiers')
      and not exists (select 1 from public.menu_field_authority s where s.supersedes = a.id));
$$;

-- A release's content: the accepted and edited proposals of its dry run,
-- each { proposalId, itemId, variantId, channel, value, decision }, ordered.
create function private.menu_release_content(p_release_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'proposalId', p.id, 'itemId', p.item_id, 'variantId', p.variant_id, 'channel', p.channel,
      'value', case p.decision when 'edited' then p.edited_value else p.parsed end,
      'decision', p.decision)
    order by p.item_id, p.variant_id nulls first, p.channel, p.id), '[]'::jsonb)
  from public.menu_trading_releases r
  join public.menu_trading_proposals p on p.run_id = r.run_id
  where r.id = p_release_id and p.decision in ('accepted', 'edited');
$$;

-- The hash a confirmation binds (§8.2 #4): the version and the content.
create function private.menu_release_hash(p_release_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
      'version', r.menu_version_id, 'lines', private.menu_release_content(r.id))::text, 'UTF8')), 'hex')
  from public.menu_trading_releases r where r.id = p_release_id;
$$;

-- A bounded list (at most 200 elements) of a jsonb array.
create function private.menu_report_list(p_list jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce((select jsonb_agg(x.v order by x.n) from jsonb_array_elements(coalesce(p_list, '[]'::jsonb))
    with ordinality as x(v, n) where x.n <= 200), '[]'::jsonb);
$$;

-- The dry-run comparison (§8.2 #2) of a snapshot against the base version,
-- through the source's crosswalk heads, and the run's trading proposals:
-- added, uncertain, renamed, moved, returning and removed items; added and
-- removed variants; duplicates (one name in several sections, kept
-- distinct); crosswalk outcomes; proposals by parse status; price changes
-- against the current value. Lists hold at most 200 rows; counts are exact.
create function private.menu_import_report(p_snapshot_id uuid, p_base_version_id uuid, p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with snap as (
    select s.* from public.menu_source_snapshots s where s.id = p_snapshot_id
  ),
  entries as (
    select e.v ->> 'locator' as locator, e.v ->> 'name' as name, coalesce(e.v ->> 'section', '') as section,
      coalesce(e.v -> 'variants', '[]'::jsonb) as variants, e.n
    from snap cross join jsonb_array_elements(snap.document) with ordinality as e(v, n)
  ),
  mapped as (
    select en.*, h.status, case when h.status in ('confirmed', 'carried') then h.item_id end as item_id
    from entries en cross join snap
    left join public.menu_crosswalk_heads h on h.source_id = snap.source_id and h.locator = en.locator
  ),
  active as (
    select me.item_id, me.name, ms.name as section,
      coalesce((select jsonb_agg(ev.name order by ev.position) from public.menu_entry_variants ev
                where ev.entry_id = me.id), '[]'::jsonb) as variants
    from public.menu_entries me join public.menu_sections ms on ms.id = me.section_id
    where me.version_id = p_base_version_id
  ),
  matched as (
    select m.*, a.name as active_name, a.section as active_section, a.variants as active_variants,
      a.item_id is not null as on_base
    from mapped m left join active a on a.item_id = m.item_id
    where m.item_id is not null
  ),
  lists as (
    select
      (select coalesce(jsonb_agg(jsonb_build_object('locator', m.locator, 'name', m.name) order by m.n), '[]'::jsonb)
       from mapped m where m.item_id is null and (m.status is null or m.status = 'unmatched')) as added,
      (select coalesce(jsonb_agg(jsonb_build_object('locator', m.locator, 'name', m.name, 'crosswalk', m.status)
         order by m.n), '[]'::jsonb)
       from mapped m where m.item_id is null and m.status in ('proposed', 'ambiguous', 'needs_review')) as uncertain,
      (select coalesce(jsonb_agg(jsonb_build_object('locator', m.locator, 'itemId', m.item_id,
           'from', m.active_name, 'to', m.name) order by m.n), '[]'::jsonb)
       from matched m where m.on_base
         and private.menu_crosswalk_name_key(m.name) <> private.menu_crosswalk_name_key(m.active_name)) as renamed,
      (select coalesce(jsonb_agg(jsonb_build_object('locator', m.locator, 'itemId', m.item_id,
           'from', m.active_section, 'to', nullif(m.section, '')) order by m.n), '[]'::jsonb)
       from matched m where m.on_base and m.section <> ''
         and private.menu_crosswalk_name_key(m.section) <> private.menu_crosswalk_name_key(m.active_section)) as moved,
      (select coalesce(jsonb_agg(jsonb_build_object('locator', m.locator, 'itemId', m.item_id, 'name', m.name)
         order by m.n), '[]'::jsonb)
       from matched m where not m.on_base) as returning_items,
      (select coalesce(jsonb_agg(jsonb_build_object('itemId', a.item_id, 'name', a.name) order by a.name, a.item_id),
         '[]'::jsonb)
       from active a where not exists (select 1 from matched m where m.item_id = a.item_id)) as removed,
      (select coalesce(jsonb_agg(jsonb_build_object('itemId', m.item_id, 'variant', v.name) order by m.n, v.name),
         '[]'::jsonb)
       from matched m cross join lateral jsonb_array_elements_text(m.variants) v(name)
       where m.on_base and not exists (select 1 from jsonb_array_elements_text(m.active_variants) a(name)
         where private.menu_crosswalk_name_key(a.name) = private.menu_crosswalk_name_key(v.name))) as variants_added,
      (select coalesce(jsonb_agg(jsonb_build_object('itemId', m.item_id, 'variant', a.name) order by m.n, a.name),
         '[]'::jsonb)
       from matched m cross join lateral jsonb_array_elements_text(m.active_variants) a(name)
       where m.on_base and not exists (select 1 from jsonb_array_elements_text(m.variants) v(name)
         where private.menu_crosswalk_name_key(a.name) = private.menu_crosswalk_name_key(v.name))) as variants_removed,
      (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'sections', d.sections) order by d.name), '[]'::jsonb)
       from (select min(en.name) as name, jsonb_agg(distinct en.section) as sections
             from entries en group by private.menu_crosswalk_name_key(en.name)
             having count(distinct en.section) > 1) d) as duplicates,
      (select coalesce(jsonb_agg(jsonb_build_object('locator', p.locator, 'itemId', p.item_id,
           'from', p.current_value -> 'amountMinor', 'to', p.parsed -> 'amountMinor') order by p.seq), '[]'::jsonb)
       from public.menu_trading_proposals p
       where p.run_id = p_run_id and p.parse_status = 'exact' and p.current_value is not null
         and p.current_value -> 'amountMinor' is distinct from p.parsed -> 'amountMinor') as price_changes
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'entries', (select count(*) from entries),
      'matched', (select count(*) from matched),
      'added', jsonb_array_length(l.added), 'uncertain', jsonb_array_length(l.uncertain),
      'renamed', jsonb_array_length(l.renamed), 'moved', jsonb_array_length(l.moved),
      'returning', jsonb_array_length(l.returning_items), 'removed', jsonb_array_length(l.removed),
      'variantsAdded', jsonb_array_length(l.variants_added),
      'variantsRemoved', jsonb_array_length(l.variants_removed),
      'duplicates', jsonb_array_length(l.duplicates),
      'priceChanges', jsonb_array_length(l.price_changes),
      'proposals', (select jsonb_build_object(
          'exact', count(*) filter (where p.parse_status = 'exact'),
          'ambiguous', count(*) filter (where p.parse_status = 'ambiguous'),
          'unparseable', count(*) filter (where p.parse_status = 'unparseable'))
        from public.menu_trading_proposals p where p.run_id = p_run_id),
      'crosswalk', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
          select h.status, count(*) as n from public.menu_crosswalk_heads h cross join snap
          where h.source_id = snap.source_id group by h.status) x)),
    'added', private.menu_report_list(l.added), 'uncertain', private.menu_report_list(l.uncertain),
    'renamed', private.menu_report_list(l.renamed), 'moved', private.menu_report_list(l.moved),
    'returning', private.menu_report_list(l.returning_items), 'removed', private.menu_report_list(l.removed),
    'variantsAdded', private.menu_report_list(l.variants_added),
    'variantsRemoved', private.menu_report_list(l.variants_removed),
    'duplicates', private.menu_report_list(l.duplicates),
    'priceChanges', private.menu_report_list(l.price_changes))
  from lists l;
$$;

-- An event row.
create function private.menu_trading_event(
  p_venue_id uuid, p_kind text, p_run uuid, p_release uuid, p_proposal uuid, p_detail jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.menu_trading_events (venue_id, kind, run_id, release_id, proposal_id, actor_id, detail)
  values (p_venue_id, p_kind, p_run, p_release, p_proposal, auth.uid(), coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Commands (admin; OD-B4-11 default: one admin reviews and confirms)
-- ---------------------------------------------------------------------------

-- Dry run (§8.1 B04-05a/b/c) of a recorded snapshot whose source the
-- crosswalk has matched (crosswalk_not_run otherwise). Records the run, one
-- proposal per entry with price text (exact, ambiguous or unparseable,
-- never guessed; the plain line of the mapped item and channel; unmapped
-- entries keep no item) and the report. The same file applied before for the
-- venue (same sha256) reports already_imported with that run (§8.2 #6).
create function public.menu_import_dry_run(p_snapshot uuid, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_snap public.menu_source_snapshots;
  v_hash text;
  v_prior jsonb;
  v_earlier public.menu_import_runs;
  v_base uuid;
  v_release uuid;
  v_run uuid;
  v_report jsonb;
  v_result jsonb;
begin
  select s.* into v_snap from public.menu_source_snapshots s where s.id = p_snapshot;
  if not found then
    raise exception 'menu_snapshot_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_snap.venue_id, true);
  v_hash := private.menu_source_request_hash(jsonb_build_object('snapshot', p_snapshot));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'import_dry_run', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select a.* into v_earlier
  from public.menu_import_runs a
  join public.menu_source_snapshots x on x.id = a.snapshot_id
  where a.venue_id = v_snap.venue_id and a.mode = 'apply' and x.sha256 = v_snap.sha256
  order by a.started_at desc, a.seq desc
  limit 1;
  if found then
    return private.menu_trading_record(p_request_key, v_uid, 'import_dry_run', v_hash, v_snap.venue_id,
      jsonb_build_object('status', 'already_imported', 'runId', v_earlier.dry_run_id,
        'applyRunId', v_earlier.id, 'releaseId', v_earlier.release_id, 'replayed', false));
  end if;
  if not exists (select 1 from public.menu_crosswalk_runs c where c.snapshot_id = v_snap.id) then
    raise exception 'crosswalk_not_run' using errcode = 'P0001';
  end if;
  v_base := private.active_menu_version_id(v_snap.venue_id);
  v_release := private.menu_current_release_id(v_snap.venue_id);
  insert into public.menu_import_runs (venue_id, source_id, snapshot_id, mode, base_version_id, base_release_id,
    started_by)
  values (v_snap.venue_id, v_snap.source_id, v_snap.id, 'dry_run', v_base, v_release, v_uid)
  returning id into v_run;

  insert into public.menu_trading_proposals (run_id, venue_id, locator, item_id, channel, identity_basis, raw_text,
    parsed, parse_status, current_value)
  select v_run, v_snap.venue_id, e.v ->> 'locator', m.item_id, coalesce(h.channel, 'all'), m.basis,
    e.v ->> 'priceText',
    case when x.pp ->> 'ok' = 'true' then jsonb_build_object('kind', 'fixed',
      'amountMinor', (x.pp ->> 'amountMinor')::bigint, 'currency', x.pp ->> 'currency') end,
    case when x.pp ->> 'ok' = 'true' then 'exact' when x.pp ->> 'error' = 'ambiguous_price' then 'ambiguous'
      else 'unparseable' end,
    (select f.state -> 'value'
     from public.menu_trading_lines l
     cross join lateral (select private.menu_trading_field_state(l.id, 'price', now()) as state) f
     where m.item_id is not null and l.item_id = m.item_id and l.variant_id is null and l.portion_label is null
       and l.modifier_option_id is null and l.channel = coalesce(h.channel, 'all') and l.retired_at is null
       and f.state ->> 'status' = 'available')
  from jsonb_array_elements(v_snap.document) as e(v)
  left join public.menu_crosswalk_heads h on h.source_id = v_snap.source_id and h.locator = e.v ->> 'locator'
  cross join lateral (
    select case when h.status in ('confirmed', 'carried') then h.item_id end as item_id,
      case when h.status in ('confirmed', 'carried') then (select c.basis from public.menu_crosswalk c
        where c.id = h.row_id) end as basis
  ) m
  cross join lateral (select private.menu_parse_price(e.v -> 'priceText', 'GBP') as pp) x
  where e.v ->> 'priceText' is not null;

  v_report := private.menu_import_report(v_snap.id, v_base, v_run);
  -- The run row is append-only and the proposals reference it, so the report
  -- is returned (and kept in the request-key record) rather than stored on
  -- the row; menu_import_run recomputes it on demand.
  perform private.menu_trading_event(v_snap.venue_id, 'import_dry_run', v_run, null, null,
    jsonb_build_object('snapshotId', v_snap.id, 'counts', v_report -> 'counts'));
  v_result := jsonb_build_object('status', 'ok', 'runId', v_run, 'baseVersionId', v_base,
    'baseReleaseId', v_release, 'report', v_report, 'replayed', false);
  return private.menu_trading_record(p_request_key, v_uid, 'import_dry_run', v_hash, v_snap.venue_id, v_result);
end;
$$;

-- Apply (§8.4): within 24 hours of the dry run, on an unchanged base (active
-- version and current release, else import_base_changed), bind the draft
-- version made by today's create_menu_draft from the same base to a new
-- draft release (kind import) whose content is the run's reviewed proposals.
create function public.menu_import_apply(p_run uuid, p_draft_version uuid, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_run public.menu_import_runs;
  v_draft public.menu_versions;
  v_hash text;
  v_prior jsonb;
  v_release uuid;
  v_number integer;
  v_apply uuid;
begin
  select r.* into v_run from public.menu_import_runs r where r.id = p_run and r.mode = 'dry_run';
  if not found then
    raise exception 'menu_import_run_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_run.venue_id, false);
  v_hash := private.menu_source_request_hash(jsonb_build_object('run', p_run, 'draft', p_draft_version));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'import_apply', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if exists (select 1 from public.menu_import_runs a where a.dry_run_id = v_run.id) then
    raise exception 'menu_import_already_applied' using errcode = 'P0001';
  end if;
  if v_run.started_at < now() - interval '24 hours'
     or v_run.base_version_id is distinct from private.active_menu_version_id(v_run.venue_id)
     or v_run.base_release_id is distinct from private.menu_current_release_id(v_run.venue_id) then
    raise exception 'import_base_changed' using errcode = 'P0001';
  end if;
  select v.* into v_draft from public.menu_versions v
  where v.id = p_draft_version and v.venue_id = v_run.venue_id for update;
  if not found or v_draft.status <> 'draft'
     or v_draft.based_on_version_id is distinct from v_run.base_version_id then
    raise exception 'menu_import_draft_mismatch' using errcode = 'P0001';
  end if;
  select coalesce(max(r.release_number), 0) + 1 into v_number
  from public.menu_trading_releases r where r.venue_id = v_run.venue_id;
  insert into public.menu_trading_releases (venue_id, release_number, menu_version_id, run_id, kind,
    based_on_release_id, created_by)
  values (v_run.venue_id, v_number, v_draft.id, v_run.id, 'import', v_run.base_release_id, v_uid)
  returning id into v_release;
  insert into public.menu_import_runs (venue_id, source_id, snapshot_id, mode, dry_run_id, base_version_id,
    base_release_id, draft_version_id, release_id, started_by)
  values (v_run.venue_id, v_run.source_id, v_run.snapshot_id, 'apply', v_run.id, v_run.base_version_id,
    v_run.base_release_id, v_draft.id, v_release, v_uid)
  returning id into v_apply;
  perform private.menu_trading_event(v_run.venue_id, 'import_apply', v_apply, v_release, null,
    jsonb_build_object('dryRunId', v_run.id, 'draftVersionId', v_draft.id));
  return private.menu_trading_record(p_request_key, v_uid, 'import_apply', v_hash, v_run.venue_id,
    jsonb_build_object('applyRunId', v_apply, 'releaseId', v_release, 'releaseNumber', v_number,
      'menuVersionId', v_draft.id, 'linesHash', private.menu_release_hash(v_release), 'replayed', false));
end;
$$;

-- One proposal's decision (§8.2 #3): accepted (an exact parse), edited (a new
-- exact value { amount }) or rejected, compare-and-set on its revision. A
-- proposal without a mapped dish can only be rejected. Allowed until its
-- release is activated; a change after confirmation makes activation stale.
create function public.menu_trading_proposal_decide(
  p_proposal uuid, p_expected_revision integer, p_decision text, p_value jsonb, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_p public.menu_trading_proposals;
  v_hash text;
  v_prior jsonb;
  v_parsed jsonb;
  v_edited jsonb;
begin
  select p.* into v_p from public.menu_trading_proposals p where p.id = p_proposal;
  if not found then
    raise exception 'menu_trading_proposal_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_p.venue_id, true);
  v_hash := private.menu_source_request_hash(jsonb_build_object('proposal', p_proposal,
    'expected', p_expected_revision, 'decision', p_decision, 'value', p_value));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'proposal_decide', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_decision is null or p_decision not in ('accepted', 'edited', 'rejected')
     or (p_decision <> 'edited' and p_value is not null) then
    raise exception 'invalid_proposal_decision' using errcode = '22023';
  end if;
  select p.* into v_p from public.menu_trading_proposals p where p.id = p_proposal for update;
  if p_expected_revision is distinct from v_p.revision then
    raise exception 'menu_trading_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_p.revision)::text;
  end if;
  if exists (select 1 from public.menu_trading_releases r
             where r.run_id = v_p.run_id and r.status in ('current', 'superseded')) then
    raise exception 'menu_trading_proposal_immutable' using errcode = '42501';
  end if;
  if p_decision in ('accepted', 'edited') and v_p.item_id is null then
    raise exception 'menu_trading_proposal_unmapped' using errcode = 'P0001';
  end if;
  if p_decision = 'accepted' and v_p.parse_status <> 'exact' then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_decision = 'edited' then
    v_parsed := private.menu_parse_price(case when jsonb_typeof(p_value) = 'object' then p_value -> 'amount' end, 'GBP');
    if v_parsed ->> 'ok' is distinct from 'true' then
      raise exception 'invalid_price' using errcode = '22023';
    end if;
    v_edited := jsonb_build_object('kind', 'fixed', 'amountMinor', (v_parsed ->> 'amountMinor')::bigint,
      'currency', v_parsed ->> 'currency');
  end if;
  update public.menu_trading_proposals p
  set decision = p_decision, edited_value = v_edited, decided_by = v_uid, decided_at = now(),
      revision = p.revision + 1
  where p.id = v_p.id
  returning p.* into v_p;
  perform private.menu_trading_event(v_p.venue_id, 'proposal_decided', v_p.run_id, null, v_p.id,
    jsonb_build_object('decision', p_decision));
  return private.menu_trading_record(p_request_key, v_uid, 'proposal_decide', v_hash, v_p.venue_id,
    jsonb_build_object('proposalId', v_p.id, 'decision', v_p.decision, 'revision', v_p.revision,
      'value', coalesce(v_p.edited_value, v_p.parsed), 'replayed', false));
end;
$$;

-- Bulk accept (§8.2 #3): every pending proposal of the run whose dish was
-- matched by its exact source key and whose price parsed exactly; each row
-- records the reviewer. Ambiguous, unparseable and name-matched lines stay.
create function public.menu_trading_proposals_accept_exact(p_run uuid, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_run public.menu_import_runs;
  v_hash text;
  v_prior jsonb;
  v_count integer;
begin
  select r.* into v_run from public.menu_import_runs r where r.id = p_run and r.mode = 'dry_run';
  if not found then
    raise exception 'menu_import_run_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_run.venue_id, true);
  v_hash := private.menu_source_request_hash(jsonb_build_object('run', p_run));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'proposals_accept_exact', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if exists (select 1 from public.menu_trading_releases r
             where r.run_id = v_run.id and r.status in ('current', 'superseded')) then
    raise exception 'menu_trading_proposal_immutable' using errcode = '42501';
  end if;
  with picked as (
    select p.id from public.menu_trading_proposals p
    where p.run_id = v_run.id and p.decision = 'pending' and p.parse_status = 'exact'
      and p.identity_basis = 'source_key_exact' and p.item_id is not null
    order by p.id
    for update
  )
  update public.menu_trading_proposals p
  set decision = 'accepted', decided_by = v_uid, decided_at = now(), revision = p.revision + 1
  from picked where p.id = picked.id;
  get diagnostics v_count = row_count;
  perform private.menu_trading_event(v_run.venue_id, 'proposals_bulk_accepted', v_run.id, null, null,
    jsonb_build_object('accepted', v_count));
  return private.menu_trading_record(p_request_key, v_uid, 'proposals_accept_exact', v_hash, v_run.venue_id,
    jsonb_build_object('runId', v_run.id, 'accepted', v_count, 'replayed', false));
end;
$$;

-- Confirm a draft (or re-confirm a confirmed) release for exactly the content
-- the reviewer saw: p_expected_hash must equal the current lines hash
-- (menu_release_stale otherwise). Every line's dish must be on the release's
-- version (menu_release_item_not_on_version).
create function public.menu_release_confirm(p_release uuid, p_expected_hash text, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_release public.menu_trading_releases;
  v_hash text;
  v_prior jsonb;
  v_lines text;
begin
  select r.* into v_release from public.menu_trading_releases r where r.id = p_release;
  if not found then
    raise exception 'menu_release_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_release.venue_id, true);
  v_hash := private.menu_source_request_hash(jsonb_build_object('release', p_release, 'hash', p_expected_hash));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'release_confirm', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select r.* into v_release from public.menu_trading_releases r where r.id = p_release for update;
  if v_release.status not in ('draft', 'confirmed') then
    raise exception 'menu_release_not_draft' using errcode = 'P0001';
  end if;
  v_lines := private.menu_release_hash(v_release.id);
  if p_expected_hash is distinct from v_lines then
    raise exception 'menu_release_stale' using errcode = 'P0001',
      detail = jsonb_build_object('linesHash', v_lines)::text;
  end if;
  if exists (
    select 1 from jsonb_array_elements(private.menu_release_content(v_release.id)) c
    where not exists (select 1 from public.menu_entries e
                      where e.version_id = v_release.menu_version_id and e.item_id = (c ->> 'itemId')::uuid)) then
    raise exception 'menu_release_item_not_on_version' using errcode = 'P0001';
  end if;
  update public.menu_trading_releases r
  set status = 'confirmed', lines_hash = v_lines, confirmed_by = v_uid, confirmed_at = now()
  where r.id = v_release.id;
  perform private.menu_trading_event(v_release.venue_id, 'release_confirmed', v_release.run_id, v_release.id, null,
    jsonb_build_object('linesHash', v_lines));
  return private.menu_trading_record(p_request_key, v_uid, 'release_confirm', v_hash, v_release.venue_id,
    jsonb_build_object('releaseId', v_release.id, 'status', 'confirmed', 'linesHash', v_lines, 'replayed', false));
end;
$$;

-- Activate a draft version with its confirmed release (§8.2 #5, §13.2): the
-- flag for menu_versions_require_release, today's activate_menu_version
-- (photo reconcile, line retirement and reviews run once, inside it), then
-- the release: per content line, the plain trading line (created when
-- missing) gets a confirmed price assertion unless its current price already
-- equals the value (source_mapping citing the snapshot, locator and raw
-- text; correction for an edited value), and a release line; lines of the
-- previous current release not re-priced are carried, or tombstoned when
-- their dish or option left the menu; tombstones carry forward. The previous
-- release is superseded. One transaction under the exclusive venue lock: any
-- error leaves the previous version and release current; the key replays.
create function public.menu_activate_with_release(
  p_version uuid, p_expected_revision integer, p_release uuid, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_release public.menu_trading_releases;
  v_hash text;
  v_prior jsonb;
  v_previous uuid;
  v_content jsonb;
  v_c jsonb;
  v_p public.menu_trading_proposals;
  v_snap public.menu_source_snapshots;
  v_line public.menu_trading_lines;
  v_state jsonb;
  v_assertion uuid;
  v_revision integer;
  v_today date;
  v_written integer := 0;
  v_carried integer := 0;
  v_tombstones integer := 0;
  v_pl record;
begin
  select r.* into v_release from public.menu_trading_releases r where r.id = p_release;
  if not found then
    raise exception 'menu_release_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_release.venue_id);
  v_hash := private.menu_source_request_hash(jsonb_build_object('version', p_version,
    'expected', p_expected_revision, 'release', p_release));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'activate_with_release', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select r.* into v_release from public.menu_trading_releases r where r.id = p_release for update;
  if v_release.menu_version_id is distinct from p_version then
    raise exception 'menu_release_wrong_version' using errcode = 'P0001';
  end if;
  if v_release.status <> 'confirmed' then
    raise exception 'menu_release_not_confirmed' using errcode = 'P0001';
  end if;
  if v_release.lines_hash is distinct from private.menu_release_hash(v_release.id) then
    raise exception 'menu_release_stale' using errcode = 'P0001';
  end if;
  v_previous := private.menu_current_release_id(v_release.venue_id);
  v_content := private.menu_release_content(v_release.id);

  perform set_config('nabalens.menu_release_id', v_release.id::text, true);
  perform public.activate_menu_version(p_version, p_expected_revision);
  perform set_config('nabalens.menu_release_id', '', true);

  v_today := private.menu_venue_date(v_release.venue_id, now());
  select s.* into v_snap from public.menu_source_snapshots s
  join public.menu_import_runs r on r.snapshot_id = s.id where r.id = v_release.run_id;
  for v_c in select c from jsonb_array_elements(v_content) c loop
    select p.* into v_p from public.menu_trading_proposals p where p.id = (v_c ->> 'proposalId')::uuid;
    select l.* into v_line from public.menu_trading_lines l
    where l.item_id = v_p.item_id and l.variant_id is not distinct from v_p.variant_id and l.portion_label is null
      and l.channel = v_p.channel and l.modifier_option_id is null
    for update;
    if not found then
      insert into public.menu_trading_lines (venue_id, item_id, variant_id, channel, created_by)
      values (v_release.venue_id, v_p.item_id, v_p.variant_id, v_p.channel, v_uid)
      returning * into v_line;
    end if;
    if v_line.retired_at is not null then
      raise exception 'menu_trading_line_retired' using errcode = 'P0001';
    end if;
    v_state := private.menu_trading_field_state(v_line.id, 'price', now());
    if v_state ->> 'status' = 'available' and v_state -> 'value' = v_c -> 'value' then
      v_assertion := (v_state ->> 'assertionId')::uuid;
    else
      insert into public.menu_trading_assertions (line_id, venue_id, field, value, basis, snapshot_id,
        source_locator, raw_text, stated_by, reason, supersedes, command_key)
      values (v_line.id, v_line.venue_id, 'price', v_c -> 'value',
        case when v_p.decision = 'edited' then 'correction' else 'source_mapping' end,
        case when v_p.decision = 'edited' then null else v_snap.id end,
        case when v_p.decision = 'edited' then null else v_p.locator end,
        case when v_p.decision = 'edited' then null else v_p.raw_text end,
        v_p.decided_by, 'Trading release ' || v_release.release_number,
        private.menu_trading_head(v_line.id, 'price'), p_request_key)
      returning id into v_assertion;
      update public.menu_trading_lines l set revision = l.revision + 1, updated_at = now()
      where l.id = v_line.id returning l.revision into v_revision;
      insert into public.menu_trading_decisions (assertion_id, line_id, venue_id, field, decision, decided_by,
        self_confirmed, reason, stated_on, stated_on_source, line_revision, command_key)
      values (v_assertion, v_line.id, v_line.venue_id, 'price', 'confirmed', v_uid, v_p.decided_by = v_uid,
        'Trading release ' || v_release.release_number, v_today, 'form_default', v_revision, p_request_key);
      perform private.menu_close_rechecks(v_line.id, now());
      v_written := v_written + 1;
    end if;
    insert into public.menu_trading_release_lines (release_id, venue_id, line_id, assertion_ids, proposal_id)
    values (v_release.id, v_release.venue_id, v_line.id, array[v_assertion], v_p.id);
  end loop;

  if v_previous is not null then
    for v_pl in
      select pl.line_id, pl.assertion_ids, pl.withdrawn, l.item_id, l.variant_id, l.retired_at
      from public.menu_trading_release_lines pl
      join public.menu_trading_lines l on l.id = pl.line_id
      where pl.release_id = v_previous
        and not exists (select 1 from public.menu_trading_release_lines n
                        where n.release_id = v_release.id and n.line_id = pl.line_id)
      order by pl.line_id
    loop
      if v_pl.withdrawn or v_pl.retired_at is not null
         or not private.menu_trading_item_active(v_pl.item_id, v_pl.variant_id) then
        insert into public.menu_trading_release_lines (release_id, venue_id, line_id, withdrawn)
        values (v_release.id, v_release.venue_id, v_pl.line_id, true);
        v_tombstones := v_tombstones + 1;
      else
        insert into public.menu_trading_release_lines (release_id, venue_id, line_id, assertion_ids)
        values (v_release.id, v_release.venue_id, v_pl.line_id, v_pl.assertion_ids);
        v_carried := v_carried + 1;
      end if;
    end loop;
    update public.menu_trading_releases r
    set status = 'superseded'
    where r.id = v_previous;
  end if;
  update public.menu_trading_releases r
  set status = 'current', activated_by = v_uid, activated_at = now()
  where r.id = v_release.id;
  perform private.menu_trading_event(v_release.venue_id, 'release_activated', v_release.run_id, v_release.id, null,
    jsonb_build_object('menuVersionId', p_version, 'previousReleaseId', v_previous, 'written', v_written,
      'carried', v_carried, 'tombstones', v_tombstones));
  return private.menu_trading_record(p_request_key, v_uid, 'activate_with_release', v_hash, v_release.venue_id,
    jsonb_build_object('releaseId', v_release.id, 'menuVersionId', p_version, 'previousReleaseId', v_previous,
      'written', v_written, 'carried', v_carried, 'tombstones', v_tombstones, 'replayed', false));
end;
$$;

-- ---------------------------------------------------------------------------
-- Activation guard (§13.2, L1)
-- ---------------------------------------------------------------------------

create function private.menu_versions_require_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text;
  v_release public.menu_trading_releases;
begin
  if not private.menu_trading_authority_nabalens(new.venue_id) then
    return new;
  end if;
  v_flag := nullif(current_setting('nabalens.menu_release_id', true), '');
  if v_flag is null or v_flag !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'menu_release_required' using errcode = 'P0001';
  end if;
  select r.* into v_release from public.menu_trading_releases r
  where r.id = v_flag::uuid and r.venue_id = new.venue_id and r.menu_version_id = new.id and r.status = 'confirmed';
  if not found or v_release.lines_hash is distinct from private.menu_release_hash(v_release.id) then
    raise exception 'menu_release_required' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Fires after menu_versions_guard (trigger name order).
create trigger menu_versions_require_release
  before update of status on public.menu_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function private.menu_versions_require_release();

-- ---------------------------------------------------------------------------
-- Read (admin)
-- ---------------------------------------------------------------------------

-- A dry run: its base, the report as of now, every proposal (raw text
-- included: admin only) and its release with the stored and current hash.
create function public.menu_import_run(p_run uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.menu_import_runs;
begin
  perform private.assert_active_admin();
  select r.* into v_run from public.menu_import_runs r where r.id = p_run and r.mode = 'dry_run';
  if not found then
    raise exception 'menu_import_run_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'runId', v_run.id, 'venueId', v_run.venue_id, 'sourceId', v_run.source_id, 'snapshotId', v_run.snapshot_id,
    'baseVersionId', v_run.base_version_id, 'baseReleaseId', v_run.base_release_id, 'startedAt', v_run.started_at,
    'report', private.menu_import_report(v_run.snapshot_id, v_run.base_version_id, v_run.id),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
        'proposalId', p.id, 'locator', p.locator, 'itemId', p.item_id, 'variantId', p.variant_id,
        'channel', p.channel, 'identityBasis', p.identity_basis, 'rawText', p.raw_text, 'parsed', p.parsed,
        'parseStatus', p.parse_status, 'currentValue', p.current_value, 'decision', p.decision,
        'editedValue', p.edited_value, 'revision', p.revision) order by p.seq)
      from public.menu_trading_proposals p where p.run_id = v_run.id), '[]'::jsonb),
    'release', (select jsonb_build_object('releaseId', r.id, 'releaseNumber', r.release_number,
        'menuVersionId', r.menu_version_id, 'status', r.status, 'linesHash', r.lines_hash,
        'currentHash', private.menu_release_hash(r.id))
      from public.menu_trading_releases r where r.run_id = v_run.id and r.status <> 'discarded'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_trading_proposals_guard(),
  private.menu_trading_releases_guard(),
  private.menu_current_release_id(uuid),
  private.menu_trading_authority_nabalens(uuid),
  private.menu_release_content(uuid),
  private.menu_release_hash(uuid),
  private.menu_report_list(jsonb),
  private.menu_import_report(uuid, uuid, uuid),
  private.menu_trading_event(uuid, text, uuid, uuid, uuid, jsonb),
  private.menu_versions_require_release()
from public, anon, authenticated;

revoke all on function
  public.menu_import_dry_run(uuid, uuid),
  public.menu_import_apply(uuid, uuid, uuid),
  public.menu_trading_proposal_decide(uuid, integer, text, jsonb, uuid),
  public.menu_trading_proposals_accept_exact(uuid, uuid),
  public.menu_release_confirm(uuid, text, uuid),
  public.menu_activate_with_release(uuid, integer, uuid, uuid),
  public.menu_import_run(uuid)
from public, anon, service_role;

grant execute on function
  public.menu_import_dry_run(uuid, uuid),
  public.menu_import_apply(uuid, uuid, uuid),
  public.menu_trading_proposal_decide(uuid, integer, text, jsonb, uuid),
  public.menu_trading_proposals_accept_exact(uuid, uuid),
  public.menu_release_confirm(uuid, text, uuid),
  public.menu_activate_with_release(uuid, integer, uuid, uuid),
  public.menu_import_run(uuid)
to authenticated;
