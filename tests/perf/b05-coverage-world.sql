-- B05 perf repair 3: coverage evidence at a production-like volume, for the
-- candidate statements of public.asset_search (submission {source:
-- 'coverage'} and check = a coverage requirement). coverage_submission_items
-- has no submission_id index, and its requirement index is partial (archived
-- items still count for the filter), so those statements read the venue's
-- items (a manager, or an admin with a venue) or the whole table (an admin)
-- once a call. Run after generate.mjs, b05-world.sql and b05-diff-world.sql,
-- as postgres, on a local workstream stack only. Same conventions as
-- b05-diff-world.sql (replica mode, every row synthetic and PERF-named); fixed
-- rows get md5('perfb05c:<key>')::uuid.
--
-- Adds at perf-b05-manager-big's venue: 20 venue-specific coverage
-- requirements (req-01 .. req-20), 1,000 manager-attached submissions
-- (csub-0001 .. csub-1000) of 30 items each, 30,000 items on 30,000 distinct
-- ready assets of the venue that had no coverage item (1,500 a requirement; a
-- third archived, a tenth needing another photo, a fifth accepted). The
-- assets become task evidence, so the manager sees more of the venue: load it
-- for the search-coverage bench and its differential cases only, not for
-- figures compared with the base world.
--
--   psql "$SUPABASE_DB_URL" -f tests/perf/b05-coverage-world.sql
\set ON_ERROR_STOP on
set session_replication_role = replica;
set work_mem = '64MB';

begin;

create function pg_temp.cid(p_key text) returns uuid
language sql immutable as $$ select md5('perfb05c:' || p_key)::uuid $$;

create temp table ck as
select
  (select p.venue_id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-big@perf.nabalens.test') as big,
  (select p.id from public.profiles p join auth.users u on u.id = p.id
   where u.email = 'perf-admin-1@perf.nabalens.test') as admin;

do $guard$
begin
  if (select big from ck) is null then
    raise exception 'load tests/perf/b05-world.sql first';
  end if;
  if not exists (select 1 from public.venues where slug = 'perfb05d-reject') then
    raise exception 'load tests/perf/b05-diff-world.sql first';
  end if;
  if exists (select 1 from public.coverage_submissions where id = pg_temp.cid('csub-0001')) then
    raise exception 'b05-coverage-world.sql is already loaded';
  end if;
end
$guard$;

insert into public.coverage_requirements (id, venue_id, kind, title, status, amenity_key, created_by, created_at, updated_at)
select pg_temp.cid('req-' || lpad(r::text, 2, '0')), ck.big, 'venue_specific', 'PERF B05 coverage ' || r, 'active',
       null, ck.admin, now() - interval '400 days', now() - interval '400 days'
from ck, generate_series(1, 20) r;

-- 30,000 ready assets of the venue with no coverage item, in a stable
-- pseudo-random order; item rn belongs to submission (rn - 1) / 30 + 1 and
-- requirement of that submission ((s - 1) % 20 + 1).
create temp table cov as
select x.id, x.venue_id, x.uploader_id, x.created_at, x.rn,
       (x.rn - 1) / 30 + 1 as sub, ((x.rn - 1) / 30) % 20 + 1 as req
from (
  select a.id, a.venue_id, a.uploader_id, a.created_at,
         row_number() over (order by md5('perfb05c:' || a.id::text)) as rn
  from public.media_assets a, ck
  where a.venue_id = ck.big and a.upload_state = 'ready' and a.deleted_at is null
    and not exists (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id)
) x
where x.rn <= 30000;

do $count$
begin
  if (select count(*) from cov) < 30000 then
    raise exception 'fewer than 30,000 free ready assets at the big venue';
  end if;
end
$count$;

insert into public.coverage_submissions (id, venue_id, submitted_by, kind, requirement_id, client_request_key, asset_ids, created_at)
select pg_temp.cid('csub-' || lpad(c.sub::text, 4, '0')), ck.big, ck.admin, 'manager_attach',
       pg_temp.cid('req-' || lpad(min(c.req)::text, 2, '0')), 'perfb05c-' || lpad(c.sub::text, 4, '0'),
       array_agg(c.id order by c.rn), now() - interval '200 days' + c.sub * interval '4 hours'
from cov c, ck group by c.sub, ck.big, ck.admin;

insert into public.coverage_submission_items (submission_id, venue_id, asset_id, author_id, requirement_id, origin,
  submitted_by, submitted_at, submitted_month, uploaded_at, uploaded_month, state, decision_reason,
  decided_by, decided_at, self_review, archived_at, archive_kind)
select pg_temp.cid('csub-' || lpad(c.sub::text, 4, '0')), c.venue_id, c.id, c.uploader_id,
       pg_temp.cid('req-' || lpad(c.req::text, 2, '0')), 'attached', ck.admin,
       now() - interval '200 days' + c.sub * interval '4 hours',
       private.london_month(now() - interval '200 days' + c.sub * interval '4 hours'),
       c.created_at, private.london_month(c.created_at),
       case when c.rn % 10 = 0 then 'needs_another_photo' when c.rn % 5 = 1 then 'accepted' else 'submitted' end,
       case when c.rn % 10 = 0 then 'PERF: another photo please' end,
       case when c.rn % 10 = 0 or c.rn % 5 = 1 then ck.admin end,
       case when c.rn % 10 = 0 or c.rn % 5 = 1 then now() - interval '100 days' end,
       case when c.rn % 10 = 0 or c.rn % 5 = 1 then false end,
       case when c.rn % 3 = 0 then now() - interval '50 days' end,
       case when c.rn % 3 = 0 then 'requirement_retired' end
from cov c, ck;

commit;
reset session_replication_role;

vacuum (analyze) public.coverage_requirements, public.coverage_submissions, public.coverage_submission_items;
