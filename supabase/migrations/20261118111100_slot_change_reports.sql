-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-STAFF (spec §6 S3 "Report a change", §6 S4 "request
-- correction", §23.6; AC15, AC26): staff tell a manager that something about
-- a slot or one of their reviewed photos has changed. A report never changes
-- public information, coverage or a review decision by itself: it goes to
-- the venue's manager, who resolves or dismisses it (with a note).
--
--   Report     public.report_slot_change(kind, subject, reason, note)
--              kind dish | area | amenity: a slot at a venue whose album the
--              caller may see (private.can_view_venue_album), checked
--              against the coverage rule's rows, so a slot of another venue
--              is not found. Reasons (spec §6 S3): no_longer_served,
--              appearance_changed, space_unavailable, wrong_label, other.
--              kind photo: a correction request on the caller's own photo
--              (any venue it was uploaded to): wrong_label, wrong_date,
--              other. "other" needs a note. One open report per person,
--              subject and reason: asking again returns the open one.
--   Mine       public.my_slot_change_reports(limit): the caller's own.
--   Withdraw   public.withdraw_slot_change_report(id): the reporter, while
--              it is open.
--   List       public.slot_change_reports(venue, state, limit): the venue's
--              manager, or an admin naming the venue.
--   Decide     public.decide_slot_change_report(id, action, note): the
--              venue's manager or an admin; resolved or dismissed.
--
-- slot_change_report_events is append-only (actor, action, note). Each
-- decision is also written to the activity log (private.record_activity).
-- Tables are read and written only through these functions.
--
-- Rollback: drop the five functions and the two tables.

create table public.slot_change_reports (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  reporter_id uuid not null references public.profiles (id) on delete restrict,
  subject_kind text not null check (subject_kind in ('dish', 'area', 'amenity', 'photo')),
  -- A menu item, knowledge subject, amenity check, or (photo) media asset.
  subject_id uuid not null,
  -- Snapshot of the name the reporter saw.
  subject_name text not null check (length(subject_name) between 1 and 200),
  reason text not null check (reason in (
    'no_longer_served', 'appearance_changed', 'space_unavailable', 'wrong_label', 'wrong_date', 'other')),
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  state text not null default 'open' check (state in ('open', 'resolved', 'dismissed', 'withdrawn')),
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_note text check (decision_note is null or (length(decision_note) between 1 and 500 and decision_note = btrim(decision_note))),
  created_at timestamptz not null default now(),
  constraint slot_change_reports_decided check ((state = 'open') = (decided_at is null)),
  constraint slot_change_reports_decider check ((decided_at is null) = (decided_by is null)),
  constraint slot_change_reports_other_note check (reason <> 'other' or note is not null),
  constraint slot_change_reports_kind_reasons check (
    (subject_kind = 'photo' and reason in ('wrong_label', 'wrong_date', 'other'))
    or (subject_kind <> 'photo' and reason <> 'wrong_date'))
);

create unique index slot_change_reports_one_open
  on public.slot_change_reports (reporter_id, subject_kind, subject_id, reason) where state = 'open';
create index slot_change_reports_venue_open_idx
  on public.slot_change_reports (venue_id, created_at) where state = 'open';
create index slot_change_reports_reporter_idx
  on public.slot_change_reports (reporter_id, created_at desc);

alter table public.slot_change_reports enable row level security;

comment on table public.slot_change_reports is
  'S2-STAFF, spec §6 S3/S4: staff reports of a changed slot and correction requests on their own reviewed photos. Never changes public information by itself.';

create table public.slot_change_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.slot_change_reports (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null check (action in ('reported', 'resolved', 'dismissed', 'withdrawn')),
  note text check (note is null or length(note) between 1 and 500),
  created_at timestamptz not null default now()
);

create index slot_change_report_events_report_idx on public.slot_change_report_events (report_id, id);

alter table public.slot_change_report_events enable row level security;

create trigger slot_change_report_events_append_only
  before update or delete on public.slot_change_report_events
  for each row execute function private.append_only_guard();
create trigger slot_change_report_events_no_truncate
  before truncate on public.slot_change_report_events
  for each statement execute function private.append_only_guard();

comment on table public.slot_change_report_events is
  'S2-STAFF: append-only history of slot change reports (reported, resolved, dismissed, withdrawn).';

revoke all on table public.slot_change_reports, public.slot_change_report_events
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.slot_change_report_json(p_report public.slot_change_reports)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_report.id,
    'venueId', p_report.venue_id,
    'reporterId', p_report.reporter_id,
    'reporterName', (select p.display_name from public.profiles p where p.id = p_report.reporter_id),
    'subjectKind', p_report.subject_kind,
    'subjectId', p_report.subject_id,
    'subjectName', p_report.subject_name,
    'reason', p_report.reason,
    'note', p_report.note,
    'state', p_report.state,
    'createdAt', p_report.created_at,
    'decidedAt', p_report.decided_at,
    'decisionNote', p_report.decision_note);
$$;

revoke all on function private.slot_change_report_json(public.slot_change_reports)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Commands and reads
-- ---------------------------------------------------------------------------

