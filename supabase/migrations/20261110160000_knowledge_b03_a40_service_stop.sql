-- B03 A40: a service stopped from a future date (owner approval "Support
-- future stop dates"; evidence/b03-a40-pool-design.md with the four review
-- corrections). Runs after R-L1/R-L2 (20261110115911) and A41 to A44 with the
-- staff withdrawal line (20261110151000); every re-created body is the latest
-- one from those migrations with the A40 change only.
--
-- * Encoding: a service.v1 Yes may carry detail.lastDayOffered (YYYY-MM-DD,
--   venue-local, inclusive): the service is Not offered from the next day.
--   Nothing is written on that day; reads work it out from the clock. An
--   immediate stop stays a No.
-- * private.knowledge_service_end(venue, submission, answer, schema, detail,
--   at), stable definer, no client grant: null, or { kind, lastDayOffered,
--   notOfferedFrom, notOfferedFromAt, inEffect }. kind 'stopped' (the
--   deliberate stop, from lastDayOffered, venue timezone) or 'schedule_ended'
--   (no stop date; the submission's latest schedule row created at or before
--   p_at has an effective_to; that row's timezone). notOfferedFromAt is
--   venue-local midnight of Not offered from. Never the current
--   schedule-in-use helper, so history reads the submission it names.
--   private.knowledge_check_service_end(check, at) applies it to the check's
--   current submission with its latest corrected detail.
-- * Validation: private.knowledge_service_problems allows lastDayOffered;
--   private.knowledge_service_stop_problems (headline-aware, called by
--   private.knowledge_validate_value): lastDayOffered and schedule are
--   not_allowed unless the headline is yes; lastDayOffered must be a date;
--   with a schedule, effectiveTo is required and must equal it (out_of_range).
--   private.knowledge_detail_venue_problems_for: a lastDayOffered before the
--   venue's today is out_of_range at send and correction (not in imports or
--   the validator). public.knowledge_source_import refuses lastDayOffered.
--   public.knowledge_correct treats a service schedule or lastDayOffered
--   change as material (a new submission, so a new schedule row).
-- * Reads: private.knowledge_slot_state_b03 (same columns) reads value 'no'
--   and no qualifier once an end is in effect; withdrawal, scope, schema and
--   freshness keep their precedence. private.knowledge_slot_json:
--   answerInUse.value is the value as read and answerInUse.stop is the end
--   (or null). private.amenity_check_rows_presented: answer 'no' once in
--   effect. public.knowledge_reader_answers_v1 (create or replace, same
--   columns): finding and limitations null while stopped. The v1 reader's
--   ETag carries the value (app/api/knowledge/_reader/answers.ts), so a
--   clock-driven Yes to No at the same revision is never a 304; no new column.
-- * History: private.knowledge_answer_at adds value (as read at p_at) and
--   stop, from the latest correction at or before p_at (created_at, id) and
--   the schedule row of that submission created at or before p_at. answer
--   stays the stored headline; B08's scoring reads stored facts (§6.2a).
-- * Rechecks: private.knowledge_open_rechecks opens schedule_ended only for an
--   in-effect schedule_ended end, due at notOfferedFromAt (the same instant as
--   before for London). A deliberate stop opens no schedule_ended task and, as
--   its qualifier is cleared, no temporary_until_passed task; freshness and
--   schema_changed tasks still open as for any answer (R-L1 due time kept).
--   private.knowledge_close_rechecks closes a schedule_ended task once the
--   slot no longer reads an in-effect schedule_ended end.
-- * Schedules: public.knowledge_occurrences (the service wrapper) discards
--   occurrences starting at or after a deliberate stop and clips the last
--   overnight one to it; private.schedule_occurrences (shared with B04) is
--   unchanged. private.knowledge_schedule_create copies the replaced
--   version's exceptions up to the new effective_to when the new version
--   restates it (same submission base, timezone, effective_from, recurrence
--   and windows), so cancellations and other earlier exceptions stay.
-- * Not touched: the credit trigger, the evidence-withdrawn trigger, the
--   credit functions, the B01 resolver, knowledge_adopt, knowledge_submit,
--   private.schedule_occurrences, knowledge_check, the recheck causes.
--
-- Rollback: a forward migration restores the 20261110103713,
-- 20261110110831, 20261110112949, 20261110113909, 20261110114514,
-- 20261110115911 and 20261110151000 bodies and drops the three new
-- functions. A stored lastDayOffered then stays as inert detail.

-- ---------------------------------------------------------------------------
-- The end of a service in use
-- ---------------------------------------------------------------------------

