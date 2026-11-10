-- B10-m1 (b10-design §3.1 B10-01b/c, §14.1 S2): the shared job heartbeat and
-- the aggregate operations reading.
--
-- * private.ops_job_runs: one append-only receipt per admitted run of the four
--   scheduled routes (cleanup, media archive, archive watchdog, monthly
--   preparation). IDs, a closed outcome and error code, and bounded aggregate
--   counts only. coverage_preparation_runs and media_archive_audit_runs stay
--   the detailed records; nothing is copied from them.
-- * public.ops_record_job_run: the one route-facing writer, service role only.
--   The Data API exposes public, not private, so this narrow definer wrapper is
--   the seam (as for the archive watchdog and scheduled Coverage functions).
--   Schema exposure and app role permissions are unchanged.
-- * private.ops_metrics(p_now, p_venue_id): read-only aggregates at one as-of
--   clock, service role only. Every catalogue metric has an entry: a value from
--   a source on main or B10-m1, or "not_available" / "not_measured" with a
--   closed reason. An unavailable source is never reported as zero. No names,
--   emails, free text, paths, filenames, signed URLs, Wi-Fi data, error
--   messages or row payloads appear in the output.

-- ---------------------------------------------------------------------------
-- Closed vocabulary (lib/ops/heartbeats.ts holds the same lists)
-- ---------------------------------------------------------------------------

-- The scheduled jobs and their expected interval in minutes (vercel.json).
create function private.ops_jobs()
returns table (ord integer, job text, interval_minutes integer)
language sql
immutable
set search_path = ''
as $$
  values
    (1, 'cleanup', 60),
    (2, 'media_archive', 10),
    (3, 'archive_watchdog', 5),
    (4, 'monthly_preparation', 60);
$$;

