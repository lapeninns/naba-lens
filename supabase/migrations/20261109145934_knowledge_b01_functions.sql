-- B01 knowledge layer, part 2: functions, triggers and the legacy guard
-- (docs/knowledge/b01-design.md §4, §5, §9, §10, §11, §12, §13).
--
-- * private.knowledge_slot_state is the single resolver. Every knowledge read
--   (reader wrapper, screens) goes through it.
-- * A contribution becomes an amenity_submissions row, with its 'submitted'
--   event, only in private.knowledge_adopt. Couldn't establish, proposals,
--   change reports and decisions write knowledge_* tables only, so the
--   combined-target credit inputs never change through them.
-- * amenity_submit_finding is replaced with today's body plus one guard: a
--   slot on an open working list raises knowledge_path_required (NLK01), after
--   the replay lookup and after the check row is locked. It also stores the
--   redaction tick and the submitter basis on new rows.
-- * NL-class SQLSTATEs: NLK01 knowledge_path_required, NLK02
--   knowledge_slot_out_of_scope, NLK03 already_decided, NLK04
--   self_confirmation_not_permitted, NLK05 draft_conflict, NLK06
--   knowledge_venue_not_found, NLK07 knowledge_not_adoptable, NLK08
--   knowledge_not_current.
--
-- * amenity_evidence_asset is replaced with today's body plus one branch:
--   the deciders of a knowledge contribution, and its contributor, may view
--   its evidence before adoption.
--
-- Rollback (§16): disable working-list rows with knowledge_set_working_list;
-- the guard lifts and every legacy path behaves exactly as before. A forward
-- migration can restore the previous amenity_submit_finding and
-- amenity_evidence_asset bodies. Nothing here deletes or rewrites data, and
-- no trigger is disabled.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.knowledge_rule(p_question_key text)
returns public.knowledge_question_rules
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.knowledge_question_rules r
  where r.question_key = p_question_key
  order by r.rule_version desc
  limit 1;
$$;

create function private.knowledge_in_scope(p_venue_id uuid, p_question_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.knowledge_working_list w
    where w.venue_id = p_venue_id and w.question_key = p_question_key and w.disabled_at is null
  );
$$;

-- Slot revision = the slot's check revision (0 without a check) + its events.
create function private.knowledge_slot_revision(p_venue_id uuid, p_question_key text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
      select c.revision from public.venue_amenity_checks c
      where c.venue_id = p_venue_id and c.template_key = p_question_key
    ), 0)::bigint
    + (select count(*) from public.knowledge_events e
       where e.venue_id = p_venue_id and e.question_key = p_question_key);
$$;

create function private.knowledge_event(
  p_venue_id uuid,
  p_question_key text,
  p_check_id uuid,
  p_kind text,
  p_contribution_id uuid,
  p_submission_id uuid,
  p_decision_id uuid,
  p_detail jsonb
)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.knowledge_events
    (venue_id, question_key, check_id, kind, actor_id, contribution_id, submission_id, decision_id, detail)
  values (
    p_venue_id, p_question_key, p_check_id, p_kind,
    (select p.id from public.profiles p where p.id = (select auth.uid())),
    p_contribution_id, p_submission_id, p_decision_id, coalesce(p_detail, '{}'::jsonb)
  )
  returning id;
$$;

