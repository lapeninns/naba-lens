-- B03 review repairs, second part (B08 M1, WS5 items 1 to 3, A37 on imports).
--
-- * B08 M1: freshness at a time uses the registry version and freshness
--   policies in force then: private.knowledge_version_as_of (a version takes
--   effect at greatest(created_at, effective_from), never backdated) and
--   private.knowledge_policy_as_of (created_at). private.knowledge_slot_freshness
--   and the resolver view's schema check read them at p_now. History:
--   private.knowledge_answer_at(p_check_id, p_at), the stable definer
--   interface for B08 month close (no caller check; callers gate), and
--   public.knowledge_slot_history (managers and admins) over it; the answer at
--   p_at gains registryVersion and freshness [{ use, state, nextCheckDue,
--   basis, basisDate, policyId?, policyVersion? }] as it read then.
-- * WS5 item 1: the withdrawal branches of private.knowledge_slot_state_b03
--   apply only in scope (the B01 resolver reports out of scope as unknown /
--   not_enabled, which now wins).
-- * WS5 item 2: public.knowledge_reader_answers_v1 gains source_origin
--   (legacy_fact, external_source, or null; null when unavailable). No label
--   or excerpt. Dropped and re-created for the new column; service role only.
-- * WS5 item 3: a legacy fact's Coverage text no longer becomes the proposal's
--   limitations; managers read it as the pending import's sourceExcerpt.
-- * Reviewer low (A37 on imports): public.knowledge_source_import refuses
--   policy detail carrying authority or policyScope.
-- * Not touched: the credit trigger, the evidence-withdrawn trigger, the credit
--   functions, the B01 resolver, knowledge_adopt.
--
-- Rollback: a forward migration restores the earlier bodies.

create function private.knowledge_version_as_of(p_key text, p_at timestamptz)
returns public.knowledge_question_versions
language sql
stable
security definer
set search_path = ''
as $$
  select v.* from public.knowledge_question_versions v
  where v.key = p_key and greatest(v.created_at, coalesce(v.effective_from, v.created_at)) <= p_at
  order by v.version desc
  limit 1;
$$;

create function private.knowledge_policy_as_of(p_id text, p_use text, p_at timestamptz)
returns public.knowledge_freshness_policies
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.knowledge_freshness_policies p
  where p.id = p_id and p.use = p_use and p.created_at <= p_at
  order by p.version desc
  limit 1;
$$;

-- B03-e body, with the version and policies in force at p_now; entries also
-- name the policy version used.
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
  v_event jsonb;
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
      when 'stated_on' then case when p_schema = 'policy'
        then private.knowledge_safe_date(p_detail -> 'authority' ->> 'statedOn') end
      when 'event_end' then case when p_schema = 'schedule_event'
        then private.knowledge_safe_date(p_detail -> 'event' ->> 'localDate') end
    end;
    v_end := null;
    if v_policy.basis = 'event_end' and v_date is not null then
      v_event := p_detail -> 'event';
      v_end := case
        when v_event ->> 'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          (v_date + case when v_event ->> 'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and (v_event ->> 'end')::time <= (v_event ->> 'start')::time
            then 1 else 0 end + (v_event ->> 'end')::time) at time zone v_tz
        else (v_date + 1)::timestamp at time zone v_tz end;
    end if;
    v_out := v_out || (private.knowledge_freshness_entry(v_use, v_policy.max_age, v_policy.recheck_lead,
      v_policy.basis, v_date, v_end, p_now, v_tz)
      || case when v_policy.id is not null
        then jsonb_build_object('policyId', v_policy.id, 'policyVersion', v_policy.version) else '{}'::jsonb end);
  end loop;
  return v_out;
end;
$$;

-- B03-g body: the withdrawal branches only in scope (WS5 item 1), and the
-- schema check against the version in force at p_now.
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
    left join lateral (select (private.knowledge_version_as_of(s.question_key, p_now)).*) lv on true
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

-- B03-g history body, without the caller check, as of p_at, plus
-- registryVersion and freshness then (B08 M1).
create function private.knowledge_answer_at(p_check_id uuid, p_at timestamptz)
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
  v_detail := coalesce(
    (select dc.detail from public.knowledge_detail_corrections dc
     where dc.contribution_id = v_contribution.id and dc.created_at <= p_at
     order by dc.created_at desc, dc.id desc limit 1),
    (select d.detail from public.knowledge_contribution_details d
     where d.contribution_id = v_contribution.id and d.created_at <= p_at));
  v_version := coalesce((select d.question_version from public.knowledge_contribution_details d
    where d.contribution_id = v_contribution.id and d.created_at <= p_at), 1);
  select d.value_schema, d.observed_on into v_schema, v_observed from public.knowledge_contribution_details d
  where d.contribution_id = v_contribution.id and d.created_at <= p_at;
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
    'withdrawn', v_withdrawn, 'detail', v_detail, 'questionVersion', v_version, 'selectionRule', v_rule,
    -- B08 M1: freshness as it read at p_at, under the registry version and
    -- policies in force then (stable: both are append-only and never
    -- backdated).
    'registryVersion', (private.knowledge_version_as_of(v_check.template_key, p_at)).version,
    'freshness', private.knowledge_slot_freshness(v_check.venue_id, v_check.template_key, v_submission.id,
      v_schema, v_detail, v_observed, p_at)));
end;
$$;

