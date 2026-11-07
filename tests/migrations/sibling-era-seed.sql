-- DEV FIXTURE data written by the sibling-era schema (every migration up to and
-- including 20261106130000_menu_item_photos), for phase `sibling-upgrade`.
-- Run by tests/migrations/sibling-upgrade.test.ts with psql as the local
-- `postgres` superuser on an isolated stack, after
-- `supabase db reset --local --version 20261106130000 --no-seed` and before the
-- manager-workspace migrations (20261107100000..) are applied.
--
-- Every row is written through the sibling-era RPCs as the signed-in actor
-- would (set role authenticated + request.jwt.claims), so the item-photo rows,
-- their heads and events, the grant and the coverage audit rows are exactly
-- what that schema writes. Only fixture identities and media readiness (done
-- by the service-role processor in the app) are inserted directly.
--
-- Result: a staff-held venue manager grant at Venue A; Our menu item photos in
-- the accepted (primary), needs_recheck (menu rename) and withdrawn states; and
-- coverage audit rows for the manager_grant and requirement entities.

\set ON_ERROR_STOP on

insert into public.venues (id, name, slug, active) values
  ('00000000-0000-4000-8000-00000000a001', 'DEV FIXTURE Venue A', 'dev-fixture-venue-a', true),
  ('00000000-0000-4000-8000-00000000a002', 'DEV FIXTURE Venue B', 'dev-fixture-venue-b', true);

with fixture_users (id, email) as (
  values
    ('00000000-0000-4000-8000-0000000000a1'::uuid, 'dev-admin@nabalens.test'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'dev-staff-a@nabalens.test'),
    ('00000000-0000-4000-8000-0000000000b4'::uuid, 'dev-manager-a@nabalens.test')
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

-- The pilot manager is a STAFF account holding a grant (the sibling schema has
-- no 'manager' role yet).
insert into public.profiles (id, display_name, job_title, role, venue_id, active) values
  ('00000000-0000-4000-8000-0000000000a1', 'DEV FIXTURE Admin', null, 'admin', null, true),
  ('00000000-0000-4000-8000-0000000000b1', 'DEV FIXTURE Staff A', 'DEV FIXTURE Chef', 'staff', '00000000-0000-4000-8000-00000000a001', true),
  ('00000000-0000-4000-8000-0000000000b4', 'DEV FIXTURE Pilot Manager', 'DEV FIXTURE General Manager', 'staff', '00000000-0000-4000-8000-00000000a001', true);

\set venue '00000000-0000-4000-8000-00000000a001'
\set admin_claims '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}'
\set staff_claims '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}'
\set manager_claims '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}'
\set source '{"kind":"json","label":"DEV FIXTURE menu.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","revision":null,"capturedAt":"2026-11-01T10:00:00Z","notes":null}'

-- Admin: the staff-held grant (audited 'manager_grant' row), a coverage
-- requirement (audited 'requirement' row) and the first active menu.
set role authenticated;
select set_config('request.jwt.claims', :'admin_claims', false);

select public.grant_venue_manager(
  '00000000-0000-4000-8000-0000000000b4', :'venue', 'DEV FIXTURE pilot manager'
) as grant_id \gset

select r.requirement_id from public.save_coverage_requirement(
  p_venue_id => :'venue', p_requirement_id => null, p_expected_revision => null,
  p_kind => 'venue_specific', p_title => 'DEV FIXTURE Back bar', p_guidance => null,
  p_photo_target => 1, p_due_on => null, p_client_request_key => 'dev-fixture-sibling-req-1'
) r \gset

select public.create_menu_draft(:'venue', 'DEV FIXTURE Menu', :'source'::jsonb, $doc${
  "title": "DEV FIXTURE Menu",
  "sections": [
    {"slug": "mains", "name": "Mains", "kind": "food", "items": [
      {"itemId": null, "sourceKey": "mains--korma", "name": "Korma", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null,
       "variants": [{"variantId": null, "name": "Chicken"}, {"variantId": null, "name": "Lamb"}]},
      {"itemId": null, "sourceKey": "mains--tikka", "name": "Tikka", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []},
      {"itemId": null, "sourceKey": "mains--dal", "name": "Dal", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []}
    ]}
  ]
}$doc$::jsonb) as v1 \gset
select public.activate_menu_version(:'v1', 1);

reset role;
select
  max(e.item_id::text) filter (where e.source_key = 'mains--korma') as korma,
  max(e.item_id::text) filter (where e.source_key = 'mains--tikka') as tikka,
  max(e.item_id::text) filter (where e.source_key = 'mains--dal') as dal
from public.menu_entries e where e.version_id = :'v1' \gset
select
  max(ev.variant_id::text) filter (where ev.name = 'Chicken') as chicken,
  max(ev.variant_id::text) filter (where ev.name = 'Lamb') as lamb
from public.menu_entry_variants ev
join public.menu_entries e on e.id = ev.entry_id
where e.version_id = :'v1' \gset

-- Staff A: three photos (reserved as staff, made ready as the processor does),
-- each labelled with one tuple of the active menu.
set role authenticated;
select set_config('request.jwt.claims', :'staff_claims', false);
select id as tikka_asset from public.reserve_media_asset('image', 'jpg', 'DEV FIXTURE Tikka.jpg', 4, 'dev-fixture-sibling-1') \gset
select id as dal_asset from public.reserve_media_asset('image', 'jpg', 'DEV FIXTURE Dal.jpg', 4, 'dev-fixture-sibling-2') \gset
select id as korma_asset from public.reserve_media_asset('image', 'jpg', 'DEV FIXTURE Korma.jpg', 4, 'dev-fixture-sibling-3') \gset

reset role;
set role service_role;
update public.media_assets set upload_state = 'processing'
where id in (:'tikka_asset', :'dal_asset', :'korma_asset');
update public.media_assets
set upload_state = 'ready', validated_mime_type = 'image/jpeg', size_bytes = 4, width = 1, height = 1
where id in (:'tikka_asset', :'dal_asset', :'korma_asset');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :'staff_claims', false);
select * from public.save_media_labels(:'tikka_asset', 0, '{}', null,
  jsonb_build_array(jsonb_build_object('itemId', :'tikka', 'variantId', null)), null, :'v1');
