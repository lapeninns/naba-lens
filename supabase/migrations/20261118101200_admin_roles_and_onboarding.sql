-- Admin role management, last-admin protection and the first sign-in notice
-- (S1-PEOPLE; spec §3.1, §3.2, §8 A6).
--
--   * private.profiles_last_admin_guard refuses any update or delete that
--     would leave no active admin (in the app, the provider or SQL), so the
--     last active admin cannot be deactivated, demoted or removed.
--   * public.admin_grant_admin / public.admin_revoke_admin: an active admin
--     grants or revokes the admin role with a reason; never on themself; a
--     revoked admin becomes staff at a chosen active venue. Audited in
--     coverage_audit_events (entity account_role), like conversions.
--   * public.contribution_notice_acknowledgements and
--     public.acknowledge_contribution_notice / public.my_onboarding_state:
--     first sign-in records which version of the contribution-use notice the
--     person accepted, and reads their venue and role for the welcome screen.
--
-- Rollback: drop the trigger and revoke execute on the public functions. The
-- acknowledgement table can stay (append-only history).

-- ---------------------------------------------------------------------------
-- Last active admin
-- ---------------------------------------------------------------------------

create function private.profiles_last_admin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'admin' or not old.active then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.active then
    return new;
  end if;
  -- Serialise concurrent demotions of the last two admins.
  perform 1 from public.profiles p where p.role = 'admin' and p.active order by p.id for update;
  if not exists (
    select 1 from public.profiles p
    where p.role = 'admin' and p.active and p.id <> old.id
  ) then
    raise exception 'last_active_admin' using errcode = 'P0001',
      detail = 'Make another person an active admin first.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger profiles_last_admin_guard
  before update of role, active or delete on public.profiles
  for each row execute function private.profiles_last_admin_guard();

-- ---------------------------------------------------------------------------
-- Admin role commands
-- ---------------------------------------------------------------------------

create function public.admin_grant_admin(p_profile_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.require_reason(p_reason);
  v_p public.profiles;
begin
  if p_profile_id = v_uid then
    raise exception 'cannot_change_self' using errcode = '42501';
  end if;
  select p.* into v_p from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if v_p.role = 'admin' then
    return;
  end if;
  if not v_p.active then
    raise exception 'account_inactive' using errcode = 'P0001';
  end if;

  -- Legacy triggers revoke grants and end assignments; memberships end
  -- (account_role_changed): an admin has every venue.
  update public.profiles p set role = 'admin' where p.id = p_profile_id;

  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, before, after)
  values (v_p.venue_id, 'account_role', p_profile_id, v_uid, 'admin', 'admin_granted', v_reason,
    jsonb_build_object('role', v_p.role), jsonb_build_object('role', 'admin', 'profileId', p_profile_id));
end;
$$;

create function public.admin_revoke_admin(p_profile_id uuid, p_venue_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.require_reason(p_reason);
  v_p public.profiles;
begin
  if p_profile_id = v_uid then
    raise exception 'cannot_change_self' using errcode = '42501';
  end if;
  select p.* into v_p from public.profiles p where p.id = p_profile_id for update;
  if not found or v_p.role <> 'admin' then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if p_venue_id is null then
    raise exception 'venue_inactive' using errcode = 'P0001';
  end if;
  perform private.assert_venue_assignable(p_venue_id);

  -- The last-admin guard runs on this update; memberships sync to staff here.
  update public.profiles p set role = 'staff', venue_id = p_venue_id where p.id = p_profile_id;

  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, before, after)
  values (p_venue_id, 'account_role', p_profile_id, v_uid, 'admin', 'admin_revoked', v_reason,
    jsonb_build_object('role', 'admin'), jsonb_build_object('role', 'staff', 'profileId', p_profile_id, 'venueId', p_venue_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- First sign-in: contribution-use notice
-- ---------------------------------------------------------------------------

create table public.contribution_notice_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  notice_version text not null check (notice_version ~ '^[a-z0-9][a-z0-9.-]{0,31}$'),
  acknowledged_at timestamptz not null default now(),
  unique (profile_id, notice_version)
);

comment on table public.contribution_notice_acknowledgements is
  'Which version of the contribution-use notice each person accepted at first sign-in (spec §3.2). Append-only.';

create trigger contribution_notice_acknowledgements_append_only
  before update or delete on public.contribution_notice_acknowledgements
  for each row execute function private.append_only_guard();
create trigger contribution_notice_acknowledgements_no_truncate
  before truncate on public.contribution_notice_acknowledgements
  for each statement execute function private.append_only_guard();

alter table public.contribution_notice_acknowledgements enable row level security;
revoke all on table public.contribution_notice_acknowledgements from public, anon, authenticated, service_role;
grant select on table public.contribution_notice_acknowledgements to service_role;

-- Idempotent: the first acknowledgement of a version is kept.
create function public.acknowledge_contribution_notice(p_version text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[a-z0-9][a-z0-9.-]{0,31}$' then
    raise exception 'invalid_notice_version' using errcode = '22023';
  end if;
  insert into public.contribution_notice_acknowledgements (profile_id, notice_version)
  values (v_uid, p_version)
  on conflict (profile_id, notice_version) do nothing;
  select a.acknowledged_at into v_at from public.contribution_notice_acknowledgements a
  where a.profile_id = v_uid and a.notice_version = p_version;
  return v_at;
end;
$$;

-- What the first sign-in screen shows: the active venue and role there, how
-- many venues the person belongs to, and whether this notice was accepted.
create function public.my_onboarding_state(p_notice_version text)
returns table (
  role text,
  venue_id uuid,
  venue_name text,
  venue_count integer,
  notice_acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.role = 'admin' then 'admin' else private.venue_role_of(p.id, p.venue_id) end,
    p.venue_id, v.name,
    (select count(*)::integer from public.venue_memberships m
      where m.profile_id = p.id and m.ended_at is null),
    (select a.acknowledged_at from public.contribution_notice_acknowledgements a
      where a.profile_id = p.id and a.notice_version = p_notice_version)
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  where p.id = (select auth.uid()) and p.active;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.profiles_last_admin_guard() from public, anon;
grant execute on function private.profiles_last_admin_guard() to authenticated, service_role;

revoke all on function
  public.admin_grant_admin(uuid, text),
  public.admin_revoke_admin(uuid, uuid, text),
  public.acknowledge_contribution_notice(text),
  public.my_onboarding_state(text)
from public, anon, service_role;
grant execute on function
  public.admin_grant_admin(uuid, text),
  public.admin_revoke_admin(uuid, uuid, text),
  public.acknowledge_contribution_notice(text),
  public.my_onboarding_state(text)
to authenticated;
