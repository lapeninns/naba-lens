-- G-8 (goals, not tasks; v0.5 rules 22 and 23): menu-section requirements
-- have no assignees and no due date.
--
-- * set_coverage_requirement_assignees refuses a menu section for everyone,
--   admins included (menu_section_shared).
-- * save_coverage_requirement refuses a new due date on a menu section
--   (menu_section_no_due_date). An existing date may stay or be cleared.
-- * coverage_requirement_progress never reports a menu section as overdue or
--   as needing reassignment.
-- * venue_coverage_summary (and coverage_group_overview, which reads it)
--   counts overdue and needs-reassignment for non-menu work only.
--
-- No rows are deleted or rewritten (decision 7): existing assignees, due
-- dates, submissions and audit events stay, and admins can still read them.
-- submit_coverage_photos still refuses unassigned senders, so menu-section
-- sending ends; section shots go to the month (decision 15).
-- Read-only for history; signatures and grants are unchanged.

create or replace function public.set_coverage_requirement_assignees(
  p_requirement_id uuid,
  p_staff_ids uuid[],
  p_reason text default null
)
returns table (staff_id uuid, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_row public.coverage_requirements;
  v_reason text := coalesce(private.clean_text(p_reason, 500, 'invalid_reason'), 'Unassigned.');
  v_ids uuid[];
  v_staff uuid;
begin
  select r.* into v_row from public.coverage_requirements r where r.id = p_requirement_id;
  if not found or not private.can_manage_venue(v_row.venue_id) then
    raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
  end if;
  -- v0.5 rule 22: nobody is assigned to a menu section, admins included.
  -- Assignments made before the cut-over stay in the table as history.
  if v_row.kind = 'menu_section' then
    raise exception 'menu_section_shared' using errcode = 'P0001',
      detail = 'Menu sections are shared by the whole venue. Nobody is assigned to them.';
  end if;
  if p_staff_ids is null or cardinality(p_staff_ids) > 50 or array_position(p_staff_ids, null) is not null then
    raise exception 'invalid_staff_list' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct u.id), '{}'::uuid[]) into v_ids from unnest(p_staff_ids) as u(id);

  perform private.lock_coverage_venue(v_row.venue_id);
  select r.* into v_row from public.coverage_requirements r where r.id = p_requirement_id for update;
  if v_row.status not in ('needs_setup', 'active') then
    raise exception 'requirement_closed' using errcode = 'P0001';
  end if;

  update public.coverage_requirement_assignees a
  set ended_at = now(), ended_by = v_uid, end_kind = 'unassigned', end_reason = v_reason
  where a.requirement_id = v_row.id and a.ended_at is null and not (a.staff_id = any(v_ids));

  foreach v_staff in array v_ids loop
    if not exists (
      select 1 from public.coverage_requirement_assignees a
      where a.requirement_id = v_row.id and a.staff_id = v_staff and a.ended_at is null
    ) then
      if not exists (
        select 1 from public.profiles p
        where p.id = v_staff and p.active and p.role = 'staff' and p.venue_id = v_row.venue_id
      ) then
        raise exception 'staff_not_eligible' using errcode = 'P0001',
          detail = jsonb_build_object('staffId', v_staff)::text;
      end if;
      insert into public.coverage_requirement_assignees (requirement_id, venue_id, staff_id, assigned_by)
      values (v_row.id, v_row.venue_id, v_staff, v_uid);
    end if;
  end loop;

  perform private.coverage_audit(v_row.venue_id, 'assignment', v_row.id, 'assignees_set',
    private.clean_text(p_reason, 500, 'invalid_reason'), null,
    jsonb_build_object('staffIds', to_jsonb(v_ids)));

  return query
    select a.staff_id, a.id
    from public.coverage_requirement_assignees a
    where a.requirement_id = v_row.id and a.ended_at is null
    order by a.assigned_at, a.id;
end;
$$;

