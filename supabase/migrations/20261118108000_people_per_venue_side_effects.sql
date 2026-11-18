-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R5, R6; FA-22, AC14, AC34).
--
-- R5  The three legacy side-effect triggers on profiles (revoke manager
--     grants, end coverage assignments, clear amenity assignees) still acted
--     on the whole account. Under per-venue memberships (20261118101000) the
--     profile's venue and role are only the ACTIVE venue, so a conversion or
--     a legacy transfer silently revoked a grant, ended a manager membership
--     and dropped work at the person's OTHER venues. Their bodies now act on
--     the venues the change is about:
--       * deactivation, or a move to admin: every venue (as before);
--       * a venue change (transfer): the venue left (old.venue_id);
--       * a role change: the venue whose role changed (new.venue_id).
--     convert_account_to_manager / convert_manager_to_staff read the grant
--     for the venues they change (was: any open grant, at random).
-- R6  remove_venue_member deactivated the whole account when the person's
--     other memberships were at temporarily inactive venues (or were a
--     manager membership without a grant), ending those memberships too. It
--     now deactivates only when no open membership remains anywhere. When
--     the removed venue was the person's active venue, they move to a
--     remaining membership at an active venue (with rights there first). If
--     every remaining membership is at an inactive venue, a staff profile
--     cannot point there, so a manager is refused (needs_admin: they may not
--     change another pub's memberships, M5) and an admin's removal
--     deactivates as before. A removal at a venue that is not the active one
--     only ends that membership.
--
-- Rollback: a forward migration restoring the 20261107100100 / 20261102140000
-- / 20261107120000 / 20261118101100 bodies.

-- ---------------------------------------------------------------------------
-- R5: legacy side effects, scoped per venue
-- ---------------------------------------------------------------------------

-- The venues a non-switch profile update affects, or NULL for every venue
-- (deactivation, or the account became an admin). p_role_scope: whether a
-- role change affects new.venue_id (callers decide which role changes count).
create function private.profile_change_venues(
  p_old public.profiles,
  p_new public.profiles,
  p_role_scope boolean
)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_new.active or p_new.role = 'admin' then null
    else array_remove(array[
      case when p_new.venue_id is distinct from p_old.venue_id then p_old.venue_id end,
      case when p_role_scope and p_new.role is distinct from p_old.role then p_new.venue_id end
    ], null)
  end;
$$;

-- Body as in 20261107100100, scoped per venue (R5).
create or replace function private.profiles_revoke_manager_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_actor uuid;
  v_venues uuid[];
begin
  if new.role is distinct from old.role then
    v_kind := 'role_changed';
  elsif new.active is distinct from old.active and not new.active then
    v_kind := 'deactivated';
  elsif new.venue_id is distinct from old.venue_id then
    v_kind := 'venue_changed';
  else
    return null;
  end if;
  v_venues := private.profile_change_venues(old, new, true);

  select p.id into v_actor from public.profiles p where p.id = auth.uid();

  with revoked as (
    update public.venue_manager_grants g
    set revoked_at = now(), revoked_by = v_actor, revoke_kind = v_kind
    where g.staff_id = new.id and g.revoked_at is null
      and (v_venues is null or g.venue_id = any(v_venues))
    returning g.id, g.venue_id
  )
  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, after)
  select r.venue_id, 'manager_grant', r.id, v_actor,
    private.coverage_actor_role(r.venue_id), 'auto_revoked',
    jsonb_build_object('kind', v_kind, 'staffId', new.id)
  from revoked r;

  return null;
end;
$$;

-- Body as in 20261102140000, scoped per venue (R5). A role change ends work
-- only when the new role there is not staff, as before.
create or replace function private.profiles_end_coverage_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_reason text;
  v_actor uuid;
  v_venues uuid[];
begin
  if new.active is distinct from old.active and not new.active then
    v_kind := 'deactivated';
    v_reason := 'Account deactivated.';
  elsif new.venue_id is distinct from old.venue_id then
    v_kind := 'transferred';
    v_reason := 'Moved to another venue.';
  elsif new.role is distinct from old.role and new.role <> 'staff' then
    v_kind := 'unassigned';
    v_reason := 'No longer a staff account.';
  else
    return null;
  end if;
  v_venues := private.profile_change_venues(old, new, new.role <> 'staff');

  select p.id into v_actor from public.profiles p where p.id = auth.uid();

  with ended as (
    update public.coverage_requirement_assignees a
    set ended_at = now(), ended_by = v_actor, end_kind = v_kind, end_reason = v_reason
    where a.staff_id = new.id and a.ended_at is null
      and (v_venues is null or a.venue_id = any(v_venues))
    returning a.id, a.venue_id, a.requirement_id
  )
  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
  select e.venue_id, 'assignment', e.id, v_actor, private.coverage_actor_role(e.venue_id),
    'auto_ended', v_reason,
    jsonb_build_object('kind', v_kind, 'staffId', new.id, 'requirementId', e.requirement_id)
  from ended e;

  return null;