create function private.knowledge_service_end(
  p_venue_id uuid, p_submission_id uuid, p_answer text, p_schema text, p_detail jsonb, p_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_last date;
  v_tz text;
  v_schedule public.knowledge_schedules;
  v_from_at timestamptz;
begin
  if p_schema is distinct from 'service' or p_answer is distinct from 'yes' or p_submission_id is null then
    return null;
  end if;
  if jsonb_typeof(p_detail) = 'object' and jsonb_typeof(p_detail -> 'lastDayOffered') = 'string' then
    v_last := private.knowledge_safe_date(p_detail ->> 'lastDayOffered');
    if v_last is not null then
      v_kind := 'stopped';
      v_tz := private.venue_timezone(p_venue_id);
    end if;
  end if;
  if v_kind is null then
    -- The schedule of this submission as it stood at p_at (correction 4).
    select s.* into v_schedule from public.knowledge_schedules s
    where s.submission_id = p_submission_id and s.created_at <= p_at
    order by s.created_at desc, s.id desc limit 1;
    if v_schedule.effective_to is not null then
      v_kind := 'schedule_ended';
      v_last := v_schedule.effective_to;
      v_tz := v_schedule.timezone;
    end if;
  end if;
  if v_kind is null then
    return null;
  end if;
  -- Local midnight; never inside a UK clock change.
  v_from_at := (v_last + 1)::timestamp at time zone v_tz;
  return jsonb_build_object('kind', v_kind, 'lastDayOffered', to_char(v_last, 'YYYY-MM-DD'),
    'notOfferedFrom', to_char(v_last + 1, 'YYYY-MM-DD'), 'notOfferedFromAt', v_from_at,
    'inEffect', p_at >= v_from_at);
end;
$$;

-- The check's current submission, with its latest corrected detail.
create function private.knowledge_check_service_end(p_check_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.knowledge_service_end(c.venue_id, c.current_submission_id, s.answer, d.value_schema,
    private.knowledge_effective_detail(s.source_contribution_id), p_at)
  from public.venue_amenity_checks c
  join public.amenity_submissions s on s.id = c.current_submission_id
  left join public.knowledge_contribution_details d on d.contribution_id = s.source_contribution_id
  where c.id = p_check_id;
$$;

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------

-- B03-d body; lastDayOffered is a service key (checked with the headline in
-- private.knowledge_service_stop_problems).
create or replace function private.knowledge_service_problems(p_detail jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_key text;
  v_i integer;
  v_codes text[];
begin
  if jsonb_typeof(p_detail) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', 'detail', 'problem', 'invalid'));
  end if;
  for v_key in select k from jsonb_object_keys(p_detail) k order by k collate "C" loop
    if v_key not in ('schedule', 'channels', 'fees', 'limitations', 'availability', 'broadcasters',
                     'lastDayOffered') then
      v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'not_allowed');
    end if;
  end loop;
  if p_detail ? 'schedule' then
    v_out := v_out || private.schedule_problems('detail.schedule', p_detail -> 'schedule');
  end if;
  if p_detail ? 'channels' then
    if jsonb_typeof(p_detail -> 'channels') <> 'array' or jsonb_array_length(p_detail -> 'channels') > 10 then
      v_out := v_out || jsonb_build_object('path', 'detail.channels', 'problem', 'invalid');
    else
      for v_i in 0 .. jsonb_array_length(p_detail -> 'channels') - 1 loop
        if jsonb_typeof(p_detail -> 'channels' -> v_i) <> 'string'
           or length(btrim(p_detail -> 'channels' ->> v_i)) not between 1 and 40 then
          v_out := v_out || jsonb_build_object('path', format('detail.channels[%s]', v_i), 'problem', 'invalid');
        end if;
      end loop;
    end if;
  end if;
  -- fees, limitations and availability are checked as facility.v1 checks them.
  v_out := v_out || private.knowledge_detail_problems('facility', (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(p_detail) e where e.key in ('fees', 'limitations', 'availability')));
  if p_detail ? 'broadcasters' then
    v_codes := private.knowledge_value_list_codes('broadcasters');
    if jsonb_typeof(p_detail -> 'broadcasters') <> 'array' or jsonb_array_length(p_detail -> 'broadcasters') > 20 then
      v_out := v_out || jsonb_build_object('path', 'detail.broadcasters', 'problem', 'invalid');
    else
      for v_i in 0 .. jsonb_array_length(p_detail -> 'broadcasters') - 1 loop
        if jsonb_typeof(p_detail -> 'broadcasters' -> v_i) <> 'string'
           or not (p_detail -> 'broadcasters' ->> v_i = any(v_codes)) then
          v_out := v_out || jsonb_build_object('path', format('detail.broadcasters[%s]', v_i), 'problem', 'invalid');
        end if;
      end loop;
    end if;
  end if;
  return v_out;
end;
$$;

-- A40: a stop date and a schedule belong to an Offered answer; a stop date
-- with a schedule is that schedule's last day. A No, Not applicable or
-- Unknown answer is the immediate stop.
create function private.knowledge_service_stop_problems(p_headline text, p_detail jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_last date;
  v_to date;
  v_other boolean := p_headline in ('no', 'not_applicable', 'unknown');
begin
  if jsonb_typeof(p_detail) is distinct from 'object' then
    return v_out;
  end if;
  if p_detail ? 'lastDayOffered' then
    v_last := case when jsonb_typeof(p_detail -> 'lastDayOffered') = 'string'
      then private.knowledge_safe_date(p_detail ->> 'lastDayOffered') end;
    if v_other then
      v_out := v_out || jsonb_build_object('path', 'detail.lastDayOffered', 'problem', 'not_allowed');
    elsif v_last is null then
      v_out := v_out || jsonb_build_object('path', 'detail.lastDayOffered', 'problem', 'invalid');
    elsif jsonb_typeof(p_detail -> 'schedule') = 'object' then
      if not (p_detail -> 'schedule' ? 'effectiveTo') then
        v_out := v_out || jsonb_build_object('path', 'detail.schedule.effectiveTo', 'problem', 'required');
      else
        v_to := case when jsonb_typeof(p_detail -> 'schedule' -> 'effectiveTo') = 'string'
          then private.knowledge_safe_date(p_detail -> 'schedule' ->> 'effectiveTo') end;
        -- An unreadable effectiveTo is already invalid (schedule_problems).
        if v_to is not null and v_to <> v_last then
          v_out := v_out || jsonb_build_object('path', 'detail.schedule.effectiveTo', 'problem', 'out_of_range');
        end if;
      end if;
    end if;
  end if;
  if v_other and p_detail ? 'schedule' then
    v_out := v_out || jsonb_build_object('path', 'detail.schedule', 'problem', 'not_allowed');
  end if;
  return v_out;
end;
$$;

-- B03-d body plus the service stop problems after the service shape.
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

  if v_given is not null then
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

-- 20261110112949 body (A37 kept); a service stop date before the venue's
-- today is out_of_range at send and correction.
create or replace function private.knowledge_detail_venue_problems_for(
  p_venue_id uuid, p_key text, p_schema text, p_features jsonb, p_headline text, p_detail jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_ref record;
  v_entrances uuid[];
  v_listed jsonb;
  v_basis text;
  v_key text;
  v_i integer;
begin
  -- A40: choose today or a later day; a service carries no places.
  if p_schema = 'service' then
    if jsonb_typeof(p_detail) = 'object' and jsonb_typeof(p_detail -> 'lastDayOffered') = 'string'
       and private.knowledge_safe_date(p_detail ->> 'lastDayOffered')
         < (now() at time zone private.venue_timezone(p_venue_id))::date then
      v_out := v_out || jsonb_build_object('path', 'detail.lastDayOffered', 'problem', 'out_of_range');
    end if;
    return v_out;
  end if;
  -- Presence and Wi-Fi carry no places or entrances: nothing to check.
  if p_schema is null or p_schema not in ('facility', 'accessibility', 'policy') then
    return v_out;
  end if;
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then
    p_detail := '{}'::jsonb;
  end if;
  v_listed := private.knowledge_json_array(p_detail -> 'entrances');
  -- A37: a policy's authority and scope must be the sender's own: staff
  -- observe (no authority), a venue manager states as venue_manager, an
  -- admin as admin; only an admin states a policy for every venue.
  if p_schema = 'policy' then
    v_basis := private.knowledge_basis(p_venue_id);
    if p_detail ? 'authority' and coalesce(v_basis, 'staff') not in ('venue_manager', 'admin') then
      v_out := v_out || jsonb_build_object('path', 'detail.authority', 'problem', 'not_allowed');
    elsif jsonb_typeof(p_detail -> 'authority') = 'object' and p_detail -> 'authority' ? 'basis'
          and p_detail -> 'authority' ->> 'basis' is distinct from v_basis then
      v_out := v_out || jsonb_build_object('path', 'detail.authority.basis', 'problem', 'not_allowed');
    end if;
    if p_detail ->> 'policyScope' = 'organisation' and v_basis is distinct from 'admin' then
      v_out := v_out || jsonb_build_object('path', 'detail.policyScope', 'problem', 'not_allowed');
    end if;
  end if;
  if p_schema = 'accessibility' then
    if jsonb_typeof(p_detail -> 'features') = 'object' then
      for v_key in select k from jsonb_object_keys(p_detail -> 'features') k order by k collate "C" loop
        if not exists (select 1 from jsonb_array_elements(private.knowledge_json_array(p_features)) f where f ->> 'key' = v_key) then
          v_out := v_out || jsonb_build_object('path', 'detail.features.' || v_key, 'problem', 'not_allowed');
        end if;
      end loop;
    end if;
    for v_i in 0 .. jsonb_array_length(private.knowledge_json_array(p_detail -> 'measurements')) - 1 loop
      if jsonb_typeof(p_detail -> 'measurements' -> v_i -> 'feature') = 'string' and not exists (
        select 1 from jsonb_array_elements(private.knowledge_json_array(p_features)) f
        where f ->> 'key' = p_detail -> 'measurements' -> v_i ->> 'feature' and (f ->> 'measurable')::boolean
      ) then
        v_out := v_out || jsonb_build_object('path', format('detail.measurements[%s].feature', v_i), 'problem', 'not_allowed');
      end if;
    end loop;
  end if;
  for v_ref in
    select format('detail.locations[%s]', o - 1) as path, e ->> 'subjectId' as id
    from jsonb_array_elements(private.knowledge_json_array(p_detail -> 'locations')) with ordinality as l(e, o)
    where jsonb_typeof(e) = 'object' and e ? 'subjectId'
    union all
    select 'detail.scope', p_detail -> 'scope' ->> 'subjectId'
    where jsonb_typeof(p_detail -> 'scope') = 'object' and p_detail -> 'scope' ? 'subjectId'
    union all
    select format('detail.entrances[%s]', o - 1), e ->> 'subjectId'
    from jsonb_array_elements(v_listed) with ordinality as l(e, o)
    where jsonb_typeof(e) = 'object'
    union all
    select format('detail.zones[%s]', o - 1), e ->> 'subjectId'
    from jsonb_array_elements(private.knowledge_json_array(p_detail -> 'zones')) with ordinality as l(e, o)
    where jsonb_typeof(e) = 'object' and e ? 'subjectId'
  loop
    if not exists (
      select 1 from public.knowledge_subjects s
      where s.id::text = v_ref.id and s.venue_id = p_venue_id and s.retired_at is null
    ) then
      v_out := v_out || jsonb_build_object('path', v_ref.path, 'problem', 'unknown_subject');
    end if;
  end loop;

  -- The step-free rule (§4.3, A18) applies only to an accessibility answer.
  if p_schema = 'accessibility' and p_key = 'step_free_entrance' and p_headline in ('yes', 'no') then
    v_entrances := array(
      select s.id from public.knowledge_subjects s
      where s.venue_id = p_venue_id and s.kind = 'entrance' and s.retired_at is null
    );
    if p_headline = 'yes' and not exists (
      select 1 from jsonb_array_elements(v_listed) e where e ->> 'stepFree' = 'yes'
    ) then
      v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'required');
    elsif p_headline = 'no' and cardinality(v_entrances) = 0 then
      v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'no_entrances_listed');
    elsif p_headline = 'no' and exists (
      select 1 from unnest(v_entrances) id
      where not exists (
        select 1 from jsonb_array_elements(v_listed) e
        where e ->> 'subjectId' = id::text and e ->> 'stepFree' = 'no'
      )
    ) then
      v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'required');
    end if;
  end if;
  return v_out;
end;
$$;

-- 20261110114514 body (A37 on imports kept); a source never sets a stop date.
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
        -- A40 on imports: a stop date is the venue's decision, never a source's.
        if v_version.value_schema = 'service' and jsonb_typeof(v_a -> 'detail') = 'object'
           and v_a -> 'detail' ? 'lastDayOffered' then
          v_fields := v_fields || jsonb_build_object('path', format('assertions[%s].detail.lastDayOffered', v_i),
            'problem', 'not_allowed');
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

-- 20261110110831 body; for a service, a change to the schedule or the stop
-- date is always material (a new submission, so a new schedule row).
create or replace function public.knowledge_correct(
  p_check_id uuid, p_slot_revision bigint, p_idempotency_key uuid, p_headline text, p_detail jsonb, p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_after_detail jsonb := case when p_detail is null or p_detail = 'null'::jsonb or p_detail = '{}'::jsonb
    then null else p_detail end;
  v_hash text := private.knowledge_hash(jsonb_build_object('checkId', p_check_id, 'slotRevision', p_slot_revision,
    'headline', p_headline, 'detail', v_after_detail, 'reason', v_reason));
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_basis text;
  v_revision bigint;
  v_rule public.knowledge_question_rules;
  v_version public.knowledge_question_versions;
  v_submission public.amenity_submissions;
  v_current_detail public.knowledge_contribution_details;
  v_before_detail jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_message text;
  v_error text;
  v_material boolean;
  v_field text;
  v_contribution public.knowledge_contributions;
  v_new_submission uuid;
  v_decision uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'correct', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_corrector_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'refused' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  -- B01 lock order: profile, key, assets, check.
  perform 1 from public.media_assets a
  where a.id in (select sa.asset_id from public.amenity_submission_assets sa
                 where sa.submission_id = v_check.current_submission_id)
  order by a.id for share;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_check.current_submission_id is null or v_check.progress <> 'complete' or v_check.status <> 'active' then
    raise exception 'knowledge_not_current' using errcode = 'NLK08';
  end if;
  select s.* into v_submission from public.amenity_submissions s where s.id = v_check.current_submission_id;
  select d.* into v_current_detail from public.knowledge_contribution_details d
  where d.contribution_id = v_submission.source_contribution_id;
  v_before_detail := private.knowledge_effective_detail(v_submission.source_contribution_id);
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = v_check.template_key order by v.version desc limit 1;
  v_rule := private.knowledge_rule(v_check.template_key);

  if p_headline is null or p_headline not in ('yes', 'no', 'not_applicable') then
    v_fields := v_fields || jsonb_build_object('path', 'headline',
      'problem', case when p_headline is null then 'required' else 'not_allowed' end);
  elsif v_version.value_schema = 'connectivity.wifi' then
    if v_after_detail is not null then
      v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
    end if;
  else
    begin
      perform private.knowledge_validate_value(v_version.value_schema, v_version.value_schema_version,
        p_headline, v_after_detail);
    exception when others then
      get stacked diagnostics v_message = message_text, v_error = pg_exception_detail;
      if v_message <> 'invalid_value' then
        raise;
      end if;
      v_fields := v_fields || (v_error::jsonb -> 'fields');
    end;
    v_fields := v_fields || private.knowledge_detail_venue_problems(v_check.venue_id, v_check.template_key,
      p_headline, v_after_detail);
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023', detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  v_before := jsonb_build_object('headline', v_submission.answer, 'detail', v_before_detail);
  v_after := jsonb_build_object('headline', p_headline, 'detail', v_after_detail);
  if v_before = v_after then
    raise exception 'nothing_to_correct' using errcode = '22023';
  end if;
  v_material := p_headline is distinct from v_submission.answer;
  foreach v_field in array coalesce(v_version.material_fields, '{}'::text[]) loop
    if v_field <> 'headline' and (v_before_detail -> v_field) is distinct from (v_after_detail -> v_field) then
      v_material := true;
    end if;
  end loop;
  -- A40: a changed or cancelled stop, or a changed schedule, is a new answer.
  if v_version.value_schema = 'service' and (
       (v_before_detail -> 'schedule') is distinct from (v_after_detail -> 'schedule')
       or (v_before_detail -> 'lastDayOffered') is distinct from (v_after_detail -> 'lastDayOffered')) then
    v_material := true;
  end if;

  if not v_material then
    -- A detail fix on the answer in use: no submission, the confirmation stays.
    if v_submission.source_contribution_id is null then
      raise exception 'knowledge_not_current' using errcode = 'NLK08';
    end if;
    v_decision := private.knowledge_decision_detailed(v_check, v_submission.id, 'corrected', v_uid, v_basis,
      v_rule.rule_version, v_reason, v_revision, null,
      jsonb_build_object('before', v_before, 'after', v_after, 'material', false, 'selectionRule', 'correction'));
    insert into public.knowledge_detail_corrections (contribution_id, venue_id, detail, decision_id)
    values (v_submission.source_contribution_id, v_check.venue_id, v_after_detail, v_decision);
  else
    insert into public.knowledge_contributions (
      venue_id, check_id, question_key, contributed_by, contributor_basis, kind, answer, finding, limitations, reason,
      based_on_slot_revision, based_on_submission_id, rule_version, template_version, evidence_rule,
      confirm_own, initial_outcome, idempotency_key, request_hash
    )
    select v_check.venue_id, v_check.id, v_check.template_key, v_uid, v_basis, 'correction', p_headline,
      v_submission.finding, v_submission.limitations,
      case when p_headline in ('no', 'not_applicable') then v_reason end,
      v_revision, v_submission.id, coalesce(v_rule.rule_version, 1), t.catalogue_version, t.evidence_rule, false,
      case when coalesce(v_rule.confirmation, 'none') = 'none' then 'current' else 'awaiting_confirmation' end,
      gen_random_uuid(), v_hash
    from public.amenity_catalogue t where t.key = v_check.template_key
    returning * into v_contribution;
    -- The answer's evidence and observation stay with it.
    insert into public.knowledge_contribution_assets (contribution_id, venue_id, asset_id, evidence_kind)
    select v_contribution.id, v_check.venue_id, sa.asset_id, sa.evidence_kind
    from public.amenity_submission_assets sa
    join public.media_assets a on a.id = sa.asset_id and a.deleted_at is null and a.upload_state = 'ready'
    where sa.submission_id = v_submission.id;
    if v_after_detail is not null or v_current_detail.observed_on is not null then
      insert into public.knowledge_contribution_details (contribution_id, venue_id, question_version, value_schema,
        value_schema_version, detail, observed_on, observed_on_source, request_hash)
      values (v_contribution.id, v_check.venue_id, v_version.version, v_version.value_schema,
        v_version.value_schema_version, v_after_detail, v_current_detail.observed_on,
        v_current_detail.observed_on_source, v_hash);
    end if;
    perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id, 'contribution_recorded',
      v_contribution.id, null, null, jsonb_build_object('kind', 'correction'));
    -- B01 adoption; the earlier confirmation is not carried (§9.1).
    v_new_submission := private.knowledge_adopt(v_contribution, v_check, v_uid, v_basis, false, false, v_revision,
      v_rule.rule_version);
    v_decision := private.knowledge_decision_detailed(v_check, v_submission.id, 'corrected', v_uid, v_basis,
      v_rule.rule_version, v_reason, v_revision, v_new_submission,
      jsonb_build_object('before', v_before, 'after', v_after, 'material', true, 'selectionRule', 'correction',
        'contributionId', v_contribution.id));
  end if;

  v_result := jsonb_build_object('decisionId', v_decision, 'material', v_material, 'submissionId', v_new_submission,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key), 'replayed', false,
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id));
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'correct', v_hash, v_check.venue_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------

