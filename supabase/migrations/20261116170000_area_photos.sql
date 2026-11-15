-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- G-9 (docs/plans/goals-not-tasks.md, phase 3; decided 15 Nov 2026): month
-- credit for labelled venue areas. A still image that is not a dish or a
-- drink (the bar set-up, the garden, the toilets) counts toward its
-- uploader's month when the uploader labels it with one of the venue's places
-- and a reviewer accepts it.
--
--   Areas      the venue's places from B03 venue knowledge
--              (public.knowledge_subjects: entrances, routes, areas, rooms and
--              facility points). No second list: a manager adds and retires
--              places where they already do.
--   Labels     public.media_area_labels: one live area per photo, added by
--              the photo's uploader only (staff accounts). Removing or
--              changing it closes the row (removed_at); rows are never
--              deleted or edited otherwise.
--   Review     public.area_photo_decisions, append-only. The latest row per
--              label is its state: accepted, needs_another_photo (a reason is
--              required) or withdrawn (a reason is required; final). A venue
--              manager (manager account or legacy grant) or an admin decides;
--              nobody decides on a photo they uploaded or labelled. These are
--              new tables, so deny_manager_coverage_writes is untouched:
--              manager accounts still write no coverage table.
--   Credit     read-through, in the ORP style. private.monthly_credit_items
--              gains a third source: an accepted area label the uploader
--              added on a ready still image counts for the London month its
--              upload started, unless the photo is already credited through a
--              send or a dish label (one credit per photo).
--              private.month_photo_states gains the area photo's
--              needs_another_photo and waiting states, and my_month_photos
--              names the area. coverage_staff_progress (v1 and v2) read both
--              functions, so their counts follow without being re-created.
--
-- Not here: retake notes for area photos (G-3's my_retake_notes reads menu
-- notes and coverage requests only); a needs-another-photo area decision
-- stays on the photo until a reviewer accepts it or the uploader removes the
-- area.
--
-- Rollback: re-apply private.monthly_credit_items from 20261115140000 and
-- private.month_photo_states and public.my_month_photos from 20261116110000,
-- then revoke execute on the four new public functions below. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.media_area_labels (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  venue_id uuid not null,
  subject_id uuid not null,
  -- Snapshot of the place as the labeller saw it.
  subject_kind text not null check (subject_kind in ('entrance', 'route', 'area', 'room', 'facility_point')),
  subject_label text not null check (length(subject_label) between 1 and 80),
  added_by uuid not null references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete restrict,
  removed_at timestamptz,
  constraint media_area_labels_removed_pair check ((removed_at is null) = (removed_by is null)),
  constraint media_area_labels_id_venue_key unique (id, venue_id),
  -- The photo, the place and the label belong to one venue: the photo's
  -- upload-time venue.
  constraint media_area_labels_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_area_labels_subject_fkey foreign key (subject_id, venue_id)
    references public.knowledge_subjects (id, venue_id) on delete restrict
);

create unique index media_area_labels_one_live
  on public.media_area_labels (asset_id) where removed_at is null;
create index media_area_labels_venue_idx
  on public.media_area_labels (venue_id, added_at) where removed_at is null;
create index media_area_labels_added_by_idx on public.media_area_labels (added_by);

comment on table public.media_area_labels is
  'G-9: the venue place (area) an uploader labelled a photo with. One live row per photo; closed, never deleted.';

create table public.area_photo_decisions (
  id bigint generated always as identity primary key,
  label_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  action text not null check (action in ('accepted', 'needs_another_photo', 'withdrawn')),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint area_photo_decisions_reason check (action = 'accepted' or reason is not null),
  constraint area_photo_decisions_label_fkey foreign key (label_id, venue_id)
    references public.media_area_labels (id, venue_id) on delete restrict
);

create index area_photo_decisions_label_idx
  on public.area_photo_decisions (label_id, id desc);
create index area_photo_decisions_venue_idx on public.area_photo_decisions (venue_id, decided_at);

comment on table public.area_photo_decisions is
  'G-9: append-only review of area-labelled photos. The latest row per label is its state.';

