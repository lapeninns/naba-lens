-- B03 import review: a headline-only source can support the headline. A
-- structured assertion can settle automatically only when its detail agrees
-- with the answer as corrected. A correction that clears detail overrides
-- the original detail just as a correction with a replacement does.
-- Forward rollback: restore the candidates body from 20261110114514 and the
-- apply body from 20261110105844, then remove the private helper.

create function private.knowledge_reconcile_matches(
  p_submission_id uuid, p_answer text, p_detail jsonb
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.amenity_submissions s
    left join lateral (
      select dc.id, dc.detail from public.knowledge_detail_corrections dc
      where p_detail is not null and dc.contribution_id = s.source_contribution_id
      order by dc.created_at desc, dc.id desc limit 1
    ) corrected on true
    left join public.knowledge_contribution_details d
      on p_detail is not null and corrected.id is null and d.contribution_id = s.source_contribution_id
    where s.id = p_submission_id and s.answer = p_answer
      and (p_detail is null or p_detail = case when corrected.id is null then d.detail else corrected.detail end)
  );
$$;

revoke all on function private.knowledge_reconcile_matches(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

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
      when private.knowledge_reconcile_matches(c.current_submission_id, k.answer, k.detail) then 'corroborates'
      else 'conflicts'
    end,
    k.source_ref
  from candidates k
  left join public.venue_amenity_checks c on c.venue_id = k.venue_id and c.template_key = k.question_key;
$$;

create or replace function public.knowledge_reconcile(p_kind text, p_mode text, p_venue_id uuid default null)
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
    -- The candidate snapshot precedes the row lock. Recheck on the locked
    -- slot so a concurrent correction cannot turn a conflict into a terminal
    -- 'seen' decision. A source can corroborate, never confirm (§8.2).
    if v_c.state = 'corroborates'
       and private.knowledge_reconcile_matches(v_check.current_submission_id, v_c.answer, v_c.detail) then
      perform private.knowledge_decision(v_check, v_contribution, null, 'seen', v_uid, 'admin', false,
        v_rule.rule_version, 'Imported: agrees with the answer in use', null, null);
    end if;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('runId', v_run, 'mode', 'apply', 'dryRunId', v_dry.id, 'counts', v_counts,
    'created', v_created, 'conflicts', v_conflicts, 'sourceRevisions', v_revisions);
end;
$$;
