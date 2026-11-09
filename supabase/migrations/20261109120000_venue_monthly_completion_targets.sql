-- Opt-in monthly target based on distinct menu items and amenity checks.
-- No venue is enrolled by this migration. Set a venue's policy with a dated
-- row; a later row with a NULL target_count restores the photo-based target
-- from that month without rewriting prior periods.
create table private.venue_monthly_completion_targets (
  venue_id uuid not null references public.venues (id) on delete restrict,
  starts_on date not null check (extract(day from starts_on) = 1),
  target_count integer check (target_count between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (venue_id, starts_on)
);

alter table private.venue_monthly_completion_targets enable row level security;
revoke all on table private.venue_monthly_completion_targets
  from public, anon, authenticated, service_role;

comment on table private.venue_monthly_completion_targets is
  'Administrator-operated venue policy effective from a London month. No direct client access. NULL target_count switches back to accepted-photo targets.';

-- Keep actual venue membership dates. The legacy progress read projects the
-- current roster into every month; it cannot establish past participation.
-- Start recording at migration time, without guessing earlier join dates.
create table private.completion_staff_venue_memberships (
  staff_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz check (ended_at >= started_at),
  primary key (staff_id, started_at)
);

create unique index completion_staff_one_current_membership_idx
  on private.completion_staff_venue_memberships (staff_id) where ended_at is null;
create index completion_staff_membership_venue_start_idx
  on private.completion_staff_venue_memberships (venue_id, started_at);

alter table private.completion_staff_venue_memberships enable row level security;
revoke all on table private.completion_staff_venue_memberships
  from public, anon, authenticated, service_role;

create function private.track_completion_staff_venue_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    if old.active = new.active and old.role = new.role
        and old.venue_id is not distinct from new.venue_id then
      return null;
    end if;
    -- A single transaction can update a profile more than once. Ensure a
    -- distinct and increasing timestamp even on a coarse system clock.
    select greatest(v_at, max(m.started_at) + interval '1 microsecond')
      into v_at
    from private.completion_staff_venue_memberships m where m.staff_id = old.id;
    update private.completion_staff_venue_memberships m
    set ended_at = v_at where m.staff_id = old.id and m.ended_at is null;
  end if;

  if new.active and new.role = 'staff' and new.venue_id is not null then
    insert into private.completion_staff_venue_memberships (staff_id, venue_id, started_at)
    values (new.id, new.venue_id, v_at);
  end if;
  return null;
end;
$$;

revoke all on function private.track_completion_staff_venue_membership()
  from public, anon, authenticated, service_role;

create trigger profiles_track_completion_staff_venue_membership
  after insert or update of active, role, venue_id on public.profiles
  for each row execute function private.track_completion_staff_venue_membership();

insert into private.completion_staff_venue_memberships (staff_id, venue_id, started_at)
select p.id, p.venue_id, clock_timestamp()
from public.profiles p where p.active and p.role = 'staff' and p.venue_id is not null;

create function private.venue_monthly_completion_target(p_venue_id uuid, p_period_month date)
returns integer
language sql
stable
set search_path = ''
as $$
  select p.target_count
  from private.venue_monthly_completion_targets p
  where p.venue_id = p_venue_id and p.starts_on <= p_period_month
  order by p.starts_on desc
  limit 1;
$$;

revoke all on function private.venue_monthly_completion_target(uuid, date)
  from public, anon, authenticated, service_role;

-- The Coverage history cards retain photo eligibility metadata. Return the
-- opted-in subset of requested months so they can label historical work
-- accurately, without exposing the venue policy table or another person's
-- work. Staff can look up an earlier venue for their own records only.
create function public.coverage_completion_target_periods(p_venue_id uuid, p_period_months date[])
returns date[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m.month order by m.month), '{}'::date[])
  from unnest(p_period_months) m(month)
  where cardinality(p_period_months) <= 101
    and private.is_active_user()
    and extract(day from m.month) = 1
    and (
      private.can_manage_venue(p_venue_id)
      or private.active_staff_venue_id() = p_venue_id
      or exists (
        select 1 from public.monthly_targets t
        where t.staff_id = auth.uid() and t.venue_id = p_venue_id and t.period_month = m.month
      )
      or exists (
        select 1 from public.coverage_submission_items i
        where i.author_id = auth.uid() and i.venue_id = p_venue_id and i.submitted_month = m.month
      )
      or exists (
        select 1 from private.completion_staff_venue_memberships h
        where h.staff_id = auth.uid() and h.venue_id = p_venue_id
          and h.started_at < private.london_month_end(m.month)
          and (h.ended_at is null or h.ended_at > private.london_month_start(m.month))
      )
    )
    and private.venue_monthly_completion_target(p_venue_id, m.month) is not null;
