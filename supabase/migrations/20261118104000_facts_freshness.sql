-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- S1-FACTS (Full App v1, docs/plans/full-app-v1/sprint-plan.md): facts and
-- freshness. Spec §9.2, §9.3, §10 (fact verification), §14.3, §18.1.
--
-- * Check-date rules (spec §9.3, OD-15 decided by the owner's 18 Nov 2026
--   instruction to take the spec's proposal): 90 days for facts and for
--   space photos, with a 14-day lead, configurable by appending a rule
--   version (public.knowledge_freshness_policies stays append-only).
--   Every question gains a registry version naming fact_internal and
--   fact_public. Durations live only in those rows.
-- * A new basis, verified_on: the latest of a manager's "Still right"
--   reconfirmation, a reaffirmation, and the answer's own check date
--   (observed_on when its form records Checked on, else the confirmation
--   day, else the day the answer was saved). Presence questions have no
--   Checked on, so the observed_on basis would read basis_missing for every
--   answer (20261110180000); verified_on never does. observed_on rules and
--   their guard are unchanged.
-- * public.knowledge_fact_checks, append-only: "Still right" (reconfirmed,
--   with the day it was checked) and an optional next check set by the
--   manager, which can only bring the policy's due date forward. A
--   reconfirmation adds a knowledge event (fact_reconfirmed), so the slot
--   revision rises, and closes open rechecks the slot now satisfies.
--   Reconfirming never fabricates a contribution or a photo (spec §18.1).
-- * private.knowledge_slot_freshness (same signature) reads verified_on and
--   the manager's next check. public.knowledge_freshness_preview (same
--   signature) forecasts verified_on rules.
-- * guest_wifi rule version 2: a venue manager confirms (self-confirmation
--   allowed), so a staff Yes, its photo or video and typed test notes stay
--   Unconfirmed until verified (spec §9.2, AC25).
-- * outdoor_seating moves to facility@1 (lossless from presence@1), so the
--   garden's availability (seasonal, temporarily unavailable until a date)
--   is recorded instead of inferred from a photo (spec §9.2).
-- * Fact verification (spec §10): Unconfirmed, Confirmed, Check due,
--   Superseded, Withdrawn, mapped from the resolver's status, reason and
--   detail in one function, separate from the answer value. Source types
--   (spec §9.2) are derived from the contributor basis, an import's origin
--   and a policy's recorded authority.
-- * Reads: public.knowledge_fact_states (manager or admin of the venue),
--   public.knowledge_fact_coverage (spec §18.1: applicable questions with a
--   currently confirmed answer, No and Limited included, over applicable
--   questions; a confirmed Not applicable leaves both), and
--   public.knowledge_guest_answers (service role; spec §14.3 structured
--   answers: an overdue or unconfirmed fact has no value, never a No).
-- * Space photos (AC30): public.area_photo_checks, append-only, records
--   "Still right" for a place, a reported change (check due), a known
--   change (needs replacement) and an explicit end date (expired).
--   private.area_photo_freshness gives each accepted area photo's state:
--   current, check_due, needs_replacement or expired, from the space_photo
--   rule counted from acceptance or the latest reconfirmation. A
--   reconfirmation restores current without a new photo. Writes:
--   public.area_photo_reconfirm, public.area_photo_report_change,
--   public.area_photo_set_end_date; read: public.area_photo_freshness_list.
--   The coverage function (S1-COV) reads private.area_photo_freshness.
--
-- Not touched: area_photo_decisions and decide_area_photo (S1-COV adds
-- review levels), the amenity catalogue and its evidence rules, the B01
-- resolver, knowledge_decide.
--
-- Rollback: a forward migration restores knowledge_slot_freshness and
-- knowledge_freshness_preview from 20261112190200 and appends registry
-- versions naming no policy; revoke the new public functions. Tables and
-- rows stay (append-only history).

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

alter table public.knowledge_freshness_policies
  drop constraint knowledge_freshness_policies_basis_check;
alter table public.knowledge_freshness_policies
  add constraint knowledge_freshness_policies_basis_check
  check (basis in ('observed_on', 'stated_on', 'event_end', 'verified_on'));

alter table public.knowledge_events drop constraint knowledge_events_kind_check;
alter table public.knowledge_events add constraint knowledge_events_kind_check check (kind in (
  'contribution_recorded', 'decision_recorded', 'working_list_enabled', 'working_list_disabled',
  'rule_version_added', 'question_version_changed', 'evidence_withdrawn', 'assignment_closed_by_other',
  'schedule_exception_added', 'fact_reconfirmed'));

-- ---------------------------------------------------------------------------
-- Fact checks: "Still right" and the next check (spec §9.3, §7 M5)
-- ---------------------------------------------------------------------------

create table public.knowledge_fact_checks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  check_id uuid not null,
  question_key text not null references public.amenity_catalogue (key) on delete restrict,
  -- The answer in use when the check was made; a later answer starts again.
  submission_id uuid not null references public.amenity_submissions (id) on delete restrict,
  kind text not null check (kind in ('reconfirmed', 'next_check_set')),
  checked_on date,
  -- Null: the rule's due date applies.
  next_check_on date,
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  slot_revision bigint not null check (slot_revision >= 0),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decider_basis text not null check (decider_basis in ('venue_manager', 'admin')),
  created_at timestamptz not null default now(),
  constraint knowledge_fact_checks_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  constraint knowledge_fact_checks_fields check (
    (kind = 'reconfirmed') = (checked_on is not null)
    and (kind = 'reconfirmed' or next_check_on is not null)
    and (next_check_on is null or checked_on is null or next_check_on > checked_on)
  )
);

