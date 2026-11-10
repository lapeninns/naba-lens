-- B03-f: reconciliation of legacy facts and external sources
-- (docs/knowledge/b03-design.md §8, §12 batch B03-f, §14 A12, A13, A23).
--
-- * Admin only: external sources (declare, retire, list), imported source
--   assertions (append-only, a revision imported once), reviewed legacy
--   mappings (append-only; the latest review for a fact revision and key is
--   in force), and runs: public.knowledge_reconcile(p_kind, p_mode,
--   p_venue_id) with dry_run and apply. apply needs a dry run for the same
--   scope within 24 hours whose source revisions still match, else
--   reconcile_source_changed (NLK12); it is idempotent per source row,
--   revision and key.
-- * Nothing becomes current by itself (§8.2): a proposal is a B01
--   contribution awaiting confirmation (never adopted at import), sent by the
--   admin who ran the apply. Its origin is public.knowledge_contribution_sources
--   (legacy_fact or external_source); contributor_basis stays 'admin', so
--   neither knowledge_contributions nor amenity_submissions (T11a) changes.
--   An import is confirmed only onto an empty slot (no stored current
--   submission): knowledge_decide and knowledge_resolve_conflict refuse
--   otherwise with import_slot_has_answer (NLK14). One that agrees with the
--   answer in use is recorded as seen; one that disagrees stays undecided
--   and the slot reads disputed (B01).
-- * Legacy facts: unknown maps to nothing; present / absent only through an
--   exact mapping; facts and policy text become the proposal's limitations;
--   the fact's ready photos and videos are attached as its evidence.
--   public.knowledge_legacy_narrative (manager or admin) returns every legacy
--   fact as narrative.
-- * Re-created: knowledge_decide and knowledge_resolve_conflict (B03-e
--   bodies), knowledge_check (B03-e) and knowledge_to_confirm (B03-c) with
--   source and, for imports, adoptable; manager_triage_summary (B03-e) with
--   a suggestions row, the findings row no longer counting imports.
-- * Inert: no source is declared, no mapping is reviewed and no run exists
--   (OD-17, OD-19). Not touched: the credit trigger, the evidence-withdrawn
--   trigger, the credit functions, the resolver, knowledge_adopt.
--
-- Rollback: a forward migration restores the earlier bodies; the tables stay.

-- ---------------------------------------------------------------------------
-- Tables (§8.1)
-- ---------------------------------------------------------------------------

create table public.knowledge_external_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('venue_website', 'google_business_profile', 'booking_site', 'operator_document', 'other')),
  label text not null check (length(label) between 1 and 80 and label = btrim(label)),
  venue_id uuid references public.venues (id) on delete restrict,
  declared_by uuid not null references public.profiles (id) on delete restrict,
  declared_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  retire_reason text check (retire_reason is null or length(retire_reason) between 1 and 500),
  constraint knowledge_external_sources_retired check ((retired_at is null) = (retired_by is null))
);

create function private.knowledge_external_sources_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.retired_at is not null or new.retired_at is null
     or (to_jsonb(new) - array['retired_at', 'retired_by', 'retire_reason'])
        is distinct from (to_jsonb(old) - array['retired_at', 'retired_by', 'retire_reason']) then
    raise exception 'knowledge_source_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger knowledge_external_sources_guard
  before update or delete on public.knowledge_external_sources
  for each row execute function private.knowledge_external_sources_guard();

create table public.knowledge_source_assertions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_external_sources (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  headline text not null check (headline in ('yes', 'no', 'not_applicable', 'unknown')),
  detail jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  excerpt text check (excerpt is null or (length(excerpt) between 1 and 2000 and excerpt = btrim(excerpt))),
  retrieved_at timestamptz not null,
  source_revision text not null check (length(source_revision) between 1 and 200),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint knowledge_source_assertions_once unique (source_id, source_revision, venue_id, question_key)
);

create table public.knowledge_legacy_mappings (
  id uuid primary key default gen_random_uuid(),
  legacy_fact_id uuid not null references public.venue_amenity_facts (id) on delete restrict,
  legacy_revision integer not null check (legacy_revision >= 1),
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  mapping_kind text not null check (mapping_kind in ('exact', 'candidate', 'none')),
  reason text not null check (length(reason) between 1 and 500 and reason = btrim(reason)),
  reviewed_by uuid not null references public.profiles (id) on delete restrict,
  reviewed_at timestamptz not null default now()
);

-- The latest review for (fact, revision, key) is in force (A13).
create index knowledge_legacy_mappings_review
  on public.knowledge_legacy_mappings (legacy_fact_id, legacy_revision, question_key, reviewed_at desc, id desc);

create table public.knowledge_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('legacy', 'external')),
  mode text not null check (mode in ('dry_run', 'apply')),
  venue_id uuid references public.venues (id) on delete restrict,
  dry_run_id uuid references public.knowledge_reconciliation_runs (id) on delete restrict,
  started_by uuid not null references public.profiles (id) on delete restrict,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  would_create jsonb not null default '[]'::jsonb check (jsonb_typeof(would_create) = 'array'),
  conflicts jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array'),
  source_revisions jsonb not null check (jsonb_typeof(source_revisions) = 'object'),
  constraint knowledge_reconciliation_runs_apply check ((mode = 'apply') = (dry_run_id is not null))
);

create index knowledge_reconciliation_runs_recent on public.knowledge_reconciliation_runs (started_at desc, id desc);

