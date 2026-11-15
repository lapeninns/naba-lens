-- One review per photo, ORP-3a (docs/plans/one-review-per-photo.md): a menu
-- decision settles a task submission of the same photo. Read-through, as
-- ORP-1: no rows change and no write path changes.
--
-- A submitted, unarchived coverage item is settled when its asset has a live
-- menu item decision (accepted, better_photo_requested or needs_recheck) at
-- its venue for an item that the item's task covers: any item when the
-- submission has no task (monthly only), an entry of the task's section in
-- the task's menu version for a menu_section task, and never for other task
-- kinds. A settled item:
--   * leaves every pending count (requirement_status_rows,
--     venue_coverage_summary, coverage_staff_progress);
--   * reads as accepted in coverage_items_page when the menu accepted it, with
--     the menu reviewer and time, and leaves the reviewer's view otherwise
--     (its author still sees it as submitted).
-- The stored item stays submitted: a reviewer who opens it by id can still
-- decide it, and that decision then wins in every read.
-- Signatures, return columns and grants are unchanged.

-- The live menu decision that settles a submission, accepted first.
create function private.menu_settlement(p_asset_id uuid, p_requirement_id uuid, p_venue_id uuid)
returns table (state text, decided_by uuid, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.state, m.decided_by, m.decided_at
  from public.menu_item_photos m
  where m.asset_id = p_asset_id
    and m.venue_id = p_venue_id
    and m.state in ('accepted', 'better_photo_requested', 'needs_recheck')
    and (
      p_requirement_id is null
      or exists (
        select 1
        from public.coverage_requirements r
        join public.menu_entries me
          on me.version_id = r.menu_version_id
          and me.section_id = r.menu_section_id
          and me.venue_id = r.venue_id
        where r.id = p_requirement_id
          and r.kind = 'menu_section'
          and me.item_id = m.item_id
      )
    )
  order by m.state = 'accepted' desc, m.decided_at desc, m.id
  limit 1;
$$;

create function private.menu_settled(p_asset_id uuid, p_requirement_id uuid, p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.menu_settlement(p_asset_id, p_requirement_id, p_venue_id));
$$;

revoke all on function private.menu_settlement(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.menu_settled(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.menu_settlement(uuid, uuid, uuid) to service_role;
grant execute on function private.menu_settled(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Pending counts
-- ---------------------------------------------------------------------------

create or replace function private.requirement_status_rows(p_venue_id uuid)
returns table (
  requirement_id uuid,
  venue_id uuid,
  kind text,
  status text,
  photo_target integer,
  due_on date,
  menu_plan_status text,
  is_current boolean,
  in_scope boolean,
  accepted_count integer,
  pending_count integer,
  needs_another_photo_count integer,
  evidence_removed_count integer,
  open_assignee_ids uuid[],
  had_departed_assignee boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.venue_id, r.kind, r.status, r.photo_target, r.due_on, mp.status,
    r.status = 'active' and (r.kind <> 'menu_section' or coalesce(mp.status = 'confirmed', false)),
    r.status in ('needs_setup', 'active') and (r.kind <> 'menu_section' or coalesce(mp.status = 'confirmed', false)),
    coalesce(acc.accepted, 0), coalesce(e.pending, 0), coalesce(e.needs_another, 0), coalesce(acc.removed, 0),
    coalesce(asg.ids, '{}'::uuid[]), coalesce(asg.departed, false)
  from public.coverage_requirements r
  left join public.menu_coverage_plans mp on mp.id = r.menu_plan_id
  left join lateral (
    select
      (count(*) filter (
        where i.state = 'submitted' and a.upload_state = 'ready' and a.deleted_at is null
          and not private.menu_settled(i.asset_id, i.requirement_id, i.venue_id)))::integer as pending,
      (count(*) filter (where i.state = 'needs_another_photo' and rp.replaced is null))::integer as needs_another
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    left join lateral (
      select true as replaced
      from public.coverage_submission_items n
      where n.replaces_item_id = i.id
      limit 1
    ) rp on true
    where i.requirement_id = r.id and i.archived_at is null
  ) e on true
  -- Accepted evidence: submitted or attached photos, then (menu sections only)
  -- photos accepted for one of the section's dishes. Distinct assets.
  left join lateral (
    select
      (count(distinct x.asset_id) filter (where x.available))::integer as accepted,
      (count(distinct x.asset_id) filter (where x.removed))::integer as removed
    from (
      select i.asset_id,
        a.upload_state = 'ready' and a.deleted_at is null as available,
        a.deleted_at is not null as removed
      from public.coverage_submission_items i
      join public.media_assets a on a.id = i.asset_id
      where i.requirement_id = r.id and i.archived_at is null and i.state = 'accepted'
      union all
      select m.asset_id,
        a.upload_state = 'ready' and a.deleted_at is null,
        a.deleted_at is not null
      from public.menu_entries me
      join public.menu_item_photos m
        on m.item_id = me.item_id and m.venue_id = me.venue_id and m.state = 'accepted'
      join public.media_assets a on a.id = m.asset_id and a.media_type = 'image'
      where r.kind = 'menu_section'
        and me.version_id = r.menu_version_id
        and me.section_id = r.menu_section_id
        and me.venue_id = r.venue_id
    ) x
  ) acc on true
  left join lateral (
    select
      array_agg(x.staff_id order by x.assigned_at) filter (where x.ended_at is null) as ids,
      bool_or(x.end_kind in ('transferred', 'deactivated')) as departed
    from public.coverage_requirement_assignees x
    where x.requirement_id = r.id
  ) asg on true
  where p_venue_id is null or r.venue_id = p_venue_id;
$$;

create or replace function public.venue_coverage_summary(p_venue_id uuid default null)
returns table (
  venue_id uuid,
  venue_name text,
  venue_active boolean,
  applicable_count integer,
  satisfied_count integer,
  needs_setup_count integer,
  not_applicable_count integer,
  pending_review_count integer,
  overdue_count integer,
  needs_reassignment_count integer,
  amenity_unknown_count integer,
  menu_state text,
  active_menu_version_id uuid,
  current_plan_id uuid,
  draft_plan_id uuid,
  pending_reconciliation_count integer,
  complete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := p_venue_id;
  v_today date := private.london_today();
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if not private.is_active_admin() then
    if v_venue is null then
      v_venue := coalesce(private.my_manager_venue_id(), private.active_staff_venue_id());
    end if;
    if v_venue is null or not (
      private.can_manage_venue(v_venue) or coalesce(private.active_staff_venue_id() = v_venue, false)
    ) then
      raise exception 'not_venue_manager' using errcode = '42501';
    end if;
  end if;

  return query
  select v.id, v.name, v.active,
    coalesce(rq.applicable, 0), coalesce(rq.satisfied, 0), coalesce(rq.needs_setup, 0),
    coalesce(rq.not_applicable, 0), coalesce(pr.pending, 0), coalesce(rq.overdue, 0),
    coalesce(rq.reassign, 0), coalesce(am.unknown, 0),
    ms.menu_state, ms.active_menu_version_id, ms.current_plan_id, ms.draft_plan_id, ms.pending_reconciliation,
    coalesce(rq.applicable, 0) > 0
      and coalesce(rq.satisfied, 0) = coalesce(rq.applicable, 0)
      and coalesce(rq.needs_setup, 0) = 0
      and ms.menu_state in ('current', 'no_menu')
  from public.venues v
  left join lateral (
    select
      (count(*) filter (where x.in_scope))::integer as applicable,
      (count(*) filter (where x.is_current and x.accepted_count >= x.photo_target))::integer as satisfied,
      (count(*) filter (where x.in_scope and x.status = 'needs_setup'))::integer as needs_setup,
      (count(*) filter (where x.status = 'not_applicable'
        and (x.kind <> 'menu_section' or coalesce(x.menu_plan_status = 'confirmed', false))))::integer as not_applicable,
      (count(*) filter (where x.is_current and x.accepted_count < x.photo_target
        and x.due_on is not null and x.due_on < v_today))::integer as overdue,
      (count(*) filter (where x.is_current and x.accepted_count < x.photo_target
        and cardinality(x.open_assignee_ids) = 0 and x.had_departed_assignee))::integer as reassign
    from private.requirement_status_rows(v.id) x
  ) rq on true
  left join lateral (
    select count(*)::integer as pending
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.venue_id = v.id and i.state = 'submitted'
      and a.upload_state = 'ready' and a.deleted_at is null
      and not private.menu_settled(i.asset_id, i.requirement_id, i.venue_id)
  ) pr on true
  left join lateral (
    select count(*)::integer as unknown
    from public.venue_amenity_facts f
    join public.coverage_amenity_templates t on t.key = f.amenity_key and t.active and t.needs_fact
    where f.venue_id = v.id and f.presence = 'unknown'
  ) am on true
  cross join lateral private.venue_menu_state(v.id) ms
  where (v_venue is null and v.active) or v.id = v_venue
  order by v.name, v.id;
end;
$$;

create or replace function public.coverage_staff_progress(
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
  overdue boolean
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
  with keys as (
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
      coalesce(c.removed, 0) as r_removed
    from keys k
    join public.profiles p on p.id = k.k_staff
    join public.venues v on v.id = k.k_venue
    left join public.monthly_targets t
      on t.staff_id = k.k_staff and t.venue_id = k.k_venue and t.period_month = v_month
    left join credit c on c.c_staff = k.k_staff and c.c_venue = k.k_venue
    left join open_items o on o.o_staff = k.k_staff and o.o_venue = k.k_venue
  )
  select r.k_staff, r.r_name, r.r_avatar, r.r_department, r.r_title, r.k_venue, r.r_venue_name, v_month,
    r.r_current, r.r_manager, r.r_target_id, r.r_target, r.r_target_revision, r.r_source, r.r_due,
    r.r_accepted, r.r_late, r.r_pending, r.r_needs_another, r.r_removed,
    (r.r_department is null or r.r_target is null),
    array_remove(array[
      case when r.r_department is null then 'team' end,
      case when r.r_target is null then 'target' end
    ], null),
    (r.r_department is not null and r.r_target is not null and r.r_accepted >= r.r_target),
    (not (r.r_department is not null and r.r_target is not null and r.r_accepted >= r.r_target)
      and r.r_due is not null and r.r_due < v_today)
  from joined r
  order by r.r_venue_name, r.r_name, r.k_staff;
end;
$$;

-- ---------------------------------------------------------------------------
-- Items: the review queue and "my photos"
-- ---------------------------------------------------------------------------

create or replace function public.coverage_items_page(
  p_venue_id uuid default null,
  p_author_id uuid default null,
  p_states text[] default null,
  p_requirement_id uuid default null,
  p_period_month date default null,
  p_after_submitted_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25,
  p_newest_first boolean default false
)
returns table (
  item_id uuid,
  venue_id uuid,
  revision integer,
  state text,
  origin text,
  requirement_id uuid,
  requirement_title text,
  author_id uuid,
  author_name text,
  author_active boolean,
  submitted_by uuid,
  submitted_at timestamptz,
  submitted_month date,
  uploaded_month date,
  monthly_eligible boolean,
  asset_id uuid,
  media_type public.media_type,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer,
  evidence_available boolean,
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  self_review boolean,
  archived boolean,
  replaces_item_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  v_newest boolean := coalesce(p_newest_first, false);
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if not (p_author_id is not null and p_author_id = v_uid)
     and not (p_venue_id is not null and private.can_manage_venue(p_venue_id)) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_states is not null and not (p_states <@ array['submitted', 'accepted', 'needs_another_photo']) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return query
  select i.id, i.venue_id, i.revision,
    case when ms.state = 'accepted' then 'accepted' else i.state end,
    i.origin, i.requirement_id, r.title,
    i.author_id, p.display_name, p.active and p.role = 'staff', i.submitted_by,
    i.submitted_at, i.submitted_month, i.uploaded_month,
    i.origin = 'submitted' and i.submitted_by = i.author_id and i.uploaded_month = i.submitted_month
      and a.media_type = 'image',
    i.asset_id, a.media_type, a.preview_path is not null, a.thumbnail_path is not null,
    a.width, a.height, a.upload_state = 'ready' and a.deleted_at is null,
    i.decision_reason,
    case when ms.state = 'accepted' then ms.decided_by else i.decided_by end,
    case when ms.state = 'accepted' then ms.decided_at else i.decided_at end,
    case when ms.state = 'accepted' then ms.decided_by = i.author_id else i.self_review end,
    i.archived_at is not null,
    i.replaces_item_id
  from public.coverage_submission_items i
  join public.media_assets a on a.id = i.asset_id
  join public.profiles p on p.id = i.author_id
  left join public.coverage_requirements r on r.id = i.requirement_id
  -- ORP-3a: a menu decision on the same photo settles a submitted item.
  left join lateral (
    select s.state, s.decided_by, s.decided_at
    from private.menu_settlement(i.asset_id, i.requirement_id, i.venue_id) s
    where i.state = 'submitted' and i.archived_at is null
  ) ms on true
  where (p_venue_id is null or i.venue_id = p_venue_id)
    and (p_author_id is null or i.author_id = p_author_id)
    and (p_states is null
      or (case when ms.state = 'accepted' then 'accepted' else i.state end) = any(p_states))
    -- Reviewers never see a photo the menu reviewer is still deciding (asked
    -- for another, or recheck); its author still sees it as submitted.
    and (ms.state is null or ms.state = 'accepted' or p_author_id = v_uid)
    and (p_requirement_id is null or i.requirement_id = p_requirement_id)
    and (p_period_month is null or i.submitted_month = p_period_month)
    and (
      p_after_submitted_at is null or p_after_id is null
      or (not v_newest and (i.submitted_at, i.id) > (p_after_submitted_at, p_after_id))
      or (v_newest and (i.submitted_at, i.id) < (p_after_submitted_at, p_after_id))
    )
  order by
    case when v_newest then null else i.submitted_at end asc,
    case when v_newest then null else i.id end asc,
    case when v_newest then i.submitted_at end desc,
    case when v_newest then i.id end desc
  limit v_limit;
end;
$$;
