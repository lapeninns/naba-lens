-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-MENUS (spec §3.3, §4.3, §7 M5, §10 invariant 7, §11;
-- AC26): what a venue's manager changes about its own offerings without a
-- new menu version.
--
--   Availability   public.menu_item_availability_set: mark a dish on the
--                  active menu temporarily unavailable (optionally until a
--                  London date, with a reason), or available again. Nothing
--                  about its photo requirement, photos or history changes
--                  (AC26, invariant 7): the row only says "not on today".
--                  An until date in the past reads as available.
--   Display name   public.menu_item_display_name_set: a local display name
--                  for a dish, with a reason; null clears it. Audited.
--   Presentation   public.menu_item_presentation_changed: the dish's plating,
--                  portion, ingredients or sides changed. Its presentation
--                  revision goes up, and every accepted photo of it moves to
--                  needs_recheck (recheck_kind presentation_changed), as a
--                  material rename does on activation (spec §4.3, M5).
--   Specials       public.menu_special_create: a dated local special. A
--                  manager or admin creates it running; staff of the venue
--                  suggest one, which the manager accepts or declines
--                  (public.menu_special_decide). At its end date it reads as
--                  review_due until the manager ends or extends it
--                  (public.menu_special_review). A special has its own stable
--                  menu_items identity; ending it archives that item, which
--                  keeps every photo and label.
--   Reads          public.menu_offering_states (everyone at the venue):
--                  availability, display names and presentation revisions.
--                  public.menu_specials_list: staff see running specials and
--                  their own suggestions; managers and admins see all.
--
-- Audit: every change is a menu_events row (append-only). Managers act on
-- their own venue only; staff cannot change availability or names.
--
-- Rollback: revoke execute on the public functions below. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.menu_item_availability (
  item_id uuid primary key,
  venue_id uuid not null,
  until_on date,
  reason text not null check (length(reason) between 1 and 300 and reason = btrim(reason)),
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  constraint menu_item_availability_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict
);

create index menu_item_availability_venue_idx on public.menu_item_availability (venue_id);

comment on table public.menu_item_availability is
  'S1-MENUS: a dish that is temporarily unavailable. Never changes its photo requirement or history (AC26).';

create table public.menu_item_display_names (
  item_id uuid primary key,
  venue_id uuid not null,
  display_name text not null check (length(display_name) between 1 and 120 and display_name = btrim(display_name)),
  reason text not null check (length(reason) between 1 and 300 and reason = btrim(reason)),
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  constraint menu_item_display_names_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict
);

create index menu_item_display_names_venue_idx on public.menu_item_display_names (venue_id);

comment on table public.menu_item_display_names is
  'S1-MENUS: the venue''s audited local display name for a dish (spec §7 M5).';

create table public.menu_item_presentations (
  item_id uuid primary key,
  venue_id uuid not null,
  revision integer not null check (revision >= 2),
  note text not null check (length(note) between 1 and 300 and note = btrim(note)),
  changed_by uuid not null references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint menu_item_presentations_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict
);

create index menu_item_presentations_venue_idx on public.menu_item_presentations (venue_id);

comment on table public.menu_item_presentations is
  'S1-MENUS: presentation revision of a dish (spec §11 venue offering). A missing row reads as revision 1.';

create table public.menu_specials (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  item_id uuid not null,
  name text not null check (length(name) between 1 and 120 and name = btrim(name)),
  description text check (description is null or (length(description) between 1 and 600 and description = btrim(description))),
  kind text not null check (kind in ('food', 'drinks')),
  starts_on date not null,
  ends_on date not null,
  status text not null check (status in ('suggested', 'running', 'declined', 'ended')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or (length(decision_reason) between 1 and 300 and decision_reason = btrim(decision_reason))),
  ended_by uuid references public.profiles (id) on delete restrict,
  ended_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  constraint menu_specials_item_key unique (item_id),
  constraint menu_specials_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_specials_dates check (ends_on >= starts_on),
  constraint menu_specials_ended check ((status = 'ended') = (ended_at is not null) and (ended_at is null) = (ended_by is null)),
  constraint menu_specials_declined_reason check (status <> 'declined' or decision_reason is not null)
);

create index menu_specials_venue_idx on public.menu_specials (venue_id, status, ends_on);

comment on table public.menu_specials is
  'S1-MENUS: dated local specials (spec §4.3). Ending one archives its item; photos and labels stay.';

