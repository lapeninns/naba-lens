-- Per-venue memberships, part 2: reads and commands (S1-PEOPLE; spec §3.1,
-- §3.3, §7 M5, §8 A6; FA-22; AC14, AC34, AC40).
--
-- Reads
--   my_venue_memberships()          the caller's venues for the venue switcher
--   venue_team(venue)               members of a venue (manager there or admin)
--   person_venue_privileges(person) effective privileges per venue (admin,
--                                   self, or a manager for their own venue)
-- Commands
--   switch_active_venue(venue)      move to another venue one already belongs to
--   manager_invite_staff(...)       a manager (or admin) adds ORDINARY STAFF at
--                                   a venue they manage: a new invited account
--                                   or an existing person (AC40)
--   remove_venue_member(...)        end a membership at one venue; a manager
--                                   can remove ordinary staff at their venue
--                                   only; the last membership deactivates the
--                                   account (AC34); open work can be handed to
--                                   a replacement in the same transaction
--   admin_set_venue_membership(...) admin: staff or manager role at any venue
--   reassign_open_work(...)         hand open assignments at a venue to a
--                                   colleague working there (A6)
--
-- Every command re-reads the caller's current profile, membership and grant;
-- nothing is taken from the client except ids. Assets, attribution and review
-- history are never touched (§3.1, AC34).
--
-- Rollback: revoke execute on the public functions; data written stays valid.

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

