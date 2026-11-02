-- FOH/BOH is team membership, not an application permission role. Existing
-- profiles deliberately remain unassigned until an admin supplies a department.
alter table public.profiles
  add column department text constraint profiles_department_check
  check (department in ('foh', 'boh'));

comment on column public.profiles.department is
  'Admin-assigned team: foh, boh, or null when unassigned.';

-- Keep the original profile guard intact. The extra column follows the same
-- admin-only assignment boundary as job title and venue, even for direct API
-- requests from a staff member updating their own profile.
create function private.profiles_department_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.department is distinct from old.department
     and private.is_end_user_context()
     and not private.is_active_admin() then
    raise exception 'admin_only_fields' using errcode = '42501',
      detail = 'Only an admin can change department.';
  end if;
  return new;
end;
$$;

revoke all on function private.profiles_department_guard() from public, anon;
grant execute on function private.profiles_department_guard() to authenticated, service_role;

create trigger profiles_department_guard
  before update on public.profiles
  for each row execute function private.profiles_department_guard();

grant update (department) on public.profiles to authenticated;
