-- B03-d to g review repairs (evidence/b03-defg-implementation-review.md).
--
-- * M1 (B03-d): public.knowledge_occurrences expands the whole supersedes
--   chain, each version over its own dates with its own exceptions, so a
--   change from a later date keeps earlier and past occurrences.
-- * M2 (B03-f): private.knowledge_reconcile_revisions records, per legacy
--   fact, its revision and the mapping review in force per key; a review added
--   or changed after the dry run makes apply refuse reconcile_source_changed.
-- * M3 (B03-g): private.amenity_check_rows_presented presents a withdrawn
--   answer as needs_recheck with qualification 'withdrawn' (first, as the
--   resolver orders it); the stored row and Reopen are unchanged.
-- * Low 1 (B03-e): private.knowledge_open_rechecks cancels an open due_soon
--   task when its due date has passed and opens the expired one, and closes
--   at the time it opens at (private.knowledge_close_rechecks gains p_now).
-- * Low 2 (B03-f): private.knowledge_slot_json adds answerInUse.source and
--   sourceLabel.
-- * Low 3 (B03-f): an external assertion's excerpt no longer becomes the
--   proposal's limitations; public.knowledge_check gives it to managers as the
--   import's sourceExcerpt. Proposals already made keep what they have.
-- * Not touched: the credit trigger, the evidence-withdrawn trigger, the credit
--   functions, the resolver, knowledge_adopt.
--
-- Rollback: a forward migration restores the earlier bodies.

create or replace function public.knowledge_occurrences(p_check_id uuid, p_from date, p_to date)
returns table (local_date date, starts_at timestamptz, ends_at timestamptz, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_check public.venue_amenity_checks;
  v_schedule public.knowledge_schedules;
begin
  perform private.amenity_assert_active_user();
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or private.knowledge_basis(v_check.venue_id) is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_schedule := private.knowledge_schedule_in_use(v_check.id);
  if v_schedule.id is null then
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
      raise exception 'invalid_range' using errcode = '22023';
    end if;
    return;
  end if;
  -- Review M1: every version in the supersedes chain covers its own dates,
  -- from its effective_from to the day before the next version starts (or its
  -- own effective_to, whichever is first), with its own exceptions, so a
  -- change from a later date keeps earlier and past dates as they were.
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  return query
    with recursive chain as (
      select s.id, s.supersedes, s.timezone, s.effective_from, s.effective_to, s.recurrence, s.windows,
        null::date as next_from, 1 as depth
      from public.knowledge_schedules s where s.id = v_schedule.id
      union all
      select p.id, p.supersedes, p.timezone, p.effective_from, p.effective_to, p.recurrence, p.windows,
        least(c.effective_from, coalesce(c.next_from, c.effective_from)), c.depth + 1
      from chain c join public.knowledge_schedules p on p.id = c.supersedes
      where c.depth < 100
    ),
    spans as (
      select x.* from (
        select c.*, case when c.next_from is null then c.effective_to
          else least(coalesce(c.effective_to, c.next_from - 1), c.next_from - 1) end as span_to
        from chain c
      ) x
      -- A version a later one starts before has no dates of its own.
      where x.span_to is null or x.span_to >= x.effective_from
    )
    select o.local_date, o.starts_at, o.ends_at, o.state
    from spans sp
    cross join lateral private.schedule_occurrences(sp.timezone, sp.effective_from, sp.span_to,
      sp.recurrence, sp.windows,
      (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('localDate', to_char(e.local_date, 'YYYY-MM-DD'),
          'kind', e.kind, 'windows', e.windows)) order by e.created_at, e.id), '[]'::jsonb)
       from public.knowledge_schedule_exceptions e where e.schedule_id = sp.id),
      p_from, p_to) o
    order by o.local_date, o.starts_at, o.ends_at;
end;
$$;