$$;

revoke all on function public.coverage_completion_target_periods(uuid, date[])
  from public, anon, authenticated, service_role;
grant execute on function public.coverage_completion_target_periods(uuid, date[])
  to authenticated;

create index menu_item_photo_events_completion_credit_idx
  on public.menu_item_photo_events (venue_id, author_id, created_at)
  where action = 'accepted';

create index amenity_submissions_completion_credit_idx
  on public.amenity_submissions (venue_id, submitted_by, created_at);

-- Call only for venue/staff pairs already authorized by coverage_staff_progress.
-- Decisions are evaluated as of the end of the requested month, or now if it
-- has not ended. Reopening or withdrawing work within the month removes its
-- credit until it is completed again. Changes in later months do not rewrite
-- earlier progress.
create function private.monthly_venue_completion_counts(
  p_venue_id uuid, p_staff_id uuid, p_period_month date
)
returns table (menu_items_completed integer, amenity_checks_completed integer)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select private.london_month_start(p_period_month) as month_start,
      private.london_month_end(p_period_month) as month_end
  )
  select (
    select count(distinct e.item_id)::integer
    from public.menu_item_photo_events e
    cross join bounds b
    join public.media_assets a on a.id = e.asset_id and a.venue_id = e.venue_id
    join lateral (
      select x.id
      from public.menu_item_photo_events x
      where x.photo_id = e.photo_id
        and x.created_at < b.month_end
        and x.created_at <= now()
        and x.action in ('accepted', 'better_photo_requested', 'withdrawn', 'invalidated', 'needs_recheck')
      order by x.id desc
      limit 1
    ) last_decision on last_decision.id = e.id
    where e.venue_id = p_venue_id and e.author_id = p_staff_id
      and e.action = 'accepted'
      and e.created_at >= b.month_start
      and e.created_at < b.month_end
      and e.created_at <= now()
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= b.month_end or a.deleted_at > now())
  ), (
    select count(distinct s.check_id)::integer
    from public.amenity_submissions s
    cross join bounds b
    join lateral (
      select e.kind, e.detail
      from public.amenity_check_events e
      where e.check_id = s.check_id
        and e.created_at < b.month_end
        and e.created_at <= now()
        and e.kind in ('submitted', 'reopened', 'evidence_lost')
      order by e.id desc
      limit 1
    ) last_progress on last_progress.kind = 'submitted'
      and last_progress.detail ->> 'submissionId' = s.id::text
    left join lateral (
      select e.kind
      from public.amenity_check_events e
      where e.check_id = s.check_id
        and e.created_at < b.month_end
        and e.created_at <= now()
        and e.kind in ('archived', 'restored')
      order by e.id desc
      limit 1
    ) last_lifecycle on true
    where s.venue_id = p_venue_id and s.submitted_by = p_staff_id
      and s.created_at >= b.month_start
      and s.created_at < b.month_end
      and s.created_at <= now()
      and last_lifecycle.kind is distinct from 'archived'
  );
$$;

revoke all on function private.monthly_venue_completion_counts(uuid, uuid, date)
  from public, anon, authenticated, service_role;

