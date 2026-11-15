-- G-2 (docs/plans/goals-not-tasks.md, decision 13): Your month reads both
-- sources, photos sent to the month or a task and labelled menu photos,
-- through one SQL source. Read-through, in the ORP style: no rows change, no
-- write path changes, and manager accounts stay denied every coverage write.
--
--   private.month_photo_states  one state per (author, venue, month, photo)
--   coverage_staff_progress_v2  pending and needs-another counts read it
--   coverage_staff_progress     the same (v1 and v2 photo counts must agree)
--   public.my_month_photos      the caller's own list, the same rows
--
-- States, in this order of precedence for one photo:
--   accepted             private.monthly_credit_items credits it (ORP-1).
--   needs_another_photo  an open coverage request on an own send in the month
--                        (as v2 counted it before), or a menu "needs another
--                        photo" decision on a still image the uploader
--                        labelled themself, uploaded in the month, until any
--                        photo of the same item at the venue is newly accepted
--                        after the note (decision 4: an `accepted` event;
--                        carried and primary rows do not count).
--   waiting              not credited, and either an own submission that
--                        would earn credit if accepted (a ready still image,
--                        uploaded and sent in the month, not settled by a menu
--                        decision: ORP-3a), or a label tuple waiting in the
--                        menu review queue (private.menu_photo_pending_tuples,
--                        not a recheck) that the uploader added themself, on a
--                        photo uploaded in the month.
-- Photos are counted once whatever they were labelled or sent for. A photo
-- sent in another month than its upload, or labelled by someone else, is in
-- no state: it can earn no credit for its author.
--
-- Changes from 20261115130000 for v1 and v2: pending_count and
-- needs_another_photo_count now count distinct photos in these states.
-- pending no longer counts an item already credited (a labelled photo the
-- menu accepted, also sent to a service task), a video, or a send in another
-- month than the upload; it now counts labelled menu photos waiting for
-- review. Signatures, return columns and grants are unchanged.
--
-- Rollback: re-apply the bodies from 20261115110000 (v1) and 20261115130000
-- (v2), then drop my_month_photos and month_photo_states.

create function private.month_photo_states(
  p_month date,
  p_venue_id uuid default null,
  p_author_id uuid default null
)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  state text,
  decided_at timestamptz,
  decided_by uuid,
  reason text,
  submission_item_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select private.london_month_start(p_month) as m_start,
      private.london_month_end(p_month) as m_end
  ),
  candidates as (
    select c.author_id, c.venue_id, c.asset_id, 1 as rank, 'accepted'::text as state,
      c.decided_at, null::uuid as decided_by, null::text as reason, null::uuid as submission_item_id
    from private.monthly_credit_items(p_month) c
    where (p_venue_id is null or c.venue_id = p_venue_id)
      and (p_author_id is null or c.author_id = p_author_id)

    union all
    -- An open request on an own send in the month. An archived request (its
    -- task retired or reconciled) cannot be answered; nor can one replaced.
    select i.author_id, i.venue_id, i.asset_id, 2, 'needs_another_photo',
      i.decided_at, i.decided_by, i.decision_reason, i.id
    from public.coverage_submission_items i
    where i.submitted_month = p_month and i.submitted_by = i.author_id and i.origin = 'submitted'
      and i.state = 'needs_another_photo' and i.archived_at is null
      and not exists (
        select 1 from public.coverage_submission_items n where n.replaces_item_id = i.id)
      and (p_venue_id is null or i.venue_id = p_venue_id)
      and (p_author_id is null or i.author_id = p_author_id)

    union all
    -- A menu note on the uploader's own labelled photo, until decision 4
    -- clears it.
    select m.author_id, m.venue_id, m.asset_id, 2, 'needs_another_photo',
      m.decided_at, m.decided_by, m.reason, null::uuid
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id
    cross join bounds b
    where m.state = 'better_photo_requested'
      and a.created_at >= b.m_start and a.created_at < b.m_end
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and (p_venue_id is null or m.venue_id = p_venue_id)
      and (p_author_id is null or m.author_id = p_author_id)
      and exists (
        select 1 from public.media_label_items li
        where li.asset_id = m.asset_id and li.item_id = m.item_id
          and li.variant_id is not distinct from m.variant_id
          and li.added_by = m.author_id)
      and not exists (
        select 1 from public.menu_item_photo_events e
        where e.item_id = m.item_id and e.venue_id = m.venue_id
          and e.action = 'accepted' and e.created_at > m.decided_at)

    union all
    -- An own send that would earn credit once accepted, not settled by a
    -- menu decision.
    select i.author_id, i.venue_id, i.asset_id, 3, 'waiting',
      null::timestamptz, null::uuid, null::text, i.id
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.submitted_month = p_month and i.uploaded_month = p_month
      and i.submitted_by = i.author_id and i.origin = 'submitted' and i.state = 'submitted'
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and not private.menu_settled(i.asset_id, i.requirement_id, i.venue_id)
      and (p_venue_id is null or i.venue_id = p_venue_id)
      and (p_author_id is null or i.author_id = p_author_id)

    union all
    -- A label the uploader added themself, waiting in the menu review queue.
    select t.uploader_id, va.venue_id, t.asset_id, 3, 'waiting',
      null::timestamptz, null::uuid, null::text, null::uuid
    from (
      select distinct a.venue_id
      from public.media_assets a
      cross join bounds b
      where a.created_at >= b.m_start and a.created_at < b.m_end
        and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
        and (p_venue_id is null or a.venue_id = p_venue_id)
        and (p_author_id is null or a.uploader_id = p_author_id)
    ) va
    cross join bounds b
    cross join lateral private.menu_photo_pending_tuples(va.venue_id, true) t
    join public.media_label_items li on li.id = t.label_id
    where not t.is_recheck
      and li.added_by = t.uploader_id
      and t.created_at >= b.m_start and t.created_at < b.m_end
      and (p_author_id is null or t.uploader_id = p_author_id)
  )
  select distinct on (c.author_id, c.venue_id, c.asset_id)
    c.author_id, c.venue_id, c.asset_id, c.state, c.decided_at, c.decided_by, c.reason,
    c.submission_item_id
  from candidates c
  order by c.author_id, c.venue_id, c.asset_id, c.rank,
    c.decided_at desc nulls last, c.submission_item_id nulls last;
