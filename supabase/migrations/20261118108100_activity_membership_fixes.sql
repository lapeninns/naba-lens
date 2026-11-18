-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R7/R25, R26, R24; FA-22,
-- spec §8 A7).
--
-- R7/R25  A self-service venue switch (public.switch_active_venue) rewrites
--         profiles.venue_id and role, and the S1-OPS profiles_activity
--         trigger logged every switch as an admin-looking role change and
--         venue change in the append-only activity log. switch_active_venue
--         now marks its own update (nabalens.self_switch) and the trigger
--         skips it. Membership commands that move a person (an admin role
--         change, a removal at the active venue) still log as before.
-- R26     Membership grants and removals at a venue that is not the person's
--         active venue wrote no activity at all. Every opened and ended
--         venue_memberships row now appends 'membership_added' /
--         'membership_ended' to activity_events (object: the account).
-- R24     private.ops_venue_managers found a venue's managers through the
--         active-venue projection, so a person managing two venues got no
--         digest for the other one and it showed a false 'no manager' gap. It
--         now reads the per-venue rule private.venue_role_of.
--
-- Rollback: recreate profiles_activity without the WHEN clause, drop the
-- venue_memberships_activity trigger, restore the 20261118101100 body of
-- switch_active_venue and the 20261118106300 body of ops_venue_managers.

-- ---------------------------------------------------------------------------
-- R7/R25: a self-service switch is not an account change
-- ---------------------------------------------------------------------------

-- Body as in 20261118101100, plus the self_switch mark around the update.
create or replace function public.switch_active_venue(p_venue_id uuid)
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
  perform set_config('nabalens.self_switch', 'on', true);
  perform private.membership_switch_profile(v_uid, p_venue_id, v_role);
  perform set_config('nabalens.self_switch', '', true);
  return query select p_venue_id, v_role;
end;
$$;

drop trigger profiles_activity on public.profiles;
create trigger profiles_activity
  after update of active, role, venue_id on public.profiles
  for each row
  when (coalesce(current_setting('nabalens.self_switch', true), '') <> 'on')
  execute function private.activity_on_profile_change();

-- ---------------------------------------------------------------------------
-- R26: membership grants and removals reach the activity log
-- ---------------------------------------------------------------------------

create function private.activity_on_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_activity(
      new.venue_id, 'membership_added', 'account', new.profile_id::text, null, null,
      new.grant_reason, null,
      jsonb_build_object('membershipId', new.id, 'role', new.role, 'source', new.source));
  elsif old.ended_at is null and new.ended_at is not null then
    perform private.record_activity(
      new.venue_id, 'membership_ended', 'account', new.profile_id::text, null, null,
      new.end_reason,
      jsonb_build_object('membershipId', new.id, 'role', old.role),
      jsonb_build_object('endKind', new.end_kind));
  end if;
  return null;
end;
$$;

create trigger venue_memberships_activity
  after insert or update of ended_at on public.venue_memberships
  for each row execute function private.activity_on_membership_change();

revoke all on function private.activity_on_membership_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- R24: a venue's managers come from memberships, not the active venue
-- ---------------------------------------------------------------------------

-- Every active person whose role at the venue is manager (open manager
-- membership and open grant), whatever their active venue.
create or replace function private.ops_venue_managers(p_venue_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.venue_memberships m
  join public.profiles p on p.id = m.profile_id
  where m.venue_id = p_venue_id and m.ended_at is null and m.role = 'manager'
    and p.active and p.role in ('staff', 'manager')
    and private.venue_role_of(p.id, p_venue_id) = 'manager';
$$;

revoke all on function private.ops_venue_managers(uuid) from public, anon, authenticated;
