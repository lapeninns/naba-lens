-- =============================================================================
-- DEV FIXTURE DATA — LOCAL DEVELOPMENT ONLY.
-- Applied by `supabase db reset` on the local stack. Never load into staging or
-- production. Real venues come from supabase/seed/venues.json (owner-confirmed);
-- real staff are invited by an admin.
-- All addresses use the reserved `.test` domain; there are no passwords: sign in
-- with a magic link and open it from the local mail inbox (Mailpit).
-- =============================================================================

insert into public.venues (id, name, slug, active) values
  ('00000000-0000-4000-8000-00000000a001', 'DEV FIXTURE Venue A', 'dev-fixture-venue-a', true),
  ('00000000-0000-4000-8000-00000000a002', 'DEV FIXTURE Venue B', 'dev-fixture-venue-b', true),
  ('00000000-0000-4000-8000-00000000a003', 'DEV FIXTURE Inactive Venue', 'dev-fixture-inactive-venue', false);

with fixture_users (id, email) as (
  values
    ('00000000-0000-4000-8000-0000000000a1'::uuid, 'dev-admin@nabalens.test'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'dev-staff-a@nabalens.test'),
    ('00000000-0000-4000-8000-0000000000b2'::uuid, 'dev-staff-b@nabalens.test'),
    ('00000000-0000-4000-8000-0000000000b3'::uuid, 'dev-staff-inactive@nabalens.test')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', '', ''
from fixture_users;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u
where u.email like 'dev-%@nabalens.test';

insert into public.profiles (id, display_name, job_title, role, venue_id, active) values
  ('00000000-0000-4000-8000-0000000000a1', 'DEV FIXTURE Admin', null, 'admin', null, true),
  ('00000000-0000-4000-8000-0000000000b1', 'DEV FIXTURE Staff A', 'DEV FIXTURE Chef', 'staff', '00000000-0000-4000-8000-00000000a001', true),
  ('00000000-0000-4000-8000-0000000000b2', 'DEV FIXTURE Staff B', 'DEV FIXTURE Bartender', 'staff', '00000000-0000-4000-8000-00000000a001', true),
  ('00000000-0000-4000-8000-0000000000b3', 'DEV FIXTURE Inactive Staff', null, 'staff', '00000000-0000-4000-8000-00000000a002', false);
