-- Times the archive audit's database calls on a synthetic library, in a scratch
-- schema that is created and dropped here. It never reads or writes public.*
-- rows: tables are structural copies (indexes and constraints, no triggers).
--
--   psql -v n=221150 -v missing=3 -f db-timing.sql   (via db-timing.sh)
\set ON_ERROR_STOP on
\if :{?n}
\else
  \set n 221150
\endif
\if :{?missing}
\else
  \set missing 3
\endif

drop schema if exists capacity_scratch cascade;
create schema capacity_scratch;
create table capacity_scratch.media_assets (like public.media_assets including all);
create table capacity_scratch.media_archive_receipts (like public.media_archive_receipts including all);
create table capacity_scratch.state (name text primary key, cursor_id bigint not null default 0, cycle_checked bigint not null default 0, last_run_at timestamptz);
insert into capacity_scratch.state(name) values ('originals');

\echo building :n assets (:missing without a receipt)
with ids as (
  select i, gen_random_uuid() as id, gen_random_uuid() as u, gen_random_uuid() as v
  from generate_series(1, :n) as i
)
insert into capacity_scratch.media_assets
  (id, uploader_id, venue_id, original_path, original_filename, media_type,
   validated_mime_type, size_bytes, upload_state, created_at)
select id, u, v, u::text || '/' || id::text || '/original.jpg', 'IMG_' || i || '.jpg',
       'image', 'image/jpeg', 5500000, 'ready',
       timestamptz '2026-10-31 00:00:00+00' - (:n - i) * interval '7 minutes'
from ids;

insert into capacity_scratch.media_archive_receipts
  (asset_id, sha256, size_bytes, mime_type, source_project_ref, source_key,
   blob_key, manifest_key, manifest_sha256, manifest)
select a.id, h, 5500000, 'image/jpeg', 'abcdefghijklmnopqrst', a.original_path,
       'abcdefghijklmnopqrst/blobs/sha256/' || substr(h, 1, 2) || '/' || h,
       'abcdefghijklmnopqrst/manifests/' || a.id::text || '/' || h || '/' || h || '.json',
       h,
       jsonb_build_object('format', 'nabalens-original-archive@1', 'assetId', a.id,
         'originalPath', a.original_path, 'pad', repeat('x', 420))
from (select *, row_number() over (order by created_at, id) as rn from capacity_scratch.media_assets) a,
     lateral (select md5(a.rn::text) || md5((a.rn + 1)::text) as h) x
where a.rn <= :n - :missing;

analyze capacity_scratch.media_assets;
analyze capacity_scratch.media_archive_receipts;

create function capacity_scratch.missing_count() returns bigint language sql stable as $$
  select count(*) from capacity_scratch.media_assets a
  where a.upload_state = 'ready'
    and not exists (select 1 from capacity_scratch.media_archive_receipts r where r.asset_id = a.id)
$$;
create function capacity_scratch.backfill_candidates(p_limit integer default 10)
returns table(asset_id uuid) language sql stable as $$
  select a.id from capacity_scratch.media_assets a
  where a.upload_state = 'ready'
    and not exists (select 1 from capacity_scratch.media_archive_receipts r where r.asset_id = a.id)
  order by a.created_at, a.id limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;

create function capacity_scratch.time_it(label text, statement text, runs int default 15)
returns void language plpgsql as $$
declare t timestamptz; ms double precision[] := '{}'; i int;
begin
  for i in 1..runs loop
    t := clock_timestamp();
    execute statement;
    ms := ms || (extract(epoch from clock_timestamp() - t) * 1000)::double precision;
  end loop;
  raise notice '% | median % ms | max % ms', rpad(label, 38),
    round(((select percentile_cont(0.5) within group (order by m) from unnest(ms) m))::numeric, 2),
    round(((select max(m) from unnest(ms) m))::numeric, 2);
end $$;

\pset tuples_only on
\echo --- timings (server side, loopback: no network round trip) ---
select capacity_scratch.time_it('missing_count()', 'select capacity_scratch.missing_count()');
select capacity_scratch.time_it('backfill_candidates(10)', 'select * from capacity_scratch.backfill_candidates(10)');
select capacity_scratch.time_it('receipts page, 20 rows at mid', format('select * from capacity_scratch.media_archive_receipts where id > %s order by id limit 20', :n / 2));
select capacity_scratch.time_it('receipts page, 51 rows (current)', format('select * from capacity_scratch.media_archive_receipts where id > %s order by id limit 51', :n / 2));
select capacity_scratch.time_it('max(id) at cycle start', 'select max(id) from capacity_scratch.media_archive_receipts');
select capacity_scratch.time_it('count(id <= target) at cycle start', 'select count(*) from capacity_scratch.media_archive_receipts where id <= (select max(id) from capacity_scratch.media_archive_receipts)');
select capacity_scratch.time_it('checkpoint UPDATE (state row)', 'update capacity_scratch.state set cursor_id = cursor_id + 1, cycle_checked = cycle_checked + 20 where name = ''originals''', 50);

\echo --- variant: archived flag plus partial index (suggestion, not in the migrations) ---
alter table capacity_scratch.media_assets add column archived boolean not null default false;
update capacity_scratch.media_assets a set archived = true
  where exists (select 1 from capacity_scratch.media_archive_receipts r where r.asset_id = a.id);
create index media_assets_unarchived_idx on capacity_scratch.media_assets (created_at, id)
  where upload_state = 'ready' and not archived;
analyze capacity_scratch.media_assets;
select capacity_scratch.time_it('flag: missing_count()', 'select count(*) from capacity_scratch.media_assets where upload_state = ''ready'' and not archived');
select capacity_scratch.time_it('flag: backfill_candidates(10)', 'select id from capacity_scratch.media_assets where upload_state = ''ready'' and not archived order by created_at, id limit 10');

\echo --- plan of missing_count ---
explain (analyze, costs off, timing off, summary on) select count(*) from capacity_scratch.media_assets a
  where a.upload_state = 'ready'
    and not exists (select 1 from capacity_scratch.media_archive_receipts r where r.asset_id = a.id);
\echo --- plan of backfill_candidates ---
explain (analyze, costs off, timing off, summary on) select a.id from capacity_scratch.media_assets a
  where a.upload_state = 'ready'
    and not exists (select 1 from capacity_scratch.media_archive_receipts r where r.asset_id = a.id)
  order by a.created_at, a.id limit 10;

\echo --- sizes ---
select pg_size_pretty(pg_total_relation_size('capacity_scratch.media_assets')) as assets,
       pg_size_pretty(pg_total_relation_size('capacity_scratch.media_archive_receipts')) as receipts;