create function public.report_slot_change(
  p_kind text,
  p_subject_id uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_venue uuid;
  v_name text;
  v_report public.slot_change_reports;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('dish', 'area', 'amenity', 'photo') or p_subject_id is null then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if p_reason is null
     or (p_kind = 'photo' and p_reason not in ('wrong_label', 'wrong_date', 'other'))
     or (p_kind <> 'photo' and p_reason not in (
       'no_longer_served', 'appearance_changed', 'space_unavailable', 'wrong_label', 'other')) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'note_required' using errcode = '22023';
  end if;

  if p_kind = 'photo' then
    -- The caller's own photo, at whichever venue it was uploaded to.
    select a.venue_id into v_venue
    from public.media_assets a
    where a.id = p_subject_id and a.uploader_id = v_uid and a.deleted_at is null;
    if v_venue is null then
      raise exception 'subject_not_found' using errcode = 'P0002';
    end if;
    v_name := coalesce(
      (select li.item_name from public.media_label_items li
       where li.asset_id = p_subject_id order by li.added_at limit 1),
      (select l.subject_label from public.media_area_labels l
       where l.asset_id = p_subject_id and l.removed_at is null order by l.added_at limit 1),
      'Photo');
  else
    -- A slot at the caller's current venue, as the coverage rule lists it.
    v_venue := (select p.venue_id from public.profiles p where p.id = v_uid);
    if v_venue is null or not private.can_view_venue_album(v_venue) then
      raise exception 'subject_not_found' using errcode = 'P0002';
    end if;
    select r.name into v_name
    from private.coverage_slot_rows(v_venue) r
    where r.slot_kind = p_kind and r.slot_id = p_subject_id;
    if v_name is null then
      raise exception 'subject_not_found' using errcode = 'P0002';
    end if;
  end if;

  select r.* into v_report
  from public.slot_change_reports r
  where r.reporter_id = v_uid and r.subject_kind = p_kind and r.subject_id = p_subject_id
    and r.reason = p_reason and r.state = 'open';
  if found then
    return jsonb_build_object('created', false, 'report', private.slot_change_report_json(v_report));
  end if;

  insert into public.slot_change_reports (venue_id, reporter_id, subject_kind, subject_id, subject_name, reason, note)
  values (v_venue, v_uid, p_kind, p_subject_id, left(v_name, 200), p_reason, v_note)
  returning * into v_report;
  insert into public.slot_change_report_events (report_id, actor_id, action, note)
  values (v_report.id, v_uid, 'reported', v_note);
  perform private.record_activity(
    v_venue, 'slot_change_reported', 'slot_change_report', v_report.id::text,
    null, null, v_note, null,
    jsonb_build_object('kind', p_kind, 'subjectId', p_subject_id, 'reason', p_reason));

  return jsonb_build_object('created', true, 'report', private.slot_change_report_json(v_report));
end;
$$;

create function public.my_slot_change_reports(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.slot_change_report_json(r) order by r.created_at desc, r.id)
    from (
      select * from public.slot_change_reports x
      where x.reporter_id = v_uid
      order by x.created_at desc, x.id
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) r
  ), '[]'::jsonb));
end;
$$;

create function public.withdraw_slot_change_report(p_report_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.slot_change_reports;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select r.* into v_report from public.slot_change_reports r
  where r.id = p_report_id and r.reporter_id = v_uid
  for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if v_report.state <> 'open' then
    raise exception 'report_closed' using errcode = '55000';
  end if;
  update public.slot_change_reports r
  set state = 'withdrawn', decided_by = v_uid, decided_at = now()
  where r.id = p_report_id
  returning * into v_report;
  insert into public.slot_change_report_events (report_id, actor_id, action)
  values (v_report.id, v_uid, 'withdrawn');
  return jsonb_build_object('report', private.slot_change_report_json(v_report));
end;
$$;

create function public.slot_change_reports(
  p_venue_id uuid default null,
  p_state text default 'open',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('open', 'resolved', 'dismissed', 'withdrawn') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(private.slot_change_report_json(r) order by r.created_at, r.id)
    from (
      select * from public.slot_change_reports x
      where x.venue_id = v_venue and (p_state is null or x.state = p_state)
      order by x.created_at, x.id
      limit least(greatest(coalesce(p_limit, 100), 1), 200)
    ) r
  ), '[]'::jsonb));
end;
$$;

create function public.decide_slot_change_report(
  p_report_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_report public.slot_change_reports;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('resolved', 'dismissed') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  select r.* into v_report from public.slot_change_reports r where r.id = p_report_id for update;
  if not found or not private.can_manage_venue(v_report.venue_id) then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if v_report.state <> 'open' then
    raise exception 'report_closed' using errcode = '55000';
  end if;
  update public.slot_change_reports r
  set state = p_action, decided_by = v_uid, decided_at = now(), decision_note = v_note
  where r.id = p_report_id
  returning * into v_report;
  insert into public.slot_change_report_events (report_id, actor_id, action, note)
  values (v_report.id, v_uid, p_action, v_note);
  perform private.record_activity(
    v_report.venue_id, 'slot_change_' || p_action, 'slot_change_report', v_report.id::text,
    null, null, v_note, jsonb_build_object('state', 'open'), jsonb_build_object('state', p_action));
  return jsonb_build_object('report', private.slot_change_report_json(v_report));
end;
$$;

revoke all on function public.report_slot_change(text, uuid, text, text) from public, anon, service_role;
revoke all on function public.my_slot_change_reports(integer) from public, anon, service_role;
revoke all on function public.withdraw_slot_change_report(uuid) from public, anon, service_role;
revoke all on function public.slot_change_reports(uuid, text, integer) from public, anon, service_role;
revoke all on function public.decide_slot_change_report(uuid, text, text) from public, anon, service_role;
grant execute on function public.report_slot_change(text, uuid, text, text) to authenticated;
grant execute on function public.my_slot_change_reports(integer) to authenticated;
grant execute on function public.withdraw_slot_change_report(uuid) to authenticated;
grant execute on function public.slot_change_reports(uuid, text, integer) to authenticated;
grant execute on function public.decide_slot_change_report(uuid, text, text) to authenticated;
