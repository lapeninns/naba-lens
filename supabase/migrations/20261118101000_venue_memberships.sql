-- Per-venue memberships (Full App v1, S1-PEOPLE; spec §3.1, §11; FA-22).
--
-- A person can be staff at one venue and manager at another (AC14). The new
-- table public.venue_memberships records, per person and venue, the role
-- (staff | manager), who granted it, why, and how it ended. Rows are
-- append-only history: a role change at a venue ends the row and opens a new
-- one; nothing is deleted.
--
-- Active venue (projection). Every existing access rule (about 140 checks)
-- reads profiles.role, profiles.venue_id and the open venue_manager_grants.
-- Rather than rewrite them, the profile keeps the person's ACTIVE venue and
-- their role THERE: public.switch_active_venue (next migration) moves the
-- profile to another venue the person already belongs to, taking that
-- membership's role. Changing venue filters existing permissions and never
-- grants access, because the switch only accepts an open membership.
-- Manager rights still need an open grant for the venue (unchanged rule);
-- a manager membership and its grant are opened and closed together.
--
-- Sync (keeps old write paths working):
--   * profiles insert / transfer / role change / (re)activation opens or
--     ends membership rows (profiles_sync_venue_memberships);
--   * a grant opens a manager membership; a revoked grant ends it
--     (venue_manager_grants_sync_memberships);
--   * the three legacy side-effect triggers on profiles (revoke grants, end
--     coverage assignments, clear amenity assignees) skip a venue switch,
--     so moving between one's own venues keeps work and grants elsewhere.
-- One open grant per person and venue (was: per person), so a person can
-- manage several venues. grant_venue_manager no longer revokes a grant at
-- another venue, and manager_workspace_scope reads the grant for the
-- active venue.
--
-- Rollback: a forward migration that restores the one-open-grant index
-- (after revoking extra grants), the earlier bodies of grant_venue_manager
-- and manager_workspace_scope (20261107100100) and deny_manager_coverage_writes
-- (20261107100200), recreates the three legacy triggers without the WHEN
-- clause and drops the sync triggers. The membership table can stay.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.venue_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  role text not null check (role in ('staff', 'manager')),
  -- How the row was opened: backfill (this migration), profile (invite,
  -- transfer, conversion, reactivation), admin (membership command),
  -- manager_invite (a manager added ordinary staff), manager_grant (a grant).
  source text not null check (source in ('backfill', 'profile', 'admin', 'manager_invite', 'manager_grant')),
  -- NULL for the service role, backfill and other system actions.
  granted_by uuid references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  grant_reason text check (grant_reason is null or length(grant_reason) between 1 and 500),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete restrict,
  end_kind text check (end_kind in (
    'removed', 'deactivated', 'role_changed', 'venue_changed', 'account_role_changed'
  )),
  end_reason text check (end_reason is null or length(end_reason) between 1 and 500),
  constraint venue_memberships_ended_pair check ((ended_at is null) = (end_kind is null))
);

create unique index venue_memberships_one_open
  on public.venue_memberships (profile_id, venue_id) where ended_at is null;
create index venue_memberships_venue_open_idx
  on public.venue_memberships (venue_id) where ended_at is null;
create index venue_memberships_profile_idx
  on public.venue_memberships (profile_id, granted_at desc);

comment on table public.venue_memberships is
  'Per-venue membership history (FA-22). Open rows are the venues a person belongs to and their role there; profiles.venue_id/role hold the active one.';

create function private.venue_memberships_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ended_at is not null or new.ended_by is not null
     or new.end_kind is not null or new.end_reason is not null then
    raise exception 'membership_must_start_open' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Only the end fields change, once.
create function private.venue_memberships_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.ended_at is not null
     or new.id is distinct from old.id
     or new.profile_id is distinct from old.profile_id
     or new.venue_id is distinct from old.venue_id
     or new.role is distinct from old.role
     or new.source is distinct from old.source
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.grant_reason is distinct from old.grant_reason then
    raise exception 'membership_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger venue_memberships_insert_guard
  before insert on public.venue_memberships
  for each row execute function private.venue_memberships_insert_guard();
create trigger venue_memberships_guard
  before update on public.venue_memberships
  for each row execute function private.venue_memberships_guard();
create trigger venue_memberships_no_delete
  before delete on public.venue_memberships
  for each row execute function private.append_only_guard();
create trigger venue_memberships_no_truncate
  before truncate on public.venue_memberships
  for each statement execute function private.append_only_guard();

alter table public.venue_memberships enable row level security;
revoke all on table public.venue_memberships from public, anon, authenticated, service_role;
grant select on table public.venue_memberships to service_role;

-- ---------------------------------------------------------------------------
-- Transaction-local flags (set only inside the security definer commands)
-- ---------------------------------------------------------------------------

-- True while public.switch_active_venue (or a membership command acting like
-- it) moves the profile between the person's own venues.
create function private.venue_switch_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('nabalens.venue_switch', true), '') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- Row helpers (used by the sync triggers and the commands)
-- ---------------------------------------------------------------------------

