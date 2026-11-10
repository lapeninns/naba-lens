-- B03-g: corrections, withdrawals, schema upgrades and history
-- (docs/knowledge/b03-design.md §9, §12 batch B03-g, §14 A1, A15, A16).
--
-- FLAG for WS5 and the reviewer: a withdrawn answer reads unavailable /
-- withdrawn / answer_withdrawn in the v1 reader; an answer under a schema a
-- newer version replaced (without a lossless upgrade rule) reads stale /
-- schema_changed. Nothing is withdrawn and no schema version exists, so
-- nothing changes today.
--
-- * public.knowledge_correct (§9.1): a manager account or an admin, never a
--   staff account holding a legacy grant (credit participants, §9.6). A
--   material change (the headline, or a field in the version's
--   material_fields) adds a 'correction' contribution, carrying the answer's
--   evidence and observation date, and adopts it through B01's
--   private.knowledge_adopt without carrying the confirmation: the new answer
--   needs confirmation by its rule. A non-material change adds no submission:
--   a 'corrected' decision and a knowledge_detail_corrections row that the
--   reads overlay on the answer's detail. Both record before, after, material
--   and selectionRule in the decision's new detail column.
-- * public.knowledge_withdraw (§9.2): a 'withdrawn' decision only; the
--   resolver view reads the slot withdrawn. No submission, check progress or
--   amenity_check_events row changes, so no credit input moves.
-- * Schema upgrades (§9.3): knowledge_question_versions.upgrade_rules names
--   lossless or needs_checking per old schema (e.g. presence@1);
--   public.knowledge_upgrade_run(p_key, p_mode) (admin; dry run then apply,
--   as §8.3) adds a derived detail row (derived_from_version) for lossless
--   answers and opens schema_changed rechecks for the others.
-- * History: public.knowledge_slot_history(p_check_id, p_at) and
--   public.knowledge_slot_events(p_check_id, p_cursor, p_limit) (A16),
--   managers and admins.
-- * Re-created: private.knowledge_slot_state_b03 (withdrawn, schema_changed,
--   detail overlay; same columns), private.knowledge_slot_json and
--   private.knowledge_policy_missing_for (overlay),
--   private.knowledge_open_rechecks (schema_changed),
--   private.knowledge_contribution_view (B01 body plus stateReason corrected
--   and withdrawn, A15), public.my_venue_capabilities (canCorrect,
--   canWithdraw, canReadHistory, A1).
-- * Additive schema: knowledge_contributions.kind gains 'correction';
--   knowledge_decisions.decision gains 'corrected' and 'withdrawn' and a
--   nullable detail column; knowledge_reconciliation_runs.kind gains
--   'upgrade'; knowledge_contribution_details gains derived_from_version.
-- * Not touched: amenity_submissions and its checks (T11a), the credit
--   trigger, media_assets_knowledge_evidence_withdrawn, the credit functions,
--   private.knowledge_slot_state and private.knowledge_adopt.
--
-- Rollback: a forward migration restores the B03-f and earlier bodies; the
-- tables and columns stay.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.knowledge_contributions drop constraint knowledge_contributions_kind_check;
alter table public.knowledge_contributions add constraint knowledge_contributions_kind_check
  check (kind in ('finding', 'change_report', 'detail', 'correction'));

alter table public.knowledge_decisions drop constraint knowledge_decisions_decision_check;
alter table public.knowledge_decisions add constraint knowledge_decisions_decision_check
  check (decision in ('adopted', 'confirmed', 'declined', 'revoked', 'detail_requested', 'seen', 'replaced',
    'reaffirmed', 'corrected', 'withdrawn'));
alter table public.knowledge_decisions add column detail jsonb
  check (detail is null or jsonb_typeof(detail) = 'object');

alter table public.knowledge_reconciliation_runs drop constraint knowledge_reconciliation_runs_kind_check;
alter table public.knowledge_reconciliation_runs add constraint knowledge_reconciliation_runs_kind_check
  check (kind in ('legacy', 'external', 'upgrade'));

alter table public.knowledge_contribution_details add column derived_from_version integer
  check (derived_from_version is null or derived_from_version >= 1);

-- { "<schema>@<version>": "lossless" | "needs_checking" } for older answers.
create function private.knowledge_upgrade_rules_valid(p_rules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_rules) = 'object'
    and not exists (select 1 from jsonb_each(p_rules) r
      where r.key !~ '^[a-z.]+@[0-9]+$' or r.value not in ('"lossless"'::jsonb, '"needs_checking"'::jsonb));
$$;

alter table public.knowledge_question_versions add column upgrade_rules jsonb not null default '{}'::jsonb
  constraint knowledge_question_versions_upgrade_rules check (private.knowledge_upgrade_rules_valid(upgrade_rules));

alter table public.knowledge_write_commands drop constraint knowledge_write_commands_command_check;
alter table public.knowledge_write_commands add constraint knowledge_write_commands_command_check
  check (command in ('place_add', 'place_retire', 'schedule_exception', 'source_declare', 'source_retire',
    'source_import', 'mapping_review', 'correct', 'withdraw'));

