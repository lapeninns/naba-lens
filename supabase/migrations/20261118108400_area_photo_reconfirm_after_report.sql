-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R19; spec §9.3).
--
-- R19  "Still right" for a place accepted any day from today back 30 days,
--      so a check made BEFORE a reported change (or a known change needing
--      replacement) could clear that report. area_photo_reconfirm now
--      refuses a checked-on day earlier than the venue-local day of the
--      latest such report since the photo's current acceptance, as
--      knowledge_reconfirm refuses a day before the answer. The freshness
--      rule itself (private.area_photo_freshness) is unchanged.
--
-- Rollback: restore the 20261118104000 body.

-- Body as in 20261118104000, plus the not-before-the-report check.
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

  -- The latest change report on any accepted photo of the place since that
  -- photo's current acceptance, as a venue-local day (R19).
  select max((c.created_at at time zone private.venue_timezone(c.venue_id))::date) into v_reported
  from private.area_photo_accepted_labels(p_subject_id) a
  join public.area_photo_checks c on c.label_id = a.label_id
    and c.kind in ('change_reported', 'replacement_needed')
  where c.created_at >= (
    select max(d.decided_at) from public.area_photo_decisions d
    where d.label_id = a.label_id and d.action = 'accepted');
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
