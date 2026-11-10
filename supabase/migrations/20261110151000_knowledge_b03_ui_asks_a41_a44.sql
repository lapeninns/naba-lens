-- B03 UI asks A41, A42, A44 and the staff withdrawal line (pool review of
-- b9fa1f6d, evidence/b03-a40-a44-pool-review.md). A43 is mapper-only
-- (lib/server/knowledge/errors.ts). A40 is not here: it awaits an owner answer.
--
-- * A41: public.knowledge_venue_rechecks(p_venue_id), managers and admins, the
--   venue's open recheck tasks as knowledge_recheck_json items, ordered by
--   due_at then id. One filter for every venue-wide count and list,
--   private.knowledge_venue_open_rechecks: open tasks on active checks, the
--   eligibility my_rechecks already applies. manager_triage_summary's rechecks
--   row now counts through it, so its waiting and oldest_waiting_at equal the
--   list's length and first dueAt (it counted tasks on archived checks too).
-- * A42: public.knowledge_freshness_policies(), admins only, the latest version
--   of each policy per (id, use), the version knowledge_freshness_preview
--   uses. Durations are ISO 8601. Not filtered by claim class; each item
--   carries it. Empty until OD-15 supplies policies.
-- * A44: public.knowledge_legacy_narrative_for_question(p_question_key,
--   p_venue_id), managers and admins, the legacy facts whose latest review for
--   their current revision maps them to the question (exact, candidate or
--   none, design §7.2), with that kind. Unreviewed facts, and facts reviewed
--   only at an older revision, stay in the venue-wide knowledge_legacy_narrative,
--   which is unchanged. No reviewer name or reason.
-- * Staff withdrawal line: private.knowledge_slot_json's answerInUse gains
--   withdrawal { at, basis } (basis venue_manager or admin, from the
--   withdrawal decision) while the answer reads withdrawn, for every reader of
--   the slot (knowledge_check, the working list). Never a name or the reason.
--   private.knowledge_contribution_view gains stateReasonBasis and
--   stateReasonAt for the author's corrected and withdrawn reasons; the reason
--   stays in managerNote, for the author only, as before.
-- * Not touched: the credit trigger, the evidence-withdrawn trigger, the credit
--   functions, the B01 resolver, knowledge_adopt, my_rechecks,
--   knowledge_check_rechecks, knowledge_open_rechecks.
--
-- Rollback: a forward migration restores the 20261110105844 triage body, the
-- 20261110113909 slot JSON and the 20261110110831 contribution view, and drops
-- the four new functions.

-- ---------------------------------------------------------------------------
-- A41: the venue's open rechecks
-- ---------------------------------------------------------------------------

-- The one venue-wide filter: open tasks on the venue's active checks.
create function private.knowledge_venue_open_rechecks(p_venue_id uuid)
returns setof public.knowledge_recheck_tasks
language sql
stable
security definer
set search_path = ''
as $$
  select t.* from public.knowledge_recheck_tasks t
  join public.venue_amenity_checks c on c.id = t.check_id
  where t.venue_id = p_venue_id and t.state = 'open' and c.status = 'active';
$$;

-- Managers and admins (the triage row's gate): every open task at the venue,
-- oldest due first. The assignee is the check's (join on checkId).
create function public.knowledge_venue_rechecks(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.manager_read_venue(p_venue_id);
  v_items jsonb;
begin
  if coalesce(private.knowledge_basis(v_venue), 'none') not in ('venue_manager', 'admin') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(private.knowledge_recheck_json(t) order by t.due_at, t.id), '[]'::jsonb)
  into v_items
  from private.knowledge_venue_open_rechecks(v_venue) t;
  return jsonb_build_object('venueId', v_venue, 'count', jsonb_array_length(v_items), 'items', v_items);
end;
$$;

-- B03-f body; the rechecks row counts through private.knowledge_venue_open_rechecks (A41).
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

  -- B03-e (§7.4): open recheck tasks at the venue, oldest due first; A41: the
  -- same tasks knowledge_venue_rechecks lists.
  if v_basis in ('venue_manager', 'admin') then
    return query
    select 'rechecks'::text, true, count(*)::integer, min(t.due_at), null::integer
    from private.knowledge_venue_open_rechecks(v_venue) t;
  else
    return query select 'rechecks'::text, false, null::integer, null::timestamptz, null::integer;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A42: freshness policies
-- ---------------------------------------------------------------------------

-- Admins: the latest version of each policy per (id, use), as
-- knowledge_freshness_preview picks it. Durations in ISO 8601 ("P90D").
create function public.knowledge_freshness_policies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set intervalstyle = 'iso_8601'
as $$
begin
  perform private.amenity_assert_active_user();
  if not private.is_active_admin() then
    raise exception 'not_active_admin' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('policyId', p.id, 'version', p.version, 'claimClass', p.claim_class,
        'use', p.use, 'maxAge', p.max_age::text, 'recheckLead', p.recheck_lead::text, 'basis', p.basis,
        'note', p.note, 'createdAt', p.created_at)
      order by p.id, p.use)
    from (
      select distinct on (fp.id, fp.use) fp.* from public.knowledge_freshness_policies fp
      order by fp.id, fp.use, fp.version desc
    ) p
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- A44: old facts for one question
-- ---------------------------------------------------------------------------