create or replace function public.save_coverage_requirement(
  p_venue_id uuid,
  p_requirement_id uuid,
  p_expected_revision integer,
  p_kind text,
  p_title text,
  p_guidance text,
  p_photo_target integer,
  p_due_on date,
  p_client_request_key text default null
)
returns table (requirement_id uuid, revision integer, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_title text := private.clean_text(p_title, 120, 'invalid_title');
  v_guidance text := private.clean_text(p_guidance, 2000, 'invalid_guidance');
  v_row public.coverage_requirements;
  v_id uuid;
  v_revision integer;
  v_hash text;
  v_previous_hash text;
begin
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
  end if;
  if v_title is null then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_photo_target is null or p_photo_target not between 1 and 200 then
    raise exception 'invalid_photo_target' using errcode = '22023';
  end if;

  if p_requirement_id is null then
    perform private.assert_can_manage_venue(p_venue_id);
    if p_client_request_key is not null then
      perform private.lock_coverage_request(v_uid, p_client_request_key);
      v_hash := encode(sha256(convert_to(jsonb_build_object(
        'venueId', p_venue_id, 'kind', p_kind, 'title', v_title, 'guidance', v_guidance,
        'photoTarget', p_photo_target, 'dueOn', p_due_on)::text, 'UTF8')), 'hex');
      select r.id, r.client_request_hash into v_id, v_previous_hash
      from public.coverage_requirements r
      where r.created_by = v_uid and r.client_request_key = p_client_request_key;
      if found then
        if v_previous_hash <> v_hash then
          raise exception 'idempotency_key_reused' using errcode = '22023';
        end if;
        -- The create's own result, even if the requirement changed since.
        requirement_id := v_id;
        revision := 1;
        replayed := true;
        return next;
        return;
      end if;
    end if;
    if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
      raise exception 'venue_inactive' using errcode = 'P0001';
    end if;
    if p_kind is null or p_kind not in ('service', 'venue_specific') then
      raise exception 'invalid_kind' using errcode = '22023';
    end if;
    insert into public.coverage_requirements as r (
      venue_id, kind, title, guidance, photo_target, due_on, status,
      status_changed_by, status_changed_at, created_by, updated_by,
      client_request_key, client_request_hash
    )
    values (
      p_venue_id, p_kind, v_title, v_guidance, p_photo_target, p_due_on, 'active',
      v_uid, now(), v_uid, v_uid,
      p_client_request_key, v_hash
    )
    returning r.id, r.revision into v_id, v_revision;
    perform private.coverage_audit(p_venue_id, 'requirement', v_id, 'created', null, null,
      jsonb_build_object('kind', p_kind, 'title', v_title, 'photoTarget', p_photo_target, 'dueOn', p_due_on));
    requirement_id := v_id;
    revision := v_revision;
    replayed := false;
    return next;
    return;
  end if;

  select r.* into v_row from public.coverage_requirements r where r.id = p_requirement_id;
  if not found or not private.can_manage_venue(v_row.venue_id)
     or (p_venue_id is not null and p_venue_id <> v_row.venue_id) then
    raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
  end if;
  select r.* into v_row from public.coverage_requirements r where r.id = p_requirement_id for update;
  if p_kind is not null and p_kind <> v_row.kind then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_row.status = 'retired' then
    raise exception 'requirement_closed' using errcode = 'P0001';
  end if;
  -- v0.5 rule 23: menu work has no due date. A date set before the cut-over
  -- stays as history (it may be kept or cleared), but none is newly set.
  if v_row.kind = 'menu_section' and p_due_on is not null
     and p_due_on is distinct from v_row.due_on then
    raise exception 'menu_section_no_due_date' using errcode = 'P0001',
      detail = 'Menu sections are shared by the venue and have no due date.';
  end if;
  if p_expected_revision is distinct from v_row.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_row.revision, 'state', v_row.status)::text;
  end if;

  if v_title = v_row.title and v_guidance is not distinct from v_row.guidance
     and p_photo_target = v_row.photo_target and p_due_on is not distinct from v_row.due_on then
    requirement_id := v_row.id;
    revision := v_row.revision;
    replayed := false;
    return next;
    return;
  end if;

  update public.coverage_requirements r
  set title = v_title, guidance = v_guidance, photo_target = p_photo_target, due_on = p_due_on,
      updated_by = v_uid, revision = r.revision + 1
  where r.id = v_row.id
  returning r.revision into v_revision;

  perform private.coverage_audit(v_row.venue_id, 'requirement', v_row.id, 'updated', null,
    jsonb_build_object('title', v_row.title, 'guidance', v_row.guidance, 'photoTarget', v_row.photo_target, 'dueOn', v_row.due_on),
    jsonb_build_object('title', v_title, 'guidance', v_guidance, 'photoTarget', p_photo_target, 'dueOn', p_due_on));
  requirement_id := v_row.id;
  revision := v_revision;
  replayed := false;
  return next;
