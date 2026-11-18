-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-OPS: organisation settings and personal notification
-- preferences (spec §8 A7, §6 S5, §16, §17; checklist
-- A7-limits-reminders-retention, S17-quiet-hours, S5-notification-prefs).
--
--   ops_settings   one row for the one organisation (FA-33): quiet hours
--                  (default 21:00-08:00, read in each venue's timezone),
--                  manager review reminder cadence, the sustained-backlog
--                  threshold for admin exceptions, the orphan upload window
--                  (default 7 days, §16), the allowed export profiles, and
--                  the storage quota with its alert level. Media limits stay
--                  in code (lib/config/media.ts) and are shown read-only.
--                  Holds no secrets. Every change is versioned (revision) and
--                  written to activity_events with the old and new values.
--   notification_preferences
--                  one row per person, created on first change: which in-app
--                  notices they get (retakes, assignments, upload problems,
--                  digests) and optional personal quiet hours. Push and email
--                  are Release 2 (FA-43): only in-app notices exist.
--
-- Reads: public.ops_settings() for any active user (screens show quiet hours
-- and allowed export profiles); public.my_notification_preferences().
-- Writes: public.ops_settings_set (admin, expected revision, reason) and
-- public.set_my_notification_preferences (the person themself).
--
-- Rollback: roll back the app first, then revoke execute on the four public
-- functions. Tables stay; code falls back to the defaults below.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.ops_settings (
  id boolean primary key default true check (id),
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  review_reminder_days integer not null default 1 check (review_reminder_days between 1 and 14),
  backlog_alert_days integer not null default 7 check (backlog_alert_days between 1 and 60),
  orphan_cleanup_days integer not null default 7 check (orphan_cleanup_days between 1 and 30),
  export_profiles text[] not null default array['original', 'website', 'social', 'custom']
    check (cardinality(export_profiles) between 1 and 4
      and export_profiles <@ array['original', 'website', 'social', 'custom']),
  storage_quota_bytes bigint not null default 107374182400
    check (storage_quota_bytes between 1073741824 and 109951162777600),
  storage_alert_percent integer not null default 80 check (storage_alert_percent between 50 and 99),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

comment on table public.ops_settings is
  'S1-OPS: the organisation settings row (A7). No secrets. Changed through public.ops_settings_set; history in activity_events.';

insert into public.ops_settings (id) values (true);

create table public.notification_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  retakes boolean not null default true,
  assignments boolean not null default true,
  upload_problems boolean not null default true,
  digests boolean not null default true,
  -- Personal quiet hours; both null means the organisation's.
  quiet_start time,
  quiet_end time,
  updated_at timestamptz not null default now(),
  constraint notification_preferences_quiet_pair check ((quiet_start is null) = (quiet_end is null))
);

comment on table public.notification_preferences is
  'S1-OPS: one person''s in-app notification choices (S5, §17). Missing row = all on, organisation quiet hours.';

alter table public.ops_settings enable row level security;
alter table public.notification_preferences enable row level security;
revoke all on table public.ops_settings, public.notification_preferences
  from public, anon, authenticated, service_role;
grant select on table public.ops_settings, public.notification_preferences to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.ops_settings_json(p_row public.ops_settings)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'quietStart', to_char(p_row.quiet_start, 'HH24:MI'),
    'quietEnd', to_char(p_row.quiet_end, 'HH24:MI'),
    'reviewReminderDays', p_row.review_reminder_days,
    'backlogAlertDays', p_row.backlog_alert_days,
    'orphanCleanupDays', p_row.orphan_cleanup_days,
    'exportProfiles', to_jsonb(p_row.export_profiles),
    'storageQuotaBytes', p_row.storage_quota_bytes,
    'storageAlertPercent', p_row.storage_alert_percent,
    'revision', p_row.revision,
    'updatedAt', p_row.updated_at);
$$;

