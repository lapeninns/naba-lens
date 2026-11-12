-- B05 additions to the generated PERF world (tests/perf/b05-bench.mjs). Run
-- after generate.mjs, as postgres, on a local workstream stack only. Same
-- conventions as generate.sql: replica mode (user and FK triggers off), every
-- row synthetic and PERF-named (people at @perf.nabalens.test, group keys
-- perfb05-*, request keys perfb05*). Works on schemas from before B05 (the
-- B05-only parts are skipped by to_regclass checks), so the A/B base gets the
-- same managers, menu decisions and groups as the head.
--
-- Adds, at the largest PERF venue (big) and the smallest (small):
-- * people: a manager account per venue (open venue_manager_grants row), a
--   group creator and a colleague (staff, big venue). Their emails do not match
--   perf-staff-%, so targets.mjs picks the same staff as before;
-- * the big manager's uploads: 3,000 staff-era (uploader_role null, as the
--   generated rows) and 1,500 manager-era; the small manager's 300 and 100;
-- * labels on the ready members of the read fixtures (below);
-- * the worst-case data asset search must skip: 2,000 of the big manager's
--   staff-era uploads labelled with one rare item (the manager may never see
--   them; the item has at most 3 other labels);
-- * menu_item_photos: one decision on about 2% of labelled assets per venue;
-- * contribution groups: every perf-staff member's latest 120 uploads in
--   groups of 4, plus fixed groups for the reads (3 and 10 members, and 30
--   positions on B05) and 23 groups per write case;
-- * B05 only: two destinations and use grants (3% in force, 0.5% expired,
--   0.2% withdrawn), withdrawn grants on 1,500 invisible staff-era uploads of
--   the big manager and on 2 visible manager-era ones, replacement links.
--
--   psql "$SUPABASE_DB_URL" -v seed=0.42 -f tests/perf/b05-world.sql
\set ON_ERROR_STOP on
set session_replication_role = replica;
set work_mem = '64MB';
select setseed(:seed);

begin;

create temp table bv as
select (array_agg(id order by n desc, slug))[1] as big,
       (array_agg(id order by n asc, slug desc))[1] as small
from (
  select v.id, v.slug, count(a.id) as n
  from public.venues v left join public.media_assets a on a.venue_id = v.id and a.deleted_at is null
  where v.slug like 'perf-venue-%' group by 1, 2
) x;

create temp table badmin as
select p.id from public.profiles p join auth.users u on u.id = p.id
where u.email = 'perf-admin-1@perf.nabalens.test';

-- ---------------------------------------------------------------- people
create temp table bp as
select k, gen_random_uuid() as id, 'perf-b05-' || replace(k, '_', '-') || '@perf.nabalens.test' as email,
       name, role::public.app_role as role, case when big_venue then (select big from bv) else (select small from bv) end as venue_id
from (values
  ('manager_big', 'PERF Manager Big', 'manager', true),
  ('manager_small', 'PERF Manager Small', 'manager', false),
  ('creator', 'PERF Creator Big', 'staff', true),
  ('colleague', 'PERF Colleague Big', 'staff', true)
) v(k, name, role, big_venue);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
       now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from bp;

insert into public.profiles (id, display_name, role, venue_id, active, created_at)
select id, name, role, venue_id, true, now() - interval '25 months' from bp;

insert into public.venue_manager_grants (staff_id, venue_id, granted_by, granted_at)
select bp.id, bp.venue_id, (select id from badmin), now() - interval '6 months'
from bp where bp.role = 'manager';

-- ---------------------------------------------------------------- assets
-- tag: staff_era / manager_era (managers), own (creator), and the write and
-- read fixtures (assigned below).
create temp table nb (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid, venue_id uuid, created_at timestamptz, state text, role public.app_role,
  deleted boolean default false, tag text, n int
);

insert into nb (uploader_id, venue_id, created_at, state, role, tag, n)
select bp.id, bp.venue_id,
       case when s.era = 'staff_era' then now() - interval '7 months' - (g * interval '1 minute') * (510000.0 / s.cnt)
            else now() - (g * interval '1 minute') * (250000.0 / s.cnt) end,
       'ready', case when s.era = 'manager_era' then 'manager'::public.app_role end, s.era, g
