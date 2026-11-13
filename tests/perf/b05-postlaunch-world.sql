-- B05 perf fix, repair round 1: a post-launch use world for the rights filters
-- of public.asset_search (tests/perf/b05-diff.mjs and tests/perf/b05-bench.mjs,
-- group search-postlaunch). Run after generate.mjs, b05-world.sql and
-- b05-diff-world.sql, as postgres, on a local workstream stack only. Same
-- conventions as those files: replica mode, every row synthetic and
-- PERF-named (grant keys perfb05p*), uploads by generated PERF staff.
--
-- The generated volume predates the use cutover (every asset legacy_unknown,
-- few grants). This file adds the shape a year after launch, where most rows
-- a rights filter keeps by baseline are settled by a grant:
-- * big (perf-b05-manager-big's venue): 50,000 'none'-baseline uploads after
--   the cutover (60% labelled, so the manager sees them); then every ready
--   big asset whose use state is legacy_unknown or not_granted gets a grant
--   in force (the consent drive), except the oldest 40 legacy_unknown and the
--   oldest 2,500 'none' rows (every third of those gets an expired grant
--   only). So use = legacy_unknown and use = not_granted find their rows
--   below about 73,000 and 50,000 granted ones;
-- * renewals at big: 30% of the new grants in force sit beside an expired
--   grant of the same asset (an expired grant plus a newer one in force), so
--   use = expired finds its rows below them; 2% sit beside a withdrawn grant
--   (withdrawn plus in force: granted), so use = withdrawn skips them;
-- * small (perf-b05-manager-small's venue): every ready legacy_unknown asset
--   with no grant gets an expired grant (lapsed), so the grants there are
--   mostly lapsed and use = in_force finds the few in force among them; its
--   'none' rows get a grant in force (so the admin's not_granted reaches the
--   big rows above).
--
--   psql "$SUPABASE_DB_URL" -v seed=0.42 -f tests/perf/b05-postlaunch-world.sql
\set ON_ERROR_STOP on
set session_replication_role = replica;
set work_mem = '128MB';
select setseed(:seed);

begin;

create temp table pk as
select
  (select p.venue_id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-big@perf.nabalens.test') as big,
  (select p.venue_id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-small@perf.nabalens.test') as small,
  (select p.id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-admin-1@perf.nabalens.test') as admin,
  (select s.cutover_at from private.media_use_settings s) as cutover,
  null::uuid as staff_big;

do $guard$
begin
  if not exists (select 1 from public.venues where slug = 'perfb05d-reject') then
    raise exception 'load tests/perf/b05-diff-world.sql first';
  end if;
  if exists (select 1 from public.media_use_grants g
             where g.authorised_by = (select admin from pk) and g.request_key like 'perfb05p%') then
    raise exception 'b05-postlaunch-world.sql is already loaded';
  end if;
end
$guard$;

update pk set staff_big = (select p.id from public.profiles p join auth.users u on u.id = p.id
  where u.email like 'perf-staff-%' and p.venue_id = pk.big and p.active order by u.email offset 1 limit 1);

-- ---------------------------------------------------------------- 50,000 post-cutover uploads at big
create temp table pa as
select gen_random_uuid() as id, g as n,
       pk.cutover + ((g::float8 / 50001) * (now() - interval '1 hour' - pk.cutover)) as created_at,
       case when g % 7 = 0 then 'video' else 'image' end as media_type,
       g % 5 < 3 as labelled
from pk, generate_series(1, 50000) g;

insert into public.media_assets (id, uploader_id, venue_id, original_path, preview_path, thumbnail_path,
  original_filename, media_type, validated_mime_type, size_bytes, width, height, duration_seconds,
  upload_state, created_at, updated_at, deleted_at, uploader_role, use_baseline)
select a.id, pk.staff_big, pk.big, pk.staff_big || '/' || a.id || '/original.jpg',
       pk.staff_big || '/' || a.id || '/preview.webp', pk.staff_big || '/' || a.id || '/thumb.webp',
       'IMG_' || lpad((1000 + a.n % 9000)::text, 4, '0') || '.jpg',
       a.media_type::public.media_type,
       case when a.media_type = 'video' then 'video/mp4' else 'image/jpeg' end,
       3500000, 4032, 3024, case when a.media_type = 'video' then 30 end,
       'ready', a.created_at, a.created_at + interval '20 seconds', null, null, 'none'
from pa a, pk;

-- Labels: the most labelled item of big.
create temp table ppop as
select li.item_id, li.item_name, li.section_name, li.section_slug, li.version_id
from public.media_label_items li, pk
where li.venue_id = pk.big
group by 1, 2, 3, 4, 5 order by count(*) desc, 1 limit 1;

insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select a.id, pk.big, array['dish'], null, true, 1, a.created_at + interval '1 minute',
       a.created_at + interval '1 minute', pk.staff_big
from pa a, pk where a.labelled;

insert into public.media_label_items (asset_id, venue_id, item_id, variant_id, item_name, variant_name,
  section_name, section_slug, version_id, added_by, added_at)
select a.id, pk.big, p.item_id, null, p.item_name, null, p.section_name, p.section_slug, p.version_id,
       pk.staff_big, a.created_at + interval '1 minute'
from pa a cross join ppop p cross join pk where a.labelled;

-- ---------------------------------------------------------------- grants
-- Ready assets of big and small whose use state is legacy_unknown or
-- not_granted now (no grant in force, none withdrawn), ranked oldest first
-- per venue and baseline.
create temp table pt as
select a.id, a.venue_id, a.created_at, a.use_baseline,
       row_number() over (partition by a.venue_id, a.use_baseline order by a.created_at, a.id) as up,
       exists (select 1 from public.media_use_grants g where g.asset_id = a.id) as has_grant
from public.media_assets a, pk
where a.venue_id in (pk.big, pk.small)
  and a.upload_state = 'ready' and a.deleted_at is null
  and private.media_asset_use_state(a.id, now()) in ('legacy_unknown', 'not_granted');

create temp table pg as
-- big: in force, except the oldest 40 legacy and 2,500 'none' rows.
select t.id as asset_id, t.venue_id, 'in_force' as kind, t.created_at
from pt t, pk
where t.venue_id = pk.big
  and t.up > case when t.use_baseline = 'legacy_unknown' then 40 else 2500 end
union all
-- big: renewals (an expired grant beside the new one in force).
select t.id, t.venue_id, 'expired', t.created_at
from pt t, pk
where t.venue_id = pk.big
  and t.up > case when t.use_baseline = 'legacy_unknown' then 40 else 2500 end
  and abs(hashtext(t.id::text)) % 10 < 3
union all
-- big: withdrawn beside in force.
select t.id, t.venue_id, 'withdrawn', t.created_at
from pt t, pk
where t.venue_id = pk.big
  and t.up > case when t.use_baseline = 'legacy_unknown' then 40 else 2500 end
  and abs(hashtext(t.id::text || 'w')) % 50 = 7
union all
-- big: every third ungranted bottom row has an expired grant only.
select t.id, t.venue_id, 'expired', t.created_at
from pt t, pk
where t.venue_id = pk.big
  and t.up <= case when t.use_baseline = 'legacy_unknown' then 40 else 2500 end
  and t.up % 3 = 0
union all
-- small: legacy rows with no grant lapse; 'none' rows are granted.
select t.id, t.venue_id, case when t.use_baseline = 'legacy_unknown' then 'expired' else 'in_force' end,
       t.created_at
from pt t, pk
where t.venue_id = pk.small and (t.use_baseline <> 'legacy_unknown' or not t.has_grant);

create temp table pgi as
select gen_random_uuid() as id, g.*, row_number() over (order by g.asset_id, g.kind) as n from pg g;

insert into public.media_use_grants (id, asset_id, venue_id, destination_key, audience, purpose, subject_kind,
  subject_id, subject_key, derivative_profile_key, effective_from, effective_until, authorised_by, authority_basis,
  clearance_version, clearance, internal_note, request_key, created_at)
select g.id, g.asset_id, g.venue_id,
       case when g.n % 3 = 0 then 'perf_social' else 'perf_menu_web' end,
       'internal', 'general_gallery', 'none', null, null, null,
       case g.kind when 'expired' then least(g.created_at, now() - interval '400 days')
                   else least(g.created_at, now() - interval '2 days') end,
       case when g.kind = 'expired' then now() - interval '30 days' end,
       pk.admin, 'admin', 'perf-v1', '{}'::jsonb, null, 'perfb05p' || lpad(g.n::text, 10, '0'),
       least(g.created_at + interval '1 day', now() - interval '1 day')
from pgi g, pk;

insert into public.media_use_grant_withdrawals (grant_id, withdrawn_by, reason_code, withdrawn_at)
select g.id, pk.admin, 'granter_withdrawn', now() - interval '1 day'
from pgi g, pk where g.kind = 'withdrawn';

select 'postlaunch|' || json_build_object(
  'newAssets', (select count(*) from pa),
  'grants', (select json_object_agg(k, c) from (
     select (select case when g.venue_id = pk.big then 'big ' else 'small ' end from pk) || g.kind as k, count(*) as c
     from pgi g group by 1) x))::text;

commit;
reset session_replication_role;

vacuum (analyze) public.media_assets, public.media_labels, public.media_label_items,
  public.media_use_grants, public.media_use_grant_withdrawals;