alter table public.menu_item_availability enable row level security;
alter table public.menu_item_display_names enable row level security;
alter table public.menu_item_presentations enable row level security;
alter table public.menu_specials enable row level security;
revoke all on table public.menu_item_availability, public.menu_item_display_names,
  public.menu_item_presentations, public.menu_specials
from public, anon, authenticated, service_role;
grant select on table public.menu_item_availability, public.menu_item_display_names,
  public.menu_item_presentations, public.menu_specials
to service_role;

-- A material presentation change is a recheck reason of its own.
alter table public.menu_item_photos drop constraint menu_item_photos_recheck_kind_check;
alter table public.menu_item_photos add constraint menu_item_photos_recheck_kind_check
  check (recheck_kind in ('name_changed', 'section_changed', 'variant_removed', 'presentation_changed'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The venue of a dish the caller may manage, locked for a menu write. The
-- dish must be on the venue's active menu, or be a running special.
create function private.menu_manage_item(p_item_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
begin
  perform private.amenity_assert_active_user();
  select i.venue_id into v_venue from public.menu_items i where i.id = p_item_id;
  if v_venue is null then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_can_manage_venue(v_venue);
  perform private.amenity_assert_venue_active(v_venue);
  perform private.lock_venue_menu(v_venue);
  if not exists (
    select 1 from public.menu_items i
    join public.menu_entries e on e.item_id = i.id
    join public.menu_versions v on v.id = e.version_id and v.status = 'active'
    where i.id = p_item_id and i.archived_at is null
  ) and not exists (
    select 1 from public.menu_specials s where s.item_id = p_item_id and s.status = 'running'
  ) then
    raise exception 'menu_item_unavailable' using errcode = 'P0001';
  end if;
  return v_venue;
end;
$$;

-- Required reason: 1 to 300 characters after trimming.
create function private.menu_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_reason), '');
begin
  if v is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if length(v) > 300 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Effective special state on a London day.
create function private.menu_special_state(p_status text, p_starts_on date, p_ends_on date, p_today date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status <> 'running' then p_status
    when p_ends_on < p_today then 'review_due'
    when p_starts_on > p_today then 'upcoming'
    else 'running'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Writes: availability, display name, presentation
-- ---------------------------------------------------------------------------

-- p_available false needs a reason; p_until (optional) is a London date from
-- today on. Repeating the same state changes nothing and writes no event.
create function public.menu_item_availability_set(
  p_item_id uuid, p_available boolean, p_until date default null, p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_reason text;
  v_old public.menu_item_availability;
begin
  if p_available is null then
    raise exception 'invalid_availability' using errcode = '22023';
  end if;
  v_venue := private.menu_manage_item(p_item_id);
  select a.* into v_old from public.menu_item_availability a where a.item_id = p_item_id for update;

  if p_available then
    if v_old.item_id is null then
      return jsonb_build_object('itemId', p_item_id, 'available', true, 'changed', false);
    end if;
    delete from public.menu_item_availability a where a.item_id = p_item_id;
    insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
    values (v_venue, p_item_id, v_uid, 'availability_cleared',
      jsonb_build_object('previousReason', v_old.reason, 'previousUntil', v_old.until_on));
    return jsonb_build_object('itemId', p_item_id, 'available', true, 'changed', true);
  end if;

  v_reason := private.menu_reason(p_reason);
  if p_until is not null and (p_until < private.london_today() or p_until > private.london_today() + 366) then
    raise exception 'invalid_until' using errcode = '22023';
  end if;
  if v_old.item_id is not null and v_old.reason = v_reason and v_old.until_on is not distinct from p_until then
    return jsonb_build_object('itemId', p_item_id, 'available', false, 'until', p_until, 'changed', false);
  end if;

  insert into public.menu_item_availability (item_id, venue_id, until_on, reason, set_by)
  values (p_item_id, v_venue, p_until, v_reason, v_uid)
  on conflict (item_id) do update
    set until_on = excluded.until_on, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v_venue, p_item_id, v_uid, 'availability_set',
    jsonb_build_object('until', p_until, 'reason', v_reason));
  return jsonb_build_object('itemId', p_item_id, 'available', false, 'until', p_until, 'changed', true);
end;
$$;

-- p_name null or blank clears the override (no reason needed to clear).
create function public.menu_item_display_name_set(p_item_id uuid, p_name text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_name text;
  v_reason text;
  v_old public.menu_item_display_names;
begin
  v_venue := private.menu_manage_item(p_item_id);
  v_name := private.clean_text(p_name, 120, 'invalid_display_name');
  if v_name is not null and v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  select d.* into v_old from public.menu_item_display_names d where d.item_id = p_item_id for update;

  if v_name is null then
    if v_old.item_id is null then
      return jsonb_build_object('itemId', p_item_id, 'displayName', null, 'changed', false);
    end if;
    delete from public.menu_item_display_names d where d.item_id = p_item_id;
    insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
    values (v_venue, p_item_id, v_uid, 'display_name_cleared',
      jsonb_build_object('previous', v_old.display_name, 'reason', private.clean_text(p_reason, 300, 'reason_too_long')));
    return jsonb_build_object('itemId', p_item_id, 'displayName', null, 'changed', true);
  end if;

  v_reason := private.menu_reason(p_reason);
  if v_old.display_name is not distinct from v_name then
    return jsonb_build_object('itemId', p_item_id, 'displayName', v_name, 'changed', false);
  end if;
  insert into public.menu_item_display_names (item_id, venue_id, display_name, reason, set_by)
  values (p_item_id, v_venue, v_name, v_reason, v_uid)
  on conflict (item_id) do update
    set display_name = excluded.display_name, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v_venue, p_item_id, v_uid, 'display_name_set',
    jsonb_build_object('previous', v_old.display_name, 'displayName', v_name, 'reason', v_reason));
  return jsonb_build_object('itemId', p_item_id, 'displayName', v_name, 'changed', true);
end;
$$;

-- Bumps the presentation revision and sends accepted photos to recheck.
-- Returns the new revision and how many photos need a recheck.
create function public.menu_item_presentation_changed(p_item_id uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_note text;
  v_revision integer;
  v_row record;
  v_lost boolean := false;
  v_count integer := 0;
begin
  v_venue := private.menu_manage_item(p_item_id);
  v_note := private.menu_reason(p_note);

  insert into public.menu_item_presentations as p (item_id, venue_id, revision, note, changed_by)
  values (p_item_id, v_venue, 2, v_note, v_uid)
  on conflict (item_id) do update
    set revision = p.revision + 1, note = excluded.note, changed_by = excluded.changed_by, changed_at = now()
  returning revision into v_revision;

  -- Any reviewer holding the old head now gets coverage_conflict.
  perform private.bump_item_photo_heads(array[p_item_id], v_venue);

  for v_row in
    select p.id, p.is_primary from public.menu_item_photos p
    where p.item_id = p_item_id and p.state = 'accepted'
    order by p.id
    for update of p
  loop
    if v_row.is_primary then
      v_lost := true;
    end if;
    update public.menu_item_photos p
    set state = 'needs_recheck', recheck_kind = 'presentation_changed', is_primary = false,
        revision = p.revision + 1
    where p.id = v_row.id;
    perform private.record_item_photo_event(v_row.id, 'needs_recheck', 'accepted', v_note, false, null, null,
      jsonb_build_object('kind', 'presentation_changed', 'presentationRevision', v_revision));
    v_count := v_count + 1;
  end loop;
  if v_lost then
    perform private.promote_item_primary(p_item_id, private.coverage_actor_role(v_venue));
  end if;

  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v_venue, p_item_id, v_uid, 'presentation_changed',
    jsonb_build_object('revision', v_revision, 'note', v_note, 'photosToRecheck', v_count));
  return jsonb_build_object('itemId', p_item_id, 'presentationRevision', v_revision, 'photosToRecheck', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes: specials
-- ---------------------------------------------------------------------------

-- Staff of the venue suggest; its manager or an admin creates it running.
create function public.menu_special_create(
  p_venue_id uuid, p_name text, p_description text, p_kind text, p_starts_on date, p_ends_on date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_manage boolean;
  v_name text;
  v_description text;
  v_item uuid;
  v_id uuid;
  v_status text;
begin
  if p_venue_id is null then
    raise exception 'venue_required' using errcode = '22023';
  end if;
  v_manage := private.can_manage_venue(p_venue_id);
  if not v_manage and private.active_staff_venue_id() is distinct from p_venue_id then
    raise exception 'not_venue_member' using errcode = '42501';
  end if;
  perform private.amenity_assert_venue_active(p_venue_id);
  v_name := private.clean_text(p_name, 120, 'invalid_name');
  v_description := private.clean_text(p_description, 600, 'invalid_description');
  if v_name is null or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('food', 'drinks') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or p_ends_on < private.london_today() or p_ends_on > private.london_today() + 366 then
    raise exception 'invalid_dates' using errcode = '22023';
  end if;
  v_status := case when v_manage then 'running' else 'suggested' end;

  perform private.lock_venue_menu(p_venue_id);
  insert into public.menu_items (venue_id, created_by) values (p_venue_id, v_uid) returning id into v_item;
  insert into public.menu_specials (venue_id, item_id, name, description, kind, starts_on, ends_on, status,
    created_by, decided_by, decided_at)
  values (p_venue_id, v_item, v_name, v_description, p_kind, p_starts_on, p_ends_on, v_status,
    v_uid, case when v_manage then v_uid end, case when v_manage then now() end)
  returning id into v_id;

  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (p_venue_id, v_item, v_uid, case when v_manage then 'special_created' else 'special_suggested' end,
    jsonb_build_object('specialId', v_id, 'name', v_name, 'kind', p_kind,
      'startsOn', p_starts_on, 'endsOn', p_ends_on));
  return jsonb_build_object('specialId', v_id, 'itemId', v_item, 'status', v_status, 'revision', 1);
end;
$$;

-- Lock a special the caller manages; checks its revision.
create function private.menu_special_for_write(p_special_id uuid, p_revision integer)
returns public.menu_specials
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.menu_specials;
begin
  perform private.amenity_assert_active_user();
  select s.* into v from public.menu_specials s where s.id = p_special_id;
  if v.id is null then
    raise exception 'menu_special_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_can_manage_venue(v.venue_id);
  perform private.lock_venue_menu(v.venue_id);
  select s.* into v from public.menu_specials s where s.id = p_special_id for update;
  if p_revision is distinct from v.revision then
    raise exception 'menu_special_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v.revision)::text;
  end if;
  return v;
end;
$$;

-- Accept (running) or decline (reason required) a staff suggestion.
create function public.menu_special_decide(p_special_id uuid, p_accept boolean, p_reason text, p_revision integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.menu_specials;
  v_reason text;
begin
  if p_accept is null then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  v := private.menu_special_for_write(p_special_id, p_revision);
  if v.status <> 'suggested' then
    raise exception 'menu_special_not_suggested' using errcode = 'P0001';
  end if;
  v_reason := case when p_accept then private.clean_text(p_reason, 300, 'reason_too_long')
                   else private.menu_reason(p_reason) end;
  if p_accept and v.ends_on < private.london_today() then
    raise exception 'invalid_dates' using errcode = '22023';
  end if;

  update public.menu_specials s
  set status = case when p_accept then 'running' else 'declined' end,
      decided_by = v_uid, decided_at = now(), decision_reason = v_reason, revision = s.revision + 1
  where s.id = v.id;
  if not p_accept then
    update public.menu_items i set archived_at = now(), archived_by = v_uid where i.id = v.item_id;
  end if;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v.venue_id, v.item_id, v_uid, case when p_accept then 'special_accepted' else 'special_declined' end,
    jsonb_build_object('specialId', v.id, 'reason', v_reason));
  return jsonb_build_object('specialId', v.id,
    'status', case when p_accept then 'running' else 'declined' end, 'revision', v.revision + 1);
end;
$$;

-- At or after its end date: end it, or extend it to a new end date.
create function public.menu_special_review(
  p_special_id uuid, p_action text, p_ends_on date, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.menu_specials;
  v_reason text;
begin
  if p_action is null or p_action not in ('end', 'extend') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  v := private.menu_special_for_write(p_special_id, p_revision);
  if v.status <> 'running' then
    raise exception 'menu_special_not_running' using errcode = 'P0001';
  end if;
  v_reason := private.clean_text(p_reason, 300, 'reason_too_long');

  if p_action = 'extend' then
    if p_ends_on is null or p_ends_on < private.london_today() or p_ends_on < v.starts_on
       or p_ends_on > private.london_today() + 366 then
      raise exception 'invalid_dates' using errcode = '22023';
    end if;
    update public.menu_specials s set ends_on = p_ends_on, revision = s.revision + 1 where s.id = v.id;
    insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
    values (v.venue_id, v.item_id, v_uid, 'special_extended',
      jsonb_build_object('specialId', v.id, 'from', v.ends_on, 'to', p_ends_on, 'reason', v_reason));
    return jsonb_build_object('specialId', v.id, 'status', 'running', 'endsOn', p_ends_on, 'revision', v.revision + 1);
  end if;

  update public.menu_specials s
  set status = 'ended', ended_by = v_uid, ended_at = now(), revision = s.revision + 1
  where s.id = v.id;
  -- Archiving stops new labels; photos, labels and decisions all stay.
  update public.menu_items i set archived_at = now(), archived_by = v_uid
  where i.id = v.item_id and i.archived_at is null;
  delete from public.menu_item_availability a where a.item_id = v.item_id;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v.venue_id, v.item_id, v_uid, 'special_ended',
    jsonb_build_object('specialId', v.id, 'endsOn', v.ends_on, 'reason', v_reason));
  return jsonb_build_object('specialId', v.id, 'status', 'ended', 'revision', v.revision + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Availability, local names and presentation revisions of the venue's dishes.
-- Everyone at the venue (staff draw "Not on today" and the local name).
create function public.menu_offering_states(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
  v_today date := private.london_today();
begin
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'itemId', i.id,
        'available', a.item_id is null or (a.until_on is not null and a.until_on < v_today),
        'unavailableUntil', case when a.until_on >= v_today then a.until_on end,
        'unavailableReason', case when a.item_id is not null and (a.until_on is null or a.until_on >= v_today)
          then a.reason end,
        'displayName', d.display_name,
        'presentationRevision', coalesce(p.revision, 1))
      order by i.id)
    from public.menu_items i
    left join public.menu_item_availability a on a.item_id = i.id
    left join public.menu_item_display_names d on d.item_id = i.id
    left join public.menu_item_presentations p on p.item_id = i.id
    where i.venue_id = v_venue
      and (a.item_id is not null or d.item_id is not null or p.item_id is not null)
  ), '[]'::jsonb));
end;
$$;

-- Specials with their effective state on today's London date:
-- suggested | upcoming | running | review_due | declined | ended.
-- Staff: upcoming/running/review_due ones and their own suggestions.
-- Manager/admin: all; ended and declined only with p_include_archived.
create function public.menu_specials_list(p_venue_id uuid default null, p_include_archived boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
  v_manage boolean := private.can_manage_venue(v_venue);
  v_uid uuid := auth.uid();
  v_today date := private.london_today();
begin
  return jsonb_build_object('venueId', v_venue, 'today', v_today, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'specialId', s.id, 'itemId', s.item_id, 'name', s.name, 'description', s.description,
        'kind', s.kind, 'startsOn', s.starts_on, 'endsOn', s.ends_on,
        'state', private.menu_special_state(s.status, s.starts_on, s.ends_on, v_today),
        'mine', s.created_by = v_uid,
        'decisionReason', case when v_manage or s.created_by = v_uid then s.decision_reason end,
        'revision', s.revision)
      order by case private.menu_special_state(s.status, s.starts_on, s.ends_on, v_today)
          when 'review_due' then 0 when 'suggested' then 1 when 'running' then 2
          when 'upcoming' then 3 else 4 end,
        s.ends_on, s.id)
    from public.menu_specials s
    where s.venue_id = v_venue
      and (
        (v_manage and (p_include_archived or s.status in ('suggested', 'running')))
        or (not v_manage and (s.status = 'running'
          or (s.created_by = v_uid and (p_include_archived or s.status = 'suggested'))))
      )
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_manage_item(uuid),
  private.menu_reason(text),
  private.menu_special_state(text, date, date, date),
  private.menu_special_for_write(uuid, integer)
from public, anon, authenticated;

revoke all on function
  public.menu_item_availability_set(uuid, boolean, date, text),
  public.menu_item_display_name_set(uuid, text, text),
  public.menu_item_presentation_changed(uuid, text),
  public.menu_special_create(uuid, text, text, text, date, date),
  public.menu_special_decide(uuid, boolean, text, integer),
  public.menu_special_review(uuid, text, date, text, integer),
  public.menu_offering_states(uuid),
  public.menu_specials_list(uuid, boolean)
from public, anon, service_role;

grant execute on function
  public.menu_item_availability_set(uuid, boolean, date, text),
  public.menu_item_display_name_set(uuid, text, text),
  public.menu_item_presentation_changed(uuid, text),
  public.menu_special_create(uuid, text, text, text, date, date),
  public.menu_special_decide(uuid, boolean, text, integer),
  public.menu_special_review(uuid, text, date, text, integer),
  public.menu_offering_states(uuid),
  public.menu_specials_list(uuid, boolean)
to authenticated;
