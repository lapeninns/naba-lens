-- G-6 (docs/plans/goals-not-tasks.md, decisions 3, 16 and 17; v0.5 rules 23
-- and 26): a venue default monthly photo target, and manager target writes.
--
-- 1. private.venue_default_photo_targets: each venue's default number of
--    accepted photos per person per month. Insert-only and dated, like the
--    completion policy, so every change stays readable. It is separate from
--    private.venue_monthly_completion_targets (dishes and checks), which this
--    migration does not touch.
-- 2. monthly_targets gains the source 'venue_default'. Precedence for a
--    person's month: their own manager-set number, then the venue default,
--    then Needs setup (a placeholder).
-- 3. Rollover copies only manager-set numbers ('manager', 'admin_correction'
--    and copies of them). A month that took the default is never copied; the
--    next month takes the venue's default as it is then.
-- 4. A narrow own-venue exception to deny_manager_coverage_writes on
--    monthly_targets only. Every other legacy coverage table keeps the
--    blanket denial (requirements, assignees, facts, plans, submissions,
--    reviews, preparation runs), so a manager account still cannot run
--    preparation.
--
-- No row is deleted or rewritten. Existing monthly_targets rows keep their
-- source; preparation upgrades a current-month placeholder only when there is
-- now a number to give it.

-- ---------------------------------------------------------------------------
-- Venue default
-- ---------------------------------------------------------------------------

create table private.venue_default_photo_targets (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  -- 1, 2, 3... per venue; compare-and-set for the team screen.
  revision integer not null check (revision >= 1),
  -- The London month the row applies from.
  starts_on date not null check (extract(day from starts_on) = 1),
  -- NULL: the default was cleared; people without their own number are
  -- Needs setup again.
  target_count integer check (target_count between 1 and 500),
  reason text check (reason is null or length(reason) between 1 and 500),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint venue_default_photo_targets_revision_key unique (venue_id, revision)
);

alter table private.venue_default_photo_targets enable row level security;
revoke all on table private.venue_default_photo_targets
  from public, anon, authenticated, service_role;

create trigger venue_default_photo_targets_immutable
  before update or delete on private.venue_default_photo_targets
  for each row execute function private.immutable_row_guard();

comment on table private.venue_default_photo_targets is
  'Venue default monthly photo target (accepted photos per person). Insert-only; the latest row for a venue that starts on or before a month applies. No direct client access.';

-- The default that applies to a London month, or NULL.
create function private.venue_default_photo_target(p_venue_id uuid, p_period_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select d.target_count
  from private.venue_default_photo_targets d
  where d.venue_id = p_venue_id and d.starts_on <= p_period_month
  order by d.starts_on desc, d.revision desc
  limit 1;
$$;

revoke all on function private.venue_default_photo_target(uuid, date)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- monthly_targets: the 'venue_default' source
-- ---------------------------------------------------------------------------

alter table public.monthly_targets drop constraint monthly_targets_source_check;
alter table public.monthly_targets add constraint monthly_targets_source_check
  check (source in ('manager', 'copied', 'placeholder', 'admin_correction', 'venue_default'));

alter table public.coverage_audit_events drop constraint coverage_audit_events_entity_check;
alter table public.coverage_audit_events add constraint coverage_audit_events_entity_check
  check (entity in (
    'manager_grant', 'requirement', 'assignment', 'monthly_target',
    'amenity_fact', 'menu_plan', 'preparation', 'account_role',
    'venue_default_target'
  ));

-- New rows that took the venue default. already_present stays the rest.
alter table public.coverage_preparation_runs
  add column targets_defaulted integer not null default 0 check (targets_defaulted >= 0);

-- ---------------------------------------------------------------------------
-- The manager exception, monthly_targets only
-- ---------------------------------------------------------------------------

-- A manager account may write a monthly target at the venue it manages now,
-- for the current or a later month, from the manager-side sources. Admin
-- corrections and past months stay admin-only, and another venue is refused
-- as before. authenticated has no table grant, so this applies to the
-- security definer RPCs (set_monthly_target, set_venue_default_target).
create function private.deny_manager_monthly_target_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.is_active_manager()) and not (
    new.venue_id = (select private.my_manager_venue_id())
    and new.period_month >= private.current_london_month()
    and new.source in ('manager', 'venue_default', 'copied', 'placeholder')
  ) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.deny_manager_monthly_target_writes() from public, anon;