create index knowledge_fact_checks_submission_idx
  on public.knowledge_fact_checks (submission_id, created_at desc);
create index knowledge_fact_checks_venue_idx on public.knowledge_fact_checks (venue_id, created_at);

comment on table public.knowledge_fact_checks is
  'S1-FACTS: append-only checks of the answer in use: reconfirmed unchanged (with the day checked) and the next check set by a manager.';

create trigger knowledge_fact_checks_append_only
  before update or delete on public.knowledge_fact_checks
  for each row execute function private.append_only_guard();
create trigger knowledge_fact_checks_no_truncate
  before truncate on public.knowledge_fact_checks
  for each statement execute function private.append_only_guard();

alter table public.knowledge_fact_checks enable row level security;
revoke all on table public.knowledge_fact_checks from public, anon, authenticated, service_role;
grant select on table public.knowledge_fact_checks to service_role;

-- The day an answer was last verified, in the venue's timezone, as read at
-- p_now: the latest of a reconfirmation, a reaffirmation and the answer's own
-- check date (observed_on, else its confirmation, else the day it was saved).
create function private.knowledge_verified_on(
  p_submission_id uuid, p_observed_on date, p_timezone text, p_now timestamptz
)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_submission_id is null then null else greatest(
    (select max(f.checked_on) from public.knowledge_fact_checks f
      where f.submission_id = p_submission_id and f.kind = 'reconfirmed' and f.created_at <= p_now),
    (select (max(d.created_at) at time zone p_timezone)::date from public.knowledge_decisions d
      where d.submission_id = p_submission_id and d.decision = 'reaffirmed' and d.created_at <= p_now),
    coalesce(
      p_observed_on,
      (select (max(d.created_at) at time zone p_timezone)::date from public.knowledge_decisions d
        where d.submission_id = p_submission_id and d.decision = 'confirmed' and d.created_at <= p_now),
      (select (s.created_at at time zone p_timezone)::date from public.amenity_submissions s
        where s.id = p_submission_id)
    )
  ) end;
$$;

