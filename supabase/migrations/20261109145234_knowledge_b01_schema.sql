-- B01 knowledge layer, part 1: schema (docs/knowledge/b01-design.md §2).
--
-- Additive only. New append-only tables record what the amenity tables cannot:
-- proposals, Couldn't-establish findings, change reports, requested detail,
-- decisions, the per-venue working list, knowledge history, server drafts and
-- per-person dismissals. amenity_submissions gains three nullable columns that
-- only new rows fill. No released table, constraint, enum or trigger changes,
-- and nothing is backfilled: the credit inputs (amenity_submissions,
-- amenity_check_events) are untouched by this migration.
--
-- Rollback (§16): disable working-list rows (no slot is in scope at deploy, so
-- every existing path behaves as before). Forward-only otherwise: tables that
-- hold data are never dropped and triggers are never disabled.

-- ---------------------------------------------------------------------------
-- Question rules (versioned, migration-seeded)
-- ---------------------------------------------------------------------------

create table public.knowledge_question_rules (
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  rule_version integer not null check (rule_version >= 1),
  confirmation text not null check (confirmation in ('none', 'venue_manager')),
  self_confirmation_allowed boolean not null default false,
  unassigned_auto_complete boolean not null default true,
  staff_text_internal boolean not null default true,
  redaction_required boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (question_key, rule_version),
  constraint knowledge_question_rules_self check (confirmation = 'venue_manager' or not self_confirmation_allowed)
);

comment on table public.knowledge_question_rules is
  'Versioned knowledge rule per question key (confirmation, self-confirmation, automatic completion, reader text, redaction). The highest version is in force. Changed only by migration.';

-- ---------------------------------------------------------------------------
-- Working list: which (venue, question) slots are in the knowledge pilot
-- ---------------------------------------------------------------------------

create table public.knowledge_working_list (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references public.profiles (id) on delete restrict,
  disabled_at timestamptz,
  disabled_by uuid references public.profiles (id) on delete restrict,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  constraint knowledge_working_list_disabled check (disabled_at is null or disabled_at >= enabled_at)
);

create unique index knowledge_working_list_open_idx
  on public.knowledge_working_list (venue_id, question_key) where disabled_at is null;

comment on table public.knowledge_working_list is
  'Slots in knowledge scope. A row is closed once (disabled_*) and never reopened; re-enabling inserts a new row.';

-- ---------------------------------------------------------------------------
-- Contributions (every finding sent through the knowledge path)
-- ---------------------------------------------------------------------------

create table public.knowledge_contributions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  check_id uuid not null,
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  contributed_by uuid not null references public.profiles (id) on delete restrict,
  contributor_basis text not null check (contributor_basis in ('staff', 'venue_manager', 'admin')),
  kind text not null check (kind in ('finding', 'change_report', 'detail')),
  answer text not null check (answer in ('yes', 'no', 'not_applicable', 'unknown')),
  finding text check (finding is null or (length(finding) between 1 and 2000 and finding = btrim(finding))),
  limitations text check (limitations is null or (length(limitations) between 1 and 2000 and limitations = btrim(limitations))),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  unknown_preset text check (unknown_preset is null or unknown_preset in ('no_one_sure', 'could_not_access', 'needs_access', 'other')),
  tried_text text check (tried_text is null or (length(tried_text) between 1 and 500 and tried_text = btrim(tried_text))),
  change_reason text check (change_reason is null or (length(change_reason) between 1 and 500 and change_reason = btrim(change_reason))),
  responds_to_decision_id uuid,
  based_on_slot_revision bigint not null check (based_on_slot_revision >= 0),
  based_on_submission_id uuid references public.amenity_submissions (id) on delete restrict,
  rule_version integer not null check (rule_version >= 1),
  template_version integer not null check (template_version >= 1),
  evidence_rule text not null check (evidence_rule in ('photo', 'video', 'either', 'both')),
  -- Wi-Fi test notes: the contributor, the venue's manager and admins only.
  internal_metadata jsonb check (internal_metadata is null or jsonb_typeof(internal_metadata) = 'object'),
  redaction_confirmed boolean,
  confirm_own boolean not null default false,
  initial_outcome text not null check (initial_outcome in ('current', 'awaiting_confirmation', 'recorded')),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint knowledge_contributions_idempotency_key unique (idempotency_key),
  constraint knowledge_contributions_id_venue_key unique (id, venue_id),
  constraint knowledge_contributions_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  constraint knowledge_contributions_unknown check (
    answer <> 'unknown' or (unknown_preset is not null and tried_text is not null)
  ),
  constraint knowledge_contributions_reason check (answer not in ('no', 'not_applicable') or reason is not null),
  constraint knowledge_contributions_change check (kind <> 'change_report' or change_reason is not null),
  constraint knowledge_contributions_detail check (kind <> 'detail' or responds_to_decision_id is not null),
  constraint knowledge_contributions_wifi check (internal_metadata is null or question_key = 'guest_wifi')
);

