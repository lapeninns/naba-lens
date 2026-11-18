-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-MENUS (spec §4.3, §7 M5, §8 A3, §11; AC27, AC28):
-- scheduled menu activation, explicit confirmation of retirements, and the
-- manager's read of the active and future menus.
--
--   Schedule   A reviewed draft can be activated now or scheduled for a
--              future instant (public.schedule_menu_version, admin). The
--              draft stays a draft: until it becomes active it changes
--              nothing in the current menu, coverage or labelling (AC27).
--              Saving a scheduled draft clears its schedule (the admin
--              confirmed one exact revision). One scheduled draft per venue.
--   Promotion  public.menu_activate_due (the venue's manager or an admin, on
--              page load) and public.menu_activate_due_all (service role,
--              the cron route) activate every due schedule under the venue
--              lock, with the scheduling admin as the actor. A schedule
--              whose draft or retirements changed since it was confirmed
--              lapses instead (event schedule_lapsed) and nothing changes.
--   Retire     Activating a draft that drops items of the current menu needs
--              the admin to confirm how many items retire
--              (public.activate_menu_version_confirmed; p_retirements must
--              equal the real count, else menu_retirements_unconfirmed).
--              public.menu_version_activation_impact lists them first.
--   Reads      public.menu_versions_for_venue: the venue's manager or an
--              admin sees the active menu and scheduled drafts, and with
--              p_include_archived the retired ones too (spec §4.1 archive
--              filter).
--
-- Activation itself (status flip, retiring the previous version, the photo
-- reconciliation trigger) is unchanged; the existing activate_menu_version
-- stays for compatibility. Nothing here changes coverage or credit rules.
--
-- Rollback: revoke execute on the public functions below; drop the trigger
-- menu_versions_schedule_cleared. Columns stay (nullable, unused).

-- ---------------------------------------------------------------------------
-- Columns and audit actions
-- ---------------------------------------------------------------------------

alter table public.menu_versions
  add column scheduled_for timestamptz,
  add column scheduled_by uuid references public.profiles (id) on delete restrict,
  add column scheduled_revision integer check (scheduled_revision is null or scheduled_revision >= 1),
  add column scheduled_retirements integer check (scheduled_retirements is null or scheduled_retirements >= 0),
  add constraint menu_versions_schedule_complete check (
    (scheduled_for is null) = (scheduled_by is null)
    and (scheduled_for is null) = (scheduled_revision is null)
    and (scheduled_for is null) = (scheduled_retirements is null)
  );

comment on column public.menu_versions.scheduled_for is
  'S1-MENUS: when a confirmed draft becomes active. Kept on the version after promotion as its record.';

-- One scheduled draft per venue.
create unique index menu_versions_one_scheduled_per_venue
  on public.menu_versions (venue_id) where status = 'draft' and scheduled_for is not null;
create index menu_versions_due_idx
  on public.menu_versions (scheduled_for) where status = 'draft' and scheduled_for is not null;

