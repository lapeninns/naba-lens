-- B03 owner decision (11 Nov 2026): a freshness rule that counts from the day
-- an answer was checked (basis observed_on) applies only to a question whose
-- form records Checked on (b03-ui-design §2.1, §3.2). Elsewhere every answer
-- reads basis_missing, and its rechecks (S§7.4 M4: close only when current
-- and fresh) could never close.
--
-- * private.knowledge_schema_has_checked_on(name, version): the forms this
--   build renders with Checked on, by schema name and version: facility@1,
--   accessibility@1 and service@1 (CHECKED_ON_FORMS in
--   components/nabalens/knowledge/question-form.ts; a unit test holds the
--   two together). A later version of those schemas, which the registry
--   accepts, has no form here and so no Checked on.
-- * private.knowledge_policy_counts_from_check(id, use): whether a rule
--   counts from the check day, read from its latest version for that use, the
--   one the preview's forecast and freshness now read.
-- * private.knowledge_basis_conflict(key): the first way a question breaks
--   the decision, or null:
--   - a version whose own form has no Checked on names such a rule; or
--   - the latest version's form has no Checked on while a version in force
--     now, or from a scheduled date, names such a rule. Capture renders the
--     latest version, and submit, correct, import and the detail checks
--     validate against it, while freshness reads the version in force
--     (knowledge_version_as_of): a successor scheduled without Checked on
--     would take the date away while the earlier rule still needs it.
--   Other scheduling is unchanged. To move a question with such a rule to a
--   form without Checked on, a version first drops the rule, or the new form
--   takes effect at once.
-- * Refused with freshness_basis_unavailable (NLK15):
--   - question versions that leave their question in conflict
--     (knowledge_question_versions, after insert);
--   - a rule version that leaves a question naming the rule in conflict
--     (knowledge_freshness_policies, after insert);
--   - the admin Check dates preview proposing such a rule for a question whose
--     latest form has no Checked on (public.knowledge_freshness_preview, body
--     otherwise unchanged).
-- No existing row is affected: no registry version names a rule (OD-15).

create function private.knowledge_schema_has_checked_on(p_schema text, p_version integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_schema || '@' || p_version in ('facility@1', 'accessibility@1', 'service@1'), false);
$$;

create function private.knowledge_policy_counts_from_check(p_id text, p_use text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select p.basis = 'observed_on' from public.knowledge_freshness_policies p
    where p.id = p_id and p.use = p_use
    order by p.version desc
    limit 1), false);
$$;

create function private.knowledge_basis_conflict(p_key text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_latest public.knowledge_question_versions;
  v_found record;
begin
  -- A version whose own form has no Checked on.
  select v.version, v.value_schema, v.value_schema_version, u.use, v.freshness ->> u.use as policy_id
  into v_found
  from public.knowledge_question_versions v
  cross join (values ('internal'), ('public')) u(use)
  where v.key = p_key
    and not private.knowledge_schema_has_checked_on(v.value_schema, v.value_schema_version)
    and private.knowledge_policy_counts_from_check(v.freshness ->> u.use, u.use)
  order by v.version, u.use
  limit 1;
  if found then
    return jsonb_build_object('key', p_key, 'version', v_found.version, 'schema', v_found.value_schema,
      'schemaVersion', v_found.value_schema_version, 'use', v_found.use, 'policyId', v_found.policy_id);
  end if;

  -- The form staff are given has no Checked on, while a version in force now
  -- or from a scheduled date names such a rule.
  select v.* into v_latest from public.knowledge_question_versions v
  where v.key = p_key order by v.version desc limit 1;
  if not found
     or private.knowledge_schema_has_checked_on(v_latest.value_schema, v_latest.value_schema_version) then
    return null;
  end if;
  select f.version, f.value_schema, f.value_schema_version, u.use, f.freshness ->> u.use as policy_id
  into v_found
  from (
    select now() as at
    union
    select greatest(x.created_at, coalesce(x.effective_from, x.created_at))
    from public.knowledge_question_versions x
    where x.key = p_key and greatest(x.created_at, coalesce(x.effective_from, x.created_at)) > now()
  ) t
  cross join lateral private.knowledge_version_as_of(p_key, t.at) f
  cross join (values ('internal'), ('public')) u(use)
  where f.key is not null
    and private.knowledge_policy_counts_from_check(f.freshness ->> u.use, u.use)
  order by t.at, u.use
  limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object('key', p_key, 'version', v_found.version, 'schema', v_found.value_schema,
    'schemaVersion', v_found.value_schema_version, 'use', v_found.use, 'policyId', v_found.policy_id,
    'form', jsonb_build_object('version', v_latest.version, 'schema', v_latest.value_schema,
      'schemaVersion', v_latest.value_schema_version));
end;
$$;

create function private.knowledge_question_version_basis_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conflict jsonb;
begin
  v_conflict := private.knowledge_basis_conflict(new.key);
  if v_conflict is not null then
    raise exception 'freshness_basis_unavailable' using errcode = 'NLK15', detail = v_conflict::text;
  end if;
  return null;
end;
$$;

-- After insert: the question as it stands with the new versions.
create trigger knowledge_question_versions_basis_guard
  after insert on public.knowledge_question_versions
  for each row execute function private.knowledge_question_version_basis_guard();

create function private.knowledge_freshness_policy_basis_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
  v_conflict jsonb;
begin
  -- A version of another basis can't make a rule count from the check day.
  if new.basis <> 'observed_on' then
    return null;
  end if;
  for v_key in
    select distinct v.key from public.knowledge_question_versions v
    where v.freshness ->> new.use = new.id
    order by v.key
  loop
    v_conflict := private.knowledge_basis_conflict(v_key);
    if v_conflict is not null then
      raise exception 'freshness_basis_unavailable' using errcode = 'NLK15', detail = v_conflict::text;
    end if;
  end loop;
  return null;
end;
$$;

create trigger knowledge_freshness_policies_basis_guard
  after insert on public.knowledge_freshness_policies
  for each row execute function private.knowledge_freshness_policy_basis_guard();

revoke all on function
  private.knowledge_schema_has_checked_on(text, integer),
  private.knowledge_policy_counts_from_check(text, text),
  private.knowledge_basis_conflict(text),
  private.knowledge_question_version_basis_guard(),
  private.knowledge_freshness_policy_basis_guard()
from public, anon, authenticated, service_role;

-- The b03e body, with the basis check after the field checks: the form staff
-- are given (the question's latest version) must record Checked on for a rule
-- counting from the check day.
create or replace function public.knowledge_freshness_preview(p_key text, p_policy jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    select c.venue_id, st.current_submission_id, kd.value_schema, kd.detail, kd.observed_on
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
        when 'stated_on' then case when s.value_schema = 'policy'
          then private.knowledge_safe_date(s.detail -> 'authority' ->> 'statedOn') end
        when 'event_end' then case when s.value_schema = 'schedule_event'
          then private.knowledge_safe_date(s.detail -> 'event' ->> 'localDate') end
      end,
      case when p.basis = 'event_end' then
        (private.knowledge_safe_date(s.detail -> 'event' ->> 'localDate') + 1)::timestamp
          at time zone private.venue_timezone(s.venue_id) end,
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
$$;