create or replace function public.knowledge_slot_history(p_check_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks;
  v_basis text;
begin
  perform private.amenity_assert_active_user();
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  v_basis := case when found then private.knowledge_basis(v_check.venue_id) end;
  if v_basis is null or v_basis = 'staff' then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  return private.knowledge_answer_at(p_check_id, p_at);
end;
$$;

drop function public.knowledge_reader_answers_v1(uuid, text[]);
-- B03-c body plus source_origin (WS5 item 2).
create function public.knowledge_reader_answers_v1(p_venue_id uuid, p_keys text[])
returns table (
  question_key text,
  status text,
  reason text,
  detail text,
  revision bigint,
  question_version integer,
  value text,
  finding text,
  limitations text,
  reason_text text,
  source_basis text,
  current_contribution_id uuid,
  current_submission_id uuid,
  contribution_kind text,
  confirmation_required boolean,
  confirmation_state text,
  confirmation_basis text,
  confirmation_self boolean,
  confirmation_saved_at timestamptz,
  evidence_photos integer,
  evidence_videos integer,
  redaction_proof text,
  saved_at timestamptz,
  observed_at timestamptz,
  next_check_due timestamptz,
  freshness_state text,
  source_origin text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_keys text[] := coalesce(p_keys, '{}'::text[]);
begin
  if p_venue_id is null
     or not exists (select 1 from public.venues v where v.id = p_venue_id and v.active)
     or not exists (
       select 1 from public.knowledge_working_list w
       where w.venue_id = p_venue_id and w.disabled_at is null
     ) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  if cardinality(v_keys) > 50 then
    raise exception 'invalid_key_list' using errcode = '22023';
  end if;
  -- Unavailable answers carry their state and revision only.
  return query
    select s.question_key, s.status, s.reason, s.detail, s.revision, s.question_version,
      s.value,
      case when s.status = 'available' then s.finding end,
      case when s.status = 'available' then s.limitations end,
      case when s.status = 'available' then s.reason_text end,
      case when s.status = 'available' then s.source_basis end,
      case when s.status = 'available' then s.current_contribution_id end,
      case when s.status = 'available' then s.current_submission_id end,
      case when s.status = 'available' then s.contribution_kind end,
      s.confirmation_required,
      case when s.status = 'available' then s.confirmation_state end,
      case when s.status = 'available' then s.confirmation_basis end,
      case when s.status = 'available' then s.confirmation_self end,
      case when s.status = 'available' then s.confirmation_saved_at end,
      case when s.status = 'available' then s.evidence_photos end,
      case when s.status = 'available' then s.evidence_videos end,
      case when s.status = 'available' then s.redaction_proof end,
      case when s.status = 'available' then s.saved_at end,
      s.observed_at,
      s.next_check_due,
      case when s.status = 'available' then s.freshness_state end,
      -- WS5 item 2: an adopted import's origin; never its label or excerpt.
      case when s.status = 'available' then (select ks.source_kind from public.knowledge_contribution_sources ks
        where ks.contribution_id = s.current_contribution_id) end
    from private.knowledge_slot_state_b03(p_venue_id, v_keys) s
    order by array_position(v_keys, s.question_key);
end;
$$;

-- Review repairs body: legacy Coverage text out of limitations (WS5 item 3).
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
      -- WS5 item 3: Coverage text stays provenance (sourceExcerpt), never the
      -- proposal's limitations.
      null::text as limitations,
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

-- Review repairs body: a legacy import's Coverage text as its sourceExcerpt.
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
          'sourceExcerpt', coalesce(
            (select a.excerpt from public.knowledge_source_assertions a where a.id = ks.assertion_id),
            (select nullif(btrim(concat_ws(E'\n', f.facts, f.policy)), '') from public.venue_amenity_facts f
             where f.id = ks.legacy_fact_id)))
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

-- B03-f body plus A37 on imports.
create or replace function public.knowledge_source_import(
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
        -- A37 on imports: a source never claims a stated authority or scope.
        if v_version.value_schema = 'policy' and jsonb_typeof(v_a -> 'detail') = 'object' then
          if v_a -> 'detail' ? 'authority' then
            v_fields := v_fields || jsonb_build_object('path', format('assertions[%s].detail.authority', v_i),
              'problem', 'not_allowed');
          end if;
          if v_a -> 'detail' ? 'policyScope' then
            v_fields := v_fields || jsonb_build_object('path', format('assertions[%s].detail.policyScope', v_i),
              'problem', 'not_allowed');
          end if;
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

revoke all on function
  private.knowledge_version_as_of(text, timestamptz),
  private.knowledge_policy_as_of(text, text, timestamptz),
  private.knowledge_slot_freshness(uuid, text, uuid, text, jsonb, date, timestamptz),
  private.knowledge_slot_state_b03(uuid, text[], timestamptz),
  private.knowledge_answer_at(uuid, timestamptz),
  private.knowledge_reconcile_candidates(text, uuid)
from public, anon, authenticated;
revoke all on function public.knowledge_reader_answers_v1(uuid, text[]) from public, anon, authenticated;
grant execute on function public.knowledge_reader_answers_v1(uuid, text[]) to service_role;
revoke all on function
  public.knowledge_slot_history(uuid, timestamptz),
  public.knowledge_check(uuid),
  public.knowledge_source_import(uuid, text, timestamptz, jsonb, uuid)
from public, anon, service_role;
grant execute on function
  public.knowledge_slot_history(uuid, timestamptz),
  public.knowledge_check(uuid),
  public.knowledge_source_import(uuid, text, timestamptz, jsonb, uuid)
to authenticated;
