-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-OPS: job records, operational monitoring, manager digests
-- and admin exceptions (spec §8 A7, §11, §16, §17; checklist
-- A7-ops-monitoring, S16-monitoring-capacity, S17-manager-queue,
-- S17-admin-exceptions, S11-audit-notification-job).
--
--   ops_job_runs     one row per run of a scheduled or background job (job
--                    name, state, attempts, error code, timings, version).
--                    The cleanup and notification routes record theirs; the
--                    export worker (S1-EXPORT) records failed packages here as
--                    job 'export' so they reach monitoring without a
--                    dependency between the two migrations.
--   ops_status       admin: storage used against the configured quota, stuck
--                    and failed processing, the archive audit, monthly
--                    preparation, every job's last run and failures, the last
--                    recorded restore rehearsal, and the current exceptions.
--   Exceptions       private.ops_exceptions: storage near capacity, stuck or
--                    repeated processing failures, a job whose last run
--                    failed, a failed archive audit or preparation run, a
--                    venue whose oldest waiting photo is older than the
--                    backlog threshold, and an active venue without an active
--                    menu or a manager (setup gap).
--   Notification job ops_run_notification_jobs (service role, hourly cron):
--                    a review digest to each venue manager when work waits
--                    (at most once per review_reminder_days, never inside the
--                    person's quiet hours), and an exception notice to every
--                    admin (once per topic and day, or week for backlog and
--                    setup gaps). Exceptions that have cleared are resolved.
--
-- Monitoring never deletes media: storage alerts only notify (§16).
--
-- Rollback: roll back the app first, then revoke execute on the public
-- functions. Tables stay.

-- ---------------------------------------------------------------------------
-- Job runs
-- ---------------------------------------------------------------------------

create table public.ops_job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (job ~ '^[a-z][a-z0-9_]{0,39}$'),
  state text not null check (state in ('running', 'succeeded', 'failed')),
  attempts integer not null default 1 check (attempts >= 1),
  -- Whom the run acted for, when anyone (an export requested by a person).
  actor_id uuid references public.profiles (id) on delete restrict,
  venue_id uuid references public.venues (id) on delete restrict,
  subject_id text check (subject_id is null or length(subject_id) between 1 and 120),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  -- Counts only: never object keys, signed URLs or secrets.
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096),
  version integer not null default 1 check (version >= 1),
  constraint ops_job_runs_failure check ((state = 'failed') = (error_code is not null)),
  constraint ops_job_runs_finished check ((state = 'running') = (finished_at is null))
);

create index ops_job_runs_job_idx on public.ops_job_runs (job, started_at desc);

comment on table public.ops_job_runs is
  'S1-OPS: runs of scheduled and background jobs (§11). Written by public.ops_record_job_run (service role).';

alter table public.ops_job_runs enable row level security;
revoke all on table public.ops_job_runs from public, anon, authenticated, service_role;
grant select on table public.ops_job_runs to service_role;

