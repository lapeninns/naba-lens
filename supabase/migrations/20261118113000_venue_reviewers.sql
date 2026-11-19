-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-MGR: main and backup reviewers per venue (spec §7 M1, M5,
-- §20 step 8; checklist M5-review-assignments, M1-active-menu-reviewers,
-- S20-reviewers-usages).
--
--   venue_reviewer_assignments  one open row per venue and role (main,
--                               backup); a person holds at most one role at a
--                               venue. Rows are never deleted or edited except
--                               to end them, so the table is its own history.
--   venue_review_assignments    read: the venue's main and backup reviewer and
--                               the people who may be nominated (an open
--                               manager membership and grant at the venue).
--   set_venue_reviewer          nominate or clear a role. A manager of the
--                               venue (active venue, effective grant) or an
--                               admin. Nobody can be nominated who does not
--                               already hold manager permission there.
--   Handover                    when a reviewer stops being a manager at the
--                               venue (membership ended or changed, grant
--                               revoked, account deactivated) their role ends;
--                               a departing main reviewer is replaced by the
--                               backup. Triggers cover every route
--                               (remove_venue_member, admin commands,
--                               conversions, deactivation), so no command
--                               needs to remember it.
--
-- Changes are logged in activity_events (private.record_activity) and so show
-- in admin Activity and the manager's venue history.
--
-- Rollback: revoke execute on the two public functions and drop the three
-- handover triggers. The table stays.

create table public.venue_reviewer_assignments (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  role text not null check (role in ('main', 'backup')),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  -- NULL for a system handover (the backup taking over).
  assigned_by uuid references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete restrict,
  -- replaced: someone else took the role; cleared: the role was emptied;
  -- moved: the person took the venue's other role; left: they no longer hold
  -- manager permission at the venue (handover).
  end_kind text check (end_kind in ('replaced', 'cleared', 'moved', 'left')),
  constraint venue_reviewer_assignments_ended_pair check ((ended_at is null) = (end_kind is null))
);

create unique index venue_reviewer_assignments_one_per_role
  on public.venue_reviewer_assignments (venue_id, role) where ended_at is null;
create unique index venue_reviewer_assignments_one_per_person
  on public.venue_reviewer_assignments (venue_id, profile_id) where ended_at is null;
create index venue_reviewer_assignments_profile_open_idx
  on public.venue_reviewer_assignments (profile_id) where ended_at is null;
create index venue_reviewer_assignments_venue_idx
  on public.venue_reviewer_assignments (venue_id, assigned_at desc);

comment on table public.venue_reviewer_assignments is
  'S2-MGR: main and backup reviewer per venue (spec §7 M5). Append-only except ending a row.';

-- Only ending an open row is allowed; everything else is history.
create function private.venue_reviewer_assignments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'append_only' using errcode = '42501';
  end if;
  if old.ended_at is not null
    or new.ended_at is null
    or (new.id, new.venue_id, new.role, new.profile_id, new.assigned_by, new.assigned_at, new.reason)
      is distinct from
       (old.id, old.venue_id, old.role, old.profile_id, old.assigned_by, old.assigned_at, old.reason)
  then
    raise exception 'append_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger venue_reviewer_assignments_guard
  before update or delete on public.venue_reviewer_assignments
  for each row execute function private.venue_reviewer_assignments_guard();
create trigger venue_reviewer_assignments_no_truncate
  before truncate on public.venue_reviewer_assignments
  for each statement execute function private.append_only_guard();

alter table public.venue_reviewer_assignments enable row level security;
revoke all on table public.venue_reviewer_assignments from public, anon, authenticated, service_role;
grant select on table public.venue_reviewer_assignments to service_role;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- Holds manager permission at the venue now: an open manager membership and
-- an open grant, active account and venue (private.venue_role_of). Admins are
-- not nominated: the spec names people who hold manager permission there.
create function private.venue_reviewer_eligible(p_profile uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.venue_role_of(p_profile, p_venue) = 'manager', false);
$$;