-- The next check a manager set with the latest check of this answer, or null.
create function private.knowledge_next_check_on(p_submission_id uuid, p_now timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select f.next_check_on from public.knowledge_fact_checks f
  where f.submission_id = p_submission_id and f.created_at <= p_now
  order by f.created_at desc, f.id desc
  limit 1;
$$;

-- As 20261112190200, plus the verified_on basis and a manager's earlier next
-- check (entries gain nextCheckSetBy: 'manager' when it applies).
create or replace function private.knowledge_slot_freshness(
  p_venue_id uuid, p_key text, p_submission_id uuid, p_schema text, p_detail jsonb,
  p_observed_on date, p_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_freshness jsonb;
  v_out jsonb := '[]'::jsonb;
  v_use text;
  v_policy public.knowledge_freshness_policies;
  v_tz text := private.venue_timezone(p_venue_id);
  v_date date;
  v_end timestamptz;
  v_entry jsonb;
  v_next date;
begin
  -- B08 M1: the version and policies in force at p_now, never later ones.
  v_freshness := (private.knowledge_version_as_of(p_key, p_now)).freshness;
  foreach v_use in array array['internal', 'public'] loop
    v_policy := null;
    if p_submission_id is not null and v_freshness ->> v_use is not null then
      v_policy := private.knowledge_policy_as_of(v_freshness ->> v_use, v_use, p_now);
    end if;
    v_date := case v_policy.basis
      when 'observed_on' then p_observed_on
      when 'verified_on' then private.knowledge_verified_on(p_submission_id, p_observed_on, v_tz, p_now)
      when 'stated_on' then case when p_schema = 'policy'
        then private.knowledge_safe_date(p_detail -> 'authority' ->> 'statedOn') end
      when 'event_end' then case when p_schema = 'schedule_event'
        then private.knowledge_safe_date(p_detail -> 'event' ->> 'localDate') end
    end;
    v_end := case when v_policy.basis = 'event_end' and v_date is not null
      then private.knowledge_event_end(p_detail -> 'event', v_date, v_tz) end;
    v_entry := private.knowledge_freshness_entry(v_use, v_policy.max_age, v_policy.recheck_lead,
      v_policy.basis, v_date, v_end, p_now, v_tz);
    -- A manager may bring the check forward, never push it back.
    if v_policy.basis = 'verified_on' and v_date is not null then
      v_next := private.knowledge_next_check_on(p_submission_id, p_now);
      if v_next is not null and v_next > v_date
         and (v_next::timestamp at time zone v_tz) < (v_entry ->> 'nextCheckDue')::timestamptz then
        v_entry := private.knowledge_freshness_entry(v_use, (v_next - v_date) * interval '1 day',
          v_policy.recheck_lead, v_policy.basis, v_date, null, p_now, v_tz)
          || jsonb_build_object('nextCheckSetBy', 'manager');
      end if;
    end if;
    v_out := v_out || (v_entry
      || case when v_policy.id is not null
        then jsonb_build_object('policyId', v_policy.id, 'policyVersion', v_policy.version) else '{}'::jsonb end);
  end loop;
  return v_out;
end;
$$;

-- As 20261112190200, with the verified_on basis forecast from each answer
-- in use (body otherwise unchanged).
create or replace function public.knowledge_freshness_preview(p_key text, p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fields jsonb := '[]'::jsonb;
  v_use text;
  v_items jsonb;
  v_version public.knowledge_question_versions;
begin
  perform private.amenity_assert_active_user();
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.knowledge_question_versions v where v.key = p_key) then
    raise exception 'knowledge_question_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_policy) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_policy) k where k not in ('internal', 'public')) > 0 then
    v_fields := v_fields || jsonb_build_object('path', 'policy', 'problem', 'invalid');
  else
    foreach v_use in array array['internal', 'public'] loop
      if p_policy ->> v_use is not null and not exists (
        select 1 from public.knowledge_freshness_policies p where p.id = p_policy ->> v_use and p.use = v_use
      ) then
        v_fields := v_fields || jsonb_build_object('path', 'policy.' || v_use, 'problem', 'invalid');
      end if;
    end loop;
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023', detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  select v.* into v_version from public.knowledge_question_versions v
  where v.key = p_key order by v.version desc limit 1;
  if not private.knowledge_schema_has_checked_on(v_version.value_schema, v_version.value_schema_version) then
    foreach v_use in array array['internal', 'public'] loop
      if private.knowledge_policy_counts_from_check(p_policy ->> v_use, v_use) then
        raise exception 'freshness_basis_unavailable' using errcode = 'NLK15',
          detail = jsonb_build_object('key', p_key, 'version', v_version.version,
            'schema', v_version.value_schema, 'schemaVersion', v_version.value_schema_version,
            'use', v_use, 'policyId', p_policy ->> v_use)::text;
      end if;
    end loop;
  end if;

  with slots as (
    select c.venue_id, kd.value_schema,
      private.knowledge_effective_detail(st.current_contribution_id) as detail, kd.observed_on, st.current_submission_id as submission_id
    from public.venue_amenity_checks c
    cross join lateral private.knowledge_slot_state(c.venue_id, array[c.template_key]) st
    left join public.knowledge_contribution_details kd on kd.contribution_id = st.current_contribution_id
    where c.template_key = p_key and st.in_scope and st.current_submission_id is not null
      and st.check_progress = 'complete'
  ),
  entries as (
    select s.venue_id, u.use, private.knowledge_freshness_entry(u.use, p.max_age, p.recheck_lead, p.basis,
      case p.basis
        when 'observed_on' then s.observed_on
        when 'verified_on' then private.knowledge_verified_on(s.submission_id, s.observed_on,
          private.venue_timezone(s.venue_id), now())
        when 'stated_on' then case when s.value_schema = 'policy'
          then private.knowledge_safe_date(s.detail -> 'authority' ->> 'statedOn') end
        when 'event_end' then case when s.value_schema = 'schedule_event'
          then private.knowledge_safe_date(s.detail -> 'event' ->> 'localDate') end
      end,
      case when p.basis = 'event_end' and s.value_schema = 'schedule_event' then
        private.knowledge_event_end(s.detail -> 'event',
          private.knowledge_safe_date(s.detail -> 'event' ->> 'localDate'),
          private.venue_timezone(s.venue_id)) end,
      now(), private.venue_timezone(s.venue_id)) ->> 'state' as state
    from slots s
    cross join (values ('internal'), ('public')) u(use)
    join lateral (
      select p.* from public.knowledge_freshness_policies p
      where p.id = p_policy ->> u.use and p.use = u.use order by p.version desc limit 1
    ) p on true
  )
  select coalesce(jsonb_agg(jsonb_build_object('venueId', z.venue_id, 'use', z.use,
      'answers', z.answers, 'dueSoon', z.due_soon, 'expired', z.expired, 'basisMissing', z.basis_missing)
      order by z.venue_id, z.use), '[]'::jsonb)
  into v_items
  from (
    select e.venue_id, e.use, count(*)::integer as answers,
      (count(*) filter (where e.state = 'due_soon'))::integer as due_soon,
      (count(*) filter (where e.state = 'expired'))::integer as expired,
      (count(*) filter (where e.state = 'basis_missing'))::integer as basis_missing
    from entries e group by e.venue_id, e.use
  ) z;
  return jsonb_build_object('key', p_key, 'items', v_items);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Seed: rules, registry versions, the Wi-Fi rule
-- ---------------------------------------------------------------------------

insert into public.knowledge_freshness_policies
  (id, version, claim_class, use, max_age, recheck_lead, basis, note)
values
  ('fact_internal', 1, 'offering', 'internal', interval '90 days', interval '14 days', 'verified_on',
   'Spec §9.3: facts are checked 90 days after they were last verified, for staff and internal tools.'),
  ('fact_public', 1, 'offering', 'public', interval '90 days', interval '14 days', 'verified_on',
   'Spec §9.3: facts are checked 90 days after they were last verified, for guests.'),
  ('space_photo', 1, 'fixture', 'public', interval '90 days', interval '14 days', 'verified_on',
   'Spec §9.3: an accepted photo of a venue space is checked 90 days after acceptance or its last reconfirmation.');

insert into public.knowledge_question_rules
  (question_key, rule_version, confirmation, self_confirmation_allowed, unassigned_auto_complete,
   staff_text_internal, redaction_required)
values ('guest_wifi', 2, 'venue_manager', true, false, false, true);

-- One new version per question: its latest version with the fact rules
-- named, plus the Wi-Fi rule and the garden's facility form.
insert into public.knowledge_question_versions
select (jsonb_populate_record(null::public.knowledge_question_versions,
  to_jsonb(v) || jsonb_build_object(
    'version', v.version + 1,
    'freshness', jsonb_build_object('internal', 'fact_internal', 'public', 'fact_public'),
    'effective_from', null,
    'created_at', now(),
    'created_by', null,
    'change_kind', case when v.key = 'outdoor_seating' then 'schema' else 'rule' end,
    'change_note', case v.key
      when 'guest_wifi' then 'S1-FACTS: 90-day check dates (spec §9.3); a venue manager confirms guest Wi-Fi (spec §9.2, AC25).'
      when 'outdoor_seating' then 'S1-FACTS: 90-day check dates (spec §9.3); facility form so the garden''s availability is recorded (spec §9.2).'
      else 'S1-FACTS: 90-day check dates (spec §9.3).' end
  )
  || case when v.key = 'guest_wifi' then jsonb_build_object(
    'rule_version', 2, 'confirmation', 'venue_manager', 'self_confirmation_allowed', true) else '{}'::jsonb end
  || case when v.key = 'outdoor_seating' then jsonb_build_object(
    'value_schema', 'facility', 'value_schema_version', 1, 'family', 'facility',
    'upgrade_rules', coalesce(v.upgrade_rules, '{}'::jsonb) || '{"presence@1": "lossless"}'::jsonb) else '{}'::jsonb end
)).*
from public.knowledge_question_versions v
where v.version = (select max(x.version) from public.knowledge_question_versions x where x.key = v.key);

select private.knowledge_note_definition_change('guest_wifi', 'rule_version_added');
select private.knowledge_note_definition_change(q.key, 'question_version_changed')
from public.knowledge_questions q order by q.key;

-- ---------------------------------------------------------------------------
-- Fact verification and source type (spec §9.2, §10)
-- ---------------------------------------------------------------------------

-- The slot's verification state from the resolver's status, reason and
-- detail; null when the question is out of scope. Answer values stay apart.
create function private.knowledge_fact_verification(p_status text, p_reason text, p_detail text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'available' then 'confirmed'
    when p_reason = 'withdrawn' then 'withdrawn'
    -- A qualified answer (Limited, Conditional) is confirmed; v1 withholds it.
    when p_reason = 'stale' and p_detail = 'qualified_answer' then 'confirmed'
    -- Overdue, reopened, evidence lost, schema replaced, or a reported change.
    when p_reason in ('stale', 'disputed') then 'check_due'
    when p_reason in ('unknown', 'not_enabled') and p_detail = 'not_enabled' then null
    else 'unconfirmed'
  end;
$$;

-- The state for one use: a confirmed answer past that use's check date is
-- check due for it (an answer may be current internally and due publicly).
create function private.knowledge_fact_verification_for(p_state text, p_freshness jsonb, p_use text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state = 'confirmed' and exists (
      select 1 from jsonb_array_elements(coalesce(p_freshness, '[]'::jsonb)) e
      where e ->> 'use' = p_use and e ->> 'state' in ('expired', 'basis_missing')
    ) then 'check_due'
    else p_state
  end;
$$;

-- Spec §9.2 source types, derived (no stored column): an approved operating
-- policy, an authoritative business record, a manager's inspection, or a
-- staff observation (confirmed by a manager or not).
create function private.knowledge_fact_source_type(
  p_source_origin text, p_source_basis text, p_schema text, p_detail jsonb, p_confirmation_basis text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_schema = 'policy' and p_detail -> 'authority' ->> 'source' = 'written_policy' then 'operating_policy'
    when p_source_origin in ('legacy_fact', 'external_source') then 'business_record'
    when p_source_basis in ('venue_manager', 'admin') then 'manager_inspection'
    when p_source_basis = 'staff' and p_confirmation_basis in ('venue_manager', 'admin')
      then 'staff_observation_confirmed'
    when p_source_basis = 'staff' then 'staff_observation'
    else 'unrecorded'
  end;
$$;

-- Every question of a venue with its verification. Internal only: callers
-- check access and choose what to return.
create function private.knowledge_fact_rows(p_venue_id uuid, p_now timestamptz default now())
returns table (
  question_key text,
  category text,
  question text,
  check_id uuid,
  in_scope boolean,
  applicable boolean,
  status text,
  reason text,
  detail text,
  verification text,
  public_verification text,
  value text,
  current_answer text,
  revision bigint,
  question_version integer,
  value_schema text,
  conditions jsonb,
  limitations text,
  current_submission_id uuid,
  current_contribution_id uuid,
  contribution_kind text,
  source_type text,
  confirmation_basis text,
  verified_on date,
  next_check_due timestamptz,
  next_check_set_by text,
  public_next_check_due timestamptz,
  sensitivity text,
  publishable_fields text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with keys as (
    select array_agg(c.template_key order by c.template_key) as ks
    from public.venue_amenity_checks c where c.venue_id = p_venue_id
  )
  select s.question_key, ac.category, ac.question, s.check_id, s.in_scope,
    s.in_scope and s.check_status = 'active'
      and not (v.state = 'confirmed' and s.current_answer = 'not_applicable'),
    s.status, s.reason, s.detail, v.state,
    private.knowledge_fact_verification_for(v.state, s.freshness, 'public'),
    s.value, s.current_answer, s.revision, s.question_version, s.value_schema,
    private.knowledge_effective_detail(s.current_contribution_id), s.limitations,
    s.current_submission_id, s.current_contribution_id, s.contribution_kind,
    case when s.current_submission_id is not null then
      private.knowledge_fact_source_type(ks.source_kind, s.source_basis, s.value_schema,
        private.knowledge_effective_detail(s.current_contribution_id), s.confirmation_basis) end,
    s.confirmation_basis,
    private.knowledge_verified_on(s.current_submission_id, kd.observed_on, private.venue_timezone(p_venue_id), p_now),
    (fi.e ->> 'nextCheckDue')::timestamptz, fi.e ->> 'nextCheckSetBy',
    (fp.e ->> 'nextCheckDue')::timestamptz,
    lv.sensitivity, lv.publishable_fields
  from keys
  cross join lateral private.knowledge_slot_state_b03(p_venue_id, keys.ks, p_now) s
  join public.amenity_catalogue ac on ac.key = s.question_key
  left join public.knowledge_contribution_sources ks on ks.contribution_id = s.current_contribution_id
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.current_contribution_id
  left join lateral (select (private.knowledge_version_as_of(s.question_key, p_now)).*) lv on true
  cross join lateral (select private.knowledge_fact_verification(s.status, s.reason, s.detail) as state) v
  left join lateral (select e from jsonb_array_elements(s.freshness) e where e ->> 'use' = 'internal' limit 1) fi on true
  left join lateral (select e from jsonb_array_elements(s.freshness) e where e ->> 'use' = 'public' limit 1) fp on true
  where keys.ks is not null;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Spec §7 M5, §9.2: each in-scope question's verification, answer, conditions,
-- source type, verified date and next check. A venue manager or an admin.
create function public.knowledge_fact_states(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_venue_id is null or not private.can_manage_venue(p_venue_id) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  return jsonb_build_object('venueId', p_venue_id, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', r.question_key, 'category', r.category, 'question', r.question, 'checkId', r.check_id,
      'applicable', r.applicable, 'verification', r.verification,
      'publicVerification', r.public_verification,
      -- The answer recorded, shown to managers even while it is due.
      'answer', r.current_answer, 'valueInUse', r.value,
      'reason', r.reason, 'detail', r.detail,
      'conditions', r.conditions, 'limitations', r.limitations,
      'sourceType', r.source_type, 'confirmationBasis', r.confirmation_basis,
      'verifiedOn', to_char(r.verified_on, 'YYYY-MM-DD'),
      'nextCheckDue', r.next_check_due, 'nextCheckSetBy', r.next_check_set_by,
      'publicNextCheckDue', r.public_next_check_due,
      'revision', r.revision, 'questionVersion', r.question_version, 'valueSchema', r.value_schema,
      'submissionId', r.current_submission_id
    ) order by ac.position, r.question_key)
    from private.knowledge_fact_rows(p_venue_id) r
    join public.amenity_catalogue ac on ac.key = r.question_key
    where r.in_scope
  ), '[]'::jsonb));
end;
$$;

-- Spec §18.1: confirmed fact coverage, numerator and denominator, overall and
-- by catalogue group. A venue manager or an admin.
create function public.knowledge_fact_coverage(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_venue_id is null or not private.can_manage_venue(p_venue_id) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  return (
    with r as (select * from private.knowledge_fact_rows(p_venue_id) x where x.applicable),
    g as (
      select r.category,
        (count(*) filter (where r.verification = 'confirmed'))::integer as numerator,
        count(*)::integer as denominator
      from r group by r.category
    )
    select jsonb_build_object(
      'venueId', p_venue_id,
      'numerator', (select count(*) filter (where r.verification = 'confirmed') from r)::integer,
      'denominator', (select count(*) from r)::integer,
      'checkDue', (select count(*) filter (where r.verification = 'check_due') from r)::integer,
      'unconfirmed', (select count(*) filter (where r.verification = 'unconfirmed') from r)::integer,
      'withdrawn', (select count(*) filter (where r.verification = 'withdrawn') from r)::integer,
      'publicNumerator', (select count(*) filter (where r.public_verification = 'confirmed') from r)::integer,
      'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', g.category,
        'numerator', g.numerator, 'denominator', g.denominator) order by g.category) from g), '[]'::jsonb)
    )
  );
