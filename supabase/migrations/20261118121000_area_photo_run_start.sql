-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R2 (release review V4; spec §9.3; review R17, R19).
--
-- V4  area_photo_reconfirm's R19 check (20261118108400) counted change
--     reports from the photo's LATEST acceptance, while
--     private.area_photo_freshness (R17, 20261118109000) counts checks from
--     the START of the current accepted run. A level change (reference <->
--     public) adds a new 'accepted' row, so a report made before it was
--     ignored by the check but still read by freshness: a backdated
--     'Still right' then cleared the report. Both now read one anchor,
--     private.area_photo_run_start: the first acceptance after the latest
--     decision that is not an acceptance.
--
-- Rollback: restore the 20261118109000 body of private.area_photo_freshness
-- and the 20261118108400 body of public.area_photo_reconfirm, then drop
-- private.area_photo_run_start.

-- The start of a label's current accepted run as of p_now: the first
-- 'accepted' decision after the latest decision that is not 'accepted'.
-- Null when the label has no acceptance in its current run.
create or replace function private.area_photo_run_start(p_label_id uuid, p_now timestamptz default now())
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(d.decided_at)
  from public.area_photo_decisions d
  where d.label_id = p_label_id and d.decided_at <= p_now and d.action = 'accepted'
    and d.id > coalesce((
      select max(x.id) from public.area_photo_decisions x
      where x.label_id = p_label_id and x.decided_at <= p_now and x.action <> 'accepted'), 0);
$$;

