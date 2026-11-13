-- The registry identifies a value schema by its name and version. A new
-- form version with the same name must go through the same upgrade rules
-- as a different schema name, both on read and in the admin upgrade run.
-- Rollback: restore the slot reader from 20261110160000 and the upgrade
-- candidate function from 20261110110831 in a forward migration.

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

create or replace function private.knowledge_upgrade_candidates(p_key text)
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
      when (coalesce(d.value_schema, v1.value_schema), coalesce(d.value_schema_version, v1.value_schema_version))
        is not distinct from (lv.value_schema, lv.value_schema_version) then 'current_schema'
      else 'upgrade'
    end
  from public.venue_amenity_checks c
  join public.amenity_submissions s on s.id = c.current_submission_id
  left join public.knowledge_contribution_details d on d.contribution_id = s.source_contribution_id
  cross join lv
  cross join v1
  where c.template_key = p_key and c.progress = 'complete' and c.status = 'active';
$$;