from bp
join (values ('manager_big', 'staff_era', 3000), ('manager_big', 'manager_era', 1500),
             ('manager_small', 'staff_era', 300), ('manager_small', 'manager_era', 100),
             ('creator', 'own', 400)) s(k, era, cnt) on s.k = bp.k
cross join lateral generate_series(1, s.cnt) g;

-- Group fixtures of the creator: reads (g3, g10, g30) and writes (23 groups
-- per case: add9 = 9 ready; rep9 = 8 ready + a failed 9th; p29 = 29 positions,
-- 1..19 failed and replaced by k + 10, 20 failed and not replaced, 21..29
-- ready). p29 needs positions past 10, so it exists on B05 only. Each write
-- also needs one new own upload (fresh).
create temp table gf (gkey text, kind text, pos int, state text, deleted boolean);
insert into gf select 'perfb05-g3', 'read', p, 'ready', false from generate_series(1, 3) p;
insert into gf select 'perfb05-g10', 'read', p,
  case when p = 9 then 'failed' else 'ready' end, p = 10 from generate_series(1, 10) p;
insert into gf select 'perfb05-add9-' || lpad(i::text, 2, '0'), 'add9', p, 'ready', false
  from generate_series(1, 23) i, generate_series(1, 9) p;
insert into gf select 'perfb05-rep9-' || lpad(i::text, 2, '0'), 'rep9', p,
  case when p = 9 then 'failed' else 'ready' end, false
  from generate_series(1, 23) i, generate_series(1, 9) p;

create temp table b05 as select to_regclass('public.media_asset_links') is not null as on_b05;
insert into gf
select 'perfb05-g30', 'read30', p,
       case when p <= 20 then 'failed' else 'ready' end, p in (13, 17)
from generate_series(1, 30) p where (select on_b05 from b05);
insert into gf
select 'perfb05-' || c || '-' || lpad(i::text, 2, '0'), c, p,
       case when p <= 20 then 'failed' else 'ready' end, false
from (values ('add29'), ('rep29')) cc(c), generate_series(1, 23) i, generate_series(1, 29) p
where (select on_b05 from b05);

alter table gf add column asset_id uuid default gen_random_uuid();
insert into nb (id, uploader_id, venue_id, created_at, state, role, deleted, tag, n)
select gf.asset_id, bp.id, bp.venue_id, now() - interval '2 hours' - (gf.pos * interval '1 minute'),
       gf.state, null, gf.deleted, 'group', gf.pos
from gf cross join bp where bp.k = 'creator';
-- Fresh uploads for the writes: two per write group (add and replace use one each).
insert into nb (uploader_id, venue_id, created_at, state, role, tag, n)
select bp.id, bp.venue_id, now() - interval '1 hour' + g * interval '1 second', 'ready', null, 'fresh', g
from bp cross join generate_series(1, 200) g where bp.k = 'creator';

insert into public.media_assets (id, uploader_id, venue_id, original_path, preview_path, thumbnail_path,
  original_filename, media_type, validated_mime_type, size_bytes, width, height, duration_seconds,
  upload_state, created_at, updated_at, deleted_at, uploader_role)
select n.id, n.uploader_id, n.venue_id, n.uploader_id || '/' || n.id || '/original.jpg',
       case when n.state = 'ready' then n.uploader_id || '/' || n.id || '/preview.webp' end,
       case when n.state = 'ready' then n.uploader_id || '/' || n.id || '/thumb.webp' end,
       case when n.tag = 'fresh' then 'PERFB05_FRESH_' || n.n || '.jpg'
            else 'IMG_' || lpad((1000 + n.n % 9000)::text, 4, '0') || '.jpg' end,
       case when n.tag in ('staff_era', 'manager_era') and n.n % 7 = 0 then 'video' else 'image' end::public.media_type,
       case when n.state = 'ready' then
         case when n.tag in ('staff_era', 'manager_era') and n.n % 7 = 0 then 'video/mp4' else 'image/jpeg' end end,
       case when n.state = 'ready' then 3500000 end,
       case when n.state = 'ready' then 4032 end, case when n.state = 'ready' then 3024 end,
       case when n.state = 'ready' and n.tag in ('staff_era', 'manager_era') and n.n % 7 = 0 then 30 end,
       n.state::public.upload_state, n.created_at, n.created_at + interval '20 seconds',
       case when n.deleted then n.created_at + interval '30 minutes' end, n.role
