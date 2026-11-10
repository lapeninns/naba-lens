-- B03-d: services, schedules and dated events (docs/knowledge/b03-design.md §6,
-- §12 batch B03-d, §14 A6, A7, A8, A9, A25, A27).
--
-- * private.venue_timezone (A6): Europe/London for every venue (OD-16
--   default); knowledge_check returns it as timezone.
-- * Shared with B04 (A27), pure (no table is read): private.schedule_problems,
--   private.schedule_window_problems, private.schedule_exception_problems and
--   private.schedule_occurrences, which expands a schedule with its
--   exceptions in its timezone (local times kept across clock changes, a
--   window past midnight belongs to its start date, at most 92 days). A
--   TypeScript mirror and tests/fixtures/knowledge/occurrences.json run
--   through both.
-- * service.v1 and schedule_event.v1 join the validator (§3.3, §6.3, §6.4);
--   broadcasters come from the value list (A9, empty until OD-16).
-- * public.knowledge_schedules and public.knowledge_schedule_exceptions,
--   append-only. A schedule sent inline in a service detail (A7) becomes a
--   schedule row when its contribution is adopted: insert triggers on
--   knowledge_decisions (decision 'adopted') and on
--   knowledge_contribution_details (a finding adopted at send, whose detail is
--   stored just after), once per contribution, so private.knowledge_adopt is
--   not re-created. A later adopted schedule supersedes the earlier one.
-- * Reads: public.knowledge_occurrences(p_check_id, p_from, p_to) and
--   public.knowledge_schedule_preview(p_schedule, p_timezone, p_from, p_to)
--   (A8). Command: public.knowledge_schedule_exception (A7), manager or admin,
--   keyed through knowledge_write_commands (command gains
--   'schedule_exception'); it records a schedule_exception_added knowledge
--   event (kind added), so the slot revision moves.
-- * Re-created with additive keys: private.knowledge_slot_json
--   (answerInUse.scheduleId, A25), public.knowledge_check (timezone, A6),
--   private.knowledge_validate_value (the two schemas).
-- * B03-c review low: private.amenity_check_rows_presented re-created with
--   the UI design's per-qualifier recheck_reason wording (A19(b)).
-- * Inert: every key is on registry version 1 and no service key exists until
--   OD-11, so no schedule row can be created yet. Not touched: the credit
--   trigger, media_assets_knowledge_evidence_withdrawn, the credit functions,
--   the resolver, knowledge_adopt and knowledge_submit.
--
-- Rollback: a forward migration restores the B03-c slot JSON, check and
-- validator; drop the trigger; the tables stay.

-- ---------------------------------------------------------------------------
-- Timezone (A6, OD-16)
-- ---------------------------------------------------------------------------