-- B03-d body; a version that restates the one it replaces (same submission
-- base, timezone, effective_from, recurrence and windows, as a stop does with
-- its effectiveTo) keeps that version's exceptions up to its effective_to.
create or replace function private.knowledge_schedule_create(p_contribution_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adopted public.knowledge_decisions;
  v_detail jsonb;
  v_previous public.knowledge_schedules;
  v_new public.knowledge_schedules;
begin
  select d.* into v_adopted from public.knowledge_decisions d
  where d.contribution_id = p_contribution_id and d.decision = 'adopted'
  order by d.created_at desc, d.id desc limit 1;
  if not found then
    return;
  end if;
  select kd.detail -> 'schedule' into v_detail
  from public.knowledge_contribution_details kd
  where kd.contribution_id = p_contribution_id and kd.value_schema = 'service'
    and jsonb_typeof(kd.detail -> 'schedule') = 'object';
  if v_detail is null
     or exists (select 1 from public.knowledge_schedules s where s.contribution_id = p_contribution_id) then
    return;
  end if;
  select s.* into v_previous from public.knowledge_schedules s where s.check_id = v_adopted.check_id
  order by s.created_at desc, s.id desc limit 1;
  insert into public.knowledge_schedules (
    venue_id, question_key, check_id, contribution_id, submission_id, supersedes, timezone,
    effective_from, effective_to, recurrence, windows
  )
  values (
    v_adopted.venue_id, v_adopted.question_key, v_adopted.check_id, p_contribution_id,
    v_adopted.resulting_submission_id, v_previous.id,
    private.venue_timezone(v_adopted.venue_id),
    (v_detail ->> 'effectiveFrom')::date, (v_detail ->> 'effectiveTo')::date,
    v_detail -> 'recurrence', v_detail -> 'windows'
  )
  returning * into v_new;
  -- A40 (correction 1): cancellations and other exceptions before the stop stay.
  if v_previous.id is not null
     and v_previous.submission_id = (select x.based_on_submission_id from public.knowledge_contributions x
                                     where x.id = p_contribution_id)
     and v_previous.timezone = v_new.timezone and v_previous.effective_from = v_new.effective_from
     and v_previous.recurrence = v_new.recurrence and v_previous.windows = v_new.windows then
    insert into public.knowledge_schedule_exceptions (schedule_id, venue_id, local_date, kind, windows, note, created_by)
    select v_new.id, e.venue_id, e.local_date, e.kind, e.windows, e.note, e.created_by
    from public.knowledge_schedule_exceptions e
    where e.schedule_id = v_previous.id and (v_new.effective_to is null or e.local_date <= v_new.effective_to)
    order by e.created_at, e.id;
  end if;
end;
$$;

-- 20261110113909 body (review M1 chain); the service wrapper ends at a
-- deliberate stop: no occurrence from Not offered from, and the last
-- overnight one ends then. The shared expansion is unchanged (B04).
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
  v_end jsonb;
  v_stop_at timestamptz;
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
  -- A40 (correction 1): a deliberate stop begins at local midnight of Not
  -- offered from, whether or not it has passed.
  v_end := private.knowledge_check_service_end(v_check.id, now());
  v_stop_at := case when v_end ->> 'kind' = 'stopped' then (v_end ->> 'notOfferedFromAt')::timestamptz end;
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
    select o.local_date, o.starts_at,
      case when v_stop_at is null then o.ends_at else least(o.ends_at, v_stop_at) end, o.state
    from spans sp
    cross join lateral private.schedule_occurrences(sp.timezone, sp.effective_from, sp.span_to,
      sp.recurrence, sp.windows,
      (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('localDate', to_char(e.local_date, 'YYYY-MM-DD'),
          'kind', e.kind, 'windows', e.windows)) order by e.created_at, e.id), '[]'::jsonb)
       from public.knowledge_schedule_exceptions e where e.schedule_id = sp.id),
      p_from, p_to) o
    where v_stop_at is null or o.starts_at < v_stop_at
    order by o.local_date, o.starts_at, o.ends_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- 20261110114514 body (WS5 item 1, B08 M1 kept); once a service's end is in