-- The venue a read or command acts on: a manager's own venue, or the venue an
-- admin names. Raises not_venue_manager otherwise.
create function private.reviewer_scope_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  perform private.assert_can_manage_venue(v_venue);
  return v_venue;
end;
$$;

create function private.venue_reviewers_json(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'venueId', p_venue_id,
    'main', (
      select jsonb_build_object('profileId', a.profile_id, 'name', p.display_name, 'since', a.assigned_at)
      from public.venue_reviewer_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.venue_id = p_venue_id and a.role = 'main' and a.ended_at is null),
    'backup', (
      select jsonb_build_object('profileId', a.profile_id, 'name', p.display_name, 'since', a.assigned_at)
      from public.venue_reviewer_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.venue_id = p_venue_id and a.role = 'backup' and a.ended_at is null),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.display_name)
        order by lower(p.display_name), p.id)
      from public.profiles p
      where exists (
          select 1 from public.venue_memberships m
          where m.profile_id = p.id and m.venue_id = p_venue_id
            and m.ended_at is null and m.role = 'manager')
        and private.venue_reviewer_eligible(p.id, p_venue_id)), '[]'::jsonb));
$$;

-- Ends one open assignment and logs it.
create function private.end_reviewer_assignment(
  p_id uuid, p_kind text, p_reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.venue_reviewer_assignments;
begin
  update public.venue_reviewer_assignments
  set ended_at = now(),
      ended_by = case when exists (select 1 from public.profiles p where p.id = auth.uid())
        then auth.uid() end,
      end_kind = p_kind
  where id = p_id and ended_at is null
  returning * into v_row;
  if v_row.id is null then
    return;
  end if;
  perform private.record_activity(
    v_row.venue_id, 'reviewer_ended', 'venue_reviewer', v_row.venue_id::text || ':' || v_row.role,
    null, null, p_reason,
    jsonb_build_object('role', v_row.role, 'profileId', v_row.profile_id),
    jsonb_build_object('endKind', p_kind));
end;
$$;

create function private.open_reviewer_assignment(
  p_venue uuid, p_role text, p_profile uuid, p_reason text, p_by uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.venue_reviewer_assignments (venue_id, role, profile_id, assigned_by, reason)
  values (p_venue, p_role, p_profile, p_by, p_reason);
  perform private.record_activity(
    p_venue, 'reviewer_assigned', 'venue_reviewer', p_venue::text || ':' || p_role,
    null, null, p_reason, null,
    jsonb_build_object('role', p_role, 'profileId', p_profile));
end;
$$;

-- Handover for one person at one venue: if they no longer hold manager
-- permission there, their role ends; a departing main reviewer is replaced by
-- the backup, when there is one.
create function private.reviewer_handover(p_profile uuid, p_venue uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.venue_reviewer_assignments;
  v_backup public.venue_reviewer_assignments;
begin
  select * into v_row
  from public.venue_reviewer_assignments
  where profile_id = p_profile and venue_id = p_venue and ended_at is null
  for update;
  if v_row.id is null or private.venue_reviewer_eligible(p_profile, p_venue) then
    return;
  end if;
  perform private.end_reviewer_assignment(v_row.id, 'left',
    'No longer a manager at this venue');
  if v_row.role = 'main' then
    select * into v_backup
    from public.venue_reviewer_assignments
    where venue_id = p_venue and role = 'backup' and ended_at is null
    for update;
    if v_backup.id is not null and private.venue_reviewer_eligible(v_backup.profile_id, p_venue) then
      perform private.end_reviewer_assignment(v_backup.id, 'moved',
        'Backup reviewer took over as main reviewer');
      perform private.open_reviewer_assignment(p_venue, 'main', v_backup.profile_id,
        'Backup reviewer took over as main reviewer', null);
    end if;
  end if;
end;
$$;

-- Trigger bodies: re-check every open role the affected person holds.
create function private.reviewer_handover_for_profile(p_profile uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
begin
  for v_venue in
    select a.venue_id from public.venue_reviewer_assignments a
    where a.profile_id = p_profile and a.ended_at is null
  loop
    perform private.reviewer_handover(p_profile, v_venue);
  end loop;
end;
$$;

create function private.reviewer_handover_on_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reviewer_handover_for_profile(new.profile_id);
  return new;
end;
$$;

create function private.reviewer_handover_on_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reviewer_handover_for_profile(new.staff_id);
  return new;
end;
$$;

create function private.reviewer_handover_on_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reviewer_handover_for_profile(new.id);
  return new;
end;
$$;

create trigger venue_memberships_reviewer_handover
  after update of ended_at, role on public.venue_memberships
  for each row execute function private.reviewer_handover_on_membership();
create trigger venue_manager_grants_reviewer_handover
  after update of revoked_at on public.venue_manager_grants
  for each row execute function private.reviewer_handover_on_grant();
create trigger profiles_reviewer_handover
  after update of active, role on public.profiles
  for each row execute function private.reviewer_handover_on_profile();

-- ---------------------------------------------------------------------------
-- Public functions
-- ---------------------------------------------------------------------------

-- {venueId, main, backup, candidates}; main/backup are {profileId, name,
-- since} or null. Managers read their own venue (p_venue_id omitted or
-- equal); admins name one.
create function public.venue_review_assignments(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.venue_reviewers_json(private.reviewer_scope_venue(p_venue_id));
end;
$$;

-- Nominates p_profile_id as the venue's main or backup reviewer, or clears
-- the role when p_profile_id is null. A person who holds the venue's other
-- role moves to this one. Re-nominating the current holder changes nothing.
-- Returns the same shape as venue_review_assignments.
create function public.set_venue_reviewer(
  p_venue_id uuid,
  p_role text,
  p_profile_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_reason text;
  v_current public.venue_reviewer_assignments;
  v_other public.venue_reviewer_assignments;
begin
  v_venue := private.reviewer_scope_venue(p_venue_id);
  if p_role is null or p_role not in ('main', 'backup') then
    raise exception 'invalid_reviewer_role' using errcode = '22023';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'reason_too_long');

  -- One change at a time per venue.
  perform 1 from public.venues v where v.id = v_venue for update;

  select * into v_current from public.venue_reviewer_assignments
  where venue_id = v_venue and role = p_role and ended_at is null;

  if p_profile_id is null then
    if v_current.id is not null then
      perform private.end_reviewer_assignment(v_current.id, 'cleared', v_reason);
    end if;
    return private.venue_reviewers_json(v_venue);
  end if;

  if not private.venue_reviewer_eligible(p_profile_id, v_venue) then
    raise exception 'reviewer_not_eligible' using errcode = '42501';
  end if;
  if v_current.profile_id = p_profile_id then
    return private.venue_reviewers_json(v_venue);
  end if;

  select * into v_other from public.venue_reviewer_assignments
  where venue_id = v_venue and profile_id = p_profile_id and ended_at is null;
  if v_other.id is not null then
    perform private.end_reviewer_assignment(v_other.id, 'moved', v_reason);
  end if;
  if v_current.id is not null then
    perform private.end_reviewer_assignment(v_current.id, 'replaced', v_reason);
  end if;
  perform private.open_reviewer_assignment(v_venue, p_role, p_profile_id, v_reason, v_uid);
  return private.venue_reviewers_json(v_venue);
end;
$$;

revoke all on function
  private.venue_reviewer_assignments_guard(),
  private.venue_reviewer_eligible(uuid, uuid),
  private.reviewer_scope_venue(uuid),
  private.venue_reviewers_json(uuid),
  private.end_reviewer_assignment(uuid, text, text),
  private.open_reviewer_assignment(uuid, text, uuid, text, uuid),
  private.reviewer_handover(uuid, uuid),
  private.reviewer_handover_for_profile(uuid),
  private.reviewer_handover_on_membership(),
  private.reviewer_handover_on_grant(),
  private.reviewer_handover_on_profile()
from public, anon, authenticated;

revoke all on function
  public.venue_review_assignments(uuid),
  public.set_venue_reviewer(uuid, text, uuid, text)
from public, anon, service_role;
grant execute on function
  public.venue_review_assignments(uuid),
  public.set_venue_reviewer(uuid, text, uuid, text)
to authenticated;