create table public.knowledge_contribution_sources (
  contribution_id uuid primary key references public.knowledge_contributions (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_key text not null,
  source_kind text not null check (source_kind in ('legacy_fact', 'external_source')),
  source_label text not null check (length(source_label) between 1 and 80),
  legacy_fact_id uuid references public.venue_amenity_facts (id) on delete restrict,
  legacy_revision integer,
  assertion_id uuid references public.knowledge_source_assertions (id) on delete restrict,
  run_id uuid not null references public.knowledge_reconciliation_runs (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint knowledge_contribution_sources_ref check (
    (source_kind = 'legacy_fact' and legacy_fact_id is not null and legacy_revision is not null and assertion_id is null)
    or (source_kind = 'external_source' and assertion_id is not null and legacy_fact_id is null))
);

-- Idempotent apply: one proposal per legacy fact revision and key, and per assertion.
create unique index knowledge_contribution_sources_legacy
  on public.knowledge_contribution_sources (legacy_fact_id, legacy_revision, question_key)
  where legacy_fact_id is not null;
create unique index knowledge_contribution_sources_assertion
  on public.knowledge_contribution_sources (assertion_id) where assertion_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['knowledge_source_assertions', 'knowledge_legacy_mappings',
    'knowledge_reconciliation_runs', 'knowledge_contribution_sources'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
  end loop;
  foreach t in array array['knowledge_external_sources', 'knowledge_source_assertions', 'knowledge_legacy_mappings',
    'knowledge_reconciliation_runs', 'knowledge_contribution_sources'] loop
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

revoke all on public.knowledge_external_sources, public.knowledge_source_assertions, public.knowledge_legacy_mappings,
  public.knowledge_reconciliation_runs, public.knowledge_contribution_sources
from public, anon, authenticated, service_role;
grant select on public.knowledge_external_sources, public.knowledge_source_assertions, public.knowledge_legacy_mappings,
  public.knowledge_reconciliation_runs, public.knowledge_contribution_sources
to service_role;
alter table public.knowledge_external_sources enable row level security;
alter table public.knowledge_source_assertions enable row level security;
alter table public.knowledge_legacy_mappings enable row level security;
alter table public.knowledge_reconciliation_runs enable row level security;
alter table public.knowledge_contribution_sources enable row level security;

-- An organisation-wide source has no venue.
alter table public.knowledge_write_commands alter column venue_id drop not null;
alter table public.knowledge_write_commands drop constraint knowledge_write_commands_command_check;
alter table public.knowledge_write_commands add constraint knowledge_write_commands_command_check
  check (command in ('place_add', 'place_retire', 'schedule_exception', 'source_declare', 'source_retire',
    'source_import', 'mapping_review'));

-- ---------------------------------------------------------------------------
-- Admin commands (A13)
-- ---------------------------------------------------------------------------

create function private.knowledge_assert_admin()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
begin
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.knowledge_source_declare(p_kind text, p_label text, p_venue_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_assert_admin();
  v_label text := private.clean_text(p_label, 80, 'invalid_label');
  v_hash text := private.knowledge_hash(jsonb_build_object('kind', p_kind, 'label', v_label, 'venueId', p_venue_id));
  v_prior jsonb;
  v_id uuid;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'source_declare', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_kind is null or p_kind not in ('venue_website', 'google_business_profile', 'booking_site', 'operator_document', 'other') then
    raise exception 'invalid_source_kind' using errcode = '22023';
  end if;
  if v_label is null then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  insert into public.knowledge_external_sources (kind, label, venue_id, declared_by)
  values (p_kind, v_label, p_venue_id, v_uid)
  returning id into v_id;
  v_result := jsonb_build_object('sourceId', v_id, 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'source_declare', v_hash, p_venue_id, v_result);
  return v_result;
end;
$$;

create function public.knowledge_source_retire(p_source_id uuid, p_reason text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_assert_admin();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_hash text := private.knowledge_hash(jsonb_build_object('sourceId', p_source_id, 'reason', v_reason));
  v_prior jsonb;
  v_source public.knowledge_external_sources;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'source_retire', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select s.* into v_source from public.knowledge_external_sources s where s.id = p_source_id for update;
  if not found then
    raise exception 'knowledge_source_not_found' using errcode = 'P0002';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_source.retired_at is null then
    update public.knowledge_external_sources s
    set retired_at = now(), retired_by = v_uid, retire_reason = v_reason
    where s.id = v_source.id;
  end if;
  v_result := jsonb_build_object('sourceId', v_source.id, 'retired', true, 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'source_retire', v_hash, v_source.venue_id, v_result);
  return v_result;
end;
$$;

-- Records what a source said at one revision: [{ venueId, questionKey,
-- headline, detail?, excerpt? }], at most 500, each validated as a finding
-- under the key's latest version. A revision already imported is a no-op.
create function public.knowledge_source_import(
  p_source_id uuid, p_source_revision text, p_retrieved_at timestamptz, p_assertions jsonb, p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_assert_admin();
  v_hash text := private.knowledge_hash(jsonb_build_object('sourceId', p_source_id, 'revision', p_source_revision,
    'retrievedAt', p_retrieved_at, 'assertions', p_assertions));
  v_prior jsonb;
  v_source public.knowledge_external_sources;
  v_fields jsonb := '[]'::jsonb;
  v_i integer;
  v_a jsonb;
  v_version public.knowledge_question_versions;
  v_message text;
  v_error text;
  v_count integer := 0;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'source_import', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select s.* into v_source from public.knowledge_external_sources s where s.id = p_source_id;
  if not found or v_source.retired_at is not null then
    raise exception 'knowledge_source_not_found' using errcode = 'P0002';
  end if;
  if p_source_revision is null or length(p_source_revision) not between 1 and 200 then
    v_fields := v_fields || jsonb_build_object('path', 'sourceRevision', 'problem', 'invalid');
  end if;
  if p_retrieved_at is null or p_retrieved_at > now() then
    v_fields := v_fields || jsonb_build_object('path', 'retrievedAt', 'problem', 'invalid');
  end if;
  if jsonb_typeof(p_assertions) is distinct from 'array' or jsonb_array_length(p_assertions) not between 1 and 500 then
    v_fields := v_fields || jsonb_build_object('path', 'assertions', 'problem', 'invalid');
  else
    for v_i in 0 .. jsonb_array_length(p_assertions) - 1 loop
      v_a := p_assertions -> v_i;
      if jsonb_typeof(v_a) <> 'object'
         or (select count(*) from jsonb_object_keys(v_a) k
             where k not in ('venueId', 'questionKey', 'headline', 'detail', 'excerpt')) > 0
         or v_a ->> 'venueId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (select 1 from public.venues v where v.id::text = v_a ->> 'venueId')
         or (v_source.venue_id is not null and v_source.venue_id::text <> v_a ->> 'venueId')
         or (v_a ? 'excerpt' and (jsonb_typeof(v_a -> 'excerpt') <> 'string'
             or length(btrim(v_a ->> 'excerpt')) not between 1 and 2000)) then
        v_fields := v_fields || jsonb_build_object('path', format('assertions[%s]', v_i), 'problem', 'invalid');
        continue;
      end if;
      select v.* into v_version from public.knowledge_question_versions v
      where v.key = v_a ->> 'questionKey' order by v.version desc limit 1;
      if not found then
        v_fields := v_fields || jsonb_build_object('path', format('assertions[%s].questionKey', v_i), 'problem', 'invalid');
        continue;
      end if;
      begin
        perform private.knowledge_validate_value(v_version.value_schema, v_version.value_schema_version,
          v_a ->> 'headline', case when v_version.value_schema = 'connectivity.wifi' then null else v_a -> 'detail' end);
        if v_version.value_schema = 'connectivity.wifi' and v_a ? 'detail' then
          v_fields := v_fields || jsonb_build_object('path', format('assertions[%s].detail', v_i), 'problem', 'not_allowed');
        end if;
      exception when others then
        get stacked diagnostics v_message = message_text, v_error = pg_exception_detail;
        if v_message <> 'invalid_value' then
          raise;
        end if;
        v_fields := v_fields || (select coalesce(jsonb_agg(jsonb_build_object(
            'path', format('assertions[%s].%s', v_i, f ->> 'path'), 'problem', f ->> 'problem')), '[]'::jsonb)
          from jsonb_array_elements(v_error::jsonb -> 'fields') f);
      end;
    end loop;
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023', detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  if not exists (select 1 from public.knowledge_source_assertions a
                 where a.source_id = v_source.id and a.source_revision = p_source_revision) then
    insert into public.knowledge_source_assertions (source_id, venue_id, question_key, headline, detail, excerpt,
      retrieved_at, source_revision, created_by)
    select v_source.id, (a ->> 'venueId')::uuid, a ->> 'questionKey', a ->> 'headline',
      case when jsonb_typeof(a -> 'detail') = 'object' and a -> 'detail' <> '{}'::jsonb then a -> 'detail' end,
      nullif(btrim(a ->> 'excerpt'), ''), p_retrieved_at, p_source_revision, v_uid
    from jsonb_array_elements(p_assertions) a
    on conflict on constraint knowledge_source_assertions_once do nothing;
    get diagnostics v_count = row_count;
  end if;
  v_result := jsonb_build_object('sourceId', v_source.id, 'imported', v_count, 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'source_import', v_hash, v_source.venue_id, v_result);
  return v_result;
end;
$$;

-- A reviewed mapping for a legacy fact's current revision (append-only; the
-- latest review is in force).
create function public.knowledge_mapping_review(
  p_legacy_fact_id uuid, p_legacy_revision integer, p_question_key text, p_kind text, p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_assert_admin();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_hash text := private.knowledge_hash(jsonb_build_object('factId', p_legacy_fact_id, 'revision', p_legacy_revision,
    'key', p_question_key, 'kind', p_kind, 'reason', v_reason));
  v_prior jsonb;
  v_fact public.venue_amenity_facts;
  v_id uuid;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'mapping_review', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select f.* into v_fact from public.venue_amenity_facts f where f.id = p_legacy_fact_id;
  if not found then
    raise exception 'legacy_fact_not_found' using errcode = 'P0002';
  end if;
  if p_legacy_revision is distinct from v_fact.revision then
    raise exception 'reconcile_source_changed' using errcode = 'NLK12',
      detail = jsonb_build_object('changed', jsonb_build_array(jsonb_build_object('legacyFactId', v_fact.id,
        'revision', v_fact.revision)))::text;
  end if;
  if p_kind is null or p_kind not in ('exact', 'candidate', 'none') then
    raise exception 'invalid_mapping_kind' using errcode = '22023';
  end if;
  if not exists (select 1 from public.amenity_catalogue t where t.key = p_question_key) then
    raise exception 'knowledge_question_not_found' using errcode = 'P0002';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  insert into public.knowledge_legacy_mappings (legacy_fact_id, legacy_revision, question_key, mapping_kind, reason, reviewed_by)
  values (v_fact.id, v_fact.revision, p_question_key, p_kind, v_reason, v_uid)
  returning id into v_id;
  v_result := jsonb_build_object('mappingId', v_id, 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'mapping_review', v_hash, v_fact.venue_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation (§8.2, §8.3)
-- ---------------------------------------------------------------------------

-- Every candidate proposal in scope, with what applying it would do:
-- proposal (empty slot), corroborates (agrees with the answer in use),
-- conflicts (disagrees), already (proposed before) or skipped (no active
-- check). source_revisions are the revisions read.
create function private.knowledge_reconcile_candidates(p_kind text, p_venue_id uuid)
returns table (
  venue_id uuid, check_id uuid, question_key text, answer text, limitations text, label text,
  legacy_fact_id uuid, legacy_revision integer, assertion_id uuid, detail jsonb, state text, source_ref text
)
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select f.venue_id, m.question_key, case f.presence when 'present' then 'yes' else 'no' end as answer,
      nullif(btrim(left(concat_ws(E'\n', f.facts, f.policy), 2000)), '') as limitations,
      'Coverage (legacy record)'::text as label,
      f.id as legacy_fact_id, f.revision as legacy_revision, null::uuid as assertion_id, null::jsonb as detail,
      f.id::text as source_ref
    from public.venue_amenity_facts f
    cross join lateral (
      select distinct on (lm.question_key) lm.question_key, lm.mapping_kind
      from public.knowledge_legacy_mappings lm
      where lm.legacy_fact_id = f.id and lm.legacy_revision = f.revision
      order by lm.question_key, lm.reviewed_at desc, lm.id desc
    ) m
    where p_kind = 'legacy' and m.mapping_kind = 'exact' and f.presence in ('present', 'absent')
      and (p_venue_id is null or f.venue_id = p_venue_id)
  ),
  external as (
    select a.venue_id, a.question_key, a.headline, a.excerpt, s.label, null::uuid, null::integer, a.id, a.detail,
      s.id::text
    from public.knowledge_source_assertions a
    join public.knowledge_external_sources s on s.id = a.source_id and s.retired_at is null
    where p_kind = 'external' and a.headline in ('yes', 'no', 'not_applicable')
      and (p_venue_id is null or a.venue_id = p_venue_id)
      and a.id = (
        select x.id from public.knowledge_source_assertions x
        where x.source_id = a.source_id and x.venue_id = a.venue_id and x.question_key = a.question_key
        order by x.retrieved_at desc, x.created_at desc, x.id desc limit 1)
  ),
  candidates as (
    select * from legacy
    union all
    select * from external
  )
  select k.venue_id, c.id, k.question_key, k.answer, k.limitations, k.label, k.legacy_fact_id, k.legacy_revision,
    k.assertion_id, k.detail,
    case
      when exists (select 1 from public.knowledge_contribution_sources ks
        where (k.legacy_fact_id is not null and ks.legacy_fact_id = k.legacy_fact_id
               and ks.legacy_revision = k.legacy_revision and ks.question_key = k.question_key)
           or (k.assertion_id is not null and ks.assertion_id = k.assertion_id)) then 'already'
      when c.id is null or c.status <> 'active' then 'skipped'
      when c.current_submission_id is null then 'proposal'
      when s.answer = k.answer then 'corroborates'
      else 'conflicts'
    end,
    k.source_ref
  from candidates k
  left join public.venue_amenity_checks c on c.venue_id = k.venue_id and c.template_key = k.question_key
  left join public.amenity_submissions s on s.id = c.current_submission_id;
$$;

create function private.knowledge_reconcile_revisions(p_kind text, p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'legacy' then coalesce((
      select jsonb_object_agg(f.id::text, f.revision order by f.id)
      from public.venue_amenity_facts f
      where (p_venue_id is null or f.venue_id = p_venue_id)
        and exists (select 1 from public.knowledge_legacy_mappings lm where lm.legacy_fact_id = f.id)
    ), '{}'::jsonb)
    else coalesce((
      select jsonb_object_agg(s.id::text, (
        select x.source_revision from public.knowledge_source_assertions x
        where x.source_id = s.id order by x.retrieved_at desc, x.created_at desc, x.id desc limit 1) order by s.id)
      from public.knowledge_external_sources s
      where s.retired_at is null and (p_venue_id is null or s.venue_id is null or s.venue_id = p_venue_id)
    ), '{}'::jsonb)
  end;
$$;

-- Admin: dry_run records what apply would create; apply needs a matching dry
-- run from the last 24 hours and creates each proposal once.
create function public.knowledge_reconcile(p_kind text, p_mode text, p_venue_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_assert_admin();
  v_revisions jsonb;
  v_dry public.knowledge_reconciliation_runs;
  v_changed jsonb;
  v_counts jsonb;
  v_would jsonb;
  v_conflicts jsonb;
  v_run uuid;
  v_c record;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_contribution uuid;
  v_created integer := 0;
begin
  if p_kind is null or p_kind not in ('legacy', 'external') or p_mode is null or p_mode not in ('dry_run', 'apply') then
    raise exception 'invalid_value' using errcode = '22023', detail = jsonb_build_object('fields', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('path', 'kind', 'problem', 'invalid') x where p_kind is null or p_kind not in ('legacy', 'external')
        union all
        select jsonb_build_object('path', 'mode', 'problem', 'invalid') where p_mode is null or p_mode not in ('dry_run', 'apply')
      ) z))::text;
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  -- One run at a time per kind and scope.
  perform pg_advisory_xact_lock(hashtextextended('nabalens_knowledge_reconcile:' || p_kind || ':' || coalesce(p_venue_id::text, '*'), 0));
  v_revisions := private.knowledge_reconcile_revisions(p_kind, p_venue_id);

  select jsonb_build_object(
      'candidates', count(*),
      'proposals', count(*) filter (where c.state = 'proposal'),
      'corroborating', count(*) filter (where c.state = 'corroborates'),
      'conflicting', count(*) filter (where c.state = 'conflicts'),
      'alreadyApplied', count(*) filter (where c.state = 'already'),
      'skipped', count(*) filter (where c.state = 'skipped')),
    coalesce(jsonb_agg(jsonb_build_object('venueId', c.venue_id, 'questionKey', c.question_key, 'answer', c.answer,
        'state', c.state, 'source', c.label, 'legacyFactId', c.legacy_fact_id, 'legacyRevision', c.legacy_revision,
        'assertionId', c.assertion_id) order by c.venue_id, c.question_key, c.source_ref)
      filter (where c.state in ('proposal', 'corroborates', 'conflicts')), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('venueId', c.venue_id, 'questionKey', c.question_key, 'answer', c.answer,
        'source', c.label) order by c.venue_id, c.question_key, c.source_ref)
      filter (where c.state = 'conflicts'), '[]'::jsonb)
  into v_counts, v_would, v_conflicts
  from private.knowledge_reconcile_candidates(p_kind, p_venue_id) c;

  if p_mode = 'dry_run' then
    insert into public.knowledge_reconciliation_runs (kind, mode, venue_id, started_by, counts, would_create,
      conflicts, source_revisions)
    values (p_kind, 'dry_run', p_venue_id, v_uid, v_counts, v_would, v_conflicts, v_revisions)
    returning id into v_run;
    return jsonb_build_object('runId', v_run, 'mode', 'dry_run', 'counts', v_counts, 'wouldCreate', v_would,
      'conflicts', v_conflicts, 'sourceRevisions', v_revisions);
  end if;

  select r.* into v_dry from public.knowledge_reconciliation_runs r
  where r.kind = p_kind and r.mode = 'dry_run' and r.venue_id is not distinct from p_venue_id
    and r.started_at > now() - interval '24 hours'
  order by r.started_at desc, r.id desc limit 1;
  if v_dry.id is null then
    raise exception 'reconcile_dry_run_required' using errcode = 'NLK12';
  end if;
  if v_dry.source_revisions is distinct from v_revisions then
    v_changed := (
      select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
      from (select jsonb_object_keys(v_dry.source_revisions) k
            union select jsonb_object_keys(v_revisions)) keys
      where v_dry.source_revisions -> k is distinct from v_revisions -> k);
    raise exception 'reconcile_source_changed' using errcode = 'NLK12',
      detail = jsonb_build_object('changed', v_changed)::text;
  end if;

  insert into public.knowledge_reconciliation_runs (kind, mode, venue_id, dry_run_id, started_by, counts,
    would_create, conflicts, source_revisions)
  values (p_kind, 'apply', p_venue_id, v_dry.id, v_uid, v_counts, v_would, v_conflicts, v_revisions)
  returning id into v_run;

  for v_c in
    select c.* from private.knowledge_reconcile_candidates(p_kind, p_venue_id) c
    where c.state in ('proposal', 'corroborates', 'conflicts')
    order by c.venue_id, c.question_key, c.source_ref
  loop
    select ch.* into v_check from public.venue_amenity_checks ch where ch.id = v_c.check_id for update;
    v_rule := private.knowledge_rule(v_check.template_key);
    insert into public.knowledge_contributions (
      venue_id, check_id, question_key, contributed_by, contributor_basis, kind, answer, limitations, reason,
      based_on_slot_revision, based_on_submission_id, rule_version, template_version, evidence_rule,
      confirm_own, initial_outcome, idempotency_key, request_hash
    )
    select v_check.venue_id, v_check.id, v_check.template_key, v_uid, 'admin', 'finding', v_c.answer,
      v_c.limitations,
      case when v_c.answer in ('no', 'not_applicable') then left('Imported from ' || v_c.label, 500) end,
      private.knowledge_slot_revision(v_check.venue_id, v_check.template_key), v_check.current_submission_id,
      coalesce(v_rule.rule_version, 1), t.catalogue_version, t.evidence_rule, false, 'awaiting_confirmation',
      gen_random_uuid(),
      encode(sha256(convert_to(concat_ws(':', p_kind, v_c.source_ref, v_c.legacy_revision, v_c.assertion_id,
        v_c.question_key), 'UTF8')), 'hex')
    from public.amenity_catalogue t where t.key = v_check.template_key
    returning id into v_contribution;
    insert into public.knowledge_contribution_sources (contribution_id, venue_id, question_key, source_kind,
      source_label, legacy_fact_id, legacy_revision, assertion_id, run_id)
    values (v_contribution, v_check.venue_id, v_check.template_key,
      case when p_kind = 'legacy' then 'legacy_fact' else 'external_source' end, v_c.label,
      v_c.legacy_fact_id, v_c.legacy_revision, v_c.assertion_id, v_run);
    -- A legacy fact's own ready photos and videos are its evidence.
    if v_c.legacy_fact_id is not null then
      insert into public.knowledge_contribution_assets (contribution_id, venue_id, asset_id, evidence_kind)
      select v_contribution, v_check.venue_id, fm.asset_id, case a.media_type when 'video' then 'video' else 'photo' end
      from public.venue_amenity_fact_media fm
      join public.media_assets a on a.id = fm.asset_id and a.deleted_at is null and a.upload_state = 'ready'
      where fm.fact_id = v_c.legacy_fact_id;
    end if;
    if v_c.detail is not null then
      insert into public.knowledge_contribution_details (contribution_id, venue_id, question_version, value_schema,
        value_schema_version, detail, request_hash)
      select v_contribution, v_check.venue_id, v.version, v.value_schema, v.value_schema_version, v_c.detail,
        encode(sha256(convert_to(v_contribution::text, 'UTF8')), 'hex')
      from public.knowledge_question_versions v where v.key = v_check.template_key order by v.version desc limit 1;
    end if;
    perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id, 'contribution_recorded',
      v_contribution, null, null, jsonb_build_object('source', case when p_kind = 'legacy' then 'legacy_fact'
        else 'external_source' end, 'runId', v_run));
    -- Corroboration of the answer in use, never a confirmation (§8.2).
    if v_c.state = 'corroborates' then
      perform private.knowledge_decision(v_check, v_contribution, null, 'seen', v_uid, 'admin', false,
        v_rule.rule_version, 'Imported: agrees with the answer in use', null, null);
    end if;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('runId', v_run, 'mode', 'apply', 'dryRunId', v_dry.id, 'counts', v_counts,
    'created', v_created, 'conflicts', v_conflicts, 'sourceRevisions', v_revisions);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (A13; §8.2 L5)
-- ---------------------------------------------------------------------------

create function public.knowledge_sources(p_include_retired boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('sourceId', s.id, 'kind', s.kind, 'label', s.label, 'venueId', s.venue_id,
        'declaredAt', s.declared_at, 'declaredBy', p.display_name, 'retiredAt', s.retired_at,
        'latestRevision', (select x.source_revision from public.knowledge_source_assertions x
          where x.source_id = s.id order by x.retrieved_at desc, x.created_at desc, x.id desc limit 1))
      order by s.declared_at desc, s.id)
    from public.knowledge_external_sources s
    join public.profiles p on p.id = s.declared_by
    where coalesce(p_include_retired, false) or s.retired_at is null
  ), '[]'::jsonb));
