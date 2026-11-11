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
-- * Refused with freshness_basis_unavailable (NLK15) wherever such a rule is
--   bound to such a question:
--   - a question version naming an observed_on rule for a use
--     (knowledge_question_versions, before insert);
--   - an observed_on version of a rule that a version of such a question
--     already names for that use (knowledge_freshness_policies, before insert);
--   - the admin Check dates preview proposing one for the question's version
--     in force (public.knowledge_freshness_preview, body otherwise unchanged).
-- No existing row is affected: no registry version names a rule (OD-15).

create function private.knowledge_schema_has_checked_on(p_schema text, p_version integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_schema || '@' || p_version in ('facility@1', 'accessibility@1', 'service@1'), false);
$$;

create function private.knowledge_question_version_basis_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_use text;
  v_rule text;
begin
  if private.knowledge_schema_has_checked_on(new.value_schema, new.value_schema_version) then
    return new;
  end if;
  foreach v_use in array array['internal', 'public'] loop
    v_rule := new.freshness ->> v_use;
    if v_rule is not null and exists (
      select 1 from public.knowledge_freshness_policies p
      where p.id = v_rule and p.use = v_use and p.basis = 'observed_on'
    ) then
      raise exception 'freshness_basis_unavailable' using errcode = 'NLK15',
        detail = jsonb_build_object('key', new.key, 'version', new.version, 'schema', new.value_schema,
          'schemaVersion', new.value_schema_version, 'use', v_use, 'policyId', v_rule)::text;
    end if;
  end loop;
  return new;
end;
$$;

create trigger knowledge_question_versions_basis_guard
  before insert on public.knowledge_question_versions
  for each row execute function private.knowledge_question_version_basis_guard();

create function private.knowledge_freshness_policy_basis_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.knowledge_question_versions;
begin
  if new.basis <> 'observed_on' then
    return new;
  end if;
  select v.* into v_version
  from public.knowledge_question_versions v
  where v.freshness ->> new.use = new.id
    and not private.knowledge_schema_has_checked_on(v.value_schema, v.value_schema_version)
  order by v.key, v.version
  limit 1;
  if found then
    raise exception 'freshness_basis_unavailable' using errcode = 'NLK15',
      detail = jsonb_build_object('key', v_version.key, 'version', v_version.version,
        'schema', v_version.value_schema, 'schemaVersion', v_version.value_schema_version,
        'use', new.use, 'policyId', new.id)::text;
  end if;
  return new;
end;
$$;

create trigger knowledge_freshness_policies_basis_guard
  before insert on public.knowledge_freshness_policies
  for each row execute function private.knowledge_freshness_policy_basis_guard();

revoke all on function
  private.knowledge_schema_has_checked_on(text, integer),
  private.knowledge_question_version_basis_guard(),
  private.knowledge_freshness_policy_basis_guard()
from public, anon, authenticated, service_role;

-- The b03e body, with the basis check after the field checks: the question's
-- version in force (else its latest) must record Checked on for an
-- observed_on rule.
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

  select * into v_version from private.knowledge_version_as_of(p_key, now());
  if v_version.key is null then
    select v.* into v_version from public.knowledge_question_versions v
    where v.key = p_key order by v.version desc limit 1;
  end if;
  if not private.knowledge_schema_has_checked_on(v_version.value_schema, v_version.value_schema_version) then
    foreach v_use in array array['internal', 'public'] loop
      if exists (
        select 1 from public.knowledge_freshness_policies p
        where p.id = p_policy ->> v_use and p.use = v_use and p.basis = 'observed_on'
      ) then
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