-- "HH:MM" (00:00-23:59) to time; anything else raises p_code.
create function private.ops_parse_hhmm(p_value jsonb, p_code text)
returns time
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string'
      or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception '%', p_code using errcode = '22023';
  end if;
  return (p_value #>> '{}')::time;
end;
$$;

-- A whole number within bounds from a JSON number; else p_code.
create function private.ops_parse_int(p_value jsonb, p_min bigint, p_max bigint, p_code text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    raise exception '%', p_code using errcode = '22023';
  end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception '%', p_code using errcode = '22023';
  end if;
  return v::bigint;
end;
$$;

revoke all on function private.ops_settings_json(public.ops_settings) from public, anon, authenticated;
revoke all on function private.ops_parse_hhmm(jsonb, text) from public, anon, authenticated;
revoke all on function private.ops_parse_int(jsonb, bigint, bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Organisation settings
-- ---------------------------------------------------------------------------

-- Any active person: the settings (no secrets) plus the venue timezone quiet
-- hours are read in. p_venue_id defaults to the caller's own venue.
create function public.ops_settings(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.ops_settings;
  v_venue uuid;
begin
  perform private.amenity_assert_active_user();
  select * into v_row from public.ops_settings where id;
  v_venue := coalesce(p_venue_id,
    (select p.venue_id from public.profiles p where p.id = auth.uid()));
  return private.ops_settings_json(v_row)
    || jsonb_build_object('timezone', private.venue_timezone(v_venue));
end;
$$;

-- Admin only. p_patch holds only the fields to change (the keys of
-- ops_settings()); unknown keys are refused. A stale p_expected_revision is
-- refused (stale_revision, 40001) so two admins never overwrite each other.
-- An unchanged patch writes nothing. The reason is required.
create function public.ops_settings_set(
  p_expected_revision integer,
  p_patch jsonb,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.ops_settings;
  v_new public.ops_settings;
  v_reason text;
  v_key text;
  v_profiles text[];
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('quietStart', 'quietEnd', 'reviewReminderDays', 'backlogAlertDays',
        'orphanCleanupDays', 'exportProfiles', 'storageQuotaBytes', 'storageAlertPercent') then
      raise exception 'invalid_patch' using errcode = '22023', detail = v_key;
    end if;
  end loop;
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_old from public.ops_settings where id for update;
  if p_expected_revision is distinct from v_old.revision then
    raise exception 'stale_revision' using errcode = '40001',
      detail = format('Current revision is %s.', v_old.revision);
  end if;

  v_new := v_old;
  if p_patch ? 'quietStart' then
    v_new.quiet_start := private.ops_parse_hhmm(p_patch -> 'quietStart', 'invalid_quiet_hours');
  end if;
  if p_patch ? 'quietEnd' then
    v_new.quiet_end := private.ops_parse_hhmm(p_patch -> 'quietEnd', 'invalid_quiet_hours');
  end if;
  if p_patch ? 'reviewReminderDays' then
    v_new.review_reminder_days := private.ops_parse_int(p_patch -> 'reviewReminderDays', 1, 14, 'invalid_reminder_days');
  end if;
  if p_patch ? 'backlogAlertDays' then
    v_new.backlog_alert_days := private.ops_parse_int(p_patch -> 'backlogAlertDays', 1, 60, 'invalid_backlog_days');
  end if;
  if p_patch ? 'orphanCleanupDays' then
    v_new.orphan_cleanup_days := private.ops_parse_int(p_patch -> 'orphanCleanupDays', 1, 30, 'invalid_cleanup_days');
  end if;
  if p_patch ? 'storageQuotaBytes' then
    v_new.storage_quota_bytes := private.ops_parse_int(p_patch -> 'storageQuotaBytes',
      1073741824, 109951162777600, 'invalid_storage_quota');
  end if;
  if p_patch ? 'storageAlertPercent' then
    v_new.storage_alert_percent := private.ops_parse_int(p_patch -> 'storageAlertPercent', 50, 99, 'invalid_alert_percent');
  end if;
  if p_patch ? 'exportProfiles' then
    if jsonb_typeof(p_patch -> 'exportProfiles') <> 'array'
        or exists (select 1 from jsonb_array_elements(p_patch -> 'exportProfiles') e
                   where jsonb_typeof(e) <> 'string') then
      raise exception 'invalid_export_profiles' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct e order by e), '{}') into v_profiles
    from jsonb_array_elements_text(p_patch -> 'exportProfiles') e;
    if cardinality(v_profiles) = 0
        or not v_profiles <@ array['original', 'website', 'social', 'custom'] then
      raise exception 'invalid_export_profiles' using errcode = '22023';
    end if;
    v_new.export_profiles := v_profiles;
  end if;

  if (v_new.quiet_start, v_new.quiet_end, v_new.review_reminder_days, v_new.backlog_alert_days,
      v_new.orphan_cleanup_days, v_new.storage_quota_bytes, v_new.storage_alert_percent)
      is not distinct from
     (v_old.quiet_start, v_old.quiet_end, v_old.review_reminder_days, v_old.backlog_alert_days,
      v_old.orphan_cleanup_days, v_old.storage_quota_bytes, v_old.storage_alert_percent)
     and (select array_agg(x order by x) from unnest(v_new.export_profiles) x)
       is not distinct from (select array_agg(x order by x) from unnest(v_old.export_profiles) x) then
    return private.ops_settings_json(v_old) || jsonb_build_object('changed', false);
  end if;

  update public.ops_settings set
    quiet_start = v_new.quiet_start,
    quiet_end = v_new.quiet_end,
    review_reminder_days = v_new.review_reminder_days,
    backlog_alert_days = v_new.backlog_alert_days,
    orphan_cleanup_days = v_new.orphan_cleanup_days,
    export_profiles = v_new.export_profiles,
    storage_quota_bytes = v_new.storage_quota_bytes,
    storage_alert_percent = v_new.storage_alert_percent,
    revision = v_old.revision + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where id
  returning * into v_new;

  perform private.record_activity(null, 'settings_changed', 'settings', 'organisation',
    v_old.revision, v_new.revision, v_reason,
    private.ops_settings_json(v_old) - 'revision' - 'updatedAt',
    private.ops_settings_json(v_new) - 'revision' - 'updatedAt');

  return private.ops_settings_json(v_new) || jsonb_build_object('changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Personal notification preferences
-- ---------------------------------------------------------------------------

create function private.notification_preferences_json(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'retakes', coalesce(np.retakes, true),
    'assignments', coalesce(np.assignments, true),
    'uploadProblems', coalesce(np.upload_problems, true),
    'digests', coalesce(np.digests, true),
    'quietStart', to_char(np.quiet_start, 'HH24:MI'),
    'quietEnd', to_char(np.quiet_end, 'HH24:MI'),
    'organisationQuietStart', to_char(s.quiet_start, 'HH24:MI'),
    'organisationQuietEnd', to_char(s.quiet_end, 'HH24:MI'),
    'timezone', private.venue_timezone(p.venue_id))
  from public.profiles p
  cross join public.ops_settings s
  left join public.notification_preferences np on np.profile_id = p.id
  where p.id = p_profile and s.id;
$$;

revoke all on function private.notification_preferences_json(uuid) from public, anon, authenticated;

create function public.my_notification_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  return private.notification_preferences_json(auth.uid());
end;
$$;

-- The person themself. p_patch keys: retakes, assignments, uploadProblems,
-- digests (booleans); quietStart and quietEnd ("HH:MM", both or neither;
-- both null returns to the organisation's quiet hours).
create function public.set_my_notification_preferences(p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_row public.notification_preferences;
  v_key text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key in ('retakes', 'assignments', 'uploadProblems', 'digests') then
      if jsonb_typeof(p_patch -> v_key) <> 'boolean' then
        raise exception 'invalid_patch' using errcode = '22023', detail = v_key;
      end if;
    elsif v_key not in ('quietStart', 'quietEnd') then
      raise exception 'invalid_patch' using errcode = '22023', detail = v_key;
    end if;
  end loop;
  if (p_patch ? 'quietStart') <> (p_patch ? 'quietEnd') then
    raise exception 'invalid_quiet_hours' using errcode = '22023';
  end if;

  select * into v_row from public.notification_preferences where profile_id = v_uid;
  if not found then
    v_row.profile_id := v_uid;
    v_row.retakes := true;
    v_row.assignments := true;
    v_row.upload_problems := true;
    v_row.digests := true;
  end if;
  if p_patch ? 'retakes' then v_row.retakes := (p_patch ->> 'retakes')::boolean; end if;
  if p_patch ? 'assignments' then v_row.assignments := (p_patch ->> 'assignments')::boolean; end if;
  if p_patch ? 'uploadProblems' then v_row.upload_problems := (p_patch ->> 'uploadProblems')::boolean; end if;
  if p_patch ? 'digests' then v_row.digests := (p_patch ->> 'digests')::boolean; end if;
  if p_patch ? 'quietStart' then
    if jsonb_typeof(p_patch -> 'quietStart') = 'null' and jsonb_typeof(p_patch -> 'quietEnd') = 'null' then
      v_row.quiet_start := null;
      v_row.quiet_end := null;
    else
      v_row.quiet_start := private.ops_parse_hhmm(p_patch -> 'quietStart', 'invalid_quiet_hours');
      v_row.quiet_end := private.ops_parse_hhmm(p_patch -> 'quietEnd', 'invalid_quiet_hours');
    end if;
  end if;

  insert into public.notification_preferences as np (
    profile_id, retakes, assignments, upload_problems, digests, quiet_start, quiet_end, updated_at)
  values (v_uid, v_row.retakes, v_row.assignments, v_row.upload_problems, v_row.digests,
    v_row.quiet_start, v_row.quiet_end, now())
  on conflict (profile_id) do update set
    retakes = excluded.retakes, assignments = excluded.assignments,
    upload_problems = excluded.upload_problems, digests = excluded.digests,
    quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now();

  return private.notification_preferences_json(v_uid);
end;
$$;

revoke all on function public.ops_settings(uuid) from public, anon, service_role;
revoke all on function public.ops_settings_set(integer, jsonb, text) from public, anon, service_role;
revoke all on function public.my_notification_preferences() from public, anon, service_role;
revoke all on function public.set_my_notification_preferences(jsonb) from public, anon, service_role;
grant execute on function public.ops_settings(uuid) to authenticated;
grant execute on function public.ops_settings_set(integer, jsonb, text) to authenticated;
grant execute on function public.my_notification_preferences() to authenticated;
grant execute on function public.set_my_notification_preferences(jsonb) to authenticated;