create index knowledge_contributions_check_idx on public.knowledge_contributions (check_id, created_at desc);
create index knowledge_contributions_author_idx on public.knowledge_contributions (contributed_by, created_at desc);

comment on table public.knowledge_contributions is
  'Append-only knowledge contributions: proposals, Couldn''t establish, change reports and detail. A contribution becomes an amenity_submissions row only when adopted.';

create table public.knowledge_contribution_assets (
  contribution_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('photo', 'video')),
  primary key (contribution_id, asset_id),
  constraint knowledge_contribution_assets_contribution_fkey foreign key (contribution_id, venue_id)
    references public.knowledge_contributions (id, venue_id) on delete restrict,
  -- Evidence venue = the asset's immutable upload-time venue.
  constraint knowledge_contribution_assets_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index knowledge_contribution_assets_asset_idx on public.knowledge_contribution_assets (asset_id);

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------

create table public.knowledge_decisions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  check_id uuid not null,
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  contribution_id uuid references public.knowledge_contributions (id) on delete restrict,
  submission_id uuid references public.amenity_submissions (id) on delete restrict,
  decision text not null check (decision in (
    'adopted', 'confirmed', 'declined', 'revoked', 'detail_requested', 'seen', 'replaced', 'reaffirmed'
  )),
  -- NULL for a rule (automatic adoption).
  decided_by uuid references public.profiles (id) on delete restrict,
  decider_basis text not null check (decider_basis in ('venue_manager', 'admin', 'self', 'rule')),
  self_confirmed boolean not null default false,
  rule_version integer check (rule_version is null or rule_version >= 1),
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  slot_revision bigint check (slot_revision is null or slot_revision >= 0),
  resulting_submission_id uuid references public.amenity_submissions (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint knowledge_decisions_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  constraint knowledge_decisions_target check (num_nonnulls(contribution_id, submission_id) = 1),
  -- A confirmation is always a person with authority over the venue; the
  -- reader exposes its basis, so 'self' and 'rule' can never appear here.
  constraint knowledge_decisions_confirmed_basis check (
    decision <> 'confirmed' or (decider_basis in ('venue_manager', 'admin') and decided_by is not null)
  )
);

create index knowledge_decisions_contribution_idx on public.knowledge_decisions (contribution_id, created_at)
  where contribution_id is not null;
create index knowledge_decisions_submission_idx on public.knowledge_decisions (submission_id, created_at)
  where submission_id is not null;

alter table public.knowledge_contributions
  add constraint knowledge_contributions_responds_to_fkey foreign key (responds_to_decision_id)
    references public.knowledge_decisions (id) on delete restrict;

comment on table public.knowledge_decisions is
  'Append-only decisions about a contribution or a submission. Adopted, declined, replaced and seen are terminal for a contribution.';

-- ---------------------------------------------------------------------------
-- Commands (idempotency: one result per key)
-- ---------------------------------------------------------------------------