-- effect the value is 'no' and no qualifier applies. Same columns;
-- current_answer stays the stored headline.
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
      and lv.value_schema is distinct from coalesce(kd.value_schema, v1.value_schema)
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

-- 20261110151000 body (withdrawal line kept); answerInUse.value is the value
-- as read and answerInUse.stop the service's end (A40).
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
      coalesce((select dc.detail from public.knowledge_detail_corrections dc
        where dc.contribution_id = z.cid order by dc.created_at desc, dc.id desc limit 1), d.detail) as detail
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

-- 20261110113909 body (review M3, A39 kept); the answer reads No once a
-- service's end is in effect, so it carries no qualifier then either.
create or replace view private.amenity_check_rows_presented as
  select r.id, r.venue_id, r.template_key, r.category, r.question, r.capture_brief, r.evidence_rule,
    r.is_core, r.position, r.catalogue_version, r.status,
    case when q.qualification is null then r.progress else 'needs_recheck' end as progress,
    pa.answer, r.current_submission_id, r.assignee_user_id, r.assignee_name,
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
  -- A40: the corrected detail's stop, or the schedule's end, at now().
  cross join lateral (
    select case
      when r.progress = 'complete' and r.answer = 'yes'
        and coalesce((private.knowledge_check_service_end(r.id, now()) ->> 'inEffect')::boolean, false)
        then 'no'
      else r.answer
    end as answer
  ) pa
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
      else private.knowledge_qualifier(kd.value_schema, pa.answer, kd.detail)
    end as qualification
  ) q;

