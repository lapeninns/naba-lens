-- G-0 (docs/plans/goals-not-tasks.md): ORP-3a's menu settlement applied to
-- coverage_staff_progress_v2. 20261115110000_menu_settles_submissions.sql
-- redefined only v1; v2 (20261109120000_venue_monthly_completion_targets.sql)
-- still counted a submitted item that a menu decision had settled as pending.
-- Read-through, as ORP-1 and ORP-3a: no rows change and no write path
-- changes. The body is v2's, with one change: pending leaves out items for
-- which private.menu_settled is true. Signature, return columns and grants
-- are unchanged.

create or replace function public.coverage_staff_progress_v2(
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
      (count(*) filter (where i.state = 'submitted'
        and not private.menu_settled(i.asset_id, i.requirement_id, i.venue_id)))::integer as pending,
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
