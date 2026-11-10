-- B03-e: freshness and rechecks (docs/knowledge/b03-design.md §7, §12 batch
-- B03-e, §14 A10, A11, A24, A28, A29, A31).
--
-- FLAG for WS5 and the reviewer: for a key whose registry version names a
-- freshness policy, the v1 reader's freshness_state and next_check_due are
-- filled, and an expired or basis-missing answer reads unavailable / stale /
-- expired or basis_missing. No key names a policy (OD-15), so no output
-- changes today. knowledge_decide, knowledge_resolve_conflict and the
-- 19-argument knowledge_submit are re-created to return rechecksClosed.
--
-- * public.knowledge_freshness_policies: append-only versions, seeded EMPTY
--   (OD-15 supplies them). A version's freshness {internal, public} names a
--   policy id; the latest policy version applies.
-- * private.knowledge_freshness_entry (pure) and
--   private.knowledge_slot_freshness give the A10 per-use entries: the basis
--   is observed_on, authority.statedOn (policy) or the event's end
--   (schedule_event); no basis date is basis_missing, never "never expires".
-- * private.knowledge_slot_state_b03 is re-created (dropped: it gains a
--   freshness column and an optional p_now). The B01 resolver is unchanged.
--   Precedence for an otherwise available slot: expired, basis_missing,
--   policy_incomplete, then qualified_answer (A22).
-- * public.knowledge_recheck_tasks with private.knowledge_open_rechecks
--   (due_soon, expired, basis_missing, temporary_until_passed,
--   schedule_ended; idempotent) and private.knowledge_close_rechecks (only
--   when the slot reads available and fresh for the task's use, §7.4 M4).
--   Closing runs from insert triggers on knowledge_decisions (adopted,
--   confirmed, reaffirmed) and knowledge_contribution_details, so
--   knowledge_adopt is not re-created. public.knowledge_run_rechecks is the
--   job entry (service role); the route exists, the schedule is not added
--   until OD-15.
-- * Reads: public.my_rechecks and public.knowledge_check_rechecks (A11);
--   public.manager_triage_summary gains a rechecks queue (B02 body);
--   public.knowledge_freshness_preview (admin dry run, §7.3).
-- * Re-created: knowledge_decide, knowledge_resolve_conflict (B03-c bodies)
--   and the 19-argument knowledge_submit (B03-b body) add rechecksClosed
--   (A24); private.knowledge_slot_json (freshness from the resolver view);
--   public.knowledge_check (unchanged body, re-created after the view);
--   private.knowledge_evidence_for_assets (K1 values).
-- * New for WS4: private.knowledge_public_media_eligible and its set form
--   (K2, A29); private.asset_evidence_events (K4, A31).
-- * Not touched: the credit trigger, media_assets_knowledge_evidence_withdrawn,
--   the credit functions, private.knowledge_slot_state, knowledge_adopt.
--
-- Rollback: a forward migration restores the B03-d slot JSON and the earlier
-- bodies; drop the triggers; the tables stay.

-- ---------------------------------------------------------------------------
-- Policies (§7.1)
-- ---------------------------------------------------------------------------

create table public.knowledge_freshness_policies (
  id text not null check (id ~ '^[a-z][a-z0-9_]{0,39}$'),
  version integer not null check (version >= 1),
  claim_class text not null check (claim_class in ('fixture', 'offering', 'schedule', 'policy', 'accessibility', 'event')),
  use text not null check (use in ('internal', 'public')),
  max_age interval check (max_age is null or max_age > interval '0'),
  recheck_lead interval check (recheck_lead is null or recheck_lead >= interval '0'),
  basis text not null check (basis in ('observed_on', 'stated_on', 'event_end')),
  note text check (note is null or length(note) between 1 and 500),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint knowledge_freshness_policies_age check ((basis = 'event_end') = (max_age is null))
);

comment on table public.knowledge_freshness_policies is
  'Freshness policies by claim class and use (b03-design §7.1). Seeded empty: the owner supplies durations (OD-15). Append-only.';

do $$
begin
  execute 'create trigger knowledge_freshness_policies_append_only before update or delete on public.knowledge_freshness_policies for each row execute function private.append_only_guard()';
  execute 'create trigger knowledge_freshness_policies_no_truncate before truncate on public.knowledge_freshness_policies for each statement execute function private.append_only_guard()';
end;
$$;

revoke all on public.knowledge_freshness_policies from public, anon, authenticated, service_role;
grant select on public.knowledge_freshness_policies to service_role;
alter table public.knowledge_freshness_policies enable row level security;

-- ---------------------------------------------------------------------------
-- Read-time freshness (§7.2, §7.3, A10)
-- ---------------------------------------------------------------------------

-- One use's entry. No policy: unrated. No basis date: basis_missing. Due is
-- local midnight of the basis date plus max_age (or the event's end);
-- due_soon from due minus the lead; expired from due.
create function private.knowledge_freshness_entry(
  p_use text, p_max_age interval, p_lead interval, p_basis text, p_basis_date date,
  p_event_end timestamptz, p_now timestamptz, p_timezone text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_due timestamptz;
begin
  if p_basis is null then
    return jsonb_build_object('use', p_use, 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null);
  end if;
  v_due := case when p_basis = 'event_end' then p_event_end
    else (p_basis_date::timestamp + p_max_age) at time zone p_timezone end;
  if p_basis_date is null or v_due is null then
    return jsonb_build_object('use', p_use, 'state', 'basis_missing', 'nextCheckDue', null,
      'basis', p_basis, 'basisDate', null);
  end if;
  return jsonb_build_object('use', p_use,
    'state', case
      when p_now >= v_due then 'expired'
      when p_lead is not null and p_now >= v_due - p_lead then 'due_soon'
      else 'current' end,
    'nextCheckDue', v_due, 'basis', p_basis, 'basisDate', to_char(p_basis_date, 'YYYY-MM-DD'));
end;
$$;

-- The answer in use's entries, [internal, public], under the key's latest
-- version's policies (so answers given before a key gained a policy are
-- judged by it, §7.2). No answer in use: unrated.
create function private.knowledge_slot_freshness(
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
  v_event jsonb;
begin
  select v.freshness into v_freshness from public.knowledge_question_versions v
  where v.key = p_key order by v.version desc limit 1;
  foreach v_use in array array['internal', 'public'] loop
    v_policy := null;
    if p_submission_id is not null and v_freshness ->> v_use is not null then
      select p.* into v_policy from public.knowledge_freshness_policies p
      where p.id = v_freshness ->> v_use and p.use = v_use
      order by p.version desc limit 1;
    end if;
    v_date := case v_policy.basis
      when 'observed_on' then p_observed_on
      when 'stated_on' then case when p_schema = 'policy'
        then private.knowledge_safe_date(p_detail -> 'authority' ->> 'statedOn') end
      when 'event_end' then case when p_schema = 'schedule_event'
        then private.knowledge_safe_date(p_detail -> 'event' ->> 'localDate') end
    end;
    v_end := null;
    if v_policy.basis = 'event_end' and v_date is not null then
      v_event := p_detail -> 'event';
      v_end := case
        when v_event ->> 'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          (v_date + case when v_event ->> 'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and (v_event ->> 'end')::time <= (v_event ->> 'start')::time
            then 1 else 0 end + (v_event ->> 'end')::time) at time zone v_tz
        else (v_date + 1)::timestamp at time zone v_tz end;
    end if;
    v_out := v_out || private.knowledge_freshness_entry(v_use, v_policy.max_age, v_policy.recheck_lead,
      v_policy.basis, v_date, v_end, p_now, v_tz);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- The resolver's view, with freshness (§7.3, A22)
-- ---------------------------------------------------------------------------

drop function private.knowledge_slot_state_b03(uuid, text[]);

-- The B01 resolver's rows, unchanged except for an available slot: an
-- expired or basis-missing internal answer reads stale / expired or
-- basis_missing, then an incomplete policy not_confirmed / policy_incomplete,
-- then a qualified answer stale / qualified_answer; the value is withheld.
-- next_check_due and freshness_state are the internal use's (unrated and null
-- without a policy, as B01 returned).
create function private.knowledge_slot_state_b03(p_venue_id uuid, p_keys text[], p_now timestamptz default now())
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
    case when o.reason is null then s.value end,
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
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.current_contribution_id
  cross join lateral (
    select private.knowledge_qualifier(kd.value_schema, s.current_answer, kd.detail) as qualifier,
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
        when s.status <> 'available' then null
        when f.internal ->> 'state' in ('expired', 'basis_missing') then 'stale'
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'not_confirmed'
        when q.qualifier is not null then 'stale'
      end as reason,
      case
        when s.status <> 'available' then null
        when f.internal ->> 'state' in ('expired', 'basis_missing') then f.internal ->> 'state'
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'policy_incomplete'
        when q.qualifier is not null then 'qualified_answer'
      end as detail
  ) o;
$$;

-- ---------------------------------------------------------------------------
-- Recheck tasks (§7.4)
-- ---------------------------------------------------------------------------

create table public.knowledge_recheck_tasks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  check_id uuid not null references public.venue_amenity_checks (id) on delete restrict,
  question_key text not null,
  cause text not null check (cause in ('due_soon', 'expired', 'basis_missing', 'schedule_ended',
    'temporary_until_passed', 'evidence_lost', 'schema_changed', 'scope_changed')),
  use text not null check (use in ('internal', 'public')),
  due_at timestamptz not null,
  state text not null default 'open' check (state in ('open', 'done', 'cancelled')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete restrict,
  closed_decision_id uuid references public.knowledge_decisions (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint knowledge_recheck_tasks_once unique (check_id, cause, due_at, use),
  constraint knowledge_recheck_tasks_closed check ((state = 'open') = (closed_at is null))
);

create index knowledge_recheck_tasks_open on public.knowledge_recheck_tasks (venue_id, due_at) where state = 'open';

-- Never deleted; an open task is closed once (state, closed_*), nothing else.
create function private.knowledge_recheck_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.state <> 'open' or new.state = 'open'
     or (to_jsonb(new) - array['state', 'closed_at', 'closed_by', 'closed_decision_id'])
        is distinct from (to_jsonb(old) - array['state', 'closed_at', 'closed_by', 'closed_decision_id']) then
    raise exception 'knowledge_recheck_task_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger knowledge_recheck_tasks_guard
  before update or delete on public.knowledge_recheck_tasks
  for each row execute function private.knowledge_recheck_tasks_guard();
create trigger knowledge_recheck_tasks_no_truncate
  before truncate on public.knowledge_recheck_tasks
  for each statement execute function private.append_only_guard();

revoke all on public.knowledge_recheck_tasks from public, anon, authenticated, service_role;
grant select on public.knowledge_recheck_tasks to service_role;
alter table public.knowledge_recheck_tasks enable row level security;

-- Closes the check's open tasks whose use now reads available and fresh
-- (current or unrated), and a schedule_ended task once the schedule in use
-- has not ended. Returns [{ taskId, use }] closed.
create function private.knowledge_close_rechecks(p_check_id uuid, p_decision_id uuid)
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
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if not exists (select 1 from public.knowledge_recheck_tasks t where t.check_id = p_check_id and t.state = 'open') then
    return v_closed;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  select st.* into v_st from private.knowledge_slot_state_b03(v_check.venue_id, array[v_check.template_key]) st;
  for v_task in
    select t.* from public.knowledge_recheck_tasks t
    where t.check_id = p_check_id and t.state = 'open'
    order by t.created_at, t.id
    for update
  loop
    if v_st.status = 'available'
       and coalesce((select e ->> 'state' from jsonb_array_elements(v_st.freshness) e where e ->> 'use' = v_task.use),
         'unrated') in ('current', 'unrated')
       and (v_task.cause <> 'schedule_ended' or not exists (
         select 1 from private.knowledge_schedule_in_use(p_check_id) s where s.effective_to < v_today)) then
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

-- The tasks the caller closed on this check in this transaction (A24).
create function private.knowledge_rechecks_closed_now(p_check_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('taskId', t.id, 'use', t.use) order by t.created_at, t.id), '[]'::jsonb)
  from public.knowledge_recheck_tasks t
  where t.check_id = p_check_id and t.state = 'done' and t.closed_at = now()
    and t.closed_by is not distinct from auth.uid();
$$;

-- Opens tasks for every in-scope answer in use: one per use for due_soon,
-- expired (unless that due date already has an open task) and basis_missing;
-- temporary_until_passed once a temporarily unavailable answer's until has
-- passed; schedule_ended once the schedule in use has ended. Idempotent.
-- Then closes what is satisfied. Returns the number opened.
create function private.knowledge_open_rechecks(p_now timestamptz)
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
    perform private.knowledge_close_rechecks(v_check, null);
  end loop;
  return v_opened;
end;
$$;

-- The hourly job (service role only; app/api/internal/knowledge-rechecks).
create function public.knowledge_run_rechecks()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_open integer;
  v_opened integer;
begin
  v_open := (select count(*) from public.knowledge_recheck_tasks t where t.state = 'open');
  v_opened := private.knowledge_open_rechecks(now());
  return jsonb_build_object('opened', v_opened,
    'closed', v_open + v_opened - (select count(*) from public.knowledge_recheck_tasks t where t.state = 'open'));
end;
$$;

create function private.knowledge_rechecks_on_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision in ('adopted', 'confirmed', 'reaffirmed') then
    perform private.knowledge_close_rechecks(new.check_id, new.id);
  end if;
  return null;
end;
$$;

-- A send adopted at once stores its observation date just after adoption.
create function private.knowledge_rechecks_on_detail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.knowledge_close_rechecks(x.check_id, null)
  from public.knowledge_contributions x where x.id = new.contribution_id;
  return null;
end;
$$;

create trigger knowledge_decisions_rechecks
  after insert on public.knowledge_decisions
  for each row execute function private.knowledge_rechecks_on_decision();
create trigger knowledge_contribution_details_rechecks
  after insert on public.knowledge_contribution_details
  for each row execute function private.knowledge_rechecks_on_detail();

-- ---------------------------------------------------------------------------
-- Reads (A11) and the dry run (§7.3)
-- ---------------------------------------------------------------------------

create function private.knowledge_recheck_json(p_task public.knowledge_recheck_tasks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('taskId', p_task.id, 'checkId', p_task.check_id, 'venueId', p_task.venue_id,
    'questionKey', p_task.question_key, 'question', t.question, 'cause', p_task.cause,
    'use', p_task.use, 'dueAt', p_task.due_at)
  from public.amenity_catalogue t where t.key = p_task.question_key;
$$;

-- The caller's open tasks: on checks assigned to them at their current venue.
create function public.my_rechecks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.knowledge_recheck_json(t) order by t.due_at, t.id)
    from public.knowledge_recheck_tasks t
    join public.venue_amenity_checks c on c.id = t.check_id
    where t.state = 'open' and c.assignee_user_id = v_uid
      and c.venue_id = private.active_staff_venue_id() and c.status = 'active'
  ), '[]'::jsonb));