from nb n;

-- Use baseline as generate.sql sets it (B05 only).
do $baseline$
begin
  if to_regclass('private.media_use_settings') is not null then
    execute $q$
      update public.media_assets a set use_baseline = 'legacy_unknown'
      where a.id in (select id from nb)
        and a.created_at < (select s.cutover_at from private.media_use_settings s)
    $q$;
  end if;
end
$baseline$;

-- ---------------------------------------------------------------- labels
-- The rare item of the big venue (fewest labels, at least 1), on 2,000 of the
-- big manager's staff-era uploads, plus labels on 40% of the manager-era ones.
create temp table rare as
select li.item_id, li.item_name, li.section_name, li.section_slug, li.version_id
from public.media_label_items li
where li.venue_id = (select big from bv)
  and li.item_id = (
    select item_id from public.media_label_items where venue_id = (select big from bv)
    group by item_id order by count(*), item_id limit 1)
limit 1;

create temp table pop as
select li.item_id, li.item_name, li.section_name, li.section_slug, li.version_id
from public.media_label_items li
where li.venue_id = (select big from bv)
  and li.item_id = (
    select item_id from public.media_label_items where venue_id = (select big from bv)
    group by item_id order by count(*) desc, item_id limit 1)
limit 1;

create temp table nlab as
select n.id as asset_id, n.venue_id, n.uploader_id, n.created_at, 'rare' as which
from nb n join bp on bp.id = n.uploader_id
where bp.k = 'manager_big' and n.tag = 'staff_era' and n.n <= 2000
union all
select n.id, n.venue_id, n.uploader_id, n.created_at, 'pop'
from nb n join bp on bp.id = n.uploader_id
where bp.k = 'manager_big' and n.tag = 'manager_era' and n.n % 5 < 2
union all
-- The read fixtures carry a label, so the venue's manager may see them
-- (menu_item_photo_asset) and reads them as a manager, not as not found.
select gf.asset_id, bp.venue_id, bp.id, now() - interval '2 hours', 'pop'
from gf cross join bp where bp.k = 'creator' and gf.kind like 'read%' and gf.state = 'ready' and not gf.deleted;

insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, created_at, updated_at, updated_by)
select asset_id, venue_id, array['dish'], null, true, 1, created_at + interval '1 hour', created_at + interval '1 hour', uploader_id
from nlab;

insert into public.media_label_items (asset_id, venue_id, item_id, variant_id, item_name, variant_name,
  section_name, section_slug, version_id, added_by, added_at)
select l.asset_id, l.venue_id, i.item_id, null, i.item_name, null, i.section_name, i.section_slug,
       i.version_id, l.uploader_id, l.created_at + interval '1 hour'
from nlab l join (select 'rare' as which, * from rare union all select 'pop', * from pop) i on i.which = l.which;

-- ---------------------------------------------------------------- menu decisions
-- One decision on about 2% of labelled assets per PERF venue: 80% accepted,
-- 10% better photo requested, 10% needs recheck. Variants left out (one live
-- row per asset and item).
insert into public.menu_item_photos (venue_id, item_id, variant_id, asset_id, author_id, state, reason, recheck_kind,
  item_name, variant_name, section_name, section_kind, menu_version_id, decided_by, decided_at, self_review,
  created_at, updated_at)
