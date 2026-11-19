-- B03 reviewer low R-L1 (verdict on 7434cca5, section 1).
--
-- * private.knowledge_open_rechecks dated a schema_changed task from the
--   latest registry version, while the resolver compares the answer with the
--   version in force at p_now (private.knowledge_version_as_of). With a
--   future-effective version on the key, the task carried that future
--   version's time. It now takes its due time from the version in force at
--   p_now, through private.knowledge_schema_change_due(key, at): the moment
--   that version took effect, greatest(created_at, effective_from), the same
--   rule as knowledge_version_as_of. Null before the registry existed.
-- * Nothing else in knowledge_open_rechecks changes; the body is the one
--   from 20261110113909 with that single expression replaced.
-- * Not touched: the credit trigger, the evidence-withdrawn trigger, the credit
--   functions, the B01 resolver, knowledge_adopt.
--
-- Rollback: a forward migration restores the 20261110113909 body.

create function private.knowledge_schema_change_due(p_key text, p_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(v.created_at, coalesce(v.effective_from, v.created_at))
  from private.knowledge_version_as_of(p_key, p_at) v;
$$;
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
  v_schedule public.knowledge_schedules;
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
      v_schedule := private.knowledge_schedule_in_use(v_row.check_id);
      if v_schedule.effective_to < v_today then
        insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values (v_venue, v_row.check_id, v_row.question_key, 'schedule_ended', 'internal',
          (v_schedule.effective_to + 1)::timestamp at time zone v_schedule.timezone)
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

revoke all on function
  private.knowledge_schema_change_due(text, timestamptz),
  private.knowledge_open_rechecks(timestamptz)
from public, anon, authenticated;