select * from public.save_media_labels(:'dal_asset', 0, '{}', null,
  jsonb_build_array(jsonb_build_object('itemId', :'dal', 'variantId', null)), null, :'v1');
select * from public.save_media_labels(:'korma_asset', 0, '{}', null,
  jsonb_build_array(jsonb_build_object('itemId', :'korma', 'variantId', :'chicken')), null, :'v1');

-- The staff-held manager reviews: Tikka accepted as primary, Dal accepted then
-- withdrawn, Korma/Chicken accepted (sent to needs_recheck by the rename below).
select set_config('request.jwt.claims', :'manager_claims', false);
select * from public.review_menu_item_photo(:'tikka_asset', :'tikka', null, 'accepted', 1,
  null, true, 'dev-fixture-sibling-review-1');
select photo_id as dal_photo, item_revision as dal_revision
from public.review_menu_item_photo(:'dal_asset', :'dal', null, 'accepted', 1,
  null, false, 'dev-fixture-sibling-review-2') \gset
select * from public.review_menu_item_photo(:'korma_asset', :'korma', :'chicken', 'accepted', 1,
  null, false, 'dev-fixture-sibling-review-3');
select * from public.withdraw_menu_item_photo(:'dal_photo', :dal_revision,
  'DEV FIXTURE wrong dish', 'dev-fixture-sibling-withdraw-1');

-- Admin renames Korma in a new version: activation carries Tikka and sends the
-- Korma/Chicken decision to needs_recheck (name_changed).
select set_config('request.jwt.claims', :'admin_claims', false);
select public.create_menu_draft(:'venue', 'DEV FIXTURE Menu', :'source'::jsonb,
  jsonb_build_object('title', 'DEV FIXTURE Menu', 'sections', jsonb_build_array(
    jsonb_build_object('slug', 'mains', 'name', 'Mains', 'kind', 'food', 'items', jsonb_build_array(
      jsonb_build_object('itemId', :'korma', 'sourceKey', 'mains--korma', 'name', 'Korma Royale',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', jsonb_build_array(
          jsonb_build_object('variantId', :'chicken', 'name', 'Chicken'),
          jsonb_build_object('variantId', :'lamb', 'name', 'Lamb'))),
      jsonb_build_object('itemId', :'tikka', 'sourceKey', 'mains--tikka', 'name', 'Tikka',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'dal', 'sourceKey', 'mains--dal', 'name', 'Dal',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', '[]'::jsonb))))),
  :'v1') as v2 \gset
select public.activate_menu_version(:'v2', 1);

select set_config('request.jwt.claims', '', false);
reset role;
