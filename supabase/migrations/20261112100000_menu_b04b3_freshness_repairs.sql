-- B04-b3 (task B04-02; review-b04-s3s4-20261111 L2, L3, L4, L5): freshness
-- repairs on top of B04-b2 (20261110205000). Functions only; no table, row
-- or credit input changes.
--
-- L2. A due_soon, expired or basis_missing task whose field and use have no
--     policy in force any more (an explicit unbind, or the venue's and the
--     estate's bindings gone to no policy) is cancelled by the job: the field
--     now reads unrated and can never read current, so the task would stay
--     open for ever. A withdrawn or pending value under a policy still in
--     force keeps its task open (unchanged: it closes only on a re-statement).
-- L3. menu_freshness_binding_add refuses temporary_unavailability, dietary
--     and allergens (freshness_field_not_supported) while no read applies
--     them, so an admin cannot believe such a binding is active. The table
--     check keeps all five values; B04-c re-allows a field when a read
--     applies it. Documented default; owner may prefer a UI flag instead.
-- L4. The hourly job locks only lines that can have work: a confirmed price
--     or availability (when a binding concerns the venue), any temporary
--     unavailability, or an open task. Previously every line of a bound venue
--     was locked FOR UPDATE.
-- L5. menu_freshness_preview no longer counts availability that follows a
--     linked B03 service (the job and the reads exclude it, A1-4); it reports
--     how many it left out as `linkedService`.
--
-- Rollback: re-create the 20261110205000 bodies of the four functions.

-- L2: S3's body, plus the cancel rule for freshness causes with no policy.
create or replace function private.menu_close_rechecks(p_line_id uuid, p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task public.menu_trading_recheck_tasks;
  v_state jsonb;
  v_current boolean;
  v_fresh jsonb;
  v_venue uuid;
  v_policy public.knowledge_freshness_policies;
  v_closed integer := 0;
begin
  if not exists (select 1 from public.menu_trading_recheck_tasks t where t.line_id = p_line_id and t.state = 'open') then
    return 0;
  end if;
  v_state := private.menu_trading_field_state(p_line_id, 'temporary_unavailability', p_now);
  v_current := v_state ->> 'status' = 'available' and (
    v_state #>> '{value,state}' = 'back_in_service'
    or (v_state #>> '{value,state}' = 'temporarily_unavailable'
        and (jsonb_typeof(v_state #> '{value,until}') = 'null'
             or (v_state #>> '{value,until}')::timestamptz > p_now)));
  select l.venue_id into v_venue from public.menu_trading_lines l where l.id = p_line_id;
  for v_task in
    select t.* from public.menu_trading_recheck_tasks t
    where t.line_id = p_line_id and t.state = 'open'
      and t.cause in ('temporary_until_passed', 'due_soon', 'expired', 'basis_missing')
    order by t.created_at, t.id
    for update
  loop
    if v_task.cause = 'temporary_until_passed' then
      if not (v_task.use = 'internal'
              and coalesce(v_current and (v_state ->> 'assertionId')::uuid is distinct from v_task.assertion_id, false)) then
        continue;
      end if;
    else
      v_policy := private.menu_freshness_policy_at(v_venue, v_task.field, v_task.use, p_now);
      if v_policy.id is null then
        -- Unbound for this field and use: it reads unrated and never current.
        update public.menu_trading_recheck_tasks t
        set state = 'cancelled', closed_at = now()
        where t.id = v_task.id;
        continue;
      end if;
      v_fresh := private.menu_trading_freshness(v_venue, v_task.field,
        private.menu_trading_field_state(p_line_id, v_task.field, p_now), p_now);
      if v_fresh is null or not exists (
           select 1 from jsonb_array_elements(v_fresh) e
           where e ->> 'use' = v_task.use and e ->> 'state' = 'current') then
        continue;
      end if;
    end if;
    update public.menu_trading_recheck_tasks t
    set state = 'done', closed_at = now(),
        closed_by = (select p.id from public.profiles p where p.id = auth.uid())
    where t.id = v_task.id;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

-- L4: S3's body; the line loop selects only lines that can have work.
create or replace function private.menu_open_rechecks(p_now timestamptz, p_venue_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_line public.menu_trading_lines;
  v_state jsonb;
  v_count integer;
  v_opened integer := 0;
  v_bound boolean;
  v_field text;
  v_fresh jsonb;
  v_entry jsonb;
  v_due timestamptz;
begin
  if p_now is null then
    raise exception 'invalid_recheck_instant' using errcode = '22023';
  end if;
  for v_venue in
    select distinct l.venue_id from public.menu_trading_lines l
    where p_venue_ids is null or l.venue_id = any (p_venue_ids)
    order by 1
  loop
    perform private.lock_venue_menu(v_venue, true);
    v_bound := private.menu_freshness_bound(v_venue, 'price', p_now)
      or private.menu_freshness_bound(v_venue, 'availability', p_now);
    for v_line in
      select l.* from public.menu_trading_lines l
      where l.venue_id = v_venue
        and ((v_bound and exists (
               select 1 from public.menu_trading_assertions a
               join public.menu_trading_decisions d on d.assertion_id = a.id
               where a.line_id = l.id and a.field in ('price', 'availability') and d.decision = 'confirmed'))
             or exists (select 1 from public.menu_trading_assertions a
                        where a.line_id = l.id and a.field = 'temporary_unavailability')
             or exists (select 1 from public.menu_trading_recheck_tasks t
                        where t.line_id = l.id and t.state = 'open'))
      order by l.id
      for update
    loop
      if v_line.retired_at is null and private.menu_trading_item_active(v_line.item_id, v_line.variant_id) then
        v_state := private.menu_trading_temporary_state(v_line.id, p_now);
        if v_state ->> 'state' = 'needs_checking' then
          insert into public.menu_trading_recheck_tasks (venue_id, line_id, assertion_id, cause, use, due_at)
          values (v_line.venue_id, v_line.id, (v_state ->> 'assertionId')::uuid, 'temporary_until_passed',
            'internal', (v_state ->> 'until')::timestamptz)
          on conflict on constraint menu_trading_recheck_tasks_once do nothing;
          get diagnostics v_count = row_count;
          v_opened := v_opened + v_count;
        end if;
        if v_bound then
          foreach v_field in array array['price', 'availability'] loop
            v_state := private.menu_trading_field_state(v_line.id, v_field, p_now);
            if v_field = 'availability' and v_state #>> '{value,state}' = 'scheduled' and exists (
                 select 1 from public.menu_availability_schedules s
                 where s.id = (v_state #>> '{value,scheduleId}')::uuid and s.knowledge_check_id is not null) then
              continue;
            end if;
            v_fresh := private.menu_trading_freshness(v_venue, v_field, v_state, p_now);
            continue when v_fresh is null;
            for v_entry in select e from jsonb_array_elements(v_fresh) e loop
              continue when v_entry ->> 'state' not in ('due_soon', 'expired', 'basis_missing');
              v_due := case when v_entry ->> 'state' = 'basis_missing' then (
                  select b.effective_from from public.menu_freshness_bindings b
                  where b.field = v_field and b.use = v_entry ->> 'use' and b.effective_from <= p_now
                    and (b.venue_id = v_venue or b.venue_id is null)
                  order by (b.venue_id is null), b.effective_from desc, b.created_at desc limit 1)
                else (v_entry ->> 'nextCheckDue')::timestamptz end;
              if v_entry ->> 'state' = 'expired' then
                update public.menu_trading_recheck_tasks t
                set state = 'cancelled', closed_at = now()
                where t.line_id = v_line.id and t.field = v_field and t.use = v_entry ->> 'use'
                  and t.due_at = v_due and t.cause = 'due_soon' and t.state = 'open';
              end if;
              insert into public.menu_trading_recheck_tasks (venue_id, line_id, assertion_id, field, cause, use, due_at)
              values (v_line.venue_id, v_line.id, (v_state ->> 'assertionId')::uuid, v_field, v_entry ->> 'state',
                v_entry ->> 'use', v_due)
              on conflict on constraint menu_trading_recheck_tasks_once do nothing;
              get diagnostics v_count = row_count;
              v_opened := v_opened + v_count;
            end loop;
          end loop;
        end if;
      end if;
      perform private.menu_close_rechecks(v_line.id, p_now);
    end loop;
  end loop;
  return v_opened;
end;
$$;

-- L3: S3's body; fields no read applies yet are refused.
create or replace function public.menu_freshness_binding_add(
  p_venue uuid,
  p_field text,
  p_use text,
  p_policy_id text,
  p_policy_version integer,
  p_effective_from timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_row public.menu_freshness_bindings;
begin
  if p_field is null or p_field not in ('price', 'availability', 'temporary_unavailability', 'dietary', 'allergens')
     or p_use is null or p_use not in ('internal', 'public')
     or (p_policy_id is null) <> (p_policy_version is null) then
    raise exception 'invalid_freshness_binding' using errcode = '22023';
  end if;
  if p_field not in ('price', 'availability') then
    raise exception 'freshness_field_not_supported' using errcode = 'P0001';
  end if;
  if p_effective_from is not null and p_effective_from < now() then
    raise exception 'invalid_effective_from' using errcode = '22023';
  end if;
  if p_venue is not null and not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_policy_id is not null and not exists (
       select 1 from public.knowledge_freshness_policies p where p.id = p_policy_id and p.version = p_policy_version) then
    raise exception 'freshness_policy_not_found' using errcode = 'P0002';
  end if;
  if p_venue is not null then
    perform private.lock_venue_menu(p_venue, false);
  end if;
  insert into public.menu_freshness_bindings (venue_id, field, use, policy_id, policy_version, bound_by, effective_from)
  values (p_venue, p_field, p_use, p_policy_id, p_policy_version, v_uid, coalesce(p_effective_from, now()))
  returning * into v_row;
  return jsonb_build_object('bindingId', v_row.id, 'venueId', v_row.venue_id, 'field', v_row.field,
    'use', v_row.use, 'policyId', v_row.policy_id, 'policyVersion', v_row.policy_version,
    'effectiveFrom', v_row.effective_from);
end;
$$;

-- L5: S3's body; availability that follows a linked B03 service is left out
-- of the counts (as the job and reads do) and reported as linkedService.
create or replace function public.menu_freshness_preview(p_venue uuid, p_field text, p_policy jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_use text;
  v_counts jsonb := '{}'::jsonb;
  v_lines integer;
  v_linked integer;
begin
  perform private.assert_active_admin();
  if p_field is null or p_field not in ('price', 'availability')
     or jsonb_typeof(p_policy) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_policy) k where k not in ('internal', 'public')) then
    raise exception 'invalid_freshness_binding' using errcode = '22023';
  end if;
  foreach v_use in array array['internal', 'public'] loop
    if p_policy ->> v_use is not null and not exists (
         select 1 from public.knowledge_freshness_policies p
         where p.id = p_policy ->> v_use and p.use = v_use and p.basis = 'stated_on') then
      raise exception 'freshness_policy_not_found' using errcode = 'P0002';
    end if;
  end loop;

  with lines as (
    select s.venue_id, s.state,
      p_field = 'availability' and s.state #>> '{value,state}' = 'scheduled' and exists (
        select 1 from public.menu_availability_schedules m
        where m.id = (s.state #>> '{value,scheduleId}')::uuid and m.knowledge_check_id is not null) as linked
    from (
      select l.venue_id, private.menu_trading_field_state(l.id, p_field, now()) as state
      from public.menu_trading_lines l
      where (p_venue is null or l.venue_id = p_venue) and l.retired_at is null
        and private.menu_trading_item_active(l.item_id, l.variant_id)
    ) s
  ),
  entries as (
    select u.use, private.knowledge_freshness_entry(u.use, p.max_age, p.recheck_lead, p.basis,
        case when s.state ->> 'statedOn' ~ '^\d{4}-\d{2}-\d{2}$' then (s.state ->> 'statedOn')::date end,
        null, now(), private.venue_timezone(s.venue_id)) ->> 'state' as state
    from lines s
    cross join (values ('internal'), ('public')) u(use)
    join lateral (
      select p.* from public.knowledge_freshness_policies p
      where p.id = p_policy ->> u.use and p.use = u.use order by p.version desc limit 1
    ) p on true
    where s.state ->> 'status' = 'available' and not s.linked
  )
  select coalesce(jsonb_object_agg(x.use, x.counts), '{}'::jsonb) into v_counts
  from (
    select e.use, jsonb_build_object(
        'current', count(*) filter (where e.state = 'current'),
        'due_soon', count(*) filter (where e.state = 'due_soon'),
        'expired', count(*) filter (where e.state = 'expired'),
        'basis_missing', count(*) filter (where e.state = 'basis_missing')) as counts
    from entries e group by e.use
  ) x;
  select count(*), count(*) filter (where s.state ->> 'status' = 'available'
      and p_field = 'availability' and s.state #>> '{value,state}' = 'scheduled' and exists (
        select 1 from public.menu_availability_schedules m
        where m.id = (s.state #>> '{value,scheduleId}')::uuid and m.knowledge_check_id is not null))
  into v_lines, v_linked
  from (
    select private.menu_trading_field_state(l.id, p_field, now()) as state
    from public.menu_trading_lines l
    where (p_venue is null or l.venue_id = p_venue) and l.retired_at is null
      and private.menu_trading_item_active(l.item_id, l.variant_id)
  ) s;
  return jsonb_build_object('field', p_field, 'venueId', p_venue, 'policy', p_policy, 'lines', v_lines,
    'linkedService', v_linked, 'counts', v_counts);
end;
$$;