-- How the caller may act at a venue now: admin, venue_manager, staff or NULL.
create function private.knowledge_basis(p_venue_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.is_active_user() then null
    when private.is_active_admin() then 'admin'
    when private.can_manage_venue(p_venue_id) then 'venue_manager'
    when private.active_staff_venue_id() = p_venue_id then 'staff'
  end;
$$;

-- Lock order step 1 (§4.4): the caller's profile row FOR SHARE, so a venue,
-- role or activation change by an admin serialises with this command.
create function private.knowledge_lock_actor()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  perform 1 from public.profiles p where p.id = v_uid for share;
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = 'P0001';
  end if;
  return v_uid;
end;
$$;

create function private.knowledge_hash(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
$$;

-- Lock order step 2: the key's advisory lock, then the replay lookup.
create function private.knowledge_replay(p_key uuid, p_actor uuid, p_command text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior public.knowledge_commands;
begin
  if p_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_knowledge:' || p_key::text, 0));
  select k.* into v_prior from public.knowledge_commands k where k.idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v_prior.actor_id <> p_actor or v_prior.command <> p_command or v_prior.request_hash <> p_hash then
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;
  return v_prior.result || jsonb_build_object('replayed', true);
end;
$$;

create function private.knowledge_record_command(
  p_key uuid, p_actor uuid, p_command text, p_hash text, p_venue_id uuid, p_question_key text, p_result jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.knowledge_commands
    (idempotency_key, actor_id, command, request_hash, venue_id, question_key, result)
  values (p_key, p_actor, p_command, p_hash, p_venue_id, p_question_key, p_result);
$$;

create function private.knowledge_is_terminal(p_contribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.knowledge_decisions d
    where d.contribution_id = p_contribution_id
      and d.decision in ('adopted', 'declined', 'replaced', 'seen')
  );
$$;

create function private.knowledge_decision(
  p_check public.venue_amenity_checks,
  p_contribution_id uuid,
  p_submission_id uuid,
  p_decision text,
  p_decided_by uuid,
  p_basis text,
  p_self boolean,
  p_rule_version integer,
  p_note text,
  p_slot_revision bigint,
  p_resulting_submission_id uuid
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
    decider_basis, self_confirmed, rule_version, note, slot_revision, resulting_submission_id
  )
  values (
    p_check.venue_id, p_check.id, p_check.template_key, p_contribution_id, p_submission_id, p_decision,
    p_decided_by, p_basis, coalesce(p_self, false), p_rule_version, p_note, p_slot_revision,
    p_resulting_submission_id
  )
  returning id into v_id;
  perform private.knowledge_event(p_check.venue_id, p_check.template_key, p_check.id, 'decision_recorded',
    p_contribution_id, coalesce(p_resulting_submission_id, p_submission_id), v_id,
    jsonb_build_object('decision', p_decision));
  return v_id;
end;
$$;

-- The existing reopen transition (amenity_reopen_check, preset 'other').
create function private.knowledge_reopen(p_check public.venue_amenity_checks, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.venue_amenity_checks c
  set progress = 'needs_recheck', recheck_reason = p_reason, revision = c.revision + 1
  where c.id = p_check.id;
  perform private.amenity_event(p_check.id, p_check.venue_id, 'reopened', p_reason,
    jsonb_build_object('preset', 'other'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Adoption: the only path into amenity_submissions (§4.3)
-- ---------------------------------------------------------------------------

-- Called with the check row already locked FOR UPDATE by the caller, after the
-- contribution's assets were locked FOR SHARE (§4.4). Takes no further locks.
create function private.knowledge_adopt(
  p_contribution public.knowledge_contributions,
  p_check public.venue_amenity_checks,
  p_decided_by uuid,
  p_basis text,
  p_confirm boolean,
  p_self boolean,
  p_slot_revision bigint,
  p_rule_version integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_missing record;
  v_kinds text[];
  v_id uuid;
begin
  if p_contribution.answer not in ('yes', 'no', 'not_applicable') then
    raise exception 'knowledge_not_adoptable' using errcode = 'NLK07';
  end if;
  if p_check.status <> 'active' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  perform private.amenity_assert_venue_active(p_check.venue_id);

  select ca.asset_id, case when a.deleted_at is not null then 'deleted' else 'not_ready' end as why
  into v_missing
  from public.knowledge_contribution_assets ca
  join public.media_assets a on a.id = ca.asset_id
  where ca.contribution_id = p_contribution.id
    and (a.deleted_at is not null or a.upload_state <> 'ready')
  order by ca.asset_id
  limit 1;
  if found then
    raise exception 'evidence_not_eligible' using errcode = 'P0001',
      detail = jsonb_build_object('assetId', v_missing.asset_id, 'reason', v_missing.why)::text;
  end if;
  v_kinds := array(
    select ca.evidence_kind from public.knowledge_contribution_assets ca
    where ca.contribution_id = p_contribution.id
  );
  if p_contribution.answer = 'yes' and not private.amenity_rule_met(p_contribution.evidence_rule, v_kinds) then
    raise exception 'evidence_rule_unmet' using errcode = 'P0001', detail = p_contribution.evidence_rule;
  end if;

  insert into public.amenity_submissions (
    check_id, venue_id, submitted_by, answer, finding, limitations, reason,
    template_version, evidence_rule, internal_metadata, idempotency_key, result_revision,
    source_contribution_id, redaction_confirmed, submitter_basis
  )
  values (
    p_check.id, p_check.venue_id, p_contribution.contributed_by, p_contribution.answer,
    p_contribution.finding, p_contribution.limitations, p_contribution.reason,
    p_contribution.template_version, p_contribution.evidence_rule, p_contribution.internal_metadata,
    gen_random_uuid(), p_check.revision + 1,
    p_contribution.id, p_contribution.redaction_confirmed, p_contribution.contributor_basis
  )
  returning id into v_id;

  insert into public.amenity_submission_assets (submission_id, venue_id, asset_id, evidence_kind)
  select v_id, p_check.venue_id, ca.asset_id, ca.evidence_kind
  from public.knowledge_contribution_assets ca
  where ca.contribution_id = p_contribution.id;

  update public.venue_amenity_checks c
  set answer = p_contribution.answer, progress = 'complete', answered_by = p_contribution.contributed_by,
      answered_at = now(), current_submission_id = v_id, recheck_reason = null, revision = c.revision + 1
  where c.id = p_check.id;

  perform private.amenity_event(p_check.id, p_check.venue_id, 'submitted', null,
    jsonb_build_object('submissionId', v_id, 'answer', p_contribution.answer, 'contributionId', p_contribution.id));

  perform private.knowledge_decision(p_check, p_contribution.id, null, 'adopted', p_decided_by, p_basis,
    false, p_rule_version, null, p_slot_revision, v_id);
  if p_confirm then
    perform private.knowledge_decision(p_check, null, v_id, 'confirmed', p_decided_by, p_basis,
      p_self, p_rule_version, null, p_slot_revision, null);
  end if;

  if p_check.assignee_user_id is not null and p_check.assignee_user_id <> p_contribution.contributed_by then
    perform private.knowledge_event(p_check.venue_id, p_check.template_key, p_check.id,
      'assignment_closed_by_other', p_contribution.id, v_id, null,
      jsonb_build_object('assigneeId', p_check.assignee_user_id, 'answeredBy', p_contribution.contributed_by));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Legacy submit: today's body plus the working-list guard (§4.1, G2)
-- ---------------------------------------------------------------------------

create or replace function public.amenity_submit_finding(
  p_check_id uuid,
  p_revision integer,
  p_idempotency_key uuid,
  p_answer text,
  p_finding text,
  p_limitations text,
  p_reason text,
  p_asset_ids uuid[],
  p_internal_metadata jsonb,
  p_redaction_confirmed boolean
)
returns table (submission_id uuid, revision integer, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_check public.venue_amenity_checks;
  v_prior public.amenity_submissions;
  v_template public.amenity_catalogue;
  v_finding text;
  v_limitations text;
  v_reason text;
  v_assets uuid[] := coalesce(p_asset_ids, '{}');
  v_asset uuid;
  v_why text;
  v_kinds text[];
  v_metadata jsonb;
  v_id uuid;
  v_revision integer;
  v_basis text;
begin
  if p_answer is null or p_answer not in ('yes', 'no', 'not_applicable') then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  -- The service always sends a UUID; not one of the contract's RPC_ERRORS.
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  -- A retry returns the first result even if the caller has since been
  -- unassigned or the revision has moved, or the slot has since entered the
  -- knowledge working list.
  perform pg_advisory_xact_lock(hashtextextended('nabalens_amenity_submit:' || p_idempotency_key::text, 0));
  select s.* into v_prior from public.amenity_submissions s where s.idempotency_key = p_idempotency_key;
  if found then
    if v_prior.check_id = p_check_id and v_prior.submitted_by = v_uid then
      return query select v_prior.id, v_prior.result_revision, true;
      return;
    end if;
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;

  v_check := private.amenity_readable_check(p_check_id);
  if not private.amenity_can_submit(v_check) then
    raise exception 'amenity_not_permitted' using errcode = 'P0001';
  end if;

  if cardinality(v_assets) > 10
     or array_position(v_assets, null) is not null
     or (select count(distinct a) from unnest(v_assets) a) <> cardinality(v_assets) then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;

  -- Asset rows before the check row, the same order as the evidence-lost
  -- trigger: a concurrent deletion either waits for this submission (and then
  -- sees it) or commits first (and the asset is then rejected below). Only the
  -- check venue's assets are locked; any other id is rejected as not_found.
  perform 1 from public.media_assets a
  where a.id = any(v_assets) and a.venue_id = v_check.venue_id
  order by a.id
  for share;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  -- The assignee may have changed while waiting for the lock.
  if not private.amenity_can_submit(v_check) then
    raise exception 'amenity_not_permitted' using errcode = 'P0001';
  end if;
  perform private.amenity_assert_venue_active(v_check.venue_id);

  -- Knowledge working-list slots take findings only through knowledge_submit.
  -- Evaluated after the check lock, in a later statement, so a working-list
  -- row committed before the lock was granted is seen (knowledge_set_working_list
  -- locks the same check row).
  if private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
    raise exception 'knowledge_path_required' using errcode = 'NLK01';
  end if;

  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  if p_revision is distinct from v_check.revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_check.revision)::text;
  end if;

  v_finding := private.clean_text(p_finding, 2000, 'invalid_finding');
  v_limitations := private.clean_text(p_limitations, 2000, 'invalid_limitations');
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  if p_answer <> 'yes' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  foreach v_asset in array v_assets loop
    v_why := private.amenity_asset_ineligibility(v_check, v_asset);
    if v_why is not null then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_asset, 'reason', v_why)::text;
    end if;
  end loop;

  select t.* into v_template from public.amenity_catalogue t where t.key = v_check.template_key;
  v_kinds := array(
    select case a.media_type when 'image' then 'photo' else 'video' end
    from public.media_assets a where a.id = any(v_assets)
  );
  if p_answer = 'yes' and not private.amenity_rule_met(v_template.evidence_rule, v_kinds) then
    raise exception 'evidence_rule_unmet' using errcode = 'P0001', detail = v_template.evidence_rule;
  end if;

  if v_check.template_key = 'guest_wifi' then
    if p_answer = 'yes' or p_internal_metadata is not null then
      v_metadata := private.amenity_wifi_metadata(p_internal_metadata);
    end if;
    if (p_answer = 'yes' or 'photo' = any(v_kinds)) and p_redaction_confirmed is distinct from true then
      raise exception 'redaction_not_confirmed' using errcode = 'P0001';
    end if;
  elsif p_internal_metadata is not null then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;

  v_basis := case
    when private.is_active_admin() then 'admin'
    when private.can_manage_venue(v_check.venue_id) then 'venue_manager'
    else 'staff'
  end;

  insert into public.amenity_submissions (
    check_id, venue_id, submitted_by, answer, finding, limitations, reason,
    template_version, evidence_rule, internal_metadata, idempotency_key, result_revision,
    redaction_confirmed, submitter_basis
  )
  values (
    v_check.id, v_check.venue_id, v_uid, p_answer, v_finding, v_limitations, v_reason,
    v_template.catalogue_version, v_template.evidence_rule, v_metadata, p_idempotency_key,
    v_check.revision + 1, p_redaction_confirmed, v_basis
  )
  returning id into v_id;

  insert into public.amenity_submission_assets (submission_id, venue_id, asset_id, evidence_kind)
  select v_id, v_check.venue_id, a.id, case a.media_type when 'image' then 'photo' else 'video' end
  from public.media_assets a where a.id = any(v_assets);

  update public.venue_amenity_checks c
  set answer = p_answer, progress = 'complete', answered_by = v_uid, answered_at = now(),
      current_submission_id = v_id, recheck_reason = null, revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;

  perform private.amenity_event(v_check.id, v_check.venue_id, 'submitted', null,
    jsonb_build_object('submissionId', v_id, 'answer', p_answer));

  return query select v_id, v_revision, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- The single resolver (§5)
-- ---------------------------------------------------------------------------

create function private.knowledge_slot_state(p_venue_id uuid, p_keys text[])
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
  check_progress text
)
language sql
stable
security definer
set search_path = ''
as $$
  with keys as (
    select distinct k from unnest(coalesce(p_keys, '{}'::text[])) as u(k) where k is not null
  ),
  slots as (
    select k.k as key, c.id as cid, c.status as cstatus, c.progress as cprogress, c.revision as crev,
      s.id as sid, s.answer as sanswer, s.finding as sfinding, s.limitations as slimitations,
      s.reason as sreason, s.template_version as stemplate, s.created_at as screated,
      s.source_contribution_id as scontrib, s.submitter_basis as sbasis, s.redaction_confirmed as sredaction,
      kc.created_at as kcreated, cat.catalogue_version as catversion,
      r.rule_version as rversion, r.confirmation as rconfirmation,
      r.staff_text_internal as rtext, r.redaction_required as rredaction,
      exists (
        select 1 from public.knowledge_working_list w
        where w.venue_id = p_venue_id and w.question_key = k.k and w.disabled_at is null
      ) as scope,
      coalesce(c.revision, 0)::bigint + (
        select count(*) from public.knowledge_events e
        where e.venue_id = p_venue_id and e.question_key = k.k
      ) as rev,
      conf.decision as conf_decision,
      cf.decider_basis as cf_basis, cf.self_confirmed as cf_self, cf.created_at as cf_at,
      coalesce(ev.photos, 0) as photos, coalesce(ev.videos, 0) as videos,
      coalesce(ev.total, 0) as ev_total, coalesce(ev.any_missing, false) as ev_missing, ev.last_deleted,
      rea.reaffirmed_at,
      coalesce(und.pending, 0) as und_pending, coalesce(und.differs, false) as und_differs,
      coalesce(und.has_proposal, false) as und_proposal,
      newest.answer as newest_answer, coalesce(newest.declined, false) as newest_declined,
      unk.created_at as unk_at, unk.unknown_preset as unk_preset,
      prog.kind as prog_kind
    from keys k
    left join public.amenity_catalogue cat on cat.key = k.k
    left join public.venue_amenity_checks c on c.venue_id = p_venue_id and c.template_key = k.k
    left join public.amenity_submissions s on s.id = c.current_submission_id
    left join public.knowledge_contributions kc on kc.id = s.source_contribution_id
    left join lateral (
      select r.* from public.knowledge_question_rules r
      where r.question_key = k.k order by r.rule_version desc limit 1
    ) r on true
    left join lateral (
      select d.decision from public.knowledge_decisions d
      where d.submission_id = s.id and d.decision in ('confirmed', 'revoked')
      order by d.created_at desc, d.id desc limit 1
    ) conf on true
    left join lateral (
      select d.decider_basis, d.self_confirmed, d.created_at from public.knowledge_decisions d
      where d.submission_id = s.id and d.decision = 'confirmed'
      order by d.created_at desc, d.id desc limit 1
    ) cf on true
    left join lateral (
      select
        (count(*) filter (where sa.evidence_kind = 'photo' and a.deleted_at is null and a.upload_state = 'ready'))::integer as photos,
        (count(*) filter (where sa.evidence_kind = 'video' and a.deleted_at is null and a.upload_state = 'ready'))::integer as videos,
        count(*)::integer as total,
        bool_or(a.deleted_at is not null or a.upload_state <> 'ready') as any_missing,
        max(a.deleted_at) as last_deleted
      from public.amenity_submission_assets sa
      join public.media_assets a on a.id = sa.asset_id
      where sa.submission_id = s.id
    ) ev on true
    left join lateral (
      select max(d.created_at) as reaffirmed_at from public.knowledge_decisions d
      where d.submission_id = s.id and d.decision = 'reaffirmed'
    ) rea on true
    left join lateral (
      select count(*)::integer as pending,
        bool_or(x.answer is distinct from s.answer) as differs,
        bool_or(x.answer <> 'unknown') as has_proposal
      from public.knowledge_contributions x
      where x.check_id = c.id
        and not exists (
          select 1 from public.knowledge_decisions d
          where d.contribution_id = x.id and d.decision in ('adopted', 'declined', 'replaced', 'seen')
        )
    ) und on true
    left join lateral (
      select x.answer,
        exists (select 1 from public.knowledge_decisions d where d.contribution_id = x.id and d.decision = 'declined') as declined
      from public.knowledge_contributions x
      where x.check_id = c.id
      order by x.created_at desc, x.id desc limit 1
    ) newest on true
    left join lateral (
      select x.created_at, x.unknown_preset from public.knowledge_contributions x
      where x.check_id = c.id and x.answer = 'unknown'
      order by x.created_at desc, x.id desc limit 1
    ) unk on true
    left join lateral (
      select e.kind from public.amenity_check_events e
      where e.check_id = c.id and e.kind in ('reopened', 'evidence_lost')
      order by e.id desc limit 1
    ) prog on true
  ),
  derived as (
    select x.*,
      x.cid is not null and x.scope as in_scope,
      coalesce(x.rconfirmation, 'none') <> 'none' as conf_required,
      case
        when x.sid is null then null
        when coalesce(x.rconfirmation, 'none') = 'none' then 'not_required'
        when x.conf_decision = 'confirmed' then 'confirmed'
        when x.conf_decision = 'revoked' then 'revoked'
        else 'pending'
      end as conf_state,
      x.ev_missing and (x.reaffirmed_at is null or x.reaffirmed_at < x.last_deleted) as ev_withdrawn
    from slots x
  ),
  decided as (
    select d.*,
      case
        when not d.in_scope then 'unknown:not_enabled'
        when d.cstatus = 'archived' then
          case when d.sid is not null then 'withdrawn:answer_withdrawn' else 'unknown:not_enabled' end
        when d.sid is not null and d.conf_state = 'revoked' then 'withdrawn:confirmation_revoked'
        when d.sid is not null and d.cprogress = 'complete' and d.ev_withdrawn then 'withdrawn:evidence_withdrawn'
        when d.sid is not null and d.cprogress = 'complete' and d.und_differs then 'disputed:conflict'
        when d.cprogress = 'needs_recheck' then
          case when d.prog_kind = 'evidence_lost' then 'stale:evidence_lost' else 'stale:recheck_requested' end
        when d.sid is not null and d.cprogress = 'complete' and d.conf_state = 'pending' then 'not_confirmed:pending'
        when d.sid is not null and d.cprogress = 'complete' then 'available:'
        when d.und_proposal then 'not_confirmed:pending'
        when d.newest_answer is not null and d.newest_answer <> 'unknown' and d.newest_declined then 'not_confirmed:declined'
        when d.newest_answer = 'unknown' then 'unknown:unable_to_establish'
        else 'unknown:not_checked'
      end as state
    from derived d
  )
  select
    p_venue_id,
    z.key,
    z.cid,
    z.in_scope,
    case when z.state = 'available:' then 'available' else 'unavailable' end,
    nullif(split_part(z.state, ':', 1), 'available'),
    nullif(split_part(z.state, ':', 2), ''),
    z.rev,
    coalesce(z.stemplate, z.catversion),
    case when z.state = 'available:' then z.sanswer end,
    z.sanswer,
    z.sid,
    z.scontrib,
    case when z.sid is null then null when z.scontrib is not null then 'contribution' else 'submission' end,
    z.sbasis,
    case when coalesce(z.rtext, true) then z.sfinding end,
    case when coalesce(z.rtext, true) then z.slimitations end,
    case when coalesce(z.rtext, true) then z.sreason end,
    z.conf_required,
    z.conf_state,
    case when z.conf_state = 'confirmed' then z.cf_basis end,
    case when z.conf_state = 'confirmed' then z.cf_self end,
    case when z.conf_state = 'confirmed' then z.cf_at end,
    case when z.sid is null then null else z.photos end,
    case when z.sid is null then null else z.videos end,
    case
      when z.sid is null then null
      when z.ev_total = 0 then 'none_attached'
      when z.ev_withdrawn then 'withdrawn'
      else 'complete'
    end,
    case
      when z.sid is null then null
      when coalesce(z.rredaction, z.key = 'guest_wifi') then
        case when z.sredaction is true then 'recorded' else 'not_recorded' end
      else 'not_applicable'
    end,
    z.screated,
    coalesce(z.kcreated, z.screated),
    null::timestamptz,
    null::timestamptz,
    'unrated',
    z.und_pending,
    z.sid is not null and z.cprogress = 'complete' and z.und_differs,
    z.unk_at,
    z.unk_preset,
    z.rversion,
    z.cstatus,
    z.cprogress
  from decided z;
$$;

-- ---------------------------------------------------------------------------
-- Reader entry point (§5.3): service_role only, one snapshot per call
-- ---------------------------------------------------------------------------

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
  freshness_state text
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
      case when s.status = 'available' then s.freshness_state end
    from private.knowledge_slot_state(p_venue_id, v_keys) s
    order by array_position(v_keys, s.question_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- S3. Every new-path finding (§4.2). Returns the first result for a replayed
-- key; a stale slot revision records nothing.
create function public.knowledge_submit(
  p_check_id uuid,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_kind text,
  p_answer text,
  p_finding text,
  p_limitations text,
  p_reason text,
  p_unknown_preset text,
  p_tried_text text,
  p_change_reason text,
  p_responds_to uuid,
  p_asset_ids uuid[],
  p_internal_metadata jsonb,
  p_redaction_confirmed boolean,
  p_confirm_own boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_kind text := coalesce(p_kind, 'finding');
  v_confirm_own boolean := coalesce(p_confirm_own, false);
  v_assets uuid[] := coalesce(p_asset_ids, '{}');
  v_hash text;
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_template public.amenity_catalogue;
  v_basis text;
  v_manager boolean;
  v_revision bigint;
  v_finding text;
  v_limitations text;
  v_reason text;
  v_tried text;
  v_change text;
  v_preset text;
  v_asset uuid;
  v_why text;
  v_kinds text[];
  v_metadata jsonb;
  v_others boolean;
  v_outcome text;
  v_contribution public.knowledge_contributions;
  v_old record;
  v_replaced uuid;
  v_submission uuid;
  v_responds public.knowledge_decisions;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_kind not in ('finding', 'change_report', 'detail') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_answer is null or p_answer not in ('yes', 'no', 'not_applicable', 'unknown') then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;

  v_hash := private.knowledge_hash(jsonb_build_object(
    'checkId', p_check_id, 'slotRevision', p_slot_revision, 'kind', v_kind, 'answer', p_answer,
    'finding', p_finding, 'limitations', p_limitations, 'reason', p_reason,
    'unknownPreset', p_unknown_preset, 'triedText', p_tried_text, 'changeReason', p_change_reason,
    'respondsTo', p_responds_to,
    'assetIds', (select coalesce(jsonb_agg(a order by a), '[]'::jsonb) from unnest(v_assets) a),
    'internalMetadata', p_internal_metadata, 'redactionConfirmed', p_redaction_confirmed,
    'confirmOwn', v_confirm_own
  ));
  v_prior := private.knowledge_replay(p_idempotency_key, v_uid, 'submit', v_hash);
  if v_prior is not null then
    return v_prior || jsonb_build_object('recognition',
      private.knowledge_contribution_view((v_prior ->> 'contributionId')::uuid) -> 'recognition');
  end if;

  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
    raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_manager := v_basis in ('venue_manager', 'admin');
  if v_confirm_own and not v_manager then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if v_confirm_own and v_rule.confirmation <> 'none' and not v_rule.self_confirmation_allowed then
    raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
  end if;

  if cardinality(v_assets) > 10
     or array_position(v_assets, null) is not null
     or (select count(distinct a) from unnest(v_assets) a) <> cardinality(v_assets) then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;

  -- Lock order (§4.4): profile (above), key (above), assets, then the check.
  perform 1 from public.media_assets a
  where a.id = any(v_assets) and a.venue_id = v_check.venue_id
  order by a.id
  for share;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  perform private.amenity_assert_venue_active(v_check.venue_id);
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;

  v_finding := private.clean_text(p_finding, 2000, 'invalid_finding');
  v_limitations := private.clean_text(p_limitations, 2000, 'invalid_limitations');
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  v_change := private.clean_text(p_change_reason, 500, 'invalid_change_reason');
  if p_answer in ('no', 'not_applicable') and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_answer = 'unknown' then
    v_preset := p_unknown_preset;
    if v_preset is null or v_preset not in ('no_one_sure', 'could_not_access', 'needs_access', 'other') then
      raise exception 'invalid_unknown_preset' using errcode = 'P0001';
    end if;
    v_tried := private.clean_text(p_tried_text, 500, 'invalid_tried_text');
    if v_tried is null then
      raise exception 'tried_text_required' using errcode = 'P0001';
    end if;
  end if;
  if v_kind = 'change_report' and v_change is null then
    raise exception 'change_reason_required' using errcode = 'P0001';
  end if;
  if v_kind = 'detail' then
    select d.* into v_responds from public.knowledge_decisions d
    join public.knowledge_contributions x on x.id = d.contribution_id
    where d.id = p_responds_to and d.decision = 'detail_requested'
      and x.check_id = v_check.id and x.contributed_by = v_uid;
    if not found or private.knowledge_is_terminal(v_responds.contribution_id) then
      raise exception 'invalid_responds_to' using errcode = 'P0001';
    end if;
  end if;

  foreach v_asset in array v_assets loop
    v_why := private.amenity_asset_ineligibility(v_check, v_asset);
    if v_why is not null then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_asset, 'reason', v_why)::text;
    end if;
  end loop;
  select t.* into v_template from public.amenity_catalogue t where t.key = v_check.template_key;
  v_kinds := array(
    select case a.media_type when 'image' then 'photo' else 'video' end
    from public.media_assets a where a.id = any(v_assets)
  );
  if p_answer = 'yes' and not private.amenity_rule_met(v_template.evidence_rule, v_kinds) then
    raise exception 'evidence_rule_unmet' using errcode = 'P0001', detail = v_template.evidence_rule;
  end if;
  if v_check.template_key = 'guest_wifi' then
    if p_answer = 'yes' or p_internal_metadata is not null then
      v_metadata := private.amenity_wifi_metadata(p_internal_metadata);
    end if;
    if (p_answer = 'yes' or 'photo' = any(v_kinds)) and p_redaction_confirmed is distinct from true then
      raise exception 'redaction_not_confirmed' using errcode = 'P0001';
    end if;
  elsif p_internal_metadata is not null then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;

  v_others := exists (
    select 1 from public.knowledge_contributions x
    where x.check_id = v_check.id and x.contributed_by <> v_uid and x.answer <> 'unknown'
      and not private.knowledge_is_terminal(x.id)
  );
  if p_answer = 'unknown' then
    v_outcome := 'recorded';
  elsif v_manager then
    v_outcome := case
      when v_rule.confirmation = 'none' or v_confirm_own then 'current'
      else 'awaiting_confirmation'
    end;
  elsif v_rule.confirmation = 'none' and v_rule.unassigned_auto_complete
        and v_check.progress in ('needs_capture', 'needs_recheck')
        and (v_check.assignee_user_id is null or v_check.assignee_user_id = v_uid)
        and not v_others then
    v_outcome := 'current';
  else
    v_outcome := 'awaiting_confirmation';
  end if;

  -- At most one undecided finding per person and question (§9.3).
  for v_old in
    select x.id from public.knowledge_contributions x
    where x.check_id = v_check.id and x.contributed_by = v_uid
      and not private.knowledge_is_terminal(x.id)
    order by x.created_at
  loop
    perform private.knowledge_decision(v_check, v_old.id, null, 'replaced', v_uid, 'self',
      false, v_rule.rule_version, null, v_revision, null);
    v_replaced := v_old.id;
  end loop;

  insert into public.knowledge_contributions (
    venue_id, check_id, question_key, contributed_by, contributor_basis, kind, answer,
    finding, limitations, reason, unknown_preset, tried_text, change_reason, responds_to_decision_id,
    based_on_slot_revision, based_on_submission_id, rule_version, template_version, evidence_rule,
    internal_metadata, redaction_confirmed, confirm_own, initial_outcome, idempotency_key, request_hash
  )
  values (
    v_check.venue_id, v_check.id, v_check.template_key, v_uid, v_basis, v_kind, p_answer,
    v_finding, v_limitations, case when p_answer in ('no', 'not_applicable') then v_reason end,
    v_preset, v_tried, v_change, case when v_kind = 'detail' then p_responds_to end,
    v_revision, v_check.current_submission_id, v_rule.rule_version, v_template.catalogue_version,
    v_template.evidence_rule, v_metadata, p_redaction_confirmed, v_confirm_own, v_outcome,
    p_idempotency_key, v_hash
  )
  returning * into v_contribution;

  insert into public.knowledge_contribution_assets (contribution_id, venue_id, asset_id, evidence_kind)
  select v_contribution.id, v_check.venue_id, a.id, case a.media_type when 'image' then 'photo' else 'video' end
  from public.media_assets a where a.id = any(v_assets);

  perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id,
    'contribution_recorded', v_contribution.id, null, null,
    jsonb_build_object('kind', v_kind, 'answer', p_answer, 'outcome', v_outcome));

  if v_outcome = 'current' then
    v_submission := private.knowledge_adopt(
      v_contribution, v_check,
      case when v_manager then v_uid end,
      case when v_manager then v_basis else 'rule' end,
      v_rule.confirmation <> 'none', v_rule.confirmation <> 'none',
      v_revision, v_rule.rule_version
    );
  end if;

  delete from public.knowledge_drafts d
  where d.user_id = v_uid and d.check_id = v_check.id and d.idempotency_key = p_idempotency_key;

  v_result := jsonb_build_object(
    'contributionId', v_contribution.id,
    'submissionId', v_submission,
    'outcome', v_outcome,
    'replacedOwn', v_replaced,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'replayed', false
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'submit', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  -- Recognition is read now, not stored: a later decision can change it.
  return v_result || jsonb_build_object('recognition',
    private.knowledge_contribution_view(v_contribution.id) -> 'recognition');
end;
$$;

-- S7, S8, S9, S11 and revoke/reaffirm: one decision about a contribution or a
-- current submission (§9.1, §9.4).
create function public.knowledge_decide(
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
    'replayed', false
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'decide', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- S10. A conflict decision settles every finding listed at the decided slot
-- revision (§9.2): at most one adopted, other answers declined, Couldn't
-- establish marked seen. p_choose NULL keeps the answer in use.
create function public.knowledge_resolve_conflict(
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
    'replayed', false
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'resolve_conflict', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- Admin: add or remove slots from the working list. Locks every affected check
-- FOR UPDATE (id order) first, so it serialises with the legacy guard (§4.1).
create function public.knowledge_set_working_list(
  p_venue_id uuid,
  p_keys text[],
  p_enabled boolean,
  p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_key text;
  v_check_id uuid;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_changed integer := 0;
  v_rows integer;
begin
  if p_enabled is null then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  if p_keys is null or cardinality(p_keys) not between 1 and 39
     or array_position(p_keys, null) is not null
     or (select count(distinct k) from unnest(p_keys) k) <> cardinality(p_keys) then
    raise exception 'invalid_key_list' using errcode = 'P0001';
  end if;
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_enabled then
    perform private.amenity_assert_venue_active(p_venue_id);
  end if;
  foreach v_key in array p_keys loop
    if not exists (select 1 from public.knowledge_question_rules r where r.question_key = v_key) then
      raise exception 'knowledge_rule_missing' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.venue_amenity_checks c where c.venue_id = p_venue_id and c.template_key = v_key
    ) then
      raise exception 'amenity_check_not_found' using errcode = 'P0002';
    end if;
  end loop;

  perform 1 from public.venue_amenity_checks c
  where c.venue_id = p_venue_id and c.template_key = any(p_keys)
  order by c.id
  for update;

  foreach v_key in array p_keys loop
    select c.id into v_check_id from public.venue_amenity_checks c
    where c.venue_id = p_venue_id and c.template_key = v_key;
    -- The check locks above serialise concurrent calls; the conflict clause
    -- and row counts still keep a racing repeat a no-op, never an error.
    if p_enabled then
      insert into public.knowledge_working_list (venue_id, question_key, enabled_by, reason)
      values (p_venue_id, v_key, v_uid, v_reason)
      on conflict (venue_id, question_key) where disabled_at is null do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        perform private.knowledge_event(p_venue_id, v_key, v_check_id, 'working_list_enabled', null, null, null, '{}');
        v_changed := v_changed + 1;
      end if;
    else
      update public.knowledge_working_list w
      set disabled_at = now(), disabled_by = v_uid
      where w.venue_id = p_venue_id and w.question_key = v_key and w.disabled_at is null;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        perform private.knowledge_event(p_venue_id, v_key, v_check_id, 'working_list_disabled', null, null, null, '{}');
        v_changed := v_changed + 1;
      end if;
    end if;
  end loop;
  return v_changed;
end;
$$;

-- S4. One server draft per person and check (§13). Never history, never read
-- by the resolver; drafts older than 90 days are not returned and are purged
-- on the person's next save.
create function public.knowledge_save_draft(
  p_check_id uuid,
  p_draft_revision integer,
  p_payload jsonb,
  p_asset_ids uuid[],
  p_idempotency_key uuid
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
  v_existing public.knowledge_drafts;
  v_revision integer;
  v_saved timestamptz;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or private.knowledge_basis(v_check.venue_id) is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    raise exception 'invalid_draft' using errcode = 'P0001';
  end if;
  if cardinality(coalesce(p_asset_ids, '{}')) > 10 then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  delete from public.knowledge_drafts d
  where d.user_id = v_uid and d.updated_at < now() - interval '90 days';
  select d.* into v_existing from public.knowledge_drafts d
  where d.user_id = v_uid and d.check_id = p_check_id
  for update;
  if found then
    if p_draft_revision is distinct from v_existing.draft_revision then
      raise exception 'draft_conflict' using errcode = 'NLK05',
        detail = jsonb_build_object('draftRevision', v_existing.draft_revision)::text;
    end if;
    update public.knowledge_drafts d
    set payload = p_payload, asset_ids = coalesce(p_asset_ids, '{}'), idempotency_key = p_idempotency_key,
        draft_revision = d.draft_revision + 1, updated_at = now()
    where d.user_id = v_uid and d.check_id = p_check_id
    returning d.draft_revision, d.updated_at into v_revision, v_saved;
  else
    if p_draft_revision is not null then
      raise exception 'draft_conflict' using errcode = 'NLK05',
        detail = jsonb_build_object('draftRevision', null)::text;
    end if;
    insert into public.knowledge_drafts (user_id, check_id, venue_id, draft_revision, payload, asset_ids, idempotency_key)
    values (v_uid, p_check_id, v_check.venue_id, 1, p_payload, coalesce(p_asset_ids, '{}'), p_idempotency_key)
    returning draft_revision, updated_at into v_revision, v_saved;
  end if;
  return jsonb_build_object('draftRevision', v_revision, 'savedAt', v_saved);
end;
$$;

create function public.knowledge_get_draft(p_check_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_active_user() then (
    select jsonb_build_object(
      'checkId', d.check_id, 'venueId', d.venue_id, 'draftRevision', d.draft_revision,
      'payload', d.payload, 'assetIds', to_jsonb(d.asset_ids), 'idempotencyKey', d.idempotency_key,
      'savedAt', d.updated_at,
      'sendable', private.knowledge_basis(d.venue_id) is not null
    )
    from public.knowledge_drafts d
    where d.user_id = (select auth.uid()) and d.check_id = p_check_id
      and d.updated_at >= now() - interval '90 days'
  ) end;
$$;

create function public.knowledge_discard_draft(p_check_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_count integer;
begin
  delete from public.knowledge_drafts d where d.user_id = v_uid and d.check_id = p_check_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- S13. Hide a closed-assignment notice for the assignee only.
create function public.knowledge_dismiss_outcome(p_event_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  if not exists (
    select 1 from public.knowledge_events e
    where e.id = p_event_id and e.kind = 'assignment_closed_by_other'
      and e.detail ->> 'assigneeId' = v_uid::text
  ) then
    return false;
  end if;
  insert into public.knowledge_outcome_dismissals (user_id, event_id)
  values (v_uid, p_event_id)
  on conflict do nothing;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Evidence withdrawal (§10): a knowledge event per in-scope slot whose current
-- submission used the deleted asset. Runs after the legacy evidence-lost
-- trigger (trigger name order); locks checks in id order after the asset row.
-- ---------------------------------------------------------------------------

create function private.media_assets_knowledge_evidence_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check record;
begin
  for v_check in
    select c.id, c.venue_id, c.template_key, c.current_submission_id
    from public.amenity_submission_assets sa
    join public.venue_amenity_checks c on c.current_submission_id = sa.submission_id
    where sa.asset_id = new.id
      and private.knowledge_in_scope(c.venue_id, c.template_key)
    order by c.id
    for update of c
  loop
    perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id,
      'evidence_withdrawn', null, v_check.current_submission_id, null,
      jsonb_build_object('assetId', new.id));
  end loop;
  return null;
end;
$$;

create trigger media_assets_knowledge_evidence_withdrawn
  after update of deleted_at on public.media_assets
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.media_assets_knowledge_evidence_withdrawn();

-- ---------------------------------------------------------------------------
-- Evidence media gate: today's body plus contribution evidence (§12)
-- ---------------------------------------------------------------------------

-- Unchanged branches first. The added branch lets the people who decide a
-- finding see its photos and videos before it is adopted: the venue's
-- effective manager or an admin, and the contributor while still active staff
-- at that venue (the submitter rule above). Colleagues gain nothing.
create or replace function public.amenity_evidence_asset(p_asset_id uuid)
returns table (asset_id uuid, media_type public.media_type, has_thumbnail boolean, has_preview boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.media_type, a.thumbnail_path is not null, a.preview_path is not null
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and private.is_active_user()
    and (
      exists (
        select 1
        from public.amenity_submission_assets sa
        join public.amenity_submissions s on s.id = sa.submission_id
        where sa.asset_id = a.id
          and (
            private.can_manage_venue(s.venue_id)
            or (
              s.submitted_by = (select auth.uid())
              and private.active_staff_venue_id() = s.venue_id
            )
          )
      )
      or exists (
        select 1
        from public.venue_amenity_checks c
        where c.venue_id = a.venue_id
          and c.status = 'active'
          and private.amenity_can_submit(c)
          and (
            a.uploader_id = (select auth.uid())
            or (private.can_manage_venue(c.venue_id) and private.amenity_is_legacy_media(c, a.id))
          )
      )
      or exists (
        select 1
        from public.knowledge_contribution_assets ka
        join public.knowledge_contributions x on x.id = ka.contribution_id
        where ka.asset_id = a.id
          and (
            private.can_manage_venue(x.venue_id)
            or (
              x.contributed_by = (select auth.uid())
              and private.active_staff_venue_id() = x.venue_id
            )
          )
      )
    );
$$;

revoke all on function public.amenity_evidence_asset(uuid) from public, anon, service_role;
grant execute on function public.amenity_evidence_asset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recognition (§3.5): the credit predicate for one submission in its month
-- ---------------------------------------------------------------------------

create function private.knowledge_submission_scored(p_submission_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select x.*, (date_trunc('month', x.created_at at time zone 'Europe/London'))::date as month
    from public.amenity_submissions x where x.id = p_submission_id
  )
  select case
    when not exists (select 1 from s) then jsonb_build_object('kind', 'none')
    when private.venue_monthly_completion_target(s.venue_id, s.month) is null then jsonb_build_object('kind', 'none')
    -- Participants exactly as coverage_staff_progress_v2 counts them: a staff
    -- membership at the venue overlapping the month, or a legacy monthly
    -- target created in its own month. Anyone else (a manager account) has no
    -- credit row, so no recognition (§3.5).
    when not exists (
      select 1 from private.completion_staff_venue_memberships m
      where m.staff_id = s.submitted_by and m.venue_id = s.venue_id
        and m.started_at < private.london_month_end(s.month)
        and (m.ended_at is null or m.ended_at > private.london_month_start(s.month))
    ) and not exists (
      select 1 from public.monthly_targets t
      where t.staff_id = s.submitted_by and t.venue_id = s.venue_id and t.period_month = s.month
        and t.created_at >= private.london_month_start(s.month)
        and t.created_at < private.london_month_end(s.month)
    ) then jsonb_build_object('kind', 'none')
    when (
      select e.kind = 'submitted' and e.detail ->> 'submissionId' = s.id::text
      from public.amenity_check_events e
      where e.check_id = s.check_id
        and e.created_at < private.london_month_end(s.month) and e.created_at <= now()
        and e.kind in ('submitted', 'reopened', 'evidence_lost')
      order by e.id desc limit 1
    ) is true
    and (
      select e.kind from public.amenity_check_events e
      where e.check_id = s.check_id
        and e.created_at < private.london_month_end(s.month) and e.created_at <= now()
        and e.kind in ('archived', 'restored')
      order by e.id desc limit 1
    ) is distinct from 'archived'
    then jsonb_build_object('kind', 'scored', 'period', to_char(s.month, 'YYYY-MM'))
    else jsonb_build_object('kind', 'not_scored')
  end
  from s
  union all
  select jsonb_build_object('kind', 'none') where not exists (select 1 from s)
  limit 1;
$$;

-- A contribution's state for its author (B01-06 history; WS2 §2.2).
create function private.knowledge_contribution_view(p_contribution_id uuid)
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
      when d.decision = 'adopted' and not (c.current_submission_id = d.resulting_submission_id and c.progress = 'complete' and c.status = 'active') then
        case
          when c.status = 'archived' then 'archived'
          when c.current_submission_id is distinct from d.resulting_submission_id then 'replaced_by_newer'
          else 'reopened'
        end
      when d.decision = 'replaced' then 'replaced_by_own'
    end,
    'managerNote', case when d.decision in ('declined', 'detail_requested') then d.note end,
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
  where x.id = p_contribution_id;
$$;

-- ---------------------------------------------------------------------------
-- Screen reads (S1, S2, S5, S6, S14), all through the resolver
-- ---------------------------------------------------------------------------

create function private.knowledge_slot_json(
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
      'evidenceState', st.evidence_state) end,
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
  from private.knowledge_slot_state(p_check.venue_id, array[p_check.template_key]) st
  join public.amenity_catalogue t on t.key = p_check.template_key
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

-- S1. The caller's working list at their current venue.
create function public.knowledge_working_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_venue uuid := coalesce(private.active_staff_venue_id(), private.my_manager_venue_id());
  v_basis text;
begin
  if v_venue is null then
    return jsonb_build_object('venue', null, 'items', '[]'::jsonb);
  end if;
  v_basis := private.knowledge_basis(v_venue);
  return jsonb_build_object(
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name) from public.venues v where v.id = v_venue),
    'items', coalesce((
      select jsonb_agg(private.knowledge_slot_json(c, v_uid, v_basis) order by t.position, c.template_key)
      from public.venue_amenity_checks c
      join public.amenity_catalogue t on t.key = c.template_key
      where c.venue_id = v_venue and c.status = 'active'
        and private.knowledge_in_scope(c.venue_id, c.template_key)
    ), '[]'::jsonb)
  );
end;
$$;

-- S2. One question, with pending findings and permissions.
create function public.knowledge_check(p_check_id uuid)
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
        'wifi', case when v_manager or x.contributed_by = v_uid then x.internal_metadata end,
        'evidence', coalesce((
          select jsonb_agg(jsonb_build_object(
            'assetId', ca.asset_id, 'kind', ca.evidence_kind,
            'available', a.deleted_at is null and a.upload_state = 'ready')
            order by ca.evidence_kind, ca.asset_id)
          from public.knowledge_contribution_assets ca
          join public.media_assets a on a.id = ca.asset_id
          where ca.contribution_id = x.id
        ), '[]'::jsonb)
      ) order by x.created_at, x.id)
      from public.knowledge_contributions x
      join public.profiles p on p.id = x.contributed_by
      where x.check_id = v_check.id
        and not private.knowledge_is_terminal(x.id)
        and (v_manager or x.contributed_by = v_uid)
    ), '[]'::jsonb)
  );
end;
$$;

-- S6. Findings and answers waiting for a manager at their venue.
create function public.knowledge_to_confirm(p_venue_id uuid)
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
  select coalesce(jsonb_agg(i order by i ->> 'sentAt'), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'checkId', c.id, 'questionKey', c.template_key, 'question', t.question,
      'findingRef', jsonb_build_object('type', 'contribution', 'id', x.id),
      'kind', x.kind, 'answer', x.answer, 'senderName', p.display_name, 'sentAt', x.created_at,
      'slotRevision', st.revision,
      'conflict', (
        select count(*) from public.knowledge_contributions y
        where y.check_id = c.id and y.answer <> 'unknown' and not private.knowledge_is_terminal(y.id)
      ) > 1 or (st.current_answer is not null and c.progress = 'complete' and x.answer is distinct from st.current_answer)
    ) as i
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
      'slotRevision', st.revision, 'conflict', false
    )
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    cross join lateral private.knowledge_slot_state(c.venue_id, array[c.template_key]) st
    left join public.profiles p on p.id = c.answered_by
    where c.venue_id = v_venue and st.in_scope and c.progress = 'complete'
      and (st.detail in ('pending', 'evidence_withdrawn', 'confirmation_revoked'))
  ) q;
  return jsonb_build_object('count', jsonb_array_length(v_items), 'items', v_items);
end;
$$;

-- S5. The caller's own findings across venues, read-only for earlier venues.
-- The cursor is the previous page's nextCursor, "<UTC instant>|<key>". Items
-- sort by (time, key) descending, so items sharing a time are never skipped
-- or repeated across pages.
create function public.knowledge_my_contributions(p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_before_at timestamptz;
  v_before_key text collate "C";
  v_items jsonb;
  v_next text;
begin
  if p_cursor is not null then
    if p_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[cse]:[0-9a-f-]{1,36}$' then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
    v_before_at := split_part(p_cursor, '|', 1)::timestamptz;
    v_before_key := split_part(p_cursor, '|', 2);
  end if;
  with own as (
    select x.created_at as at, ('c:' || x.id::text) collate "C" as k,
      private.knowledge_contribution_view(x.id) as item
    from public.knowledge_contributions x
    where x.contributed_by = v_uid
    union all
    select s.created_at, ('s:' || s.id::text) collate "C", jsonb_build_object(
      'findingRef', jsonb_build_object('type', 'submission', 'id', s.id),
      'checkId', s.check_id, 'venueId', s.venue_id, 'venueName', v.name,
      'questionKey', c.template_key, 'question', t.question, 'kind', 'finding',
      'answer', s.answer, 'sentAt', s.created_at,
      'state', case when c.current_submission_id = s.id and c.progress = 'complete' and c.status = 'active'
        then 'current' else 'no_longer_used' end,
      'recognition', private.knowledge_submission_scored(s.id)
    )
    from public.amenity_submissions s
    join public.venue_amenity_checks c on c.id = s.check_id
    join public.venues v on v.id = s.venue_id
    join public.amenity_catalogue t on t.key = c.template_key
    where s.submitted_by = v_uid and s.source_contribution_id is null
    union all
    select e.created_at, ('e:' || lpad(e.id::text, 19, '0')) collate "C", jsonb_build_object(
      'kind', 'assignment_closed', 'state', 'assignment_closed', 'checkId', e.check_id,
      'venueId', e.venue_id, 'questionKey', e.question_key, 'question', t.question,
      'answeredBy', bp.display_name, 'sentAt', e.created_at)
    from public.knowledge_events e
    join public.amenity_catalogue t on t.key = e.question_key
    left join public.profiles bp on bp.id = (e.detail ->> 'answeredBy')::uuid
    where e.kind = 'assignment_closed_by_other' and e.detail ->> 'assigneeId' = v_uid::text
  ),
  page as (
    select * from own o
    where v_before_at is null or (o.at, o.k) < (v_before_at, v_before_key)
    order by o.at desc, o.k desc
    limit v_limit + 1
  )
  -- When there is one more item, the next page starts after the last shown.
  select coalesce(jsonb_agg(item order by at desc, k desc) filter (where rn <= v_limit), '[]'::jsonb),
    case when count(*) > v_limit then max(
      (to_char(z.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || z.k) collate "C"
    ) filter (where z.rn = v_limit) end
  into v_items, v_next
  from (select p.*, row_number() over (order by p.at desc, p.k desc) as rn from page p) z;
  return jsonb_build_object(
    'items', v_items,
    'nextCursor', v_next,
    'drafts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'checkId', d.check_id, 'venueId', d.venue_id, 'savedAt', d.updated_at,
        'sendable', private.knowledge_basis(d.venue_id) is not null) order by d.updated_at desc)
      from public.knowledge_drafts d
      where d.user_id = v_uid and d.updated_at >= now() - interval '90 days'
    ), '[]'::jsonb),
    'hiddenEarlierVenues', '[]'::jsonb
  );
end;
$$;

-- S14. Pending recognition for the caller in a London month.
create function public.knowledge_my_pending(p_period date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_active_user() then jsonb_build_object(
    'awaitingConfirmation', (
      select count(*) from public.knowledge_contributions x
      where x.contributed_by = (select auth.uid()) and x.answer <> 'unknown'
        and x.created_at >= private.london_month_start(coalesce(p_period, private.current_london_month()))
        and x.created_at < private.london_month_end(coalesce(p_period, private.current_london_month()))
        and not private.knowledge_is_terminal(x.id)
    ),
    'unknownRecorded', (
      select count(*) from public.knowledge_contributions x
      where x.contributed_by = (select auth.uid()) and x.answer = 'unknown'
        and x.created_at >= private.london_month_start(coalesce(p_period, private.current_london_month()))
        and x.created_at < private.london_month_end(coalesce(p_period, private.current_london_month()))
    )
  ) end;
$$;

-- §16 step 1. Read-only admin preview of a venue's knowledge slots.
create function public.knowledge_pilot_preview(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'questionKey', st.question_key,
      'checkId', st.check_id,
      'checkStatus', st.check_status,
      'progress', st.check_progress,
      'inScope', st.in_scope,
      'status', st.status,
      'reason', st.reason,
      'detail', st.detail,
      'revision', st.revision,
      'submissions', (select count(*) from public.amenity_submissions s where s.check_id = st.check_id),
      'wifiWithoutRedactionProof', case when st.question_key = 'guest_wifi' then (
        select count(*) from public.amenity_submissions s
        where s.check_id = st.check_id and s.redaction_confirmed is distinct from true) end,
      'relatedLegacyFacts', (
        select count(*) from public.venue_amenity_facts f
        where f.venue_id = p_venue_id and f.amenity_key = any(private.amenity_legacy_coverage_keys(st.question_key)))
    ) order by st.question_key)
    from private.knowledge_slot_state(
      p_venue_id, array(select r.question_key from public.knowledge_question_rules r group by r.question_key)
    ) st
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_rule(text),
  private.knowledge_in_scope(uuid, text),
  private.knowledge_slot_revision(uuid, text),
  private.knowledge_event(uuid, text, uuid, text, uuid, uuid, uuid, jsonb),
  private.knowledge_basis(uuid),
  private.knowledge_lock_actor(),
  private.knowledge_hash(jsonb),
  private.knowledge_replay(uuid, uuid, text, text),
  private.knowledge_record_command(uuid, uuid, text, text, uuid, text, jsonb),
  private.knowledge_is_terminal(uuid),
  private.knowledge_decision(public.venue_amenity_checks, uuid, uuid, text, uuid, text, boolean, integer, text, bigint, uuid),
  private.knowledge_reopen(public.venue_amenity_checks, text),
  private.knowledge_adopt(public.knowledge_contributions, public.venue_amenity_checks, uuid, text, boolean, boolean, bigint, integer),
  private.knowledge_slot_state(uuid, text[]),
  private.media_assets_knowledge_evidence_withdrawn(),
  private.knowledge_submission_scored(uuid),
  private.knowledge_contribution_view(uuid),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text)
from public, anon, authenticated;

grant execute on function
  private.knowledge_rule(text),
  private.knowledge_in_scope(uuid, text),
  private.knowledge_slot_revision(uuid, text),
  private.knowledge_slot_state(uuid, text[]),
  private.knowledge_submission_scored(uuid)
to service_role;

-- The replaced legacy RPC keeps its grants (CREATE OR REPLACE); restated as in
-- 20261107120000_amenity_catalogue.sql.
revoke all on function
  public.amenity_submit_finding(uuid, integer, uuid, text, text, text, text, uuid[], jsonb, boolean)
from public, anon, service_role;
grant execute on function
  public.amenity_submit_finding(uuid, integer, uuid, text, text, text, text, uuid[], jsonb, boolean)
to authenticated;

revoke all on function
  public.knowledge_reader_answers_v1(uuid, text[])
from public, anon, authenticated;
grant execute on function public.knowledge_reader_answers_v1(uuid, text[]) to service_role;

revoke all on function
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.knowledge_set_working_list(uuid, text[], boolean, text),
  public.knowledge_save_draft(uuid, integer, jsonb, uuid[], uuid),
  public.knowledge_get_draft(uuid),
  public.knowledge_discard_draft(uuid),
  public.knowledge_dismiss_outcome(bigint),
  public.knowledge_working_list(),
  public.knowledge_check(uuid),
  public.knowledge_to_confirm(uuid),
  public.knowledge_my_contributions(text, integer),
  public.knowledge_my_pending(date),
  public.knowledge_pilot_preview(uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.knowledge_set_working_list(uuid, text[], boolean, text),
  public.knowledge_save_draft(uuid, integer, jsonb, uuid[], uuid),
  public.knowledge_get_draft(uuid),
  public.knowledge_discard_draft(uuid),
  public.knowledge_dismiss_outcome(bigint),
  public.knowledge_working_list(),
  public.knowledge_check(uuid),
  public.knowledge_to_confirm(uuid),
  public.knowledge_my_contributions(text, integer),
  public.knowledge_my_pending(date),
  public.knowledge_pilot_preview(uuid)
to authenticated;