create function private.membership_end(
  p_id uuid,
  p_kind text,
  p_by uuid,
  p_reason text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.venue_memberships m
  set ended_at = now(), end_kind = p_kind,
    ended_by = (select p.id from public.profiles p where p.id = p_by),
    end_reason = left(nullif(btrim(p_reason), ''), 500)
  where m.id = p_id and m.ended_at is null;
$$;

-- The open membership for (profile, venue) with this role: returned as is,
-- or the open row with another role is ended (role_changed) and replaced.
create function private.membership_ensure(
  p_profile uuid,
  p_venue uuid,
  p_role text,
  p_source text,
  p_by uuid,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_open public.venue_memberships;
  v_by uuid := (select p.id from public.profiles p where p.id = p_by);
  v_id uuid;
begin
  select m.* into v_open
  from public.venue_memberships m
  where m.profile_id = p_profile and m.venue_id = p_venue and m.ended_at is null
  for update;
  if found then
    if v_open.role = p_role then
      return v_open.id;
    end if;
    perform private.membership_end(v_open.id, 'role_changed', v_by, null);
  end if;
  insert into public.venue_memberships (profile_id, venue_id, role, source, granted_by, grant_reason)
  values (p_profile, p_venue, p_role, p_source, v_by, left(nullif(btrim(p_reason), ''), 500))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Effective role per venue (the rule every privileges read uses)
-- ---------------------------------------------------------------------------

-- 'admin' (every active venue), 'manager' (open manager membership AND an
-- open grant for the venue), 'staff' (open staff membership), or NULL. The
-- person and venue must be active. This is the role that applies while the
-- venue is the person's active venue; at other venues nothing applies until
-- they switch (admins excepted).
create function private.venue_role_of(p_user uuid, p_venue uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.role = 'admin' then 'admin'
    when exists (
      select 1 from public.venue_memberships m
      where m.profile_id = p.id and m.venue_id = v.id and m.ended_at is null and m.role = 'manager'
    ) and exists (
      select 1 from public.venue_manager_grants g
      where g.staff_id = p.id and g.venue_id = v.id and g.revoked_at is null
    ) then 'manager'
    when exists (
      select 1 from public.venue_memberships m
      where m.profile_id = p.id and m.venue_id = v.id and m.ended_at is null and m.role = 'staff'
    ) then 'staff'
  end
  from public.profiles p
  join public.venues v on v.id = p_venue and v.active
  where p.id = p_user and p.active;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: one open membership per active staff/manager profile
-- ---------------------------------------------------------------------------

-- A manager account without an open grant at its venue has no workspace
-- today ("access ended") and gets no membership; an admin re-grants.
insert into public.venue_memberships (profile_id, venue_id, role, source, granted_at)
select p.id, p.venue_id,
  case when g.id is not null then 'manager' else 'staff' end,
  'backfill', coalesce(g.granted_at, p.created_at)
from public.profiles p
left join lateral (
  select g.id, g.granted_at from public.venue_manager_grants g
  where g.staff_id = p.id and g.venue_id = p.venue_id and g.revoked_at is null
  order by g.granted_at desc
  limit 1
) g on true
where p.active and p.venue_id is not null
  and (p.role = 'staff' or (p.role = 'manager' and g.id is not null));

-- ---------------------------------------------------------------------------
-- Several open grants per person (one per venue)
-- ---------------------------------------------------------------------------

drop index public.venue_manager_grants_one_open;
create unique index venue_manager_grants_one_open
  on public.venue_manager_grants (staff_id, venue_id) where revoked_at is null;

comment on table public.venue_manager_grants is
  'Admin-managed venue manager rights, one open grant per person and venue. Effective only for an active account whose active venue (profiles.venue_id) is the active granted venue.';

-- Body as in 20261107100100, except that an open grant at another venue is
-- left alone (a person may manage several venues; FA-22).
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
  v_existing uuid;
  v_id uuid;
begin
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;

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

  select g.id into v_existing
  from public.venue_manager_grants g
  where g.staff_id = p_staff_id and g.venue_id = p_venue_id and g.revoked_at is null
  for update;
  if found then
    return v_existing;
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

-- Body as in 20261107100100, except that the grant shown is the one for the
-- active venue when there is one (several open grants may exist).
create or replace function public.manager_workspace_scope()
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
  left join lateral (
    select g.id, g.venue_id
    from public.venue_manager_grants g
    where g.staff_id = p.id and g.revoked_at is null
    order by (g.venue_id = p.venue_id) desc, g.granted_at desc
    limit 1
  ) g on true
  where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Legacy side-effect triggers skip a venue switch
-- ---------------------------------------------------------------------------

drop trigger profiles_revoke_manager_grants on public.profiles;
create trigger profiles_revoke_manager_grants
  after update of venue_id, active, role on public.profiles
  for each row
  when (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on')
  execute function private.profiles_revoke_manager_grants();

drop trigger profiles_end_coverage_assignments on public.profiles;
create trigger profiles_end_coverage_assignments
  after update of venue_id, active, role on public.profiles
  for each row
  when (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on')
  execute function private.profiles_end_coverage_assignments();

drop trigger profiles_end_amenity_assignments on public.profiles;
create trigger profiles_end_amenity_assignments
  after update of venue_id, active, role on public.profiles
  for each row
  when (coalesce(current_setting('nabalens.venue_switch', true), '') <> 'on')
  execute function private.profiles_end_amenity_assignments();

-- Body as in 20261107100200, plus: a departure or reassignment made by the
-- membership commands (a manager removing staff ends that person's legacy
-- coverage assignments) is a system side effect, not a manager coverage
-- write. The flag is set only inside those security definer commands.
create or replace function private.deny_manager_coverage_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('nabalens.membership_op', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if (select private.is_active_manager()) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync: profiles -> memberships
-- ---------------------------------------------------------------------------

create function private.profiles_sync_venue_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select p.id from public.profiles p where p.id = auth.uid());
  v_source text := coalesce(nullif(current_setting('nabalens.membership_source', true), ''), 'profile');
  v_row record;
begin
  if tg_op = 'INSERT' then
    if new.active and new.role in ('staff', 'manager') and new.venue_id is not null then
      perform private.membership_ensure(new.id, new.venue_id, new.role::text, v_source, v_actor, null);
    end if;
    return null;
  end if;

  if old.active and not new.active then
    for v_row in
      select m.id from public.venue_memberships m where m.profile_id = new.id and m.ended_at is null
    loop
      perform private.membership_end(v_row.id, 'deactivated', v_actor, null);
    end loop;
    return null;
  end if;
  if not new.active then
    return null;
  end if;

  if new.role = 'admin' then
    if old.role is distinct from 'admin' then
      for v_row in
        select m.id from public.venue_memberships m where m.profile_id = new.id and m.ended_at is null
      loop
        perform private.membership_end(v_row.id, 'account_role_changed', v_actor, null);
      end loop;
    end if;
    return null;
  end if;

  -- A transfer (not a switch between own venues) leaves the old venue.
  if new.venue_id is distinct from old.venue_id and old.venue_id is not null
     and not private.venue_switch_active() then
    for v_row in
      select m.id from public.venue_memberships m
      where m.profile_id = new.id and m.venue_id = old.venue_id and m.ended_at is null
    loop
      perform private.membership_end(v_row.id, 'venue_changed', v_actor, null);
    end loop;
  end if;

  if new.venue_id is not null and (
    not old.active
    or new.venue_id is distinct from old.venue_id
    or new.role is distinct from old.role
  ) then
    perform private.membership_ensure(new.id, new.venue_id, new.role::text, v_source, v_actor, null);
  end if;
  return null;
end;
$$;

create trigger profiles_sync_venue_memberships
  after insert or update of venue_id, active, role on public.profiles
  for each row execute function private.profiles_sync_venue_memberships();

-- ---------------------------------------------------------------------------
-- Sync: grants -> manager memberships
-- ---------------------------------------------------------------------------

create function private.venue_manager_grants_sync_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.profiles;
  v_open public.venue_memberships;
begin
  select p.* into v_p from public.profiles p where p.id = new.staff_id;
  if not found or not v_p.active or v_p.role = 'admin' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.membership_ensure(new.staff_id, new.venue_id, 'manager', 'manager_grant',
      new.granted_by, new.grant_reason);
    return null;
  end if;

  if old.revoked_at is null and new.revoked_at is not null then
    select m.* into v_open from public.venue_memberships m
    where m.profile_id = new.staff_id and m.venue_id = new.venue_id
      and m.ended_at is null and m.role = 'manager';
    if found then
      perform private.membership_end(v_open.id,
        case new.revoke_kind
          when 'revoked' then 'removed'
          when 'deactivated' then 'deactivated'
          when 'venue_changed' then 'venue_changed'
          else 'role_changed'
        end,
        new.revoked_by, new.revoke_reason);
    end if;
    -- A staff account (legacy staff-held grant) stays staff at its venue.
    if v_p.role = 'staff' and v_p.venue_id = new.venue_id then
      perform private.membership_ensure(v_p.id, v_p.venue_id, 'staff', 'profile', new.revoked_by, null);
    end if;
  end if;
  return null;
end;
$$;

create trigger venue_manager_grants_sync_memberships
  after insert or update of revoked_at on public.venue_manager_grants
  for each row execute function private.venue_manager_grants_sync_memberships();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.venue_memberships_insert_guard(),
  private.venue_memberships_guard(),
  private.venue_switch_active(),
  private.membership_end(uuid, text, uuid, text),
  private.membership_ensure(uuid, uuid, text, text, uuid, text),
  private.venue_role_of(uuid, uuid),
  private.profiles_sync_venue_memberships(),
  private.venue_manager_grants_sync_memberships()
from public, anon;

grant execute on function
  private.venue_memberships_insert_guard(),
  private.venue_memberships_guard(),
  private.venue_switch_active(),
  private.membership_end(uuid, text, uuid, text),
  private.membership_ensure(uuid, uuid, text, text, uuid, text),
  private.venue_role_of(uuid, uuid),
  private.profiles_sync_venue_memberships(),
  private.venue_manager_grants_sync_memberships()
to authenticated, service_role;