grant execute on function private.deny_manager_monthly_target_writes() to authenticated, service_role;

drop trigger monthly_targets_deny_manager_writes on public.monthly_targets;
create trigger monthly_targets_deny_manager_writes
  before insert or update on public.monthly_targets
  for each row execute function private.deny_manager_monthly_target_writes();

-- ---------------------------------------------------------------------------
-- Giving people their month's target
-- ---------------------------------------------------------------------------

-- For active staff at the venue(s) in scope: add a row for anyone without
-- one this month (their latest manager-set number at this venue, else the
-- venue default, else a placeholder), then give a current placeholder a
-- number if one now exists. Idempotent: a second run adds and changes
-- nothing. Callers hold the month's preparation lock (taken here as well;
-- it is re-entrant).
create function private.apply_monthly_targets(p_venue_id uuid, p_month date, p_actor uuid)
returns table (copied integer, defaulted integer, placeholders integer, upgraded integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform pg_advisory_xact_lock(hashtextextended('nabalens_coverage_prepare:' || p_month::text, 0));

  return query
  with roster as (
    select p.id as staff_id, p.venue_id
    from public.profiles p
    join public.venues v on v.id = p.venue_id and v.active
    where p.active and p.role = 'staff'
      and (p_venue_id is null or p.venue_id = p_venue_id)
  ),
  sources as (
    select r.staff_id, r.venue_id, own.id as own_id, own.target_count as own_count,
      private.venue_default_photo_target(r.venue_id, p_month) as default_count,
      cur.id as cur_id, cur.source as cur_source
    from roster r
    left join public.monthly_targets cur
      on cur.staff_id = r.staff_id and cur.venue_id = r.venue_id and cur.period_month = p_month
    -- The person's own number: never a month that took the default, never
    -- another venue's.
    left join lateral (
      select t.id, t.target_count
      from public.monthly_targets t
      where t.staff_id = r.staff_id and t.venue_id = r.venue_id
        and t.period_month < p_month and t.target_count is not null
        and t.source in ('manager', 'admin_correction', 'copied')
      order by t.period_month desc
      limit 1
    ) own on true
    where cur.id is null or cur.source = 'placeholder'
  ),
  added as (
    insert into public.monthly_targets as t
      (staff_id, venue_id, period_month, target_count, due_on, source,
       copied_from_target_id, created_by, updated_by)
    select s.staff_id, s.venue_id, p_month, coalesce(s.own_count, s.default_count),
      (p_month + interval '1 month')::date - 1,
      case when s.own_id is not null then 'copied'
        when s.default_count is not null then 'venue_default'
        else 'placeholder' end,
      s.own_id, p_actor, p_actor
    from sources s
    where s.cur_id is null
    on conflict on constraint monthly_targets_period_key do nothing
    returning t.id, t.venue_id, t.staff_id, t.source, t.target_count
  ),
  raised as (
    update public.monthly_targets t
    set target_count = coalesce(s.own_count, s.default_count),
        source = case when s.own_id is not null then 'copied' else 'venue_default' end,
        copied_from_target_id = s.own_id,
        updated_by = p_actor,
        revision = t.revision + 1
    from sources s
    where s.cur_id is not null and t.id = s.cur_id and t.source = 'placeholder'
      and coalesce(s.own_count, s.default_count) is not null
    returning t.id, t.venue_id, t.staff_id, t.source, t.target_count
  ),
  -- Data-modifying CTEs always run once, whether or not they are read.
  audited as (
    insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, after)
    select a.venue_id, 'monthly_target', a.id, p_actor,
      private.coverage_actor_role(a.venue_id),
      case a.source when 'copied' then 'copied' when 'venue_default' then 'defaulted' else 'prepared' end,
      jsonb_build_object('staffId', a.staff_id, 'month', p_month, 'target', a.target_count, 'source', a.source)
    from added a
    union all
    select u.venue_id, 'monthly_target', u.id, p_actor,
      private.coverage_actor_role(u.venue_id),
      'updated',
      jsonb_build_object('staffId', u.staff_id, 'month', p_month, 'target', u.target_count, 'source', u.source)
    from raised u
  )
  select
    (select count(*) from added a where a.source = 'copied')::integer,
    (select count(*) from added a where a.source = 'venue_default')::integer,
    (select count(*) from added a where a.source = 'placeholder')::integer,
    (select count(*) from raised)::integer;