end;
$$;

-- Admin: legacy facts (a venue, or all) with the reviews in force for their
-- current revision, 50 a page by fact id.
create function public.knowledge_legacy_mappings(p_venue_id uuid default null, p_cursor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_next uuid;
begin
  perform private.amenity_assert_active_user();
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  with page as (
    select f.* from public.venue_amenity_facts f
    where (p_venue_id is null or f.venue_id = p_venue_id) and (p_cursor is null or f.id > p_cursor)
    order by f.id limit 51
  )
  select coalesce(jsonb_agg(jsonb_build_object('legacyFactId', f.id, 'legacyRevision', f.revision,
      'legacyKey', f.amenity_key, 'venueId', f.venue_id, 'presence', f.presence,
      'mappings', coalesce((
        select jsonb_agg(jsonb_build_object('questionKey', m.question_key, 'kind', m.mapping_kind, 'reason', m.reason,
            'reviewedBy', p.display_name, 'reviewedAt', m.reviewed_at) order by m.question_key)
        from (
          select distinct on (lm.question_key) lm.* from public.knowledge_legacy_mappings lm
          where lm.legacy_fact_id = f.id and lm.legacy_revision = f.revision
          order by lm.question_key, lm.reviewed_at desc, lm.id desc
        ) m
        join public.profiles p on p.id = m.reviewed_by
      ), '[]'::jsonb)) order by f.id) filter (where f.rn <= 50), '[]'::jsonb),
    max(f.id::text) filter (where f.rn = 50 and f.total > 50)::uuid
  into v_items, v_next
  from (select page.*, row_number() over (order by page.id) as rn, count(*) over () as total from page) f;
  return jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

-- Admin: runs, newest first, 20 a page (the cursor is the last run's id).
create function public.knowledge_reconciliation_runs(p_cursor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_after public.knowledge_reconciliation_runs;
  v_items jsonb;
  v_next uuid;
begin
  perform private.amenity_assert_active_user();
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  if p_cursor is not null then
    select r.* into v_after from public.knowledge_reconciliation_runs r where r.id = p_cursor;
    if not found then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
  end if;
  with page as (
    select r.*, row_number() over (order by r.started_at desc, r.id desc) as rn, count(*) over () as total
    from (
      select r.* from public.knowledge_reconciliation_runs r
      where v_after.id is null or (r.started_at, r.id) < (v_after.started_at, v_after.id)
      order by r.started_at desc, r.id desc limit 21
    ) r
  )
  select coalesce(jsonb_agg(jsonb_build_object('runId', p.id, 'kind', p.kind, 'mode', p.mode, 'venueId', p.venue_id,
      'startedAt', p.started_at, 'startedBy', pr.display_name, 'counts', p.counts) order by p.rn)
      filter (where p.rn <= 20), '[]'::jsonb),
    max(p.id::text) filter (where p.rn = 20 and p.total > 20)::uuid
  into v_items, v_next
  from page p join public.profiles pr on pr.id = p.started_by;
  return jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

create function public.knowledge_reconciliation_run(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.knowledge_reconciliation_runs;
begin
  perform private.amenity_assert_active_user();
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  select r.* into v_run from public.knowledge_reconciliation_runs r where r.id = p_run_id;
  if not found then
    raise exception 'knowledge_run_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('runId', v_run.id, 'kind', v_run.kind, 'mode', v_run.mode, 'venueId', v_run.venue_id,
    'dryRunId', v_run.dry_run_id, 'startedAt', v_run.started_at, 'counts', v_run.counts,
    'wouldCreate', v_run.would_create, 'conflicts', v_run.conflicts, 'sourceRevisions', v_run.source_revisions);
end;
$$;

-- Manager or admin: every legacy fact as historical narrative (L5), whatever
-- its mapping; "saved as confirmed in Coverage", never a knowledge
-- confirmation.
create function public.knowledge_legacy_narrative(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(v_venue);
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('legacyKey', f.amenity_key, 'label', t.title, 'presence', f.presence,
        'facts', f.facts, 'policy', f.policy, 'savedAsConfirmedAt', f.confirmed_at, 'updatedAt', f.updated_at)
      order by t.position, f.amenity_key)
    from public.venue_amenity_facts f
    join public.coverage_amenity_templates t on t.key = f.amenity_key
    where f.venue_id = v_venue
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-created functions
-- ---------------------------------------------------------------------------

-- B03-e body plus the empty-slot rule for imports (NLK14).
create or replace function public.knowledge_decide(
  p_target_type text,
  p_target_id uuid,
  p_decision text,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_hash text;
  v_prior jsonb;
  v_contribution public.knowledge_contributions;
  v_submission public.amenity_submissions;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_basis text;
  v_revision bigint;
  v_note text;
  v_required boolean;
  v_latest text;
  v_decision uuid;
  v_new_submission uuid;
  v_replaced text;
  v_result jsonb;
begin
  if p_target_type is null or p_target_type not in ('contribution', 'submission')
     or p_decision is null
     or p_decision not in ('confirm', 'reaffirm', 'request_detail', 'decline', 'seen', 'revoke') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  v_hash := private.knowledge_hash(jsonb_build_object(
    'targetType', p_target_type, 'targetId', p_target_id, 'decision', p_decision,
    'slotRevision', p_slot_revision, 'note', p_note));
  v_prior := private.knowledge_replay(p_idempotency_key, v_uid, 'decide', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  if p_target_type = 'contribution' then
    select x.* into v_contribution from public.knowledge_contributions x where x.id = p_target_id;
    if not found then
      raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
    end if;
    select c.* into v_check from public.venue_amenity_checks c where c.id = v_contribution.check_id;
  else
    select s.* into v_submission from public.amenity_submissions s where s.id = p_target_id;
    if not found then
      raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
    end if;
    select c.* into v_check from public.venue_amenity_checks c where c.id = v_submission.check_id;
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'staff' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  if p_target_type = 'contribution' and p_decision = 'confirm' then
    perform 1 from public.media_assets a
    where a.id in (select ca.asset_id from public.knowledge_contribution_assets ca where ca.contribution_id = v_contribution.id)
    order by a.id
    for share;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = v_check.id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_required := coalesce(v_rule.confirmation, 'none') <> 'none';
  v_note := private.clean_text(p_note, 500, 'invalid_note');

  if p_target_type = 'contribution' then
    if private.knowledge_is_terminal(v_contribution.id) then
      raise exception 'already_decided' using errcode = 'NLK03';
    end if;
    if p_decision = 'confirm' then
      if v_contribution.answer = 'unknown' then
        raise exception 'knowledge_not_adoptable' using errcode = 'NLK07';
      end if;
      if not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
        raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
      end if;
      if v_required and v_contribution.contributed_by = v_uid and not v_rule.self_confirmation_allowed then
        raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
      end if;
      -- B03-c: an admin rule or an organisation-scope policy needs an admin (§3.2, §5.4).
      if private.knowledge_needs_admin(v_rule, v_contribution.id) and v_basis <> 'admin' then
        raise exception 'not_active_admin' using errcode = '42501';
      end if;
      -- B03-f (§8.2, M3): an import is adopted only onto an empty slot.
      if exists (select 1 from public.knowledge_contribution_sources ks where ks.contribution_id = v_contribution.id)
         and v_check.current_submission_id is not null then
        raise exception 'import_slot_has_answer' using errcode = 'NLK14';
      end if;
      if v_check.progress = 'complete' then
        v_replaced := v_check.answer;
      end if;
      v_new_submission := private.knowledge_adopt(v_contribution, v_check, v_uid, v_basis,
        v_required, v_contribution.contributed_by = v_uid, v_revision, v_rule.rule_version);
    elsif p_decision in ('decline', 'request_detail') then
      if v_note is null then
        raise exception 'reason_required' using errcode = 'P0001';
      end if;
      v_decision := private.knowledge_decision(v_check, v_contribution.id, null,
        case p_decision when 'decline' then 'declined' else 'detail_requested' end,
        v_uid, v_basis, false, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'seen' then
      if v_contribution.answer <> 'unknown' then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      v_decision := private.knowledge_decision(v_check, v_contribution.id, null, 'seen',
        v_uid, v_basis, false, v_rule.rule_version, v_note, v_revision, null);
    else
      raise exception 'invalid_decision' using errcode = 'P0001';
    end if;
  else
    -- Like the legacy reopen: an archived check's answer takes no decisions.
    if v_check.status <> 'active' then
      raise exception 'amenity_check_archived' using errcode = 'P0001';
    end if;
    if v_check.current_submission_id is distinct from v_submission.id or v_check.progress <> 'complete' then
      raise exception 'knowledge_not_current' using errcode = 'NLK08';
    end if;
    select d.decision into v_latest from public.knowledge_decisions d
    where d.submission_id = v_submission.id and d.decision in ('confirmed', 'revoked')
    order by d.created_at desc, d.id desc limit 1;
    if p_decision = 'confirm' then
      if not v_required then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      if v_latest = 'confirmed' then
        raise exception 'already_decided' using errcode = 'NLK03';
      end if;
      if v_submission.submitted_by = v_uid and not v_rule.self_confirmation_allowed then
        raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
      end if;
      if private.knowledge_needs_admin(v_rule, v_submission.source_contribution_id) and v_basis <> 'admin' then
        raise exception 'not_active_admin' using errcode = '42501';
      end if;
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'confirmed', v_uid, v_basis,
        v_submission.submitted_by = v_uid, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'revoke' then
      if v_latest is distinct from 'confirmed' then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      if v_note is null then
        raise exception 'reason_required' using errcode = 'P0001';
      end if;
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'revoked', v_uid, v_basis,
        false, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'reaffirm' then
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'reaffirmed', v_uid, v_basis,
        false, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'decline' then
      if not v_required or v_latest = 'confirmed' then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      if v_note is null then
        raise exception 'reason_required' using errcode = 'P0001';
      end if;
      perform private.knowledge_reopen(v_check, v_note);
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'declined', v_uid, v_basis,
        false, v_rule.rule_version, v_note, v_revision, null);
    else
      raise exception 'invalid_decision' using errcode = 'P0001';
    end if;
  end if;

  v_result := jsonb_build_object(
    'decisionId', v_decision,
    'submissionId', v_new_submission,
    'replacedAnswer', v_replaced,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'replayed', false,
    -- B03-e (A24): the recheck tasks this decision closed.
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id)
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'decide', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- B03-e body plus the empty-slot rule for imports (NLK14).
create or replace function public.knowledge_resolve_conflict(
  p_check_id uuid,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_choose uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_hash text;
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_chosen public.knowledge_contributions;
  v_basis text;
  v_revision bigint;
  v_reason text;
  v_required boolean;
  v_submission uuid;
  v_other record;
  v_settled integer := 0;
  v_result jsonb;
begin
  v_hash := private.knowledge_hash(jsonb_build_object(
    'checkId', p_check_id, 'slotRevision', p_slot_revision, 'choose', p_choose, 'reason', p_reason));
  v_prior := private.knowledge_replay(p_idempotency_key, v_uid, 'resolve_conflict', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'staff' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_choose is not null then
    select x.* into v_chosen from public.knowledge_contributions x
    where x.id = p_choose and x.check_id = v_check.id;
    if not found then
      raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
    end if;
    perform 1 from public.media_assets a
    where a.id in (select ca.asset_id from public.knowledge_contribution_assets ca where ca.contribution_id = v_chosen.id)
    order by a.id
    for share;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_required := coalesce(v_rule.confirmation, 'none') <> 'none';

  if p_choose is null then
    if v_check.progress <> 'complete' then
      raise exception 'invalid_decision' using errcode = 'P0001';
    end if;
  else
    if private.knowledge_is_terminal(v_chosen.id) then
      raise exception 'already_decided' using errcode = 'NLK03';
    end if;
    if v_chosen.answer = 'unknown' then
      raise exception 'knowledge_not_adoptable' using errcode = 'NLK07';
    end if;
    if not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
      raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
    end if;
    if v_required and v_chosen.contributed_by = v_uid and not v_rule.self_confirmation_allowed then
      raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
    end if;
    -- B03-c: an admin rule or an organisation-scope policy needs an admin (§3.2, §5.4).
    if private.knowledge_needs_admin(v_rule, v_chosen.id) and v_basis <> 'admin' then
      raise exception 'not_active_admin' using errcode = '42501';
    end if;
    -- B03-f (§8.2, M3): an import is adopted only onto an empty slot.
    if exists (select 1 from public.knowledge_contribution_sources ks where ks.contribution_id = v_chosen.id)
       and v_check.current_submission_id is not null then
      raise exception 'import_slot_has_answer' using errcode = 'NLK14';
    end if;
  end if;

  -- Settle every other listed finding first, against the locked check.
  for v_other in
    select x.id, x.answer from public.knowledge_contributions x
    where x.check_id = v_check.id and x.id is distinct from p_choose
      and not private.knowledge_is_terminal(x.id)
    order by x.created_at, x.id
  loop
    perform private.knowledge_decision(v_check, v_other.id, null,
      case when v_other.answer = 'unknown' then 'seen' else 'declined' end,
      v_uid, v_basis, false, v_rule.rule_version, v_reason, v_revision, null);
    v_settled := v_settled + 1;
  end loop;

  if p_choose is not null then
    v_submission := private.knowledge_adopt(v_chosen, v_check, v_uid, v_basis,
      v_required, v_chosen.contributed_by = v_uid, v_revision, v_rule.rule_version);
    v_settled := v_settled + 1;
  end if;

  v_result := jsonb_build_object(
    'submissionId', v_submission,
    'settled', v_settled,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'replayed', false,
    -- B03-e (A24): the recheck tasks this decision closed.
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id)
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'resolve_conflict', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- B03-e body plus each pending finding's source and, for imports, adoptable.
create or replace function public.knowledge_check(p_check_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_check public.venue_amenity_checks;
  v_basis text;
  v_manager boolean;
  v_rule public.knowledge_question_rules;
  v_slot jsonb;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_manager := v_basis in ('venue_manager', 'admin');
  v_rule := private.knowledge_rule(v_check.template_key);
  v_slot := private.knowledge_slot_json(v_check, v_uid, v_basis);
  return v_slot || jsonb_build_object(
    'mySentAt', private.knowledge_latest_send(v_uid, v_check.id),
    -- B03-d (A6): the venue's timezone for schedules (OD-16 default).
    'timezone', private.venue_timezone(v_check.venue_id),
    'permissions', jsonb_build_object(
      'canContribute', (v_slot ->> 'mode') <> 'none',
      'canReportChange', not v_manager and (v_slot ->> 'mode') = 'change',
      'canConfirm', v_manager and (v_slot ->> 'inScope')::boolean,
      'canSelfConfirm', v_manager and (coalesce(v_rule.confirmation, 'none') = 'none' or coalesce(v_rule.self_confirmation_allowed, false)),
      'canRequestDetail', v_manager,
      'canDecline', v_manager
    ),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'findingRef', jsonb_build_object('type', 'contribution', 'id', x.id),
        'kind', x.kind,
        'answer', x.answer,
        'finding', x.finding,
        'limitations', x.limitations,
        'reason', x.reason,
        'unknownPreset', x.unknown_preset,
        'triedText', x.tried_text,
        'changeReason', x.change_reason,
        'sentAt', x.created_at,
        'senderId', x.contributed_by,
        'senderName', p.display_name,
        'senderAssigned', x.contributed_by = v_check.assignee_user_id,
        'isMine', x.contributed_by = v_uid,
        'detailRequested', exists (
          select 1 from public.knowledge_decisions d
          where d.contribution_id = x.id and d.decision = 'detail_requested'
        ),
        'detailRequest', case when v_manager then (
          select jsonb_build_object('decisionId', d.id, 'note', d.note, 'requestedAt', d.created_at)
          from public.knowledge_decisions d
          where d.contribution_id = x.id and d.decision = 'detail_requested'
          order by d.created_at desc, d.id desc limit 1) end,
        'wifi', case when v_manager or x.contributed_by = v_uid then x.internal_metadata end,
        'detail', (select kd.detail from public.knowledge_contribution_details kd where kd.contribution_id = x.id),
        'observedOn', (select kd.observed_on from public.knowledge_contribution_details kd where kd.contribution_id = x.id),
        'evidence', coalesce((
          select jsonb_agg(jsonb_build_object(
            'assetId', ca.asset_id, 'kind', ca.evidence_kind,
            'available', a.deleted_at is null and a.upload_state = 'ready')
            order by ca.evidence_kind, ca.asset_id)
          from public.knowledge_contribution_assets ca
          join public.media_assets a on a.id = ca.asset_id
          where ca.contribution_id = x.id
        ), '[]'::jsonb)
      )
      -- B03-c (A5): what a policy finding would still need once adopted.
      || coalesce((select jsonb_build_object('policyMissing', m.missing)
      from (select private.knowledge_policy_missing_for(x.id, null, false) as missing) m
      where m.missing is not null), '{}'::jsonb)
      -- B03-f (A12, A23): where the finding came from; imports say whether
      -- they can be confirmed (only onto an empty slot).
      || (select coalesce((select jsonb_build_object('source', ks.source_kind, 'sourceLabel', ks.source_label,
          'adoptable', v_check.current_submission_id is null)
        from public.knowledge_contribution_sources ks where ks.contribution_id = x.id),
        jsonb_build_object('source', case when xs.contributor_basis = 'staff' then 'staff_finding' else 'manager_statement' end)) from (select x.contributor_basis) xs)
      order by x.created_at, x.id)
      from public.knowledge_contributions x
      join public.profiles p on p.id = x.contributed_by
      where x.check_id = v_check.id
        and not private.knowledge_is_terminal(x.id)
        and (v_manager or x.contributed_by = v_uid)
    ), '[]'::jsonb)
  );
end;
$$;

-- B03-c body plus source and, for imports, adoptable (A12, A23).
create or replace function public.knowledge_to_confirm(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_items jsonb;
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(v_venue);
  select coalesce(jsonb_agg(q.i order by q.waiting, q.i ->> 'checkId', q.i -> 'findingRef' ->> 'id'), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'checkId', c.id, 'questionKey', c.template_key, 'question', t.question,
      'findingRef', jsonb_build_object('type', 'contribution', 'id', x.id),
      'kind', x.kind, 'answer', x.answer, 'senderName', p.display_name, 'sentAt', x.created_at,
      'waitingSince', x.created_at,
      'slotRevision', st.revision,
      'conflict', (
        select count(*) from public.knowledge_contributions y
        where y.check_id = c.id and y.answer <> 'unknown' and not private.knowledge_is_terminal(y.id)
      ) > 1 or (st.current_answer is not null and c.progress = 'complete' and x.answer is distinct from st.current_answer),
      -- The resolver's dispute test for this one finding (Couldn't establish included).
      'disputes', st.current_submission_id is not null and c.progress = 'complete'
        and x.answer is distinct from st.current_answer
    )
    -- B03-c (A5): what a policy finding would still need once adopted.
    || coalesce((select jsonb_build_object('policyMissing', m.missing)
      from (select private.knowledge_policy_missing_for(x.id, null, false) as missing) m
      where m.missing is not null), '{}'::jsonb)
    -- B03-f (A12, A23): the source; imports say whether they can be confirmed.
    || (select coalesce((select jsonb_build_object('source', ks.source_kind, 'sourceLabel', ks.source_label,
          'adoptable', c.current_submission_id is null)
        from public.knowledge_contribution_sources ks where ks.contribution_id = x.id),
        jsonb_build_object('source', case when xs.contributor_basis = 'staff' then 'staff_finding' else 'manager_statement' end)) from (select x.contributor_basis) xs) as i,
    x.created_at as waiting
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    join public.knowledge_contributions x on x.check_id = c.id
    join public.profiles p on p.id = x.contributed_by
    cross join lateral private.knowledge_slot_state(c.venue_id, array[c.template_key]) st
    where c.venue_id = v_venue and st.in_scope and not private.knowledge_is_terminal(x.id)
    union all
    select jsonb_build_object(
      'checkId', c.id, 'questionKey', c.template_key, 'question', t.question,
      'findingRef', jsonb_build_object('type', 'submission', 'id', st.current_submission_id),
      'kind', case when st.detail = 'evidence_withdrawn' then 'evidence_withdrawn' else 'answer_awaiting_confirmation' end,
      'answer', st.current_answer, 'senderName', p.display_name, 'sentAt', st.sent_at,
      'waitingSince', w.at,
      'slotRevision', st.revision, 'conflict', false, 'disputes', false,
      'source', coalesce((select ks.source_kind from public.knowledge_contribution_sources ks
        where ks.contribution_id = st.current_contribution_id),
        case when st.source_basis = 'staff' then 'staff_finding' else 'manager_statement' end)
    )
    || coalesce((select jsonb_build_object('policyMissing', m.missing)
      from (select private.knowledge_policy_missing_for(st.current_contribution_id, st.confirmation_basis, true) as missing) m
      where m.missing is not null), '{}'::jsonb),
    w.at
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    cross join lateral private.knowledge_slot_state(c.venue_id, array[c.template_key]) st
    left join public.profiles p on p.id = c.answered_by
    cross join lateral (
      select coalesce(case st.detail
        when 'evidence_withdrawn' then (
          select max(e.created_at) from public.knowledge_events e
          where e.check_id = c.id and e.kind = 'evidence_withdrawn'
            and e.submission_id = st.current_submission_id)
        when 'confirmation_revoked' then (
          select max(d.created_at) from public.knowledge_decisions d
          where d.submission_id = st.current_submission_id and d.decision = 'revoked')
      end, st.sent_at) as at
    ) w
    where c.venue_id = v_venue and st.in_scope and c.progress = 'complete'
      and (st.detail in ('pending', 'evidence_withdrawn', 'confirmation_revoked'))
  ) q;
  return jsonb_build_object('count', jsonb_array_length(v_items), 'items', v_items);
end;
$$;

-- B03-e body; findings no longer count imports, which are the suggestions row (A12).
create or replace function public.manager_triage_summary(p_venue_id uuid default null)
returns table (
  queue text,
  available boolean,
  waiting integer,
  oldest_waiting_at timestamptz,
  own_waiting integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.manager_read_venue(p_venue_id);
  v_basis text := private.knowledge_basis(v_venue);
  v_confirm jsonb;
begin
  if private.can_manage_venue(v_venue) then
    return query
    select 'menu_photos'::text, true, o.pending_photos, o.oldest_pending_at, o.own_waiting_photos
    from public.manager_menu_photo_overview(v_venue) o;
  else
    return query select 'menu_photos'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  if v_basis in ('venue_manager', 'admin') then
    v_confirm := public.knowledge_to_confirm(v_venue);
    -- B03-f (A12): imported proposals are the suggestions queue, not findings.
    return query
    select 'findings'::text, true,
      (select count(*)::integer from jsonb_array_elements(v_confirm -> 'items') i
       where coalesce(i ->> 'source', '') not in ('legacy_fact', 'external_source')),
      (select min((i ->> 'waitingSince')::timestamptz) from jsonb_array_elements(v_confirm -> 'items') i
       where coalesce(i ->> 'source', '') not in ('legacy_fact', 'external_source')),
      null::integer;
    return query
    select 'suggestions'::text, true,
      (select count(*)::integer from jsonb_array_elements(v_confirm -> 'items') i
       where i ->> 'source' in ('legacy_fact', 'external_source')),
      (select min((i ->> 'waitingSince')::timestamptz) from jsonb_array_elements(v_confirm -> 'items') i
       where i ->> 'source' in ('legacy_fact', 'external_source')),
      null::integer;
  else
    return query select 'findings'::text, false, null::integer, null::timestamptz, null::integer;
    return query select 'suggestions'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  -- Checklist review is closed to manager accounts (the coverage manager-deny
  -- triggers). The oldest time uses the pending predicate of
  -- venue_coverage_summary, which has no oldest column.
  if private.can_manage_venue(v_venue) and not private.is_active_manager() then
    return query
    select 'checklist'::text, true, s.pending_review_count, (
        select min(i.submitted_at)
        from public.coverage_submission_items i
        join public.media_assets a on a.id = i.asset_id
        where i.venue_id = v_venue and i.state = 'submitted'
          and a.upload_state = 'ready' and a.deleted_at is null
      ), null::integer
    from public.venue_coverage_summary(v_venue) s;
  else
    return query select 'checklist'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  -- B03-e (§7.4): open recheck tasks at the venue, oldest due first.
  if v_basis in ('venue_manager', 'admin') then
    return query
    select 'rechecks'::text, true, count(*)::integer, min(t.due_at), null::integer
    from public.knowledge_recheck_tasks t
    where t.venue_id = v_venue and t.state = 'open';
  else
    return query select 'rechecks'::text, false, null::integer, null::timestamptz, null::integer;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_external_sources_guard(),
  private.knowledge_assert_admin(),
  private.knowledge_reconcile_candidates(text, uuid),
  private.knowledge_reconcile_revisions(text, uuid)
from public, anon, authenticated;

revoke all on function
  public.knowledge_source_declare(text, text, uuid, uuid),
  public.knowledge_source_retire(uuid, text, uuid),
  public.knowledge_source_import(uuid, text, timestamptz, jsonb, uuid),
  public.knowledge_mapping_review(uuid, integer, text, text, text, uuid),
  public.knowledge_reconcile(text, text, uuid),
  public.knowledge_sources(boolean),
  public.knowledge_legacy_mappings(uuid, uuid),
  public.knowledge_reconciliation_runs(uuid),
  public.knowledge_reconciliation_run(uuid),
  public.knowledge_legacy_narrative(uuid),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.knowledge_check(uuid),
  public.knowledge_to_confirm(uuid),
  public.manager_triage_summary(uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_source_declare(text, text, uuid, uuid),
  public.knowledge_source_retire(uuid, text, uuid),
  public.knowledge_source_import(uuid, text, timestamptz, jsonb, uuid),
  public.knowledge_mapping_review(uuid, integer, text, text, text, uuid),
  public.knowledge_reconcile(text, text, uuid),
  public.knowledge_sources(boolean),
  public.knowledge_legacy_mappings(uuid, uuid),
  public.knowledge_reconciliation_runs(uuid),
  public.knowledge_reconciliation_run(uuid),
  public.knowledge_legacy_narrative(uuid),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.knowledge_check(uuid),
  public.knowledge_to_confirm(uuid),
  public.manager_triage_summary(uuid)
to authenticated;
