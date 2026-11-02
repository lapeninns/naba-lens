-- Venue manager grants (staff portfolios and venue coverage, part 1 of 3).
--
-- Roles stay `staff` / `admin`. An admin may grant one active staff member
-- manager rights for the venue they currently work at. The grant is only
-- *effective* while the person is active staff, still assigned to that venue,
-- the venue is active and the grant is unrevoked. Every check below re-reads
-- that state from profiles / venue_manager_grants / venues, so a revocation,
-- transfer or deactivation applies to the very next request of an existing
-- session. JWT claims, metadata, job title and team are never consulted.
--
-- Also here: the Europe/London calendar helpers, the shared text and scope
-- helpers and the append-only audit table that parts 2 and 3 build on.

-- ---------------------------------------------------------------------------
-- Europe/London calendar helpers
-- ---------------------------------------------------------------------------

-- First day of the London calendar month containing the instant.
create function private.london_month(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_at at time zone 'Europe/London'))::date;
$$;

-- UTC instant of London midnight on the first day of the month.
create function private.london_month_start(p_month date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', p_month::timestamp) at time zone 'Europe/London';
$$;

-- Exclusive end of the month: the UTC instant the next London month starts.
create function private.london_month_end(p_month date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Europe/London';
$$;

create function private.london_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/London')::date;
$$;

create function private.current_london_month()
returns date
language sql
stable
set search_path = ''
as $$
  select private.london_month(now());
$$;

-- ---------------------------------------------------------------------------
-- Text helpers
-- ---------------------------------------------------------------------------

-- Trimmed text, NULL when blank. Longer than p_max raises p_code (22023).
create function private.clean_text(p_value text, p_max integer, p_code text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(p_value), '');
begin
  if v_text is not null and length(v_text) > p_max then
    raise exception '%', p_code using errcode = '22023',
      detail = format('At most %s characters.', p_max);
  end if;
  return v_text;
end;
$$;

-- A required reason: 1..500 characters after trimming.
create function private.require_reason(p_reason text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  return v_reason;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.venue_manager_grants (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  granted_by uuid not null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  grant_reason text check (grant_reason is null or (length(grant_reason) between 1 and 500 and grant_reason = btrim(grant_reason))),
  revoked_at timestamptz,
  -- NULL when the system revoked the grant (transfer, deactivation, role change).
  revoked_by uuid references public.profiles (id) on delete restrict,
  revoke_kind text check (revoke_kind in ('revoked', 'venue_changed', 'deactivated', 'role_changed')),
  revoke_reason text check (revoke_reason is null or (length(revoke_reason) between 1 and 500 and revoke_reason = btrim(revoke_reason))),
  constraint venue_manager_grants_revoked_kind check ((revoked_at is null) = (revoke_kind is null)),
  constraint venue_manager_grants_manual_revoke check (
    revoke_kind is distinct from 'revoked' or (revoked_by is not null and revoke_reason is not null)
  )
);

-- One open grant per person: with the automatic revocation below, an open
-- grant always names the venue the person was assigned to when it was made.
create unique index venue_manager_grants_one_open
  on public.venue_manager_grants (staff_id) where revoked_at is null;
create index venue_manager_grants_venue_open_idx
  on public.venue_manager_grants (venue_id) where revoked_at is null;

comment on table public.venue_manager_grants is
  'Admin-managed venue manager rights. Effective only for active staff currently assigned to the active granted venue.';

create table public.coverage_audit_events (
  id bigint generated always as identity primary key,
  venue_id uuid references public.venues (id) on delete restrict,
  entity text not null check (entity in (
    'manager_grant', 'requirement', 'assignment', 'monthly_target',
    'amenity_fact', 'menu_plan', 'preparation'
  )),
  entity_id uuid,
  -- NULL for the scheduler and other system actions.
  actor_id uuid references public.profiles (id) on delete restrict,
  actor_role text not null check (actor_role in ('admin', 'manager', 'staff', 'system')),
  action text not null check (action ~ '^[a-z_]{1,60}$'),
  reason text check (reason is null or length(reason) between 1 and 500),
  historical boolean not null default false,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index coverage_audit_events_venue_idx
  on public.coverage_audit_events (venue_id, created_at desc);
create index coverage_audit_events_entity_idx
  on public.coverage_audit_events (entity, entity_id, created_at desc);

comment on table public.coverage_audit_events is
  'Append-only audit of grants, coverage configuration, targets and monthly preparation.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function private.venue_manager_grants_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revoked_at is not null or new.revoked_by is not null
     or new.revoke_kind is not null or new.revoke_reason is not null then
    raise exception 'manager_grant_must_start_open' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Only the revocation fields change, once.
create function private.venue_manager_grants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null
     or new.id is distinct from old.id
     or new.staff_id is distinct from old.staff_id
     or new.venue_id is distinct from old.venue_id
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.grant_reason is distinct from old.grant_reason then
    raise exception 'manager_grant_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger venue_manager_grants_insert_guard
  before insert on public.venue_manager_grants
  for each row execute function private.venue_manager_grants_insert_guard();
create trigger venue_manager_grants_guard
  before update on public.venue_manager_grants
  for each row execute function private.venue_manager_grants_guard();
create trigger venue_manager_grants_no_delete
  before delete on public.venue_manager_grants
  for each row execute function private.append_only_guard();
create trigger venue_manager_grants_no_truncate
  before truncate on public.venue_manager_grants
  for each statement execute function private.append_only_guard();

create trigger coverage_audit_events_append_only
  before update or delete on public.coverage_audit_events
  for each row execute function private.append_only_guard();
create trigger coverage_audit_events_no_truncate
  before truncate on public.coverage_audit_events
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Scope helpers
-- ---------------------------------------------------------------------------

create function private.effective_manager_venue_id(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.venue_id
  from public.venue_manager_grants g
  join public.profiles p
    on p.id = g.staff_id and p.active and p.role = 'staff' and p.venue_id = g.venue_id
  join public.venues v on v.id = g.venue_id and v.active
  where g.staff_id = p_user and g.revoked_at is null
  limit 1;
$$;

create function private.my_manager_venue_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.effective_manager_venue_id((select auth.uid()));
$$;

create function private.can_manage_venue(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_venue_id is not null
    and (private.is_active_admin() or coalesce(private.my_manager_venue_id() = p_venue_id, false));
$$;

create function private.assert_can_manage_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_venue(p_venue_id) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- The caller's current venue when they are active staff (the venue itself may
-- be inactive: reads stay possible, writes check the venue separately).
create function private.active_staff_venue_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.venue_id from public.profiles p
  where p.id = (select auth.uid()) and p.active and p.role = 'staff';
$$;

-- How the caller acts on a venue, for audit rows.
create function private.coverage_actor_role(p_venue_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'system'
    when private.is_active_admin() then 'admin'
    when p_venue_id is not null and private.my_manager_venue_id() = p_venue_id then 'manager'
    else 'staff'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Automatic revocation on transfer, deactivation or role change
-- ---------------------------------------------------------------------------

-- A transfer never carries manager rights to the destination, and a later
-- transfer back does not quietly restore them: the admin grants again.
create function private.profiles_revoke_manager_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_actor uuid;
begin
  if new.role is distinct from old.role and new.role <> 'staff' then
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

create trigger profiles_revoke_manager_grants
  after update of venue_id, active, role on public.profiles
  for each row execute function private.profiles_revoke_manager_grants();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.venue_manager_grants, public.coverage_audit_events
from public, anon, authenticated;

grant select on public.venue_manager_grants, public.coverage_audit_events to authenticated;
grant select, insert, update on public.venue_manager_grants to service_role;
grant select, insert on public.coverage_audit_events to service_role;
revoke update, delete, truncate on public.coverage_audit_events from service_role;
revoke delete, truncate on public.venue_manager_grants from service_role;

alter table public.venue_manager_grants enable row level security;
alter table public.coverage_audit_events enable row level security;

create policy venue_manager_grants_select_admin on public.venue_manager_grants
  for select to authenticated using ((select private.is_active_admin()));
create policy venue_manager_grants_select_own on public.venue_manager_grants
  for select to authenticated
  using (staff_id = (select auth.uid()) and (select private.is_active_user()));

create policy coverage_audit_events_select_admin on public.coverage_audit_events
  for select to authenticated using ((select private.is_active_admin()));
create policy coverage_audit_events_select_manager on public.coverage_audit_events
  for select to authenticated
  using (venue_id = (select private.my_manager_venue_id()));

-- ---------------------------------------------------------------------------
-- RPCs (active admin)
-- ---------------------------------------------------------------------------

-- Idempotent: an open grant for the same person and venue is returned as is.
create function public.grant_venue_manager(
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
    where p.id = p_staff_id and p.active and p.role = 'staff' and p.venue_id = p_venue_id
  ) then
    raise exception 'staff_not_eligible' using errcode = 'P0001',
      detail = 'Only active staff currently assigned to this active venue can manage it.';
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

-- Idempotent: revoking a revoked grant changes nothing.
create function public.revoke_venue_manager(p_grant_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.require_reason(p_reason);
  v_grant public.venue_manager_grants;
begin
  select g.* into v_grant from public.venue_manager_grants g where g.id = p_grant_id for update;
  if not found then
    raise exception 'manager_grant_not_found' using errcode = 'P0002';
  end if;
  if v_grant.revoked_at is not null then
    return;
  end if;

  update public.venue_manager_grants g
  set revoked_at = now(), revoked_by = v_uid, revoke_kind = 'revoked', revoke_reason = v_reason
  where g.id = p_grant_id;

  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
  values (v_grant.venue_id, 'manager_grant', p_grant_id, v_uid, 'admin', 'revoked', v_reason,
    jsonb_build_object('staffId', v_grant.staff_id));
end;
$$;

-- The caller's scope as the database sees it now. Zero rows without a profile.
create function public.coverage_access_scope()
returns table (
  user_id uuid,
  role public.app_role,
  active boolean,
  venue_id uuid,
  venue_active boolean,
  department text,
  is_admin boolean,
  manager_venue_id uuid,
  manager_grant_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.role, p.active, p.venue_id, coalesce(v.active, false), p.department,
    p.active and p.role = 'admin',
    m.venue_id,
    m.grant_id
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  left join lateral (
    select g.id as grant_id, g.venue_id
    from public.venue_manager_grants g
    where g.staff_id = p.id
      and g.revoked_at is null
      and g.venue_id = private.effective_manager_venue_id(p.id)
  ) m on true
  where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.london_month(timestamptz),
  private.london_month_start(date),
  private.london_month_end(date),
  private.london_today(),
  private.current_london_month(),
  private.clean_text(text, integer, text),
  private.require_reason(text),
  private.venue_manager_grants_insert_guard(),
  private.venue_manager_grants_guard(),
  private.effective_manager_venue_id(uuid),
  private.my_manager_venue_id(),
  private.can_manage_venue(uuid),
  private.assert_can_manage_venue(uuid),
  private.active_staff_venue_id(),
  private.coverage_actor_role(uuid),
  private.profiles_revoke_manager_grants()
from public, anon;

grant execute on function
  private.london_month(timestamptz),
  private.london_month_start(date),
  private.london_month_end(date),
  private.london_today(),
  private.current_london_month(),
  private.clean_text(text, integer, text),
  private.require_reason(text),
  private.venue_manager_grants_insert_guard(),
  private.venue_manager_grants_guard(),
  private.effective_manager_venue_id(uuid),
  private.my_manager_venue_id(),
  private.can_manage_venue(uuid),
  private.assert_can_manage_venue(uuid),
  private.active_staff_venue_id(),
  private.coverage_actor_role(uuid),
  private.profiles_revoke_manager_grants()
to authenticated, service_role;

revoke all on function
  public.grant_venue_manager(uuid, uuid, text),
  public.revoke_venue_manager(uuid, text),
  public.coverage_access_scope()
from public, anon;

grant execute on function
  public.grant_venue_manager(uuid, uuid, text),
  public.revoke_venue_manager(uuid, text),
  public.coverage_access_scope()
to authenticated, service_role;