end;
$$;

-- Body as in 20261107120000, scoped per venue (R5).
create or replace function private.profiles_end_amenity_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check record;
  v_venues uuid[];
begin
  if new.venue_id is not distinct from old.venue_id
     and new.active is not distinct from old.active
     and new.role is not distinct from old.role then
    return null;
  end if;
  v_venues := private.profile_change_venues(old, new, new.role <> 'staff');
  if v_venues is not null and cardinality(v_venues) = 0 then
    return null;
  end if;

  for v_check in
    update public.venue_amenity_checks c
    set assignee_user_id = null, revision = c.revision + 1
    where c.assignee_user_id = new.id
      and (v_venues is null or c.venue_id = any(v_venues))
    returning c.id, c.venue_id
  loop
    perform private.amenity_event(v_check.id, v_check.venue_id, 'unassigned', null,
      jsonb_build_object('cause', 'assignee_left', 'previousAssigneeId', new.id));
  end loop;
  return null;
end;
$$;

-- Body as in 20261107100100, except that the "before" grant is the one at
-- the venues the conversion changes (R5).
create or replace function public.convert_account_to_manager(
  p_profile_id uuid,
  p_venue_id uuid,
  p_reason text,
  p_client_request_key text
)
returns table (profile_id uuid, role public.app_role, venue_id uuid, grant_id uuid, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- The only admin gate: the definer context bypasses profiles_guard.
  v_admin uuid := private.assert_active_admin();
  v_reason text;
  v_hash text;
  v_prior public.coverage_audit_events;
  v_p public.profiles;
  v_old_grant uuid;
  v_grant uuid;
begin
  perform private.assert_request_key(p_client_request_key);
  v_reason := private.require_reason(p_reason);
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'op', 'to_manager', 'profile', p_profile_id, 'venue', p_venue_id)::text, 'UTF8')), 'hex');
  perform private.lock_coverage_request(v_admin, p_client_request_key);

  v_prior := private.account_conversion_replay(v_admin, p_client_request_key, v_hash);
  if v_prior.id is not null then
    return query select p_profile_id, 'manager'::public.app_role,
      (v_prior.after ->> 'venueId')::uuid, (v_prior.after ->> 'grantId')::uuid, true;
    return;
  end if;

  if p_profile_id = v_admin then
    raise exception 'cannot_convert_self' using errcode = '42501';
  end if;
  select p.* into v_p from public.profiles p where p.id = p_profile_id for update;
  if not found or v_p.role = 'admin' then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if not v_p.active or v_p.role <> 'staff' then
    raise exception 'account_not_eligible' using errcode = 'P0001', detail = v_p.role::text;
  end if;
  if p_venue_id is null or not exists (
    select 1 from public.venues v where v.id = p_venue_id and v.active
  ) then
    raise exception 'venue_inactive' using errcode = 'P0001';
  end if;

  select g.id into v_old_grant
  from public.venue_manager_grants g
  where g.staff_id = p_profile_id and g.revoked_at is null
    and g.venue_id in (v_p.venue_id, p_venue_id)
  order by (g.venue_id = v_p.venue_id) desc, g.granted_at desc, g.id
  limit 1
  for update;

  -- AFTER trigger: revokes the grant at the changed venues as role_changed
  -- and ends assignments there. Grants and work at other venues stay.
  update public.profiles p set role = 'manager', venue_id = p_venue_id
  where p.id = p_profile_id;

  insert into public.venue_manager_grants (staff_id, venue_id, granted_by, grant_reason)
  values (p_profile_id, p_venue_id, v_admin, v_reason)
  returning id into v_grant;

  perform private.coverage_audit(p_venue_id, 'manager_grant', v_grant, 'granted', v_reason,
    null, jsonb_build_object('staffId', p_profile_id, 'via', 'account_conversion'));
  perform private.coverage_audit(p_venue_id, 'account_role', p_profile_id, 'converted_to_manager', v_reason,
    jsonb_build_object('role', 'staff', 'venueId', v_p.venue_id, 'grantId', v_old_grant),
    jsonb_build_object('role', 'manager', 'venueId', p_venue_id, 'grantId', v_grant,
      'requestKey', p_client_request_key, 'requestHash', v_hash));

  return query select p_profile_id, 'manager'::public.app_role, p_venue_id, v_grant, false;
end;
$$;