-- A non-material correction's detail, overlaid on the answer's (§9.1).
create table public.knowledge_detail_corrections (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.knowledge_contributions (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  detail jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  decision_id uuid not null references public.knowledge_decisions (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index knowledge_detail_corrections_latest
  on public.knowledge_detail_corrections (contribution_id, created_at desc, id desc);

do $$
begin
  execute 'create trigger knowledge_detail_corrections_append_only before update or delete on public.knowledge_detail_corrections for each row execute function private.append_only_guard()';
  execute 'create trigger knowledge_detail_corrections_no_truncate before truncate on public.knowledge_detail_corrections for each statement execute function private.append_only_guard()';
end;
$$;

revoke all on public.knowledge_detail_corrections from public, anon, authenticated, service_role;
grant select on public.knowledge_detail_corrections to service_role;
alter table public.knowledge_detail_corrections enable row level security;

-- The answer's detail with its latest non-material correction.
create function private.knowledge_effective_detail(p_contribution_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select dc.detail from public.knowledge_detail_corrections dc
      where dc.contribution_id = p_contribution_id order by dc.created_at desc, dc.id desc limit 1),
    (select d.detail from public.knowledge_contribution_details d where d.contribution_id = p_contribution_id));
$$;

-- ---------------------------------------------------------------------------
-- Re-created reads (§9.1 to §9.3)
-- ---------------------------------------------------------------------------

-- B03-e body plus the withdrawal branch (first, after not_enabled),
-- schema_changed, and the corrected detail overlay. Same columns.
create or replace function private.knowledge_slot_state_b03(p_venue_id uuid, p_keys text[], p_now timestamptz default now())
returns table (
  venue_id uuid,
  question_key text,
  check_id uuid,
  in_scope boolean,
  status text,
  reason text,
  detail text,
  revision bigint,
  question_version integer,
  value text,
  current_answer text,
  current_submission_id uuid,
  current_contribution_id uuid,
  contribution_kind text,
  source_basis text,
  finding text,
  limitations text,
  reason_text text,
  confirmation_required boolean,
  confirmation_state text,
  confirmation_basis text,
  confirmation_self boolean,
  confirmation_saved_at timestamptz,
  evidence_photos integer,
  evidence_videos integer,
  evidence_state text,
  redaction_proof text,
  saved_at timestamptz,
  sent_at timestamptz,
  observed_at timestamptz,
  next_check_due timestamptz,
  freshness_state text,
  pending_count integer,
  open_dispute boolean,
  last_unknown_at timestamptz,
  last_unknown_preset text,
  rule_version integer,
  check_status text,
  check_progress text,
  qualifier text,
  qualified_detail jsonb,
  value_schema text,
  policy_missing jsonb,
  freshness jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.venue_id,
    s.question_key,
    s.check_id,
    s.in_scope,
    case when o.reason is null then s.status else 'unavailable' end,
    coalesce(o.reason, s.reason),
    coalesce(o.detail, s.detail),
    s.revision,
    s.question_version,
    case when o.reason is null then s.value end,
    s.current_answer,
    s.current_submission_id,
    s.current_contribution_id,
    s.contribution_kind,
    s.source_basis,
    s.finding,
    s.limitations,
    s.reason_text,
    s.confirmation_required,
    s.confirmation_state,
    s.confirmation_basis,
    s.confirmation_self,
    s.confirmation_saved_at,
    s.evidence_photos,
    s.evidence_videos,
    s.evidence_state,
    s.redaction_proof,
    s.saved_at,
    s.sent_at,
    s.observed_at,
    (f.internal ->> 'nextCheckDue')::timestamptz,
    f.internal ->> 'state',
    s.pending_count,
    s.open_dispute,
    s.last_unknown_at,
    s.last_unknown_preset,
    s.rule_version,
    s.check_status,
    s.check_progress,
    q.qualifier,
    case when q.qualifier is not null then kd.detail end,
    kd.value_schema,
    q.missing,
    f.entries
  from private.knowledge_slot_state(p_venue_id, p_keys) s
  left join lateral (
    select d.contribution_id, d.value_schema, d.value_schema_version, d.question_version, d.observed_on,
      coalesce((select dc.detail from public.knowledge_detail_corrections dc
        where dc.contribution_id = z.cid order by dc.created_at desc, dc.id desc limit 1), d.detail) as detail
    from (select s.current_contribution_id as cid) z
    left join public.knowledge_contribution_details d on d.contribution_id = z.cid
    where z.cid is not null
  ) kd on true
  -- B03-g (§9.2): a withdrawal decision on the answer in use.
  cross join lateral (
    select exists (select 1 from public.knowledge_decisions wd
      where wd.submission_id = s.current_submission_id and wd.decision = 'withdrawn') as withdrawn
  ) wd
  -- B03-g (§9.3): an answer given under an older version whose schema the
  -- latest version replaced, unless that version names a lossless upgrade.
  cross join lateral (
    select coalesce(
      s.current_submission_id is not null
      and lv.version > coalesce(kd.question_version, 1)
      and lv.value_schema is distinct from coalesce(kd.value_schema, v1.value_schema)
      and coalesce(lv.upgrade_rules ->> (coalesce(kd.value_schema, v1.value_schema) || '@'
        || coalesce(kd.value_schema_version, v1.value_schema_version)), 'needs_checking') <> 'lossless',
      false) as changed
    from (select 1) one
    left join lateral (select v.* from public.knowledge_question_versions v where v.key = s.question_key
      order by v.version desc limit 1) lv on true
    left join lateral (select v.* from public.knowledge_question_versions v where v.key = s.question_key
      and v.version = 1) v1 on true
  ) sc
  cross join lateral (
    select private.knowledge_qualifier(kd.value_schema, s.current_answer, kd.detail) as qualifier,
      case when kd.value_schema = 'policy'
        then private.knowledge_policy_missing_for(s.current_contribution_id, s.confirmation_basis, true)
      end as missing
  ) q
  cross join lateral (
    select x.entries, x.entries -> 0 as internal
    from (select private.knowledge_slot_freshness(p_venue_id, s.question_key, s.current_submission_id,
      kd.value_schema, kd.detail, kd.observed_on, p_now) as entries) x
  ) f
  cross join lateral (
    select
      case
        when wd.withdrawn and coalesce(s.reason, '') <> 'not_enabled' then 'withdrawn'
        when s.status <> 'available' then null
        when sc.changed then 'stale'
        when f.internal ->> 'state' in ('expired', 'basis_missing') then 'stale'
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'not_confirmed'
        when q.qualifier is not null then 'stale'
      end as reason,
      case
        when wd.withdrawn and coalesce(s.reason, '') <> 'not_enabled' then 'answer_withdrawn'
        when s.status <> 'available' then null
        when sc.changed then 'schema_changed'
        when f.internal ->> 'state' in ('expired', 'basis_missing') then f.internal ->> 'state'
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'policy_incomplete'
        when q.qualifier is not null then 'qualified_answer'
      end as detail
  ) o;
$$;

-- B03-e body reading the corrected detail overlay.
create or replace function private.knowledge_slot_json(
  p_check public.venue_amenity_checks,
  p_viewer uuid,
  p_basis text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'checkId', p_check.id,
    'venueId', p_check.venue_id,
    'questionKey', p_check.template_key,
    'question', t.question,
    'category', t.category,
    'evidenceRule', t.evidence_rule,
    'captureBrief', t.capture_brief,
    'inScope', st.in_scope,
    'slotRevision', st.revision,
    'status', st.status,
    'reason', st.reason,
    'detail', st.detail,
    'progress', p_check.progress,
    'checkStatus', p_check.status,
    'answerInUse', case when st.current_answer is not null and p_check.progress = 'complete' then jsonb_build_object(
      'value', st.current_answer, 'available', st.status = 'available', 'reason', st.reason,
      'savedAt', st.saved_at, 'sentAt', st.sent_at, 'lastCheckedAt', null,
      'confirmed', st.confirmation_state = 'confirmed', 'confirmationState', st.confirmation_state,
      'evidenceState', st.evidence_state,
      -- B03-b: the answer's structured detail and observation date.
      'detail', kd.detail, 'detailRecorded', kd.contribution_id is not null, 'observedOn', kd.observed_on,
      -- B03-c (§3.8): a qualified answer's real value, for B03-aware screens.
      'qualified', case when st.qualifier is not null then
        jsonb_build_object('qualifier', st.qualifier, 'detail', st.qualified_detail) end,
      -- B03-d (A25): the schedule version in use, for knowledge_schedule_exception.
      'scheduleId', (
        select s.id from public.knowledge_schedules s
        where s.check_id = p_check.id and s.submission_id = st.current_submission_id
        order by s.created_at desc, s.id desc limit 1))
      -- B03-c (A5): what a policy answer still needs; absent on other keys.
      || case when st.policy_missing is not null
        then jsonb_build_object('policyMissing', st.policy_missing) else '{}'::jsonb end
      -- Who confirmed it, for the people who decide (null until confirmed).
      || case when p_basis in ('venue_manager', 'admin') then jsonb_build_object(
        'confirmedByFirstName', case when st.confirmation_state = 'confirmed' then (
          select split_part(cp.display_name, ' ', 1)
          from public.knowledge_decisions d
          join public.profiles cp on cp.id = d.decided_by
          where d.submission_id = st.current_submission_id and d.decision = 'confirmed'
          order by d.created_at desc, d.id desc limit 1) end,
        'confirmedAt', st.confirmation_saved_at,
        'confirmedSelf', st.confirmation_self) else '{}'::jsonb end end,
    'previousAnswer', case when p_check.progress = 'needs_recheck' then st.current_answer end,
    'requiresConfirmation', st.confirmation_required,
    'latestAttempt', case when st.last_unknown_at is not null then jsonb_build_object(
      'outcome', 'unknown', 'preset', st.last_unknown_preset, 'at', st.last_unknown_at) end,
    -- Staff see the assignee's first name only (D3); managers also get the id.
    'assignee', case when p_check.assignee_user_id is not null then jsonb_build_object(
      'firstName', split_part(ap.display_name, ' ', 1),
      'isMe', p_check.assignee_user_id = p_viewer)
      || case when p_basis in ('venue_manager', 'admin')
        then jsonb_build_object('id', p_check.assignee_user_id) else '{}'::jsonb end end,
    'mode', case
      when not st.in_scope or p_basis is null or p_check.status <> 'active' then 'none'
      when p_basis in ('venue_manager', 'admin') then
        case when p_check.progress = 'needs_recheck' then 'recheck' else 'answer' end
      when p_check.progress = 'complete' then 'change'
      when p_check.assignee_user_id is not null and p_check.assignee_user_id <> p_viewer then 'add'
      when p_check.progress = 'needs_recheck' then 'recheck'
      else 'answer'
    end,
    'othersPending', (
      select count(*) from public.knowledge_contributions x
      where x.check_id = p_check.id and x.contributed_by <> p_viewer
        and not private.knowledge_is_terminal(x.id)
    ),
    'myLatest', (
      select private.knowledge_contribution_view(x.id) from public.knowledge_contributions x
      where x.check_id = p_check.id and x.contributed_by = p_viewer
      order by x.created_at desc, x.id desc limit 1
    ),
    'myDraft', (
      select jsonb_build_object('savedAt', d.updated_at, 'draftRevision', d.draft_revision)
      from public.knowledge_drafts d
      where d.user_id = p_viewer and d.check_id = p_check.id and d.updated_at >= now() - interval '90 days'
    ),
    'closedAssignment', (
      select jsonb_build_object('eventId', e.id, 'answeredBy', bp.display_name, 'at', e.created_at)
      from public.knowledge_events e
      left join public.profiles bp on bp.id = (e.detail ->> 'answeredBy')::uuid
      where e.check_id = p_check.id and e.kind = 'assignment_closed_by_other'
        and e.detail ->> 'assigneeId' = p_viewer::text
        and e.created_at >= now() - interval '14 days'
        and not exists (
          select 1 from public.knowledge_outcome_dismissals od where od.user_id = p_viewer and od.event_id = e.id
        )
      order by e.id desc limit 1
    )
  )
  || jsonb_build_object(
    -- Per use (A10), from the question's freshness policies (§7.3).
    'freshness', st.freshness
  )
  from private.knowledge_slot_state_b03(p_check.venue_id, array[p_check.template_key]) st
  join public.amenity_catalogue t on t.key = p_check.template_key
  left join lateral (
    select d.contribution_id, d.value_schema, d.value_schema_version, d.question_version, d.observed_on,
      coalesce((select dc.detail from public.knowledge_detail_corrections dc
        where dc.contribution_id = z.cid order by dc.created_at desc, dc.id desc limit 1), d.detail) as detail
    from (select st.current_contribution_id as cid) z
    left join public.knowledge_contribution_details d on d.contribution_id = z.cid
    where z.cid is not null
  ) kd on true
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

-- B03-c body reading the corrected detail overlay.
create or replace function private.knowledge_policy_missing_for(
  p_contribution_id uuid, p_confirmed_basis text, p_check_confirmation boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.knowledge_policy_missing(x.answer, kd.detail, coalesce(qv.requires_zones, false),
    p_confirmed_basis, p_check_confirmation)
  from public.knowledge_contributions x
  join lateral (
    select d.value_schema, d.question_version,
      coalesce((select dc.detail from public.knowledge_detail_corrections dc
        where dc.contribution_id = d.contribution_id order by dc.created_at desc, dc.id desc limit 1), d.detail) as detail
    from public.knowledge_contribution_details d where d.contribution_id = x.id and d.value_schema = 'policy'
  ) kd on true
  join public.venue_amenity_checks c on c.id = x.check_id
  left join public.knowledge_question_versions qv on qv.key = c.template_key and qv.version = kd.question_version
  where x.id = p_contribution_id;
$$;

-- B03-e body plus schema_changed rechecks.
create or replace function private.knowledge_open_rechecks(p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_keys text[];
  v_row record;
  v_entry jsonb;
  v_due timestamptz;
  v_until date;
  v_schedule public.knowledge_schedules;
  v_today date := (p_now at time zone 'Europe/London')::date;
  v_count integer;
  v_opened integer := 0;
  v_check uuid;
begin
  for v_venue, v_keys in
    select w.venue_id, array_agg(w.question_key order by w.question_key)
    from public.knowledge_working_list w where w.disabled_at is null
    group by w.venue_id order by w.venue_id
  loop
    for v_row in
      select st.* from private.knowledge_slot_state_b03(v_venue, v_keys, p_now) st
      where st.in_scope and st.current_submission_id is not null
        and st.check_progress = 'complete' and st.check_status = 'active'
    loop
      for v_entry in
        select e from jsonb_array_elements(v_row.freshness) e
        where e ->> 'state' in ('due_soon', 'expired', 'basis_missing')
      loop
        v_due := coalesce((v_entry ->> 'nextCheckDue')::timestamptz, v_row.saved_at);
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        select v_venue, v_row.check_id, v_row.question_key, v_entry ->> 'state', v_entry ->> 'use', v_due
        where not exists (
          select 1 from public.knowledge_recheck_tasks t
          where t.check_id = v_row.check_id and t.use = v_entry ->> 'use' and t.due_at = v_due and t.state = 'open')
        on conflict on constraint knowledge_recheck_tasks_once do nothing;
        get diagnostics v_count = row_count;
        v_opened := v_opened + v_count;
      end loop;
      v_until := private.knowledge_safe_date(v_row.qualified_detail -> 'availability' ->> 'until');
      if v_row.qualifier = 'temporarily_unavailable' and v_until < v_today then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'temporary_until_passed', 'internal',
          (v_until + 1)::timestamp at time zone private.venue_timezone(v_venue))
        on conflict on constraint knowledge_recheck_tasks_once do nothing;
        get diagnostics v_count = row_count;
        v_opened := v_opened + v_count;
      end if;
      -- B03-g (§9.3): an answer under a replaced schema needs checking.
      if v_row.detail = 'schema_changed' then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'schema_changed', 'internal',
          (select v.created_at from public.knowledge_question_versions v where v.key = v_row.question_key
           order by v.version desc limit 1))
        on conflict on constraint knowledge_recheck_tasks_once do nothing;
        get diagnostics v_count = row_count;
        v_opened := v_opened + v_count;
      end if;
      v_schedule := private.knowledge_schedule_in_use(v_row.check_id);
      if v_schedule.effective_to < v_today then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'schedule_ended', 'internal',
          (v_schedule.effective_to + 1)::timestamp at time zone v_schedule.timezone)
        on conflict on constraint knowledge_recheck_tasks_once do nothing;
        get diagnostics v_count = row_count;
        v_opened := v_opened + v_count;
      end if;
    end loop;
  end loop;
  for v_check in
    select distinct t.check_id from public.knowledge_recheck_tasks t where t.state = 'open' order by 1
  loop
    perform private.knowledge_close_rechecks(v_check, null);
  end loop;
  return v_opened;
end;
$$;

-- B01 body plus stateReason corrected and withdrawn, with the reason (A15).
create or replace function private.knowledge_contribution_view(p_contribution_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'findingRef', jsonb_build_object('type', 'contribution', 'id', x.id),
    'checkId', x.check_id,
    'venueId', x.venue_id,
    'venueName', v.name,
    'questionKey', x.question_key,
    'question', t.question,
    'kind', x.kind,
    'answer', x.answer,
    'unknownPreset', x.unknown_preset,
    'sentAt', x.created_at,
    'decidedAt', d.created_at,
    'state', case
      when d.decision = 'adopted' and ad.decision = 'withdrawn' then 'no_longer_used'
      when d.decision = 'adopted' then
        case when c.current_submission_id = d.resulting_submission_id and c.progress = 'complete' and c.status = 'active'
          then 'current' else 'no_longer_used' end
      when d.decision = 'declined' then 'not_confirmed'
      when d.decision = 'replaced' then 'no_longer_used'
      when d.decision = 'seen' then 'submitted'
      when d.decision = 'detail_requested' then 'needs_attention'
      when x.answer = 'unknown' then 'submitted'
      else 'awaiting_confirmation'
    end,
    'stateReason', case
      -- B03-g (A15): a withdrawal or a material correction took it out of use.
      when d.decision = 'adopted' and ad.decision = 'withdrawn' then 'withdrawn'
      when d.decision = 'adopted' and ad.decision = 'corrected'
        and c.current_submission_id is distinct from d.resulting_submission_id then 'corrected'
      when d.decision = 'adopted' and not (c.current_submission_id = d.resulting_submission_id and c.progress = 'complete' and c.status = 'active') then
        case
          when c.status = 'archived' then 'archived'
          when c.current_submission_id is distinct from d.resulting_submission_id then 'replaced_by_newer'
          else 'reopened'
        end
      when d.decision = 'replaced' then 'replaced_by_own'
    end,
    'managerNote', case
      when d.decision in ('declined', 'detail_requested') then d.note
      when d.decision = 'adopted' and ad.decision = 'withdrawn' then ad.note
      when d.decision = 'adopted' and ad.decision = 'corrected'
        and c.current_submission_id is distinct from d.resulting_submission_id then ad.note
    end,
    'detailRequestId', case when d.decision = 'detail_requested' then d.id end,
    'recognition', case
      when d.decision = 'adopted' then private.knowledge_submission_scored(d.resulting_submission_id)
      when x.answer = 'unknown' or d.decision in ('declined', 'replaced') then jsonb_build_object('kind', 'not_scored')
      else jsonb_build_object('kind', 'pending')
    end
  )
  from public.knowledge_contributions x
  join public.venue_amenity_checks c on c.id = x.check_id
  join public.venues v on v.id = x.venue_id
  join public.amenity_catalogue t on t.key = x.question_key
  left join lateral (
    select d.* from public.knowledge_decisions d
    where d.contribution_id = x.id and d.decision in ('adopted', 'declined', 'replaced', 'seen', 'detail_requested')
    order by (d.decision in ('adopted', 'declined', 'replaced', 'seen')) desc, d.created_at desc, d.id desc
    limit 1
  ) d on true
  left join lateral (
    select a.decision, a.note from public.knowledge_decisions a
    where d.decision = 'adopted' and a.submission_id = d.resulting_submission_id
      and (a.decision = 'withdrawn' or (a.decision = 'corrected' and a.resulting_submission_id is not null))
    order by a.created_at desc, a.id desc limit 1
  ) ad on true
  where x.id = p_contribution_id;
$$;

-- B03-b body plus canCorrect, canWithdraw and canReadHistory (A1).
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
    'canManagePlaces', v_manage,
    -- B03-g (A1, §9.1, OD-18): a manager account or an admin, never a staff
    -- account holding a legacy grant (credit participants).
    'canCorrect', v_manage and (v_admin or v_role = 'manager'),
    'canWithdraw', v_manage and (v_admin or v_role = 'manager'),
    'canReadHistory', coalesce(v_basis in ('venue_manager', 'admin'), false),
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

-- ---------------------------------------------------------------------------
-- Commands (§9.1, §9.2)
-- ---------------------------------------------------------------------------

-- private.knowledge_decision with the decision's detail set at insert
-- (knowledge_decisions is append-only).
create function private.knowledge_decision_detailed(
  p_check public.venue_amenity_checks, p_submission_id uuid, p_decision text, p_decided_by uuid, p_basis text,
  p_rule_version integer, p_note text, p_slot_revision bigint, p_resulting_submission_id uuid, p_detail jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.knowledge_decisions (
    venue_id, check_id, question_key, contribution_id, submission_id, decision, decided_by,
    decider_basis, self_confirmed, rule_version, note, slot_revision, resulting_submission_id, detail
  )
  values (
    p_check.venue_id, p_check.id, p_check.template_key, null, p_submission_id, p_decision, p_decided_by,
    p_basis, false, p_rule_version, p_note, p_slot_revision, p_resulting_submission_id, p_detail
  )
  returning id into v_id;
  perform private.knowledge_event(p_check.venue_id, p_check.template_key, p_check.id, 'decision_recorded',
    null, coalesce(p_resulting_submission_id, p_submission_id), v_id, jsonb_build_object('decision', p_decision));
  return v_id;
end;
$$;

-- A manager account or an admin at the check's venue (not a staff account
-- holding a legacy grant), as knowledge_basis reads it.
create function private.knowledge_corrector_basis(p_venue_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_basis text := private.knowledge_basis(p_venue_id);
begin
  if v_basis is null then
    return null;
  end if;
  if v_basis = 'admin' or (v_basis = 'venue_manager' and private.is_active_manager()) then
    return v_basis;
  end if;
  return 'refused';
end;
$$;

create function public.knowledge_withdraw(
  p_check_id uuid, p_slot_revision bigint, p_idempotency_key uuid, p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_hash text := private.knowledge_hash(jsonb_build_object('checkId', p_check_id, 'slotRevision', p_slot_revision,
    'reason', v_reason));
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_basis text;
  v_revision bigint;
  v_rule public.knowledge_question_rules;
  v_decision uuid;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'withdraw', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_corrector_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'refused' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_check.current_submission_id is null or v_check.progress <> 'complete' or v_check.status <> 'active' then
    raise exception 'knowledge_not_current' using errcode = 'NLK08';
  end if;
  if exists (select 1 from public.knowledge_decisions d
             where d.submission_id = v_check.current_submission_id and d.decision = 'withdrawn') then
    raise exception 'already_decided' using errcode = 'NLK03';
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_decision := private.knowledge_decision_detailed(v_check, v_check.current_submission_id, 'withdrawn', v_uid,
    v_basis, v_rule.rule_version, v_reason, v_revision, null, jsonb_build_object('selectionRule', 'withdrawal'));
  v_result := jsonb_build_object('decisionId', v_decision,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key), 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'withdraw', v_hash, v_check.venue_id, v_result);
  return v_result;
end;
$$;

create function public.knowledge_correct(
  p_check_id uuid, p_slot_revision bigint, p_idempotency_key uuid, p_headline text, p_detail jsonb, p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_after_detail jsonb := case when p_detail is null or p_detail = 'null'::jsonb or p_detail = '{}'::jsonb
    then null else p_detail end;
  v_hash text := private.knowledge_hash(jsonb_build_object('checkId', p_check_id, 'slotRevision', p_slot_revision,
    'headline', p_headline, 'detail', v_after_detail, 'reason', v_reason));
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_basis text;
  v_revision bigint;
  v_rule public.knowledge_question_rules;
  v_version public.knowledge_question_versions;
  v_submission public.amenity_submissions;
  v_current_detail public.knowledge_contribution_details;
  v_before_detail jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_message text;
  v_error text;
  v_material boolean;
  v_field text;
  v_contribution public.knowledge_contributions;
  v_new_submission uuid;
  v_decision uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'correct', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_corrector_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'refused' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  -- B01 lock order: profile, key, assets, check.
  perform 1 from public.media_assets a
  where a.id in (select sa.asset_id from public.amenity_submission_assets sa
                 where sa.submission_id = v_check.current_submission_id)
  order by a.id for share;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_check.current_submission_id is null or v_check.progress <> 'complete' or v_check.status <> 'active' then
    raise exception 'knowledge_not_current' using errcode = 'NLK08';
  end if;
  select s.* into v_submission from public.amenity_submissions s where s.id = v_check.current_submission_id;
  select d.* into v_current_detail from public.knowledge_contribution_details d
  where d.contribution_id = v_submission.source_contribution_id;
  v_before_detail := private.knowledge_effective_detail(v_submission.source_contribution_id);
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = v_check.template_key order by v.version desc limit 1;
  v_rule := private.knowledge_rule(v_check.template_key);

  if p_headline is null or p_headline not in ('yes', 'no', 'not_applicable') then
    v_fields := v_fields || jsonb_build_object('path', 'headline',
      'problem', case when p_headline is null then 'required' else 'not_allowed' end);
  elsif v_version.value_schema = 'connectivity.wifi' then
    if v_after_detail is not null then
      v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
    end if;
  else
    begin
      perform private.knowledge_validate_value(v_version.value_schema, v_version.value_schema_version,
        p_headline, v_after_detail);
    exception when others then
      get stacked diagnostics v_message = message_text, v_error = pg_exception_detail;
      if v_message <> 'invalid_value' then
        raise;
      end if;
      v_fields := v_fields || (v_error::jsonb -> 'fields');
    end;
    v_fields := v_fields || private.knowledge_detail_venue_problems(v_check.venue_id, v_check.template_key,
      p_headline, v_after_detail);
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023', detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  v_before := jsonb_build_object('headline', v_submission.answer, 'detail', v_before_detail);
  v_after := jsonb_build_object('headline', p_headline, 'detail', v_after_detail);
  if v_before = v_after then
    raise exception 'nothing_to_correct' using errcode = '22023';
  end if;
  v_material := p_headline is distinct from v_submission.answer;
  foreach v_field in array coalesce(v_version.material_fields, '{}'::text[]) loop
    if v_field <> 'headline' and (v_before_detail -> v_field) is distinct from (v_after_detail -> v_field) then
      v_material := true;
    end if;
  end loop;

  if not v_material then
    -- A detail fix on the answer in use: no submission, the confirmation stays.
    if v_submission.source_contribution_id is null then
      raise exception 'knowledge_not_current' using errcode = 'NLK08';
    end if;
    v_decision := private.knowledge_decision_detailed(v_check, v_submission.id, 'corrected', v_uid, v_basis,
      v_rule.rule_version, v_reason, v_revision, null,
      jsonb_build_object('before', v_before, 'after', v_after, 'material', false, 'selectionRule', 'correction'));
    insert into public.knowledge_detail_corrections (contribution_id, venue_id, detail, decision_id)
    values (v_submission.source_contribution_id, v_check.venue_id, v_after_detail, v_decision);
  else
    insert into public.knowledge_contributions (
      venue_id, check_id, question_key, contributed_by, contributor_basis, kind, answer, finding, limitations, reason,
      based_on_slot_revision, based_on_submission_id, rule_version, template_version, evidence_rule,
      confirm_own, initial_outcome, idempotency_key, request_hash
    )
    select v_check.venue_id, v_check.id, v_check.template_key, v_uid, v_basis, 'correction', p_headline,
      v_submission.finding, v_submission.limitations,
      case when p_headline in ('no', 'not_applicable') then v_reason end,
      v_revision, v_submission.id, coalesce(v_rule.rule_version, 1), t.catalogue_version, t.evidence_rule, false,
      case when coalesce(v_rule.confirmation, 'none') = 'none' then 'current' else 'awaiting_confirmation' end,
      gen_random_uuid(), v_hash
    from public.amenity_catalogue t where t.key = v_check.template_key
    returning * into v_contribution;
    -- The answer's evidence and observation stay with it.
    insert into public.knowledge_contribution_assets (contribution_id, venue_id, asset_id, evidence_kind)
    select v_contribution.id, v_check.venue_id, sa.asset_id, sa.evidence_kind
    from public.amenity_submission_assets sa
    join public.media_assets a on a.id = sa.asset_id and a.deleted_at is null and a.upload_state = 'ready'
    where sa.submission_id = v_submission.id;
    if v_after_detail is not null or v_current_detail.observed_on is not null then
      insert into public.knowledge_contribution_details (contribution_id, venue_id, question_version, value_schema,
        value_schema_version, detail, observed_on, observed_on_source, request_hash)
      values (v_contribution.id, v_check.venue_id, v_version.version, v_version.value_schema,
        v_version.value_schema_version, v_after_detail, v_current_detail.observed_on,
        v_current_detail.observed_on_source, v_hash);
    end if;
    perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id, 'contribution_recorded',
      v_contribution.id, null, null, jsonb_build_object('kind', 'correction'));
    -- B01 adoption; the earlier confirmation is not carried (§9.1).
    v_new_submission := private.knowledge_adopt(v_contribution, v_check, v_uid, v_basis, false, false, v_revision,
      v_rule.rule_version);
    v_decision := private.knowledge_decision_detailed(v_check, v_submission.id, 'corrected', v_uid, v_basis,
      v_rule.rule_version, v_reason, v_revision, v_new_submission,
      jsonb_build_object('before', v_before, 'after', v_after, 'material', true, 'selectionRule', 'correction',
        'contributionId', v_contribution.id));
  end if;

  v_result := jsonb_build_object('decisionId', v_decision, 'material', v_material, 'submissionId', v_new_submission,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key), 'replayed', false,
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id));
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'correct', v_hash, v_check.venue_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schema upgrades (§9.3)
-- ---------------------------------------------------------------------------

create function private.knowledge_upgrade_candidates(p_key text)
returns table (venue_id uuid, check_id uuid, contribution_id uuid, old_schema text, rule text, state text)
language sql
stable
security definer
set search_path = ''
as $$
  with lv as (
    select v.* from public.knowledge_question_versions v where v.key = p_key order by v.version desc limit 1
  ),
  v1 as (
    select v.* from public.knowledge_question_versions v where v.key = p_key and v.version = 1
  )
  select c.venue_id, c.id, s.source_contribution_id,
    coalesce(d.value_schema, v1.value_schema) || '@' || coalesce(d.value_schema_version, v1.value_schema_version),
    coalesce(lv.upgrade_rules ->> (coalesce(d.value_schema, v1.value_schema) || '@'
      || coalesce(d.value_schema_version, v1.value_schema_version)), 'needs_checking'),
    case
      when d.derived_from_version is not null and d.question_version >= lv.version then 'already'
      when lv.version <= coalesce(d.question_version, 1) then 'current_schema'
      when coalesce(d.value_schema, v1.value_schema) = lv.value_schema then 'current_schema'
      else 'upgrade'
    end
  from public.venue_amenity_checks c
  join public.amenity_submissions s on s.id = c.current_submission_id
  left join public.knowledge_contribution_details d on d.contribution_id = s.source_contribution_id
  cross join lv
  cross join v1
  where c.template_key = p_key and c.progress = 'complete' and c.status = 'active';
$$;

create function public.knowledge_upgrade_run(p_key text, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_assert_admin();
  v_version public.knowledge_question_versions;
  v_revisions jsonb;
  v_counts jsonb;
  v_dry public.knowledge_reconciliation_runs;
  v_run uuid;
  v_c record;
  v_derived integer := 0;
  v_opened integer;
begin
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = p_key order by v.version desc limit 1;
  if not found then
    raise exception 'knowledge_question_not_found' using errcode = 'P0002';
  end if;
  if p_mode is null or p_mode not in ('dry_run', 'apply') then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('path', 'mode', 'problem', 'invalid')))::text;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_knowledge_upgrade:' || p_key, 0));
  v_revisions := jsonb_build_object(p_key, v_version.version);
  select jsonb_build_object(
      'answers', count(*),
      'lossless', count(*) filter (where c.state = 'upgrade' and c.rule = 'lossless'),
      'needsChecking', count(*) filter (where c.state = 'upgrade' and c.rule = 'needs_checking'),
      'alreadyUpgraded', count(*) filter (where c.state = 'already'),
      'currentSchema', count(*) filter (where c.state = 'current_schema'))
  into v_counts
  from private.knowledge_upgrade_candidates(p_key) c;

  if p_mode = 'dry_run' then
    insert into public.knowledge_reconciliation_runs (kind, mode, started_by, counts, source_revisions)
    values ('upgrade', 'dry_run', v_uid, v_counts || jsonb_build_object('key', p_key), v_revisions)
    returning id into v_run;
    return jsonb_build_object('runId', v_run, 'mode', 'dry_run', 'counts', v_counts, 'sourceRevisions', v_revisions);
  end if;

  select r.* into v_dry from public.knowledge_reconciliation_runs r
  where r.kind = 'upgrade' and r.mode = 'dry_run' and r.counts ->> 'key' = p_key
    and r.started_at > now() - interval '24 hours'
  order by r.started_at desc, r.id desc limit 1;
  if v_dry.id is null then
    raise exception 'reconcile_dry_run_required' using errcode = 'NLK12';
  end if;
  if v_dry.source_revisions is distinct from v_revisions then
    raise exception 'reconcile_source_changed' using errcode = 'NLK12',
      detail = jsonb_build_object('changed', jsonb_build_array(p_key))::text;
  end if;
  insert into public.knowledge_reconciliation_runs (kind, mode, dry_run_id, started_by, counts, source_revisions)
  values ('upgrade', 'apply', v_dry.id, v_uid, v_counts || jsonb_build_object('key', p_key), v_revisions)
  returning id into v_run;

  for v_c in
    select c.* from private.knowledge_upgrade_candidates(p_key) c
    where c.state = 'upgrade' and c.rule = 'lossless' and c.contribution_id is not null
      and not exists (select 1 from public.knowledge_contribution_details d where d.contribution_id = c.contribution_id)
    order by c.check_id
  loop
    insert into public.knowledge_contribution_details (contribution_id, venue_id, question_version, value_schema,
      value_schema_version, detail, request_hash, derived_from_version)
    values (v_c.contribution_id, v_c.venue_id, v_version.version, v_version.value_schema, v_version.value_schema_version,
      null, encode(sha256(convert_to('upgrade:' || v_c.contribution_id::text || ':' || v_version.version, 'UTF8')), 'hex'),
      1);
    perform private.knowledge_event(v_c.venue_id, p_key, v_c.check_id, 'question_version_changed', v_c.contribution_id,
      null, null, jsonb_build_object('runId', v_run, 'version', v_version.version, 'rule', 'lossless'));
    v_derived := v_derived + 1;
  end loop;
  -- needs_checking answers of this key only: one schema_changed recheck each.
  insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
  select c.venue_id, c.check_id, p_key, 'schema_changed', 'internal', v_version.created_at
  from private.knowledge_upgrade_candidates(p_key) c
  where c.state = 'upgrade' and c.rule = 'needs_checking'
  on conflict on constraint knowledge_recheck_tasks_once do nothing;
  get diagnostics v_opened = row_count;
  return jsonb_build_object('runId', v_run, 'mode', 'apply', 'dryRunId', v_dry.id, 'counts', v_counts,
    'derived', v_derived, 'rechecksOpened', v_opened, 'sourceRevisions', v_revisions);
