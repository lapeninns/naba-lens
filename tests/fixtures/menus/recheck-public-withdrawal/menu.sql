-- fx_menu_recheck_public_withdrawal, menu part (WS3; b04-design §7.5,
-- b05-design §4.10). TEST FIXTURE: synthetic venue, people, menu and photos.
--
-- Run with psql as the local `postgres` role on an isolated stack, inside a
-- transaction the caller owns (these files never begin, commit or roll
-- back), in one session:
--   begin; \i menu.sql; [\i b05-overlay.sql;] \i menu-activate.sql;
--   <assertions>; \i menu-reaccept.sql; <assertions>; rollback;
-- menu.sql leaves v1 active and v2 a draft, so WS4's overlay (B05-m1 to
-- B05-m3 applied) publishes the v1 deliveries before menu-activate.sql.
-- Every id is generated, so the fixture can be loaded more than once; the
-- session temp table fx_menu_recheck maps keys to ids:
--   key 'venue' | 'staff' | 'manager' | 'admin' | 'v1' | 'v2', and
--   'A'..'I' with item_id, variant_id (the photographed variant), asset_id
--   and photo_id.
--
-- As tests/migrations/sibling-era-seed.sql does, only the fixture identities
-- and media readiness (the service-role processor's job in the app) are
-- written directly; menus, labels, reviews and activation go through the
-- RPCs as the signed-in actor. The v2 change declarations are inserted
-- directly while v2 is a draft: menuChangeDeclarations stays off in the
-- product until WS2's L5 items land (b04-design §18.1), and the table's draft
-- guard still applies.
--
-- v1 (active): food A to G, drinks H and I; one accepted image photo each.
-- C has Chicken and Lamb, its photo on Lamb; D has Beef and Bean, its photo
-- on Bean. v2 (a draft here; menu-activate.sql activates it): A renamed,
-- B moved to drinks, C without Lamb, declarations D variant_meaning (Bean),
-- E presentation, F recipe, G portion, H reviewer_flag, I description only.

\set ON_ERROR_STOP on

select gen_random_uuid() as fx_venue, gen_random_uuid() as fx_staff, gen_random_uuid() as fx_manager,
  gen_random_uuid() as fx_admin, substr(md5(random()::text), 1, 12) as fx_tag \gset

insert into public.venues (id, name, slug, active)
values (:'fx_venue', 'Fixture Recheck Venue ' || :'fx_tag', 'fixture-recheck-venue-' || :'fx_tag', true);

with fixture_users (id, email) as (
  values
    (:'fx_admin'::uuid, 'fixture-recheck-admin-' || :'fx_tag' || '@nabalens.test'),
    (:'fx_staff'::uuid, 'fixture-recheck-staff-' || :'fx_tag' || '@nabalens.test'),
    (:'fx_manager'::uuid, 'fixture-recheck-manager-' || :'fx_tag' || '@nabalens.test')
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

insert into public.profiles (id, display_name, job_title, role, venue_id, active) values
  (:'fx_admin', 'Fixture Recheck Admin', null, 'admin', null, true),
  (:'fx_staff', 'Fixture Recheck Author', 'Fixture Cook', 'staff', :'fx_venue', true),
  (:'fx_manager', 'Fixture Recheck Manager', 'Fixture Manager', 'manager', :'fx_venue', true);

select json_build_object('sub', :'fx_admin', 'role', 'authenticated')::text as fx_admin_claims,
  json_build_object('sub', :'fx_staff', 'role', 'authenticated')::text as fx_staff_claims,
  json_build_object('sub', :'fx_manager', 'role', 'authenticated')::text as fx_manager_claims \gset
\set fx_source '{"kind":"json","label":"Fixture recheck menu.json","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","revision":null,"capturedAt":null,"notes":null}'

-- Admin: the manager's grant and menu v1.
set role authenticated;
select set_config('request.jwt.claims', :'fx_admin_claims', false);
select public.grant_venue_manager(:'fx_manager', :'fx_venue', 'Fixture recheck manager') is not null as fx_granted \gset

select public.create_menu_draft(:'fx_venue', 'Fixture Recheck Menu', :'fx_source'::jsonb, $doc${
  "title": "Fixture Recheck Menu",
  "sections": [
    {"slug": "food", "name": "Food", "kind": "food", "items": [
      {"itemId": null, "sourceKey": "food--a", "name": "Fixture Alpha Pie", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []},
      {"itemId": null, "sourceKey": "food--b", "name": "Fixture Bravo Soup", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []},
      {"itemId": null, "sourceKey": "food--c", "name": "Fixture Charlie Curry", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null,
       "variants": [{"variantId": null, "name": "Chicken"}, {"variantId": null, "name": "Lamb"}]},
      {"itemId": null, "sourceKey": "food--d", "name": "Fixture Delta Burger", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null,
       "variants": [{"variantId": null, "name": "Beef"}, {"variantId": null, "name": "Bean"}]},
      {"itemId": null, "sourceKey": "food--e", "name": "Fixture Echo Salad", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []},
      {"itemId": null, "sourceKey": "food--f", "name": "Fixture Foxtrot Stew", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []},
      {"itemId": null, "sourceKey": "food--g", "name": "Fixture Golf Steak", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []}
    ]},
    {"slug": "drinks", "name": "Drinks", "kind": "drinks", "items": [
      {"itemId": null, "sourceKey": "drinks--h", "name": "Fixture Hotel Spritz", "description": null,
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []},
      {"itemId": null, "sourceKey": "drinks--i", "name": "Fixture India Ale", "description": "Fixture pale ale.",
       "aliases": [], "sourceMeta": {}, "review": null, "variants": []}
    ]}
  ]
}$doc$::jsonb) as fx_v1 \gset
select public.activate_menu_version(:'fx_v1', 1);
reset role;

create temp table fx_menu_recheck (
  key text primary key,
  id uuid,
  item_id uuid,
  variant_id uuid,
  asset_id uuid,
  photo_id uuid
) on commit drop;

insert into fx_menu_recheck (key, id) values
  ('venue', :'fx_venue'), ('staff', :'fx_staff'), ('manager', :'fx_manager'), ('admin', :'fx_admin'),
  ('v1', :'fx_v1');

insert into fx_menu_recheck (key, item_id, variant_id)
select upper(split_part(e.source_key, '--', 2)), e.item_id,
  (select ev.variant_id from public.menu_entry_variants ev
   where ev.entry_id = e.id and ev.name = case e.source_key when 'food--c' then 'Lamb' when 'food--d' then 'Bean' end)
from public.menu_entries e where e.version_id = :'fx_v1';

-- Staff: one image per item, reserved as staff and made ready as the
-- processor does.
set role authenticated;
select set_config('request.jwt.claims', :'fx_staff_claims', false);
create temp table fx_reserved on commit drop as
select k.key, r.id as asset_id
from (values ('A'), ('B'), ('C'), ('D'), ('E'), ('F'), ('G'), ('H'), ('I')) k(key)
cross join lateral public.reserve_media_asset('image', 'jpg', 'Fixture recheck ' || k.key || '.jpg', 4,
  'fixture-recheck-' || :'fx_tag' || '-' || k.key) r;
reset role;

update fx_menu_recheck f set asset_id = r.asset_id from fx_reserved r where r.key = f.key;
select string_agg(quote_literal(asset_id), ', ' order by key) as fx_assets
from fx_menu_recheck where asset_id is not null \gset

set role service_role;
update public.media_assets set upload_state = 'processing' where id in (:fx_assets);
update public.media_assets
set upload_state = 'ready', validated_mime_type = 'image/jpeg', size_bytes = 4, width = 1, height = 1
where id in (:fx_assets);
reset role;

-- Staff labels each photo with its item (and the photographed variant).
select coalesce(string_agg(format(
  'select * from public.save_media_labels(%L, 0, %L, null, %L::jsonb, null, %L);',
  f.asset_id, '{}', jsonb_build_array(jsonb_build_object('itemId', f.item_id, 'variantId', f.variant_id)), :'fx_v1'),
  E'\n' order by f.key), '') as fx_label_sql
from fx_menu_recheck f where f.key in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I') \gset
set role authenticated;
select set_config('request.jwt.claims', :'fx_staff_claims', false);
:fx_label_sql
reset role;

-- The manager accepts every photo.
select coalesce(string_agg(format(
  'select * from public.review_menu_item_photo(%L, %L, %L, %L, 1, null, false, %L);',
  f.asset_id, f.item_id, f.variant_id, 'accepted', 'fixture-recheck-' || :'fx_tag' || '-review-' || f.key),
  E'\n' order by f.key), '') as fx_review_sql
from fx_menu_recheck f where f.key in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I') \gset
set role authenticated;
select set_config('request.jwt.claims', :'fx_manager_claims', false);
:fx_review_sql
reset role;

update fx_menu_recheck f set photo_id = p.id
from public.menu_item_photos p
where p.asset_id = f.asset_id and p.item_id = f.item_id and p.state = 'accepted';

-- Admin: v2 as a draft.
select
  max(item_id::text) filter (where key = 'A') as fx_a, max(item_id::text) filter (where key = 'B') as fx_b,
  max(item_id::text) filter (where key = 'C') as fx_c, max(item_id::text) filter (where key = 'D') as fx_d,
  max(item_id::text) filter (where key = 'E') as fx_e, max(item_id::text) filter (where key = 'F') as fx_f,
  max(item_id::text) filter (where key = 'G') as fx_g, max(item_id::text) filter (where key = 'H') as fx_h,
  max(item_id::text) filter (where key = 'I') as fx_i
from fx_menu_recheck \gset
select
  max(ev.variant_id::text) filter (where e.source_key = 'food--c' and ev.name = 'Chicken') as fx_c_chicken,
  max(ev.variant_id::text) filter (where e.source_key = 'food--d' and ev.name = 'Beef') as fx_d_beef,
  max(ev.variant_id::text) filter (where e.source_key = 'food--d' and ev.name = 'Bean') as fx_d_bean
from public.menu_entry_variants ev
join public.menu_entries e on e.id = ev.entry_id
where e.version_id = :'fx_v1' \gset

set role authenticated;
select set_config('request.jwt.claims', :'fx_admin_claims', false);
select public.create_menu_draft(:'fx_venue', 'Fixture Recheck Menu', :'fx_source'::jsonb,
  jsonb_build_object('title', 'Fixture Recheck Menu', 'sections', jsonb_build_array(
    jsonb_build_object('slug', 'food', 'name', 'Food', 'kind', 'food', 'items', jsonb_build_array(
      jsonb_build_object('itemId', :'fx_a', 'sourceKey', 'food--a', 'name', 'Fixture Alpha Pasty',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'fx_c', 'sourceKey', 'food--c', 'name', 'Fixture Charlie Curry',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', jsonb_build_array(jsonb_build_object('variantId', :'fx_c_chicken', 'name', 'Chicken'))),
      jsonb_build_object('itemId', :'fx_d', 'sourceKey', 'food--d', 'name', 'Fixture Delta Burger',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', jsonb_build_array(jsonb_build_object('variantId', :'fx_d_beef', 'name', 'Beef'),
          jsonb_build_object('variantId', :'fx_d_bean', 'name', 'Bean'))),
      jsonb_build_object('itemId', :'fx_e', 'sourceKey', 'food--e', 'name', 'Fixture Echo Salad',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'fx_f', 'sourceKey', 'food--f', 'name', 'Fixture Foxtrot Stew',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'fx_g', 'sourceKey', 'food--g', 'name', 'Fixture Golf Steak',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb))),
    jsonb_build_object('slug', 'drinks', 'name', 'Drinks', 'kind', 'drinks', 'items', jsonb_build_array(
      jsonb_build_object('itemId', :'fx_b', 'sourceKey', 'food--b', 'name', 'Fixture Bravo Soup',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'fx_h', 'sourceKey', 'drinks--h', 'name', 'Fixture Hotel Spritz',
        'description', null, 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null, 'variants', '[]'::jsonb),
      jsonb_build_object('itemId', :'fx_i', 'sourceKey', 'drinks--i', 'name', 'Fixture India Ale',
        'description', 'Fixture hazy pale ale.', 'aliases', '[]'::jsonb, 'sourceMeta', '{}'::jsonb, 'review', null,
        'variants', '[]'::jsonb))))),
  :'fx_v1') as fx_v2 \gset
reset role;

insert into fx_menu_recheck (key, id) values ('v2', :'fx_v2');

-- The v2 declarations (direct, while v2 is a draft; see the header).
insert into public.menu_change_declarations (version_id, venue_id, item_id, variant_id, kind, note, declared_by)
values
  (:'fx_v2', :'fx_venue', :'fx_d', :'fx_d_bean', 'variant_meaning', 'Fixture: the bean patty is now a falafel.', :'fx_admin'),
  (:'fx_v2', :'fx_venue', :'fx_e', null, 'presentation', 'Fixture: now served in a bowl.', :'fx_admin'),
  (:'fx_v2', :'fx_venue', :'fx_f', null, 'recipe', 'Fixture: new stock recipe.', :'fx_admin'),
  (:'fx_v2', :'fx_venue', :'fx_g', null, 'portion', 'Fixture: now 8oz instead of 10oz.', :'fx_admin'),
  (:'fx_v2', :'fx_venue', :'fx_h', null, 'reviewer_flag', 'Fixture: reviewer asked for a new photo.', :'fx_admin');