-- Labels: only the close columns change, once.
create function private.media_area_labels_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or old.removed_at is not null
     or new.removed_at is null
     or new.id is distinct from old.id or new.asset_id is distinct from old.asset_id
     or new.venue_id is distinct from old.venue_id or new.subject_id is distinct from old.subject_id
     or new.subject_kind is distinct from old.subject_kind or new.subject_label is distinct from old.subject_label
     or new.added_by is distinct from old.added_by or new.added_at is distinct from old.added_at then
    raise exception 'media_area_label_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger media_area_labels_guard
  before update or delete on public.media_area_labels
  for each row execute function private.media_area_labels_guard();
create trigger media_area_labels_no_truncate
  before truncate on public.media_area_labels
  for each statement execute function private.append_only_guard();
create trigger area_photo_decisions_append_only
  before update or delete on public.area_photo_decisions
  for each row execute function private.append_only_guard();
create trigger area_photo_decisions_no_truncate
  before truncate on public.area_photo_decisions
  for each statement execute function private.append_only_guard();

-- Reads and writes go through the functions below only.
alter table public.media_area_labels enable row level security;
alter table public.area_photo_decisions enable row level security;
-- service_role too: the default privileges would leave it INSERT.
revoke all on table public.media_area_labels, public.area_photo_decisions from public, anon, authenticated, service_role;
grant select on table public.media_area_labels, public.area_photo_decisions to service_role;

-- ---------------------------------------------------------------------------
-- Current state
-- ---------------------------------------------------------------------------