end;
$$;

-- One check's open tasks: every task for its manager and admins, and for the
-- assignee; otherwise only the count.
create function public.knowledge_check_rechecks(p_check_id uuid)
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
  v_items jsonb;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  v_basis := case when found then private.knowledge_basis(v_check.venue_id) end;
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(private.knowledge_recheck_json(t) order by t.due_at, t.id), '[]'::jsonb)
  into v_items
  from public.knowledge_recheck_tasks t
  where t.check_id = v_check.id and t.state = 'open';
  if v_basis in ('venue_manager', 'admin') or v_check.assignee_user_id = v_uid then
    return jsonb_build_object('count', jsonb_array_length(v_items), 'items', v_items);
  end if;
  return jsonb_build_object('count', jsonb_array_length(v_items), 'items', '[]'::jsonb);
end;
$$;

-- Admin, no write: what naming p_policy ({ internal, public } policy ids) for
-- p_key would do to the answers in use, per venue and use.
create function public.knowledge_freshness_preview(p_key text, p_policy jsonb)
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

-- ---------------------------------------------------------------------------
-- WS4 asks: K2 (A29) and K4 (A31)
-- ---------------------------------------------------------------------------

-- Whether an answer may be illustrated publicly now: the version allows it,
-- the key is not a redaction key, a policy answer is complete, the slot is
-- available, and its public freshness is current, due_soon or unrated.
-- Anything missing reads not eligible, with the first reason.
create function private.knowledge_public_media_eligible(
  p_venue_id uuid, p_question_key text, p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.knowledge_question_versions;
  v_st record;
  v_public text;
begin
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = p_question_key order by v.version desc limit 1;
  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'not_found');
  end if;
  if p_question_key = 'guest_wifi'
     or coalesce((select r.redaction_required from public.knowledge_question_rules r
       where r.question_key = p_question_key order by r.rule_version desc limit 1), false) then
    return jsonb_build_object('eligible', false, 'reason', 'redaction_key');
  end if;
  if v_version.public_media is distinct from 'with_grant' then
    return jsonb_build_object('eligible', false, 'reason', 'not_publishable');
  end if;
  select st.* into v_st from private.knowledge_slot_state_b03(p_venue_id, array[p_question_key], p_now) st;
  if v_st.check_id is null or not v_st.in_scope then
    return jsonb_build_object('eligible', false, 'reason', 'not_found');
  end if;
  if jsonb_array_length(coalesce(v_st.policy_missing, '[]'::jsonb)) > 0 then
    return jsonb_build_object('eligible', false, 'reason', 'policy_incomplete');
  end if;
  if v_st.status <> 'available' then
    return jsonb_build_object('eligible', false, 'reason', 'not_available');
  end if;
  v_public := (select e ->> 'state' from jsonb_array_elements(v_st.freshness) e where e ->> 'use' = 'public');
  if v_public is null or v_public not in ('current', 'due_soon', 'unrated') then
    return jsonb_build_object('eligible', false, 'reason', 'not_fresh');
  end if;
  return jsonb_build_object('eligible', true, 'reason', null);