-- Ends the person's open legacy coverage assignments and clears amenity
-- check assignees at one venue (what a transfer does, scoped to the venue).
create function private.membership_end_venue_work(
  p_profile uuid,
  p_venue uuid,
  p_actor uuid,
  p_kind text,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check record;
begin
  perform set_config('nabalens.membership_op', 'on', true);

  with ended as (
    update public.coverage_requirement_assignees a
    set ended_at = now(), ended_by = p_actor, end_kind = p_kind, end_reason = p_reason
    where a.staff_id = p_profile and a.venue_id = p_venue and a.ended_at is null
    returning a.id, a.venue_id, a.requirement_id
  )
  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
  select e.venue_id, 'assignment', e.id, p_actor, private.coverage_actor_role(e.venue_id),
    'auto_ended', p_reason,
    jsonb_build_object('kind', p_kind, 'staffId', p_profile, 'requirementId', e.requirement_id)
  from ended e;

  for v_check in
    update public.venue_amenity_checks c
    set assignee_user_id = null, revision = c.revision + 1
    where c.assignee_user_id = p_profile and c.venue_id = p_venue
    returning c.id, c.venue_id
  loop
    perform private.amenity_event(v_check.id, v_check.venue_id, 'unassigned', null,
      jsonb_build_object('cause', 'assignee_left', 'previousAssigneeId', p_profile));
  end loop;

  perform set_config('nabalens.membership_op', '', true);
end;
$$;

-- Moves open assignments at a venue from one person to a colleague who is
-- currently working there as staff. Returns the counts moved.
create function private.membership_reassign_work(
  p_from uuid,
  p_to uuid,
  p_venue uuid,
  p_actor uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_coverage integer := 0;
  v_amenity integer := 0;
begin
  if p_to is null or p_to = p_from or not exists (
    select 1 from public.profiles p
    join public.venues v on v.id = p.venue_id and v.active
    where p.id = p_to and p.active and p.role = 'staff' and p.venue_id = p_venue
  ) then
    raise exception 'replacement_not_eligible' using errcode = 'P0001',
      detail = 'Choose an active staff member who is working at this venue.';
  end if;

  perform set_config('nabalens.membership_op', 'on', true);

  for v_row in
    select a.id, a.requirement_id, a.venue_id
    from public.coverage_requirement_assignees a
    where a.staff_id = p_from and a.venue_id = p_venue and a.ended_at is null
    for update
  loop
    update public.coverage_requirement_assignees a
    set ended_at = now(), ended_by = p_actor, end_kind = 'unassigned', end_reason = p_reason
    where a.id = v_row.id;
    if not exists (
      select 1 from public.coverage_requirement_assignees a
      where a.requirement_id = v_row.requirement_id and a.staff_id = p_to and a.ended_at is null
    ) then
      insert into public.coverage_requirement_assignees (requirement_id, venue_id, staff_id, assigned_by)
      values (v_row.requirement_id, v_row.venue_id, p_to, p_actor);
    end if;
    insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
    values (v_row.venue_id, 'assignment', v_row.id, p_actor, private.coverage_actor_role(v_row.venue_id),
      'reassigned', p_reason,
      jsonb_build_object('fromStaffId', p_from, 'toStaffId', p_to, 'requirementId', v_row.requirement_id));
    v_coverage := v_coverage + 1;
  end loop;

  for v_row in
    update public.venue_amenity_checks c
    set assignee_user_id = p_to, revision = c.revision + 1
    where c.assignee_user_id = p_from and c.venue_id = p_venue
    returning c.id, c.venue_id
  loop
    perform private.amenity_event(v_row.id, v_row.venue_id, 'assigned', p_reason,
      jsonb_build_object('cause', 'reassigned', 'previousAssigneeId', p_from, 'assigneeId', p_to));
    v_amenity := v_amenity + 1;
  end loop;

  perform set_config('nabalens.membership_op', '', true);
  return jsonb_build_object('coverageAssignments', v_coverage, 'amenityChecks', v_amenity);
end;
$$;

-- Moves the profile to another of the person's own venues without the
-- legacy transfer side effects (grants and work elsewhere stay).
create function private.membership_switch_profile(p_profile uuid, p_venue uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('nabalens.venue_switch', 'on', true);
  update public.profiles p
  set venue_id = p_venue, role = p_role::public.app_role
  where p.id = p_profile
    and (p.venue_id is distinct from p_venue or p.role is distinct from p_role::public.app_role);
  perform set_config('nabalens.venue_switch', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- The caller's venues, active one first. Admins see every active venue.
create function public.my_venue_memberships()
returns table (
  venue_id uuid,
  venue_name text,
  role text,
  is_active_venue boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.name, r.role, v.id is not distinct from p.venue_id
  from public.profiles p
  cross join lateral (
    select v.id, v.name from public.venues v
    where v.active and (
      p.role = 'admin'
      or exists (
        select 1 from public.venue_memberships m
        where m.profile_id = p.id and m.venue_id = v.id and m.ended_at is null
      )
    )
  ) v
  cross join lateral (select private.venue_role_of(p.id, v.id) as role) r
  where p.id = (select auth.uid()) and p.active and r.role is not null
  order by (v.id is not distinct from p.venue_id) desc, v.name, v.id;
$$;

-- Members of a venue for its manager or an admin. effective_role is the role
-- that applies while the venue is the person's active venue.
create function public.venue_team(p_venue_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  job_title text,
  membership_id uuid,
  membership_role text,
  effective_role text,
  is_active_venue boolean,
  source text,
  granted_at timestamptz,
  granted_by_name text
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
  select p.id, p.display_name, p.job_title, m.id, m.role,
    private.venue_role_of(p.id, m.venue_id),
    p.venue_id = m.venue_id, m.source, m.granted_at, gb.display_name
  from public.venue_memberships m
  join public.profiles p on p.id = m.profile_id and p.active
  left join public.profiles gb on gb.id = m.granted_by
  where m.venue_id = p_venue_id and m.ended_at is null
  order by (m.role = 'manager') desc, p.display_name, p.id;
end;
$$;

-- Effective privileges per venue (A6): what each membership allows, from the
-- same rule the database applies (private.venue_role_of). An admin target is
-- one row for all venues. Visible to admins, to the person, and to a manager
-- for the venue they manage (other venues' rows are left out).
create function public.person_venue_privileges(p_profile_id uuid)
returns table (
  venue_id uuid,
  venue_name text,
  membership_id uuid,
  membership_role text,
  effective_role text,
  is_active_venue boolean,
  can_upload boolean,
  can_review boolean,
  can_invite_staff boolean,
  can_export boolean,
  can_grant_roles boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_admin boolean := private.is_active_admin();
  v_target public.profiles;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id;
  if not found then
    return;
  end if;

  if v_target.role = 'admin' then
    if v_admin or v_target.id = v_uid then
      return query select null::uuid, 'All venues'::text, null::uuid, 'admin'::text,
        case when v_target.active then 'admin' end, true,
        v_target.active, v_target.active, v_target.active, v_target.active, v_target.active;
    end if;
    return;
  end if;

  return query
  select v.id, v.name, m.id, m.role, r.role, v_target.venue_id = v.id,
    r.role in ('staff', 'manager', 'admin'),
    r.role in ('manager', 'admin'),
    r.role in ('manager', 'admin'),
    r.role in ('manager', 'admin'),
    coalesce(r.role = 'admin', false)
  from public.venue_memberships m
  join public.venues v on v.id = m.venue_id
  cross join lateral (select private.venue_role_of(v_target.id, v.id) as role) r
  where m.profile_id = v_target.id and m.ended_at is null
    and (v_admin or v_target.id = v_uid or private.can_manage_venue(v.id))
  order by (v_target.venue_id = v.id) desc, v.name, v.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

-- Changes the caller's active venue to one they already belong to and takes
-- that membership's role. Never grants access: an unknown venue, an inactive
-- venue or a venue without the caller's membership is refused.
create function public.switch_active_venue(p_venue_id uuid)
returns table (venue_id uuid, role text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_role text;
begin
  select p.* into v_p from public.profiles p where p.id = v_uid for update;
  if v_uid is null or not found or not v_p.active then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if v_p.role = 'admin' then
    raise exception 'admin_has_all_venues' using errcode = 'P0001';
  end if;
  v_role := private.venue_role_of(v_uid, p_venue_id);
  if v_role is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  perform private.membership_switch_profile(v_uid, p_venue_id, v_role);
  return query select p_venue_id, v_role;
end;
$$;

-- A manager (or admin) adds ORDINARY STAFF at a venue they manage (AC40). The
-- role is always staff and the venue must be the caller's managed venue.
--   * p_user_id has no profile: it must be an invitation the server created
--     (auth user marked nabalens_invite); a staff profile is created there.
--   * p_user_id already has a profile: a staff membership is added at this
--     venue. Their memberships elsewhere are untouched; an existing
--     membership here is returned unchanged (never downgrades a manager).
create function public.manager_invite_staff(
  p_user_id uuid,
  p_venue_id uuid,
  p_display_name text,
  p_job_title text default null
)
returns table (profile_id uuid, membership_id uuid, outcome text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_name text := private.clean_text(p_display_name, 80, 'invalid_display_name');
  v_title text := private.clean_text(p_job_title, 80, 'invalid_job_title');
  v_p public.profiles;
  v_open uuid;
  v_id uuid;
begin
  perform private.assert_venue_assignable(p_venue_id);
  if p_user_id is null then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  select p.* into v_p from public.profiles p where p.id = p_user_id for update;
  if found then
    if v_p.role = 'admin' then
      raise exception 'account_not_eligible' using errcode = 'P0001';
    end if;
    if not v_p.active then
      raise exception 'account_inactive' using errcode = 'P0001',
        detail = 'Only an admin can restore access.';
    end if;
    select m.id into v_open from public.venue_memberships m
    where m.profile_id = p_user_id and m.venue_id = p_venue_id and m.ended_at is null;
    if found then
      return query select p_user_id, v_open, 'already_member'::text;
      return;
    end if;
    v_id := private.membership_ensure(p_user_id, p_venue_id, 'staff', 'manager_invite', v_uid, null);
    return query select p_user_id, v_id, 'added'::text;
    return;
  end if;

  if v_name is null then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and coalesce(u.raw_user_meta_data ? 'nabalens_invite', false)
  ) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  perform set_config('nabalens.membership_source', 'manager_invite', true);
  insert into public.profiles (id, display_name, job_title, role, venue_id, active)
  values (p_user_id, v_name, v_title, 'staff', p_venue_id, true);
  perform set_config('nabalens.membership_source', '', true);

  select m.id into v_id from public.venue_memberships m
  where m.profile_id = p_user_id and m.venue_id = p_venue_id and m.ended_at is null;
  return query select p_user_id, v_id, 'created'::text;
end;
$$;

-- Ends one membership. A manager may remove ordinary staff at the venue they
-- manage (never a manager membership, never themself); an admin may remove
-- any membership (a manager membership revokes its grant). When it was the
-- person's last membership the account is deactivated (outcome
-- 'deactivated'; the server then signs it out everywhere). When it was the
-- active venue, the person moves to their next venue. Open work at the venue
-- goes to p_replacement_id when given, otherwise it ends and shows as needing
-- reassignment.
create function public.remove_venue_member(
  p_profile_id uuid,
  p_venue_id uuid,
  p_reason text,
  p_replacement_id uuid default null
)
returns table (outcome text, active_venue_id uuid, reassigned jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_admin boolean := private.is_active_admin();
  v_reason text := private.require_reason(p_reason);
  v_p public.profiles;
  v_m public.venue_memberships;
  v_next record;
  v_moved jsonb := '{}'::jsonb;
begin
  if p_profile_id = v_uid then
    raise exception 'cannot_remove_self' using errcode = '42501';
  end if;
  select p.* into v_p from public.profiles p where p.id = p_profile_id for update;
  if not found or v_p.role = 'admin' then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  select m.* into v_m from public.venue_memberships m
  where m.profile_id = p_profile_id and m.venue_id = p_venue_id and m.ended_at is null
  for update;
  if not found then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  if v_m.role <> 'staff' and not v_admin then
    raise exception 'not_ordinary_staff' using errcode = '42501',
      detail = 'Only an admin can remove a manager.';
  end if;

  if p_replacement_id is not null then
    v_moved := private.membership_reassign_work(p_profile_id, p_replacement_id, p_venue_id, v_uid, v_reason);
  end if;

  if v_m.role = 'manager' then
    with revoked as (
      update public.venue_manager_grants g
      set revoked_at = now(), revoked_by = v_uid, revoke_kind = 'revoked', revoke_reason = v_reason
      where g.staff_id = p_profile_id and g.venue_id = p_venue_id and g.revoked_at is null
      returning g.id
    )
    insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
    select p_venue_id, 'manager_grant', r.id, v_uid, 'admin', 'revoked', v_reason,
      jsonb_build_object('staffId', p_profile_id)
    from revoked r;
  end if;
  perform private.membership_end(v_m.id, 'removed', v_uid, v_reason);

  select m.venue_id, private.venue_role_of(p_profile_id, m.venue_id) as role into v_next
  from public.venue_memberships m
  join public.venues v on v.id = m.venue_id and v.active
  where m.profile_id = p_profile_id and m.ended_at is null
    and private.venue_role_of(p_profile_id, m.venue_id) is not null
  order by m.granted_at, m.id
  limit 1;

  if v_next.venue_id is null then
    -- Last venue: the account is deactivated (legacy side effects apply).
    perform set_config('nabalens.membership_op', 'on', true);
    update public.profiles p set active = false where p.id = p_profile_id;
    perform set_config('nabalens.membership_op', '', true);
    return query select 'deactivated'::text, null::uuid, v_moved;
    return;
  end if;

  if v_p.venue_id = p_venue_id then
    perform private.membership_switch_profile(p_profile_id, v_next.venue_id, v_next.role);
  end if;
  perform private.membership_end_venue_work(p_profile_id, p_venue_id, v_uid, 'transferred',
    'Removed from this venue.');
  return query
  select 'removed'::text, p.venue_id, v_moved from public.profiles p where p.id = p_profile_id;
end;
$$;

-- Admin: give a person the staff or manager role at a venue (adds the venue
-- or changes the role there). Manager rights are an open grant plus a
-- manager membership; a reason is required to grant them.
create function public.admin_set_venue_membership(
  p_profile_id uuid,
  p_venue_id uuid,
  p_role text,
  p_reason text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_p public.profiles;
  v_open public.venue_memberships;
  v_grant uuid;
  v_id uuid;
begin
  if p_role is null or p_role not in ('staff', 'manager') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_profile_id = v_uid then
    raise exception 'cannot_change_self' using errcode = '42501';
  end if;
  select p.* into v_p from public.profiles p where p.id = p_profile_id for update;
  if not found or v_p.role = 'admin' then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if not v_p.active then
    raise exception 'account_inactive' using errcode = 'P0001';
  end if;
  perform private.assert_venue_assignable(p_venue_id);
  if p_venue_id is null then
    raise exception 'venue_inactive' using errcode = 'P0001';
  end if;

  select m.* into v_open from public.venue_memberships m
  where m.profile_id = p_profile_id and m.venue_id = p_venue_id and m.ended_at is null
  for update;
  select g.id into v_grant from public.venue_manager_grants g
  where g.staff_id = p_profile_id and g.venue_id = p_venue_id and g.revoked_at is null
  for update;

  if p_role = 'staff' then
    if v_grant is not null then
      update public.venue_manager_grants g
      set revoked_at = now(), revoked_by = v_uid, revoke_kind = 'role_changed', revoke_reason = v_reason
      where g.id = v_grant;
      insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
      values (p_venue_id, 'manager_grant', v_grant, v_uid, 'admin', 'revoked', v_reason,
        jsonb_build_object('staffId', p_profile_id));
    end if;
    if v_p.venue_id = p_venue_id and v_p.role <> 'staff' then
      perform private.membership_switch_profile(p_profile_id, p_venue_id, 'staff');
    end if;
    return private.membership_ensure(p_profile_id, p_venue_id, 'staff', 'admin', v_uid, v_reason);
  end if;

  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_grant is null then
    insert into public.venue_manager_grants (staff_id, venue_id, granted_by, grant_reason)
    values (p_profile_id, p_venue_id, v_uid, v_reason)
    returning id into v_grant;
    insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
    values (p_venue_id, 'manager_grant', v_grant, v_uid, 'admin', 'granted', v_reason,
      jsonb_build_object('staffId', p_profile_id));
  end if;
  v_id := private.membership_ensure(p_profile_id, p_venue_id, 'manager', 'admin', v_uid, v_reason);
  if v_p.venue_id = p_venue_id and v_p.role <> 'manager' then
    perform private.membership_switch_profile(p_profile_id, p_venue_id, 'manager');
    perform private.membership_end_venue_work(p_profile_id, p_venue_id, v_uid, 'unassigned',
      'No longer staff at this venue.');
  end if;
  return v_id;
end;
$$;

-- Hands a person's open assignments at a venue to a colleague working there
-- (A6: reassign work when someone leaves). Manager of the venue or admin.
create function public.reassign_open_work(
  p_from_profile_id uuid,
  p_to_profile_id uuid,
  p_venue_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_can_manage_venue(p_venue_id);
  v_reason text := private.require_reason(p_reason);
begin
  if not exists (
    select 1 from public.venue_memberships m
    where m.profile_id = p_from_profile_id and m.venue_id = p_venue_id
  ) then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  return private.membership_reassign_work(p_from_profile_id, p_to_profile_id, p_venue_id, v_uid, v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.membership_end_venue_work(uuid, uuid, uuid, text, text),
  private.membership_reassign_work(uuid, uuid, uuid, uuid, text),
  private.membership_switch_profile(uuid, uuid, text)
from public, anon;
grant execute on function
  private.membership_end_venue_work(uuid, uuid, uuid, text, text),
  private.membership_reassign_work(uuid, uuid, uuid, uuid, text),
  private.membership_switch_profile(uuid, uuid, text)
to authenticated, service_role;

revoke all on function
  public.my_venue_memberships(),
  public.venue_team(uuid),
  public.person_venue_privileges(uuid),
  public.switch_active_venue(uuid),
  public.manager_invite_staff(uuid, uuid, text, text),
  public.remove_venue_member(uuid, uuid, text, uuid),
  public.admin_set_venue_membership(uuid, uuid, text, text),
  public.reassign_open_work(uuid, uuid, uuid, text)
from public, anon, service_role;
grant execute on function
  public.my_venue_memberships(),
  public.venue_team(uuid),
  public.person_venue_privileges(uuid),
  public.switch_active_venue(uuid),
  public.manager_invite_staff(uuid, uuid, text, text),
  public.remove_venue_member(uuid, uuid, text, uuid),
  public.admin_set_venue_membership(uuid, uuid, text, text),
  public.reassign_open_work(uuid, uuid, uuid, text)
to authenticated;
