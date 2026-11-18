-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R6 (performance: metrics_overview timed
-- out once under load in the security suite).
--
-- Profiled on a seeded stack: one metrics_overview call ran
-- private.metrics_venue_json three times per active venue (81 calls for 27
-- venues). The 20261118117100 body reads it through a lateral subquery that
-- the planner flattens, so the call is repeated in the aggregate and in both
-- ORDER BY keys. A materialized CTE computes each venue once. Output is
-- unchanged. Body as in 20261118117100 otherwise.
--
-- Rollback: restore the 20261118117100 body.

create or replace function public.metrics_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if auth.uid() is null or not private.is_active_user() or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  v_days := private.metrics_days(p_days);
  return jsonb_build_object(
    'days', v_days,
    'generatedAt', now(),
    'failedJobs', (select count(*) from public.ops_job_runs j
      where j.state = 'failed' and j.started_at >= now() - make_interval(days => v_days))::integer,
    'venues', coalesce((
      with per_venue as materialized (
        select private.metrics_venue_json(v.id, v_days) as m
        from public.venues v
        where v.active
      )
      select jsonb_agg(p.m - 'slots' - 'flow' order by p.m ->> 'venueName', p.m ->> 'venueId')
      from per_venue p), '[]'::jsonb));
end;
$$;

revoke all on function public.metrics_overview(integer) from public, anon, service_role;
grant execute on function public.metrics_overview(integer) to authenticated;