select x.venue_id, x.item_id, null, x.asset_id, x.uploader_id,
       case when x.r < 0.8 then 'accepted' when x.r < 0.9 then 'better_photo_requested' else 'needs_recheck' end,
       case when x.r >= 0.8 and x.r < 0.9 then 'PERF: a sharper photo please' end,
       case when x.r >= 0.9 then 'name_changed' end,
       x.item_name, null, coalesce(x.section_name, 'Mains'),
       case when x.section_slug in ('drinks', 'wine', 'cocktails') then 'drinks' else 'food' end,
       x.version_id, (select id from badmin), x.created_at + interval '2 days', false,
       x.created_at + interval '2 days', x.created_at + interval '2 days'
from (
  select distinct on (li.asset_id) li.asset_id, li.venue_id, li.item_id, li.item_name, li.section_name,
         li.section_slug, li.version_id, a.uploader_id, a.created_at, random() as r
  from public.media_label_items li
  join public.media_assets a on a.id = li.asset_id
  where li.venue_id in (select id from public.venues where slug like 'perf-venue-%')
    and li.version_id is not null and a.upload_state = 'ready' and a.deleted_at is null
    and hashtextextended(li.asset_id::text, 7) % 50 = 0
  order by li.asset_id, li.item_id
) x;

-- ---------------------------------------------------------------- groups
-- Bulk: every perf-staff member's latest 120 general uploads, in groups of 4
-- (subject none), at the asset's venue.
create temp table bg as
select a.id as asset_id, a.uploader_id, a.venue_id, a.created_at,
       row_number() over (partition by a.uploader_id, a.venue_id order by a.created_at desc, a.id desc) as rn
from public.media_assets a
join auth.users u on u.id = a.uploader_id and u.email like 'perf-staff-%'
where a.deleted_at is null and a.purpose = 'general';
delete from bg where rn > 120;
alter table bg add column gno int;
update bg set gno = (rn - 1) / 4;

create temp table bgg as
select uploader_id, venue_id, gno, gen_random_uuid() as id, max(created_at) as created_at
from bg group by 1, 2, 3;

insert into public.media_contribution_groups (id, venue_id, created_by, subject_kind, subject_id, client_group_key, created_at)
select id, venue_id, uploader_id, 'none', null,
       'perfb05-bulk-' || left(venue_id::text, 8) || '-' || lpad(gno::text, 3, '0'), created_at
from bgg;

insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position, added_at)
select g.id, b.venue_id, b.asset_id, (row_number() over (partition by g.id order by b.created_at, b.asset_id))::smallint,
       g.created_at
from bg b join bgg g on g.uploader_id = b.uploader_id and g.venue_id = b.venue_id and g.gno = b.gno;

-- Fixtures of the creator.
create temp table fg as
select gkey, kind, gen_random_uuid() as id from (select distinct gkey, kind from gf) x;

insert into public.media_contribution_groups (id, venue_id, created_by, subject_kind, subject_id, client_group_key, created_at)
select fg.id, bp.venue_id, bp.id,
       case when fg.kind like 'read%' then 'menu_item' else 'none' end,
       case when fg.kind like 'read%' then (select item_id from pop) end,
       fg.gkey, now() - interval '3 hours'
from fg cross join bp where bp.k = 'creator';

insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position, added_at)
select fg.id, bp.venue_id, gf.asset_id, gf.pos::smallint, now() - interval '2 hours'
from gf join fg on fg.gkey = gf.gkey cross join bp where bp.k = 'creator';

-- Replacement links (B05 only): in the 29- and 30-position fixtures, member
-- k (1..19, or 1..20 in g30) was replaced by member k + 10.
do $links$
begin
  if to_regclass('public.media_asset_links') is not null then
    insert into public.media_asset_links (asset_id, venue_id, related_asset_id, kind, group_id, created_by, created_at)
    select n.asset_id, bp.venue_id, o.asset_id, 'replaces_failed_member', fg.id, bp.id, now() - interval '90 minutes'
    from gf o
    join gf n on n.gkey = o.gkey and n.pos = o.pos + 10
    join fg on fg.gkey = o.gkey
    cross join bp
    where bp.k = 'creator'
      and ((o.kind in ('add29', 'rep29') and o.pos <= 19) or (o.kind = 'read30' and o.pos <= 20));
  end if;