-- 20261110114514 body (source_origin kept), create or replace with the same
-- columns: while a service is stopped its finding and limitations, which
-- describe the offer, are not read out.
create or replace function public.knowledge_reader_answers_v1(p_venue_id uuid, p_keys text[])
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
  -- Unavailable answers carry their state and revision only. A40: the
  -- resolver reads a stopped service's stored Yes as No.
  return query
    select s.question_key, s.status, s.reason, s.detail, s.revision, s.question_version,
      s.value,
      case when s.status = 'available' and not x.stopped then s.finding end,
      case when s.status = 'available' and not x.stopped then s.limitations end,
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
    cross join lateral (
      select coalesce(s.value_schema = 'service' and s.current_answer = 'yes' and s.value = 'no', false) as stopped
    ) x
    order by array_position(v_keys, s.question_key);
end;
$$;

-- 20261110114514 body (B08 M1 kept); answerInUse gains value (as read at
-- p_at) and stop (A40), from the latest correction at or before p_at and the
-- schedule row of that submission created at or before p_at. answer stays the
-- stored headline.
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

comment on function private.knowledge_answer_at(uuid, timestamptz) is
  'History read (b03-design R-L2): the answer in use at p_at, for display and audit. Callers gate. freshness ignores withdrawn and scope: read withdrawn first. value and stop (A40) are as read at p_at; answer is the stored headline. B08 R2 does not use this; it reads stored, write-once facts (B08 §6.2a).';

