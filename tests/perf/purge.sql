-- Removes everything tests/perf/generate.sql created (PERF venues, @perf.nabalens.test
-- people and all rows hanging off them). The fixture world is left alone.
\set ON_ERROR_STOP on
set session_replication_role = replica;
begin;
create temp table pvx as select id from public.venues where slug like 'perf-venue-%';
create temp table pux as select id from auth.users where email like '%@perf.nabalens.test';
delete from public.media_archive_receipts r using public.media_assets a
  where a.id = r.asset_id and a.venue_id in (select id from pvx);
delete from public.media_label_events where venue_id in (select id from pvx);
delete from public.media_label_items where venue_id in (select id from pvx);
delete from public.media_labels where venue_id in (select id from pvx);
delete from public.menu_item_suggestions where venue_id in (select id from pvx);
delete from public.media_assets where venue_id in (select id from pvx);
delete from public.media_assets where uploader_id in (select id from pux);
delete from public.menu_events where venue_id in (select id from pvx);
delete from public.menu_entry_variants where entry_id in (select id from public.menu_entries where venue_id in (select id from pvx));
delete from public.menu_entries where venue_id in (select id from pvx);
delete from public.menu_variants where venue_id in (select id from pvx);
delete from public.menu_items where venue_id in (select id from pvx);
delete from public.menu_sections where venue_id in (select id from pvx);
delete from public.menu_versions where venue_id in (select id from pvx);
delete from public.profiles where id in (select id from pux);
delete from public.venues where id in (select id from pvx);
commit;
reset session_replication_role;
-- Cascades (sessions, identities, refresh tokens) need the real triggers.
delete from auth.users where email like '%@perf.nabalens.test';
