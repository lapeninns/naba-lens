-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R12, R13, R14, R15;
-- spec §4.3, §4.4, §8 A3; AC28, AC29).
--
-- R12  Core amenity checks are admin-only to archive (AC29), but only the
--      wrapper amenity_check_set_applicability said so; the older archive
--      RPCs (2-arg, and the keyed 3-arg that calls it), which the app still
--      calls, let a venue manager archive a core check. The 2-arg
--      amenity_archive_check is the one path every archive takes, so the core
--      rule now lives there. (Removing execute on the reasonless RPCs, so
--      every archive also carries a reason, is S2-MGR's: its screen moves to
--      amenity_check_set_applicability first.)
-- R13  A change request sent back for clarification could never be decided
--      again. The requester now answers it (menu_change_request_clarify),
--      which reopens it, and an admin may also decide it directly.
-- R14  A scheduled activation lapsed only when the NUMBER of retirements
--      changed. The confirmed set of retired items is now stored at schedule
--      time and promotion lapses when the set differs.
-- R15  The legacy activate_menu_version skipped the retirement confirmation.
--      It now refuses any activation that would retire items
--      (menu_retirements_unconfirmed); one that retires nothing still works.
--
-- Rollback: restore the earlier bodies (20261107120000 amenity_archive_check,
-- 20261118103200 menu_change_request_decide, 20261118103000
-- schedule_menu_version / menu_promote_due, 20261030120000
-- activate_menu_version); revoke execute on menu_change_request_clarify.
-- The new column stays (nullable).

-- ---------------------------------------------------------------------------
-- R12: core checks are admin-only on every archive path
-- ---------------------------------------------------------------------------

-- Body as in 20261107120000, plus the core rule of
-- amenity_check_set_applicability (20261118103300).
create or replace function public.amenity_archive_check(p_check_id uuid, p_revision integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_lock_managed_check(p_check_id, p_revision);
  v_revision integer;
begin
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.amenity_catalogue t where t.key = v_check.template_key and t.is_core
  ) and not private.is_active_admin() then
    raise exception 'core_check_admin_only' using errcode = '42501';
  end if;
  update public.venue_amenity_checks c
  set status = 'archived', revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;
  perform private.amenity_event(v_check.id, v_check.venue_id, 'archived', null, '{}'::jsonb);
  return v_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- R13: a clarification can be answered and decided
-- ---------------------------------------------------------------------------

-- Body as in 20261118103200, except that a request waiting for
-- clarification may be decided too (the admin need not wait for a reply).
create or replace function public.menu_change_request_decide(
  p_request_id uuid, p_decision text, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v public.menu_change_requests;
  v_reason text;
begin
  if p_decision is null or p_decision not in ('accepted', 'declined', 'clarification_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select r.* into v from public.menu_change_requests r where r.id = p_request_id for update;
  if v.id is null then
    raise exception 'menu_change_request_not_found' using errcode = 'P0002';
  end if;
  if v.revision is distinct from p_revision then
    raise exception 'menu_change_request_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v.revision)::text;
  end if;
  if v.status not in ('open', 'clarification_requested') then
    raise exception 'menu_change_request_not_open' using errcode = 'P0001';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'reason_too_long');
  if p_decision <> 'accepted' and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.menu_change_requests r
  set status = p_decision, decided_by = v_uid, decided_at = now(), decision_reason = v_reason,
      revision = r.revision + 1
  where r.id = v.id;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v.venue_id, v.item_id, v_uid, 'change_request_decided',
    jsonb_build_object('requestId', v.id, 'decision', p_decision, 'reason', v_reason));
  return jsonb_build_object('requestId', v.id, 'status', p_decision, 'revision', v.revision + 1);
end;
$$;

-- The requester answers an admin's question: the reply is added to the
-- request's detail (the whole thread stays within 1000 characters), the
-- request is open again for a decision, and the reply is a menu_events row.
create function public.menu_change_request_clarify(p_request_id uuid, p_reply text, p_revision integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v public.menu_change_requests;
  v_reply text;
  v_detail text;
begin
  select r.* into v from public.menu_change_requests r where r.id = p_request_id for update;
  if v.id is null or v.requested_by <> v_uid then
    raise exception 'menu_change_request_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_can_manage_venue(v.venue_id);
  if v.revision is distinct from p_revision then
    raise exception 'menu_change_request_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v.revision)::text;
  end if;
  if v.status <> 'clarification_requested' then
    raise exception 'menu_change_request_not_waiting' using errcode = 'P0001';
  end if;
  v_reply := private.clean_text(p_reply, 1000, 'invalid_detail');
  if v_reply is null then
    raise exception 'invalid_detail' using errcode = '22023';
  end if;
  v_detail := v.detail || E'\n\nReply: ' || v_reply;
  if length(v_detail) > 1000 then
    raise exception 'invalid_detail' using errcode = '22023',
      detail = 'The request and its replies fit in 1000 characters.';
  end if;

  update public.menu_change_requests r
  set status = 'open', detail = v_detail, revision = r.revision + 1
  where r.id = v.id;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v.venue_id, v.item_id, v_uid, 'change_requested',
    jsonb_build_object('requestId', v.id, 'kind', v.kind, 'reply', v_reply,
      'question', v.decision_reason));
  return jsonb_build_object('requestId', v.id, 'status', 'open', 'revision', v.revision + 1);
end;
$$;