end;
$$;

-- The set form for WS4's sweep: up to 500 [{ venueId, questionKey }].
create function private.knowledge_public_media_eligible_set(p_pairs jsonb, p_now timestamptz default now())
returns table (venue_id uuid, question_key text, eligible boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs) > 500
     or exists (select 1 from jsonb_array_elements(p_pairs) x
       where jsonb_typeof(x) <> 'object' or x ->> 'venueId' !~ '^[0-9a-f-]{36}$'
         or jsonb_typeof(x -> 'questionKey') is distinct from 'string') then
    raise exception 'invalid_pair_list' using errcode = '22023';
  end if;
  return query
    select (x ->> 'venueId')::uuid, x ->> 'questionKey', (r ->> 'eligible')::boolean, r ->> 'reason'
    from jsonb_array_elements(p_pairs) with ordinality as a(x, o)
    cross join lateral private.knowledge_public_media_eligible((x ->> 'venueId')::uuid, x ->> 'questionKey', p_now) r
    order by o;
end;
$$;

-- An asset's evidence history for the removal view (K4): knowledge
-- evidence_withdrawn events and legacy evidence_lost check events naming it,
-- newest first, with the slot's status now. No person, value or note.
create function private.asset_evidence_events(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(z.item order by z.at desc, z.k desc), '[]'::jsonb)
  from (
    select e.created_at as at, 'k' || e.id::text as k, jsonb_build_object('kind', 'evidence_withdrawn',
        'at', e.created_at, 'venueId', e.venue_id, 'venueName', v.name, 'checkId', e.check_id,
        'questionKey', e.question_key, 'question', t.question, 'slotStatus', st.status) as item
    from public.knowledge_events e
    join public.venues v on v.id = e.venue_id
    join public.amenity_catalogue t on t.key = e.question_key
    cross join lateral private.knowledge_slot_state_b03(e.venue_id, array[e.question_key]) st
    where e.kind = 'evidence_withdrawn' and e.detail ->> 'assetId' = p_asset_id::text
    union all
    select ce.created_at, 'a' || ce.id::text, jsonb_build_object('kind', 'evidence_lost',
        'at', ce.created_at, 'venueId', ce.venue_id, 'venueName', v.name, 'checkId', ce.check_id,
        'questionKey', c.template_key, 'question', t.question, 'slotStatus', st.status)
    from public.amenity_check_events ce
    join public.venue_amenity_checks c on c.id = ce.check_id
    join public.venues v on v.id = ce.venue_id
    join public.amenity_catalogue t on t.key = c.template_key
    cross join lateral private.knowledge_slot_state_b03(ce.venue_id, array[c.template_key]) st
    where ce.kind = 'evidence_lost' and ce.detail ->> 'assetId' = p_asset_id::text
  ) z;