-- Route-controlled failure codes per job; NULL for an unknown job.
create function private.ops_job_error_codes(p_job text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_job
    when 'cleanup' then array['cleanup_failed']
    when 'media_archive' then
      array['archive_audit_failed', 'archive_audit_timeout', 'archive_lease_lost']
    when 'archive_watchdog' then array['watchdog_unavailable', 'watchdog_failed']
    when 'monthly_preparation' then array['preparation_failed']
  end;
$$;

-- Allowed aggregate count fields per job; NULL for an unknown job.
create function private.ops_job_count_fields(p_job text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_job
    when 'cleanup' then
      array['reaped_assets', 'removed_assets', 'removed_objects', 'failed_assets']
    when 'media_archive' then array['checked', 'copied', 'missing', 'bytes_verified']
    when 'archive_watchdog' then array['delivered']
    when 'monthly_preparation' then
      array['succeeded_runs', 'failed_runs', 'staff_considered', 'targets_copied',
        'placeholders_created', 'already_present', 'candidates_added']
  end;
$$;

-- An ok run has no code; a failed run has one of its job's codes; only
-- monthly preparation can be partial (some venues failed), with its code.
create function private.ops_job_outcome_valid(p_job text, p_outcome text, p_error_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_outcome
    when 'ok' then p_error_code is null
    when 'failed' then
      coalesce(p_error_code = any (private.ops_job_error_codes(p_job)), false)
    when 'partial' then
      p_job = 'monthly_preparation'
      and coalesce(p_error_code = any (private.ops_job_error_codes(p_job)), false)
    else false
  end;
$$;

-- A flat object of the job's own keys with non-negative integer values: int4
-- range, except verified bytes up to 2^53 - 1 (a safe JavaScript integer).
create function private.ops_job_counts_valid(p_job text, p_counts jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_fields text[] := private.ops_job_count_fields(p_job);
  v_key text;
  v_value jsonb;
  v_number numeric;
begin
  if v_fields is null or p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    return false;
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_counts) e loop
    if not (v_key = any (v_fields)) or jsonb_typeof(v_value) <> 'number' then
      return false;
    end if;
    v_number := (v_value #>> '{}')::numeric;
    if v_number <> trunc(v_number) or v_number < 0
       or v_number > case when v_key = 'bytes_verified'
                          then 9007199254740991 else 2147483647 end then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- ops_job_runs
-- ---------------------------------------------------------------------------

create table private.ops_job_runs (
  -- One per invocation, fixed by the route when the job is admitted.
  run_id uuid primary key,
  job text not null check (job in ('cleanup', 'media_archive', 'archive_watchdog', 'monthly_preparation')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null check (outcome in ('ok', 'failed', 'partial')),
  counts jsonb not null default '{}'::jsonb,
  error_code text,
  constraint ops_job_runs_finished_after_start check (finished_at >= started_at),
  constraint ops_job_runs_outcome_code check (private.ops_job_outcome_valid(job, outcome, error_code)),
  constraint ops_job_runs_counts check (private.ops_job_counts_valid(job, counts))
);

create index ops_job_runs_job_finished_idx on private.ops_job_runs (job, finished_at desc);

create trigger ops_job_runs_append_only
  before update or delete on private.ops_job_runs
  for each row execute function private.append_only_guard();
create trigger ops_job_runs_no_truncate
  before truncate on private.ops_job_runs
  for each statement execute function private.append_only_guard();

alter table private.ops_job_runs enable row level security;
revoke all on table private.ops_job_runs from public, anon, authenticated, service_role;

comment on table private.ops_job_runs is
  'B10 shared job heartbeat: one append-only receipt per admitted scheduled run. IDs, closed outcome and code, aggregate counts only.';

-- ---------------------------------------------------------------------------
-- Writer
-- ---------------------------------------------------------------------------

-- Appends one receipt. The same receipt again returns 'replayed' and changes
-- nothing; a different receipt under a stored run ID is refused. Errors name
-- no input value.
create function private.ops_record_job_run(
  p_run_id uuid,
  p_job text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_outcome text,
  p_counts jsonb,
  p_error_code text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_existing private.ops_job_runs;
begin
  if p_run_id is null or p_job is null or p_started_at is null
     or p_finished_at is null or p_outcome is null or p_counts is null
     or not isfinite(p_started_at) or not isfinite(p_finished_at)
     or private.ops_job_error_codes(p_job) is null
     or p_outcome not in ('ok', 'failed', 'partial')
     or p_finished_at < p_started_at
     -- A receipt from the future would hide a missed heartbeat; allow only
     -- ordinary clock skew between the application and the database.
     or p_finished_at > now() + interval '5 minutes'
     or not private.ops_job_outcome_valid(p_job, p_outcome, p_error_code)
     or not private.ops_job_counts_valid(p_job, p_counts) then
    raise exception 'invalid_ops_job_run' using errcode = '22023';
  end if;

  insert into private.ops_job_runs as r
    (run_id, job, started_at, finished_at, outcome, counts, error_code)
  values
    (p_run_id, p_job, p_started_at, p_finished_at, p_outcome, p_counts, p_error_code)
  on conflict (run_id) do nothing;
  if found then
    return 'recorded';
  end if;

  select * into v_existing from private.ops_job_runs r where r.run_id = p_run_id;
  if v_existing.job = p_job
     and v_existing.started_at = p_started_at
     and v_existing.finished_at = p_finished_at
     and v_existing.outcome = p_outcome
     and v_existing.counts = p_counts
     and v_existing.error_code is not distinct from p_error_code then
    return 'replayed';
  end if;
  raise exception 'ops_job_run_conflict' using errcode = '23505';
end;
$$;

create function public.ops_record_job_run(
  p_run_id uuid,
  p_job text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_outcome text,
  p_counts jsonb,
  p_error_code text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.ops_record_job_run(
    p_run_id, p_job, p_started_at, p_finished_at, p_outcome, p_counts, p_error_code);
$$;

comment on function public.ops_record_job_run(uuid, text, timestamptz, timestamptz, text, jsonb, text) is
  'Service role only: appends one B10 job receipt (closed job, outcome, code and counts). Returns recorded or replayed.';

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- ISO 8601 in UTC with microseconds, whatever the session time zone.
create function private.ops_utc(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- Whole seconds from p_at to p_now, never negative; NULL without p_at.
create function private.ops_age_seconds(p_now timestamptz, p_at timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_at is null then null
    else greatest(0, floor(extract(epoch from (p_now - p_at))))::bigint end;
$$;

create function private.ops_metrics(p_now timestamptz, p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_metrics jsonb := '{}'::jsonb;
  v_items jsonb;
  v_totals jsonb;
  v_last_success timestamptz;
  v_count integer;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception 'invalid_as_of' using errcode = '22023';
  end if;
  v_month := private.london_month(p_now);

  -- M-JB-1 (global): time since the last ok receipt per job. Without one there
  -- is no evidence either way; no missed run is claimed from an empty ledger.
  select jsonb_agg(jsonb_build_object(
      'job', j.job,
      'intervalMinutes', j.interval_minutes,
      'lastOkAt', private.ops_utc(o.last_ok),
      'secondsSinceOk', private.ops_age_seconds(p_now, o.last_ok),
      'state', case
        when o.last_ok is null then 'no_evidence'
        when p_now - o.last_ok > make_interval(mins => 2 * j.interval_minutes) then 'breach'
        else 'ok' end)
      order by j.ord)
    into v_items
  from private.ops_jobs() j
  left join lateral (
    select max(r.finished_at) as last_ok
    from private.ops_job_runs r
    where r.job = j.job and r.outcome = 'ok' and r.finished_at <= p_now
  ) o on true;
  v_metrics := v_metrics || jsonb_build_object('M-JB-1', jsonb_build_object(
    'availability', 'available', 'scope', 'global', 'jobs', v_items));

  -- M-JB-2 (global): failed and partial receipts in 24 h, and the failures
  -- since the last ok receipt.
  select jsonb_agg(jsonb_build_object(
      'job', j.job,
      'failed24h', s.failed_24h,
      'partial24h', s.partial_24h,
      'consecutiveFailures', s.consecutive,
      'lastOutcome', l.outcome,
      'lastErrorCode', l.error_code,
      'lastFinishedAt', private.ops_utc(l.finished_at))
      order by j.ord)
    into v_items
  from private.ops_jobs() j
  left join lateral (
    select max(r.finished_at) as last_ok
    from private.ops_job_runs r
    where r.job = j.job and r.outcome = 'ok' and r.finished_at <= p_now
  ) o on true
  left join lateral (
    select r.outcome, r.error_code, r.finished_at
    from private.ops_job_runs r
    where r.job = j.job and r.finished_at <= p_now
    order by r.finished_at desc, r.started_at desc, r.run_id desc
    limit 1
  ) l on true
  left join lateral (
    select
      (count(*) filter (
        where r.outcome = 'failed' and r.finished_at > p_now - interval '24 hours'))::integer as failed_24h,
      (count(*) filter (
        where r.outcome = 'partial' and r.finished_at > p_now - interval '24 hours'))::integer as partial_24h,
      (count(*) filter (
        where r.outcome <> 'ok' and (o.last_ok is null or r.finished_at > o.last_ok)))::integer as consecutive
    from private.ops_job_runs r
    where r.job = j.job and r.finished_at <= p_now
  ) s on true;
  v_metrics := v_metrics || jsonb_build_object('M-JB-2', jsonb_build_object(
    'availability', 'available', 'scope', 'global', 'jobs', v_items));

  -- M-JB-3: a successful preparation for the London month of p_now (the runs
  -- coverage_preparation_status counts) and the active venues where active
  -- staff still have no target row for that month.
  select max(r.finished_at) into v_last_success
  from public.coverage_preparation_runs r
  where r.period_month = v_month and r.status = 'succeeded' and r.finished_at <= p_now
    and (p_venue_id is null or r.scope_venue_id is null or r.scope_venue_id = p_venue_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', m.venue_id, 'staffWithoutTarget', m.n) order by m.venue_id), '[]'::jsonb),
    count(*)::integer
    into v_items, v_count
  from (
    select p.venue_id, count(*)::integer as n
    from public.profiles p
    join public.venues v on v.id = p.venue_id and v.active
    where p.active and p.role = 'staff'
      and (p_venue_id is null or p.venue_id = p_venue_id)
      and private.venue_monthly_completion_target(p.venue_id, v_month) is null
      and not exists (
        select 1 from public.monthly_targets t
        where t.staff_id = p.id and t.venue_id = p.venue_id and t.period_month = v_month)
    group by p.venue_id
  ) m;
  v_metrics := v_metrics || jsonb_build_object('M-JB-3', jsonb_build_object(
    'availability', 'available', 'scope', 'venue',
    'period', to_char(v_month::timestamp, 'YYYY-MM-DD'),
    -- "By the 2nd": the London start of the 3rd day of the month.
    'successDueAt', private.ops_utc((v_month + 2)::timestamp at time zone 'Europe/London'),
    'lastSuccessAt', private.ops_utc(v_last_success),
    'venuesMissingTargets', v_count,
    'venues', v_items));

  -- M-UP-1: assets that are not removed, by venue and technical state.
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id, 'uploading', x.uploading, 'processing', x.processing,
      'ready', x.ready, 'failed', x.failed) order by x.venue_id), '[]'::jsonb),
    jsonb_build_object(
      'uploading', coalesce(sum(x.uploading), 0)::bigint,
      'processing', coalesce(sum(x.processing), 0)::bigint,
      'ready', coalesce(sum(x.ready), 0)::bigint,
      'failed', coalesce(sum(x.failed), 0)::bigint)
    into v_items, v_totals
  from (
    select a.venue_id,
      (count(*) filter (where a.upload_state = 'uploading'))::integer as uploading,
      (count(*) filter (where a.upload_state = 'processing'))::integer as processing,
      (count(*) filter (where a.upload_state = 'ready'))::integer as ready,
      (count(*) filter (where a.upload_state = 'failed'))::integer as failed
    from public.media_assets a
    where a.deleted_at is null and (p_venue_id is null or a.venue_id = p_venue_id)
    group by a.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-UP-1', jsonb_build_object(
    'availability', 'available', 'scope', 'venue', 'totals', v_totals, 'venues', v_items));

  -- M-UP-2: processing for longer than 30 min (MEDIA_LIMITS.staleProcessingMinutes).
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id, 'count', x.n,
      'oldestAgeSeconds', private.ops_age_seconds(p_now, x.oldest)) order by x.venue_id), '[]'::jsonb),
    coalesce(sum(x.n), 0)::integer
    into v_items, v_count
  from (
    select a.venue_id, count(*)::integer as n, min(a.updated_at) as oldest
    from public.media_assets a
    where a.deleted_at is null and a.upload_state = 'processing'
      and a.updated_at < p_now - interval '30 minutes'
      and (p_venue_id is null or a.venue_id = p_venue_id)
    group by a.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-UP-2', jsonb_build_object(
    'availability', 'available', 'scope', 'venue', 'total', v_count, 'venues', v_items));

  -- M-UP-3: uploading reservations untouched for 26 h (24 h window plus two
  -- cleanup cycles).
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id, 'count', x.n,
      'oldestAgeSeconds', private.ops_age_seconds(p_now, x.oldest)) order by x.venue_id), '[]'::jsonb),
    coalesce(sum(x.n), 0)::integer
    into v_items, v_count
  from (
    select a.venue_id, count(*)::integer as n, min(a.updated_at) as oldest
    from public.media_assets a
    where a.deleted_at is null and a.upload_state = 'uploading'
      and a.updated_at < p_now - interval '26 hours'
      and (p_venue_id is null or a.venue_id = p_venue_id)
    group by a.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-UP-3', jsonb_build_object(
    'availability', 'available', 'scope', 'venue', 'total', v_count, 'venues', v_items));

  -- M-UP-4 needs the time each asset reached failed and every finalisation in
  -- the window. media_assets keeps only the current state and a mutable
  -- updated_at, and a failed asset may retry, so no count is derived from it.
  v_metrics := v_metrics || jsonb_build_object('M-UP-4', jsonb_build_object(
    'availability', 'not_available', 'reason', 'missing_history',
    'missing', jsonb_build_array('failed_transition_history', 'finalisation_history')));

  -- M-UP-5: tombstones that still have Storage objects under their prefix
  -- (docs/operations.md, Routine checks). Counts and ages, never object names.
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id, 'count', x.n, 'olderThan24h', x.old,
      'oldestAgeSeconds', private.ops_age_seconds(p_now, x.oldest)) order by x.venue_id), '[]'::jsonb),
    jsonb_build_object(
      'count', coalesce(sum(x.n), 0)::bigint,
      'olderThan24h', coalesce(sum(x.old), 0)::bigint)
    into v_items, v_totals
  from (
    select a.venue_id, count(*)::integer as n,
      (count(*) filter (where a.deleted_at < p_now - interval '24 hours'))::integer as old,
      min(a.deleted_at) as oldest
    from public.media_assets a
    where a.deleted_at is not null and a.deleted_at <= p_now
      and (p_venue_id is null or a.venue_id = p_venue_id)
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'media'
          and o.name like a.uploader_id::text || '/' || a.id::text || '/%')
    group by a.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-UP-5', jsonb_build_object(
    'availability', 'available', 'scope', 'venue', 'totals', v_totals, 'venues', v_items));

  -- M-UP-6: labels kept as needs_attention, and pending labels older than 30 min.
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id,
      'needsAttention', x.attention,
      'needsAttentionOlderThan7d', x.attention_old,
      'oldestNeedsAttentionAgeSeconds', private.ops_age_seconds(p_now, x.attention_oldest),
      'stalePending', x.stale_pending,
      'oldestStalePendingAgeSeconds', private.ops_age_seconds(p_now, x.pending_oldest))
      order by x.venue_id), '[]'::jsonb),
    jsonb_build_object(
      'needsAttention', coalesce(sum(x.attention), 0)::bigint,
      'needsAttentionOlderThan7d', coalesce(sum(x.attention_old), 0)::bigint,
      'stalePending', coalesce(sum(x.stale_pending), 0)::bigint)
    into v_items, v_totals
  from (
    select l.venue_id,
      (count(*) filter (where l.status = 'needs_attention'))::integer as attention,
      (count(*) filter (
        where l.status = 'needs_attention' and l.updated_at < p_now - interval '7 days'))::integer as attention_old,
      min(l.updated_at) filter (where l.status = 'needs_attention') as attention_oldest,
      (count(*) filter (
        where l.status = 'pending' and l.updated_at < p_now - interval '30 minutes'))::integer as stale_pending,
      min(l.updated_at) filter (
        where l.status = 'pending' and l.updated_at < p_now - interval '30 minutes') as pending_oldest
    from public.media_pending_labels l
    where (p_venue_id is null or l.venue_id = p_venue_id)
      and (l.status = 'needs_attention'
        or (l.status = 'pending' and l.updated_at < p_now - interval '30 minutes'))
    group by l.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-UP-6', jsonb_build_object(
    'availability', 'available', 'scope', 'venue', 'totals', v_totals, 'venues', v_items));

  -- M-RV-3: legacy Coverage photos awaiting review (the pending count the
  -- coverage summary uses: submitted, asset ready and not removed).
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id, 'count', x.n,
      'oldestAgeSeconds', private.ops_age_seconds(p_now, x.oldest)) order by x.venue_id), '[]'::jsonb),
    coalesce(sum(x.n), 0)::integer
    into v_items, v_count
  from (
    select i.venue_id, count(*)::integer as n, min(i.submitted_at) as oldest
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.state = 'submitted' and a.upload_state = 'ready' and a.deleted_at is null
      and i.submitted_at <= p_now
      and (p_venue_id is null or i.venue_id = p_venue_id)
    group by i.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-RV-3', jsonb_build_object(
    'availability', 'available', 'scope', 'venue', 'total', v_count, 'venues', v_items));

  -- M-WD-4, the main part only: amenity evidence_lost events in 7 days and the
  -- checks they affected. The knowledge_events part is outside this slice.
  select coalesce(jsonb_agg(jsonb_build_object(
      'venueId', x.venue_id, 'events', x.events, 'checks', x.checks) order by x.venue_id), '[]'::jsonb),
    jsonb_build_object(
      'events', coalesce(sum(x.events), 0)::bigint,
      'checks', coalesce(sum(x.checks), 0)::bigint)
    into v_items, v_totals
  from (
    select e.venue_id, count(*)::integer as events, count(distinct e.check_id)::integer as checks
    from public.amenity_check_events e
    where e.kind = 'evidence_lost'
      and e.created_at > p_now - interval '7 days' and e.created_at <= p_now
      and (p_venue_id is null or e.venue_id = p_venue_id)
    group by e.venue_id
  ) x;
  v_metrics := v_metrics || jsonb_build_object('M-WD-4', jsonb_build_object(
    'availability', 'partial', 'scope', 'venue',
    'parts', jsonb_build_object(
      'amenity_evidence_lost', jsonb_build_object(
        'availability', 'available', 'totals', v_totals, 'venues', v_items),
      'knowledge_evidence_withdrawn', jsonb_build_object(
        'availability', 'not_available', 'reason', 'not_in_slice'))));

  -- Every other catalogue metric, with the closed reason it has no value here.
  -- source_unreleased: its batch is not released. not_in_slice: a released
  -- B01 source this slice does not read. external_checker: the archive
  -- checker's own status read (M-JB-4). external_record: the observation log
  -- (M-AD-3). log_source_missing: log-only, not measured until OD-B10-4.
  select v_metrics || jsonb_object_agg(u.id, case
      when u.closed_reason = 'log_source_missing' then
        jsonb_build_object('availability', 'not_measured', 'reason', u.closed_reason)
      else jsonb_build_object('availability', 'not_available', 'reason', u.closed_reason)
    end)
    into v_metrics
  from (values
    ('M-JB-4', 'external_checker'),
    ('M-JB-5', 'source_unreleased'),
    ('M-JB-6', 'source_unreleased'),
    ('M-UP-7', 'log_source_missing'),
    ('M-KN-1', 'source_unreleased'),
    ('M-KN-2', 'source_unreleased'),
    ('M-KN-3', 'source_unreleased'),
    ('M-KN-4', 'source_unreleased'),
    ('M-KN-5', 'source_unreleased'),
    ('M-KN-6', 'not_in_slice'),
    ('M-RV-1', 'not_in_slice'),
    ('M-RV-2', 'source_unreleased'),
    ('M-RV-4', 'source_unreleased'),
    ('M-RV-5', 'source_unreleased'),
    ('M-DL-1', 'source_unreleased'),
    ('M-DL-2', 'source_unreleased'),
    ('M-DL-3', 'source_unreleased'),
    ('M-DL-4', 'source_unreleased'),
    ('M-DL-5', 'source_unreleased'),
    ('M-DL-6', 'log_source_missing'),
    ('M-DL-7', 'source_unreleased'),
    ('M-DL-8', 'source_unreleased'),
    ('M-WD-1', 'source_unreleased'),
    ('M-WD-2', 'source_unreleased'),
    ('M-WD-3', 'source_unreleased'),
    ('M-WD-5', 'source_unreleased'),
    ('M-AI-1', 'source_unreleased'),
    ('M-AI-2', 'source_unreleased'),
    ('M-AI-3', 'source_unreleased'),
    ('M-AI-4', 'source_unreleased'),
    ('M-AD-1', 'not_in_slice'),
    ('M-AD-2', 'not_in_slice'),
    ('M-AD-3', 'external_record')
  ) as u(id, closed_reason);

  return jsonb_build_object(
    'contract', 'b10.ops_metrics.v1',
    'asOf', private.ops_utc(p_now),
    'venueId', p_venue_id,
    'metrics', v_metrics);
end;
$$;

comment on function private.ops_metrics(timestamptz, uuid) is
  'Service role only: B10 operational aggregates at one as-of clock (IDs, counts, ages, timestamps, closed states). Unavailable sources are labelled, never zero.';

-- ---------------------------------------------------------------------------
-- Access: the public writer is the only callable entry for the service role;
-- the reading is service role only and is not exposed through the Data API.
-- ---------------------------------------------------------------------------

revoke all on function
  private.ops_jobs(),
  private.ops_job_error_codes(text),
  private.ops_job_count_fields(text),
  private.ops_job_outcome_valid(text, text, text),
  private.ops_job_counts_valid(text, jsonb),
  private.ops_record_job_run(uuid, text, timestamptz, timestamptz, text, jsonb, text),
  private.ops_utc(timestamptz),
  private.ops_age_seconds(timestamptz, timestamptz),
  private.ops_metrics(timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.ops_record_job_run(uuid, text, timestamptz, timestamptz, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.ops_record_job_run(uuid, text, timestamptz, timestamptz, text, jsonb, text)
  to service_role;
grant execute on function private.ops_metrics(timestamptz, uuid) to service_role;