create table public.knowledge_commands (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  command text not null check (command in ('submit', 'decide', 'resolve_conflict')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_key text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.knowledge_commands is
  'Append-only record of each knowledge command and its first result, replayed for the same key, actor, command and request hash.';

-- ---------------------------------------------------------------------------
-- Events (knowledge history and the event part of the slot revision)
-- ---------------------------------------------------------------------------

create table public.knowledge_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  check_id uuid,
  kind text not null check (kind in (
    'contribution_recorded', 'decision_recorded', 'working_list_enabled', 'working_list_disabled',
    'rule_version_added', 'question_version_changed', 'evidence_withdrawn', 'assignment_closed_by_other'
  )),
  actor_id uuid references public.profiles (id) on delete restrict,
  contribution_id uuid,
  submission_id uuid,
  decision_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

create index knowledge_events_slot_idx on public.knowledge_events (venue_id, question_key, id);

comment on table public.knowledge_events is
  'Append-only knowledge history. Slot revision = check revision (or 0) + count of these rows for (venue_id, question_key).';

-- ---------------------------------------------------------------------------
-- Drafts and dismissals (mutable UI state; never history, never credited)
-- ---------------------------------------------------------------------------

create table public.knowledge_drafts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  check_id uuid not null,
  venue_id uuid not null,
  draft_revision integer not null check (draft_revision >= 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  asset_ids uuid[] not null default '{}' check (cardinality(asset_ids) <= 10),
  idempotency_key uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, check_id),
  constraint knowledge_drafts_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict
);

create table public.knowledge_outcome_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id bigint not null references public.knowledge_events (id) on delete restrict,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- ---------------------------------------------------------------------------
-- amenity_submissions: three nullable columns, filled only by new rows
-- ---------------------------------------------------------------------------

alter table public.amenity_submissions
  add column source_contribution_id uuid
    constraint amenity_submissions_source_contribution_key unique
    references public.knowledge_contributions (id) on delete restrict,
  add column redaction_confirmed boolean,
  add column submitter_basis text
    constraint amenity_submissions_submitter_basis_check
    check (submitter_basis is null or submitter_basis in ('staff', 'venue_manager', 'admin'));

comment on column public.amenity_submissions.redaction_confirmed is
  'The Wi-Fi redaction tick as submitted. NULL for rows saved before it was stored: no redaction proof.';
comment on column public.amenity_submissions.submitter_basis is
  'How the submitter acted (staff, venue_manager, admin). NULL for rows saved before it was stored.';
comment on column public.amenity_submissions.source_contribution_id is
  'The knowledge contribution this submission was adopted from; NULL for direct submissions.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'knowledge_question_rules', 'knowledge_contributions', 'knowledge_contribution_assets',
    'knowledge_decisions', 'knowledge_commands', 'knowledge_events'
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

-- A working-list row is closed once and otherwise never changes.
create function private.knowledge_working_list_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'knowledge_working_list_append_only' using errcode = '42501';
  end if;
  if old.disabled_at is not null
     or new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.question_key is distinct from old.question_key
     or new.enabled_at is distinct from old.enabled_at
     or new.enabled_by is distinct from old.enabled_by
     or new.reason is distinct from old.reason
     or new.disabled_at is null then
    raise exception 'knowledge_working_list_append_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger knowledge_working_list_guard
  before update or delete on public.knowledge_working_list
  for each row execute function private.knowledge_working_list_guard();
create trigger knowledge_working_list_no_truncate
  before truncate on public.knowledge_working_list
  for each statement execute function private.append_only_guard();

revoke all on function private.knowledge_working_list_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: no direct client access; SECURITY DEFINER functions only
-- ---------------------------------------------------------------------------

revoke all on
  public.knowledge_question_rules, public.knowledge_working_list, public.knowledge_contributions,
  public.knowledge_contribution_assets, public.knowledge_decisions, public.knowledge_commands,
  public.knowledge_events, public.knowledge_drafts, public.knowledge_outcome_dismissals
from public, anon, authenticated, service_role;

grant select on
  public.knowledge_question_rules, public.knowledge_working_list, public.knowledge_contributions,
  public.knowledge_contribution_assets, public.knowledge_decisions, public.knowledge_commands,
  public.knowledge_events, public.knowledge_drafts, public.knowledge_outcome_dismissals
to service_role;

alter table public.knowledge_question_rules enable row level security;
alter table public.knowledge_working_list enable row level security;
alter table public.knowledge_contributions enable row level security;
alter table public.knowledge_contribution_assets enable row level security;
alter table public.knowledge_decisions enable row level security;
alter table public.knowledge_commands enable row level security;
alter table public.knowledge_events enable row level security;
alter table public.knowledge_drafts enable row level security;
alter table public.knowledge_outcome_dismissals enable row level security;

-- ---------------------------------------------------------------------------
-- Definition changes write one event per in-scope slot (§2.3, G3)
-- ---------------------------------------------------------------------------

-- Every migration that inserts a rule version, and every catalogue-version
-- migration (scripts/db/amenity-catalogue-sql.ts), calls this in the same
-- transaction so the slot revision of every in-scope slot of the key rises.
create function private.knowledge_note_definition_change(p_question_key text, p_kind text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind not in ('rule_version_added', 'question_version_changed') then
    raise exception 'invalid_definition_change' using errcode = '22023';
  end if;
  insert into public.knowledge_events (venue_id, question_key, check_id, kind, detail)
  select w.venue_id, w.question_key, c.id, p_kind, jsonb_build_object('questionKey', p_question_key)
  from public.knowledge_working_list w
  left join public.venue_amenity_checks c on c.venue_id = w.venue_id and c.template_key = w.question_key
  where w.question_key = p_question_key and w.disabled_at is null
  order by w.venue_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.knowledge_note_definition_change(text, text) from public, anon, authenticated;
grant execute on function private.knowledge_note_definition_change(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Rule seed (B00-04 defaults, owner to confirm; docs/knowledge/access-and-rights.md §6)
-- ---------------------------------------------------------------------------

insert into public.knowledge_question_rules
  (question_key, rule_version, confirmation, self_confirmation_allowed, unassigned_auto_complete,
   staff_text_internal, redaction_required)
values
  ('onsite_parking', 1, 'none', false, true, true, false),
  ('step_free_entrance', 1, 'venue_manager', true, false, true, false),
  ('guest_toilets', 1, 'none', false, true, true, false),
  ('guest_wifi', 1, 'none', false, true, false, true),
  ('dogs_inside', 1, 'venue_manager', true, false, true, false),
  ('dogs_outside', 1, 'venue_manager', true, false, true, false),
  ('sports_screen', 1, 'none', false, true, true, false)
on conflict (question_key, rule_version) do nothing;

select private.knowledge_note_definition_change(k, 'rule_version_added')
from unnest(array[
  'onsite_parking', 'step_free_entrance', 'guest_toilets', 'guest_wifi',
  'dogs_inside', 'dogs_outside', 'sports_screen'
]) as k;