-- The latest decision on a label, or nothing while it waits.
create function private.area_photo_latest(p_label_id uuid)
returns table (action text, reason text, decided_by uuid, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.action, d.reason, d.decided_by, d.decided_at
  from public.area_photo_decisions d
  where d.label_id = p_label_id
  order by d.id desc
  limit 1;
$$;

-- Live area labels that can earn credit: added by the photo's uploader, on a
-- still image. Readiness and deletion are left to each reader.
create function private.area_photo_rows(p_venue_id uuid default null, p_author_id uuid default null)
returns table (
  label_id uuid,
  asset_id uuid,
  venue_id uuid,
  author_id uuid,
  subject_id uuid,
  subject_kind text,
  subject_label text,
  labelled_at timestamptz,
  uploaded_at timestamptz,
  ready boolean,
  deleted_at timestamptz,
  state text,
  reason text,
  decided_by uuid,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.asset_id, l.venue_id, a.uploader_id, l.subject_id, l.subject_kind, l.subject_label,
    l.added_at, a.created_at, a.upload_state = 'ready', a.deleted_at,
    coalesce(d.action, 'pending'), d.reason, d.decided_by, d.decided_at
  from public.media_area_labels l
  join public.media_assets a on a.id = l.asset_id and a.venue_id = l.venue_id
  left join lateral private.area_photo_latest(l.id) d on true
  where l.removed_at is null
    and l.added_by = a.uploader_id
    and a.media_type = 'image'
    and (p_venue_id is null or l.venue_id = p_venue_id)
    and (p_author_id is null or a.uploader_id = p_author_id);
$$;

-- ---------------------------------------------------------------------------
-- Labelling (the uploader)
-- ---------------------------------------------------------------------------

-- Sets the area of the caller's own photo to one of its venue's active
-- places, or clears it (p_subject_id null). Staff accounts only: an area
-- label exists to earn month credit, which only the uploader's own label
-- earns. The photo may still be processing; only a ready photo is reviewed.
-- Choosing the area it already has changes nothing.
create function public.set_media_area_label(p_asset_id uuid, p_subject_id uuid)
returns table (label_id uuid, subject_id uuid, changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_live public.media_area_labels;
  v_subject public.knowledge_subjects;
  v_id uuid;
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_asset_id is null then
    raise exception 'invalid_asset' using errcode = '22023';
  end if;

  -- Serialises with label saves, finalise and delete of the photo.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.uploader_id <> v_uid
     or v_asset.deleted_at is not null
     or v_asset.upload_state = 'failed' then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'area_label_image_only' using errcode = '22023';
  end if;

  select l.* into v_live from public.media_area_labels l
  where l.asset_id = p_asset_id and l.removed_at is null
  for update;

  if p_subject_id is not null then
    select s.* into v_subject from public.knowledge_subjects s where s.id = p_subject_id;
    if not found or v_subject.venue_id <> v_asset.venue_id then
      raise exception 'area_wrong_venue' using errcode = '22023';
    end if;
    if v_subject.retired_at is not null then
      raise exception 'area_unavailable' using errcode = 'P0001';
    end if;
  end if;

  if v_live.id is not null and v_live.subject_id is not distinct from p_subject_id then
    return query select v_live.id, v_live.subject_id, false;
    return;
  end if;
  if v_live.id is null and p_subject_id is null then
    return query select null::uuid, null::uuid, false;
    return;
  end if;

  -- A reviewer withdrew this photo's area credit: that is final for the
  -- photo. Removing the area and choosing one again must not send it back
  -- to the queue with no history. Clearing the area stays allowed.
  if p_subject_id is not null and exists (
    select 1
    from public.media_area_labels l
    cross join lateral private.area_photo_latest(l.id) d
    where l.asset_id = p_asset_id and d.action = 'withdrawn'
  ) then
    raise exception 'area_photo_withdrawn' using errcode = 'P0001';
  end if;

  if v_live.id is not null then
    update public.media_area_labels l
    set removed_at = now(), removed_by = v_uid
    where l.id = v_live.id;
  end if;

  if p_subject_id is null then
    return query select null::uuid, null::uuid, true;
    return;
  end if;

  insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
  values (p_asset_id, v_asset.venue_id, v_subject.id, v_subject.kind, v_subject.label, v_uid)
  returning id into v_id;
  return query select v_id, v_subject.id, true;
end;
$$;

-- The caller's own photos' areas and where each stands (at most 100 ids).
create function public.my_area_labels(p_asset_ids uuid[])
returns table (
  asset_id uuid,
  label_id uuid,
  subject_id uuid,
  subject_kind text,
  subject_label text,
  state text,
  reason text,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_ids' using errcode = '22023';
  end if;
  return query
  select l.asset_id, l.id, l.subject_id, l.subject_kind, l.subject_label,
    coalesce(d.action, 'pending'), d.reason, d.decided_at
  from public.media_area_labels l
  join public.media_assets a on a.id = l.asset_id
  left join lateral private.area_photo_latest(l.id) d on true
  where l.asset_id = any(p_asset_ids)
    and l.removed_at is null
    and a.uploader_id = v_uid
    and l.added_by = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review (a venue manager or an admin)
-- ---------------------------------------------------------------------------

-- The venue's area photos for review: p_status pending (oldest label first),
-- accepted, needs_another_photo, withdrawn or all (newest first). Ready,
-- undeleted photos with a live uploader-added area only. can_decide is false
-- on the caller's own photos.
create function public.area_photo_queue(
  p_venue_id uuid default null,
  p_status text default 'pending',
  p_limit integer default 50
)
returns table (
  label_id uuid,
  asset_id uuid,
  venue_id uuid,
  author_id uuid,
  author_name text,
  subject_id uuid,
  subject_kind text,
  subject_label text,
  labelled_at timestamptz,
  uploaded_at timestamptz,
  credit_month date,
  state text,
  reason text,
  decided_at timestamptz,
  can_decide boolean,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_status text := coalesce(p_status, 'pending');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'accepted', 'needs_another_photo', 'withdrawn', 'all') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  perform private.assert_can_manage_venue(v_venue);

  return query
  select r.label_id, r.asset_id, r.venue_id, r.author_id, p.display_name,
    r.subject_id, r.subject_kind, r.subject_label, r.labelled_at, r.uploaded_at,
    private.london_month(r.uploaded_at), r.state, r.reason, r.decided_at,
    r.author_id <> v_uid and r.state <> 'withdrawn',
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height
  from private.area_photo_rows(v_venue, null) r
  join public.media_assets a on a.id = r.asset_id
  join public.profiles p on p.id = r.author_id
  where r.ready and r.deleted_at is null
    and (v_status = 'all' or r.state = v_status)
  order by
    case when v_status = 'pending' then r.labelled_at end asc,
    coalesce(r.decided_at, r.labelled_at) desc,
    r.label_id
  limit v_limit;
end;
$$;

-- One decision on an area photo. p_action: accepted, needs_another_photo
-- (reason required) or withdrawn (reason required; only an accepted photo).
-- Allowed: waiting -> accepted | needs_another_photo; needs_another_photo ->
-- accepted; accepted -> withdrawn. Repeating the current state changes
-- nothing. Nobody decides on a photo they uploaded or labelled.
create function public.decide_area_photo(p_label_id uuid, p_action text, p_reason text default null)
returns table (label_id uuid, state text, changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_label public.media_area_labels;
  v_asset public.media_assets;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_current text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('accepted', 'needs_another_photo', 'withdrawn') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select l.* into v_label from public.media_area_labels l where l.id = p_label_id for update;
  -- Another venue's photo is not found, as an unknown id.
  if not found or not private.can_manage_venue(v_label.venue_id) then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  select a.* into v_asset from public.media_assets a where a.id = v_label.asset_id;
  if v_label.removed_at is not null
     or v_label.added_by <> v_asset.uploader_id
     or v_asset.media_type <> 'image'
     or v_asset.upload_state <> 'ready'
     or v_asset.deleted_at is not null then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  if v_asset.uploader_id = v_uid or v_label.added_by = v_uid then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if p_action <> 'accepted' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select coalesce((select d.action from private.area_photo_latest(v_label.id) d), 'pending')
  into v_current;
  if v_current = p_action then
    return query select v_label.id, v_current, false;
    return;
  end if;
  if not (
    (v_current = 'pending' and p_action in ('accepted', 'needs_another_photo'))
    or (v_current = 'needs_another_photo' and p_action = 'accepted')
    or (v_current = 'accepted' and p_action = 'withdrawn')
  ) then
    raise exception 'area_photo_conflict' using errcode = '40001',
      detail = jsonb_build_object('state', v_current)::text;
  end if;

  insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, reason, decided_by)
  values (v_label.id, v_label.venue_id, v_label.asset_id, p_action,
    case when p_action = 'accepted' then null else v_reason end, v_uid);
  return query select v_label.id, p_action, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Month credit (read-through)
-- ---------------------------------------------------------------------------

-- As 20261115100000, with a third source: accepted area photos.
create or replace function private.monthly_credit_items(p_month date)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  decided_at timestamptz,
  evidence_removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with submitted as (
    -- As in 20261102150000: the author submitted their own ready image,
    -- uploaded and submitted in that London month, at its upload venue.
    select i.author_id, i.venue_id, i.asset_id, i.decided_at,
      a.deleted_at is not null as evidence_removed
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.submitted_month = p_month
      and i.uploaded_month = p_month
      and i.state = 'accepted'
      and i.origin = 'submitted'
      and i.submitted_by = i.author_id
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month))
  ),
  menu as (
    -- As 20261115140000 (PR #31, ORP decision 2): credit read from the
    -- decision history, so a recheck or a later request keeps it; only a
    -- withdrawal removes it. Carried forward unchanged.
    -- One row per asset however many items it was accepted for; the earliest
    -- acceptance decides whether it was a late one.
    select m.author_id, m.venue_id, m.asset_id, min(acc.accepted_at) as decided_at,
      bool_or(a.deleted_at is not null) as evidence_removed
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id
    -- Earned by an acceptance in the row's history that no withdrawal
    -- followed. Withdrawn and invalidated rows are final and earn nothing.
    join lateral (
      select min(e.created_at) as accepted_at
      from public.menu_item_photo_events e
      where e.photo_id = m.id
        and e.action = 'accepted'
        and not exists (
          select 1 from public.menu_item_photo_events w
          where w.photo_id = m.id and w.action = 'withdrawn' and w.id > e.id
        )
    ) acc on acc.accepted_at is not null
    where m.state in ('accepted', 'needs_recheck', 'better_photo_requested')
      and private.london_month(a.created_at) = p_month
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month))
      -- The uploader's own label for the reviewed tuple.
      and exists (
        select 1 from public.media_label_items li
        where li.asset_id = m.asset_id
          and li.item_id = m.item_id
          and li.variant_id is not distinct from m.variant_id
          and li.added_by = m.author_id
      )
      and not exists (select 1 from submitted s where s.asset_id = m.asset_id)
    group by m.author_id, m.venue_id, m.asset_id
  ),
  area as (
    -- G-9: the uploader's own live area label, accepted. The photo is
    -- credited once: not when a send or a dish label already credits it.
    select r.author_id, r.venue_id, r.asset_id, r.decided_at,
      r.deleted_at is not null as evidence_removed
    from private.area_photo_rows(null, null) r
    where r.state = 'accepted'
      and r.ready
      and private.london_month(r.uploaded_at) = p_month
      and (r.deleted_at is null or r.deleted_at >= private.london_month_end(p_month))
      and not exists (select 1 from submitted s where s.asset_id = r.asset_id)
      and not exists (select 1 from menu m where m.asset_id = r.asset_id)
  )
  select s.author_id, s.venue_id, s.asset_id, s.decided_at, s.evidence_removed
  from submitted s
  union all
  select m.author_id, m.venue_id, m.asset_id, m.decided_at, m.evidence_removed
  from menu m
  union all
  select r.author_id, r.venue_id, r.asset_id, r.decided_at, r.evidence_removed
  from area r;
$$;

-- As 20261116110000, with the area photo's needs_another_photo and waiting
-- states (accepted comes through monthly_credit_items above).
create or replace function private.month_photo_states(
  p_month date,
  p_venue_id uuid default null,
  p_author_id uuid default null
)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  state text,
  decided_at timestamptz,
  decided_by uuid,
  reason text,
  submission_item_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select private.london_month_start(p_month) as m_start,
      private.london_month_end(p_month) as m_end
  ),
  candidates as (
    select c.author_id, c.venue_id, c.asset_id, 1 as rank, 'accepted'::text as state,
      c.decided_at, null::uuid as decided_by, null::text as reason, null::uuid as submission_item_id
    from private.monthly_credit_items(p_month) c
    where (p_venue_id is null or c.venue_id = p_venue_id)
      and (p_author_id is null or c.author_id = p_author_id)

    union all
    -- An open request on an own send in the month. An archived request (its
    -- task retired or reconciled) cannot be answered; nor can one replaced.
    select i.author_id, i.venue_id, i.asset_id, 2, 'needs_another_photo',
      i.decided_at, i.decided_by, i.decision_reason, i.id
    from public.coverage_submission_items i
    where i.submitted_month = p_month and i.submitted_by = i.author_id and i.origin = 'submitted'
      and i.state = 'needs_another_photo' and i.archived_at is null
      and not exists (
        select 1 from public.coverage_submission_items n where n.replaces_item_id = i.id)
      and (p_venue_id is null or i.venue_id = p_venue_id)
      and (p_author_id is null or i.author_id = p_author_id)

    union all
    -- A menu note on the uploader's own labelled photo, until decision 4
    -- clears it.
    select m.author_id, m.venue_id, m.asset_id, 2, 'needs_another_photo',
      m.decided_at, m.decided_by, m.reason, null::uuid
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id
    cross join bounds b
    where m.state = 'better_photo_requested'
      and a.created_at >= b.m_start and a.created_at < b.m_end
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and (p_venue_id is null or m.venue_id = p_venue_id)
      and (p_author_id is null or m.author_id = p_author_id)
      and exists (
        select 1 from public.media_label_items li
        where li.asset_id = m.asset_id and li.item_id = m.item_id
          and li.variant_id is not distinct from m.variant_id
          and li.added_by = m.author_id)
      and not exists (
        select 1 from public.menu_item_photo_events e
        where e.item_id = m.item_id and e.venue_id = m.venue_id
          and e.action = 'accepted' and e.created_at > m.decided_at)

    union all
    -- G-9: an area photo a reviewer asked to be taken again, while its area
    -- label stands.
    select r.author_id, r.venue_id, r.asset_id, 2, 'needs_another_photo',
      r.decided_at, r.decided_by, r.reason, null::uuid
    from private.area_photo_rows(p_venue_id, p_author_id) r
    cross join bounds b
    where r.state = 'needs_another_photo'
      and r.ready and r.deleted_at is null
      and r.uploaded_at >= b.m_start and r.uploaded_at < b.m_end

    union all
    -- An own send that would earn credit once accepted, not settled by a
    -- menu decision.
    select i.author_id, i.venue_id, i.asset_id, 3, 'waiting',
      null::timestamptz, null::uuid, null::text, i.id
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.submitted_month = p_month and i.uploaded_month = p_month
      and i.submitted_by = i.author_id and i.origin = 'submitted' and i.state = 'submitted'
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and not private.menu_settled(i.asset_id, i.requirement_id, i.venue_id)
      and (p_venue_id is null or i.venue_id = p_venue_id)
      and (p_author_id is null or i.author_id = p_author_id)

    union all
    -- A label the uploader added themself, waiting in the menu review queue.
    select t.uploader_id, va.venue_id, t.asset_id, 3, 'waiting',
      null::timestamptz, null::uuid, null::text, null::uuid
    from (
      select distinct a.venue_id
      from public.media_assets a
      cross join bounds b
      where a.created_at >= b.m_start and a.created_at < b.m_end
        and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
        and (p_venue_id is null or a.venue_id = p_venue_id)
        and (p_author_id is null or a.uploader_id = p_author_id)
    ) va
    cross join bounds b
    cross join lateral private.menu_photo_pending_tuples(va.venue_id, true) t
    join public.media_label_items li on li.id = t.label_id
    where not t.is_recheck
      and li.added_by = t.uploader_id
      and t.created_at >= b.m_start and t.created_at < b.m_end
      and (p_author_id is null or t.uploader_id = p_author_id)

    union all
    -- G-9: an area photo waiting in the area review queue.
    select r.author_id, r.venue_id, r.asset_id, 3, 'waiting',
      null::timestamptz, null::uuid, null::text, null::uuid
    from private.area_photo_rows(p_venue_id, p_author_id) r
    cross join bounds b
    where r.state = 'pending'
      and r.ready and r.deleted_at is null
      and r.uploaded_at >= b.m_start and r.uploaded_at < b.m_end
  )
  select distinct on (c.author_id, c.venue_id, c.asset_id)
    c.author_id, c.venue_id, c.asset_id, c.state, c.decided_at, c.decided_by, c.reason,
    c.submission_item_id
  from candidates c
  order by c.author_id, c.venue_id, c.asset_id, c.rank,
    c.decided_at desc nulls last, c.submission_item_id nulls last;