end;
$$;

create or replace function public.coverage_requirement_progress(
  p_venue_id uuid,
  p_include_closed boolean default false
)
returns table (
  requirement_id uuid,
  venue_id uuid,
  kind text,
  title text,
  guidance text,
  photo_target integer,
  due_on date,
  status text,
  status_reason text,
  amenity_key text,
  menu_plan_id uuid,
  menu_plan_status text,
  menu_version_id uuid,
  section_snapshot jsonb,
  revision integer,
  is_current boolean,
  accepted_count integer,
  pending_count integer,
  needs_another_photo_count integer,
  evidence_removed_count integer,
  satisfied boolean,
  overdue boolean,
  assignee_ids uuid[],
  needs_reassignment boolean,
  amenity_presence text,
  amenity_confirmed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := private.london_today();
begin
  if p_venue_id is null or not (
    private.can_manage_venue(p_venue_id)
    or coalesce(private.active_staff_venue_id() = p_venue_id, false)
  ) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  return query
  select r.id, r.venue_id, r.kind, r.title, r.guidance, r.photo_target, r.due_on, r.status,
    r.status_reason, r.amenity_key, r.menu_plan_id, x.menu_plan_status, r.menu_version_id,
    r.section_snapshot, r.revision, x.is_current,
    x.accepted_count, x.pending_count, x.needs_another_photo_count, x.evidence_removed_count,
    x.is_current and x.accepted_count >= r.photo_target,
    -- v0.5 rules 22 and 23: menu work is never overdue and never needs
    -- reassignment. Old assignees are still returned (history).
    r.kind <> 'menu_section'
      and x.is_current and x.accepted_count < r.photo_target and r.due_on is not null and r.due_on < v_today,
    x.open_assignee_ids,
    r.kind <> 'menu_section'
      and x.is_current and x.accepted_count < r.photo_target
      and cardinality(x.open_assignee_ids) = 0 and x.had_departed_assignee,
    f.presence,
    f.confirmed_at is not null
  from private.requirement_status_rows(p_venue_id) x
  join public.coverage_requirements r on r.id = x.requirement_id
  left join public.venue_amenity_facts f on f.venue_id = r.venue_id and f.amenity_key = r.amenity_key
  where coalesce(p_include_closed, false) or r.status <> 'retired'
  order by
    array_position(array['menu_section', 'service', 'amenity', 'venue_specific'], r.kind),
    coalesce((r.section_snapshot ->> 'position')::integer, 0), r.title, r.id;
end;
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
      -- v0.5: overdue and needs-reassignment count non-menu work only.
      (count(*) filter (where x.kind <> 'menu_section' and x.is_current and x.accepted_count < x.photo_target
        and x.due_on is not null and x.due_on < v_today))::integer as overdue,
      (count(*) filter (where x.kind <> 'menu_section' and x.is_current and x.accepted_count < x.photo_target
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