create or replace function private.knowledge_reconcile_revisions(p_kind text, p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    -- Review M2: each fact's revision and the review in force per key, so a
    -- review added or changed after the dry run invalidates it.
    when 'legacy' then coalesce((
      select jsonb_object_agg(f.id::text, jsonb_build_object('revision', f.revision, 'reviews', coalesce((
          select jsonb_object_agg(m.question_key, m.id order by m.question_key)
          from (
            select distinct on (lm.question_key) lm.question_key, lm.id
            from public.knowledge_legacy_mappings lm
            where lm.legacy_fact_id = f.id and lm.legacy_revision = f.revision
            order by lm.question_key, lm.reviewed_at desc, lm.id desc
          ) m), '{}'::jsonb)) order by f.id)
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

create or replace function private.knowledge_reconcile_candidates(p_kind text, p_venue_id uuid)
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
    -- Review low 3: the excerpt stays with the assertion (sourceExcerpt), never
    -- in the proposal's staff-visible limitations.
    select a.venue_id, a.question_key, a.headline, null::text, s.label, null::uuid, null::integer, a.id, a.detail,
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

-- Review low 1: the job closes at the same time it opens at. The B03-e
-- body, reading the slot at p_now; the two-argument form (decision and detail
-- triggers) closes at now().
create function private.knowledge_close_rechecks(p_check_id uuid, p_decision_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks;
  v_st record;
  v_task public.knowledge_recheck_tasks;
  v_closed jsonb := '[]'::jsonb;
  v_today date := (p_now at time zone 'Europe/London')::date;
begin
  if not exists (select 1 from public.knowledge_recheck_tasks t where t.check_id = p_check_id and t.state = 'open') then
    return v_closed;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  select st.* into v_st from private.knowledge_slot_state_b03(v_check.venue_id, array[v_check.template_key], p_now) st;
  for v_task in
    select t.* from public.knowledge_recheck_tasks t
    where t.check_id = p_check_id and t.state = 'open'
    order by t.created_at, t.id
    for update
  loop
    if v_st.status = 'available'
       and coalesce((select e ->> 'state' from jsonb_array_elements(v_st.freshness) e where e ->> 'use' = v_task.use),
         'unrated') in ('current', 'unrated')
       and (v_task.cause <> 'schedule_ended' or not exists (
         select 1 from private.knowledge_schedule_in_use(p_check_id) s where s.effective_to < v_today)) then
      update public.knowledge_recheck_tasks t
      set state = 'done', closed_at = now(), closed_by = (select p.id from public.profiles p where p.id = auth.uid()),
          closed_decision_id = p_decision_id
      where t.id = v_task.id;
      v_closed := v_closed || jsonb_build_object('taskId', v_task.id, 'use', v_task.use);
    end if;
  end loop;
  return v_closed;
end;
$$;

create or replace function private.knowledge_close_rechecks(p_check_id uuid, p_decision_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.knowledge_close_rechecks(p_check_id, p_decision_id, now());
$$;

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
        -- Review low 1: once due, a due_soon task gives way to an expired one.
        if v_entry ->> 'state' = 'expired' then
          update public.knowledge_recheck_tasks t
          set state = 'cancelled', closed_at = now()
          where t.check_id = v_row.check_id and t.use = v_entry ->> 'use' and t.due_at = v_due
            and t.cause = 'due_soon' and t.state = 'open';
        end if;
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
    perform private.knowledge_close_rechecks(v_check, null, p_now);
  end loop;
  return v_opened;
end;
$$;

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
      -- Review low 2: where the answer in use came from (A12).
      'source', coalesce((select ks.source_kind from public.knowledge_contribution_sources ks
          where ks.contribution_id = st.current_contribution_id),
        case when st.source_basis = 'staff' then 'staff_finding' else 'manager_statement' end),
      'sourceLabel', (select ks.source_label from public.knowledge_contribution_sources ks
          where ks.contribution_id = st.current_contribution_id),
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
          'adoptable', v_check.current_submission_id is null,
          -- Review low 3: what an external source said, internal.
          'sourceExcerpt', (select a.excerpt from public.knowledge_source_assertions a where a.id = ks.assertion_id))
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

create or replace view private.amenity_check_rows_presented as
  select r.id, r.venue_id, r.template_key, r.category, r.question, r.capture_brief, r.evidence_rule,
    r.is_core, r.position, r.catalogue_version, r.status,
    case when q.qualification is null then r.progress else 'needs_recheck' end as progress,
    r.answer, r.current_submission_id, r.assignee_user_id, r.assignee_name,
    r.answered_by, r.answered_by_name, r.answered_at,
    case q.qualification
      when 'conditional' then 'The answer in use has conditions. Open the check to see them.'
      when 'temporarily_unavailable' then 'The answer in use is temporarily unavailable. Open the check to see until when.'
      when 'policy_incomplete' then 'The policy in use is not complete yet. Open the check to see what it still needs.'
      when 'withdrawn' then 'The answer in use was withdrawn. Open the check to see why.'
      else r.recheck_reason
    end as recheck_reason,
    r.notes, r.revision, r.updated_at, q.qualification
  from private.amenity_check_rows r
  left join public.amenity_submissions s on s.id = r.current_submission_id
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.source_contribution_id
  -- A39: an incomplete policy answer first (the resolver's precedence),
  -- then a qualified one.
  cross join lateral (
    select case
      when r.progress <> 'complete' then null
      -- Review M3: a withdrawn answer first, as the resolver orders it.
      when exists (select 1 from public.knowledge_decisions wd
        where wd.submission_id = r.current_submission_id and wd.decision = 'withdrawn') then 'withdrawn'
      when kd.value_schema = 'policy'
        and jsonb_array_length(coalesce(private.knowledge_policy_complete(r.id), '[]'::jsonb)) > 0
        then 'policy_incomplete'
      else private.knowledge_qualifier(kd.value_schema, r.answer, kd.detail)
    end as qualification
  ) q;

revoke all on private.amenity_check_rows_presented from public, anon, authenticated;
revoke all on function
  private.knowledge_reconcile_revisions(text, uuid),
  private.knowledge_reconcile_candidates(text, uuid),
  private.knowledge_open_rechecks(timestamptz),
  private.knowledge_close_rechecks(uuid, uuid, timestamptz),
  private.knowledge_close_rechecks(uuid, uuid),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text)
from public, anon, authenticated;
revoke all on function public.knowledge_occurrences(uuid, date, date), public.knowledge_check(uuid)
from public, anon, service_role;
grant execute on function public.knowledge_occurrences(uuid, date, date), public.knowledge_check(uuid) to authenticated;
