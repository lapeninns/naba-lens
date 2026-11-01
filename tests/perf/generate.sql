-- Synthetic large-library generator for the WS3 baseline (tests/perf/generate.mjs).
-- Writes straight to a local throwaway stack as the postgres role with
-- session_replication_role = replica (user triggers and FK triggers off, CHECK
-- and UNIQUE constraints still enforced). Every row is synthetic: venues named
-- "PERF Venue NN", people at @perf.nabalens.test, generated dish names.
--
-- psql variables: seed (float in -1..1), venues, staff, admins, media,
-- months, video_share, retired (retired menu versions per venue).
\set ON_ERROR_STOP on
set session_replication_role = replica;
set maintenance_work_mem = '512MB';
set work_mem = '64MB';
select setseed(:seed);

begin;

-- ---------------------------------------------------------------- venues
insert into public.venues (name, slug, active, created_at)
select 'PERF Venue ' || lpad(n::text, 2, '0'), 'perf-venue-' || lpad(n::text, 2, '0'),
       true, now() - interval '26 months'
from generate_series(1, :venues) n;

-- Venue sizes follow a Zipf-like curve (venue 1 is the biggest).
create temp table pv as
select row_number() over (order by slug)::int as n, id, name, slug,
       1.0 / power(row_number() over (order by slug), 0.8) as w
from public.venues where slug like 'perf-venue-%';

create temp table pvc as
select n, id,
       coalesce(sum(w) over (order by n rows between unbounded preceding and 1 preceding), 0)
         / sum(w) over () as lo,
       w / sum(w) over () as share
from pv;

-- ---------------------------------------------------------------- people
create temp table pu as
select g as n,
       gen_random_uuid() as id,
       case when g <= :admins then 'admin' else 'staff' end as role,
       case when g <= :admins then 'perf-admin-' || g
            else 'perf-staff-' || lpad((g - :admins)::text, 3, '0') end || '@perf.nabalens.test' as email,
       case when g <= :admins then 'PERF Admin ' || g
            else 'PERF Staff ' || lpad((g - :admins)::text, 3, '0') end as display_name
from generate_series(1, :admins + :staff) g;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
       now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from pu;

-- Staff: the first <venues> staff seed one per venue, the rest are placed by
-- venue size. 3% are deactivated, 5% moved venue part-way through the window.
create temp table ps0 as
select pu.n, pu.id, pu.display_name, random() as r_venue, random() as r_act, random() as r_move,
       random() as r_rank, random() as r_prior
from pu
where pu.role = 'staff';

create temp table ps1 as
select s.*, v.n as venue_n, v.id as venue_id, v.share as venue_share
from ps0 s
cross join lateral (
  select n, id, share from pvc
  where (s.n - :admins) <= :venues and n = (s.n - :admins)
     or (s.n - :admins) > :venues and lo <= s.r_venue
  order by n desc limit 1
) v;

create temp table ps as
select s.*,
       row_number() over (partition by venue_id order by r_rank) as rank_in_venue,
       (r_act < 0.03) as inactive,
       case when r_move < 0.05 then
         (select id from pvc o where o.id <> s.venue_id order by (o.n * 7919 + s.n) % 101 limit 1)
       end as prior_venue_id,
       now() - interval '1 month' * (3 + 15 * r_prior) as moved_at
from ps1 s;

insert into public.profiles (id, display_name, role, venue_id, active, created_at)
select id, display_name, 'admin', null, true, now() - interval '26 months' from pu where role = 'admin';
insert into public.profiles (id, display_name, role, venue_id, active, created_at, job_title)
select id, display_name, 'staff', venue_id, not inactive, now() - interval '25 months',
       (array['Head chef','Sous chef','Line cook','Bartender','Front of house','Pastry chef'])[1 + n % 6]
from ps;

-- Upload weight: venue share x within-venue rank curve x activity.
create temp table psw as
select s.*,
       s.venue_share * (1.0 / power(s.rank_in_venue, 0.9))
         / sum(1.0 / power(s.rank_in_venue, 0.9)) over (partition by s.venue_id)
         * case when s.inactive then 0.05 when s.r_act > 0.85 then 0.1 else 1 end as w
from ps s;
create temp table psc as
select id as staff_id, venue_id, prior_venue_id, moved_at,
       coalesce(sum(w) over (order by n rows between unbounded preceding and 1 preceding), 0)
         / sum(w) over () as lo
