-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-PRIVACY (spec §3.2, §8 A7; decision FA-23): group admins
-- must sign in with a second factor (TOTP through Supabase Auth); managers
-- may turn it on.
--
--   Admin     private.is_active_admin() now also needs an aal2 session
--             (auth.jwt() ->> 'aal'). Every policy and function that admits
--             admins through it, which is nearly all of them, refuses an
--             admin who has not completed the second step: such a session
--             reads like an account without admin rights. The app sends
--             that admin to /auth/mfa first (lib/auth).
--   Status    public.my_mfa_status(): the caller's session level and number
--             of verified factors, so the app can ask a manager (or anyone)
--             who has a factor for the code even where none is required.
--
-- Hosted projects need TOTP enabled in Auth settings (on by default; the
-- local stack: supabase/config.toml [auth.mfa.totp]). Existing admins are
-- asked to set up an authenticator app at their next sign-in.
--
-- Rollback: re-apply private.is_active_admin from
-- 20261029120100_nabalens_access.sql; revoke execute on my_mfa_status.

create or replace function private.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.active and p.role = 'admin'
    );
$$;

comment on function private.is_active_admin() is
  'An active admin profile on an aal2 (second factor) session (FA-23, spec §3.2).';

create function public.my_mfa_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'),
    'verifiedFactors', (
      select count(*) from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  )
  where (select auth.uid()) is not null;
$$;

revoke all on function public.my_mfa_status() from public, anon, service_role;
grant execute on function public.my_mfa_status() to authenticated;
