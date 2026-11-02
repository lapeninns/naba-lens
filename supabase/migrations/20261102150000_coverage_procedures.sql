-- Coverage procedures and reporting (part 3 of 3).
--
-- Every procedure derives the actor from auth.uid() and re-reads the actor's
-- scope (admin, effective venue manager, active staff) from the database on
-- each call. A resource ID that is unknown or outside the caller's scope
-- raises the same *_not_found error. Mutable records use compare-and-set on
-- `revision` (stale -> coverage_conflict, 40001); submissions and reviews take
-- a client request key so retries never add rows or credit.
--
-- Counting rules live here once:
--   * monthly credit: private.monthly_credit_items
--   * coverage evidence and requirement state: private.requirement_status_rows
--   * menu coverage state: private.venue_menu_state

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- One writer at a time per venue for configuration, plans and reconciliation.
create function private.lock_coverage_venue(p_venue_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('nabalens_coverage_venue:' || p_venue_id::text, 0));
$$;

-- Serialises retries of one client request (submit, attach or review).
create function private.lock_coverage_request(p_actor uuid, p_key text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('nabalens_coverage_request:' || p_actor::text || ':' || p_key, 0));
$$;

create function private.assert_request_key(p_key text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
end;
$$;

-- 1..p_max distinct, non-null ids, returned sorted.
create function private.normalise_id_list(p_ids uuid[], p_max integer)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_sorted uuid[];
begin
  if p_ids is null or cardinality(p_ids) not between 1 and p_max
     or array_position(p_ids, null) is not null then
    raise exception 'invalid_asset_list' using errcode = '22023',
      detail = format('Between 1 and %s ids.', p_max);
  end if;
  select array_agg(x.id order by x.id) into v_sorted from (select distinct u.id from unnest(p_ids) as u(id)) x;
  if cardinality(v_sorted) <> cardinality(p_ids) then
    raise exception 'invalid_asset_list' using errcode = '22023', detail = 'Duplicate ids.';
  end if;
  return v_sorted;
end;
$$;

create function private.coverage_audit(
  p_venue_id uuid,
  p_entity text,
  p_entity_id uuid,
  p_action text,
  p_reason text,
  p_before jsonb,
  p_after jsonb,
  p_historical boolean default false
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.coverage_audit_events
    (venue_id, entity, entity_id, actor_id, actor_role, action, reason, historical, before, after)
  values (
    p_venue_id, p_entity, p_entity_id,
    (select p.id from public.profiles p where p.id = (select auth.uid())),
    private.coverage_actor_role(p_venue_id),
    p_action, p_reason, p_historical, p_before, p_after
  );
$$;

-- Records the item's current state as the result of p_action.
create function private.record_item_event(
  p_item_id uuid,
  p_action text,
  p_from_state text,
  p_reason text,
  p_self_review boolean,
  p_key text,
  p_cleared_replaces_item_id uuid default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.coverage_review_events (
    item_id, venue_id, author_id, actor_id, actor_role, action, from_state, to_state,
    revision, requirement_id, reason, self_review, client_request_key, cleared_replaces_item_id
  )
  select i.id, i.venue_id, i.author_id,
    (select p.id from public.profiles p where p.id = (select auth.uid())),
    private.coverage_actor_role(i.venue_id),
    p_action, p_from_state, i.state, i.revision, i.requirement_id, p_reason,
    coalesce(p_self_review, false), p_key, p_cleared_replaces_item_id
  from public.coverage_submission_items i
  where i.id = p_item_id;
$$;

-- Active, and for a menu section, part of the venue's confirmed plan.
create function private.requirement_is_current(p_requirement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coverage_requirements r
    left join public.menu_coverage_plans mp on mp.id = r.menu_plan_id
    where r.id = p_requirement_id
      and r.status = 'active'
      and (r.kind <> 'menu_section' or mp.status = 'confirmed')
  );
$$;

-- Ends open assignments of a requirement that stopped needing them.
create function private.end_requirement_assignments(p_requirement_id uuid, p_reason text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.coverage_requirement_assignees a
  set ended_at = now(),
      ended_by = (select p.id from public.profiles p where p.id = (select auth.uid())),
      end_kind = 'requirement_closed',
      end_reason = p_reason
  where a.requirement_id = p_requirement_id and a.ended_at is null;
$$;

-- Archives every open item of a requirement leaving coverage (history stays;
-- pending items remain reviewable for monthly credit).
create function private.archive_requirement_items(p_requirement_id uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  for v_item in
    update public.coverage_submission_items i
    set archived_at = now(), archive_kind = p_kind, revision = i.revision + 1
    where i.requirement_id = p_requirement_id
      and i.archived_at is null
    returning i.id, i.state
  loop
    perform private.record_item_event(v_item.id, 'archived', v_item.state, null, false, null);
  end loop;
end;
$$;

-- Retires a requirement: closes assignments and archives its items.
create function private.retire_requirement(
  p_requirement_id uuid,
  p_retire_kind text,
  p_reason text,
  p_replaced_by uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.archive_requirement_items(
    p_requirement_id,
    case when p_retire_kind = 'reconciled' then 'reconciled' else 'requirement_retired' end
  );
  perform private.end_requirement_assignments(p_requirement_id, p_reason);
  update public.coverage_requirements r
  set status = 'retired',
      status_reason = p_reason,
      retire_kind = p_retire_kind,
      replaced_by_requirement_id = p_replaced_by,
      status_changed_by = (select p.id from public.profiles p where p.id = (select auth.uid())),
      status_changed_at = now(),
      updated_by = (select p.id from public.profiles p where p.id = (select auth.uid())),
      revision = r.revision + 1
  where r.id = p_requirement_id and r.status <> 'retired';
end;
$$;

-- ---------------------------------------------------------------------------
-- Counting rules
-- ---------------------------------------------------------------------------

-- Accepted photos that earn monthly credit for p_month: the author submitted
-- their own ready image, uploaded and submitted in that London month, at the
-- item's venue (its upload-time venue). Deleted during the month: no credit.
-- Deleted after the month: credit kept, flagged as evidence removed. Callers
-- count distinct asset_id per (author_id, venue_id).
create function private.monthly_credit_items(p_month date)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  decided_at timestamptz,
  evidence_removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.author_id, i.venue_id, i.asset_id, i.decided_at, a.deleted_at is not null
  from public.coverage_submission_items i
  join public.media_assets a on a.id = i.asset_id
  where i.submitted_month = p_month
    and i.uploaded_month = p_month
    and i.state = 'accepted'
    and i.origin = 'submitted'
    and i.submitted_by = i.author_id
    and a.media_type = 'image'
    and a.upload_state = 'ready'
    and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month));
$$;

-- Per requirement: whether it is current / in the applicable denominator and
-- its evidence counts (distinct accepted assets with available evidence; any
-- upload month).
create function private.requirement_status_rows(p_venue_id uuid)
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
    coalesce(e.accepted, 0), coalesce(e.pending, 0), coalesce(e.needs_another, 0), coalesce(e.removed, 0),
    coalesce(asg.ids, '{}'::uuid[]), coalesce(asg.departed, false)
  from public.coverage_requirements r
  left join public.menu_coverage_plans mp on mp.id = r.menu_plan_id
  left join lateral (
    select
      (count(distinct i.asset_id) filter (
        where i.state = 'accepted' and a.upload_state = 'ready' and a.deleted_at is null))::integer as accepted,
      (count(*) filter (
        where i.state = 'submitted' and a.upload_state = 'ready' and a.deleted_at is null))::integer as pending,
      (count(*) filter (where i.state = 'needs_another_photo' and rp.replaced is null))::integer as needs_another,
      (count(*) filter (where i.state = 'accepted' and a.deleted_at is not null))::integer as removed
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
  left join lateral (
    select
      array_agg(x.staff_id order by x.assigned_at) filter (where x.ended_at is null) as ids,
      bool_or(x.end_kind in ('transferred', 'deactivated')) as departed
    from public.coverage_requirement_assignees x
    where x.requirement_id = r.id
  ) asg on true
  where p_venue_id is null or r.venue_id = p_venue_id;
$$;

create function private.venue_menu_state(p_venue_id uuid)
returns table (
  menu_state text,
  active_menu_version_id uuid,
  current_plan_id uuid,
  draft_plan_id uuid,
  pending_reconciliation integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select
      (select v.id from public.menu_versions v
        where v.venue_id = p_venue_id and v.status = 'active') as active_version,
      (select p.id from public.menu_coverage_plans p
        where p.venue_id = p_venue_id and p.status = 'confirmed') as plan_id,
      (select p.menu_version_id from public.menu_coverage_plans p
        where p.venue_id = p_venue_id and p.status = 'confirmed') as plan_version,
      (select p.id from public.menu_coverage_plans p
        where p.venue_id = p_venue_id and p.status = 'draft') as draft_id,
      (select count(*)::integer
        from public.coverage_requirements r
        join public.menu_coverage_plans p on p.id = r.menu_plan_id
        where r.venue_id = p_venue_id and p.status = 'superseded' and r.status <> 'retired') as pending
  )
  select
    case
      when s.active_version is null then 'no_menu'
      when s.plan_id is null then 'needs_setup'
      when s.plan_version <> s.active_version then 'menu_changed'
      when s.pending > 0 then 'reconciliation_pending'
      else 'current'
    end,
    s.active_version, s.plan_id, s.draft_id, s.pending
  from s;
$$;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

-- Adds unconfirmed candidate requirements and unknown amenity facts for every
-- active template the venue has never had. Returns requirements added. Only
-- monthly preparation calls it, for every in-scope active venue, so no venue
-- can look complete without its checklist.
create function private.add_coverage_candidates(p_venue_id uuid, p_actor uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.lock_coverage_venue(p_venue_id);

  insert into public.venue_amenity_facts (venue_id, amenity_key, updated_by)
  select p_venue_id, t.key, p_actor
  from public.coverage_amenity_templates t
  where t.active and t.needs_fact
  on conflict on constraint venue_amenity_facts_venue_key do nothing;

  with added as (
    insert into public.coverage_requirements
      (venue_id, kind, title, guidance, photo_target, amenity_key, created_by, updated_by)
    select p_venue_id, t.kind, t.title, t.default_guidance, t.suggested_photo_target, t.key, p_actor, p_actor
    from public.coverage_amenity_templates t
    where t.active
      and not exists (
        select 1 from public.coverage_requirements r
        where r.venue_id = p_venue_id and r.amenity_key = t.key
      )
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_count from added;

  if v_count > 0 then
    perform private.coverage_audit(p_venue_id, 'requirement', null, 'candidates_added', null, null,
      jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

-- Create (p_requirement_id NULL: service or venue-specific, starts active) or
-- update a requirement's subject, guidance, photo count and due date. A keyed
-- create is safe to retry: the same key and arguments return the original
-- result with replayed = true (also for a retry that waited on the lock while
-- the first call created), other arguments raise idempotency_key_reused.
-- Updates rely on the revision and ignore the key.
create function public.save_coverage_requirement(
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

create function public.set_coverage_requirement_status(
  p_requirement_id uuid,
  p_expected_revision integer,
  p_status text,
  p_reason text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.coverage_requirements;
  v_reason text;
  v_revision integer;
begin
  select r.* into v_row from public.coverage_requirements r where r.id = p_requirement_id;
  if not found or not private.can_manage_venue(v_row.venue_id) then
    raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('active', 'not_applicable', 'retired') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'active' then
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  else
    v_reason := private.require_reason(p_reason);
  end if;

  perform private.lock_coverage_venue(v_row.venue_id);
  select r.* into v_row from public.coverage_requirements r where r.id = p_requirement_id for update;
  if v_row.status = 'retired' then
    raise exception 'requirement_closed' using errcode = 'P0001';
  end if;
  if p_expected_revision is distinct from v_row.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_row.revision, 'state', v_row.status)::text;
  end if;
  if p_status = v_row.status then
    return v_row.revision;
  end if;

  if p_status = 'active' and exists (
    select 1 from public.coverage_amenity_templates t
    where t.key = v_row.amenity_key and t.needs_fact
  ) and not exists (
    select 1 from public.venue_amenity_facts f
    where f.venue_id = v_row.venue_id and f.amenity_key = v_row.amenity_key
      and f.presence = 'present' and f.confirmed_at is not null
  ) then
    raise exception 'amenity_unconfirmed' using errcode = 'P0001',
      detail = 'Confirm the amenity is present before confirming its photo requirement.';
  end if;

  if p_status = 'retired' then
    perform private.retire_requirement(v_row.id, 'manual', v_reason, null);
    select r.revision into v_revision from public.coverage_requirements r where r.id = v_row.id;
  else
    if p_status = 'not_applicable' then
      perform private.end_requirement_assignments(v_row.id, v_reason);
    end if;
    update public.coverage_requirements r
    set status = p_status,
        status_reason = v_reason,
        status_changed_by = v_uid,
        status_changed_at = now(),
        updated_by = v_uid,
        revision = r.revision + 1
    where r.id = v_row.id
    returning r.revision into v_revision;
  end if;

  perform private.coverage_audit(v_row.venue_id, 'requirement', v_row.id, 'status_changed', v_reason,
    jsonb_build_object('status', v_row.status), jsonb_build_object('status', p_status));
  return v_revision;
end;
$$;

-- Desired set of assignees. Returns the open assignments afterwards.
create function public.set_coverage_requirement_assignees(
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

-- Amenity facts. p_asset_ids NULL keeps the supporting media; an array is the
-- desired set. Any change clears confirmation unless this call confirms.
-- Photos already linked to the fact stay as they are; only newly added ones
-- are checked (same venue, ready, undeleted image; for managers, an active
-- staff member's), so resending the list never fails on a photo that was
-- deleted or whose uploader left after it was linked.
create function public.set_amenity_fact(
  p_venue_id uuid,
  p_amenity_key text,
  p_expected_revision integer,
  p_presence text,
  p_facts text,
  p_policy text,
  p_confirm boolean,
  p_asset_ids uuid[] default null
)
returns table (fact_id uuid, revision integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_facts text := private.clean_text(p_facts, 2000, 'invalid_facts');
  v_policy text := private.clean_text(p_policy, 2000, 'invalid_policy');
  v_row public.venue_amenity_facts;
  v_assets uuid[];
  v_new_assets uuid[];
  v_media_changed boolean := false;
  v_changed boolean;
  v_confirmed_by uuid;
  v_confirmed_at timestamptz;
  v_revision integer;
begin
  if not exists (select 1 from public.coverage_amenity_templates t where t.key = p_amenity_key) then
    raise exception 'amenity_not_found' using errcode = 'P0002';
  end if;
  if p_presence is null or p_presence not in ('present', 'absent', 'unknown') then
    raise exception 'invalid_presence' using errcode = '22023';
  end if;
  if coalesce(p_confirm, false) and p_presence = 'unknown' then
    raise exception 'amenity_unknown' using errcode = 'P0001',
      detail = 'Unknown needs verification and cannot be confirmed.';
  end if;
  if p_asset_ids is not null then
    if cardinality(p_asset_ids) = 0 then
      v_assets := '{}'::uuid[];
    else
      v_assets := private.normalise_id_list(p_asset_ids, 20);
    end if;
  end if;

  perform private.lock_coverage_venue(p_venue_id);
  select f.* into v_row from public.venue_amenity_facts f
  where f.venue_id = p_venue_id and f.amenity_key = p_amenity_key
  for update;
  if not found then
    -- First record for this amenity: the caller may pass NULL or 1.
    insert into public.venue_amenity_facts as f (venue_id, amenity_key, updated_by)
    values (p_venue_id, p_amenity_key, v_uid)
    returning f.* into v_row;
    if p_expected_revision is not null and p_expected_revision <> v_row.revision then
      raise exception 'coverage_conflict' using errcode = '40001',
        detail = jsonb_build_object('revision', null, 'state', null)::text;
    end if;
  elsif p_expected_revision is distinct from v_row.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_row.revision, 'state', v_row.presence)::text;
  end if;

  if v_assets is not null then
    select coalesce(array_agg(u.id), '{}'::uuid[]) into v_new_assets
    from unnest(v_assets) as u(id)
    where not exists (
      select 1 from public.venue_amenity_fact_media m where m.fact_id = v_row.id and m.asset_id = u.id);
    if exists (
      select 1 from unnest(v_new_assets) as u(id)
      where not exists (
        select 1 from public.media_assets a
        where a.id = u.id and a.venue_id = p_venue_id
          and a.upload_state = 'ready' and a.deleted_at is null
      )
    ) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    -- Attach's rules: images only, and for managers only active staff's photos.
    if exists (
      select 1 from unnest(v_new_assets) as u(id)
      join public.media_assets a on a.id = u.id
      where a.media_type <> 'image'
    ) then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
    end if;
    if not private.is_active_admin() and exists (
      select 1 from unnest(v_new_assets) as u(id)
      join public.media_assets a on a.id = u.id
      where not exists (
        select 1 from public.profiles p where p.id = a.uploader_id and p.active and p.role = 'staff')
    ) then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'inactive_uploader';
    end if;
    v_media_changed := v_assets is distinct from coalesce((
      select array_agg(m.asset_id order by m.asset_id)
      from public.venue_amenity_fact_media m where m.fact_id = v_row.id
    ), '{}'::uuid[]);
  end if;
  v_changed := p_presence is distinct from v_row.presence
    or v_facts is distinct from v_row.facts
    or v_policy is distinct from v_row.policy
    or v_media_changed;

  -- A retry of the same save (or re-confirming a confirmed fact) changes nothing.
  if not v_changed and (not coalesce(p_confirm, false) or v_row.confirmed_at is not null) then
    fact_id := v_row.id;
    revision := v_row.revision;
    return next;
    return;
  end if;

  if coalesce(p_confirm, false) then
    v_confirmed_by := v_uid;
    v_confirmed_at := now();
  end if;

  if v_media_changed then
    delete from public.venue_amenity_fact_media m
    where m.fact_id = v_row.id and not (m.asset_id = any(v_assets));
    insert into public.venue_amenity_fact_media (fact_id, venue_id, asset_id, added_by)
    select v_row.id, p_venue_id, u.id, v_uid
    from unnest(v_assets) as u(id)
    on conflict do nothing;
  end if;

  update public.venue_amenity_facts f
  set presence = p_presence, facts = v_facts, policy = v_policy,
      confirmed_by = v_confirmed_by, confirmed_at = v_confirmed_at,
      updated_by = v_uid, revision = f.revision + 1
  where f.id = v_row.id
  returning f.revision into v_revision;

  -- An amenity that is no longer present cannot keep an active photo requirement.
  if p_presence <> 'present' then
    update public.coverage_requirements r
    set status = 'needs_setup', status_reason = null,
        status_changed_by = v_uid, status_changed_at = now(),
        updated_by = v_uid, revision = r.revision + 1
    where r.venue_id = p_venue_id and r.amenity_key = p_amenity_key and r.status = 'active'
      and exists (select 1 from public.coverage_amenity_templates t where t.key = p_amenity_key and t.needs_fact);
  end if;

  perform private.coverage_audit(p_venue_id, 'amenity_fact', v_row.id, 'fact_saved', null,
    jsonb_build_object('presence', v_row.presence, 'confirmed', v_row.confirmed_at is not null),
    jsonb_build_object('presence', p_presence, 'confirmed', v_confirmed_at is not null,
      'mediaChanged', v_media_changed));

  fact_id := v_row.id;
  revision := v_revision;
  return next;
end;
$$;

-- One target per staff member, venue and London month. Current month: a
-- change to a set value or due date needs a reason. Past months: admins only,
-- with a reason, audited as historical corrections.
create function public.set_monthly_target(
  p_staff_id uuid,
  p_venue_id uuid,
  p_period_month date,
  p_target_count integer,
  p_due_on date default null,
  p_reason text default null,
  p_expected_revision integer default null
)
returns table (target_id uuid, revision integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_current date := private.current_london_month();
  v_historical boolean;
  v_due date;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_source text;
  v_row public.monthly_targets;
  v_revision integer;
begin
  if p_period_month is null or extract(day from p_period_month) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_target_count is null or p_target_count not between 1 and 500 then
    raise exception 'invalid_target_count' using errcode = '22023';
  end if;
  v_due := coalesce(p_due_on, (p_period_month + interval '1 month')::date - 1);
  if v_due < p_period_month or v_due >= (p_period_month + interval '1 month')::date then
    raise exception 'invalid_due_date' using errcode = '22023',
      detail = 'The due date must fall within the target month.';
  end if;

  v_historical := p_period_month < v_current;
  if v_historical then
    if not private.is_active_admin() then
      raise exception 'historical_admin_only' using errcode = '42501';
    end if;
    v_reason := private.require_reason(p_reason);
    v_source := 'admin_correction';
    if not exists (select 1 from public.profiles p where p.id = p_staff_id and p.role = 'staff') then
      raise exception 'staff_not_found' using errcode = 'P0002';
    end if;
  else
    v_source := 'manager';
    if not exists (
      select 1 from public.profiles p
      where p.id = p_staff_id and p.active and p.role = 'staff' and p.venue_id = p_venue_id
    ) then
      raise exception 'staff_not_eligible' using errcode = 'P0001',
        detail = 'Targets are set for active staff at their current venue.';
    end if;
  end if;

  select t.* into v_row from public.monthly_targets t
  where t.staff_id = p_staff_id and t.venue_id = p_venue_id and t.period_month = p_period_month
  for update;

  if not found then
    if p_expected_revision is not null then
      raise exception 'coverage_conflict' using errcode = '40001',
        detail = jsonb_build_object('revision', null, 'state', null)::text;
    end if;
    insert into public.monthly_targets as t
      (staff_id, venue_id, period_month, target_count, due_on, source, created_by, updated_by)
    values (p_staff_id, p_venue_id, p_period_month, p_target_count, v_due, v_source, v_uid, v_uid)
    on conflict on constraint monthly_targets_period_key do nothing
    returning t.* into v_row;
    if not found then
      raise exception 'coverage_conflict' using errcode = '40001',
        detail = jsonb_build_object('revision', 1, 'state', null)::text;
    end if;
    perform private.coverage_audit(p_venue_id, 'monthly_target', v_row.id, 'created', v_reason, null,
      jsonb_build_object('staffId', p_staff_id, 'month', p_period_month, 'target', p_target_count, 'dueOn', v_due),
      v_historical);
    target_id := v_row.id;
    revision := v_row.revision;
    return next;
    return;
  end if;

  if p_expected_revision is distinct from v_row.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_row.revision, 'state', v_row.source)::text;
  end if;
  if v_row.target_count is not distinct from p_target_count and v_row.due_on = v_due then
    target_id := v_row.id;
    revision := v_row.revision;
    return next;
    return;
  end if;
  if p_period_month = v_current and v_row.target_count is not null then
    v_reason := private.require_reason(p_reason);
  end if;

  update public.monthly_targets t
  set target_count = p_target_count, due_on = v_due, source = v_source,
      updated_by = v_uid, revision = t.revision + 1
  where t.id = v_row.id
  returning t.revision into v_revision;

  perform private.coverage_audit(p_venue_id, 'monthly_target', v_row.id,
    case when v_historical then 'corrected' else 'updated' end, v_reason,
    jsonb_build_object('target', v_row.target_count, 'dueOn', v_row.due_on, 'source', v_row.source),
    jsonb_build_object('target', p_target_count, 'dueOn', v_due, 'source', v_source),
    v_historical);

  target_id := v_row.id;
  revision := v_revision;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Monthly preparation
-- ---------------------------------------------------------------------------

-- Idempotent and safe to run concurrently: adds the template candidates of
-- every in-scope active venue, then for each active staff member at an active
-- venue without a row for the current London month, copies their latest
-- configured target AT THAT SAME VENUE, else adds a needs-setup placeholder.
-- Targets from a previous venue are never copied. A failure is recorded and
-- returned instead of raised, with no partial candidates or targets.
create function private.prepare_coverage_month(p_venue_id uuid, p_trigger text, p_actor uuid)
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
  v_placeholders integer := 0;
  v_candidates integer := 0;
  v_venue_id uuid;
  v_code text;
  v_message text;
  v_run public.coverage_preparation_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended('nabalens_coverage_prepare:' || v_month::text, 0));

  begin
    -- Venue locks in id order; no other procedure takes this month lock.
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

    with missing as (
      select p.id as staff_id, p.venue_id
      from public.profiles p
      join public.venues v on v.id = p.venue_id and v.active
      where p.active and p.role = 'staff'
        and (p_venue_id is null or p.venue_id = p_venue_id)
        and not exists (
          select 1 from public.monthly_targets t
          where t.staff_id = p.id and t.venue_id = p.venue_id and t.period_month = v_month
        )
    ),
    sources as (
      select m.staff_id, m.venue_id, prev.id as prev_id, prev.target_count
      from missing m
      left join lateral (
        select t.id, t.target_count
        from public.monthly_targets t
        where t.staff_id = m.staff_id and t.venue_id = m.venue_id
          and t.period_month < v_month and t.target_count is not null
        order by t.period_month desc
        limit 1
      ) prev on true
    ),
    added as (
      insert into public.monthly_targets as t
        (staff_id, venue_id, period_month, target_count, due_on, source, copied_from_target_id)
      select s.staff_id, s.venue_id, v_month, s.target_count,
        (v_month + interval '1 month')::date - 1,
        case when s.prev_id is null then 'placeholder' else 'copied' end,
        s.prev_id
      from sources s
      on conflict on constraint monthly_targets_period_key do nothing
      returning t.id, t.venue_id, t.staff_id, t.source, t.target_count
    ),
    -- Data-modifying CTEs always run once, whether or not they are read.
    audited as (
      insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, after)
      select a.venue_id, 'monthly_target', a.id, p_actor,
        private.coverage_actor_role(a.venue_id),
        case when a.source = 'copied' then 'copied' else 'prepared' end,
        jsonb_build_object('staffId', a.staff_id, 'month', v_month, 'target', a.target_count)
      from added a
    )
    select
      (count(*) filter (where a.source = 'copied'))::integer,
      (count(*) filter (where a.source = 'placeholder'))::integer
    into v_copied, v_placeholders
    from added a;

    insert into public.coverage_preparation_runs as r (
      period_month, run_trigger, scope_venue_id, requested_by, started_at, finished_at, status,
      staff_considered, targets_copied, placeholders_created, already_present, candidates_added
    )
    values (
      v_month, p_trigger, p_venue_id, p_actor, v_started, clock_timestamp(), 'succeeded',
      v_considered, v_copied, v_placeholders, greatest(v_considered - v_copied - v_placeholders, 0),
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
      'placeholders', v_run.placeholders_created, 'candidates', v_run.candidates_added,
      'errorCode', v_run.error_code));
  return next v_run;
end;
$$;

-- Manual run: an admin (all venues or one) or a manager (own venue only).
create function public.prepare_coverage_month(p_venue_id uuid default null)
returns setof public.coverage_preparation_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_venue_id is null then
    perform private.assert_active_admin();
  else
    perform private.assert_can_manage_venue(p_venue_id);
  end if;
  return query select * from private.prepare_coverage_month(p_venue_id, 'manual', v_uid);
end;
$$;

-- Hourly scheduled handler (service role only).
create function public.prepare_coverage_month_scheduled()
returns setof public.coverage_preparation_runs
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.prepare_coverage_month(null, 'scheduled', null);
$$;

-- ---------------------------------------------------------------------------
-- Submission and review
-- ---------------------------------------------------------------------------

-- The latest item per asset for a replayed request.
create function private.replay_items(p_asset_ids uuid[], p_venue_id uuid)
returns table (item_id uuid, asset_id uuid, state text, revision integer, reused boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.asset_id, l.state, l.revision, true
  from unnest(p_asset_ids) as u(id)
  join lateral (
    select i.id, i.asset_id, i.state, i.revision
    from public.coverage_submission_items i
    where i.asset_id = u.id and i.venue_id = p_venue_id
    order by (i.state in ('submitted', 'accepted') and i.archived_at is null) desc, i.submitted_at desc, i.id desc
    limit 1
  ) l on true;
$$;

-- Moves a live item to another requirement (NULL: monthly only). Its old
-- replacement link answered a request on the old requirement, so it is
-- cleared (and recorded on the relinked event) unless p_replaces_item_id is a
-- request on the destination, which the caller has checked.
create function private.move_coverage_item(
  p_item_id uuid,
  p_requirement_id uuid,
  p_replaces_item_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.coverage_submission_items;
begin
  select i.* into v_item from public.coverage_submission_items i where i.id = p_item_id for update;
  update public.coverage_submission_items i
  set requirement_id = p_requirement_id, replaces_item_id = p_replaces_item_id,
      revision = i.revision + 1
  where i.id = p_item_id;
  perform private.record_item_event(p_item_id, 'relinked', v_item.state, null, false, null,
    nullif(v_item.replaces_item_id, p_replaces_item_id));
  return v_item.revision + 1;
end;
$$;

-- Staff submit their own ready photos (1..10) for their monthly target and,
-- optionally, one current requirement they hold an open assignment on.
-- Unassigned requirements get evidence through attach_coverage_evidence.
-- p_replaces_item_id (a request on p_requirement_id) links new items and any
-- own pending photo moved here; a moved photo's old link is dropped.
create function public.submit_coverage_photos(
  p_asset_ids uuid[],
  p_requirement_id uuid default null,
  p_client_request_key text default null,
  p_replaces_item_id uuid default null
)
returns table (item_id uuid, asset_id uuid, state text, revision integer, reused boolean, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_max_assets constant integer := 10;
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_assets uuid[];
  v_asset_id uuid;
  v_asset public.media_assets;
  v_previous public.coverage_submissions;
  v_live public.coverage_submission_items;
  v_submission uuid;
  v_new_id uuid;
  v_new_revision integer;
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;
  perform private.assert_request_key(p_client_request_key);
  v_assets := private.normalise_id_list(p_asset_ids, c_max_assets);
  perform private.lock_coverage_request(v_uid, p_client_request_key);

  select s.* into v_previous from public.coverage_submissions s
  where s.submitted_by = v_uid and s.client_request_key = p_client_request_key;
  if found then
    if v_previous.kind <> 'staff_submit' or v_previous.asset_ids <> v_assets
       or v_previous.requirement_id is distinct from p_requirement_id then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return query
      select r.item_id, r.asset_id, r.state, r.revision, r.reused, true
      from private.replay_items(p_asset_ids, v_previous.venue_id) r;
    return;
  end if;
  replayed := false;

  v_venue := private.uploadable_venue_id();
  if v_venue is null then
    raise exception 'venue_inactive' using errcode = 'P0001',
      detail = 'Staff must be assigned to an active venue to submit photos.';
  end if;

  if p_requirement_id is not null then
    if not exists (
      select 1 from public.coverage_requirements r
      where r.id = p_requirement_id and r.venue_id = v_venue
    ) then
      raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
    end if;
    if not private.requirement_is_current(p_requirement_id) then
      raise exception 'requirement_not_open' using errcode = 'P0001';
    end if;
    -- FOR SHARE: an unassignment committing meanwhile is seen, not raced.
    perform 1 from public.coverage_requirement_assignees a
    where a.requirement_id = p_requirement_id and a.staff_id = v_uid and a.ended_at is null
    for share;
    if not found then
      raise exception 'requirement_not_assigned' using errcode = 'P0001',
        detail = 'Only staff assigned to this requirement can submit photos to it.';
    end if;
  end if;

  if p_replaces_item_id is not null and not exists (
    select 1 from public.coverage_submission_items i
    where i.id = p_replaces_item_id and i.author_id = v_uid and i.venue_id = v_venue
      and i.state = 'needs_another_photo'
      and i.requirement_id is not distinct from p_requirement_id
  ) then
    raise exception 'coverage_item_not_found' using errcode = 'P0002';
  end if;

  -- Validate every asset before writing anything.
  foreach v_asset_id in array v_assets loop
    perform pg_advisory_xact_lock(hashtextextended('nabalens_coverage_asset:' || v_asset_id::text, 0));
    select a.* into v_asset from public.media_assets a where a.id = v_asset_id;
    if not found or v_asset.uploader_id <> v_uid or v_asset.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_asset.upload_state <> 'ready' then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_ready';
    end if;
    if v_asset.media_type <> 'image' then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
    end if;
    if v_asset.venue_id <> v_venue then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'other_venue';
    end if;
    -- A monthly-only photo can only earn credit in its own upload month.
    if p_requirement_id is null
       and private.london_month(v_asset.created_at) <> private.london_month(now()) then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'outside_period';
    end if;
    select i.* into v_live from public.coverage_submission_items i
    where i.asset_id = v_asset_id and i.state in ('submitted', 'accepted') and i.archived_at is null;
    -- Only the author's own pending submission may move to another requirement.
    if found and v_live.requirement_id is distinct from p_requirement_id
       and not (v_live.state = 'submitted' and v_live.origin = 'submitted') then
      raise exception 'asset_already_submitted' using errcode = 'P0001',
        detail = jsonb_build_object('itemId', v_live.id)::text;
    end if;
  end loop;

  insert into public.coverage_submissions as s
    (venue_id, submitted_by, kind, requirement_id, client_request_key, asset_ids)
  values (v_venue, v_uid, 'staff_submit', p_requirement_id, p_client_request_key, v_assets)
  returning s.id into v_submission;

  foreach v_asset_id in array p_asset_ids loop
    select a.* into v_asset from public.media_assets a where a.id = v_asset_id;
    select i.* into v_live from public.coverage_submission_items i
    where i.asset_id = v_asset_id and i.state in ('submitted', 'accepted') and i.archived_at is null
    for update;
    if found then
      if v_live.requirement_id is not distinct from p_requirement_id then
        item_id := v_live.id;
        asset_id := v_live.asset_id;
        state := v_live.state;
        revision := v_live.revision;
        reused := true;
        return next;
        continue;
      end if;
      v_new_revision := private.move_coverage_item(v_live.id, p_requirement_id, p_replaces_item_id);
      item_id := v_live.id;
      asset_id := v_live.asset_id;
      state := v_live.state;
      revision := v_new_revision;
      reused := false;
      return next;
      continue;
    end if;

    insert into public.coverage_submission_items as i (
      submission_id, venue_id, asset_id, author_id, requirement_id, origin, submitted_by,
      submitted_at, submitted_month, uploaded_at, uploaded_month, replaces_item_id
    )
    values (
      v_submission, v_venue, v_asset_id, v_uid, p_requirement_id, 'submitted', v_uid,
      now(), private.london_month(now()), v_asset.created_at, private.london_month(v_asset.created_at),
      p_replaces_item_id
    )
    returning i.id, i.revision into v_new_id, v_new_revision;
    perform private.record_item_event(v_new_id, 'submitted', null, null, false, null);
    item_id := v_new_id;
    asset_id := v_asset_id;
    state := 'submitted';
    revision := v_new_revision;
    reused := false;
    return next;
  end loop;
end;
$$;

-- A manager (own venue) or admin attaches existing ready photos to a current
-- requirement. Authorship stays with the uploader; attached photos count for
-- coverage only. Managers attach active colleagues' photos; admins may also
-- attach retained photos of people who have left. p_accept also accepts them.
create function public.attach_coverage_evidence(
  p_requirement_id uuid,
  p_asset_ids uuid[],
  p_client_request_key text,
  p_accept boolean default false
)
returns table (item_id uuid, asset_id uuid, state text, revision integer, reused boolean, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_max_assets constant integer := 10;
  v_uid uuid := auth.uid();
  v_req public.coverage_requirements;
  v_admin boolean;
  v_assets uuid[];
  v_asset_id uuid;
  v_asset public.media_assets;
  v_previous public.coverage_submissions;
  v_live public.coverage_submission_items;
  v_submission uuid;
  v_id uuid;
  v_state text;
  v_revision integer;
  v_reused boolean;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  select r.* into v_req from public.coverage_requirements r where r.id = p_requirement_id;
  if not found or not private.can_manage_venue(v_req.venue_id) then
    raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_request_key(p_client_request_key);
  v_assets := private.normalise_id_list(p_asset_ids, c_max_assets);
  perform private.lock_coverage_request(v_uid, p_client_request_key);

  select s.* into v_previous from public.coverage_submissions s
  where s.submitted_by = v_uid and s.client_request_key = p_client_request_key;
  if found then
    if v_previous.kind <> 'manager_attach' or v_previous.asset_ids <> v_assets
       or v_previous.requirement_id is distinct from p_requirement_id then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return query
      select r.item_id, r.asset_id, r.state, r.revision, r.reused, true
      from private.replay_items(p_asset_ids, v_previous.venue_id) r;
    return;
  end if;
  replayed := false;

  if not private.requirement_is_current(p_requirement_id) then
    raise exception 'requirement_not_open' using errcode = 'P0001';
  end if;
  v_admin := private.is_active_admin();

  foreach v_asset_id in array v_assets loop
    perform pg_advisory_xact_lock(hashtextextended('nabalens_coverage_asset:' || v_asset_id::text, 0));
    select a.* into v_asset from public.media_assets a where a.id = v_asset_id;
    if not found or v_asset.venue_id <> v_req.venue_id or v_asset.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_asset.upload_state <> 'ready' then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_ready';
    end if;
    if v_asset.media_type <> 'image' then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
    end if;
    if not v_admin and not exists (
      select 1 from public.profiles p where p.id = v_asset.uploader_id and p.active and p.role = 'staff'
    ) then
      raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'inactive_uploader';
    end if;
    select i.* into v_live from public.coverage_submission_items i
    where i.asset_id = v_asset_id and i.state in ('submitted', 'accepted') and i.archived_at is null;
    if found and v_live.requirement_id is not null and v_live.requirement_id <> p_requirement_id then
      raise exception 'asset_already_submitted' using errcode = 'P0001',
        detail = jsonb_build_object('itemId', v_live.id)::text;
    end if;
  end loop;

  insert into public.coverage_submissions as s
    (venue_id, submitted_by, kind, requirement_id, client_request_key, asset_ids)
  values (v_req.venue_id, v_uid, 'manager_attach', p_requirement_id, p_client_request_key, v_assets)
  returning s.id into v_submission;

  foreach v_asset_id in array p_asset_ids loop
    select a.* into v_asset from public.media_assets a where a.id = v_asset_id;
    select i.* into v_live from public.coverage_submission_items i
    where i.asset_id = v_asset_id and i.state in ('submitted', 'accepted') and i.archived_at is null
    for update;
    if found then
      v_id := v_live.id;
      v_reused := v_live.requirement_id is not distinct from p_requirement_id;
      if not v_reused then
        perform private.move_coverage_item(v_live.id, p_requirement_id, null);
      end if;
    else
      v_reused := false;
      insert into public.coverage_submission_items as i (
        submission_id, venue_id, asset_id, author_id, requirement_id, origin, submitted_by,
        submitted_at, submitted_month, uploaded_at, uploaded_month
      )
      values (
        v_submission, v_req.venue_id, v_asset_id, v_asset.uploader_id, p_requirement_id, 'attached', v_uid,
        now(), private.london_month(now()), v_asset.created_at, private.london_month(v_asset.created_at)
      )
      returning i.id into v_id;
      perform private.record_item_event(v_id, 'attached', null, null, false, null);
    end if;

    if coalesce(p_accept, false) then
      update public.coverage_submission_items i
      set state = 'accepted', decided_by = v_uid, decided_at = now(),
          self_review = (v_uid = i.author_id), revision = i.revision + 1
      where i.id = v_id and i.state = 'submitted';
      if found then
        perform private.record_item_event(v_id, 'accepted', 'submitted', null,
          v_uid = v_asset.uploader_id, null);
        v_reused := false;
      end if;
    end if;

    select i.state, i.revision into v_state, v_revision
    from public.coverage_submission_items i where i.id = v_id;
    item_id := v_id;
    asset_id := v_asset_id;
    state := v_state;
    revision := v_revision;
    reused := v_reused;
    return next;
  end loop;
end;
$$;

-- Accept, or ask for another photo (reason required), once: only a submitted
-- item is decided, and repeating the decision an item already has is a no-op
-- replay. Managers may review their own photos: recorded as self-review for
-- admin oversight.
create function public.review_coverage_item(
  p_item_id uuid,
  p_expected_revision integer,
  p_decision text,
  p_reason text default null,
  p_client_request_key text default null
)
returns table (item_id uuid, state text, revision integer, self_review boolean, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.coverage_review_events;
  v_item public.coverage_submission_items;
  v_reason text;
  v_self boolean;
  v_revision integer;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.coverage_review_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      -- A replay answers only someone still in scope, and only the same decision.
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'coverage_item_not_found' using errcode = 'P0002';
      end if;
      if v_event.item_id <> p_item_id or v_event.action is distinct from p_decision then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      item_id := v_event.item_id;
      state := v_event.to_state;
      revision := v_event.revision;
      self_review := v_event.self_review;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  select i.* into v_item from public.coverage_submission_items i where i.id = p_item_id;
  if not found or not private.can_manage_venue(v_item.venue_id) then
    raise exception 'coverage_item_not_found' using errcode = 'P0002';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'needs_another_photo') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision = 'needs_another_photo' then
    v_reason := private.require_reason(p_reason);
  else
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  end if;

  select i.* into v_item from public.coverage_submission_items i where i.id = p_item_id for update;
  if p_expected_revision is distinct from v_item.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_item.revision, 'state', v_item.state)::text;
  end if;
  if v_item.state = p_decision then
    item_id := v_item.id;
    state := v_item.state;
    revision := v_item.revision;
    self_review := coalesce(v_item.self_review, false);
    replayed := true;
    return next;
    return;
  end if;
  if v_item.state <> 'submitted' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', v_item.state, p_decision);
  end if;
  if p_decision = 'accepted' and not exists (
    select 1 from public.media_assets a
    where a.id = v_item.asset_id and a.upload_state = 'ready' and a.deleted_at is null
      and a.media_type = 'image'
  ) then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;

  v_self := v_uid = v_item.author_id;
  begin
    update public.coverage_submission_items i
    set state = p_decision, decision_reason = v_reason, decided_by = v_uid, decided_at = now(),
        self_review = v_self, revision = i.revision + 1
    where i.id = p_item_id
    returning i.revision into v_revision;
  exception when unique_violation then
    raise exception 'asset_already_submitted' using errcode = 'P0001',
      detail = 'This photo is already live on another item.';
  end;
  perform private.record_item_event(p_item_id, p_decision, v_item.state, v_reason, v_self, p_client_request_key);

  item_id := p_item_id;
  state := p_decision;
  revision := v_revision;
  self_review := v_self;
  replayed := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Menu coverage plans and reconciliation
-- ---------------------------------------------------------------------------

-- Draft plan for the venue's active menu version: one needs-setup requirement
-- per section of that exact version. Idempotent per version. A stale draft for
-- an older version is discarded.
create function public.start_menu_coverage_plan(p_venue_id uuid, p_menu_version_id uuid)
returns table (plan_id uuid, revision integer, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_status text;
  v_existing public.menu_coverage_plans;
  v_plan uuid;
  v_requirement uuid;
  v_sections bigint;
begin
  perform private.lock_coverage_venue(p_venue_id);
  perform private.lock_venue_menu(p_venue_id, true);

  select v.status into v_status from public.menu_versions v
  where v.id = p_menu_version_id and v.venue_id = p_venue_id;
  if not found then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'menu_version_not_active' using errcode = 'P0001';
  end if;

  select p.* into v_existing from public.menu_coverage_plans p
  where p.menu_version_id = p_menu_version_id and p.status in ('draft', 'confirmed');
  if found then
    plan_id := v_existing.id;
    revision := v_existing.revision;
    created := false;
    return next;
    return;
  end if;

  for v_existing in
    select p.* from public.menu_coverage_plans p
    where p.venue_id = p_venue_id and p.status = 'draft'
    for update
  loop
    for v_requirement in
      select r.id from public.coverage_requirements r
      where r.menu_plan_id = v_existing.id and r.status <> 'retired'
    loop
      perform private.retire_requirement(v_requirement, 'menu_replaced', 'Draft plan replaced by a newer menu.', null);
    end loop;
    update public.menu_coverage_plans p
    set status = 'discarded', discarded_by = v_uid, discarded_at = now(), revision = p.revision + 1
    where p.id = v_existing.id;
    perform private.coverage_audit(p_venue_id, 'menu_plan', v_existing.id, 'discarded',
      'Draft plan replaced by a newer menu.', null, null);
  end loop;

  insert into public.menu_coverage_plans as p (venue_id, menu_version_id, created_by)
  values (p_venue_id, p_menu_version_id, v_uid)
  returning p.id into v_plan;

  insert into public.coverage_requirements (
    venue_id, kind, title, photo_target, menu_plan_id, menu_version_id, menu_section_id,
    section_snapshot, created_by, updated_by
  )
  select p_venue_id, 'menu_section', left(btrim(s.name), 120), 1, v_plan, p_menu_version_id, s.id,
    jsonb_build_object(
      'name', s.name, 'slug', s.slug, 'kind', s.kind, 'position', s.position,
      'itemCount', (select count(*) from public.menu_entries e where e.section_id = s.id)
    ),
    v_uid, v_uid
  from public.menu_sections s
  where s.version_id = p_menu_version_id and s.venue_id = p_venue_id
  order by s.position;
  get diagnostics v_sections = row_count;

  perform private.coverage_audit(p_venue_id, 'menu_plan', v_plan, 'plan_started', null, null,
    jsonb_build_object('menuVersionId', p_menu_version_id, 'sections', v_sections));

  plan_id := v_plan;
  revision := 1;
  created := true;
  return next;
end;
$$;

-- Confirm a draft plan once every section requirement is configured (active)
-- or excluded with a reason. Supersedes the previous plan; its requirements
-- without live evidence retire, the rest wait for explicit reconciliation.
create function public.confirm_menu_coverage_plan(p_plan_id uuid, p_expected_revision integer)
returns table (plan_id uuid, reconciliation_required boolean, auto_retired integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_plan public.menu_coverage_plans;
  v_previous uuid;
  v_unready integer;
  v_auto integer := 0;
  v_pending integer;
  v_requirement uuid;
begin
  select p.* into v_plan from public.menu_coverage_plans p where p.id = p_plan_id;
  if not found or not private.can_manage_venue(v_plan.venue_id) then
    raise exception 'menu_coverage_plan_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_coverage_venue(v_plan.venue_id);
  perform private.lock_venue_menu(v_plan.venue_id, true);
  select p.* into v_plan from public.menu_coverage_plans p where p.id = p_plan_id for update;
  if p_expected_revision is distinct from v_plan.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_plan.revision, 'state', v_plan.status)::text;
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'plan_not_draft' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.menu_versions v where v.id = v_plan.menu_version_id and v.status = 'active'
  ) then
    raise exception 'menu_version_not_active' using errcode = 'P0001';
  end if;
  select count(*)::integer into v_unready from public.coverage_requirements r
  where r.menu_plan_id = v_plan.id and r.status not in ('active', 'not_applicable');
  if v_unready > 0 then
    raise exception 'plan_incomplete' using errcode = 'P0001',
      detail = jsonb_build_object('needsSetup', v_unready)::text;
  end if;

  select p.id into v_previous from public.menu_coverage_plans p
  where p.venue_id = v_plan.venue_id and p.status = 'confirmed'
  for update;
  if v_previous is not null then
    update public.menu_coverage_plans p
    set status = 'superseded', superseded_at = now(), revision = p.revision + 1
    where p.id = v_previous;
  end if;

  for v_requirement in
    select r.id
    from public.coverage_requirements r
    join public.menu_coverage_plans p on p.id = r.menu_plan_id
    where r.venue_id = v_plan.venue_id and p.status = 'superseded' and r.status <> 'retired'
      and not exists (
        select 1 from public.coverage_submission_items i
        where i.requirement_id = r.id and i.archived_at is null and i.state in ('submitted', 'accepted')
      )
  loop
    perform private.retire_requirement(v_requirement, 'menu_replaced',
      'Menu replaced. No evidence to reconcile.', null);
    v_auto := v_auto + 1;
  end loop;

  select count(*)::integer into v_pending
  from public.coverage_requirements r
  join public.menu_coverage_plans p on p.id = r.menu_plan_id
  where r.venue_id = v_plan.venue_id and p.status = 'superseded' and r.status <> 'retired';

  update public.menu_coverage_plans p
  set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(),
      previous_plan_id = v_previous, reconciliation_required = v_pending > 0,
      revision = p.revision + 1
  where p.id = v_plan.id;

  perform private.coverage_audit(v_plan.venue_id, 'menu_plan', v_plan.id, 'plan_confirmed', null, null,
    jsonb_build_object('previousPlanId', v_previous, 'autoRetired', v_auto, 'pendingReconciliation', v_pending));

  plan_id := v_plan.id;
  reconciliation_required := v_pending > 0;
  auto_retired := v_auto;
  return next;
end;
$$;

create function public.discard_menu_coverage_plan(p_plan_id uuid, p_expected_revision integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.menu_coverage_plans;
  v_requirement uuid;
begin
  select p.* into v_plan from public.menu_coverage_plans p where p.id = p_plan_id;
  if not found or not private.can_manage_venue(v_plan.venue_id) then
    raise exception 'menu_coverage_plan_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_coverage_venue(v_plan.venue_id);
  select p.* into v_plan from public.menu_coverage_plans p where p.id = p_plan_id for update;
  if p_expected_revision is distinct from v_plan.revision then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_plan.revision, 'state', v_plan.status)::text;
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'plan_not_draft' using errcode = 'P0001';
  end if;
  for v_requirement in
    select r.id from public.coverage_requirements r
    where r.menu_plan_id = v_plan.id and r.status <> 'retired'
  loop
    perform private.retire_requirement(v_requirement, 'manual', 'Draft plan discarded.', null);
  end loop;
  update public.menu_coverage_plans p
  set status = 'discarded', discarded_by = v_uid, discarded_at = now(), revision = p.revision + 1
  where p.id = v_plan.id;
  perform private.coverage_audit(v_plan.venue_id, 'menu_plan', v_plan.id, 'discarded', null, null, null);
end;
$$;

-- Explicitly reconcile one requirement of a superseded plan: carry selected
-- accepted photos (default: all with available evidence) to a requirement of
-- the current confirmed plan, or carry nothing, then retire the old one.
-- Carried photos earn no new monthly credit.
create function public.reconcile_menu_requirement(
  p_old_requirement_id uuid,
  p_target_requirement_id uuid,
  p_item_ids uuid[],
  p_reason text
)
returns table (carried integer, reconciliation_complete boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_old public.coverage_requirements;
  v_reason text;
  v_items uuid[];
  v_item public.coverage_submission_items;
  v_submission uuid;
  v_new uuid;
  v_carried integer := 0;
  v_pending integer;
  v_current_plan uuid;
begin
  select r.* into v_old from public.coverage_requirements r where r.id = p_old_requirement_id;
  if not found or not private.can_manage_venue(v_old.venue_id) then
    raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.require_reason(p_reason);
  perform private.lock_coverage_venue(v_old.venue_id);
  select r.* into v_old from public.coverage_requirements r where r.id = p_old_requirement_id for update;
  if v_old.kind <> 'menu_section' or v_old.status = 'retired' or not exists (
    select 1 from public.menu_coverage_plans p where p.id = v_old.menu_plan_id and p.status = 'superseded'
  ) then
    raise exception 'plan_not_superseded' using errcode = 'P0001';
  end if;

  select p.id into v_current_plan from public.menu_coverage_plans p
  where p.venue_id = v_old.venue_id and p.status = 'confirmed';

  if p_target_requirement_id is null then
    if p_item_ids is not null and cardinality(p_item_ids) > 0 then
      raise exception 'invalid_asset_list' using errcode = '22023',
        detail = 'Choose a replacement requirement to carry photos to.';
    end if;
    v_items := '{}'::uuid[];
  else
    if not exists (
      select 1 from public.coverage_requirements r
      where r.id = p_target_requirement_id and r.venue_id = v_old.venue_id
    ) then
      raise exception 'coverage_requirement_not_found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.coverage_requirements r
      where r.id = p_target_requirement_id and r.menu_plan_id = v_current_plan
    ) or not private.requirement_is_current(p_target_requirement_id) then
      raise exception 'requirement_not_open' using errcode = 'P0001';
    end if;
    if p_item_ids is null then
      select coalesce(array_agg(i.id order by i.submitted_at, i.id), '{}'::uuid[]) into v_items
      from public.coverage_submission_items i
      join public.media_assets a on a.id = i.asset_id
      where i.requirement_id = v_old.id and i.archived_at is null and i.state = 'accepted'
        and a.upload_state = 'ready' and a.deleted_at is null;
    elsif cardinality(p_item_ids) = 0 then
      v_items := '{}'::uuid[];
    else
      v_items := private.normalise_id_list(p_item_ids, 200);
      if exists (
        select 1 from unnest(v_items) as u(id)
        where not exists (
          select 1 from public.coverage_submission_items i
          where i.id = u.id and i.requirement_id = v_old.id and i.archived_at is null and i.state = 'accepted'
        )
      ) then
        raise exception 'coverage_item_not_found' using errcode = 'P0002';
      end if;
      if exists (
        select 1 from unnest(v_items) as u(id)
        join public.coverage_submission_items i on i.id = u.id
        join public.media_assets a on a.id = i.asset_id
        where a.upload_state <> 'ready' or a.deleted_at is not null
      ) then
        raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
      end if;
    end if;
  end if;

  if cardinality(v_items) > 0 then
    insert into public.coverage_submissions as s
      (venue_id, submitted_by, kind, requirement_id, client_request_key, asset_ids)
    select v_old.venue_id, v_uid, 'reconcile', p_target_requirement_id,
      'reconcile-' || gen_random_uuid()::text,
      array_agg(i.asset_id order by i.asset_id)
    from public.coverage_submission_items i
    where i.id = any(v_items)
    returning s.id into v_submission;

    for v_item in
      select i.* from public.coverage_submission_items i
      where i.id = any(v_items)
      order by i.submitted_at, i.id
      for update
    loop
      update public.coverage_submission_items i
      set archived_at = now(), archive_kind = 'reconciled', revision = i.revision + 1
      where i.id = v_item.id;
      perform private.record_item_event(v_item.id, 'archived', v_item.state, v_reason, false, null);

      insert into public.coverage_submission_items as i (
        submission_id, venue_id, asset_id, author_id, requirement_id, origin, submitted_by,
        submitted_at, submitted_month, uploaded_at, uploaded_month, state,
        decided_by, decided_at, self_review, reconciled_from_item_id
      )
      values (
        v_submission, v_old.venue_id, v_item.asset_id, v_item.author_id, p_target_requirement_id,
        'reconciled', v_uid, now(), private.london_month(now()), v_item.uploaded_at, v_item.uploaded_month,
        'accepted', v_uid, now(), v_uid = v_item.author_id, v_item.id
      )
      returning i.id into v_new;
      perform private.record_item_event(v_new, 'reconciled', null, v_reason, v_uid = v_item.author_id, null);
      v_carried := v_carried + 1;
    end loop;
  end if;

  perform private.retire_requirement(v_old.id, 'reconciled', v_reason, p_target_requirement_id);

  select count(*)::integer into v_pending
  from public.coverage_requirements r
  join public.menu_coverage_plans p on p.id = r.menu_plan_id
  where r.venue_id = v_old.venue_id and p.status = 'superseded' and r.status <> 'retired';

  if v_pending = 0 and v_current_plan is not null then
    update public.menu_coverage_plans p
    set reconciled_at = now(), reconciled_by = v_uid, revision = p.revision + 1
    where p.id = v_current_plan and p.reconciliation_required and p.reconciled_at is null;
  end if;

  perform private.coverage_audit(v_old.venue_id, 'requirement', v_old.id, 'reconciled', v_reason, null,
    jsonb_build_object('targetRequirementId', p_target_requirement_id, 'carried', v_carried));

  carried := v_carried;
  reconciliation_complete := v_pending = 0;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Narrow roster projection: names, avatar, team and progress. Never emails or
-- auth data. Staff see only themselves; managers their venue; admins all.
create function public.coverage_staff_progress(
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

create function public.coverage_requirement_progress(
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
    x.is_current and x.accepted_count < r.photo_target and r.due_on is not null and r.due_on < v_today,
    x.open_assignee_ids,
    x.is_current and x.accepted_count < r.photo_target
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

-- Venue coverage: complete only when every applicable requirement is
-- satisfied, nothing needs setup and menu coverage is current.
create function public.venue_coverage_summary(p_venue_id uuid default null)
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

-- Organisation oversight for one London month (admin).
create function public.coverage_group_overview(p_period_month date default null)
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
      (count(*) filter (where g.is_current_member and g.target_id is null))::integer as without_target,
      (count(*) filter (where g.complete))::integer as done,
      (coalesce(sum(g.accepted_count), 0))::integer as accepted
    from public.coverage_staff_progress(s.venue_id, v_month, null) g
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

-- Review queue and "my photos". Own items: p_author_id = caller. Otherwise
-- the caller must manage p_venue_id. Keyset on (submitted_at, id).
create function public.coverage_items_page(
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
  select i.id, i.venue_id, i.revision, i.state, i.origin, i.requirement_id, r.title,
    i.author_id, p.display_name, p.active and p.role = 'staff', i.submitted_by,
    i.submitted_at, i.submitted_month, i.uploaded_month,
    i.origin = 'submitted' and i.submitted_by = i.author_id and i.uploaded_month = i.submitted_month
      and a.media_type = 'image',
    i.asset_id, a.media_type, a.preview_path is not null, a.thumbnail_path is not null,
    a.width, a.height, a.upload_state = 'ready' and a.deleted_at is null,
    i.decision_reason, i.decided_by, i.decided_at, i.self_review, i.archived_at is not null,
    i.replaces_item_id
  from public.coverage_submission_items i
  join public.media_assets a on a.id = i.asset_id
  join public.profiles p on p.id = i.author_id
  left join public.coverage_requirements r on r.id = i.requirement_id
  where (p_venue_id is null or i.venue_id = p_venue_id)
    and (p_author_id is null or i.author_id = p_author_id)
    and (p_states is null or i.state = any(p_states))
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

-- Scoped task-evidence preview check: a ready, undeleted asset attached to a
-- coverage item (or amenity fact) the caller may see. Includes retained
-- evidence of people who have left, for managers and admins. No storage keys
-- leave the database here: the app route reads them with the service role
-- only after this check and signs a short-lived derivative URL.
create function public.task_evidence_asset(p_asset_id uuid)
returns table (
  asset_id uuid,
  venue_id uuid,
  uploader_id uuid,
  media_type public.media_type,
  validated_mime_type text,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.venue_id, a.uploader_id, a.media_type, a.validated_mime_type,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and private.is_active_user()
    and (
      (
        private.can_manage_venue(a.venue_id)
        and (
          exists (select 1 from public.coverage_submission_items i where i.asset_id = a.id)
          or exists (select 1 from public.venue_amenity_fact_media m where m.asset_id = a.id)
        )
      )
      or (
        a.uploader_id = (select auth.uid())
        and exists (select 1 from public.coverage_submission_items i where i.asset_id = a.id)
      )
    );
$$;

-- Photos that can be submitted or attached, newest first, with any live item.
-- Managers (p_venue_id they manage) and admins: ready images of that venue,
-- active uploaders only for managers. Everyone else: their own ready images at
-- their current venue.
create function public.coverage_candidate_assets(
  p_venue_id uuid default null,
  p_uploader_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  asset_id uuid,
  venue_id uuid,
  uploader_id uuid,
  uploader_name text,
  uploader_active boolean,
  created_at timestamptz,
  uploaded_month date,
  monthly_eligible_now boolean,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer,
  live_item_id uuid,
  live_item_state text,
  live_requirement_id uuid
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
  v_month date := private.current_london_month();
  v_venue uuid := p_venue_id;
  v_uploader uuid := p_uploader_id;
  v_admin boolean := private.is_active_admin();
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if not (p_venue_id is not null and private.can_manage_venue(p_venue_id)) then
    v_venue := private.uploadable_venue_id();
    v_uploader := v_uid;
    v_admin := false;
    if v_venue is null or (p_venue_id is not null and p_venue_id <> v_venue)
       or (p_uploader_id is not null and p_uploader_id <> v_uid) then
      raise exception 'not_venue_manager' using errcode = '42501';
    end if;
  end if;

  return query
  select a.id, a.venue_id, a.uploader_id, p.display_name, p.active and p.role = 'staff',
    a.created_at, private.london_month(a.created_at),
    private.london_month(a.created_at) = v_month,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height,
    li.id, li.state, li.requirement_id
  from public.media_assets a
  join public.profiles p on p.id = a.uploader_id
  left join public.coverage_submission_items li
    on li.asset_id = a.id and li.state in ('submitted', 'accepted') and li.archived_at is null
  where a.venue_id = v_venue
    and (v_uploader is null or a.uploader_id = v_uploader)
    and a.media_type = 'image'
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and (v_admin or a.uploader_id = v_uid or (p.active and p.role = 'staff'))
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit v_limit;
end;
$$;

-- Admin view of manager grants with names (no emails) and whether each is
-- effective right now.
create function public.venue_manager_grant_list(
  p_venue_id uuid default null,
  p_include_revoked boolean default false
)
returns table (
  grant_id uuid,
  staff_id uuid,
  staff_name text,
  staff_active boolean,
  staff_venue_id uuid,
  venue_id uuid,
  venue_name text,
  granted_by uuid,
  granted_by_name text,
  granted_at timestamptz,
  grant_reason text,
  revoked_at timestamptz,
  revoked_by_name text,
  revoke_kind text,
  revoke_reason text,
  effective boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_active_admin();
  return query
  select g.id, g.staff_id, s.display_name, s.active and s.role = 'staff', s.venue_id,
    g.venue_id, v.name, g.granted_by, gb.display_name, g.granted_at, g.grant_reason,
    g.revoked_at, rb.display_name, g.revoke_kind, g.revoke_reason,
    coalesce(private.effective_manager_venue_id(g.staff_id) = g.venue_id and g.revoked_at is null, false)
  from public.venue_manager_grants g
  join public.profiles s on s.id = g.staff_id
  join public.venues v on v.id = g.venue_id
  join public.profiles gb on gb.id = g.granted_by
  left join public.profiles rb on rb.id = g.revoked_by
  where (p_venue_id is null or g.venue_id = p_venue_id)
    and (coalesce(p_include_revoked, false) or g.revoked_at is null)
  order by v.name, s.display_name, g.granted_at desc;
end;
$$;

create function public.coverage_preparation_status(p_venue_id uuid default null)
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
        and not exists (
          select 1 from public.monthly_targets t
          where t.staff_id = p.id and t.venue_id = p.venue_id and t.period_month = v_month
        )),
    (select count(*)::integer
      from public.monthly_targets t
      where t.period_month = v_month and t.target_count is null
        and (v_venue is null or t.venue_id = v_venue));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.lock_coverage_venue(uuid),
  private.lock_coverage_request(uuid, text),
  private.assert_request_key(text),
  private.normalise_id_list(uuid[], integer),
  private.coverage_audit(uuid, text, uuid, text, text, jsonb, jsonb, boolean),
  private.record_item_event(uuid, text, text, text, boolean, text, uuid),
  private.requirement_is_current(uuid),
  private.end_requirement_assignments(uuid, text),
  private.archive_requirement_items(uuid, text),
  private.retire_requirement(uuid, text, text, uuid),
  private.monthly_credit_items(date),
  private.requirement_status_rows(uuid),
  private.venue_menu_state(uuid),
  private.add_coverage_candidates(uuid, uuid),
  private.prepare_coverage_month(uuid, text, uuid),
  private.replay_items(uuid[], uuid),
  private.move_coverage_item(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.lock_coverage_venue(uuid),
  private.lock_coverage_request(uuid, text),
  private.assert_request_key(text),
  private.normalise_id_list(uuid[], integer),
  private.coverage_audit(uuid, text, uuid, text, text, jsonb, jsonb, boolean),
  private.record_item_event(uuid, text, text, text, boolean, text, uuid),
  private.requirement_is_current(uuid),
  private.end_requirement_assignments(uuid, text),
  private.archive_requirement_items(uuid, text),
  private.retire_requirement(uuid, text, text, uuid),
  private.monthly_credit_items(date),
  private.requirement_status_rows(uuid),
  private.venue_menu_state(uuid),
  private.add_coverage_candidates(uuid, uuid),
  private.prepare_coverage_month(uuid, text, uuid),
  private.replay_items(uuid[], uuid),
  private.move_coverage_item(uuid, uuid, uuid)
to service_role;

revoke all on function
  public.save_coverage_requirement(uuid, uuid, integer, text, text, text, integer, date, text),
  public.set_coverage_requirement_status(uuid, integer, text, text),
  public.set_coverage_requirement_assignees(uuid, uuid[], text),
  public.set_amenity_fact(uuid, text, integer, text, text, text, boolean, uuid[]),
  public.set_monthly_target(uuid, uuid, date, integer, date, text, integer),
  public.prepare_coverage_month(uuid),
  public.prepare_coverage_month_scheduled(),
  public.submit_coverage_photos(uuid[], uuid, text, uuid),
  public.attach_coverage_evidence(uuid, uuid[], text, boolean),
  public.review_coverage_item(uuid, integer, text, text, text),
  public.start_menu_coverage_plan(uuid, uuid),
  public.confirm_menu_coverage_plan(uuid, integer),
  public.discard_menu_coverage_plan(uuid, integer),
  public.reconcile_menu_requirement(uuid, uuid, uuid[], text),
  public.coverage_staff_progress(uuid, date, uuid),
  public.coverage_requirement_progress(uuid, boolean),
  public.venue_coverage_summary(uuid),
  public.coverage_group_overview(date),
  public.coverage_items_page(uuid, uuid, text[], uuid, date, timestamptz, uuid, integer, boolean),
  public.task_evidence_asset(uuid),
  public.coverage_candidate_assets(uuid, uuid, timestamptz, uuid, integer),
  public.venue_manager_grant_list(uuid, boolean),
  public.coverage_preparation_status(uuid)
from public, anon;

grant execute on function
  public.save_coverage_requirement(uuid, uuid, integer, text, text, text, integer, date, text),
  public.set_coverage_requirement_status(uuid, integer, text, text),
  public.set_coverage_requirement_assignees(uuid, uuid[], text),
  public.set_amenity_fact(uuid, text, integer, text, text, text, boolean, uuid[]),
  public.set_monthly_target(uuid, uuid, date, integer, date, text, integer),
  public.prepare_coverage_month(uuid),
  public.submit_coverage_photos(uuid[], uuid, text, uuid),
  public.attach_coverage_evidence(uuid, uuid[], text, boolean),
  public.review_coverage_item(uuid, integer, text, text, text),
  public.start_menu_coverage_plan(uuid, uuid),
  public.confirm_menu_coverage_plan(uuid, integer),
  public.discard_menu_coverage_plan(uuid, integer),
  public.reconcile_menu_requirement(uuid, uuid, uuid[], text),
  public.coverage_staff_progress(uuid, date, uuid),
  public.coverage_requirement_progress(uuid, boolean),
  public.venue_coverage_summary(uuid),
  public.coverage_group_overview(date),
  public.coverage_items_page(uuid, uuid, text[], uuid, date, timestamptz, uuid, integer, boolean),
  public.task_evidence_asset(uuid),
  public.coverage_candidate_assets(uuid, uuid, timestamptz, uuid, integer),
  public.venue_manager_grant_list(uuid, boolean),
  public.coverage_preparation_status(uuid)
to authenticated, service_role;

revoke all on function public.prepare_coverage_month_scheduled() from authenticated;
grant execute on function public.prepare_coverage_month_scheduled() to service_role;
