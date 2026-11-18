-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R6 (performance: metrics_overview timed
-- out once under load in the security suite).
--
-- Profiled on a seeded stack (pg_stat_user_functions, EXPLAIN ANALYZE):
-- private.asset_is_accepted ran ~27 times per call of
-- private.media_duplicate_suppressed, 36% of metrics_overview's time. The
-- 20261118109000 body puts asset_is_accepted(o.id) in the join's WHERE; a
-- security definer function is never inlined, so the planner filters the
-- whole media_assets table with it (Seq Scan on media_assets o, Filter:
-- deleted_at IS NULL AND asset_is_accepted(id)) before joining to the one
-- duplicate row, even when the asset is no duplicate at all. Every coverage
-- read (coverage_slot_rows, per slot photo) paid that, so the cost grew with
-- every photo in the database, not the venue.
--
-- Same rule, evaluated only for the one original: find the duplicate's
-- original first (primary key), then ask whether it is accepted.
--
-- Rollback: restore the 20261118109000 body.

create or replace function private.media_duplicate_suppressed(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.asset_is_accepted(o.id)
    from public.media_assets a
    join public.media_assets o on o.id = a.duplicate_of_asset_id
    where a.id = p_asset_id and o.deleted_at is null
  ), false);
$$;

revoke all on function private.media_duplicate_suppressed(uuid) from public, anon, authenticated, service_role;