-- Body as in 20261118109000, with the run start read from the helper.
create or replace function private.area_photo_freshness(p_label_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_label public.media_area_labels;
  v_latest record;
  v_start timestamptz;
  v_tz text;
  v_last public.area_photo_checks;
  v_until date;
  v_basis date;
  v_policy public.knowledge_freshness_policies;
  v_entry jsonb;
begin
  select l.* into v_label from public.media_area_labels l where l.id = p_label_id;
  if not found then
    return null;
  end if;
  select d.action, d.decided_at into v_latest
  from public.area_photo_decisions d
  where d.label_id = p_label_id and d.decided_at <= p_now
  order by d.id desc limit 1;
  if v_latest.action is distinct from 'accepted' then
    return jsonb_build_object('state', 'not_accepted');
  end if;
  -- S2-INT (review R17): checks count from the start of the current accepted
  -- run, so a level change (reference <-> public) is not a reconfirmation.
  -- S3-R2 (V4): the run start is private.area_photo_run_start, shared with
  -- area_photo_reconfirm's not-before-the-report check.
  v_start := private.area_photo_run_start(p_label_id, p_now);
  v_tz := private.venue_timezone(v_label.venue_id);

  select c.valid_until into v_until from public.area_photo_checks c
  where c.label_id = p_label_id and c.kind = 'end_date_set'
    and c.created_at >= v_start and c.created_at <= p_now
  order by c.id desc limit 1;
  if v_until is not null and (p_now at time zone v_tz)::date > v_until then
    return jsonb_build_object('state', 'expired', 'cause', 'end_date_passed',
      'validUntil', to_char(v_until, 'YYYY-MM-DD'), 'nextCheckDue', null, 'verifiedOn', null, 'dueSoon', false);
  end if;

  select c.* into v_last from public.area_photo_checks c
  where c.label_id = p_label_id and c.kind in ('reconfirmed', 'change_reported', 'replacement_needed')
    and c.created_at >= v_start and c.created_at <= p_now
  order by c.id desc limit 1;
  if v_last.kind in ('change_reported', 'replacement_needed') then
    return jsonb_build_object(
      'state', case v_last.kind when 'change_reported' then 'check_due' else 'needs_replacement' end,
      'cause', v_last.kind, 'reason', v_last.reason, 'reportedAt', v_last.created_at,
      'validUntil', to_char(v_until, 'YYYY-MM-DD'), 'nextCheckDue', null, 'verifiedOn', null, 'dueSoon', false);
  end if;

  v_basis := greatest((v_start at time zone v_tz)::date,
    (select max(c.checked_on) from public.area_photo_checks c
      where c.label_id = p_label_id and c.kind = 'reconfirmed'
        and c.created_at >= v_start and c.created_at <= p_now));
  v_policy := private.knowledge_policy_as_of('space_photo', 'public', p_now);
  if v_policy.id is null then
    return jsonb_build_object('state', 'current', 'cause', null, 'verifiedOn', to_char(v_basis, 'YYYY-MM-DD'),
      'nextCheckDue', null, 'dueSoon', false, 'validUntil', to_char(v_until, 'YYYY-MM-DD'));
  end if;
  v_entry := private.knowledge_freshness_entry('public', v_policy.max_age, v_policy.recheck_lead,
    v_policy.basis, v_basis, null, p_now, v_tz);
  return jsonb_build_object(
    'state', case when v_entry ->> 'state' = 'expired' then 'check_due' else 'current' end,
    'cause', case when v_entry ->> 'state' = 'expired' then 'review_date_passed' end,
    'verifiedOn', to_char(v_basis, 'YYYY-MM-DD'),
    'nextCheckDue', v_entry -> 'nextCheckDue',
    'dueSoon', v_entry ->> 'state' = 'due_soon',
    'validUntil', to_char(v_until, 'YYYY-MM-DD'),
    'policyId', v_policy.id, 'policyVersion', v_policy.version);
end;
$$;

-- Body as in 20261118108400, with the report check anchored to the run start.
create or replace function public.area_photo_reconfirm(p_subject_id uuid, p_checked_on date default null, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_today date := private.london_today();
  v_checked date := coalesce(p_checked_on, private.london_today());
  v_note text := private.clean_text(p_note, 500, 'invalid_note');
  v_reported date;
  v_count integer;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select s.venue_id into v_venue from public.knowledge_subjects s where s.id = p_subject_id;
  if not found or not private.can_manage_venue(v_venue) then
    raise exception 'knowledge_subject_not_found' using errcode = 'P0002';
  end if;
  if v_checked > v_today or v_checked < v_today - 30 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('path', 'checkedOn', 'problem', 'out_of_range')))::text;
  end if;

  -- The latest change report on any accepted photo of the place since the
  -- start of that photo's current accepted run, as a venue-local day (R19).
  -- S3-R2 (V4): the run start, not the latest acceptance, so a level change
  -- (a new 'accepted' row) does not hide a report made before it. The same
  -- anchor as private.area_photo_freshness.
  select max((c.created_at at time zone private.venue_timezone(c.venue_id))::date) into v_reported
  from private.area_photo_accepted_labels(p_subject_id) a
  join public.area_photo_checks c on c.label_id = a.label_id
    and c.kind in ('change_reported', 'replacement_needed')
  where c.created_at >= private.area_photo_run_start(a.label_id, now());
  if v_reported is not null and v_checked < v_reported then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('path', 'checkedOn', 'problem', 'before_reported_change',
          'reportedOn', to_char(v_reported, 'YYYY-MM-DD'))))::text;
  end if;

  insert into public.area_photo_checks (label_id, venue_id, subject_id, kind, checked_on, reason, decided_by, decider_basis)
  select a.label_id, a.venue_id, p_subject_id, 'reconfirmed', v_checked, v_note, v_uid,
    case when private.is_active_admin() then 'admin' else 'venue_manager' end
  from private.area_photo_accepted_labels(p_subject_id) a;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('subjectId', p_subject_id, 'photos', v_count,
    'checkedOn', to_char(v_checked, 'YYYY-MM-DD'));
end;
$$;

revoke all on function private.area_photo_run_start(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.area_photo_freshness(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.area_photo_reconfirm(uuid, date, text) from public, anon, service_role;
grant execute on function public.area_photo_reconfirm(uuid, date, text) to authenticated;