from psw;

-- ---------------------------------------------------------------- menus
create temp table sec_names as
select * from unnest(
  array['starters','mains','curries','grill','sides','breads','rice','desserts','drinks','wine','cocktails','kids','specials'],
  array['Starters','Mains','Curries','Grill','Sides','Breads','Rice','Desserts','Drinks','Wine','Cocktails','Kids','Specials']
) with ordinality as t(slug, name, ord);

-- Active items per venue: 80-200, venue 1 is a 350-item menu.
create temp table vm as
select v.n as venue_n, v.id as venue_id, v.name as venue_name,
       case when v.n = 1 then 350 else 80 + (v.n * 37) % 120 end as n_active,
       8 + v.n % 5 as n_sections,
       :retired + 1 as k
from pv v;
alter table vm add column pool int;
update vm set pool = ceil(n_active * 1.3)::int;

create temp table vsec as
select vm.venue_n, vm.venue_id, sn.ord::int as sec_ord, sn.slug, sn.name,
       case when sn.slug in ('drinks','wine','cocktails') then 'drinks' else 'food' end as kind
from vm join sec_names sn on sn.ord <= vm.n_sections;

create temp table vitem as
select vm.venue_n, vm.venue_id, g as pool_idx, gen_random_uuid() as item_id,
       vm.n_active, vm.pool, vm.n_sections, vm.k
from vm cross join lateral generate_series(1, vm.pool) g;

insert into public.menu_items (id, venue_id, created_by, created_at, archived_at, archived_by)
select item_id, venue_id, (select id from pu where role = 'admin' order by n limit 1),
       now() - interval '25 months', null, null
from vitem;

-- Names: style x protein x dish, unique within a venue.
alter table vitem add column name text, add column sec_ord int, add column slug text;
update vitem set
  name = (array['Classic','Smoked','Spiced','Crispy','House'])[1 + (pool_idx + venue_n * 7) % 5] || ' ' ||
         (array['Chicken','Lamb','Prawn','Paneer','Beef','Cod','Duck','Mushroom','Aubergine','Salmon',
                'Lentil','Chickpea','Pork','Squid','Halloumi','Cauliflower','Tofu','Turkey','Venison','Sea Bass'])
           [1 + ((pool_idx + venue_n * 7) / 5) % 20] || ' ' ||
         (array['Tikka','Karahi','Masala','Biryani','Skewers','Pie','Curry','Salad','Burger','Tacos',
                'Risotto','Kebab','Stew','Wrap','Roast','Platter','Bowl','Pasta','Fritters','Soup',
                'Flatbread','Dumplings','Noodles','Grill','Bites'])
           [1 + ((pool_idx + venue_n * 7) / 100) % 25],
  sec_ord = 1 + (pool_idx * 7) % n_sections;