-- menu_events is the venue's one menu audit trail; the S1-MENUS actions are
-- added here (this file and 20261118103100..103300).
alter table public.menu_events drop constraint menu_events_action_check;
alter table public.menu_events add constraint menu_events_action_check check (action in (
  'draft_created', 'draft_saved', 'activated', 'retired', 'discarded',
  'item_archived', 'item_unarchived', 'suggestion_resolved', 'suggestion_dismissed',
  'scheduled', 'schedule_cleared', 'schedule_lapsed',
  'availability_set', 'availability_cleared', 'display_name_set', 'display_name_cleared',
  'presentation_changed',
  'special_created', 'special_suggested', 'special_accepted', 'special_declined',
  'special_extended', 'special_ended',
  'change_requested', 'change_request_decided'
));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Items on the venue's active version that the given draft does not carry:
-- what activating it would retire from current coverage.
create function private.menu_retired_items(p_version_id uuid)
returns table (item_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.item_id, e.name
  from public.menu_versions d
  join public.menu_versions a on a.venue_id = d.venue_id and a.status = 'active' and a.id <> d.id
  join public.menu_entries e on e.version_id = a.id
  where d.id = p_version_id
    and not exists (
      select 1 from public.menu_entries x where x.version_id = d.id and x.item_id = e.item_id
    )
  order by lower(e.name), e.item_id;
$$;

create function private.menu_retired_count(p_version_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from private.menu_retired_items(p_version_id);
$$;

-- The checks every activation path shares. Caller holds the venue lock and
-- has the version row locked.
create function private.assert_menu_activatable(p_version public.menu_versions, p_expected_revision integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_version.status <> 'draft' then
    raise exception 'menu_version_not_draft' using errcode = 'P0001';
  end if;
  if p_expected_revision is distinct from p_version.revision then
    raise exception 'menu_version_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', p_version.revision)::text;
  end if;
  if exists (select 1 from public.menu_entries e where e.version_id = p_version.id and e.needs_review) then
    raise exception 'menu_review_pending' using errcode = 'P0001',
      detail = 'Resolve every uncertain match before activating.';
  end if;
  if not exists (select 1 from public.menu_entries e where e.version_id = p_version.id) then
    raise exception 'menu_empty' using errcode = 'P0001';
  end if;
end;
$$;

-- Retirements must be confirmed with their exact count when there are any.
create function private.assert_menu_retirements(p_version_id uuid, p_confirmed integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer := private.menu_retired_count(p_version_id);
begin
  if v_count > 0 and p_confirmed is distinct from v_count then
    raise exception 'menu_retirements_unconfirmed' using errcode = 'P0001',
      detail = jsonb_build_object('retirements', v_count)::text;
  end if;
  return v_count;
end;
$$;

-- Flip a checked draft to active as p_actor, retiring the previous version,
-- exactly as activate_menu_version does. Caller holds the venue lock.
create function private.menu_activate_locked(
  p_version_id uuid, p_venue_id uuid, p_actor uuid, p_detail jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_revision integer;
begin
  select v.id into v_previous
  from public.menu_versions v
  where v.venue_id = p_venue_id and v.status = 'active'
  for update;

  if v_previous is not null then
    update public.menu_versions v
    set status = 'retired', retired_by = p_actor, retired_at = now()
    where v.id = v_previous;
    insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
    values (p_venue_id, v_previous, p_actor, 'retired', jsonb_build_object('replacedBy', p_version_id));
  end if;

  update public.menu_versions v
  set status = 'active',
      reviewed_by = p_actor, reviewed_at = now(),
      activated_by = p_actor, activated_at = now()
  where v.id = p_version_id
  returning v.revision into v_revision;

  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (p_venue_id, p_version_id, p_actor, 'activated', jsonb_build_object(
    'revision', v_revision, 'replaced', v_previous) || coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- Saving a scheduled draft changes what was confirmed: the schedule is
-- cleared and recorded. Runs inside save_menu_draft (owner) only, since no
-- role may update menu_versions directly.
create function private.menu_versions_schedule_cleared()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'draft'
     and old.scheduled_for is not null
     and new.revision is distinct from old.revision
     and new.scheduled_for is not distinct from old.scheduled_for then
    new.scheduled_for := null;
    new.scheduled_by := null;
    new.scheduled_revision := null;
    new.scheduled_retirements := null;
    insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
    values (old.venue_id, old.id, (select auth.uid()), 'schedule_cleared',
      jsonb_build_object('reason', 'draft_changed', 'scheduledFor', old.scheduled_for));
  end if;
  return new;
end;
$$;

create trigger menu_versions_schedule_cleared
  before update on public.menu_versions
  for each row execute function private.menu_versions_schedule_cleared();

-- ---------------------------------------------------------------------------
-- Admin writes
-- ---------------------------------------------------------------------------

-- activate_menu_version with the retirement count confirmed (AC28).
create function public.activate_menu_version_confirmed(
  p_version_id uuid,
  p_expected_revision integer,
  p_retirements integer
)
returns void
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
  perform private.lock_venue_menu(v_venue);
  select v.* into v_version from public.menu_versions v where v.id = p_version_id for update;
  perform private.assert_menu_activatable(v_version, p_expected_revision);
  v_count := private.assert_menu_retirements(p_version_id, p_retirements);

  -- An activation now replaces any schedule on this draft.
  if v_version.scheduled_for is not null then
    update public.menu_versions v
    set scheduled_for = null, scheduled_by = null, scheduled_revision = null, scheduled_retirements = null
    where v.id = p_version_id;
  end if;
  perform private.menu_activate_locked(p_version_id, v_venue, v_uid,
    jsonb_build_object('retirements', v_count));
end;
$$;

-- Accept a draft to become active at p_at (a future instant, within a year).
create function public.schedule_menu_version(
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
      scheduled_revision = v_version.revision, scheduled_retirements = v_count
  where v.id = p_version_id;

  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (v_venue, p_version_id, v_uid, 'scheduled', jsonb_build_object(
    'scheduledFor', p_at, 'revision', v_version.revision, 'retirements', v_count));

  return jsonb_build_object('versionId', p_version_id, 'scheduledFor', p_at, 'retirements', v_count);
end;
$$;

create function public.unschedule_menu_version(p_version_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_venue uuid;
  v_version public.menu_versions;
begin
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_venue);
  select v.* into v_version from public.menu_versions v where v.id = p_version_id for update;
  if v_version.status <> 'draft' then
    raise exception 'menu_version_not_draft' using errcode = 'P0001';
  end if;
  if v_version.scheduled_for is null then
    return;
  end if;
  update public.menu_versions v
  set scheduled_for = null, scheduled_by = null, scheduled_revision = null, scheduled_retirements = null
  where v.id = p_version_id;
  insert into public.menu_events (venue_id, version_id, actor_id, action, detail)
  values (v_venue, p_version_id, v_uid, 'schedule_cleared',
    jsonb_build_object('reason', 'unscheduled', 'scheduledFor', v_version.scheduled_for));
end;
$$;

-- ---------------------------------------------------------------------------
-- Promotion of due schedules
-- ---------------------------------------------------------------------------

-- Promote (or lapse) every due schedule of one venue. Returns the number
-- activated. Takes the venue lock; safe to call repeatedly or concurrently.
create function private.menu_promote_due(p_venue_id uuid)
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

-- The venue's manager or an admin (screens call this before reading menus).
create function public.menu_activate_due(p_venue_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(p_venue_id);
  return private.menu_promote_due(p_venue_id);
end;
$$;

-- Cron (service role only): every venue with a due schedule.
create function public.menu_activate_due_all()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_done integer := 0;
begin
  for v_venue in
    select distinct v.venue_id from public.menu_versions v
    where v.status = 'draft' and v.scheduled_for is not null and v.scheduled_for <= now()
    order by v.venue_id
  loop
    v_done := v_done + private.menu_promote_due(v_venue);
  end loop;
  return v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- What activating this draft would retire (admin), for the confirm dialog.
create function public.menu_version_activation_impact(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
begin
  perform private.assert_active_admin();
  select v.venue_id into v_venue from public.menu_versions v where v.id = p_version_id;
  if v_venue is null then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'versionId', p_version_id,
    'retirements', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemId', r.item_id, 'name', r.name,
          'acceptedPhotos', (select count(*) from public.menu_item_photos p
            where p.item_id = r.item_id and p.state in ('accepted', 'needs_recheck'))::integer,
          'labelledPhotos', (select count(distinct l.asset_id) from public.media_label_items l
            where l.item_id = r.item_id)::integer)
        order by lower(r.name), r.item_id)
      from private.menu_retired_items(p_version_id) r
    ), '[]'::jsonb));
end;
$$;

-- Active menu, scheduled drafts and (with p_include_archived) retired ones,
-- for the venue's manager or an admin. Upcoming = items on a scheduled draft
-- that the active menu does not have.
create function public.menu_versions_for_venue(p_venue_id uuid, p_include_archived boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(p_venue_id);
  return jsonb_build_object('venueId', p_venue_id, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'versionId', v.id, 'title', v.title,
        'state', case when v.status = 'draft' then 'scheduled' else v.status end,
        'scheduledFor', v.scheduled_for, 'activatedAt', v.activated_at, 'retiredAt', v.retired_at,
        'sourceKind', v.source_kind, 'sourceLabel', v.source_label,
        'itemCount', (select count(*) from public.menu_entries e where e.version_id = v.id)::integer,
        'upcomingCount', case when v.status = 'draft' then (
          select count(*) from public.menu_entries e
          where e.version_id = v.id and not exists (
            select 1 from public.menu_versions a
            join public.menu_entries ae on ae.version_id = a.id and ae.item_id = e.item_id
            where a.venue_id = v.venue_id and a.status = 'active'))::integer end,
        'retiringCount', case when v.status = 'draft' then private.menu_retired_count(v.id) end)
      order by case v.status when 'draft' then 0 when 'active' then 1 else 2 end,
        coalesce(v.scheduled_for, v.activated_at) desc nulls last, v.id)
    from public.menu_versions v
    where v.venue_id = p_venue_id
      and (v.status = 'active'
        or (v.status = 'draft' and v.scheduled_for is not null)
        or (p_include_archived and v.status = 'retired'))
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_retired_items(uuid),
  private.menu_retired_count(uuid),
  private.assert_menu_activatable(public.menu_versions, integer),
  private.assert_menu_retirements(uuid, integer),
  private.menu_activate_locked(uuid, uuid, uuid, jsonb),
  private.menu_versions_schedule_cleared(),
  private.menu_promote_due(uuid)
from public, anon, authenticated;

revoke all on function
  public.activate_menu_version_confirmed(uuid, integer, integer),
  public.schedule_menu_version(uuid, integer, timestamptz, integer),
  public.unschedule_menu_version(uuid),
  public.menu_activate_due(uuid),
  public.menu_activate_due_all(),
  public.menu_version_activation_impact(uuid),
  public.menu_versions_for_venue(uuid, boolean)
from public, anon, service_role;

grant execute on function
  public.activate_menu_version_confirmed(uuid, integer, integer),
  public.schedule_menu_version(uuid, integer, timestamptz, integer),
  public.unschedule_menu_version(uuid),
  public.menu_activate_due(uuid),
  public.menu_version_activation_impact(uuid),
  public.menu_versions_for_venue(uuid, boolean)
to authenticated;

revoke all on function public.menu_activate_due_all() from authenticated;
grant execute on function public.menu_activate_due_all() to service_role;