-- Manager or admin: the legacy facts reviewed for p_question_key at their
-- current revision (the latest review in force), whatever the kind, in the
-- venue-wide narrative's shape and order plus mappingKind. Never a confirmation.
create function public.knowledge_legacy_narrative_for_question(p_question_key text, p_venue_id uuid default null)
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
  if not exists (select 1 from public.amenity_catalogue t where t.key = p_question_key) then
    raise exception 'knowledge_question_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('venueId', v_venue, 'questionKey', p_question_key, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('legacyKey', f.amenity_key, 'label', t.title, 'presence', f.presence,
        'facts', f.facts, 'policy', f.policy, 'savedAsConfirmedAt', f.confirmed_at, 'updatedAt', f.updated_at,
        'mappingKind', m.mapping_kind)
      order by t.position, f.amenity_key)
    from public.venue_amenity_facts f
    join public.coverage_amenity_templates t on t.key = f.amenity_key
    cross join lateral (
      select lm.mapping_kind from public.knowledge_legacy_mappings lm
      where lm.legacy_fact_id = f.id and lm.legacy_revision = f.revision and lm.question_key = p_question_key
      order by lm.reviewed_at desc, lm.id desc
      limit 1
    ) m
    where f.venue_id = v_venue and m.mapping_kind in ('exact', 'candidate', 'none')
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff withdrawal line (UI design §8.2, D-B3-18)
-- ---------------------------------------------------------------------------

-- 20261110113909 body; answerInUse gains withdrawal { at, basis } while the
-- answer reads withdrawn.
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
        order by s.created_at desc, s.id desc limit 1),
      -- Staff withdrawal line: when and on which basis, never who or why.
      'withdrawal', case when st.detail = 'answer_withdrawn' then (
        select jsonb_build_object('at', wd.created_at, 'basis', wd.decider_basis)
        from public.knowledge_decisions wd
        where wd.submission_id = st.current_submission_id and wd.decision = 'withdrawn'
        order by wd.created_at desc, wd.id desc limit 1) end)
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

-- 20261110110831 body; the author's corrected and withdrawn reasons gain the
-- actor's basis and time (stateReasonBasis, stateReasonAt). No name.
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
    -- Who took it out of use (venue_manager or admin) and when, for the
    -- corrected and withdrawn reasons only.
    'stateReasonBasis', case
      when d.decision = 'adopted' and ad.decision = 'withdrawn' then ad.decider_basis
      when d.decision = 'adopted' and ad.decision = 'corrected'
        and c.current_submission_id is distinct from d.resulting_submission_id then ad.decider_basis
    end,
    'stateReasonAt', case
      when d.decision = 'adopted' and ad.decision = 'withdrawn' then ad.created_at
      when d.decision = 'adopted' and ad.decision = 'corrected'
        and c.current_submission_id is distinct from d.resulting_submission_id then ad.created_at
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
    select a.decision, a.note, a.decider_basis, a.created_at from public.knowledge_decisions a
    where d.decision = 'adopted' and a.submission_id = d.resulting_submission_id
      and (a.decision = 'withdrawn' or (a.decision = 'corrected' and a.resulting_submission_id is not null))
    order by a.created_at desc, a.id desc limit 1
  ) ad on true
  where x.id = p_contribution_id;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_venue_open_rechecks(uuid),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text),
  private.knowledge_contribution_view(uuid)
from public, anon, authenticated;

revoke all on function
  public.knowledge_venue_rechecks(uuid),
  public.manager_triage_summary(uuid),
  public.knowledge_freshness_policies(),
  public.knowledge_legacy_narrative_for_question(text, uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_venue_rechecks(uuid),
  public.manager_triage_summary(uuid),
  public.knowledge_freshness_policies(),
  public.knowledge_legacy_narrative_for_question(text, uuid)
to authenticated;