$$;

revoke all on function private.month_photo_states(date, uuid, uuid) from public, anon, authenticated;
grant execute on function private.month_photo_states(date, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Counts
-- ---------------------------------------------------------------------------

-- v1: as 20261115110000, with open_items read from month_photo_states.
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
    -- G-2: one state per (author, venue, photo), the same rows my_month_photos
    -- lists. Accepted is the credit above; these are the other two states.
    select s.author_id as o_staff, s.venue_id as o_venue,
      (count(*) filter (where s.state = 'waiting'))::integer as pending,
      (count(*) filter (where s.state = 'needs_another_photo'))::integer as needs_another
    from private.month_photo_states(v_month, v_venue, v_staff) s
    group by s.author_id, s.venue_id
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
-- v2: as 20261115130000, with open_items read from month_photo_states.


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
    -- G-2: one state per (author, venue, photo), the same rows my_month_photos
    -- lists. Accepted is the credit above; these are the other two states.
    select s.author_id as o_staff, s.venue_id as o_venue,
      (count(*) filter (where s.state = 'waiting'))::integer as pending,
      (count(*) filter (where s.state = 'needs_another_photo'))::integer as needs_another
    from private.month_photo_states(v_month, v_venue, v_staff) s
    group by s.author_id, s.venue_id
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
-- ---------------------------------------------------------------------------
-- The caller's own list
-- ---------------------------------------------------------------------------

-- Self-scoped: only the caller's own photos, at the venues their month row
-- has in coverage_staff_progress_v2 (so the list and the counts are one set).
-- Newest upload first; at most 201 rows (callers ask one past their page).
create function public.my_month_photos(
  p_period_month date default null,
  p_limit integer default 101
)
returns table (
  asset_id uuid,
  venue_id uuid,
  state text,
  uploaded_at timestamptz,
  item_names text[],
  requirement_title text,
  submission_item_id uuid,
  reason text,
  decided_by uuid,
  decided_at timestamptz,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer,
  evidence_available boolean
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
  v_limit integer := least(greatest(coalesce(p_limit, 101), 1), 201);
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if extract(day from v_month) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  return query
  select s.asset_id, s.venue_id, s.state, a.created_at,
    coalesce(array(
      select distinct li.item_name
      from public.media_label_items li
      where li.asset_id = s.asset_id and li.added_by = v_uid
      order by li.item_name
    ), '{}'::text[]),
    sent.title,
    s.submission_item_id,
    s.reason,
    coalesce(s.decided_by, ok.decided_by),
    coalesce(s.decided_at, ok.decided_at),
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height,
    a.upload_state = 'ready' and a.deleted_at is null
  from private.month_photo_states(v_month, null, v_uid) s
  join public.media_assets a on a.id = s.asset_id
  -- What the photo was sent for, when it was sent in the month.
  left join lateral (
    select coalesce(r.title, '') as title
    from public.coverage_submission_items i
    left join public.coverage_requirements r on r.id = i.requirement_id
    where i.asset_id = s.asset_id and i.author_id = v_uid and i.submitted_month = v_month
      and i.origin = 'submitted'
    order by (i.id = s.submission_item_id) desc nulls last, i.submitted_at desc, i.id
    limit 1
  ) sent on true
  -- Who accepted it: the first menu acceptance, else the accepted send.
  left join lateral (
    select x.decided_by, x.decided_at
    from (
      select m.decided_by, m.decided_at, 1 as k
      from public.menu_item_photos m
      where m.asset_id = s.asset_id and m.state in ('accepted', 'needs_recheck')
      union all
      select i.decided_by, i.decided_at, 2
      from public.coverage_submission_items i
      where i.asset_id = s.asset_id and i.author_id = v_uid and i.state = 'accepted'
    ) x
    where s.state = 'accepted'
    order by x.k, x.decided_at
    limit 1
  ) ok on true
  where s.venue_id in (
    select p.venue_id from public.coverage_staff_progress_v2(null, v_month, v_uid) p
  )
  order by a.created_at desc, s.asset_id desc
  limit v_limit;
end;
$$;

revoke all on function public.my_month_photos(date, integer) from public, anon, service_role;
grant execute on function public.my_month_photos(date, integer) to authenticated;