-- Preserve the old RPC for already deployed clients. v2 applies the same
-- roster authorization, adding genuine participation rows for opted-in
-- former venue members. Photo columns remain photo counts.
create function public.coverage_staff_progress_v2(
  p_venue_id uuid default null,
  p_period_month date default null,
  p_staff_id uuid default null
)
returns table (
  staff_id uuid,
  display_name text,
  avatar_path text,
  department text,
  job_title text,
  venue_id uuid,
  venue_name text,
  period_month date,
  is_current_member boolean,
  is_manager boolean,
  target_id uuid,
  target_count integer,
  target_revision integer,
  target_source text,
  due_on date,
  accepted_count integer,
  late_accepted_count integer,
  pending_count integer,
  needs_another_photo_count integer,
  evidence_removed_count integer,
  needs_setup boolean,
  setup_missing text[],
  complete boolean,
  overdue boolean,
  target_basis text,
  menu_items_completed integer,
  amenity_checks_completed integer,
  completion_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_month date := coalesce(p_period_month, private.current_london_month());
  v_start timestamptz;
  v_end timestamptz;
  v_today date := private.london_today();
  v_venue uuid := p_venue_id;
  v_staff uuid := p_staff_id;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if extract(day from v_month) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_start := private.london_month_start(v_month);
  v_end := private.london_month_end(v_month);

  if private.is_active_admin() then
    null;
  elsif p_venue_id is not null and private.can_manage_venue(p_venue_id) then
    null;
  elsif p_staff_id is null or p_staff_id = v_uid then
    v_staff := v_uid;
  else
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  return query
  with participants as materialized (
    -- Membership overlaps this London month, including mid-month transfers.
    select m.staff_id, m.venue_id
    from private.completion_staff_venue_memberships m
    where m.started_at < v_end and (m.ended_at is null or m.ended_at > v_start)
      and (v_venue is null or m.venue_id = v_venue)
      and (v_staff is null or m.staff_id = v_staff)
      and private.venue_monthly_completion_target(m.venue_id, v_month) is not null
    union
    -- Legacy monthly target creation in its own period also records
    -- participation before membership intervals began. A later historical
    -- correction or a target set in advance is not evidence of membership.
    select t.staff_id, t.venue_id
    from public.monthly_targets t
    where t.period_month = v_month and t.created_at >= v_start and t.created_at < v_end
      and (v_venue is null or t.venue_id = v_venue)
      and (v_staff is null or t.staff_id = v_staff)
      and private.venue_monthly_completion_target(t.venue_id, v_month) is not null
  ),
  keys as (
    select p.id as k_staff, p.venue_id as k_venue
    from public.profiles p
    where p.active and p.role = 'staff' and p.venue_id is not null
      and (v_venue is null or p.venue_id = v_venue)
      and (v_staff is null or p.id = v_staff)
    union
    select t.staff_id, t.venue_id
    from public.monthly_targets t
    where t.period_month = v_month
      and (v_venue is null or t.venue_id = v_venue)
      and (v_staff is null or t.staff_id = v_staff)
    union
    select p.staff_id, p.venue_id from participants p
  ),
  credit as (
    select c.author_id as c_staff, c.venue_id as c_venue,
      (count(distinct c.asset_id))::integer as accepted,
      (count(distinct c.asset_id) filter (where c.decided_at >= v_end))::integer as late,
      (count(distinct c.asset_id) filter (where c.evidence_removed))::integer as removed
    from private.monthly_credit_items(v_month) c
    where (v_venue is null or c.venue_id = v_venue) and (v_staff is null or c.author_id = v_staff)
    group by c.author_id, c.venue_id
  ),
  open_items as (
    select i.author_id as o_staff, i.venue_id as o_venue,
      (count(*) filter (where i.state = 'submitted'))::integer as pending,
      -- An archived request (its task retired or reconciled) cannot be answered.
      (count(*) filter (
        where i.state = 'needs_another_photo' and i.archived_at is null and rp.replaced is null))::integer as needs_another
    from public.coverage_submission_items i
    left join lateral (
      select true as replaced
      from public.coverage_submission_items n
      where n.replaces_item_id = i.id
      limit 1
    ) rp on true
    where i.submitted_month = v_month and i.submitted_by = i.author_id and i.origin = 'submitted'
      and (v_venue is null or i.venue_id = v_venue) and (v_staff is null or i.author_id = v_staff)
    group by i.author_id, i.venue_id
  ),
  joined as (
    select k.k_staff, k.k_venue, p.display_name as r_name, p.avatar_path as r_avatar,
      p.department as r_department, p.job_title as r_title, v.name as r_venue_name,
      (p.active and p.role = 'staff' and p.venue_id = k.k_venue) as r_current,
      coalesce(private.effective_manager_venue_id(p.id) = k.k_venue, false) as r_manager,
      t.id as r_target_id, t.target_count as r_target, t.revision as r_target_revision,
      t.source as r_source, t.due_on as r_due,
      coalesce(c.accepted, 0) as r_accepted, coalesce(c.late, 0) as r_late,
      coalesce(o.pending, 0) as r_pending, coalesce(o.needs_another, 0) as r_needs_another,
      coalesce(c.removed, 0) as r_removed,
      case when h.staff_id is not null
        then private.venue_monthly_completion_target(k.k_venue, v_month) end as r_policy
    from keys k
    join public.profiles p on p.id = k.k_staff
    join public.venues v on v.id = k.k_venue
    left join public.monthly_targets t
      on t.staff_id = k.k_staff and t.venue_id = k.k_venue and t.period_month = v_month
    left join participants h on h.staff_id = k.k_staff and h.venue_id = k.k_venue
    left join credit c on c.c_staff = k.k_staff and c.c_venue = k.k_venue
    left join open_items o on o.o_staff = k.k_staff and o.o_venue = k.k_venue
  ),
  progress as materialized (
    select r.*,
      (v_month + interval '1 month')::date - 1 as month_due,
      coalesce(c.menu_items_completed, 0) as menu_count,
      coalesce(c.amenity_checks_completed, 0) as amenity_count
    from joined r
    left join lateral (
      select c.*
      from private.monthly_venue_completion_counts(r.k_venue, r.k_staff, v_month) c
      where r.r_policy is not null
    ) c on true
  ),
  effective as (
    select r.*,
      case when r.r_policy is null then r.r_due else r.month_due end as target_due,
      case when r.r_policy is not null then r.menu_count + r.amenity_count >= r.r_policy
        else r.r_department is not null and r.r_target is not null and r.r_accepted >= r.r_target
      end as target_met
    from progress r
  )
  select r.k_staff, r.r_name, r.r_avatar, r.r_department, r.r_title, r.k_venue, r.r_venue_name, v_month,
    r.r_current, r.r_manager,
    case when r.r_policy is null then r.r_target_id end,
    coalesce(r.r_policy, r.r_target),
    case when r.r_policy is null then r.r_target_revision end,
    case when r.r_policy is null then r.r_source end,
    r.target_due,
    r.r_accepted, r.r_late, r.r_pending, r.r_needs_another, r.r_removed,
    (r.r_policy is null and (r.r_department is null or r.r_target is null)),
    case when r.r_policy is null then array_remove(array[
      case when r.r_department is null then 'team' end,
      case when r.r_target is null then 'target' end
    ], null) else '{}'::text[] end,
    r.target_met,
    (not r.target_met and r.target_due is not null and r.target_due < v_today),
    case when r.r_policy is null then 'accepted_photos' else 'menu_items_and_amenities' end,
    r.menu_count, r.amenity_count, r.menu_count + r.amenity_count
  from effective r
  order by r.r_venue_name, r.r_name, r.k_staff;
end;
$$;

revoke all on function public.coverage_staff_progress_v2(uuid, date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.coverage_staff_progress_v2(uuid, date, uuid)
  to authenticated;

comment on function public.coverage_staff_progress_v2(uuid, date, uuid) is
  'Authorized monthly progress with a venue policy for distinct accepted menu items plus completed amenity checks, or legacy photo targets.';

-- Keep group target summaries consistent with the venue's selected target.
-- accepted_photos remains a photo count across all venues.
create or replace function public.coverage_group_overview(p_period_month date default null)
returns table (
  venue_id uuid,
  venue_name text,
  applicable_count integer,
  satisfied_count integer,
  needs_setup_count integer,
  pending_review_count integer,
  overdue_count integer,
  needs_reassignment_count integer,
  amenity_unknown_count integer,
  menu_state text,
  coverage_complete boolean,
  staff_count integer,
  targets_set integer,
  targets_needing_setup integer,
  staff_without_target integer,
  participation_complete integer,
  accepted_photos integer,
  self_review_count integer,
  last_preparation_at timestamptz,
  last_preparation_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month date := coalesce(p_period_month, private.current_london_month());
begin
  perform private.assert_active_admin();
  if extract(day from v_month) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  return query
  select s.venue_id, s.venue_name, s.applicable_count, s.satisfied_count, s.needs_setup_count,
    s.pending_review_count, s.overdue_count, s.needs_reassignment_count, s.amenity_unknown_count,
    s.menu_state, s.complete,
    coalesce(pr.staff_count, 0), coalesce(pr.targets_set, 0), coalesce(pr.targets_needing_setup, 0),
    coalesce(pr.without_target, 0), coalesce(pr.done, 0), coalesce(pr.accepted, 0),
    coalesce(sr.n, 0), lr.finished_at, lr.status
  from public.venue_coverage_summary(null) s
  left join lateral (
    select
      (count(*) filter (where g.is_current_member))::integer as staff_count,
      (count(*) filter (where g.target_count is not null))::integer as targets_set,
      (count(*) filter (where g.target_id is not null and g.target_count is null))::integer as targets_needing_setup,
      (count(*) filter (where g.is_current_member and g.target_id is null and g.target_count is null))::integer as without_target,
      (count(*) filter (where g.complete))::integer as done,
      (coalesce(sum(g.accepted_count), 0))::integer as accepted
    from public.coverage_staff_progress_v2(s.venue_id, v_month, null) g
  ) pr on true
  left join lateral (
    select count(*)::integer as n
    from public.coverage_review_events e
    where e.venue_id = s.venue_id and e.self_review
      and e.created_at >= private.london_month_start(v_month)
      and e.created_at < private.london_month_end(v_month)
  ) sr on true
  left join lateral (
    select r.finished_at, r.status
    from public.coverage_preparation_runs r
    where r.period_month = v_month and (r.scope_venue_id is null or r.scope_venue_id = s.venue_id)
    order by r.finished_at desc
    limit 1
  ) lr on true
  order by s.venue_name, s.venue_id;
end;
$$;

-- An opted-in venue already has targets for its entire active staff roster.
create or replace function public.coverage_preparation_status(p_venue_id uuid default null)
returns table (
  period_month date,
  last_run_at timestamptz,
  last_status text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  staff_without_target integer,
  targets_needing_setup integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month date := private.current_london_month();
  v_venue uuid := p_venue_id;
begin
  if not private.is_active_admin() then
    if v_venue is null then
      v_venue := private.my_manager_venue_id();
    end if;
    perform private.assert_can_manage_venue(v_venue);
  end if;

  return query
  with runs as (
    select r.finished_at, r.status, r.error_code
    from public.coverage_preparation_runs r
    where r.period_month = v_month
      and (v_venue is null or r.scope_venue_id is null or r.scope_venue_id = v_venue)
  )
  select v_month,
    (select max(x.finished_at) from runs x),
    (select x.status from runs x order by x.finished_at desc limit 1),
    (select max(x.finished_at) from runs x where x.status = 'succeeded'),
    (select max(x.finished_at) from runs x where x.status = 'failed'),
    (select x.error_code from runs x where x.status = 'failed' order by x.finished_at desc limit 1),
    (select count(*)::integer
      from public.profiles p
      join public.venues v on v.id = p.venue_id and v.active
      where p.active and p.role = 'staff' and (v_venue is null or p.venue_id = v_venue)
        and private.venue_monthly_completion_target(p.venue_id, v_month) is null
        and not exists (
          select 1 from public.monthly_targets t
          where t.staff_id = p.id and t.venue_id = p.venue_id and t.period_month = v_month
        )),
    (select count(*)::integer
      from public.monthly_targets t
      where t.period_month = v_month and t.target_count is null
        and private.venue_monthly_completion_target(t.venue_id, v_month) is null
        and (v_venue is null or t.venue_id = v_venue));
end;
$$;