end;
$$;

revoke all on function private.apply_monthly_targets(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function private.apply_monthly_targets(uuid, date, uuid) to service_role;

-- Body as in 20261102150000, with the targets step moved into
-- private.apply_monthly_targets and the defaulted count recorded.
create or replace function private.prepare_coverage_month(p_venue_id uuid, p_trigger text, p_actor uuid)
returns setof public.coverage_preparation_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_month date := private.current_london_month();
  v_started timestamptz := clock_timestamp();
  v_considered integer := 0;
  v_copied integer := 0;
  v_defaulted integer := 0;
  v_placeholders integer := 0;
  v_candidates integer := 0;
  v_venue_id uuid;
  v_code text;
  v_message text;
  v_run public.coverage_preparation_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended('nabalens_coverage_prepare:' || v_month::text, 0));

  begin
    -- Venue locks in id order. set_venue_default_target also takes this
    -- month lock, first, and takes no venue lock.
    for v_venue_id in
      select v.id from public.venues v
      where v.active and (p_venue_id is null or v.id = p_venue_id)
      order by v.id
    loop
      v_candidates := v_candidates + private.add_coverage_candidates(v_venue_id, p_actor);
    end loop;

    select count(*)::integer into v_considered
    from public.profiles p
    join public.venues v on v.id = p.venue_id and v.active
    where p.active and p.role = 'staff' and (p_venue_id is null or p.venue_id = p_venue_id);

    select a.copied, a.defaulted, a.placeholders
    into v_copied, v_defaulted, v_placeholders
    from private.apply_monthly_targets(p_venue_id, v_month, p_actor) a;

    insert into public.coverage_preparation_runs as r (
      period_month, run_trigger, scope_venue_id, requested_by, started_at, finished_at, status,
      staff_considered, targets_copied, targets_defaulted, placeholders_created, already_present,
      candidates_added
    )
    values (
      v_month, p_trigger, p_venue_id, p_actor, v_started, clock_timestamp(), 'succeeded',
      v_considered, v_copied, v_defaulted, v_placeholders,
      greatest(v_considered - v_copied - v_defaulted - v_placeholders, 0),
      v_candidates
    )
    returning r.* into v_run;
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate, v_message = message_text;
    insert into public.coverage_preparation_runs as r (
      period_month, run_trigger, scope_venue_id, requested_by, started_at, finished_at, status,
      staff_considered, error_code, error_message
    )
    values (
      v_month, p_trigger, p_venue_id, p_actor, v_started, clock_timestamp(), 'failed',
      0, v_code, left(coalesce(nullif(v_message, ''), 'unknown'), 500)
    )
    returning r.* into v_run;
  end;

  perform private.coverage_audit(p_venue_id, 'preparation', v_run.id, v_run.status, null, null,
    jsonb_build_object('month', v_month, 'trigger', p_trigger, 'copied', v_run.targets_copied,
      'defaulted', v_run.targets_defaulted,
      'placeholders', v_run.placeholders_created, 'candidates', v_run.candidates_added,
      'errorCode', v_run.error_code));
  return next v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: read and set the venue default
-- ---------------------------------------------------------------------------

