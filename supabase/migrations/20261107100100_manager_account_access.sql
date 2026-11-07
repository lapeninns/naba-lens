-- Venue manager accounts (part 2 of 3): classification, grants, conversion.
--
-- A venue manager is an account with role 'manager'. It manages a venue only
-- while it holds an open grant for the venue it is assigned to and that venue
-- is active (private.effective_manager_venue_id). An admin turns a staff
-- account into a manager account, or back, with one audited conversion that
-- keeps the user id, photos, credit and history.
--
-- Transitional rule: grants already held by staff accounts stay effective
-- until an admin converts the pilot accounts; a later migration then tightens
-- the effective grant to manager accounts only. New grants go to manager
-- accounts only.

-- ---------------------------------------------------------------------------
-- Classification and the effective grant
-- ---------------------------------------------------------------------------

-- Account classification (not scope): denials keep applying after a revoke.
create function private.is_active_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'manager'
  );
$$;

-- Effective grant: an active staff or manager account, its open grant, the
-- grant venue is the account's current venue and the venue is active.
create or replace function private.effective_manager_venue_id(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.venue_id
  from public.venue_manager_grants g
  join public.profiles p
    on p.id = g.staff_id and p.active and p.role in ('staff', 'manager')
      and p.venue_id = g.venue_id
  join public.venues v on v.id = g.venue_id and v.active
  where g.staff_id = p_user and g.revoked_at is null
  limit 1;
$$;

comment on table public.venue_manager_grants is
  'Admin-managed venue manager rights. Effective only for an active account currently assigned to the active granted venue; new grants go to manager accounts only.';

-- ---------------------------------------------------------------------------
-- Automatic revocation: any role change now revokes, in either direction
-- ---------------------------------------------------------------------------

create or replace function private.profiles_revoke_manager_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_actor uuid;
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

  select p.id into v_actor from public.profiles p where p.id = auth.uid();

  with revoked as (
    update public.venue_manager_grants g
    set revoked_at = now(), revoked_by = v_actor, revoke_kind = v_kind
    where g.staff_id = new.id and g.revoked_at is null
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

-- ---------------------------------------------------------------------------
-- Audit entity, manager audit visibility, admin RLS on manager rows
-- ---------------------------------------------------------------------------

alter table public.coverage_audit_events drop constraint coverage_audit_events_entity_check;
alter table public.coverage_audit_events add constraint coverage_audit_events_entity_check
  check (entity in (
    'manager_grant', 'requirement', 'assignment', 'monthly_target',
    'amenity_fact', 'menu_plan', 'preparation', 'account_role'
  ));

-- Account and grant rows carry admins' reasons about colleagues and request
-- keys: managers never read them.
drop policy coverage_audit_events_select_manager on public.coverage_audit_events;
create policy coverage_audit_events_select_manager on public.coverage_audit_events
  for select to authenticated
  using (
    venue_id = (select private.my_manager_venue_id())
    and entity not in ('account_role', 'manager_grant')
  );

-- Admins can deactivate or transfer a manager (the trigger above revokes the
-- grant). profiles_guard still blocks role changes in an end-user context.
drop policy profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select private.is_active_admin()) and (role in ('staff', 'manager') or id = (select auth.uid())))
  with check (role in ('staff', 'manager') or id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants (admin): new grants only for manager accounts
-- ---------------------------------------------------------------------------

-- Idempotent: an open grant for the same person and venue is returned as is.
create or replace function public.grant_venue_manager(
  p_staff_id uuid,
  p_venue_id uuid,
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
  v_existing public.venue_manager_grants;
  v_id uuid;
begin
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;

  -- Serialises with a concurrent transfer/deactivation of the same person.
  perform 1 from public.profiles p where p.id = p_staff_id for update;
  if not found then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.profiles p
    join public.venues v on v.id = p.venue_id and v.active
    where p.id = p_staff_id and p.active and p.role = 'manager' and p.venue_id = p_venue_id
  ) then
    raise exception 'staff_not_eligible' using errcode = 'P0001',
      detail = 'Only active venue manager accounts assigned to this active venue can manage it.';
  end if;

  select g.* into v_existing
  from public.venue_manager_grants g
  where g.staff_id = p_staff_id and g.revoked_at is null
  for update;
  if found then
    if v_existing.venue_id = p_venue_id then
      return v_existing.id;
    end if;
    update public.venue_manager_grants g
    set revoked_at = now(), revoked_by = v_uid, revoke_kind = 'venue_changed'
    where g.id = v_existing.id;
  end if;

  insert into public.venue_manager_grants (staff_id, venue_id, granted_by, grant_reason)
  values (p_staff_id, p_venue_id, v_uid, v_reason)
  returning id into v_id;

  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
  values (p_venue_id, 'manager_grant', v_id, v_uid, 'admin', 'granted', v_reason,
    jsonb_build_object('staffId', p_staff_id));

  return v_id;
end;
$$;

-- Body as in 20261102150000, except that a manager account counts as active.
create or replace function public.venue_manager_grant_list(
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
  select g.id, g.staff_id, s.display_name, s.active and s.role in ('staff', 'manager'), s.venue_id,
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

-- Manager accounts at the venue without an open grant there (the grant form).
create function public.manager_grant_candidates(p_venue_id uuid)
returns table (id uuid, display_name text, venue_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_active_admin();
  return query
  select p.id, p.display_name, p.venue_id
  from public.profiles p
  join public.venues v on v.id = p.venue_id and v.active
  where p.venue_id = p_venue_id and p.active and p.role = 'manager'
    and not exists (
      select 1 from public.venue_manager_grants g
      where g.staff_id = p.id and g.revoked_at is null and g.venue_id = p_venue_id
    )
  order by p.display_name, p.id
  limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspace scope: the one read the /manager guard depends on
-- ---------------------------------------------------------------------------

-- `effective` is true only for an active manager account whose effective grant
-- is for its current venue: the same predicate as can_manage_venue, so the
-- layout gate and the database gate cannot drift. Zero rows without a profile.
create function public.manager_workspace_scope()
returns table (
  user_id uuid,
  display_name text,
  role public.app_role,
  active boolean,
  venue_id uuid,
  venue_name text,
  venue_active boolean,
  grant_id uuid,
  grant_venue_id uuid,
  effective boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.role, p.active, p.venue_id, v.name, coalesce(v.active, false),
    g.id, g.venue_id,
    (p.active and p.role = 'manager' and p.venue_id is not null
      and private.effective_manager_venue_id(p.id) is not distinct from p.venue_id)
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  left join public.venue_manager_grants g on g.staff_id = p.id and g.revoked_at is null
  where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Conversion (admin): staff <-> manager, atomic and audited
-- ---------------------------------------------------------------------------

-- A replay with the same key returns the first result; the same key with a
-- different payload (another profile, venue or direction) is refused.
create function private.account_conversion_replay(
  p_admin uuid,
  p_key text,
  p_hash text
)
returns public.coverage_audit_events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prior public.coverage_audit_events;
begin
  select e.* into v_prior
  from public.coverage_audit_events e
  where e.entity = 'account_role' and e.actor_id = p_admin
    and e.after ->> 'requestKey' = p_key
  order by e.id
  limit 1;
  if found and v_prior.after ->> 'requestHash' is distinct from p_hash then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  return v_prior;
end;
$$;

-- Staff account -> manager account with a grant for p_venue_id. The account
-- is assigned to p_venue_id. Its old grant (if any) is revoked as
-- role_changed by the profile trigger and the new grant is inserted in the
-- same transaction. Photos, labels, submissions, targets and review history
-- are not touched.
create function public.convert_account_to_manager(
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
  for update;

  -- AFTER trigger: revokes v_old_grant as role_changed and ends assignments.
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

-- Manager account -> staff account at p_venue_id. The profile trigger revokes
-- the grant as role_changed. No grant is inserted.
create function public.convert_manager_to_staff(
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
  for update;

  -- AFTER trigger: revokes v_old_grant as role_changed.
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
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.is_active_manager(),
  private.account_conversion_replay(uuid, text, text)
from public, anon;

grant execute on function private.is_active_manager() to authenticated, service_role;
grant execute on function private.account_conversion_replay(uuid, text, text) to service_role;

revoke all on function
  public.manager_grant_candidates(uuid),
  public.manager_workspace_scope(),
  public.convert_account_to_manager(uuid, uuid, text, text),
  public.convert_manager_to_staff(uuid, uuid, text, text)
from public, anon;

-- The conversion and candidate functions assert an active admin in the body.
grant execute on function
  public.manager_grant_candidates(uuid),
  public.manager_workspace_scope(),
  public.convert_account_to_manager(uuid, uuid, text, text),
  public.convert_manager_to_staff(uuid, uuid, text, text)
to authenticated, service_role;