update vitem set slug = trim(both '-' from lower(regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g')));

-- Variants for every fourth item (2-4), stable ids across versions.
create temp table vvar as
select vi.venue_id, vi.item_id, vi.pool_idx, g as vpos, gen_random_uuid() as variant_id,
       (array['Regular','Large','Small','Chicken','Lamb','Vegetable'])[g] as name,
       2 + vi.pool_idx % 3 as nv
from vitem vi cross join lateral generate_series(1, 2 + vi.pool_idx % 3) g
where vi.pool_idx % 4 = 0;
insert into public.menu_variants (id, item_id, venue_id, created_at)
select variant_id, item_id, venue_id, now() - interval '25 months' from vvar;

-- Versions: <retired> retired, 1 active, and a draft in every second venue.
create temp table vver as
select vm.venue_n, vm.venue_id, j, gen_random_uuid() as version_id,
       case when j = vm.k then 'active' when j < vm.k then 'retired' else 'draft' end as status,
       vm.k, vm.n_active, vm.pool,
       now() - (vm.k - j + 1) * interval '2 months' as activated_at
from vm cross join lateral generate_series(1, vm.k + case when vm.venue_n % 2 = 0 then 1 else 0 end) j;

insert into public.menu_versions (id, venue_id, status, title, source_kind, source_label, source_sha256,
  revision, created_by, created_at, updated_at, reviewed_at, activated_at, retired_at, reviewed_by, activated_by, retired_by)
select v.version_id, v.venue_id, v.status,
       'PERF menu ' || v.venue_n || ' v' || v.j, 'json', 'perf-menu-' || v.venue_n || '-v' || v.j || '.json',
       md5(v.version_id::text) || md5(v.version_id::text || 'x'),
       1 + v.j % 4,
       a.id,
       case when v.status = 'draft' then now() - interval '5 days' else v.activated_at - interval '3 days' end,
       case when v.status = 'draft' then now() - interval '2 days' else v.activated_at end,
       case when v.status = 'draft' then null else v.activated_at - interval '1 day' end,
       case when v.status = 'draft' then null else v.activated_at end,
       case when v.status = 'retired' then v.activated_at + interval '2 months' end,
       case when v.status = 'draft' then null else a.id end,
       case when v.status = 'draft' then null else a.id end,
       case when v.status = 'retired' then a.id end
from vver v cross join lateral (select id from pu where role = 'admin' order by n limit 1) a;

insert into public.menu_sections (id, version_id, venue_id, slug, name, kind, position)
select gen_random_uuid(), v.version_id, v.venue_id, s.slug, s.name, s.kind, s.sec_ord - 1
from vver v join vsec s on s.venue_id = v.venue_id;

-- Version j covers a sliding window of the item pool; the active one is the newest.
create temp table ventry as
select gen_random_uuid() as entry_id, v.version_id, v.venue_id, v.venue_n, v.j, v.status, vi.item_id, vi.pool_idx,
       vi.name, vi.slug, vs.slug as sec_slug, vs.name as sec_name, vs.sec_ord,
       s.id as section_id
from vver v
join vitem vi on vi.venue_id = v.venue_id
  and vi.pool_idx > (case when v.k > 1 then floor((least(v.j, v.k) - 1) * (v.pool - v.n_active)::numeric / (v.k - 1)) else 0 end)
  and vi.pool_idx <= (case when v.k > 1 then floor((least(v.j, v.k) - 1) * (v.pool - v.n_active)::numeric / (v.k - 1)) else 0 end) + v.n_active
join vsec vs on vs.venue_id = v.venue_id and vs.sec_ord = vi.sec_ord
join public.menu_sections s on s.version_id = v.version_id and s.slug = vs.slug;

insert into public.menu_entries (id, version_id, venue_id, section_id, item_id, name, description, aliases,
  source_key, source_meta, position, needs_review)
select e.entry_id, e.version_id, e.venue_id, e.section_id, e.item_id, e.name,
       case when e.pool_idx % 2 = 0 then 'Made fresh daily with seasonal produce, served with house sauce and a side.' end,
       case when e.pool_idx % 10 < 3 then array[lower(split_part(e.name, ' ', 2) || ' ' || split_part(e.name, ' ', 3))] else '{}'::text[] end,
       e.sec_slug || '--' || e.slug,
       jsonb_build_object('row', e.pool_idx, 'price', (6 + e.pool_idx % 20)::text || '.50'),
       row_number() over (partition by e.version_id, e.section_id order by e.pool_idx) - 1,
       false
from ventry e;

insert into public.menu_entry_variants (id, entry_id, item_id, variant_id, name, position)
select gen_random_uuid(), e.entry_id, e.item_id, vv.variant_id, vv.name, vv.vpos - 1
from ventry e join vvar vv on vv.item_id = e.item_id;

-- Items that are in no active version: archive 40% of them.
update public.menu_items mi set archived_at = now() - interval '1 month', archived_by = (select id from pu where role = 'admin' order by n limit 1)
where mi.venue_id in (select venue_id from vm)
  and not exists (select 1 from ventry e where e.item_id = mi.id and e.status in ('active', 'draft'))
  and (hashtextextended(mi.id::text, 1) % 10 + 10) % 10 < 4;

insert into public.menu_events (venue_id, version_id, actor_id, action, detail, created_at)
select v.venue_id, v.version_id, a.id, 'draft_created', jsonb_build_object('revision', 1), v.activated_at - interval '3 days'
from vver v cross join lateral (select id from pu where role = 'admin' order by n limit 1) a
union all
select v.venue_id, v.version_id, a.id, 'activated', jsonb_build_object('revision', 1), v.activated_at
from vver v cross join lateral (select id from pu where role = 'admin' order by n limit 1) a where v.status <> 'draft'
union all
select v.venue_id, v.version_id, a.id, 'retired', '{}'::jsonb, v.activated_at + interval '2 months'
from vver v cross join lateral (select id from pu where role = 'admin' order by n limit 1) a where v.status = 'retired';

-- ---------------------------------------------------------------- media
-- Uploads come in batches (1-10 files, same person, minutes apart). Upload
-- density grows linearly over the window (a growing organisation).
create temp table batches as
select x.b, s.staff_id, s.venue_id as home_venue, s.prior_venue_id, s.moved_at,
       date_trunc('day', now() - :months * interval '1 month' + sqrt(x.r2) * :months * interval '1 month')
         + interval '8 hours' + x.r3 * interval '15 hours' as base_ts,
       1 + floor(x.r4 * 10)::int as k
from (select g as b, random() as r1, random() as r2, random() as r3, random() as r4
      from generate_series(1, ceil(:media / 4.0)::int + 20) g) x
cross join lateral (select * from psc where lo <= x.r1 order by lo desc limit 1) s;

create temp table mk as
select row_number() over (order by random()) as i, b.*, gs.o,
       random() as r_gap, random() as r_kind, random() as r_fmt, random() as r_size, random() as r_dim,
       random() as r_state, random() as r_del, random() as r_dur, random() as r_flip, random() as r_jit
from batches b cross join lateral generate_series(1, b.k) gs(o);
delete from mk where i > :media;

create temp table mm as
select mk.i, gen_random_uuid() as id, mk.staff_id as uploader_id,
       least(now() - interval '1 minute', mk.base_ts + (mk.o - 1) * (30 + mk.r_gap * 90) * interval '1 second') as created_at,
       mk.home_venue, mk.prior_venue_id, mk.moved_at,
       (mk.r_kind < :video_share) as is_video,
       mk.r_fmt, mk.r_size, mk.r_dim, mk.r_state, mk.r_del, mk.r_dur, mk.r_flip, mk.r_jit
from mk;

create temp table md as
select m.*,
       case when m.prior_venue_id is not null and m.created_at < m.moved_at then m.prior_venue_id else m.home_venue end as venue_id,
       case when m.is_video then (case when m.r_fmt < 0.5 then 'mp4' when m.r_fmt < 0.95 then 'mov' else 'webm' end)
            else (case when m.r_fmt < 0.45 then 'jpg' when m.r_fmt < 0.85 then 'heic' when m.r_fmt < 0.93 then 'png' else 'webp' end) end as ext,
       case when m.is_video then (case when m.r_size < 0.5 then 19.5e6 when m.r_size < 0.85 then 80e6 else 209.7e6 end)
            else (case when m.r_size < 0.35 then 2.8e6 when m.r_size < 0.90 then 5.5e6 else 15e6 end) end
         * (0.8 + 0.4 * m.r_jit) as size_f,
       case when m.is_video then (case when m.r_dim < 0.7 then 1920 when m.r_dim < 0.9 then 3840 else 1280 end)
            else (case when m.r_size < 0.35 then 3264 when m.r_size < 0.90 then 4032 else 6000 end) end as w0,
       case when m.is_video then (case when m.r_dim < 0.7 then 1080 when m.r_dim < 0.9 then 2160 else 720 end)
            else (case when m.r_size < 0.35 then 2448 when m.r_size < 0.90 then 3024 else 4000 end) end as h0,
       case when m.r_state < 0.985 then 'ready' else 'failed' end as state
from mm m;

insert into public.media_assets (id, uploader_id, venue_id, original_path, preview_path, thumbnail_path,
  original_filename, media_type, validated_mime_type, size_bytes, width, height, duration_seconds,
  upload_state, created_at, updated_at, deleted_at)
select d.id, d.uploader_id, d.venue_id,
       d.uploader_id || '/' || d.id || '/original.' || d.ext,
       case when not d.is_video and d.state = 'ready' then d.uploader_id || '/' || d.id || '/preview.webp' end,
       case when not d.is_video and d.state = 'ready' then d.uploader_id || '/' || d.id || '/thumb.webp' end,
       case when d.is_video and d.r_dur < 0.5 then 'VID_' else 'IMG_' end
         || lpad((1000 + (d.i * 7919) % 9000)::text, 4, '0') || '.'
         || case d.ext when 'jpg' then 'jpg' when 'mov' then 'MOV' when 'mp4' then 'mp4' else upper(d.ext) end,
       case when d.is_video then 'video' else 'image' end::public.media_type,
       case when d.state <> 'ready' then null
            else case d.ext when 'jpg' then 'image/jpeg' when 'heic' then 'image/heic' when 'png' then 'image/png'
                            when 'webp' then 'image/webp' when 'mp4' then 'video/mp4'
                            when 'mov' then 'video/quicktime' else 'video/webm' end end,
       least(round(d.size_f), case when d.is_video then 209715200 else 20971519 end)::bigint,
       case when d.state = 'ready' then (case when d.r_flip < (case when d.is_video then 0.5 else 0.4 end) then d.h0 else d.w0 end) end,
       case when d.state = 'ready' then (case when d.r_flip < (case when d.is_video then 0.5 else 0.4 end) then d.w0 else d.h0 end) end,
       case when d.is_video and d.state = 'ready' then round((8 + d.r_dur * 112)::numeric, 3) end,
       d.state::public.upload_state,
       d.created_at,
       d.created_at + interval '20 seconds',
       case when d.state = 'ready' and d.r_del < 0.005 then d.created_at + interval '10 days' end
from md d;

-- A handful of fresh in-flight uploads, as a live system has.
update public.media_assets set upload_state = 'uploading', validated_mime_type = null, preview_path = null,
  thumbnail_path = null, width = null, height = null, duration_seconds = null
where id in (select id from public.media_assets
             where venue_id in (select id from pv) and upload_state = 'ready' and deleted_at is null
               and created_at > now() - interval '1 day' order by created_at desc limit 6);

-- ---------------------------------------------------------------- archive receipts
insert into public.media_archive_receipts (asset_id, sha256, size_bytes, mime_type, source_project_ref,
  source_key, blob_key, manifest_key, manifest_sha256, manifest, archived_at)
select r.id, r.sha, r.size_bytes, r.validated_mime_type, r.ref, r.original_path,
       r.ref || '/blobs/sha256/' || substr(r.sha, 1, 2) || '/' || r.sha,
       r.ref || '/manifests/' || r.id || '/' || r.sha || '/' || r.msha || '.json',
       r.msha,
       jsonb_build_object('format', 'nabalens-original-archive@1', 'sourceProjectRef', r.ref,
         'sourceBucket', 'media', 'assetId', r.id, 'uploaderId', r.uploader_id, 'venueId', r.venue_id,
         'originalPath', r.original_path, 'originalFilename', r.original_filename,
         'mediaType', r.media_type::text, 'mimeType', r.validated_mime_type, 'sizeBytes', r.size_bytes,
         'sha256', r.sha, 'blobKey', r.ref || '/blobs/sha256/' || substr(r.sha, 1, 2) || '/' || r.sha,
         'createdAt', r.created_at, 'archivedBy', 'media-archive-v1'),
       r.created_at + interval '30 seconds'
from (
  select a.*, 'perfperfperfperfperf'::text as ref,
         md5(a.id::text || 'a') || md5(a.id::text || 'b') as sha,
         md5(a.id::text || 'c') || md5(a.id::text || 'd') as msha
  from public.media_assets a
  where a.venue_id in (select id from pv) and a.upload_state = 'ready'
) r;

-- ---------------------------------------------------------------- labels
create temp table lab as
select a.id as asset_id, a.venue_id, a.uploader_id, a.created_at,
       random() as r_items, random() as r_ct, random() as r_note, random() as r_type_only, random() as r_rev,
       random() as r_gap
from public.media_assets a
where a.venue_id in (select id from pv) and a.upload_state = 'ready' and a.deleted_at is null and random() < 0.55;
alter table lab add column n_items int;
update lab set n_items = case when r_type_only < 0.10 then 0
  when r_items < 0.55 then 1 when r_items < 0.85 then 2 when r_items < 0.97 then 3 else 4 end;

insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select l.asset_id, l.venue_id,
       case when l.r_ct < 0.55 then array['dish'] when l.r_ct < 0.70 then array['dish','plating']
            when l.r_ct < 0.78 then array['drinks'] when l.r_ct < 0.84 then array['preparation']
            when l.r_ct < 0.89 then array['kitchen'] when l.r_ct < 0.93 then array['team']
            when l.r_ct < 0.97 then array['venue'] else array['event','venue'] end,
       case when l.r_note < 0.15 then 'Table ' || (1 + floor(l.r_note * 200))::int || ', ' ||
            (array['lunch service','Sunday roast','new special','plating test','staff meal','event prep'])[1 + floor(l.r_rev * 6)::int] end,
       true, 1 + (l.r_rev < 0.2)::int,
       l.created_at + l.r_gap * interval '3 days', l.created_at + l.r_gap * interval '3 days', l.uploader_id
from lab l;

-- Labels that were later withdrawn: a row with has_labels = false.
insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select a.id, a.venue_id, '{}', null, false, 2, a.created_at + interval '1 day', a.created_at + interval '2 days', a.uploader_id
from public.media_assets a
where a.venue_id in (select id from pv) and a.upload_state = 'ready' and a.deleted_at is null
  and not exists (select 1 from lab l where l.asset_id = a.id) and random() < 0.04;

insert into public.media_label_events (asset_id, venue_id, actor_id, actor_role, action, before, after, created_at)
select l.asset_id, l.venue_id, l.uploader_id, 'staff', 'labels_saved', null,
       jsonb_build_object('items', l.n_items, 'revision', 1), l.created_at + l.r_gap * interval '3 days'
from lab l;

-- Item choice: Zipf-like over the active window; 8% reference older items.
create temp table li0 as
select distinct on (l.asset_id, pick.pool_idx)
       l.asset_id, l.venue_id, l.created_at, l.uploader_id, g as pos, pick.pool_idx
from lab l
join vm on vm.venue_id = l.venue_id
cross join lateral generate_series(1, l.n_items) g
cross join lateral (
  select case when r.a < 0.08 and (vm.pool - vm.n_active) > 0
              then 1 + floor((vm.pool - vm.n_active) * r.b)::int
              else (vm.pool - vm.n_active) + 1 + floor(vm.n_active * power(r.b, 2))::int end as pool_idx
  from (select random() as a, random() as b, g as _g) r
) pick
where l.n_items > 0
order by l.asset_id, pick.pool_idx;

-- Name and section as of the last version that listed the item.
create temp table ilast as
select distinct on (e.item_id) e.item_id, e.venue_id, e.pool_idx, e.name, e.sec_name, e.sec_slug, e.version_id
from ventry e where e.status in ('active', 'retired')
order by e.item_id, e.j desc;

insert into public.media_label_items (asset_id, venue_id, item_id, variant_id, item_name, variant_name,
  section_name, section_slug, version_id, added_by, added_at)
select x.asset_id, x.venue_id, il.item_id, vv.variant_id, il.name, vv.name, il.sec_name, il.sec_slug,
       il.version_id, x.uploader_id, x.created_at + interval '1 hour'
from li0 x
join vitem vi on vi.venue_id = x.venue_id and vi.pool_idx = x.pool_idx
join ilast il on il.item_id = vi.item_id
left join lateral (
  select * from vvar v where v.item_id = vi.item_id and v.vpos = 1 + floor(random() * v.nv)::int
    and random() < 0.6 limit 1
) vv on true;

-- Missing-item suggestions from about 1% of labelled assets.
insert into public.menu_item_suggestions (venue_id, asset_id, suggested_name, status, created_by, created_at, updated_at,
  resolved_item_id, resolved_by, resolved_at)
select s.venue_id, s.asset_id,
       (array['Lamb Shank','Chef special curry','Seasonal fruit tart','Mixed grill','Masala chai','Truffle fries'])[1 + (s.n % 6)],
       s.st, s.uploader_id, s.created_at + interval '2 hours', s.created_at + interval '2 hours',
       case when s.st = 'resolved' then (select item_id from vitem v where v.venue_id = s.venue_id order by pool_idx limit 1) end,
       case when s.st = 'resolved' then (select id from pu where role = 'admin' order by n limit 1) end,
       case when s.st = 'resolved' then s.created_at + interval '3 days' end
from (
  select l.*, row_number() over () as n,
         (array['open','open','open','resolved','resolved','dismissed','dismissed','withdrawn','open','open'])[1 + (hashtextextended(l.asset_id::text, 2) % 10 + 10)::int % 10] as st
  from lab l where random() < 0.01
) s;

commit;

reset session_replication_role;
