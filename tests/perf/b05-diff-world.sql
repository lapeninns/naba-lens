-- B05 perf fix: the world for the differential test of public.asset_search
-- (tests/perf/b05-diff.mjs) and the constructed worst cases of
-- tests/perf/b05-bench.mjs. Run after generate.mjs and b05-world.sql, as
-- postgres, on a local workstream stack only. Same conventions as
-- b05-world.sql: replica mode (user and FK triggers off), every row synthetic
-- and PERF-named (people perf-b05d-*@perf.nabalens.test, keys perfb05d*).
-- B05 schema only. Fixed rows get stable ids, md5('perfb05d:<key>')::uuid, so
-- b05-diff.mjs finds them without a lookup table.
--
-- Adds (big = perf-b05-manager-big's venue, small = perf-b05-manager-small's,
-- other = the first other PERF venue by slug):
-- * people: a staff account holding an open manager grant at small (grantee),
--   one whose grant is revoked, an inactive manager account, a plain staff
--   member at big, and a manager plus an uploader at a new venue (reject);
-- * reject: 73,600 assets, none labelled for food and none with evidence, so a
--   manager there is admitted nothing (the all-rejected worst case);
-- * the grantee's 500 own unlabelled uploads (20 with coverage items) plus a
--   guest_toilets check at small that is archived (toggle it to 'active' for
--   the grantee's own-upload amenity arm);
-- * amenity checks (active and archived) with submissions, knowledge
--   contributions, coverage requirements with items in every state (some
--   archived), fact media, at big, small and other; an active outdoor_seating
--   check at big with legacy coverage and fact media (the manager's legacy
--   media arm);
-- * food-typed unlabelled images and videos, kitchen-only and empty labels;
-- * 'none'-baseline uploads after the use cutover and use grants in every
--   state (in force, scheduled, expired, withdrawn, and pairs; scheduled
--   beside withdrawn, and beside in force at another destination) at both
--   baselines;
-- * deleted, processing and failed rows interleaved in feed order, many with
--   labels or evidence;
-- * created_at ties: blocks of 60 rows sharing one timestamp (4 at big, 2 at
--   small), mixing admitted, vetoed, rejected, deleted and not-ready rows;
-- * a group at small and one at other.
--
--   psql "$SUPABASE_DB_URL" -v seed=0.42 -f tests/perf/b05-diff-world.sql
\set ON_ERROR_STOP on
set session_replication_role = replica;
set work_mem = '64MB';
select setseed(:seed);

begin;

create function pg_temp.did(p_key text) returns uuid
language sql immutable as $$ select md5('perfb05d:' || p_key)::uuid $$;

create temp table dk as
select
  (select p.venue_id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-big@perf.nabalens.test') as big,
  (select p.venue_id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-small@perf.nabalens.test') as small,
  (select p.id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-big@perf.nabalens.test') as mgr_big,
  (select p.id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-small@perf.nabalens.test') as mgr_small,
  (select p.id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-admin-1@perf.nabalens.test') as admin,
  (select s.cutover_at from private.media_use_settings s) as cutover,
  null::uuid as other, null::uuid as staff_big, null::uuid as staff_small, null::uuid as staff_other;

do $guard$
begin
  if to_regclass('public.media_use_grants') is null then
    raise exception 'b05-diff-world.sql needs the B05 schema';
  end if;
  if (select big from dk) is null or (select small from dk) is null then
    raise exception 'load tests/perf/b05-world.sql first';
  end if;
  if exists (select 1 from public.venues where slug = 'perfb05d-reject') then
    raise exception 'b05-diff-world.sql is already loaded';
  end if;
end
$guard$;

update dk set other = (
  select v.id from public.venues v
  where v.slug like 'perf-venue-%' and v.id not in (dk.big, dk.small) order by v.slug limit 1);
-- One generated staff member per venue, the uploader of the new rows there.
update dk set
  staff_big = (select p.id from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'perf-staff-%' and p.venue_id = dk.big and p.active order by u.email limit 1),
  staff_small = (select p.id from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'perf-staff-%' and p.venue_id = dk.small and p.active order by u.email limit 1),
  staff_other = (select p.id from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'perf-staff-%' and p.venue_id = dk.other and p.active order by u.email limit 1);

-- ---------------------------------------------------------------- venue and people
insert into public.venues (id, name, slug, active, created_at)
values (pg_temp.did('venue-reject'), 'PERF B05 Reject', 'perfb05d-reject', true, now() - interval '25 months');

create temp table dp as
select v.k, pg_temp.did('person-' || v.k) as id, 'perf-b05d-' || v.k || '@perf.nabalens.test' as email,
       v.name, v.role::public.app_role as role,
       case v.at when 'small' then (select small from dk) when 'big' then (select big from dk)
         else pg_temp.did('venue-reject') end as venue_id,
       v.active
from (values
  ('grantee', 'PERF Grantee Small', 'staff', 'small', true),
  ('revoked', 'PERF Revoked Small', 'staff', 'small', true),
  ('inactive', 'PERF Inactive Manager', 'manager', 'small', false),
  ('plain', 'PERF Plain Staff Big', 'staff', 'big', true),
  ('reject-manager', 'PERF Reject Manager', 'manager', 'reject', true),
  ('reject-staff', 'PERF Reject Staff', 'staff', 'reject', true)
) v(k, name, role, at, active);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
       now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from dp;

insert into public.profiles (id, display_name, role, venue_id, active, created_at)
select id, name, role, venue_id, active, now() - interval '25 months' from dp;

insert into public.venue_manager_grants (staff_id, venue_id, granted_by, granted_at,
  revoked_at, revoked_by, revoke_kind, revoke_reason)
select dp.id, dp.venue_id, dk.admin, now() - interval '6 months',
       case when dp.k = 'revoked' then now() - interval '1 month' end,
       case when dp.k = 'revoked' then dk.admin end,
       case when dp.k = 'revoked' then 'revoked' end,
       case when dp.k = 'revoked' then 'PERF: grant ended' end
from dp, dk
where dp.k in ('grantee', 'revoked', 'inactive', 'reject-manager');

-- ---------------------------------------------------------------- new assets
create temp table na (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null, venue_id uuid not null, created_at timestamptz not null,
  state text not null default 'ready', deleted boolean not null default false,
  role public.app_role, media_type text not null default 'image', baseline text not null,
  tag text not null, n int not null, labelled boolean not null default false
);

-- Reject venue: 24 months of one staff member's uploads.
insert into na (uploader_id, venue_id, created_at, state, deleted, media_type, baseline, tag, n)
select pg_temp.did('person-reject-staff'), pg_temp.did('venue-reject'),
       now() - interval '2 hours' - (g * interval '1 minute') * (1051200.0 / 73600),
       case when g % 211 = 5 then 'processing' else 'ready' end, g % 200 = 3,
       case when g % 7 = 0 then 'video' else 'image' end, 'legacy_unknown', 'reject', g
from generate_series(1, 73600) g;

-- The grantee's own uploads: 500 ready over 24 months (stored role null or
-- staff), then 20 deleted or not ready.
insert into na (uploader_id, venue_id, created_at, state, deleted, role, media_type, baseline, tag, n)
select pg_temp.did('person-grantee'), dk.small,
       now() - interval '3 hours' - (g * interval '1 minute') * (1051200.0 / 520),
       case when g > 500 and g % 2 = 0 then 'processing' else 'ready' end, g > 500 and g % 2 = 1,
       case when g % 2 = 0 then 'staff'::public.app_role end,
       case when g % 9 = 0 then 'video' else 'image' end, 'legacy_unknown', 'grantee', g
from dk, generate_series(1, 520) g;

-- 'none'-baseline uploads after the use cutover: 600 at big, 150 at small,
-- half labelled.
insert into na (uploader_id, venue_id, created_at, media_type, baseline, tag, n, labelled)
select s.uploader, s.venue, now() - ((g::float8 / (s.cnt + 40)) * (now() - dk.cutover)),
       case when g % 7 = 0 then 'video' else 'image' end, 'none', s.tag, g, g % 2 = 0
from dk
cross join lateral (values (dk.staff_big, dk.big, 'none_big', 600), (dk.staff_small, dk.small, 'none_small', 150))
  s(uploader, venue, tag, cnt)
cross join lateral generate_series(1, s.cnt) g;

-- Tie blocks of 60 rows sharing one timestamp: big T1..T4, small T5, T6.
insert into na (uploader_id, venue_id, created_at, state, deleted, role, media_type, baseline, tag, n, labelled)
select
  case when b.venue = dk.big then
    case p % 6 when 0 then dk.mgr_big when 1 then dk.mgr_big else dk.staff_big end
  else
    case p % 6 when 0 then dk.mgr_small when 1 then dk.mgr_small when 2 then pg_temp.did('person-grantee')
      when 5 then pg_temp.did('person-grantee') else dk.staff_small end
  end,
  b.venue, b.at,
  case when p % 12 = 11 then 'processing' else 'ready' end, p % 12 = 5,
  case when p % 6 = 0 then 'manager'::public.app_role end,
  case when p % 10 = 7 then 'video' else 'image' end,
  case when b.at > dk.cutover then 'none' else 'legacy_unknown' end,
  'tie_' || b.k, p,
  case when b.venue = dk.big then p % 6 in (2, 3, 5) else p % 6 in (3, 5) end
from dk
cross join lateral (values
  ('t1', dk.big, date_trunc('second', now()) - interval '20 seconds'),
  ('t2', dk.big, date_trunc('second', now()) - interval '3 days'),
  ('t3', dk.big, date_trunc('second', now()) - interval '200 days'),
  ('t4', dk.big, date_trunc('second', now()) - interval '400 days'),
  ('t5', dk.small, date_trunc('second', now()) - interval '2 days'),
  ('t6', dk.small, date_trunc('second', now()) - interval '100 days')
) b(k, venue, at)
cross join generate_series(1, 60) p;

-- Deleted, processing and failed rows over 24 months, labelled (so only the
-- ready/deleted rule keeps them out): 300 at big, 60 at small.
insert into na (uploader_id, venue_id, created_at, state, deleted, media_type, baseline, tag, n, labelled)
select s.uploader, s.venue, now() - interval '4 hours' - (g * interval '1 minute') * (1051200.0 / s.cnt),
       case g % 4 when 1 then 'processing' when 3 then 'failed' else 'ready' end, g % 2 = 0,
       case when g % 7 = 0 then 'video' else 'image' end, 'legacy_unknown', s.tag, g, true
from dk
cross join lateral (values (dk.staff_big, dk.big, 'gone_big', 300), (dk.staff_small, dk.small, 'gone_small', 60))
  s(uploader, venue, tag, cnt)
cross join lateral generate_series(1, s.cnt) g;

insert into public.media_assets (id, uploader_id, venue_id, original_path, preview_path, thumbnail_path,
  original_filename, media_type, validated_mime_type, size_bytes, width, height, duration_seconds,
  upload_state, created_at, updated_at, deleted_at, uploader_role, use_baseline)
select n.id, n.uploader_id, n.venue_id, n.uploader_id || '/' || n.id || '/original.jpg',
       case when n.state = 'ready' then n.uploader_id || '/' || n.id || '/preview.webp' end,
       case when n.state = 'ready' then n.uploader_id || '/' || n.id || '/thumb.webp' end,
       'IMG_' || lpad((1000 + n.n % 9000)::text, 4, '0') || '.jpg',
       n.media_type::public.media_type,
       case when n.state = 'ready' then case when n.media_type = 'video' then 'video/mp4' else 'image/jpeg' end end,
       case when n.state = 'ready' then 3500000 end,
       case when n.state = 'ready' then 4032 end, case when n.state = 'ready' then 3024 end,
       case when n.state = 'ready' and n.media_type = 'video' then 30 end,
       n.state::public.upload_state, n.created_at, n.created_at + interval '20 seconds',
       case when n.deleted then n.created_at + interval '30 minutes' end, n.role, n.baseline
from na n;

-- ---------------------------------------------------------------- labels
-- The most labelled item of each venue.
create temp table vpop as
select distinct on (li.venue_id) li.venue_id, li.item_id, li.item_name, li.section_name, li.section_slug, li.version_id
from public.media_label_items li
join (
  select x.venue_id, x.item_id, count(*) as n from public.media_label_items x
  where x.venue_id in ((select big from dk), (select small from dk), (select other from dk))
  group by 1, 2
) c on c.venue_id = li.venue_id and c.item_id = li.item_id
order by li.venue_id, c.n desc, li.item_id, li.added_at;

insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select n.id, n.venue_id, array['dish'], null, true, 1, n.created_at + interval '1 minute',
       n.created_at + interval '1 minute', n.uploader_id
from na n where n.labelled;

insert into public.media_label_items (asset_id, venue_id, item_id, variant_id, item_name, variant_name,
  section_name, section_slug, version_id, added_by, added_at)
select n.id, n.venue_id, p.item_id, null, p.item_name, null, p.section_name, p.section_slug, p.version_id,
       n.uploader_id, n.created_at + interval '1 minute'
from na n join vpop p on p.venue_id = n.venue_id where n.labelled;

-- Reject venue: a third carry non-food labels (team, venue), never items.
insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select n.id, n.venue_id, case when n.n % 2 = 0 then array['venue'] else array['team', 'kitchen'] end,
       null, false, 1, n.created_at + interval '1 minute', n.created_at + interval '1 minute', n.uploader_id
from na n where n.tag = 'reject' and n.n % 3 = 0;

-- ---------------------------------------------------------------- existing assets to decorate
-- Generated ready assets of big, small and other in no group and not new,
-- ranked in a stable pseudo-random order: U = no media_labels row at all,
-- L = with label items.
create temp table pick as
select a.id, a.venue_id, a.uploader_id, a.created_at, a.media_type,
       case when exists (select 1 from public.media_label_items li where li.asset_id = a.id) then 'L'
            when not exists (select 1 from public.media_labels ml where ml.asset_id = a.id) then 'U' end as kind,
       null::int as rn
from public.media_assets a, dk
where a.venue_id in (dk.big, dk.small, dk.other)
  and a.upload_state = 'ready' and a.deleted_at is null
  and a.uploader_id not in (dk.mgr_big, dk.mgr_small)
  and a.id not in (select id from na)
  and not exists (select 1 from public.media_contribution_group_members m where m.asset_id = a.id);
delete from pick where kind is null;
update pick p set rn = r.rn
from (select id, row_number() over (partition by venue_id, kind order by hashtextextended(id::text, 5), id) as rn from pick) r
where r.id = p.id;
delete from pick where rn > 2000;
create index on pick (venue_id, kind, rn);

-- Food-typed unlabelled images and videos, kitchen-only and empty labels.
insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select p.id, p.venue_id,
       case when p.rn <= 1300 then case p.rn % 3 when 0 then array['dish'] when 1 then array['drinks', 'plating'] else array['preparation', 'venue'] end
            when p.rn <= 1350 then array['kitchen'] else array[]::text[] end,
       null, false, 1, p.created_at + interval '1 hour', p.created_at + interval '1 hour', p.uploader_id
from pick p, dk
where p.kind = 'U'
  and ((p.venue_id = dk.big and p.rn between 1001 and 1380)
    or (p.venue_id = dk.small and p.rn between 201 and 340));

-- ---------------------------------------------------------------- amenity checks and submissions
insert into public.venue_amenity_checks (id, venue_id, template_key, status, progress, answer, revision, created_by, created_at, updated_at)
select pg_temp.did('chk-' || c.k), c.venue, c.template, c.status, 'needs_capture', 'to_check', 1, dk.admin,
       now() - interval '200 days', now() - interval '1 day'
from dk cross join lateral (values
  ('big-out', dk.big, 'outdoor_seating', 'active'),
  ('big-toil', dk.big, 'guest_toilets', 'archived'),
  ('small-out', dk.small, 'outdoor_seating', 'archived'),
  ('small-toil', dk.small, 'guest_toilets', 'archived'),
  ('other-out', dk.other, 'outdoor_seating', 'active')
) c(k, venue, template, status);

create temp table asub (k text, chk text, venue uuid, by uuid, i int);
insert into asub
select 'big-out-' || i, 'big-out', dk.big, case when i % 2 = 0 then dk.staff_big else dk.mgr_big end, i
from dk, generate_series(1, 4) i;
insert into asub select 'big-toil-1', 'big-toil', dk.big, dk.staff_big, 1 from dk;
insert into asub select 'small-out-1', 'small-out', dk.small, pg_temp.did('person-grantee'), 1 from dk;
insert into asub select 'small-out-2', 'small-out', dk.small, dk.staff_small, 2 from dk;
insert into asub select 'other-out-1', 'other-out', dk.other, dk.staff_other, 1 from dk;

insert into public.amenity_submissions (id, check_id, venue_id, submitted_by, answer, template_version, evidence_rule,
  idempotency_key, result_revision, created_at, submitter_basis)
select pg_temp.did('asub-' || s.k), pg_temp.did('chk-' || s.chk), s.venue, s.by, 'yes', 1, 'either',
       pg_temp.did('asub-key-' || s.k), 1 + s.i, now() - (10 - s.i) * interval '1 day',
       case when s.by = (select mgr_big from dk) then 'venue_manager' else 'staff' end
from asub s;

-- Evidence: big outdoor U 1..170 and L 1..30 over the 4 submissions, big
-- toilets U 171..200, small outdoor U 1..50, other U 1..40; plus deleted and
-- not-ready rows at big.
insert into public.amenity_submission_assets (submission_id, venue_id, asset_id, evidence_kind)
select pg_temp.did('asub-' || x.sk), x.venue_id, x.id, case when x.media_type = 'video' then 'video' else 'photo' end
from (
  select p.id, p.venue_id, p.media_type, 'big-out-' || (1 + p.rn % 4) as sk
  from pick p, dk where p.venue_id = dk.big and ((p.kind = 'U' and p.rn <= 170) or (p.kind = 'L' and p.rn <= 30))
  union all
  select p.id, p.venue_id, p.media_type, 'big-toil-1' from pick p, dk where p.venue_id = dk.big and p.kind = 'U' and p.rn between 171 and 200
  union all
  select p.id, p.venue_id, p.media_type, 'small-out-' || (1 + p.rn % 2) from pick p, dk where p.venue_id = dk.small and p.kind = 'U' and p.rn <= 50
  union all
  select p.id, p.venue_id, p.media_type, 'other-out-1' from pick p, dk where p.venue_id = dk.other and p.kind = 'U' and p.rn <= 40
  union all
  select n.id, n.venue_id, n.media_type::public.media_type, 'big-out-1' from na n where n.tag = 'gone_big' and n.n <= 12
) x;

-- ---------------------------------------------------------------- knowledge contributions
insert into public.knowledge_contributions (id, venue_id, check_id, question_key, contributed_by, contributor_basis,
  kind, answer, based_on_slot_revision, rule_version, template_version, evidence_rule, initial_outcome,
  idempotency_key, request_hash, created_at)
select pg_temp.did('kc-' || c.k), c.venue, pg_temp.did('chk-' || c.chk), c.q, c.by, 'staff', 'finding', 'yes',
       0, 1, 1, 'either', 'recorded', pg_temp.did('kc-key-' || c.k),
       md5('perfb05d-kc-a-' || c.k) || md5('perfb05d-kc-b-' || c.k), now() - interval '20 days'
from dk cross join lateral (values
  ('big', dk.big, 'big-toil', 'guest_toilets', dk.staff_big),
  ('small', dk.small, 'small-toil', 'guest_toilets', pg_temp.did('person-grantee')),
  ('other', dk.other, 'other-out', 'outdoor_seating', dk.staff_other)
) c(k, venue, chk, q, by);

insert into public.knowledge_contribution_assets (contribution_id, venue_id, asset_id, evidence_kind)
select pg_temp.did('kc-' || x.k), x.venue_id, x.id, case when x.media_type = 'video' then 'video' else 'photo' end
from (
  select p.id, p.venue_id, p.media_type, 'big' as k from pick p, dk
  where p.venue_id = dk.big and ((p.kind = 'U' and p.rn between 201 and 320) or (p.kind = 'L' and p.rn between 31 and 60))
  union all
  select p.id, p.venue_id, p.media_type, 'small' from pick p, dk where p.venue_id = dk.small and p.kind = 'U' and p.rn between 51 and 80
  union all
  select p.id, p.venue_id, p.media_type, 'other' from pick p, dk where p.venue_id = dk.other and p.kind = 'U' and p.rn between 41 and 60
  union all
  select n.id, n.venue_id, n.media_type::public.media_type, 'big' from na n where n.tag = 'gone_big' and n.n between 13 and 20
) x;

-- ---------------------------------------------------------------- coverage
insert into public.coverage_requirements (id, venue_id, kind, title, status, amenity_key, created_by, created_at, updated_at)
select pg_temp.did('req-' || r.k), r.venue, r.kind, 'PERF B05 ' || r.k, 'active', r.amenity, dk.admin,
       now() - interval '300 days', now() - interval '300 days'
from dk cross join lateral (values
  ('big-out', dk.big, 'amenity', 'outdoor_seating'),
  ('big-vs', dk.big, 'venue_specific', null),
  ('small-vs', dk.small, 'venue_specific', null),
  ('other-vs', dk.other, 'venue_specific', null)
) r(k, venue, kind, amenity);

-- Items: big outdoor U 321..440, L 61..90 and U 1..20 (also amenity
-- evidence); big venue-specific U 441..560, L 91..120 and 10 of the big
-- manager's staff-era uploads (vetoed for it); small U 81..120; other U
-- 61..90; the grantee's own 1..20 (its own submission).
create temp table citem as
select x.*, row_number() over (order by x.req, x.created_at, x.id) as rn
from (
  select p.id, p.venue_id, p.uploader_id, p.created_at, 'big-out' as req, 'big-out' as sub
  from pick p, dk where p.venue_id = dk.big and ((p.kind = 'U' and (p.rn between 321 and 440 or p.rn <= 20)) or (p.kind = 'L' and p.rn between 61 and 90))
  union all
  select p.id, p.venue_id, p.uploader_id, p.created_at, 'big-vs', 'big-vs' from pick p, dk
  where p.venue_id = dk.big and ((p.kind = 'U' and p.rn between 441 and 560) or (p.kind = 'L' and p.rn between 91 and 120))
  union all
  select a.id, a.venue_id, a.uploader_id, a.created_at, 'big-vs', 'big-vs'
  from (select a.* from public.media_assets a, dk where a.uploader_id = dk.mgr_big and a.uploader_role is null
          and a.upload_state = 'ready' and a.deleted_at is null order by a.created_at desc, a.id limit 10) a
  union all
  select p.id, p.venue_id, p.uploader_id, p.created_at, 'small-vs', 'small-vs' from pick p, dk where p.venue_id = dk.small and p.kind = 'U' and p.rn between 81 and 120
  union all
  select p.id, p.venue_id, p.uploader_id, p.created_at, 'other-vs', 'other-vs' from pick p, dk where p.venue_id = dk.other and p.kind = 'U' and p.rn between 61 and 90
  union all
  select n.id, n.venue_id, n.uploader_id, n.created_at, 'small-vs', 'small-grantee' from na n where n.tag = 'grantee' and n.n <= 20
) x;

insert into public.coverage_submissions (id, venue_id, submitted_by, kind, requirement_id, client_request_key, asset_ids, created_at)
select pg_temp.did('csub-' || c.sub), min(c.venue_id::text)::uuid,
       case when c.sub = 'small-grantee' then pg_temp.did('person-grantee') else (select admin from dk) end,
       case when c.sub = 'small-grantee' then 'staff_submit' else 'manager_attach' end,
       pg_temp.did('req-' || min(c.req)), 'perfb05d-' || c.sub, array_agg(c.id order by c.rn), now() - interval '30 days'
from citem c group by c.sub;

insert into public.coverage_submission_items (submission_id, venue_id, asset_id, author_id, requirement_id, origin,
  submitted_by, submitted_at, submitted_month, uploaded_at, uploaded_month, state, decision_reason,
  decided_by, decided_at, self_review, archived_at, archive_kind)
select pg_temp.did('csub-' || c.sub), c.venue_id, c.id, c.uploader_id, pg_temp.did('req-' || c.req),
       case when c.sub = 'small-grantee' then 'submitted' else 'attached' end,
       case when c.sub = 'small-grantee' then pg_temp.did('person-grantee') else dk.admin end,
       now() - interval '30 days', private.london_month(now() - interval '30 days'),
       c.created_at, private.london_month(c.created_at),
       case when c.rn % 7 = 0 then 'needs_another_photo' when c.rn % 7 in (1, 2) then 'accepted' else 'submitted' end,
       case when c.rn % 7 = 0 then 'PERF: another photo please' end,
       case when c.rn % 7 in (0, 1, 2) then dk.admin end,
       case when c.rn % 7 in (0, 1, 2) then now() - interval '20 days' end,
       case when c.rn % 7 in (0, 1, 2) then false end,
       case when c.rn % 11 = 0 then now() - interval '10 days' end,
       case when c.rn % 11 = 0 then 'requirement_retired' end
from citem c, dk;

-- ---------------------------------------------------------------- fact media
insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence, created_at, updated_at)
select pg_temp.did('fact-' || f.k), f.venue, f.amenity, 'present', now() - interval '300 days', now() - interval '300 days'
from dk cross join lateral (values
  ('big-out', dk.big, 'outdoor_seating'),
  ('big-park', dk.big, 'parking'),
  ('small-toil', dk.small, 'toilets'),
  ('other-out', dk.other, 'outdoor_seating')
) f(k, venue, amenity);

insert into public.venue_amenity_fact_media (fact_id, venue_id, asset_id, added_by, added_at)
select pg_temp.did('fact-' || x.k), x.venue_id, x.id, (select admin from dk), now() - interval '100 days'
from (
  select p.id, p.venue_id, 'big-out' as k from pick p, dk where p.venue_id = dk.big and ((p.kind = 'U' and p.rn between 561 and 620) or (p.kind = 'L' and p.rn between 121 and 130))
  union all
  select p.id, p.venue_id, 'big-park' from pick p, dk where p.venue_id = dk.big and p.kind = 'U' and p.rn between 621 and 650
  union all
  select p.id, p.venue_id, 'small-toil' from pick p, dk where p.venue_id = dk.small and p.kind = 'U' and p.rn between 121 and 140
  union all
  select p.id, p.venue_id, 'other-out' from pick p, dk where p.venue_id = dk.other and p.kind = 'U' and p.rn between 91 and 105
) x;

-- ---------------------------------------------------------------- groups
insert into public.media_contribution_groups (id, venue_id, created_by, subject_kind, subject_id, client_group_key, created_at)
select pg_temp.did('group-small'), dk.small, pg_temp.did('person-grantee'), 'none', null::uuid, 'perfb05d-group-small', now() - interval '5 days' from dk
union all
select pg_temp.did('group-other'), dk.other, dk.staff_other, 'none', null, 'perfb05d-group-other', now() - interval '5 days' from dk;

insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position, added_at)
select pg_temp.did('group-small'), n.venue_id, n.id, (n.n - 20)::smallint, now() - interval '5 days'
from na n where n.tag = 'grantee' and n.n between 21 and 26
union all
select pg_temp.did('group-other'), p.venue_id, p.id, (p.rn - 200)::smallint, now() - interval '5 days'
from pick p, dk where p.venue_id = dk.other and p.kind = 'U' and p.rn between 201 and 205;

-- ---------------------------------------------------------------- use grants
-- kind: in_force, scheduled, expired, withdrawn; pairs on some rows.
create temp table dg (asset_id uuid, venue_id uuid, created_at timestamptz, kind text, dest text);
-- 'none' baseline rows (and the T1 tie block): by n % 6 none, in force at
-- either destination, withdrawn, expired, scheduled; n % 12 = 1 also
-- withdrawn, n % 12 = 4 also in force.
insert into dg
select n.id, n.venue_id, n.created_at,
       case n.n % 6 when 1 then 'in_force' when 2 then 'in_force' when 3 then 'withdrawn' when 4 then 'expired' when 5 then 'scheduled' end,
       case when n.n % 6 = 2 then 'perf_social' else 'perf_menu_web' end
from na n where n.baseline = 'none' and n.n % 6 <> 0;
insert into dg select n.id, n.venue_id, n.created_at, 'withdrawn', 'perf_social' from na n where n.baseline = 'none' and n.n % 12 = 1;
insert into dg select n.id, n.venue_id, n.created_at, 'in_force', 'perf_social' from na n where n.baseline = 'none' and n.n % 12 = 4;
-- A scheduled grant beside a withdrawn one (n % 12 = 3: still withdrawn) and
-- at perf_social beside one in force at perf_menu_web (n % 12 = 7: in force,
-- but not at perf_social).
insert into dg select n.id, n.venue_id, n.created_at, 'scheduled', 'perf_social' from na n where n.baseline = 'none' and n.n % 12 in (3, 7);
-- Legacy rows: labelled big L 200..500 and small L 200..260: scheduled,
-- in force + withdrawn, expired + withdrawn.
insert into dg
select p.id, p.venue_id, p.created_at, k.kind, k.dest
from pick p, dk
cross join lateral (values ('scheduled', 'perf_menu_web', 0), ('in_force', 'perf_menu_web', 1), ('withdrawn', 'perf_social', 1),
  ('expired', 'perf_menu_web', 2), ('withdrawn', 'perf_menu_web', 2)) k(kind, dest, m)
where p.kind = 'L' and p.rn % 3 = k.m
  and ((p.venue_id = dk.big and p.rn between 200 and 500) or (p.venue_id = dk.small and p.rn between 200 and 260));
-- ... and on rn % 6 = 2 (expired + withdrawn) also scheduled at perf_social.
insert into dg
select p.id, p.venue_id, p.created_at, 'scheduled', 'perf_social'
from pick p, dk
where p.kind = 'L' and p.rn % 6 = 2
  and ((p.venue_id = dk.big and p.rn between 200 and 500) or (p.venue_id = dk.small and p.rn between 200 and 260));
-- Legacy tie blocks: p % 5 = 0 in force, p % 10 = 3 withdrawn.
insert into dg
select n.id, n.venue_id, n.created_at, case when n.n % 5 = 0 then 'in_force' else 'withdrawn' end, 'perf_menu_web'
from na n where n.tag like 'tie_%' and n.baseline = 'legacy_unknown' and (n.n % 5 = 0 or n.n % 10 = 3);

create temp table dgi as select gen_random_uuid() as id, g.*, row_number() over (order by g.asset_id, g.kind, g.dest) as n from dg g;

insert into public.media_use_grants (id, asset_id, venue_id, destination_key, audience, purpose, subject_kind,
  subject_id, subject_key, derivative_profile_key, effective_from, effective_until, authorised_by, authority_basis,
  clearance_version, clearance, internal_note, request_key, created_at)
select g.id, g.asset_id, g.venue_id, g.dest, 'internal', 'general_gallery', 'none', null, null, null,
       case g.kind when 'scheduled' then now() + interval '30 days'
                   when 'expired' then g.created_at - interval '60 days'
                   else g.created_at end,
       case when g.kind = 'expired' then g.created_at - interval '1 second' end,
       dk.admin, 'admin', 'perf-v1', '{}'::jsonb, null, 'perfb05d' || lpad(g.n::text, 10, '0'), g.created_at
from dgi g, dk;

insert into public.media_use_grant_withdrawals (grant_id, withdrawn_by, reason_code, withdrawn_at)
select g.id, dk.admin, 'granter_withdrawn', least(g.created_at + interval '1 minute', now())
from dgi g, dk where g.kind = 'withdrawn';

commit;
reset session_replication_role;

vacuum (analyze) public.media_assets, public.media_labels, public.media_label_items, public.profiles,
  public.venue_manager_grants, public.venues, public.venue_amenity_checks, public.amenity_submissions,
  public.amenity_submission_assets, public.knowledge_contributions, public.knowledge_contribution_assets,
  public.coverage_requirements, public.coverage_submissions, public.coverage_submission_items,
  public.venue_amenity_facts, public.venue_amenity_fact_media, public.media_contribution_groups,
  public.media_contribution_group_members, public.media_use_grants, public.media_use_grant_withdrawals;