end;
$$;

-- Spec §14.3: structured guest answers for a consuming service (service role
-- only). Only a currently confirmed fact for the use carries a value;
-- anything else is unconfirmed or check_due with no value, never a No.
-- Conditions are the answer's structured detail: for guests only the
-- question's publishable fields; never for a restricted-detail question.
create function public.knowledge_guest_answers(p_venue_id uuid, p_keys text[], p_use text default 'public')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_keys text[] := coalesce(p_keys, '{}'::text[]);
begin
  if p_use is null or p_use not in ('internal', 'public') then
    raise exception 'invalid_use' using errcode = '22023';
  end if;
  if cardinality(v_keys) > 50 then
    raise exception 'invalid_key_list' using errcode = '22023';
  end if;
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  return jsonb_build_object('venueId', p_venue_id, 'use', p_use, 'answers', coalesce((
    select jsonb_agg(x.j order by array_position(v_keys, x.key))
    from (
      select k.key, case
        when r.question_key is null or not r.in_scope then jsonb_build_object(
          'key', k.key, 'verification', 'unconfirmed', 'value', null, 'conditions', '{}'::jsonb,
          'verifiedOn', null, 'nextCheckDue', null, 'source', null, 'revision', null, 'questionVersion', null)
        else jsonb_build_object(
          'key', r.question_key,
          'verification', u.state,
          'value', case when u.state = 'confirmed' then coalesce(r.value, r.current_answer) end,
          'conditions', case
            when u.state <> 'confirmed' or r.sensitivity = 'restricted_detail' then '{}'::jsonb
            when p_use = 'internal' then coalesce(r.conditions, '{}'::jsonb)
            else coalesce((select jsonb_object_agg(f.key, f.value) from jsonb_each(coalesce(r.conditions, '{}'::jsonb)) f
              where f.key = any(r.publishable_fields)), '{}'::jsonb) end,
          'verifiedOn', case when u.state = 'confirmed' then to_char(r.verified_on, 'YYYY-MM-DD') end,
          'nextCheckDue', case when u.state = 'confirmed' then
            case when p_use = 'public' then r.public_next_check_due else r.next_check_due end end,
          'source', case when u.state = 'confirmed' then jsonb_build_object(
            'type', r.source_type,
            'id', case when r.contribution_kind = 'contribution' then r.current_contribution_id
              else r.current_submission_id end,
            'idKind', r.contribution_kind) end,
          'revision', r.revision,
          'questionVersion', r.question_version)
        end as j
      from unnest(v_keys) k(key)
      left join private.knowledge_fact_rows(p_venue_id) r on r.question_key = k.key
      left join lateral (select case when p_use = 'public' then r.public_verification else r.verification end
        as state) u on true
    ) x
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: "Still right" (spec §9.3, §7 M5)
-- ---------------------------------------------------------------------------

-- Reconfirms the answer in use without a new contribution or photo, with the
-- day it was checked (today or up to 30 days back, not before the answer)
-- and optionally an earlier next check. A venue manager or an admin. Allowed
-- while the answer is confirmed or only overdue (expired, basis missing);
-- a disputed, unconfirmed, withdrawn, reopened or evidence-lost answer needs
-- a decision instead (knowledge_reconfirm_not_allowed). p_reconfirm false
-- only sets the next check.
create function public.knowledge_reconfirm(
  p_check_id uuid,
  p_slot_revision bigint,
  p_checked_on date default null,
  p_next_check_on date default null,
  p_note text default null,
  p_reconfirm boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_check public.venue_amenity_checks;
  v_revision bigint;
  v_basis text;
  v_today date := private.london_today();
  v_checked date := case when coalesce(p_reconfirm, true) then coalesce(p_checked_on, private.london_today()) end;
  v_note text := private.clean_text(p_note, 500, 'invalid_note');
  v_st record;
  v_saved date;
  v_closed jsonb;
  v_row record;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or not private.can_manage_venue(v_check.venue_id) then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := case when private.is_active_admin() then 'admin' else 'venue_manager' end;
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;

  select st.* into v_st from private.knowledge_slot_state_b03(v_check.venue_id, array[v_check.template_key]) st;
  if not v_st.in_scope then
    raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
  end if;
  if v_st.current_submission_id is null
     or private.knowledge_fact_verification(v_st.status, v_st.reason, v_st.detail) is distinct from 'confirmed'
       and not (v_st.reason = 'stale' and v_st.detail in ('expired', 'basis_missing')) then
    raise exception 'knowledge_reconfirm_not_allowed' using errcode = 'P0001',
      detail = jsonb_build_object('reason', v_st.reason, 'detail', v_st.detail)::text;
  end if;

  select (s.created_at at time zone private.venue_timezone(v_check.venue_id))::date into v_saved
  from public.amenity_submissions s where s.id = v_st.current_submission_id;
  if v_checked is not null and (v_checked > v_today or v_checked < v_today - 30 or v_checked < v_saved) then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('path', 'checkedOn', 'problem', 'out_of_range')))::text;
  end if;
  if (not coalesce(p_reconfirm, true) and p_next_check_on is null)
     or (p_next_check_on is not null and (p_next_check_on <= v_today or p_next_check_on > v_today + 366)) then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('path', 'nextCheckOn', 'problem',
          case when p_next_check_on is null then 'required' else 'out_of_range' end)))::text;
  end if;

  insert into public.knowledge_fact_checks (venue_id, check_id, question_key, submission_id, kind,
    checked_on, next_check_on, note, slot_revision, decided_by, decider_basis)
  values (v_check.venue_id, v_check.id, v_check.template_key, v_st.current_submission_id,
    case when v_checked is not null then 'reconfirmed' else 'next_check_set' end,
    v_checked, p_next_check_on, v_note, v_revision, v_uid, v_basis);
  insert into public.knowledge_events (venue_id, question_key, check_id, kind, actor_id, submission_id, detail)
  values (v_check.venue_id, v_check.template_key, v_check.id, 'fact_reconfirmed', v_uid,
    v_st.current_submission_id, jsonb_build_object('checkedOn', v_checked, 'nextCheckOn', p_next_check_on));

  v_closed := private.knowledge_close_rechecks(v_check.id, null::uuid);
  select r.* into v_row from private.knowledge_fact_rows(v_check.venue_id) r
  where r.question_key = v_check.template_key;
  return jsonb_build_object(
    'checkId', v_check.id,
    'submissionId', v_st.current_submission_id,
    'verification', v_row.verification,
    'verifiedOn', to_char(v_row.verified_on, 'YYYY-MM-DD'),
    'nextCheckDue', v_row.next_check_due,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'rechecksClosed', coalesce(v_closed, '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Space photos: check due, reconfirm, reported change, end date (AC30)
-- ---------------------------------------------------------------------------

create table public.area_photo_checks (
  id bigint generated always as identity primary key,
  label_id uuid not null,
  venue_id uuid not null,
  subject_id uuid not null,
  kind text not null check (kind in ('reconfirmed', 'change_reported', 'replacement_needed', 'end_date_set')),
  checked_on date,
  valid_until date,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decider_basis text not null check (decider_basis in ('staff', 'venue_manager', 'admin')),
  created_at timestamptz not null default now(),
  constraint area_photo_checks_label_fkey foreign key (label_id, venue_id)
    references public.media_area_labels (id, venue_id) on delete restrict,
  constraint area_photo_checks_fields check (
    (kind = 'reconfirmed') = (checked_on is not null)
    and (kind = 'end_date_set') = (valid_until is not null)
    and (kind not in ('change_reported', 'replacement_needed') or reason is not null)
  )
);

create index area_photo_checks_label_idx on public.area_photo_checks (label_id, id desc);
create index area_photo_checks_venue_idx on public.area_photo_checks (venue_id, created_at);

comment on table public.area_photo_checks is
  'S1-FACTS: append-only checks of accepted area photos: reconfirmed unchanged, change reported (check due), replacement needed, end date set.';

create trigger area_photo_checks_append_only
  before update or delete on public.area_photo_checks
  for each row execute function private.append_only_guard();
create trigger area_photo_checks_no_truncate
  before truncate on public.area_photo_checks
  for each statement execute function private.append_only_guard();

alter table public.area_photo_checks enable row level security;
revoke all on table public.area_photo_checks from public, anon, authenticated, service_role;
grant select on table public.area_photo_checks to service_role;

-- One area photo's freshness at p_now, or state 'not_accepted' while it is
-- not accepted. After the latest acceptance: an end date that has passed is
-- expired; the latest of a reported change (check_due), a known change
-- (needs_replacement) and a reconfirmation decides; otherwise the
-- space_photo rule from the later of acceptance and the last reconfirmation
-- gives current or check_due (dueSoon within the lead).
create function private.area_photo_freshness(p_label_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_label public.media_area_labels;
  v_latest record;
  v_tz text;
  v_last public.area_photo_checks;
  v_until date;
  v_basis date;
  v_policy public.knowledge_freshness_policies;
  v_entry jsonb;
begin
  select l.* into v_label from public.media_area_labels l where l.id = p_label_id;
  if not found then
    return null;
  end if;
  select d.action, d.decided_at into v_latest
  from public.area_photo_decisions d
  where d.label_id = p_label_id and d.decided_at <= p_now
  order by d.id desc limit 1;
  if v_latest.action is distinct from 'accepted' then
    return jsonb_build_object('state', 'not_accepted');
  end if;
  v_tz := private.venue_timezone(v_label.venue_id);

  select c.valid_until into v_until from public.area_photo_checks c
  where c.label_id = p_label_id and c.kind = 'end_date_set'
    and c.created_at >= v_latest.decided_at and c.created_at <= p_now
  order by c.id desc limit 1;
  if v_until is not null and (p_now at time zone v_tz)::date > v_until then
    return jsonb_build_object('state', 'expired', 'cause', 'end_date_passed',
      'validUntil', to_char(v_until, 'YYYY-MM-DD'), 'nextCheckDue', null, 'verifiedOn', null, 'dueSoon', false);
  end if;

  select c.* into v_last from public.area_photo_checks c
  where c.label_id = p_label_id and c.kind in ('reconfirmed', 'change_reported', 'replacement_needed')
    and c.created_at >= v_latest.decided_at and c.created_at <= p_now
  order by c.id desc limit 1;
  if v_last.kind in ('change_reported', 'replacement_needed') then
    return jsonb_build_object(
      'state', case v_last.kind when 'change_reported' then 'check_due' else 'needs_replacement' end,
      'cause', v_last.kind, 'reason', v_last.reason, 'reportedAt', v_last.created_at,
      'validUntil', to_char(v_until, 'YYYY-MM-DD'), 'nextCheckDue', null, 'verifiedOn', null, 'dueSoon', false);
  end if;

  v_basis := greatest((v_latest.decided_at at time zone v_tz)::date,
    (select max(c.checked_on) from public.area_photo_checks c
      where c.label_id = p_label_id and c.kind = 'reconfirmed'
        and c.created_at >= v_latest.decided_at and c.created_at <= p_now));
  v_policy := private.knowledge_policy_as_of('space_photo', 'public', p_now);
  if v_policy.id is null then
    return jsonb_build_object('state', 'current', 'cause', null, 'verifiedOn', to_char(v_basis, 'YYYY-MM-DD'),
      'nextCheckDue', null, 'dueSoon', false, 'validUntil', to_char(v_until, 'YYYY-MM-DD'));
  end if;
  v_entry := private.knowledge_freshness_entry('public', v_policy.max_age, v_policy.recheck_lead,
    v_policy.basis, v_basis, null, p_now, v_tz);
  return jsonb_build_object(
    'state', case when v_entry ->> 'state' = 'expired' then 'check_due' else 'current' end,
    'cause', case when v_entry ->> 'state' = 'expired' then 'review_date_passed' end,
    'verifiedOn', to_char(v_basis, 'YYYY-MM-DD'),
    'nextCheckDue', v_entry -> 'nextCheckDue',
    'dueSoon', v_entry ->> 'state' = 'due_soon',
    'validUntil', to_char(v_until, 'YYYY-MM-DD'),
    'policyId', v_policy.id, 'policyVersion', v_policy.version);
end;
$$;

-- Live accepted area photos of a place (as private.area_photo_rows reads
-- them: uploader's own label on a ready, undeleted still image).
create function private.area_photo_accepted_labels(p_subject_id uuid)
returns table (label_id uuid, venue_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.label_id, r.venue_id
  from public.knowledge_subjects s
  cross join lateral private.area_photo_rows(s.venue_id, null) r
  where s.id = p_subject_id and r.subject_id = s.id and r.state = 'accepted'
    and r.ready and r.deleted_at is null
  order by r.label_id;
$$;

-- "Still right": every accepted photo of the place stays current from the day
-- checked (today or up to 30 days back). A venue manager or an admin.
create function public.area_photo_reconfirm(p_subject_id uuid, p_checked_on date default null, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_today date := private.london_today();
  v_checked date := coalesce(p_checked_on, private.london_today());
  v_note text := private.clean_text(p_note, 500, 'invalid_note');
  v_count integer;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select s.venue_id into v_venue from public.knowledge_subjects s where s.id = p_subject_id;
  if not found or not private.can_manage_venue(v_venue) then
    raise exception 'knowledge_subject_not_found' using errcode = 'P0002';
  end if;
  if v_checked > v_today or v_checked < v_today - 30 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('path', 'checkedOn', 'problem', 'out_of_range')))::text;
  end if;
  insert into public.area_photo_checks (label_id, venue_id, subject_id, kind, checked_on, reason, decided_by, decider_basis)
  select a.label_id, a.venue_id, p_subject_id, 'reconfirmed', v_checked, v_note, v_uid,
    case when private.is_active_admin() then 'admin' else 'venue_manager' end
  from private.area_photo_accepted_labels(p_subject_id) a;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('subjectId', p_subject_id, 'photos', v_count,
    'checkedOn', to_char(v_checked, 'YYYY-MM-DD'));
end;
$$;

-- A change to the place (spec §9.3: renovation, closed area). Anyone at the
-- venue may report one: its accepted photos become check due for a manager.
-- A venue manager or admin may say it is a known change (p_replacement):
-- they need replacing. A reason is required.
create function public.area_photo_report_change(p_subject_id uuid, p_reason text, p_replacement boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_basis text;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_count integer;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select s.venue_id into v_venue from public.knowledge_subjects s where s.id = p_subject_id;
  v_basis := case when v_venue is null then null else private.knowledge_basis(v_venue) end;
  if v_basis is null then
    raise exception 'knowledge_subject_not_found' using errcode = 'P0002';
  end if;
  if coalesce(p_replacement, false) and v_basis = 'staff' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  insert into public.area_photo_checks (label_id, venue_id, subject_id, kind, reason, decided_by, decider_basis)
  select a.label_id, a.venue_id, p_subject_id,
    case when coalesce(p_replacement, false) then 'replacement_needed' else 'change_reported' end,
    v_reason, v_uid, v_basis
  from private.area_photo_accepted_labels(p_subject_id) a;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('subjectId', p_subject_id, 'photos', v_count,
    'state', case when coalesce(p_replacement, false) then 'needs_replacement' else 'check_due' end);
end;
$$;

-- An explicit end date for one accepted area photo (spec §9.3 Expired): past
-- it, the photo leaves eligibility. A venue manager or an admin.
create function public.area_photo_set_end_date(p_label_id uuid, p_valid_until date, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_label public.media_area_labels;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select l.* into v_label from public.media_area_labels l where l.id = p_label_id;
  if not found or not private.can_manage_venue(v_label.venue_id)
     or not exists (select 1 from private.area_photo_accepted_labels(v_label.subject_id) a
       where a.label_id = p_label_id) then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  if p_valid_until is null or p_valid_until < private.london_today() then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('path', 'validUntil', 'problem',
          case when p_valid_until is null then 'required' else 'out_of_range' end)))::text;
  end if;
  insert into public.area_photo_checks (label_id, venue_id, subject_id, kind, valid_until, reason, decided_by, decider_basis)
  values (p_label_id, v_label.venue_id, v_label.subject_id, 'end_date_set', p_valid_until, v_reason, v_uid,
    case when private.is_active_admin() then 'admin' else 'venue_manager' end);
  return jsonb_build_object('labelId', p_label_id, 'validUntil', to_char(p_valid_until, 'YYYY-MM-DD'),
    'freshness', private.area_photo_freshness(p_label_id));
end;
$$;

-- Every accepted area photo of a venue with its freshness, oldest check first.
-- A venue manager or an admin.
create function public.area_photo_freshness_list(p_venue_id uuid default null)
returns table (
  label_id uuid,
  asset_id uuid,
  subject_id uuid,
  subject_kind text,
  subject_label text,
  state text,
  cause text,
  reason text,
  verified_on date,
  next_check_due timestamptz,
  due_soon boolean,
  valid_until date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  perform private.assert_can_manage_venue(v_venue);
  return query
  select r.label_id, r.asset_id, r.subject_id, s.kind, s.label,
    f ->> 'state', f ->> 'cause', f ->> 'reason',
    (f ->> 'verifiedOn')::date, (f ->> 'nextCheckDue')::timestamptz,
    coalesce((f ->> 'dueSoon')::boolean, false), (f ->> 'validUntil')::date
  from private.area_photo_rows(v_venue, null) r
  join public.knowledge_subjects s on s.id = r.subject_id
  cross join lateral private.area_photo_freshness(r.label_id) f
  where r.state = 'accepted' and r.ready and r.deleted_at is null
  order by (f ->> 'nextCheckDue')::timestamptz nulls first, r.label_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_verified_on(uuid, date, text, timestamptz),
  private.knowledge_next_check_on(uuid, timestamptz),
  private.knowledge_fact_verification(text, text, text),
  private.knowledge_fact_verification_for(text, jsonb, text),
  private.knowledge_fact_source_type(text, text, text, jsonb, text),
  private.knowledge_fact_rows(uuid, timestamptz),
  private.area_photo_freshness(uuid, timestamptz),
  private.area_photo_accepted_labels(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.knowledge_fact_states(uuid),
  public.knowledge_fact_coverage(uuid),
  public.knowledge_reconfirm(uuid, bigint, date, date, text, boolean),
  public.area_photo_reconfirm(uuid, date, text),
  public.area_photo_report_change(uuid, text, boolean),
  public.area_photo_set_end_date(uuid, date, text),
  public.area_photo_freshness_list(uuid)
from public, anon, service_role;
grant execute on function
  public.knowledge_fact_states(uuid),
  public.knowledge_fact_coverage(uuid),
  public.knowledge_reconfirm(uuid, bigint, date, date, text, boolean),
  public.area_photo_reconfirm(uuid, date, text),
  public.area_photo_report_change(uuid, text, boolean),
  public.area_photo_set_end_date(uuid, date, text),
  public.area_photo_freshness_list(uuid)
to authenticated;

revoke all on function public.knowledge_guest_answers(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.knowledge_guest_answers(uuid, text[], text) to service_role;