-- The venue's current default (one row), or no row when it was never set.
-- The venue manager and admins only.
create function public.venue_default_target(p_venue_id uuid)
returns table (
  revision integer,
  target_count integer,
  starts_on date,
  set_at timestamptz,
  set_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_can_manage_venue(p_venue_id);
  return query
  select d.revision, d.target_count, d.starts_on, d.created_at, d.created_by
  from private.venue_default_photo_targets d
  where d.venue_id = p_venue_id
  order by d.revision desc
  limit 1;
end;
$$;

-- Sets (or, with NULL, clears) the venue's default from the current London
-- month. Changing or clearing a set default needs a reason (v0.5 rule 23).
-- This month's rows follow at once: people on the default get the new number
-- (or Needs setup when cleared), placeholders and anyone without a row get it
-- too, and people with their own number keep it.
create function public.set_venue_default_target(
  p_venue_id uuid,
  p_target_count integer,
  p_reason text default null,
  p_expected_revision integer default null
)
returns table (revision integer, target_count integer, starts_on date, applied integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_month date := private.current_london_month();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_current private.venue_default_photo_targets;
  v_row private.venue_default_photo_targets;
  v_changed integer := 0;
  v_added integer := 0;
begin
  if p_target_count is not null and p_target_count not between 1 and 500 then
    raise exception 'invalid_target_count' using errcode = '22023';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_inactive' using errcode = 'P0001';
  end if;

  -- The same lock as preparation: no run can add rows from the old default
  -- while this one changes it.
  perform pg_advisory_xact_lock(hashtextextended('nabalens_coverage_prepare:' || v_month::text, 0));

  select d.* into v_current
  from private.venue_default_photo_targets d
  where d.venue_id = p_venue_id
  order by d.revision desc
  limit 1;

  if v_current.revision is distinct from p_expected_revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_current.revision, 'state', null)::text;
  end if;
  if v_current.target_count is not distinct from p_target_count then
    revision := v_current.revision;
    target_count := v_current.target_count;
    starts_on := v_current.starts_on;
    applied := 0;
    return next;
    return;
  end if;
  if v_current.target_count is not null then
    v_reason := private.require_reason(p_reason);
  end if;

  insert into private.venue_default_photo_targets as d
    (venue_id, revision, starts_on, target_count, reason, created_by)
  values (p_venue_id, coalesce(v_current.revision, 0) + 1, v_month, p_target_count, v_reason, v_uid)
  returning d.* into v_row;

  perform private.coverage_audit(p_venue_id, 'venue_default_target', v_row.id,
    case when p_target_count is null then 'cleared'
      when v_current.revision is null then 'created' else 'updated' end,
    v_reason,
    case when v_current.revision is not null
      then jsonb_build_object('target', v_current.target_count, 'startsOn', v_current.starts_on) end,
    jsonb_build_object('target', p_target_count, 'startsOn', v_month));

  -- This month's rows that took the default follow it.
  with moved as (
    update public.monthly_targets t
    set target_count = p_target_count,
        source = case when p_target_count is null then 'placeholder' else 'venue_default' end,
        updated_by = v_uid,
        revision = t.revision + 1
    from public.profiles p
    where t.venue_id = p_venue_id and t.period_month = v_month and t.source = 'venue_default'
      and p.id = t.staff_id and p.active and p.role = 'staff' and p.venue_id = p_venue_id
    returning t.id, t.staff_id, t.source, t.target_count
  ),
  audited as (
    insert into public.coverage_audit_events
      (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
    select p_venue_id, 'monthly_target', m.id, v_uid, private.coverage_actor_role(p_venue_id),
      'updated', v_reason,
      jsonb_build_object('staffId', m.staff_id, 'month', v_month, 'target', m.target_count, 'source', m.source)
    from moved m
  )
  select count(*)::integer into v_changed from moved;

  select a.copied + a.defaulted + a.placeholders + a.upgraded into v_added
  from private.apply_monthly_targets(p_venue_id, v_month, v_uid) a;

  revision := v_row.revision;
  target_count := v_row.target_count;
  starts_on := v_row.starts_on;
  applied := v_changed + v_added;
  return next;
end;
$$;

revoke all on function
  public.venue_default_target(uuid),
  public.set_venue_default_target(uuid, integer, text, integer)
from public, anon;
grant execute on function
  public.venue_default_target(uuid),
  public.set_venue_default_target(uuid, integer, text, integer)
to authenticated, service_role;
