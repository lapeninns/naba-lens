-- B03 review: require a title and date for a committed event, and use one
-- cutoff for event-end freshness in both live answers and the admin preview.
-- Rollback: restore the earlier function bodies in a forward migration,
-- then drop the legacy wrapper and move the original submit core back to public.

create function private.knowledge_event_end(p_event jsonb, p_date date, p_timezone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_event ->> 'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      (p_date + case when p_event ->> 'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and (p_event ->> 'end')::time <= (p_event ->> 'start')::time
        then 1 else 0 end + (p_event ->> 'end')::time) at time zone p_timezone
    else (p_date + 1)::timestamp at time zone p_timezone
  end;
$$;

revoke all on function private.knowledge_event_end(jsonb, date, text)
from public, anon, authenticated, service_role;

create or replace function private.knowledge_validate_value(
  p_schema text, p_version integer, p_headline text, p_detail jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_fields jsonb := '[]'::jsonb;
  v_detail jsonb := null;
  v_given jsonb := case when p_detail is null or p_detail = 'null'::jsonb or p_detail = '{}'::jsonb
    then null else p_detail end;
begin
  if p_schema is null or p_version is null
     or (p_schema, p_version) not in (('presence', 1), ('connectivity.wifi', 1),
                                      ('facility', 1), ('accessibility', 1), ('policy', 1),
                                      ('service', 1), ('schedule_event', 1)) then
    raise exception 'unknown_value_schema' using errcode = '22023',
      detail = jsonb_build_object('schema', p_schema, 'version', p_version)::text;
  end if;

  if p_headline is null then
    v_fields := v_fields || jsonb_build_object('path', 'headline', 'problem', 'required');
  elsif p_headline not in ('yes', 'no', 'not_applicable', 'unknown') then
    v_fields := v_fields || jsonb_build_object('path', 'headline', 'problem', 'not_allowed');
  end if;

  if v_given is null and p_schema = 'schedule_event' and p_headline = 'yes' then
    -- A commitment needs a fixture even when the whole detail is absent.
    v_fields := v_fields || private.knowledge_schedule_event_problems(p_headline, '{}'::jsonb);
  elsif v_given is not null then
    if p_schema = 'presence' then
      v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
    elsif p_schema = 'connectivity.wifi' then
      begin
        v_detail := private.amenity_wifi_metadata(v_given);
      exception when others then
        v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'invalid');
      end;
    elsif p_schema = 'policy' then
      v_fields := v_fields || private.knowledge_policy_problems(p_headline, v_given);
      v_detail := v_given;
    elsif p_schema = 'service' then
      v_fields := v_fields || private.knowledge_service_problems(v_given)
        || private.knowledge_service_stop_problems(p_headline, v_given);
      v_detail := v_given;
    elsif p_schema = 'schedule_event' then
      v_fields := v_fields || private.knowledge_schedule_event_problems(p_headline, v_given);
      v_detail := v_given;
    else
      v_fields := v_fields || private.knowledge_detail_problems(p_schema, v_given);
      v_detail := v_given;
    end if;
  end if;

  -- A34: the scope may be left out when entrances are listed; the answer then
  -- covers the listed entrances.
  if p_schema = 'accessibility' and p_headline is distinct from 'unknown'
     and (v_given is null or not (v_given ? 'scope'))
     and jsonb_array_length(private.knowledge_json_array(v_given -> 'entrances')) = 0 then
    v_fields := v_fields || jsonb_build_object('path', 'detail.scope', 'problem', 'required');
  end if;

  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  return jsonb_build_object('headline', p_headline, 'detail', v_detail);
end;
$$;

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
    v_end := case when v_policy.basis = 'event_end' and v_date is not null
      then private.knowledge_event_end(p_detail -> 'event', v_date, v_tz) end;
    v_out := v_out || (private.knowledge_freshness_entry(v_use, v_policy.max_age, v_policy.recheck_lead,
      v_policy.basis, v_date, v_end, p_now, v_tz)
      || case when v_policy.id is not null
        then jsonb_build_object('policyId', v_policy.id, 'policyVersion', v_policy.version) else '{}'::jsonb end);
  end loop;
  return v_out;
end;
$$;

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
    select c.venue_id, kd.value_schema,
      private.knowledge_effective_detail(st.current_contribution_id) as detail, kd.observed_on
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
      case when p.basis = 'event_end' and s.value_schema = 'schedule_event' then
        private.knowledge_event_end(s.detail -> 'event',
          private.knowledge_safe_date(s.detail -> 'event' ->> 'localDate'),
          private.venue_timezone(s.venue_id)) end,
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

-- Keep the B01/B02 write implementation, but make it callable only through
-- the public RPCs. An old client (or a direct 16-argument call) must not commit
-- to a fixture without a title and date. Other legacy calls keep their old
-- behavior and response shape.
alter function public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean)
  set schema private;
alter function private.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean)
  rename to knowledge_submit_core;