end
$links$;

-- ---------------------------------------------------------------- use grants (B05)
do $grants$
declare
  v_admin uuid := (select id from badmin);
begin
  if to_regclass('public.media_use_grants') is null then
    return;
  end if;
  insert into public.media_use_destinations (key, label, audience, venue_id, owner_workstream, requires_derivative, active)
  values ('perf_menu_web', 'PERF menu website', 'internal', null, 'WS5', false, true),
         ('perf_social', 'PERF social posts', 'internal', null, 'WS5', false, true);

  create temp table gsel as
  select x.asset_id, x.venue_id, x.created_at, x.r,
         case when x.r < 0.030 then 'in_force' when x.r < 0.035 then 'expired' when x.r < 0.037 then 'withdrawn' end as kind
  from (select a.id as asset_id, a.venue_id, a.created_at, random() as r
  from public.media_assets a
  where a.venue_id in (select id from public.venues where slug like 'perf-venue-%')
    and a.upload_state = 'ready' and a.deleted_at is null
    and a.id not in (select id from nb)) x;
  delete from gsel where kind is null;
  -- The worst case for a manager's use filter: withdrawn grants it may not see
  -- (staff-era uploads of the big manager) and two it may (manager era).
  insert into gsel
  select n.id, n.venue_id, n.created_at, 0, 'withdrawn'
  from nb n join bp on bp.id = n.uploader_id
  where bp.k = 'manager_big' and ((n.tag = 'staff_era' and n.n > 1500) or (n.tag = 'manager_era' and n.n <= 2));
  -- The heaviest staff member's latest 20 photos are in use (feed use key).
  insert into gsel
  select a.id, a.venue_id, a.created_at, 0, 'in_force'
  from public.media_assets a
  where a.uploader_id = (
      select p.id from public.profiles p join auth.users u on u.id = p.id
      left join public.media_assets m on m.uploader_id = p.id and m.deleted_at is null
      where p.role = 'staff' and u.email like 'perf-staff-%' and p.active
      group by p.id order by count(m.id) desc limit 1)
    and a.upload_state = 'ready' and a.deleted_at is null
    and a.id not in (select asset_id from gsel)
  order by a.created_at desc, a.id desc limit 20;

  create temp table gins as
  select gen_random_uuid() as id, g.*, row_number() over (order by g.asset_id) as n from gsel g;

  insert into public.media_use_grants (id, asset_id, venue_id, destination_key, audience, purpose, subject_kind,
    subject_id, subject_key, derivative_profile_key, effective_from, effective_until, authorised_by, authority_basis,
    clearance_version, clearance, internal_note, request_key, created_at)
  select g.id, g.asset_id, g.venue_id, case when g.n % 3 = 0 then 'perf_social' else 'perf_menu_web' end,
         'internal', 'general_gallery', 'none', null, null, null,
         g.created_at + interval '3 days',
         case when g.kind = 'expired' then g.created_at + interval '30 days' end,
         v_admin, 'admin', 'perf-v1', '{}'::jsonb, null,
         'perfb05g' || lpad(g.n::text, 10, '0'), g.created_at + interval '3 days'
  from gins g;

  insert into public.media_use_grant_withdrawals (grant_id, withdrawn_by, reason_code, withdrawn_at)
  select g.id, v_admin, 'granter_withdrawn', g.created_at + interval '10 days'
  from gins g where g.kind = 'withdrawn';
end
$grants$;

commit;
reset session_replication_role;

vacuum (analyze) public.media_assets, public.media_labels, public.media_label_items, public.menu_item_photos,
  public.media_contribution_groups, public.media_contribution_group_members, public.profiles,
  public.venue_manager_grants;
do $v$ begin
  if to_regclass('public.media_use_grants') is not null then
    -- vacuum cannot run in a DO block; analyze is enough for the planner.
    execute 'analyze public.media_use_grants, public.media_use_grant_withdrawals, public.media_asset_links';
  end if;
end $v$;