$$;

-- ---------------------------------------------------------------------------
-- Re-created functions
-- ---------------------------------------------------------------------------

-- B03-d body, freshness from the resolver's view (A10).
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
    -- Per use (A10), from the question's freshness policies (§7.3).
    'freshness', st.freshness
  )
  from private.knowledge_slot_state_b03(p_check.venue_id, array[p_check.template_key]) st
  join public.amenity_catalogue t on t.key = p_check.template_key
  left join public.knowledge_contribution_details kd on kd.contribution_id = st.current_contribution_id
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

-- B03-d body, unchanged (re-created after the view it reads).
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

-- B03-c body (K1), freshness from the resolver's view at p_now.
create or replace function private.knowledge_evidence_for_assets(p_asset_ids uuid[], p_now timestamptz)
returns table (
  asset_id uuid, venue_id uuid, check_id uuid, question_key text, role text,
  slot_status text, slot_reason text, freshness jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  return query
    with e as (
      select sa.asset_id, c.venue_id, c.id as check_id, c.template_key as question_key, 'current_answer'::text as role
      from public.amenity_submission_assets sa
      join public.venue_amenity_checks c on c.current_submission_id = sa.submission_id
      where sa.asset_id = any(p_asset_ids)
      union
      select ka.asset_id, x.venue_id, x.check_id, x.question_key, 'pending_finding'
      from public.knowledge_contribution_assets ka
      join public.knowledge_contributions x on x.id = ka.contribution_id
      where ka.asset_id = any(p_asset_ids) and not private.knowledge_is_terminal(x.id)
      union
      select sa.asset_id, s.venue_id, s.check_id, c.template_key, 'earlier_answer'
      from public.amenity_submission_assets sa
      join public.amenity_submissions s on s.id = sa.submission_id
      join public.venue_amenity_checks c on c.id = s.check_id
      where sa.asset_id = any(p_asset_ids) and c.current_submission_id is distinct from s.id
    )
    select e.asset_id, e.venue_id, e.check_id, e.question_key, e.role, st.status, st.reason,
      st.freshness
    from e
    cross join lateral private.knowledge_slot_state_b03(e.venue_id, array[e.question_key], p_now) st
    order by e.asset_id, array_position(array['current_answer', 'pending_finding', 'earlier_answer'], e.role), e.check_id;
end;
$$;

-- B03-c body plus rechecksClosed (A24).
create or replace function public.knowledge_decide(
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
      -- B03-c: an admin rule or an organisation-scope policy needs an admin (§3.2, §5.4).
      if private.knowledge_needs_admin(v_rule, v_contribution.id) and v_basis <> 'admin' then
        raise exception 'not_active_admin' using errcode = '42501';
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
      if private.knowledge_needs_admin(v_rule, v_submission.source_contribution_id) and v_basis <> 'admin' then
        raise exception 'not_active_admin' using errcode = '42501';
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
    'replayed', false,
    -- B03-e (A24): the recheck tasks this decision closed.
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id)
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'decide', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- B03-c body plus rechecksClosed (A24).
create or replace function public.knowledge_resolve_conflict(
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
    -- B03-c: an admin rule or an organisation-scope policy needs an admin (§3.2, §5.4).
    if private.knowledge_needs_admin(v_rule, v_chosen.id) and v_basis <> 'admin' then
      raise exception 'not_active_admin' using errcode = '42501';
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
    'replayed', false,
    -- B03-e (A24): the recheck tasks this decision closed.
    'rechecksClosed', private.knowledge_rechecks_closed_now(v_check.id)
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'resolve_conflict', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- B03-b body; rechecksClosed lists the tasks this send closed (A24).
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
  v_result := public.knowledge_submit(p_check_id, p_slot_revision, p_idempotency_key, p_kind, p_answer,
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

-- B02 body (20261110010123) plus the rechecks queue (§7.4).
create or replace function public.manager_triage_summary(p_venue_id uuid default null)
returns table (
  queue text,
  available boolean,
  waiting integer,
  oldest_waiting_at timestamptz,
  own_waiting integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.manager_read_venue(p_venue_id);
  v_basis text := private.knowledge_basis(v_venue);
  v_confirm jsonb;
begin
  if private.can_manage_venue(v_venue) then
    return query
    select 'menu_photos'::text, true, o.pending_photos, o.oldest_pending_at, o.own_waiting_photos
    from public.manager_menu_photo_overview(v_venue) o;
  else
    return query select 'menu_photos'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  if v_basis in ('venue_manager', 'admin') then
    v_confirm := public.knowledge_to_confirm(v_venue);
    return query
    select 'findings'::text, true, (v_confirm ->> 'count')::integer,
      (select min((i ->> 'waitingSince')::timestamptz) from jsonb_array_elements(v_confirm -> 'items') i),
      null::integer;
  else
    return query select 'findings'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  -- Checklist review is closed to manager accounts (the coverage manager-deny
  -- triggers). The oldest time uses the pending predicate of
  -- venue_coverage_summary, which has no oldest column.
  if private.can_manage_venue(v_venue) and not private.is_active_manager() then
    return query
    select 'checklist'::text, true, s.pending_review_count, (
        select min(i.submitted_at)
        from public.coverage_submission_items i
        join public.media_assets a on a.id = i.asset_id
        where i.venue_id = v_venue and i.state = 'submitted'
          and a.upload_state = 'ready' and a.deleted_at is null
      ), null::integer
    from public.venue_coverage_summary(v_venue) s;
  else
    return query select 'checklist'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  -- B03-e (§7.4): open recheck tasks at the venue, oldest due first.
  if v_basis in ('venue_manager', 'admin') then
    return query
    select 'rechecks'::text, true, count(*)::integer, min(t.due_at), null::integer
    from public.knowledge_recheck_tasks t
    where t.venue_id = v_venue and t.state = 'open';
  else
    return query select 'rechecks'::text, false, null::integer, null::timestamptz, null::integer;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_freshness_entry(text, interval, interval, text, date, timestamptz, timestamptz, text),
  private.knowledge_slot_freshness(uuid, text, uuid, text, jsonb, date, timestamptz),
  private.knowledge_slot_state_b03(uuid, text[], timestamptz),
  private.knowledge_recheck_tasks_guard(),
  private.knowledge_close_rechecks(uuid, uuid),
  private.knowledge_rechecks_closed_now(uuid),
  private.knowledge_open_rechecks(timestamptz),
  private.knowledge_rechecks_on_decision(),
  private.knowledge_rechecks_on_detail(),
  private.knowledge_recheck_json(public.knowledge_recheck_tasks),
  private.knowledge_public_media_eligible(uuid, text, timestamptz),
  private.knowledge_public_media_eligible_set(jsonb, timestamptz),
  private.asset_evidence_events(uuid),
  private.knowledge_slot_json(public.venue_amenity_checks, uuid, text),
  private.knowledge_evidence_for_assets(uuid[], timestamptz)
from public, anon, authenticated;

revoke all on function public.knowledge_run_rechecks() from public, anon, authenticated;
grant execute on function public.knowledge_run_rechecks() to service_role;

revoke all on function
  public.my_rechecks(),
  public.knowledge_check_rechecks(uuid),
  public.knowledge_freshness_preview(text, jsonb),
  public.knowledge_check(uuid),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean, jsonb, date, text),
  public.manager_triage_summary(uuid)
from public, anon, service_role;

grant execute on function
  public.my_rechecks(),
  public.knowledge_check_rechecks(uuid),
  public.knowledge_freshness_preview(text, jsonb),
  public.knowledge_check(uuid),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean, jsonb, date, text),
  public.manager_triage_summary(uuid)
to authenticated;
