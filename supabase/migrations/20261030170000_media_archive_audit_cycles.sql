-- Resumable archive verification cycles and a per-invocation run history.
-- Additive to 20261030150000_media_original_archives.sql: existing columns keep
-- their meaning. Tables stay service-role only with no access for end users.

-- A cursor written by the previous single-batch audit belongs to no cycle. Drop
-- it so the next run starts a cycle it can account for.
update public.media_archive_audit_state set cursor_id = 0;

alter table public.media_archive_audit_state
  add column cycle_id uuid,
  add column cycle_started_at timestamptz,
  add column cycle_target_id bigint check (cycle_target_id is null or cycle_target_id >= 0),
  add column cycle_target_count bigint check (cycle_target_count is null or cycle_target_count >= 0),
  add column cycle_checked bigint not null default 0 check (cycle_checked >= 0),
  add column last_run_outcome text check (last_run_outcome is null or last_run_outcome in
    ('completed_cycle', 'partial', 'locked', 'timeout', 'lease_lost', 'failed', 'idle')),
  add column last_complete_cycle_started_at timestamptz,
  add column last_cycle_duration_seconds integer check (last_cycle_duration_seconds is null or last_cycle_duration_seconds >= 0),
  add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0);

alter table public.media_archive_audit_state
  drop constraint media_archive_audit_state_last_error_check,
  add constraint media_archive_audit_state_last_error_check check (
    last_error is null or last_error in (
      'archive_audit_failed', 'archive_audit_timeout', 'archive_lease_lost',
      'archive_checkpoint_failed', 'archive_store_unavailable', 'archive_source_unavailable')),
  add constraint media_archive_audit_state_cycle_shape check (
    (cycle_id is null) = (cycle_started_at is null)
    and (cycle_id is null) = (cycle_target_id is null)
    and (cycle_id is null) = (cycle_target_count is null)),
  add constraint media_archive_audit_state_cursor_in_cycle check (
    cursor_id = 0 or (cycle_id is not null and cursor_id <= cycle_target_id));

-- One row per invocation. Rows are never edited; only rows past the 90-day
-- retention window may be deleted, so the pruning run can keep the table small.
create table public.media_archive_audit_runs (
  id bigint generated always as identity primary key,
  run_id uuid not null unique,
  cycle_id uuid,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null check (outcome in
    ('completed_cycle', 'partial', 'locked', 'timeout', 'lease_lost', 'failed', 'idle')),
  checked integer not null default 0 check (checked >= 0),
  copied integer not null default 0 check (copied >= 0),
  missing bigint check (missing is null or missing >= 0),
  bytes_verified bigint not null default 0 check (bytes_verified >= 0),
  error text check (error is null or error in (
    'archive_audit_failed', 'archive_audit_timeout', 'archive_lease_lost',
    'archive_checkpoint_failed', 'archive_store_unavailable', 'archive_source_unavailable')),
  cursor_from bigint check (cursor_from is null or cursor_from >= 0),
  cursor_to bigint check (cursor_to is null or cursor_to >= 0),
  check (finished_at >= started_at),
  check ((outcome in ('timeout', 'lease_lost', 'failed')) = (error is not null))
);
create index media_archive_audit_runs_finished_idx on public.media_archive_audit_runs(finished_at desc);
alter table public.media_archive_audit_runs enable row level security;
revoke all on public.media_archive_audit_runs from public, anon, authenticated, service_role;
grant select, insert, delete on public.media_archive_audit_runs to service_role;
revoke all on sequence public.media_archive_audit_runs_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.media_archive_audit_runs_id_seq to service_role;

create function private.media_archive_audit_runs_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.finished_at < now() - interval '90 days' then
    return old;
  end if;
  raise exception 'audit_append_only' using errcode = '42501',
    detail = format('%s is append-only.', tg_table_name);
end;
$$;
revoke all on function private.media_archive_audit_runs_guard() from public, anon, authenticated;
create trigger media_archive_audit_runs_append_only
  before update or delete on public.media_archive_audit_runs
  for each row execute function private.media_archive_audit_runs_guard();
create trigger media_archive_audit_runs_no_truncate
  before truncate on public.media_archive_audit_runs
  for each statement execute function private.append_only_guard();