-- ---------------------------------------------------------------------------
-- Rechecks
-- ---------------------------------------------------------------------------

-- 20261110115911 body (R-L1 due time kept); schedule_ended only for an
-- in-effect schedule end without a stop date, due at its local midnight.
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
  v_end jsonb;
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
      -- A stopped service has no qualifier, so no temporary_until_passed.
      v_until := private.knowledge_safe_date(v_row.qualified_detail -> 'availability' ->> 'until');
      if v_row.qualifier = 'temporarily_unavailable' and v_until < v_today then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'temporary_until_passed', 'internal',
          (v_until + 1)::timestamp at time zone private.venue_timezone(v_venue))
        on conflict on constraint knowledge_recheck_tasks_once do nothing;
        get diagnostics v_count = row_count;
        v_opened := v_opened + v_count;
      end if;
      -- B03-g (§9.3): an answer under a replaced schema needs checking, due
      -- from the version in force at p_now (review R-L1).
      if v_row.detail = 'schema_changed' then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'schema_changed', 'internal',
          private.knowledge_schema_change_due(v_row.question_key, p_now))
        on conflict on constraint knowledge_recheck_tasks_once do nothing;
        get diagnostics v_count = row_count;
        v_opened := v_opened + v_count;
      end if;
      -- A40 (correction 2): a schedule that ended without a stop date needs
      -- checking; a deliberate stop does not.
      v_end := private.knowledge_service_end(v_venue, v_row.current_submission_id, v_row.current_answer,
        v_row.value_schema, private.knowledge_effective_detail(v_row.current_contribution_id), p_now);
      if v_end ->> 'kind' = 'schedule_ended' and (v_end ->> 'inEffect')::boolean then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'schedule_ended', 'internal',
          (v_end ->> 'notOfferedFromAt')::timestamptz)
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