create function private.venue_timezone(p_venue_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select 'Europe/London'::text;
$$;

-- ---------------------------------------------------------------------------
-- Shared schedule shape and expansion (A27; B04 calls these)
-- ---------------------------------------------------------------------------

-- [{ start: 'HH:MM', end: 'HH:MM' }], 1 to 6; end <= start means past midnight.
create function private.schedule_window_problems(p_path text, p_windows jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_w jsonb;
begin
  if jsonb_typeof(p_windows) is distinct from 'array' or jsonb_array_length(p_windows) not between 1 and 6 then
    return jsonb_build_array(jsonb_build_object('path', p_path, 'problem', 'invalid'));
  end if;
  for v_i in 0 .. jsonb_array_length(p_windows) - 1 loop
    v_w := p_windows -> v_i;
    if jsonb_typeof(v_w) <> 'object'
       or (select count(*) from jsonb_object_keys(v_w) k where k not in ('start', 'end')) > 0
       or jsonb_typeof(v_w -> 'start') is distinct from 'string' or v_w ->> 'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or jsonb_typeof(v_w -> 'end') is distinct from 'string' or v_w ->> 'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_w ->> 'start' = v_w ->> 'end' then
      v_out := v_out || jsonb_build_object('path', format('%s[%s]', p_path, v_i), 'problem', 'invalid');
    end if;
  end loop;
  return v_out;
end;
$$;

-- { effectiveFrom, effectiveTo?, recurrence, windows } (§6.1). recurrence is
-- weekly { days[] }, monthly { nth 1..5 or -1 (last), day } or dated
-- { dates[] }; days are mon..sun.
create function private.schedule_problems(p_path text, p_schedule jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_key text;
  v_from date;
  v_to date;
  v_r jsonb;
  v_ok boolean;
  v_days text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
begin
  if jsonb_typeof(p_schedule) is distinct from 'object' then
    return jsonb_build_array(jsonb_build_object('path', p_path, 'problem', 'invalid'));
  end if;
  for v_key in select k from jsonb_object_keys(p_schedule) k order by k collate "C" loop
    if v_key not in ('effectiveFrom', 'effectiveTo', 'recurrence', 'windows') then
      v_out := v_out || jsonb_build_object('path', p_path || '.' || v_key, 'problem', 'not_allowed');
    end if;
  end loop;

  if not (p_schedule ? 'effectiveFrom') then
    v_out := v_out || jsonb_build_object('path', p_path || '.effectiveFrom', 'problem', 'required');
  else
    v_from := case when jsonb_typeof(p_schedule -> 'effectiveFrom') = 'string'
      then private.knowledge_safe_date(p_schedule ->> 'effectiveFrom') end;
    if v_from is null then
      v_out := v_out || jsonb_build_object('path', p_path || '.effectiveFrom', 'problem', 'invalid');
    end if;
  end if;
  if p_schedule ? 'effectiveTo' then
    v_to := case when jsonb_typeof(p_schedule -> 'effectiveTo') = 'string'
      then private.knowledge_safe_date(p_schedule ->> 'effectiveTo') end;
    if v_to is null then
      v_out := v_out || jsonb_build_object('path', p_path || '.effectiveTo', 'problem', 'invalid');
    elsif v_from is not null and v_to < v_from then
      v_out := v_out || jsonb_build_object('path', p_path || '.effectiveTo', 'problem', 'out_of_range');
    end if;
  end if;

  if not (p_schedule ? 'recurrence') then
    v_out := v_out || jsonb_build_object('path', p_path || '.recurrence', 'problem', 'required');
  else
    v_r := p_schedule -> 'recurrence';
    if jsonb_typeof(v_r) <> 'object' or jsonb_typeof(v_r -> 'kind') is distinct from 'string'
       or v_r ->> 'kind' not in ('weekly', 'monthly', 'dated')
       or (select count(*) from jsonb_object_keys(v_r) k
           where k <> 'kind' and k <> all (case v_r ->> 'kind'
             when 'weekly' then array['days'] when 'monthly' then array['nth', 'day'] else array['dates'] end)) > 0 then
      v_out := v_out || jsonb_build_object('path', p_path || '.recurrence', 'problem', 'invalid');
    elsif v_r ->> 'kind' = 'weekly' then
      v_ok := jsonb_typeof(v_r -> 'days') = 'array'
        and jsonb_array_length(v_r -> 'days') between 1 and 7
        and not exists (select 1 from jsonb_array_elements(v_r -> 'days') d
          where jsonb_typeof(d) <> 'string' or not (d #>> '{}' = any(v_days)))
        and (select count(distinct d) from jsonb_array_elements(v_r -> 'days') d) = jsonb_array_length(v_r -> 'days');
      if not v_ok then
        v_out := v_out || jsonb_build_object('path', p_path || '.recurrence.days', 'problem', 'invalid');
      end if;
    elsif v_r ->> 'kind' = 'monthly' then
      if jsonb_typeof(v_r -> 'nth') is distinct from 'number'
         or (v_r ->> 'nth')::numeric not in (1, 2, 3, 4, 5, -1) then
        v_out := v_out || jsonb_build_object('path', p_path || '.recurrence.nth', 'problem', 'invalid');
      end if;
      if jsonb_typeof(v_r -> 'day') is distinct from 'string' or not (v_r ->> 'day' = any(v_days)) then
        v_out := v_out || jsonb_build_object('path', p_path || '.recurrence.day', 'problem', 'invalid');
      end if;
    else
      v_ok := jsonb_typeof(v_r -> 'dates') = 'array'
        and jsonb_array_length(v_r -> 'dates') between 1 and 60
        and not exists (select 1 from jsonb_array_elements(v_r -> 'dates') d
          where jsonb_typeof(d) <> 'string' or private.knowledge_safe_date(d #>> '{}') is null)
        and (select count(distinct d) from jsonb_array_elements(v_r -> 'dates') d) = jsonb_array_length(v_r -> 'dates');
      if not v_ok then
        v_out := v_out || jsonb_build_object('path', p_path || '.recurrence.dates', 'problem', 'invalid');
      end if;
    end if;
  end if;

  if not (p_schedule ? 'windows') then
    v_out := v_out || jsonb_build_object('path', p_path || '.windows', 'problem', 'required');
  else
    v_out := v_out || private.schedule_window_problems(p_path || '.windows', p_schedule -> 'windows');
  end if;
  return v_out;
end;
$$;

-- [{ localDate, kind: cancelled | changed_window | extra, windows? }], at
-- most 400; windows are required for changed_window and extra, and not
-- allowed for cancelled.
create function private.schedule_exception_problems(p_path text, p_exceptions jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_e jsonb;
  v_path text;
begin
  if p_exceptions is null then
    return v_out;
  end if;
  if jsonb_typeof(p_exceptions) <> 'array' or jsonb_array_length(p_exceptions) > 400 then
    return jsonb_build_array(jsonb_build_object('path', p_path, 'problem', 'invalid'));
  end if;
  for v_i in 0 .. jsonb_array_length(p_exceptions) - 1 loop
    v_e := p_exceptions -> v_i;
    v_path := format('%s[%s]', p_path, v_i);
    if jsonb_typeof(v_e) <> 'object'
       or (select count(*) from jsonb_object_keys(v_e) k where k not in ('localDate', 'kind', 'windows')) > 0
       or jsonb_typeof(v_e -> 'localDate') is distinct from 'string'
       or private.knowledge_safe_date(v_e ->> 'localDate') is null
       or jsonb_typeof(v_e -> 'kind') is distinct from 'string'
       or v_e ->> 'kind' not in ('cancelled', 'changed_window', 'extra')
       or (v_e ->> 'kind' = 'cancelled' and v_e ? 'windows') then
      v_out := v_out || jsonb_build_object('path', v_path, 'problem', 'invalid');
    elsif v_e ->> 'kind' <> 'cancelled' then
      v_out := v_out || private.schedule_window_problems(v_path || '.windows', v_e -> 'windows');
    end if;
  end loop;
  return v_out;
end;
$$;

-- Expands a schedule over local dates p_from..p_to (at most 92 days) within
-- its effective dates, in p_timezone. Per date: a cancelled exception keeps
-- the scheduled windows with state 'cancelled'; changed_window replaces them
-- ('changed'); extra adds windows ('extra'), on any date; otherwise the
-- scheduled windows ('scheduled'). A local time that does not exist (spring)
-- or occurs twice (autumn) is read as Postgres reads it: the offset before
-- the change for a gap, after it for an overlap. Windows in start order;
-- ends_at past midnight is the next day. Reads no table.
create function private.schedule_occurrences(
  p_timezone text,
  p_effective_from date,
  p_effective_to date,
  p_recurrence jsonb,
  p_windows jsonb,
  p_exceptions jsonb,
  p_from date,
  p_to date
)
returns table (local_date date, starts_at timestamptz, ends_at timestamptz, state text)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fields jsonb;
  v_day date;
  v_last date;
  v_scheduled boolean;
  v_exception jsonb;
  v_windows jsonb;
  v_state text;
  v_w jsonb;
  v_days text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  v_name text;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 91 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  v_fields := private.schedule_problems('schedule', jsonb_strip_nulls(jsonb_build_object(
      'effectiveFrom', to_char(p_effective_from, 'YYYY-MM-DD'),
      'effectiveTo', to_char(p_effective_to, 'YYYY-MM-DD'),
      'recurrence', p_recurrence, 'windows', p_windows)))
    || private.schedule_exception_problems('exceptions', p_exceptions);
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  v_day := greatest(p_from, p_effective_from);
  v_last := least(p_to, coalesce(p_effective_to, p_to));
  while v_day <= v_last loop
    v_name := v_days[extract(isodow from v_day)::integer];
    v_scheduled := case p_recurrence ->> 'kind'
      when 'weekly' then (p_recurrence -> 'days') ? v_name
      when 'monthly' then v_name = p_recurrence ->> 'day' and case
        when (p_recurrence ->> 'nth')::integer = -1
          then v_day + 7 > (date_trunc('month', v_day) + interval '1 month' - interval '1 day')::date
        else (extract(day from v_day)::integer - 1) / 7 + 1 = (p_recurrence ->> 'nth')::integer end
      else (p_recurrence -> 'dates') ? to_char(v_day, 'YYYY-MM-DD')
    end;
    select x into v_exception
    from jsonb_array_elements(coalesce(p_exceptions, '[]'::jsonb)) with ordinality as e(x, o)
    where x ->> 'localDate' = to_char(v_day, 'YYYY-MM-DD') and x ->> 'kind' in ('cancelled', 'changed_window')
    order by o desc limit 1;
    v_windows := null;
    if v_scheduled then
      if v_exception ->> 'kind' = 'cancelled' then
        v_windows := p_windows;
        v_state := 'cancelled';
      elsif v_exception ->> 'kind' = 'changed_window' then
        v_windows := v_exception -> 'windows';
        v_state := 'changed';
      else
        v_windows := p_windows;
        v_state := 'scheduled';
      end if;
      for v_w in select w from jsonb_array_elements(v_windows) w order by w ->> 'start', w ->> 'end' loop
        local_date := v_day;
        starts_at := (v_day + (v_w ->> 'start')::time) at time zone p_timezone;
        ends_at := (case when (v_w ->> 'end')::time <= (v_w ->> 'start')::time then v_day + 1 else v_day end
          + (v_w ->> 'end')::time) at time zone p_timezone;
        state := v_state;
        return next;
      end loop;
    end if;
    for v_w in
      select w
      from jsonb_array_elements(coalesce(p_exceptions, '[]'::jsonb)) x,
        jsonb_array_elements(x -> 'windows') w
      where x ->> 'localDate' = to_char(v_day, 'YYYY-MM-DD') and x ->> 'kind' = 'extra'
      order by w ->> 'start', w ->> 'end'
    loop
      local_date := v_day;
      starts_at := (v_day + (v_w ->> 'start')::time) at time zone p_timezone;
      ends_at := (case when (v_w ->> 'end')::time <= (v_w ->> 'start')::time then v_day + 1 else v_day end
        + (v_w ->> 'end')::time) at time zone p_timezone;
      state := 'extra';
      return next;
    end loop;
    v_day := v_day + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Value schemas: service.v1 and schedule_event.v1 (§3.3, §6)
-- ---------------------------------------------------------------------------

-- service.v1: schedule, channels (internal), fees, limitations, availability
-- (as facility) and broadcasters (value list, A9).
create function private.knowledge_service_problems(p_detail jsonb)
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
    if v_key not in ('schedule', 'channels', 'fees', 'limitations', 'availability', 'broadcasters') then
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

-- schedule_event.v1: Committed is yes, Not committed no, Cancelled no with
-- cancelled: true. event { title, localDate, start, end } is required for a
-- Committed answer. Who committed comes from the confirmation, not the detail.
create function private.knowledge_schedule_event_problems(p_headline text, p_detail jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_key text;
  v_e jsonb;
begin
  if jsonb_typeof(p_detail) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', 'detail', 'problem', 'invalid'));
  end if;
  for v_key in select k from jsonb_object_keys(p_detail) k order by k collate "C" loop
    if v_key not in ('event', 'cancelled', 'limitations') then
      v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'not_allowed');
    end if;
  end loop;
  if p_detail ? 'event' then
    v_e := p_detail -> 'event';
    if jsonb_typeof(v_e) <> 'object'
       or (select count(*) from jsonb_object_keys(v_e) k where k not in ('title', 'localDate', 'start', 'end')) > 0 then
      v_out := v_out || jsonb_build_object('path', 'detail.event', 'problem', 'invalid');
    else
      if jsonb_typeof(v_e -> 'title') is distinct from 'string' then
        v_out := v_out || jsonb_build_object('path', 'detail.event.title',
          'problem', case when v_e ? 'title' then 'invalid' else 'required' end);
      elsif length(btrim(v_e ->> 'title')) = 0 then
        v_out := v_out || jsonb_build_object('path', 'detail.event.title', 'problem', 'required');
      elsif length(v_e ->> 'title') > 120 then
        v_out := v_out || jsonb_build_object('path', 'detail.event.title', 'problem', 'too_long');
      end if;
      if not (v_e ? 'localDate') then
        v_out := v_out || jsonb_build_object('path', 'detail.event.localDate', 'problem', 'required');
      elsif jsonb_typeof(v_e -> 'localDate') <> 'string' or private.knowledge_safe_date(v_e ->> 'localDate') is null then
        v_out := v_out || jsonb_build_object('path', 'detail.event.localDate', 'problem', 'invalid');
      end if;
      if (v_e ? 'start') or (v_e ? 'end') then
        v_out := v_out || private.schedule_window_problems('detail.event.window',
          jsonb_build_array(jsonb_build_object('start', v_e -> 'start', 'end', v_e -> 'end')));
      end if;
    end if;
  elsif p_headline = 'yes' then
    v_out := v_out || jsonb_build_object('path', 'detail.event', 'problem', 'required');
  end if;
  if p_detail ? 'cancelled' and (jsonb_typeof(p_detail -> 'cancelled') <> 'boolean'
     or ((p_detail -> 'cancelled')::boolean and p_headline is distinct from 'no')) then
    v_out := v_out || jsonb_build_object('path', 'detail.cancelled', 'problem', 'invalid');
  end if;
  if p_detail ? 'limitations' and jsonb_typeof(p_detail -> 'limitations') <> 'string' then
    v_out := v_out || jsonb_build_object('path', 'detail.limitations', 'problem', 'invalid');
  elsif length(p_detail ->> 'limitations') > 2000 then
    v_out := v_out || jsonb_build_object('path', 'detail.limitations', 'problem', 'too_long');
  end if;
  return v_out;
end;
$$;

-- B03-c body plus service.v1 and schedule_event.v1.
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
      v_fields := v_fields || private.knowledge_service_problems(v_given);
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

-- ---------------------------------------------------------------------------
-- Schedules and exceptions (§6.1, A7)
-- ---------------------------------------------------------------------------

create table public.knowledge_schedules (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_key text not null,
  check_id uuid not null references public.venue_amenity_checks (id) on delete restrict,
  contribution_id uuid not null references public.knowledge_contributions (id) on delete restrict,
  submission_id uuid references public.amenity_submissions (id) on delete restrict,
  supersedes uuid references public.knowledge_schedules (id) on delete restrict,
  timezone text not null,
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  recurrence jsonb not null,
  windows jsonb not null,
  created_at timestamptz not null default now(),
  constraint knowledge_schedules_shape check (jsonb_array_length(private.schedule_problems('schedule',
    jsonb_strip_nulls(jsonb_build_object('effectiveFrom', to_char(effective_from, 'YYYY-MM-DD'),
      'effectiveTo', to_char(effective_to, 'YYYY-MM-DD'), 'recurrence', recurrence, 'windows', windows)))) = 0)
);

create index knowledge_schedules_check on public.knowledge_schedules (check_id, created_at desc, id desc);

create table public.knowledge_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.knowledge_schedules (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  local_date date not null,
  kind text not null check (kind in ('cancelled', 'changed_window', 'extra')),
  windows jsonb,
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint knowledge_schedule_exceptions_windows check (
    (kind = 'cancelled') = (windows is null)
    and (windows is null or jsonb_array_length(private.schedule_window_problems('windows', windows)) = 0)),
  constraint knowledge_schedule_exceptions_once unique (schedule_id, local_date)
);

do $$
declare
  t text;
begin
  foreach t in array array['knowledge_schedules', 'knowledge_schedule_exceptions'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

revoke all on public.knowledge_schedules, public.knowledge_schedule_exceptions
from public, anon, authenticated, service_role;
grant select on public.knowledge_schedules, public.knowledge_schedule_exceptions to service_role;
alter table public.knowledge_schedules enable row level security;
alter table public.knowledge_schedule_exceptions enable row level security;

alter table public.knowledge_events drop constraint knowledge_events_kind_check;
alter table public.knowledge_events add constraint knowledge_events_kind_check check (kind in (
  'contribution_recorded', 'decision_recorded', 'working_list_enabled', 'working_list_disabled',
  'rule_version_added', 'question_version_changed', 'evidence_withdrawn', 'assignment_closed_by_other',
  'schedule_exception_added'));

alter table public.knowledge_write_commands drop constraint knowledge_write_commands_command_check;
alter table public.knowledge_write_commands add constraint knowledge_write_commands_command_check
  check (command in ('place_add', 'place_retire', 'schedule_exception'));

-- An adopted service contribution with a schedule becomes the schedule
-- version in use; the previous one for the check is superseded. Called when
-- the contribution is adopted and when its detail row is stored, because the
-- 19-argument send stores the detail after the 16-argument send has already
-- adopted a finding that needs no confirmation. Once per contribution.
create function private.knowledge_schedule_create(p_contribution_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adopted public.knowledge_decisions;
  v_detail jsonb;
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
  insert into public.knowledge_schedules (
    venue_id, question_key, check_id, contribution_id, submission_id, supersedes, timezone,
    effective_from, effective_to, recurrence, windows
  )
  values (
    v_adopted.venue_id, v_adopted.question_key, v_adopted.check_id, p_contribution_id,
    v_adopted.resulting_submission_id,
    (select s.id from public.knowledge_schedules s where s.check_id = v_adopted.check_id
     order by s.created_at desc, s.id desc limit 1),
    private.venue_timezone(v_adopted.venue_id),
    (v_detail ->> 'effectiveFrom')::date, (v_detail ->> 'effectiveTo')::date,
    v_detail -> 'recurrence', v_detail -> 'windows'
  );
end;
$$;

create function private.knowledge_schedule_on_adopt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'adopted' and new.contribution_id is not null then
    perform private.knowledge_schedule_create(new.contribution_id);
  end if;
  return null;
end;
$$;

create function private.knowledge_schedule_on_detail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.knowledge_schedule_create(new.contribution_id);
  return null;
end;
$$;

create unique index knowledge_schedules_contribution on public.knowledge_schedules (contribution_id);

create trigger knowledge_decisions_schedule
  after insert on public.knowledge_decisions
  for each row execute function private.knowledge_schedule_on_adopt();
create trigger knowledge_contribution_details_schedule
  after insert on public.knowledge_contribution_details
  for each row execute function private.knowledge_schedule_on_detail();

-- The schedule version in use: the latest one for the check's current
-- submission while the check is complete.
create function private.knowledge_schedule_in_use(p_check_id uuid)
returns public.knowledge_schedules
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.venue_amenity_checks c
  join public.knowledge_schedules s on s.check_id = c.id and s.submission_id = c.current_submission_id
  where c.id = p_check_id and c.progress = 'complete'
  order by s.created_at desc, s.id desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Reads (A7, A8)
-- ---------------------------------------------------------------------------

-- Anyone who may read the check: the schedule in use with its exceptions.
create function public.knowledge_occurrences(p_check_id uuid, p_from date, p_to date)
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
  return query
    select o.local_date, o.starts_at, o.ends_at, o.state
    from private.schedule_occurrences(v_schedule.timezone, v_schedule.effective_from, v_schedule.effective_to,
      v_schedule.recurrence, v_schedule.windows,
      (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('localDate', to_char(e.local_date, 'YYYY-MM-DD'),
          'kind', e.kind, 'windows', e.windows)) order by e.created_at, e.id), '[]'::jsonb)
       from public.knowledge_schedule_exceptions e where e.schedule_id = v_schedule.id),
      p_from, p_to) o;
end;
$$;

-- Any active user: what a schedule being written would give, with the send's
-- validation (field paths under 'schedule'). No write.
create function public.knowledge_schedule_preview(p_schedule jsonb, p_timezone text, p_from date, p_to date)
returns table (local_date date, starts_at timestamptz, ends_at timestamptz, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fields jsonb := private.schedule_problems('schedule', p_schedule);
begin
  perform private.amenity_assert_active_user();
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  return query
    select o.local_date, o.starts_at, o.ends_at, o.state
    from private.schedule_occurrences(coalesce(p_timezone, 'Europe/London'),
      (p_schedule ->> 'effectiveFrom')::date, (p_schedule ->> 'effectiveTo')::date,
      p_schedule -> 'recurrence', p_schedule -> 'windows', '[]'::jsonb, p_from, p_to) o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: a single-date exception (A7)
-- ---------------------------------------------------------------------------

-- A venue manager or an admin, on the schedule in use; one exception per
-- date. Keyed as §14.1; records schedule_exception_added.
create function public.knowledge_schedule_exception(
  p_check_id uuid,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_schedule_id uuid,
  p_local_date date,
  p_kind text,
  p_windows jsonb,
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
  v_note text := private.clean_text(p_note, 500, 'invalid_note');
  v_hash text;
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_basis text;
  v_revision bigint;
  v_schedule public.knowledge_schedules;
  v_fields jsonb := '[]'::jsonb;
  v_existing uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_hash := private.knowledge_hash(jsonb_build_object('checkId', p_check_id, 'slotRevision', p_slot_revision,
    'scheduleId', p_schedule_id, 'localDate', p_local_date, 'kind', p_kind, 'windows', p_windows, 'note', v_note));
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'schedule_exception', v_hash);
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
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  v_schedule := private.knowledge_schedule_in_use(v_check.id);
  if v_schedule.id is null or v_schedule.id is distinct from p_schedule_id then
    raise exception 'knowledge_not_current' using errcode = 'NLK08';
  end if;

  if p_kind is null or p_kind not in ('cancelled', 'changed_window', 'extra') then
    v_fields := v_fields || jsonb_build_object('path', 'kind', 'problem', 'invalid');
  end if;
  if p_local_date is null then
    v_fields := v_fields || jsonb_build_object('path', 'localDate', 'problem', 'required');
  elsif p_local_date < v_schedule.effective_from
        or p_local_date > coalesce(v_schedule.effective_to, p_local_date) then
    v_fields := v_fields || jsonb_build_object('path', 'localDate', 'problem', 'out_of_range');
  end if;
  if p_kind = 'cancelled' and p_windows is not null then
    v_fields := v_fields || jsonb_build_object('path', 'windows', 'problem', 'not_allowed');
  elsif p_kind in ('changed_window', 'extra') then
    v_fields := v_fields || private.schedule_window_problems('windows', p_windows);
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  select e.id into v_existing from public.knowledge_schedule_exceptions e
  where e.schedule_id = v_schedule.id and e.local_date = p_local_date;
  if found then
    raise exception 'schedule_exception_exists' using errcode = 'P0001',
      detail = jsonb_build_object('exceptionId', v_existing)::text;
  end if;
  insert into public.knowledge_schedule_exceptions (schedule_id, venue_id, local_date, kind, windows, note, created_by)
  values (v_schedule.id, v_check.venue_id, p_local_date, p_kind,
    case when p_kind = 'cancelled' then null else p_windows end, v_note, v_uid)
  returning id into v_id;
  perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id, 'schedule_exception_added',
    null, v_check.current_submission_id, null,
    jsonb_build_object('scheduleId', v_schedule.id, 'exceptionId', v_id,
      'localDate', to_char(p_local_date, 'YYYY-MM-DD'), 'kind', p_kind));
  v_result := jsonb_build_object('exceptionId', v_id,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key), 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'schedule_exception', v_hash,
    v_check.venue_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-created reads: additive keys only
-- ---------------------------------------------------------------------------

-- B03-c body plus answerInUse.scheduleId (A25).
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
      'scheduleId', (
        select s.id from public.knowledge_schedules s
        where s.check_id = p_check.id and s.submission_id = st.current_submission_id
        order by s.created_at desc, s.id desc limit 1))
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
    -- Per use (A10); read as unrated until B03-e adds freshness policies.
    'freshness', jsonb_build_array(
      jsonb_build_object('use', 'internal', 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null),
      jsonb_build_object('use', 'public', 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null))
  )
  from private.knowledge_slot_state_b03(p_check.venue_id, array[p_check.template_key]) st
  join public.amenity_catalogue t on t.key = p_check.template_key
  left join public.knowledge_contribution_details kd on kd.contribution_id = st.current_contribution_id
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

-- B03-c body plus timezone (A6).
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

-- ---------------------------------------------------------------------------
-- B03-c review low: the legacy presented recheck_reason takes the UI
-- design's per-qualifier wording (b03-ui-design §2.6, A19(b)). Same columns.
-- ---------------------------------------------------------------------------

create or replace view private.amenity_check_rows_presented as
  select r.id, r.venue_id, r.template_key, r.category, r.question, r.capture_brief, r.evidence_rule,
    r.is_core, r.position, r.catalogue_version, r.status,
    case when q.qualification is null then r.progress else 'needs_recheck' end as progress,
    r.answer, r.current_submission_id, r.assignee_user_id, r.assignee_name,
    r.answered_by, r.answered_by_name, r.answered_at,
    case q.qualification
      when 'conditional' then 'The answer in use has conditions. Open the check to see them.'
      when 'temporarily_unavailable' then 'The answer in use is temporarily unavailable. Open the check to see until when.'
      else r.recheck_reason
    end as recheck_reason,
    r.notes, r.revision, r.updated_at, q.qualification
  from private.amenity_check_rows r
  left join public.amenity_submissions s on s.id = r.current_submission_id
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.source_contribution_id
  cross join lateral (
    select case when r.progress = 'complete'
      then private.knowledge_qualifier(kd.value_schema, r.answer, kd.detail) end as qualification
  ) q;

revoke all on private.amenity_check_rows_presented from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.venue_timezone(uuid),
  private.schedule_window_problems(text, jsonb),
  private.schedule_problems(text, jsonb),
  private.schedule_exception_problems(text, jsonb),
  private.schedule_occurrences(text, date, date, jsonb, jsonb, jsonb, date, date),
  private.knowledge_service_problems(jsonb),
  private.knowledge_schedule_event_problems(text, jsonb),
  private.knowledge_validate_value(text, integer, text, jsonb),
  private.knowledge_schedule_create(uuid),
  private.knowledge_schedule_on_adopt(),
  private.knowledge_schedule_on_detail(),
  private.knowledge_schedule_in_use(uuid),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text)
from public, anon, authenticated;

revoke all on function
  public.knowledge_occurrences(uuid, date, date),
  public.knowledge_schedule_preview(jsonb, text, date, date),
  public.knowledge_schedule_exception(uuid, bigint, uuid, uuid, date, text, jsonb, text),
  public.knowledge_check(uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_occurrences(uuid, date, date),
  public.knowledge_schedule_preview(jsonb, text, date, date),
  public.knowledge_schedule_exception(uuid, bigint, uuid, uuid, date, text, jsonb, text),
  public.knowledge_check(uuid)
to authenticated;
