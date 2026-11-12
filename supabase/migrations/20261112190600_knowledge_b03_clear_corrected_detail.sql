-- B03 correction overlay: a latest correction with NULL detail clears the
-- previous detail. Only absence of a correction permits the original detail.
-- History applies the same rule to the rows that existed at its cutoff.
-- Forward rollback: restore the affected bodies from their prior B03
-- migrations, then drop the two-argument private helper.

create function private.knowledge_effective_detail(p_contribution_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when corrected.id is null then d.detail else corrected.detail end
  from (select p_contribution_id as id) contribution
  left join lateral (
    select dc.id, dc.detail
    from public.knowledge_detail_corrections dc
    where dc.contribution_id = contribution.id and dc.created_at <= p_at
    order by dc.created_at desc, dc.id desc limit 1
  ) corrected on true
  left join public.knowledge_contribution_details d
    on corrected.id is null and d.contribution_id = contribution.id and d.created_at <= p_at;
$$;

revoke all on function private.knowledge_effective_detail(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.knowledge_effective_detail(p_contribution_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.knowledge_effective_detail(p_contribution_id, 'infinity'::timestamptz);
$$;

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
    -- A40: a stopped or ended service reads No, with no write on the day.
    case when o.reason is null then
      case when s.value = 'yes' and se.in_effect then 'no' else s.value end end,
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
      private.knowledge_effective_detail(z.cid) as detail
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
      and (lv.value_schema, lv.value_schema_version) is distinct from
        (coalesce(kd.value_schema, v1.value_schema), coalesce(kd.value_schema_version, v1.value_schema_version))
      and coalesce(lv.upgrade_rules ->> (coalesce(kd.value_schema, v1.value_schema) || '@'
        || coalesce(kd.value_schema_version, v1.value_schema_version)), 'needs_checking') <> 'lossless',
      false) as changed
    from (select 1) one
    left join lateral (select (private.knowledge_version_as_of(s.question_key, p_now)).*) lv on true
    left join lateral (select v.* from public.knowledge_question_versions v where v.key = s.question_key
      and v.version = 1) v1 on true
  ) sc
  -- A40: the service's end at p_now, if any.
  cross join lateral (
    select coalesce((private.knowledge_service_end(p_venue_id, s.current_submission_id, s.current_answer,
      kd.value_schema, kd.detail, p_now) ->> 'inEffect')::boolean, false) as in_effect
  ) se
  cross join lateral (
    select case when se.in_effect then null
        else private.knowledge_qualifier(kd.value_schema, s.current_answer, kd.detail) end as qualifier,
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
        when wd.withdrawn and s.in_scope then 'withdrawn'
        when s.status <> 'available' then null
        when sc.changed then 'stale'
        when f.internal ->> 'state' in ('expired', 'basis_missing') then 'stale'
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'not_confirmed'
        when q.qualifier is not null then 'stale'
      end as reason,
      case
        when wd.withdrawn and s.in_scope then 'answer_withdrawn'
        when s.status <> 'available' then null
        when sc.changed then 'schema_changed'
        when f.internal ->> 'state' in ('expired', 'basis_missing') then f.internal ->> 'state'
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'policy_incomplete'
        when q.qualifier is not null then 'qualified_answer'
      end as detail
  ) o;
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
      -- A40: No once a service's end is in effect; screens that do not know
      -- stops still show No.
      'value', case when coalesce((se.stop ->> 'inEffect')::boolean, false) then 'no' else st.current_answer end,
      'available', st.status = 'available', 'reason', st.reason,
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
        order by s.created_at desc, s.id desc limit 1),
      -- Staff withdrawal line: when and on which basis, never who or why.
      'withdrawal', case when st.detail = 'answer_withdrawn' then (
        select jsonb_build_object('at', wd.created_at, 'basis', wd.decider_basis)
        from public.knowledge_decisions wd
        where wd.submission_id = st.current_submission_id and wd.decision = 'withdrawn'
        order by wd.created_at desc, wd.id desc limit 1) end,
      -- A40: { kind, lastDayOffered, notOfferedFrom, notOfferedFromAt, inEffect } or null.
      'stop', se.stop)
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
      private.knowledge_effective_detail(z.cid) as detail
    from (select st.current_contribution_id as cid) z
    left join public.knowledge_contribution_details d on d.contribution_id = z.cid
    where z.cid is not null
  ) kd on true
  cross join lateral (
    select private.knowledge_service_end(p_check.venue_id, st.current_submission_id, st.current_answer,
      kd.value_schema, kd.detail, now()) as stop
  ) se
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

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
      private.knowledge_effective_detail(d.contribution_id) as detail
    from public.knowledge_contribution_details d where d.contribution_id = x.id and d.value_schema = 'policy'
  ) kd on true
  join public.venue_amenity_checks c on c.id = x.check_id
  left join public.knowledge_question_versions qv on qv.key = c.template_key and qv.version = kd.question_version
  where x.id = p_contribution_id;
$$;

create or replace function private.knowledge_answer_at(p_check_id uuid, p_at timestamptz)
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
  v_schema text;
  v_observed date;
  v_stop jsonb;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
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
  v_detail := private.knowledge_effective_detail(v_contribution.id, p_at);
  v_version := coalesce((select d.question_version from public.knowledge_contribution_details d
    where d.contribution_id = v_contribution.id and d.created_at <= p_at), 1);
  select d.value_schema, d.observed_on into v_schema, v_observed from public.knowledge_contribution_details d
  where d.contribution_id = v_contribution.id and d.created_at <= p_at;
  -- A40 (correction 4): this submission's end as it read at p_at; never the
  -- schedule in use now.
  v_stop := private.knowledge_service_end(v_check.venue_id, v_submission.id, v_submission.answer, v_schema,
    v_detail, p_at);
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
    'submissionId', v_submission.id, 'answer', v_submission.answer,
    'value', case when coalesce((v_stop ->> 'inEffect')::boolean, false) then 'no' else v_submission.answer end,
    'stop', v_stop, 'sentAt', v_submission.created_at,
    'confirmationState', case
      when coalesce((select r.confirmation from public.knowledge_question_rules r
        where r.question_key = v_check.template_key and r.created_at <= p_at
        order by r.rule_version desc limit 1), 'none') = 'none' then 'not_required'
      else coalesce(v_confirmation, 'pending') end,
    'withdrawn', v_withdrawn, 'detail', v_detail, 'questionVersion', v_version, 'selectionRule', v_rule,
    -- B08 M1: freshness as it read at p_at, under the registry version and
    -- policies in force then (stable: both are append-only and never
    -- backdated).
    'registryVersion', (private.knowledge_version_as_of(v_check.template_key, p_at)).version,
    'freshness', private.knowledge_slot_freshness(v_check.venue_id, v_check.template_key, v_submission.id,
      v_schema, v_detail, v_observed, p_at)));
end;
$$;

create or replace function private.knowledge_reconcile_matches(
  p_submission_id uuid, p_answer text, p_detail jsonb
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.amenity_submissions s
    where s.id = p_submission_id and s.answer = p_answer
      and (p_detail is null or p_detail = private.knowledge_effective_detail(s.source_contribution_id))
  );
$$;