$$;

-- As 20261116110000; item_names also names the photo's area, and an accepted
-- area photo names its reviewer.
create or replace function public.my_month_photos(
  p_period_month date default null,
  p_limit integer default 101
)
returns table (
  asset_id uuid,
  venue_id uuid,
  state text,
  uploaded_at timestamptz,
  item_names text[],
  requirement_title text,
  submission_item_id uuid,
  reason text,
  decided_by uuid,
  decided_at timestamptz,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer,
  evidence_available boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_month date := coalesce(p_period_month, private.current_london_month());
  v_limit integer := least(greatest(coalesce(p_limit, 101), 1), 201);
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if extract(day from v_month) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  return query
  select s.asset_id, s.venue_id, s.state, a.created_at,
    coalesce(array(
      select n.name from (
        select distinct li.item_name as name, 1 as k
        from public.media_label_items li
        where li.asset_id = s.asset_id and li.added_by = v_uid
        union
        select al.subject_label, 2
        from public.media_area_labels al
        where al.asset_id = s.asset_id and al.added_by = v_uid and al.removed_at is null
      ) n
      order by n.k, n.name
    ), '{}'::text[]),
    sent.title,
    s.submission_item_id,
    s.reason,
    coalesce(s.decided_by, ok.decided_by),
    coalesce(s.decided_at, ok.decided_at),
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height,
    a.upload_state = 'ready' and a.deleted_at is null
  from private.month_photo_states(v_month, null, v_uid) s
  join public.media_assets a on a.id = s.asset_id
  -- What the photo was sent for, when it was sent in the month.
  left join lateral (
    select coalesce(r.title, '') as title
    from public.coverage_submission_items i
    left join public.coverage_requirements r on r.id = i.requirement_id
    where i.asset_id = s.asset_id and i.author_id = v_uid and i.submitted_month = v_month
      and i.origin = 'submitted'
    order by (i.id = s.submission_item_id) desc nulls last, i.submitted_at desc, i.id
    limit 1
  ) sent on true
  -- Who accepted it: the first menu acceptance, else the accepted send, else
  -- the area acceptance.
  left join lateral (
    select x.decided_by, x.decided_at
    from (
      select m.decided_by, m.decided_at, 1 as k
      from public.menu_item_photos m
      where m.asset_id = s.asset_id and m.state in ('accepted', 'needs_recheck')
      union all
      select i.decided_by, i.decided_at, 2
      from public.coverage_submission_items i
      where i.asset_id = s.asset_id and i.author_id = v_uid and i.state = 'accepted'
      union all
      select r.decided_by, r.decided_at, 3
      from private.area_photo_rows(null, v_uid) r
      where r.asset_id = s.asset_id and r.state = 'accepted'
    ) x
    where s.state = 'accepted'
    order by x.k, x.decided_at
    limit 1
  ) ok on true
  where s.venue_id in (
    select p.venue_id from public.coverage_staff_progress_v2(null, v_month, v_uid) p
  )
  order by a.created_at desc, s.asset_id desc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.media_area_labels_guard() from public, anon, authenticated;
revoke all on function private.area_photo_latest(uuid) from public, anon, authenticated;
revoke all on function private.area_photo_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function private.area_photo_latest(uuid), private.area_photo_rows(uuid, uuid)
  to service_role;

revoke all on function public.set_media_area_label(uuid, uuid) from public, anon, service_role;
revoke all on function public.my_area_labels(uuid[]) from public, anon, service_role;
revoke all on function public.area_photo_queue(uuid, text, integer) from public, anon, service_role;
revoke all on function public.decide_area_photo(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_media_area_label(uuid, uuid) to authenticated;
grant execute on function public.my_area_labels(uuid[]) to authenticated;
grant execute on function public.area_photo_queue(uuid, text, integer) to authenticated;
grant execute on function public.decide_area_photo(uuid, text, text) to authenticated;

-- Review c (1): the image check for area photos, used by
-- /api/area-photos/{id}/thumb|preview like menu_item_photo_asset is for menu
-- review. The venue's manager (account or grant) and admins may open a photo
-- its uploader labelled with one of the venue's areas; the uploader may open
-- their own. Nobody else, and never another venue's photo.
create function public.area_photo_asset(p_asset_id uuid)
returns table (
  asset_id uuid,
  venue_id uuid,
  uploader_id uuid,
  media_type public.media_type,
  validated_mime_type text,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.venue_id, a.uploader_id, a.media_type, a.validated_mime_type,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and private.is_active_user()
    and (
      -- The venue's manager and the uploader: only while the uploader's area
      -- label is live. Clearing the area ends their access through here.
      (
        (private.can_manage_venue(a.venue_id) or a.uploader_id = (select auth.uid()))
        and exists (
          select 1 from public.media_area_labels l
          where l.asset_id = a.id and l.venue_id = a.venue_id
            and l.added_by = a.uploader_id and l.removed_at is null
        )
      )
      -- Admin oversight keeps the photo after its area goes, as menu review.
      or (
        private.is_active_admin()
        and exists (
          select 1 from public.media_area_labels l
          where l.asset_id = a.id and l.venue_id = a.venue_id and l.added_by = a.uploader_id
        )
      )
    );
$$;
revoke all on function public.area_photo_asset(uuid) from public, anon, service_role;
grant execute on function public.area_photo_asset(uuid) to authenticated;

-- S-1: a photo its uploader labelled with a venue area is labelled. It no
-- longer counts in "needs labels" (Home's labels row and badge, Me, the
-- label-work counts), which all read this function.
create or replace function private.asset_needs_labels(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.media_assets a
    where a.id = p_asset_id
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.purpose = 'general'
      and not exists (
        select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels
      )
      and not exists (
        select 1 from public.media_area_labels al
        where al.asset_id = a.id and al.removed_at is null and al.added_by = a.uploader_id
      )
  );
$$;

-- create or replace keeps these; restated.
revoke all on function public.my_month_photos(date, integer) from public, anon, service_role;
grant execute on function public.my_month_photos(date, integer) to authenticated;