revoke all on function public.menu_change_request_clarify(uuid, text, integer) from public, anon, service_role;
grant execute on function public.menu_change_request_clarify(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- R14: the confirmed retirement set, not only its size
-- ---------------------------------------------------------------------------

alter table public.menu_versions
  add column scheduled_retired_items uuid[];

comment on column public.menu_versions.scheduled_retired_items is
  'S2-FIX: the sorted item ids an admin confirmed would retire when the schedule was set. NULL for schedules set before it existed (the count is compared then).';

-- The item ids activating this draft would retire, sorted.
create function private.menu_retired_set(p_version_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.item_id order by r.item_id), '{}'::uuid[])
  from private.menu_retired_items(p_version_id) r;
$$;

revoke all on function private.menu_retired_set(uuid) from public, anon, authenticated;

-- Whenever a schedule is cleared (any path), its confirmed set goes with it.
create function private.menu_versions_schedule_set_cleared()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_for is null then
    new.scheduled_retired_items := null;
  end if;
  return new;
end;
$$;

revoke all on function private.menu_versions_schedule_set_cleared() from public, anon, authenticated;

-- Named to run after menu_versions_schedule_cleared (triggers fire by name).
create trigger menu_versions_schedule_set_cleared
  before update on public.menu_versions
  for each row execute function private.menu_versions_schedule_set_cleared();

-- Body as in 20261118103000, plus the confirmed set stored with the count.
create or replace function public.schedule_menu_version(
  p_version_id uuid,
  p_expected_revision integer,
  p_at timestamptz,
  p_retirements integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_venue uuid;
  v_version public.menu_versions;
  v_count integer;
begin
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;
  if p_at is null or p_at <= now() + interval '1 minute' then
    raise exception 'menu_schedule_in_past' using errcode = '22023';
  end if;
  if p_at > now() + interval '366 days' then
    raise exception 'menu_schedule_too_far' using errcode = '22023';
  end if;
  perform private.lock_venue_menu(v_venue);
  select v.* into v_version from public.menu_versions v where v.id = p_version_id for update;
  perform private.assert_menu_activatable(v_version, p_expected_revision);
  v_count := private.assert_menu_retirements(p_version_id, p_retirements);

  if exists (
    select 1 from public.menu_versions v
    where v.venue_id = v_venue and v.status = 'draft' and v.scheduled_for is not null and v.id <> p_version_id
  ) then
    raise exception 'menu_schedule_exists' using errcode = 'P0001';
  end if;

  update public.menu_versions v
  set scheduled_for = p_at, scheduled_by = v_uid,
      scheduled_revision = v_version.revision, scheduled_retirements = v_count,
      scheduled_retired_items = private.menu_retired_set(p_version_id)
  where v.id = p_version_id;

  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (v_venue, p_version_id, v_uid, 'scheduled', jsonb_build_object(
    'scheduledFor', p_at, 'revision', v_version.revision, 'retirements', v_count));

  return jsonb_build_object('versionId', p_version_id, 'scheduledFor', p_at, 'retirements', v_count);
end;
$$;

-- Body as in 20261118103000, except that 'retirements_changed' compares the
-- confirmed set (when stored) as well as the count.
create or replace function private.menu_promote_due(p_venue_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_version public.menu_versions;
  v_reason text;
  v_done integer := 0;
begin
  if not exists (
    select 1 from public.menu_versions v
    where v.venue_id = p_venue_id and v.status = 'draft'
      and v.scheduled_for is not null and v.scheduled_for <= now()
  ) then
    return 0;
  end if;
  perform private.lock_venue_menu(p_venue_id);

  for v_version in
    select v.* from public.menu_versions v
    where v.venue_id = p_venue_id and v.status = 'draft'
      and v.scheduled_for is not null and v.scheduled_for <= now()
    order by v.scheduled_for, v.id
    for update
  loop
    v_reason := case
      when v_version.revision <> v_version.scheduled_revision then 'draft_changed'
      when exists (select 1 from public.menu_entries e where e.version_id = v_version.id and e.needs_review)
        then 'review_pending'
      when not exists (select 1 from public.menu_entries e where e.version_id = v_version.id) then 'empty'
      when private.menu_retired_count(v_version.id) <> v_version.scheduled_retirements then 'retirements_changed'
      when v_version.scheduled_retired_items is not null
        and private.menu_retired_set(v_version.id) is distinct from v_version.scheduled_retired_items
        then 'retirements_changed'
      when not exists (
        select 1 from public.profiles p
        where p.id = v_version.scheduled_by and p.active and p.role = 'admin'
      ) then 'scheduler_inactive'
      when not exists (select 1 from public.venues x where x.id = p_venue_id and x.active) then 'venue_inactive'
    end;

    if v_reason is not null then
      update public.menu_versions v
      set scheduled_for = null, scheduled_by = null, scheduled_revision = null, scheduled_retirements = null
      where v.id = v_version.id;
      insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
      values (p_venue_id, v_version.id, v_version.scheduled_by, 'schedule_lapsed',
        jsonb_build_object('reason', v_reason, 'scheduledFor', v_version.scheduled_for));
    else
      perform private.menu_activate_locked(v_version.id, p_venue_id, v_version.scheduled_by,
        jsonb_build_object('scheduledFor', v_version.scheduled_for,
          'retirements', v_version.scheduled_retirements));
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- R15: the legacy activation cannot skip the retirement confirmation
-- ---------------------------------------------------------------------------

-- Kept for compatibility (same signature and grants). It is now
-- activate_menu_version_confirmed with no retirements confirmed: a draft that
-- would retire items is refused with menu_retirements_unconfirmed (AC28).
create or replace function public.activate_menu_version(
  p_version_id uuid,
  p_expected_revision integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.activate_menu_version_confirmed(p_version_id, p_expected_revision, null);
end;
$$;