revoke all on function private.knowledge_submit_core(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean)
from public, anon, authenticated, service_role;

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
begin
  if p_answer = 'yes' and exists (
    select 1 from public.venue_amenity_checks c
    cross join lateral (
      select q.value_schema from public.knowledge_question_versions q
      where q.key = c.template_key order by q.version desc limit 1
    ) v
    where c.id = p_check_id and v.value_schema = 'schedule_event'
  ) then
    -- The extended entry point checks the actor before requiring event detail.
    return public.knowledge_submit(p_check_id, p_slot_revision, p_idempotency_key, p_kind, p_answer,
    p_finding, p_limitations, p_reason, p_unknown_preset, p_tried_text, p_change_reason, p_responds_to,
    p_asset_ids, p_internal_metadata, p_redaction_confirmed, p_confirm_own, null::jsonb, null::date, null::text);
  end if;

  return private.knowledge_submit_core(p_check_id, p_slot_revision, p_idempotency_key, p_kind, p_answer,
    p_finding, p_limitations, p_reason, p_unknown_preset, p_tried_text, p_change_reason, p_responds_to,
    p_asset_ids, p_internal_metadata, p_redaction_confirmed, p_confirm_own);
end;
$$;

revoke all on function public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean)
from public, anon, service_role;
grant execute on function public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean)
to authenticated;

create or replace function public.knowledge_submit(
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
  p_confirm_own boolean,
  p_detail jsonb,
  p_observed_on date,
  p_observed_on_source text
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
  v_version public.knowledge_question_versions;
  v_detail jsonb := case when p_detail is null or p_detail = 'null'::jsonb or p_detail = '{}'::jsonb
    then null else p_detail end;
  v_fields jsonb := '[]'::jsonb;
  v_message text;
  v_error_detail text;
  v_hash text;
  v_result jsonb;
  v_prior public.knowledge_contribution_details;
  v_contribution uuid;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or private.knowledge_basis(v_check.venue_id) is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = v_check.template_key
  order by v.version desc
  limit 1;

  -- An invalid answer is left to knowledge_submit (invalid_answer), as today.
  if p_answer in ('yes', 'no', 'not_applicable', 'unknown') then
    if v_version.value_schema = 'connectivity.wifi' then
      if v_detail is not null then
        v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
      end if;
    else
      begin
        perform private.knowledge_validate_value(v_version.value_schema, v_version.value_schema_version,
          p_answer, v_detail);
      exception when others then
        get stacked diagnostics v_message = message_text, v_error_detail = pg_exception_detail;
        if v_message <> 'invalid_value' then
          raise;
        end if;
        v_fields := v_fields || (v_error_detail::jsonb -> 'fields');
      end;
      v_fields := v_fields || private.knowledge_detail_venue_problems(v_check.venue_id,
        v_check.template_key, p_answer, v_detail);
    end if;
  end if;

  if p_observed_on is null and p_observed_on_source is not null then
    v_fields := v_fields || jsonb_build_object('path', 'observedOn', 'problem', 'required');
  elsif p_observed_on is not null and p_observed_on_source is null then
    v_fields := v_fields || jsonb_build_object('path', 'observedOnSource', 'problem', 'required');
  end if;
  if p_observed_on_source is not null and p_observed_on_source not in ('form_default', 'chosen') then
    v_fields := v_fields || jsonb_build_object('path', 'observedOnSource', 'problem', 'invalid');
  end if;
  -- Today or up to 30 days back (OD-15 default).
  if p_observed_on is not null
     and (p_observed_on > private.london_today() or p_observed_on < private.london_today() - 30) then
    v_fields := v_fields || jsonb_build_object('path', 'observedOn', 'problem', 'out_of_range');
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  v_hash := private.knowledge_hash(jsonb_build_object('detail', v_detail, 'observedOn', p_observed_on,
    'observedOnSource', p_observed_on_source));
  v_result := private.knowledge_submit_core(p_check_id, p_slot_revision, p_idempotency_key, p_kind, p_answer,
    p_finding, p_limitations, p_reason, p_unknown_preset, p_tried_text, p_change_reason, p_responds_to,
    p_asset_ids, p_internal_metadata, p_redaction_confirmed, p_confirm_own);
  v_contribution := (v_result ->> 'contributionId')::uuid;
  select d.* into v_prior from public.knowledge_contribution_details d where d.contribution_id = v_contribution;

  if (v_result ->> 'replayed')::boolean then
    if (found and v_prior.request_hash <> v_hash)
       or (not found and (v_detail is not null or p_observed_on is not null)) then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
  elsif v_detail is not null or p_observed_on is not null then
    insert into public.knowledge_contribution_details (
      contribution_id, venue_id, question_version, value_schema, value_schema_version,
      detail, observed_on, observed_on_source, request_hash
    )
    values (
      v_contribution, v_check.venue_id, v_version.version, v_version.value_schema,
      v_version.value_schema_version, v_detail, p_observed_on, p_observed_on_source, v_hash
    );
  end if;
  -- B03-e (A24): the recheck tasks this send closed (none on a replay).
  return v_result || jsonb_build_object('detail', v_detail, 'observedOn', p_observed_on,
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id));
end;
$$;
