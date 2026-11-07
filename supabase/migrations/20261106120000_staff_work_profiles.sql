-- Self-described work profiles (docs/plans/staff-portfolio-and-menu-completion.md,
-- "Work profile and personalised prompts").
--
-- Staff say what they do (one main role, optional extra areas). It only changes
-- Home's prompt and the order in which the label picker offers sections and
-- content types: it never grants access, never sets the admin-maintained job
-- title or team, and never supplies a photo's label. One row per person in a
-- separate table, so profiles_guard, the profiles column grants and every
-- coverage reader of department/job_title stay untouched.
--
-- Staff never write the table directly: the three SECURITY DEFINER RPCs below
-- act only on the caller's own row, and only while they are active staff. Keys
-- must match lib/config/work-roles.ts.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Allowed work areas, in display order (WORK_AREAS in lib/config/work-roles.ts).
create function private.work_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['kitchen', 'curry', 'tandoor', 'plating', 'bar', 'service', 'venue']::text[];
$$;

-- True when every element is a known area and none repeats or is NULL.
create function private.valid_work_areas(p_areas text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_areas is not null
    and p_areas <@ private.work_areas()
    and coalesce(array_position(p_areas, null), 0) = 0
    and cardinality(p_areas) = (select count(distinct a) from unnest(p_areas) a);
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.staff_work_profiles (
  staff_id uuid primary key references public.profiles (id) on delete cascade,
  role_key text check (role_key is null or role_key in (
    'head_chef', 'sous_chef', 'line_chef', 'kitchen_team', 'curry_chef',
    'tandoor_chef', 'plating', 'bartender', 'bar_team', 'server', 'host',
    'manager', 'venue_team', 'other'
  )),
  -- Only for role "other": the person's own short title.
  role_title text check (role_title is null or (length(role_title) between 1 and 40 and role_title = btrim(role_title))),
  work_areas text[] not null default '{}' check (private.valid_work_areas(work_areas)),
  -- First time a role was saved; kept when the role later changes.
  completed_at timestamptz,
  skipped_at timestamptz,
  -- Home's Start here card is hidden while set.
  welcome_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_work_profiles_title_for_other check (
    (role_key is not distinct from 'other') = (role_title is not null)
  ),
  constraint staff_work_profiles_completed check ((role_key is null) = (completed_at is null))
);

comment on table public.staff_work_profiles is
  'Self-described work role and areas. Ordering and prompts only: never access, team or labels. Written through save_work_profile, skip_work_profile and set_welcome_dismissed.';

create trigger staff_work_profiles_set_updated_at
  before update on public.staff_work_profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke all on public.staff_work_profiles from public, anon, authenticated;

grant select on public.staff_work_profiles to authenticated;
grant select, insert, update, delete on public.staff_work_profiles to service_role;

alter table public.staff_work_profiles enable row level security;

create policy staff_work_profiles_select_own on public.staff_work_profiles
  for select to authenticated
  using (staff_id = (select auth.uid()) and (select private.is_active_user()));
create policy staff_work_profiles_select_admin on public.staff_work_profiles
  for select to authenticated using ((select private.is_active_admin()));

-- ---------------------------------------------------------------------------
-- RPCs (active staff, own row only)
-- ---------------------------------------------------------------------------

-- The caller's id when they are active staff.
create function private.assert_work_profile_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_staff() then
    raise exception 'work_profile_forbidden' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Saves the main role and extra areas. Clears a skip; completed_at keeps the
-- first save. Areas are deduplicated and stored in display order.
create function public.save_work_profile(
  p_role_key text,
  p_role_title text,
  p_work_areas text[]
)
returns public.staff_work_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_work_profile_owner();
  v_title text := private.clean_text(p_role_title, 40, 'invalid_work_role_title');
  v_areas text[];
  v_row public.staff_work_profiles;
begin
  if p_role_key is null or p_role_key not in (
    'head_chef', 'sous_chef', 'line_chef', 'kitchen_team', 'curry_chef',
    'tandoor_chef', 'plating', 'bartender', 'bar_team', 'server', 'host',
    'manager', 'venue_team', 'other'
  ) then
    raise exception 'invalid_work_role' using errcode = '22023';
  end if;
  if p_role_key = 'other' and v_title is null then
    raise exception 'work_role_title_required' using errcode = '22023';
  end if;
  if p_role_key <> 'other' and v_title is not null then
    raise exception 'invalid_work_role_title' using errcode = '22023',
      detail = 'A title is only kept for role "other".';
  end if;

  if p_work_areas is not null and (
    not (p_work_areas <@ private.work_areas())
    or coalesce(array_position(p_work_areas, null), 0) <> 0
  ) then
    raise exception 'invalid_work_areas' using errcode = '22023';
  end if;
  select coalesce(array_agg(a order by array_position(private.work_areas(), a)), '{}')
  into v_areas
  from (select distinct unnest(coalesce(p_work_areas, '{}')) as a) d;

  insert into public.staff_work_profiles as w
    (staff_id, role_key, role_title, work_areas, completed_at, skipped_at)
  values (v_uid, p_role_key, v_title, v_areas, now(), null)
  on conflict (staff_id) do update
  set role_key = excluded.role_key,
    role_title = excluded.role_title,
    work_areas = excluded.work_areas,
    completed_at = coalesce(w.completed_at, now()),
    skipped_at = null
  returning w.* into v_row;

  return v_row;
end;
$$;

-- "Skip for now": records the skip and keeps any saved role.
create function public.skip_work_profile()
returns public.staff_work_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_work_profile_owner();
  v_row public.staff_work_profiles;
begin
  insert into public.staff_work_profiles as w (staff_id, skipped_at)
  values (v_uid, now())
  on conflict (staff_id) do update set skipped_at = now()
  returning w.* into v_row;
  return v_row;
end;
$$;

-- true hides Home's Start here card; false shows it again.
create function public.set_welcome_dismissed(p_dismissed boolean)
returns public.staff_work_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_work_profile_owner();
  v_at timestamptz := case when coalesce(p_dismissed, false) then now() end;
  v_row public.staff_work_profiles;
begin
  insert into public.staff_work_profiles as w (staff_id, welcome_dismissed_at)
  values (v_uid, v_at)
  on conflict (staff_id) do update
  set welcome_dismissed_at = case
    when v_at is null then null
    else coalesce(w.welcome_dismissed_at, v_at)
  end
  returning w.* into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.work_areas(),
  private.valid_work_areas(text[]),
  private.assert_work_profile_owner()
from public, anon;

grant execute on function
  private.work_areas(),
  private.valid_work_areas(text[]),
  private.assert_work_profile_owner()
to authenticated, service_role;

revoke all on function
  public.save_work_profile(text, text, text[]),
  public.skip_work_profile(),
  public.set_welcome_dismissed(boolean)
from public, anon;

grant execute on function
  public.save_work_profile(text, text, text[]),
  public.skip_work_profile(),
  public.set_welcome_dismissed(boolean)
to authenticated, service_role;