-- 20261110113909 body; a schedule_ended task stays open only while the slot
-- reads an in-effect schedule end without a stop date (a new schedule, an
-- immediate No or a deliberate stop closes it).
create or replace function private.knowledge_close_rechecks(p_check_id uuid, p_decision_id uuid, p_now timestamptz)
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
  v_ended boolean;
begin
  if not exists (select 1 from public.knowledge_recheck_tasks t where t.check_id = p_check_id and t.state = 'open') then
    return v_closed;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  select st.* into v_st from private.knowledge_slot_state_b03(v_check.venue_id, array[v_check.template_key], p_now) st;
  v_ended := coalesce((select e ->> 'kind' = 'schedule_ended' and (e ->> 'inEffect')::boolean
    from (select private.knowledge_service_end(v_check.venue_id, v_st.current_submission_id, v_st.current_answer,
      v_st.value_schema, private.knowledge_effective_detail(v_st.current_contribution_id), p_now) as e) x), false);
  for v_task in
    select t.* from public.knowledge_recheck_tasks t
    where t.check_id = p_check_id and t.state = 'open'
    order by t.created_at, t.id
    for update
  loop
    if v_st.status = 'available'
       and coalesce((select e ->> 'state' from jsonb_array_elements(v_st.freshness) e where e ->> 'use' = v_task.use),
         'unrated') in ('current', 'unrated')
       and (v_task.cause <> 'schedule_ended' or not v_ended) then
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

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_service_end(uuid, uuid, text, text, jsonb, timestamptz),
  private.knowledge_check_service_end(uuid, timestamptz),
  private.knowledge_service_problems(jsonb),
  private.knowledge_service_stop_problems(text, jsonb),
  private.knowledge_validate_value(text, integer, text, jsonb),
  private.knowledge_detail_venue_problems_for(uuid, text, text, jsonb, text, jsonb),
  private.knowledge_schedule_create(uuid),
  private.knowledge_slot_state_b03(uuid, text[], timestamptz),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text),
  private.knowledge_answer_at(uuid, timestamptz),
  private.knowledge_open_rechecks(timestamptz),
  private.knowledge_close_rechecks(uuid, uuid, timestamptz)
from public, anon, authenticated;
revoke all on private.amenity_check_rows_presented from public, anon, authenticated;
revoke all on function public.knowledge_reader_answers_v1(uuid, text[]) from public, anon, authenticated;
grant execute on function public.knowledge_reader_answers_v1(uuid, text[]) to service_role;
revoke all on function
  public.knowledge_occurrences(uuid, date, date),
  public.knowledge_correct(uuid, bigint, uuid, text, jsonb, text),
  public.knowledge_source_import(uuid, text, timestamptz, jsonb, uuid)
from public, anon, service_role;
grant execute on function
  public.knowledge_occurrences(uuid, date, date),
  public.knowledge_correct(uuid, bigint, uuid, text, jsonb, text),
  public.knowledge_source_import(uuid, text, timestamptz, jsonb, uuid)
to authenticated;