end;
$$;

-- ---------------------------------------------------------------------------
-- History (§9.4, A16)
-- ---------------------------------------------------------------------------

-- Managers and admins: the answer in use at p_at, rebuilt from append-only
-- rows: the submission then, its confirmation and withdrawal, its detail as
-- corrected by then, its version, and what selected it.
create function public.knowledge_slot_history(p_check_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks;
  v_basis text;
  v_submitted record;
  v_cleared boolean;
  v_submission public.amenity_submissions;
  v_contribution public.knowledge_contributions;
  v_confirmation text;
  v_withdrawn boolean;
  v_detail jsonb;
  v_version integer;
  v_rule text;
begin
  perform private.amenity_assert_active_user();
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  v_basis := case when found then private.knowledge_basis(v_check.venue_id) end;
  if v_basis is null or v_basis = 'staff' then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  select e.id, e.created_at, (e.detail ->> 'submissionId')::uuid as submission_id into v_submitted
  from public.amenity_check_events e
  where e.check_id = v_check.id and e.kind = 'submitted' and e.created_at <= p_at
  order by e.created_at desc, e.id desc limit 1;
  v_cleared := v_submitted.id is null or exists (
    select 1 from public.amenity_check_events e
    where e.check_id = v_check.id and e.kind in ('reopened', 'evidence_lost', 'archived')
      and e.created_at <= p_at and (e.created_at, e.id) > (v_submitted.created_at, v_submitted.id));
  if v_cleared then
    return jsonb_build_object('checkId', v_check.id, 'at', p_at, 'answerInUse', null);
  end if;
  select s.* into v_submission from public.amenity_submissions s where s.id = v_submitted.submission_id;
  select x.* into v_contribution from public.knowledge_contributions x where x.id = v_submission.source_contribution_id;
  select d.decision into v_confirmation from public.knowledge_decisions d
  where d.submission_id = v_submission.id and d.decision in ('confirmed', 'revoked') and d.created_at <= p_at
  order by d.created_at desc, d.id desc limit 1;
  v_withdrawn := exists (select 1 from public.knowledge_decisions d
    where d.submission_id = v_submission.id and d.decision = 'withdrawn' and d.created_at <= p_at);
  v_detail := coalesce(
    (select dc.detail from public.knowledge_detail_corrections dc
     where dc.contribution_id = v_contribution.id and dc.created_at <= p_at
     order by dc.created_at desc, dc.id desc limit 1),
    (select d.detail from public.knowledge_contribution_details d
     where d.contribution_id = v_contribution.id and d.created_at <= p_at));
  v_version := coalesce((select d.question_version from public.knowledge_contribution_details d
    where d.contribution_id = v_contribution.id and d.created_at <= p_at), 1);
  v_rule := case
    when v_withdrawn then 'withdrawal'
    when v_contribution.kind = 'correction' then 'correction'
    when v_confirmation = 'confirmed' then 'confirmation'
    when exists (select 1 from public.knowledge_decisions d
      where d.check_id = v_check.id and d.decision in ('declined', 'seen') and d.contribution_id is not null
        and d.created_at = (select a.created_at from public.knowledge_decisions a
          where a.resulting_submission_id = v_submission.id and a.decision = 'adopted' limit 1)) then 'conflict_choice'
    else 'adopted'
  end;
  return jsonb_build_object('checkId', v_check.id, 'at', p_at, 'answerInUse', jsonb_build_object(
    'submissionId', v_submission.id, 'answer', v_submission.answer, 'sentAt', v_submission.created_at,
    'confirmationState', case
      when coalesce((select r.confirmation from public.knowledge_question_rules r
        where r.question_key = v_check.template_key and r.created_at <= p_at
        order by r.rule_version desc limit 1), 'none') = 'none' then 'not_required'
      else coalesce(v_confirmation, 'pending') end,
    'withdrawn', v_withdrawn, 'detail', v_detail, 'questionVersion', v_version, 'selectionRule', v_rule));
end;
$$;

-- Managers and admins: the slot's events, newest first, with before and
-- after for corrections. Cursor "<UTC instant>|<event id>"; limit 1 to 50.
create function public.knowledge_slot_events(p_check_id uuid, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks;
  v_basis text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_before_at timestamptz;
  v_before_id bigint;
  v_items jsonb;
  v_next text;
begin
  perform private.amenity_assert_active_user();
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  v_basis := case when found then private.knowledge_basis(v_check.venue_id) end;
  if v_basis is null or v_basis = 'staff' then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if p_cursor is not null then
    if p_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9]{1,19}$' then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
    v_before_at := split_part(p_cursor, '|', 1)::timestamptz;
    v_before_id := split_part(p_cursor, '|', 2)::bigint;
  end if;
  with page as (
    select e.*, row_number() over (order by e.created_at desc, e.id desc) as rn
    from public.knowledge_events e
    where e.check_id = v_check.id
      and (v_before_at is null or (e.created_at, e.id) < (v_before_at, v_before_id))
    order by e.created_at desc, e.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'eventId', p.id, 'at', p.created_at,
      'kind', case p.kind
        when 'contribution_recorded' then case when x.kind = 'correction' then 'correction_sent' else 'contribution' end
        when 'decision_recorded' then case d.decision
          when 'adopted' then 'adoption' when 'confirmed' then 'confirmation' when 'declined' then 'decline'
          when 'revoked' then 'revoke' when 'reaffirmed' then 'reaffirm' when 'corrected' then 'correction'
          when 'withdrawn' then 'withdrawal' when 'seen' then 'seen' when 'detail_requested' then 'detail_request'
          else d.decision end
        when 'schedule_exception_added' then 'schedule_exception'
        when 'question_version_changed' then 'upgrade'
        else p.kind end,
      'actor', case when p.actor_id is not null then jsonb_build_object('id', p.actor_id, 'name', ap.display_name,
        'basis', coalesce(d.decider_basis, x.contributor_basis)) end,
      'answer', x.answer,
      'before', d.detail -> 'before', 'after', d.detail -> 'after',
      'material', (d.detail -> 'material'), 'selectionRule', d.detail ->> 'selectionRule',
      'reason', coalesce(d.note, x.reason, x.change_reason)) order by p.rn) filter (where p.rn <= v_limit), '[]'::jsonb),
    max(to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.id)
      filter (where p.rn = v_limit and (select count(*) from page) > v_limit)
  into v_items, v_next
  from page p
  left join public.knowledge_decisions d on d.id = p.decision_id
  left join public.knowledge_contributions x on x.id = coalesce(p.contribution_id, d.contribution_id)
  left join public.profiles ap on ap.id = p.actor_id;
  return jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_effective_detail(uuid),
  private.knowledge_corrector_basis(uuid),
  private.knowledge_upgrade_rules_valid(jsonb),
  private.knowledge_decision_detailed(public.venue_amenity_checks, uuid, text, uuid, text, integer, text, bigint, uuid, jsonb),
  private.knowledge_upgrade_candidates(text),
  private.knowledge_slot_state_b03(uuid, text[], timestamptz),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text),
  private.knowledge_policy_missing_for(uuid, text, boolean),
  private.knowledge_open_rechecks(timestamptz),
  private.knowledge_contribution_view(uuid)
from public, anon, authenticated;

revoke all on function
  public.knowledge_withdraw(uuid, bigint, uuid, text),
  public.knowledge_correct(uuid, bigint, uuid, text, jsonb, text),
  public.knowledge_upgrade_run(text, text),
  public.knowledge_slot_history(uuid, timestamptz),
  public.knowledge_slot_events(uuid, text, integer),
  public.my_venue_capabilities(uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_withdraw(uuid, bigint, uuid, text),
  public.knowledge_correct(uuid, bigint, uuid, text, jsonb, text),
  public.knowledge_upgrade_run(text, text),
  public.knowledge_slot_history(uuid, timestamptz),
  public.knowledge_slot_events(uuid, text, integer),
  public.my_venue_capabilities(uuid)
to authenticated;