-- Records a finished run (or a running one, closed later by its id). Service
-- role only: jobs run without a person's session.
create function public.ops_record_job_run(
  p_job text,
  p_state text,
  p_started_at timestamptz default null,
  p_error_code text default null,
  p_detail jsonb default '{}'::jsonb,
  p_attempts integer default 1,
  p_venue_id uuid default null,
  p_subject_id text default null,
  p_run_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_run_id is not null then
    update public.ops_job_runs r set
      state = p_state,
      error_code = p_error_code,
      detail = coalesce(p_detail, r.detail),
      attempts = greatest(r.attempts, coalesce(p_attempts, r.attempts)),
      finished_at = case when p_state = 'running' then null else now() end,
      version = r.version + 1
    where r.id = p_run_id and r.job = p_job
    returning r.id into v_id;
    if v_id is null then
      raise exception 'unknown_run' using errcode = '22023';
    end if;
    return v_id;
  end if;
  insert into public.ops_job_runs (job, state, attempts, venue_id, subject_id, started_at,
    finished_at, error_code, detail)
  values (p_job, p_state, coalesce(p_attempts, 1), p_venue_id, p_subject_id,
    coalesce(p_started_at, now()),
    case when p_state = 'running' then null else now() end,
    p_error_code, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ops_record_job_run(text, text, timestamptz, text, jsonb, integer, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.ops_record_job_run(text, text, timestamptz, text, jsonb, integer, uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Measures
-- ---------------------------------------------------------------------------

-- Work waiting for a manager at one venue: menu photos waiting for a decision
-- (the manager queue's own rule), area photos without a decision, submitted
-- checklist photos and pending amenity photos; plus open venue checks past due.
create function private.ops_venue_backlog(p_venue_id uuid, p_now timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_menu integer;
  v_menu_oldest timestamptz;
  v_area integer;
  v_area_oldest timestamptz;
  v_list integer;
  v_list_oldest timestamptz;
  v_amenity integer;
  v_amenity_oldest timestamptz;
  v_overdue integer;
begin
  select count(*)::integer, min(coalesce(t.labelled_at, t.created_at))
  into v_menu, v_menu_oldest
  from private.menu_photo_pending_tuples(p_venue_id, true) t;

  select count(*)::integer, min(l.added_at) into v_area, v_area_oldest
  from public.media_area_labels l
  join public.media_assets a on a.id = l.asset_id
  where l.venue_id = p_venue_id and l.removed_at is null
    and a.deleted_at is null and a.upload_state = 'ready'
    and not exists (select 1 from public.area_photo_decisions d where d.label_id = l.id);

  select count(*)::integer, min(i.submitted_at) into v_list, v_list_oldest
  from public.coverage_submission_items i
  join public.media_assets a on a.id = i.asset_id
  where i.venue_id = p_venue_id and i.state = 'submitted'
    and a.upload_state = 'ready' and a.deleted_at is null;

  select count(*)::integer, min(r.uploaded_at) into v_amenity, v_amenity_oldest
  from private.amenity_photo_rows(p_venue_id) r
  where r.state = 'pending';

  select count(*)::integer into v_overdue
  from private.knowledge_venue_open_rechecks(p_venue_id) t
  where t.due_at < v_now;

  return jsonb_build_object(
    'waiting', v_menu + v_area + v_list + v_amenity,
    'menuPhotos', v_menu, 'areaPhotos', v_area, 'checklistPhotos', v_list,
    'amenityPhotos', v_amenity,
    'oldestWaitingAt', least(v_menu_oldest, v_area_oldest, v_list_oldest, v_amenity_oldest),
    'overdueChecks', v_overdue);
end;
$$;

-- Managers of a venue (the same rule as private.effective_manager_venue_id).
create function private.ops_venue_managers(p_venue_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.active and p.role in ('staff', 'manager')
    and private.effective_manager_venue_id(p.id) = p_venue_id;
$$;

-- Bytes of every original kept (not removed). Renditions are small and not
-- counted; the quota should leave room for them.
create function private.ops_storage_used()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.size_bytes), 0)::bigint
  from public.media_assets a
  where a.deleted_at is null;
$$;

-- Current exceptions: (topic, venue or null, detail).
create function private.ops_exceptions(p_now timestamptz default null)
returns table (topic text, venue_id uuid, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_settings public.ops_settings;
  v_used bigint := private.ops_storage_used();
  v_stuck integer;
  v_failed integer;
  v_venue record;
  v_backlog jsonb;
begin
  select * into v_settings from public.ops_settings where id;

  if v_used * 100 >= v_settings.storage_quota_bytes * v_settings.storage_alert_percent then
    return query select 'storage'::text, null::uuid, jsonb_build_object(
      'usedBytes', v_used, 'quotaBytes', v_settings.storage_quota_bytes,
      'alertPercent', v_settings.storage_alert_percent);
  end if;

  select count(*) filter (where a.upload_state = 'processing' and a.updated_at < v_now - interval '30 minutes'),
    count(*) filter (where a.upload_state = 'failed' and a.updated_at >= v_now - interval '24 hours')
  into v_stuck, v_failed
  from public.media_assets a
  where a.deleted_at is null and a.upload_state in ('processing', 'failed');
  if v_stuck > 0 or v_failed >= 5 then
    return query select 'processing'::text, null::uuid,
      jsonb_build_object('stuck', v_stuck, 'failedLastDay', v_failed);
  end if;

  return query
  select 'job'::text, null::uuid, jsonb_build_object('job', r.job, 'errorCode', r.error_code,
    'failedAt', r.finished_at)
  from (
    select distinct on (j.job) j.job, j.state, j.error_code, j.finished_at
    from public.ops_job_runs j
    where j.state <> 'running'
    order by j.job, j.started_at desc
  ) r
  where r.state = 'failed';

  return query
  select 'archive'::text, null::uuid, jsonb_build_object('outcome', r.outcome, 'error', r.error,
    'finishedAt', r.finished_at)
  from (select * from public.media_archive_audit_runs order by finished_at desc, id desc limit 1) r
  where r.outcome in ('timeout', 'lease_lost', 'failed');

  return query
  select 'preparation'::text, r.scope_venue_id, jsonb_build_object('errorCode', r.error_code,
    'finishedAt', r.finished_at, 'periodMonth', r.period_month)
  from (select * from public.coverage_preparation_runs order by finished_at desc limit 1) r
  where r.status = 'failed';

  for v_venue in select v.id from public.venues v where v.active order by v.name, v.id loop
    v_backlog := private.ops_venue_backlog(v_venue.id, v_now);
    if (v_backlog ->> 'oldestWaitingAt') is not null
        and (v_backlog ->> 'oldestWaitingAt')::timestamptz
          < v_now - make_interval(days => v_settings.backlog_alert_days) then
      return query select 'backlog'::text, v_venue.id, v_backlog
        || jsonb_build_object('thresholdDays', v_settings.backlog_alert_days);
    end if;
    if private.active_menu_version_id(v_venue.id) is null
        or not exists (select 1 from private.ops_venue_managers(v_venue.id)) then
      return query select 'venue_setup'::text, v_venue.id, jsonb_build_object(
        'noActiveMenu', private.active_menu_version_id(v_venue.id) is null,
        'noManager', not exists (select 1 from private.ops_venue_managers(v_venue.id)));
    end if;
  end loop;
end;
$$;

revoke all on function private.ops_venue_backlog(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.ops_venue_managers(uuid) from public, anon, authenticated;
revoke all on function private.ops_storage_used() from public, anon, authenticated;
revoke all on function private.ops_exceptions(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin monitoring read
-- ---------------------------------------------------------------------------

create function public.ops_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.ops_settings;
  v_used bigint;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  select * into v_settings from public.ops_settings where id;
  v_used := private.ops_storage_used();

  return jsonb_build_object(
    'generatedAt', now(),
    'storage', jsonb_build_object(
      'usedBytes', v_used,
      'quotaBytes', v_settings.storage_quota_bytes,
      'alertPercent', v_settings.storage_alert_percent,
      'percent', round(v_used * 100.0 / v_settings.storage_quota_bytes, 1),
      'state', case
        when v_used >= v_settings.storage_quota_bytes then 'full'
        when v_used * 100 >= v_settings.storage_quota_bytes * v_settings.storage_alert_percent then 'warning'
        else 'ok' end),
    'processing', (
      select jsonb_build_object(
        'processing', count(*) filter (where a.upload_state = 'processing'),
        'stuck', count(*) filter (where a.upload_state = 'processing'
          and a.updated_at < now() - interval '30 minutes'),
        'oldestStuckAt', min(a.updated_at) filter (where a.upload_state = 'processing'
          and a.updated_at < now() - interval '30 minutes'),
        'failedLastDay', count(*) filter (where a.upload_state = 'failed'
          and a.updated_at >= now() - interval '24 hours'),
        'failedLastWeek', count(*) filter (where a.upload_state = 'failed'
          and a.updated_at >= now() - interval '7 days'))
      from public.media_assets a
      where a.deleted_at is null and a.upload_state in ('processing', 'failed')),
    'archive', coalesce((
      select jsonb_build_object('lastRunAt', r.finished_at, 'outcome', r.outcome, 'error', r.error,
        'lastCompletedCycleAt', (select max(c.finished_at) from public.media_archive_audit_runs c
          where c.outcome = 'completed_cycle'))
      from public.media_archive_audit_runs r
      order by r.finished_at desc, r.id desc limit 1), '{}'::jsonb),
    'preparation', jsonb_build_object(
      'failedLast30Days', (select count(*) from public.coverage_preparation_runs r
        where r.status = 'failed' and r.finished_at >= now() - interval '30 days'),
      'lastFailedAt', (select max(r.finished_at) from public.coverage_preparation_runs r
        where r.status = 'failed')),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'job', j.job, 'lastRunAt', j.started_at, 'lastState', j.state,
          'lastErrorCode', j.error_code,
          'lastSuccessAt', (select max(s.finished_at) from public.ops_job_runs s
            where s.job = j.job and s.state = 'succeeded'),
          'failuresLastWeek', (select count(*) from public.ops_job_runs f
            where f.job = j.job and f.state = 'failed' and f.started_at >= now() - interval '7 days'))
        order by j.job)
      from (select distinct on (r.job) r.* from public.ops_job_runs r
            order by r.job, r.started_at desc) j), '[]'::jsonb),
    'restoreRehearsal', coalesce((
      select jsonb_build_object('lastAt', r.finished_at, 'state', r.state, 'errorCode', r.error_code)
      from public.ops_job_runs r where r.job = 'restore_rehearsal'
      order by r.started_at desc limit 1), '{}'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('topic', e.topic, 'venueId', e.venue_id,
          'venueName', v.name, 'detail', e.detail)
        order by e.topic, v.name)
      from private.ops_exceptions(now()) e
      left join public.venues v on v.id = e.venue_id), '[]'::jsonb));
end;
$$;

revoke all on function public.ops_status() from public, anon, service_role;
grant execute on function public.ops_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Notification job
-- ---------------------------------------------------------------------------

-- Service role, hourly. Idempotent: dedupe keys make a second run in the same
-- period write nothing. p_now is for tests.
create function public.ops_run_notification_jobs(p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_settings public.ops_settings;
  v_venue record;
  v_manager uuid;
  v_backlog jsonb;
  v_bucket integer;
  v_key text;
  v_digests integer := 0;
  v_exceptions integer := 0;
  v_resolved integer := 0;
  v_admin uuid;
  v_exc record;
  v_period text;
  v_subject text;
  v_current jsonb;
begin
  select * into v_settings from public.ops_settings where id;

  -- Manager review digests.
  for v_venue in select v.id, v.name from public.venues v where v.active loop
    v_backlog := private.ops_venue_backlog(v_venue.id, v_now);
    if (v_backlog ->> 'waiting')::integer = 0 and (v_backlog ->> 'overdueChecks')::integer = 0 then
      -- Nothing waits: earlier digests are out of date.
      v_resolved := v_resolved + private.notification_resolve('review_digest', 'venue', v_venue.id::text);
      continue;
    end if;
    v_bucket := (((v_now at time zone private.venue_timezone(v_venue.id))::date - date '2000-01-01')
      / v_settings.review_reminder_days);
    for v_manager in select * from private.ops_venue_managers(v_venue.id) loop
      -- Never inside the person's quiet hours: the next run after they end.
      if private.notification_deliver_after(v_manager, v_venue.id, v_now) <> v_now then
        continue;
      end if;
      v_key := format('digest:%s:%s', v_venue.id, v_bucket);
      if exists (select 1 from public.notifications n
                 where n.recipient_id = v_manager and n.dedupe_key = v_key) then
        continue;
      end if;
      -- A new digest replaces the previous one.
      perform private.notification_resolve('review_digest', 'venue', v_venue.id::text, v_manager);
      if private.notify(v_manager, v_venue.id, 'review_digest', 'venue', v_venue.id::text, v_key,
          jsonb_build_object('venueName', v_venue.name) || v_backlog, v_now) is not null then
        v_digests := v_digests + 1;
      end if;
    end loop;
  end loop;

  -- Admin exceptions. Subject: the venue, the job, or the organisation.
  select coalesce(jsonb_agg(jsonb_build_object('topic', e.topic, 'venueId', e.venue_id,
      'subject', coalesce(e.venue_id::text, e.detail ->> 'job', 'organisation'),
      'detail', e.detail)), '[]'::jsonb)
  into v_current
  from private.ops_exceptions(v_now) e;

  for v_exc in select * from jsonb_array_elements(v_current) x(item) loop
    v_subject := v_exc.item ->> 'subject';
    v_period := case when v_exc.item ->> 'topic' in ('backlog', 'venue_setup')
      then to_char(v_now at time zone 'Europe/London', 'IYYY-"W"IW')
      else to_char(v_now at time zone 'Europe/London', 'YYYY-MM-DD') end;
    for v_admin in select p.id from public.profiles p where p.active and p.role = 'admin' loop
      if private.notify(v_admin, (v_exc.item ->> 'venueId')::uuid, 'exception',
          'exception_' || (v_exc.item ->> 'topic'), v_subject,
          format('exception:%s:%s:%s', v_exc.item ->> 'topic', v_subject, v_period),
          jsonb_build_object('topic', v_exc.item ->> 'topic') || (v_exc.item -> 'detail'),
          v_now) is not null then
        v_exceptions := v_exceptions + 1;
      end if;
    end loop;
  end loop;

  -- Exceptions that have cleared.
  with cleared as (
    update public.notifications n
    set resolved_at = v_now, version = n.version + 1
    where n.kind = 'exception' and n.resolved_at is null
      and not exists (
        select 1 from jsonb_array_elements(v_current) x(item)
        where n.subject_type = 'exception_' || (x.item ->> 'topic')
          and n.subject_id = x.item ->> 'subject')
    returning 1
  )
  select v_resolved + count(*)::integer into v_resolved from cleared;

  return jsonb_build_object('digests', v_digests, 'exceptions', v_exceptions, 'resolved', v_resolved);
end;
$$;

revoke all on function public.ops_run_notification_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_run_notification_jobs(timestamptz) to service_role;