-- Body as in 20261107100100, except that the "before" grant is the one at
-- the venues the conversion changes (R5).
create or replace function public.convert_manager_to_staff(
  p_profile_id uuid,
  p_venue_id uuid,
  p_reason text,
  p_client_request_key text
)
returns table (profile_id uuid, role public.app_role, venue_id uuid, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_admin uuid := private.assert_active_admin();
  v_reason text;
  v_hash text;
  v_prior public.coverage_audit_events;
  v_p public.profiles;
  v_old_grant uuid;
begin
  perform private.assert_request_key(p_client_request_key);
  v_reason := private.require_reason(p_reason);
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'op', 'to_staff', 'profile', p_profile_id, 'venue', p_venue_id)::text, 'UTF8')), 'hex');
  perform private.lock_coverage_request(v_admin, p_client_request_key);

  v_prior := private.account_conversion_replay(v_admin, p_client_request_key, v_hash);
  if v_prior.id is not null then
    return query select p_profile_id, 'staff'::public.app_role,
      (v_prior.after ->> 'venueId')::uuid, true;
    return;
  end if;

  if p_profile_id = v_admin then
    raise exception 'cannot_convert_self' using errcode = '42501';
  end if;
  select p.* into v_p from public.profiles p where p.id = p_profile_id for update;
  if not found or v_p.role = 'admin' then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if not v_p.active or v_p.role <> 'manager' then
    raise exception 'account_not_eligible' using errcode = 'P0001', detail = v_p.role::text;
  end if;
  if p_venue_id is null or not exists (
    select 1 from public.venues v where v.id = p_venue_id and v.active
  ) then
    raise exception 'venue_inactive' using errcode = 'P0001';
  end if;

  select g.id into v_old_grant
  from public.venue_manager_grants g
  where g.staff_id = p_profile_id and g.revoked_at is null
    and g.venue_id in (v_p.venue_id, p_venue_id)
  order by (g.venue_id = v_p.venue_id) desc, g.granted_at desc, g.id
  limit 1
  for update;

  -- AFTER trigger: revokes the grant at the changed venues as role_changed.
  update public.profiles p set role = 'staff', venue_id = p_venue_id
  where p.id = p_profile_id;

  perform private.coverage_audit(p_venue_id, 'account_role', p_profile_id, 'converted_to_staff', v_reason,
    jsonb_build_object('role', 'manager', 'venueId', v_p.venue_id, 'grantId', v_old_grant),
    jsonb_build_object('role', 'staff', 'venueId', p_venue_id,
      'requestKey', p_client_request_key, 'requestHash', v_hash));

  return query select p_profile_id, 'staff'::public.app_role, p_venue_id, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- R6: removal deactivates only when no membership remains anywhere
-- ---------------------------------------------------------------------------

-- Body as in 20261118101100, except how the account ends up (R6): it is
-- deactivated only when no open membership remains anywhere; see the header.
create or replace function public.remove_venue_member(
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
  v_next_venue uuid;
  v_next_role text;
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

  if not exists (
    select 1 from public.venue_memberships m
    where m.profile_id = p_profile_id and m.ended_at is null
  ) then
    -- No membership left anywhere: the account is deactivated (AC34).
    perform private.membership_remove_deactivate(p_profile_id);
    return query select 'deactivated'::text, null::uuid, v_moved;
    return;
  end if;

  if v_p.venue_id = p_venue_id then
    -- The next venue: an active one where the person has rights first, then
    -- any remaining membership at an active venue.
    select m.venue_id, coalesce(private.venue_role_of(p_profile_id, m.venue_id), m.role)
    into v_next_venue, v_next_role
    from public.venue_memberships m
    join public.venues v on v.id = m.venue_id and v.active
    where m.profile_id = p_profile_id and m.ended_at is null
    order by (private.venue_role_of(p_profile_id, m.venue_id) is not null) desc,
      m.granted_at, m.id
    limit 1;

    if v_next_venue is null then
      -- Every remaining membership is at an inactive venue.
      if not v_admin then
        raise exception 'needs_admin' using errcode = 'P0001',
          detail = 'This person also belongs to a venue that is closed for now. Ask an admin.';
      end if;
      perform private.membership_remove_deactivate(p_profile_id);
      return query select 'deactivated'::text, null::uuid, v_moved;
      return;
    end if;
    perform private.membership_switch_profile(p_profile_id, v_next_venue, v_next_role);
  end if;

  perform private.membership_end_venue_work(p_profile_id, p_venue_id, v_uid, 'transferred',
    'Removed from this venue.');
  return query
  select 'removed'::text, p.venue_id, v_moved from public.profiles p where p.id = p_profile_id;
end;
$$;

-- Deactivates the account as a membership command (legacy side effects apply).
create function private.membership_remove_deactivate(p_profile uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('nabalens.membership_op', 'on', true);
  update public.profiles p set active = false where p.id = p_profile;
  perform set_config('nabalens.membership_op', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.profile_change_venues(public.profiles, public.profiles, boolean)
  from public, anon, authenticated;
revoke all on function private.membership_remove_deactivate(uuid) from public, anon, authenticated;
