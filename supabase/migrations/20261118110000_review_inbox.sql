-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-REVIEW: the manager review inbox (spec §7 M2; FA-4, FA-7,
-- FA-31, FA-35).
--
--   Set aside     public.review_dispositions, append-only: Not used (with a
--                 reason) and Mark duplicate (linked to an accepted photo at
--                 the venue) for a whole photo, and Restore. A photo set aside
--                 leaves every waiting queue (dish label tuples, Needs label,
--                 old-menu labels, and its waiting place and amenity rows get
--                 a Not used decision), so it can never add coverage or
--                 contribution credit; the file and its uploader stay.
--                 public.review_set_aside writes one, with a stale check on
--                 the latest disposition.
--   Main queue    public.manager_menu_photo_queue: `pending` (and `all`) now
--                 hold Needs label photos (usable photos staff tagged as food
--                 or drink without a dish, FA-4) next to Awaiting review,
--                 oldest first. New filters: category (food or drinks), age
--                 in days, possible duplicate, dishes with a needed-by date.
--                 New columns: capture time and its source, the hash
--                 duplicate link, possible duplicate, the staff note.
--   Stale checks  area_photo_decisions and amenity_photo_decisions gain
--                 previous_decision_id (filled on insert), and
--                 public.review_decide_area_photo /
--                 public.review_decide_amenity_photo refuse a decision made
--                 against an older one (spec §11, AC18).
--   Detail        public.review_photo_detail: one photo with provenance
--                 (contributor, upload time, capture time or unknown, size),
--                 the group it was sent with, its dish, place and amenity
--                 slots with their current decision and the approved photos
--                 to compare, the staff note, possible duplicates, and the
--                 photo's review history.
--   Notices       a reviewer's label correction notifies the contributor
--                 ("label_corrected", FA-7: Label corrected).
--
-- Rollback: re-apply private.menu_photo_pending_tuples,
-- and private.menu_photo_stale_label
-- (20261107100300) and public.manager_menu_photo_queue (20261107100700);
-- drop the new functions, triggers, columns and table; restore the
-- notifications kind check (20261118106200).

-- ---------------------------------------------------------------------------
-- Set aside: Not used and Mark duplicate
-- ---------------------------------------------------------------------------

create table public.review_dispositions (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  action text not null check (action in ('not_used', 'duplicate', 'restored')),
  -- A reusable reason (spec §7 M2), when one was picked.
  reason_code text check (reason_code is null or reason_code ~ '^[a-z][a-z_]{0,39}$'),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  -- Mark duplicate: the accepted photo this one repeats. Cleared only if
  -- that photo is removed for good.
  duplicate_of_asset_id uuid references public.media_assets (id) on delete set null,
  previous_id bigint references public.review_dispositions (id) on delete set null,
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_role text not null check (decided_role in ('manager', 'admin', 'staff')),
  decided_at timestamptz not null default now(),
  constraint review_dispositions_not_used_reason check (action <> 'not_used' or reason is not null),
  constraint review_dispositions_not_self check (duplicate_of_asset_id is distinct from asset_id)
);

create index review_dispositions_asset_idx on public.review_dispositions (asset_id, id desc);
create index review_dispositions_venue_idx on public.review_dispositions (venue_id, decided_at desc);
create index review_dispositions_duplicate_of_idx
  on public.review_dispositions (duplicate_of_asset_id) where duplicate_of_asset_id is not null;

comment on table public.review_dispositions is
  'S2-REVIEW: Not used, Mark duplicate and Restore on a whole photo (spec §7 M2). Append-only; the latest row per asset is current.';

alter table public.review_dispositions enable row level security;
revoke all on public.review_dispositions from public, anon, authenticated;
grant all on public.review_dispositions to service_role;

-- History is kept: rows are never changed (an asset removed for good takes
-- its rows with it).
create function private.review_dispositions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id, new.venue_id, new.asset_id, new.action, new.reason_code, new.reason,
    new.decided_by, new.decided_role, new.decided_at
  ) is not distinct from (
    old.id, old.venue_id, old.asset_id, old.action, old.reason_code, old.reason,
    old.decided_by, old.decided_role, old.decided_at
  ) then
    -- Only the two "on delete set null" links may change.
    return new;
  end if;
  raise exception 'review_dispositions_append_only' using errcode = '42501';
end;
$$;

revoke all on function private.review_dispositions_append_only() from public, anon, authenticated;

create trigger review_dispositions_append_only
  before update on public.review_dispositions
  for each row execute function private.review_dispositions_append_only();

create trigger review_dispositions_no_truncate
  before truncate on public.review_dispositions
  for each statement execute function private.review_dispositions_append_only();

-- True when the photo's latest disposition sets it aside (Not used or
-- Mark duplicate).
create function private.asset_set_aside(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select d.action in ('not_used', 'duplicate') from public.review_dispositions d
    where d.asset_id = p_asset_id order by d.id desc limit 1
  ), false);
$$;

revoke all on function private.asset_set_aside(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Waiting rules: a photo set aside no longer waits
-- ---------------------------------------------------------------------------

-- private.menu_photo_unlabelled_eligible stays as it is: it also gates who
-- may open an unlabelled photo (public.menu_item_photo_asset, asset search),
-- and a photo set aside must still open for its reviewer. The queue and the
-- detail add "not set aside" themselves.
-- Body as in 20261107100300, plus: not set aside.
create or replace function private.menu_photo_stale_label(p_asset uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.media_label_items li
      where li.asset_id = p_asset and li.venue_id = p_venue)
    and not exists (
      select 1
      from public.media_label_items li
      join private.current_photo_menu_items(p_venue) e
        on e.item_id = li.item_id and e.section_kind in ('food', 'drinks')
      where li.asset_id = p_asset)
    and not exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = p_asset
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
    and not private.asset_set_aside(p_asset);
$$;

-- Body as in 20261107100300, plus: a photo set aside waits only while one of
-- its rows needs a recheck (that row is already decided; Withdraw ends it).
create or replace function private.menu_photo_pending_tuples(
  p_venue_id uuid,
  p_admin boolean,
  p_own_only boolean default false
)
returns table (
  label_id uuid,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  entry_id uuid,
  uploader_id uuid,
  created_at timestamptz,
  labelled_at timestamptz,
  live_photo_id uuid,
  is_recheck boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select li.id, a.id, li.item_id, li.variant_id, e.entry_id, a.uploader_id, a.created_at, li.added_at,
    lp.id, coalesce(lp.state = 'needs_recheck', false)
  from private.current_photo_menu_items(p_venue_id) e
  join public.media_label_items li on li.item_id = e.item_id and li.venue_id = p_venue_id
  join public.media_assets a on a.id = li.asset_id
  left join public.menu_entry_variants ev on ev.entry_id = e.entry_id and ev.variant_id = li.variant_id
  left join lateral (
    select p.id, p.state from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  ) lp on true
  left join lateral (
    select 1 as hit from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state = 'withdrawn' and p.withdrawn_at >= li.added_at
    limit 1
  ) wd on true
  where e.section_kind in ('food', 'drinks')
    and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
    -- A variant no longer offered still waits while its row needs a recheck.
    and (li.variant_id is null or ev.variant_id is not null or lp.state = 'needs_recheck')
    and (lp.state = 'needs_recheck' or (lp.id is null and wd.hit is null))
    and (lp.state = 'needs_recheck' or not private.asset_set_aside(a.id))
    and not private.menu_photo_tuple_relinked(li.asset_id, li.item_id, li.variant_id, li.added_at)
    and case
      when coalesce(p_own_only, false) then a.uploader_id = (select auth.uid())
      else private.menu_photo_reviewable_uploader(a.uploader_id, p_admin)
    end;
$$;

-- ---------------------------------------------------------------------------
-- Place and amenity decisions: the decision each one replaced
-- ---------------------------------------------------------------------------

alter table public.area_photo_decisions
  add column previous_decision_id bigint references public.area_photo_decisions (id) on delete restrict;
alter table public.amenity_photo_decisions
  add column previous_decision_id bigint references public.amenity_photo_decisions (id) on delete restrict;

comment on column public.area_photo_decisions.previous_decision_id is
  'S2-REVIEW: the decision on this label this one replaced (spec §11 Review decision).';
comment on column public.amenity_photo_decisions.previous_decision_id is
  'S2-REVIEW: the decision on this check and photo this one replaced (spec §11 Review decision).';

create function private.area_photo_decisions_previous()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.previous_decision_id := (
    select d.id from public.area_photo_decisions d
    where d.label_id = new.label_id order by d.id desc limit 1);
  return new;
end;
$$;

create function private.amenity_photo_decisions_previous()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.previous_decision_id := (
    select d.id from public.amenity_photo_decisions d
    where d.check_id = new.check_id and d.asset_id = new.asset_id order by d.id desc limit 1);
  return new;
end;
$$;

revoke all on function private.area_photo_decisions_previous() from public, anon, authenticated;
revoke all on function private.amenity_photo_decisions_previous() from public, anon, authenticated;

create trigger area_photo_decisions_previous
  before insert on public.area_photo_decisions
  for each row execute function private.area_photo_decisions_previous();
create trigger amenity_photo_decisions_previous
  before insert on public.amenity_photo_decisions
  for each row execute function private.amenity_photo_decisions_previous();

-- The latest decision on a place photo or an amenity photo, for a conflict.
create function private.review_conflict_detail(p_kind text, p_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('decisionId', x.id, 'action', x.action, 'level', x.review_level,
      'reason', x.reason, 'by', p.display_name, 'at', x.decided_at)::text
    from (
      select d.id, d.action, d.review_level, d.reason, d.decided_by, d.decided_at
      from public.area_photo_decisions d where p_kind = 'area' and d.id = p_id
      union all
      select d.id, d.action, d.review_level, d.reason, d.decided_by, d.decided_at
      from public.amenity_photo_decisions d where p_kind = 'amenity' and d.id = p_id
      union all
      select d.id, d.action, null, d.reason, d.decided_by, d.decided_at
      from public.review_dispositions d where p_kind = 'disposition' and d.id = p_id
    ) x
    join public.profiles p on p.id = x.decided_by), '{}');
$$;

revoke all on function private.review_conflict_detail(text, bigint) from public, anon, authenticated, service_role;

-- One decision on a place photo, made against the decision the reviewer saw
-- (p_expected_decision_id; null when none had been made). A newer decision
-- refuses with review_conflict and the latest decision in the detail, so a
-- stale screen never overwrites it. Otherwise public.decide_area_photo_level
-- with every check it makes.
create function public.review_decide_area_photo(
  p_label_id uuid,
  p_action text,
  p_level text default 'public',
  p_reason text default null,
  p_expected_decision_id bigint default null
)
returns table (label_id uuid, state text, review_level text, changed boolean, decision_id bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid;
  v_latest bigint;
  v_row record;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select l.venue_id into v_venue from public.media_area_labels l where l.id = p_label_id for update;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  select d.id into v_latest from public.area_photo_decisions d
  where d.label_id = p_label_id order by d.id desc limit 1;
  if v_latest is distinct from p_expected_decision_id then
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('area', v_latest);
  end if;
  -- The decision's own id is read in a second statement: the first one's
  -- snapshot does not see the row the call inserts.
  select r.label_id, r.state, r.review_level, r.changed
  into v_row
  from public.decide_area_photo_level(p_label_id, p_action, p_level, p_reason) r;
  return query
  select v_row.label_id, v_row.state, v_row.review_level, v_row.changed,
    (select d.id from public.area_photo_decisions d where d.label_id = p_label_id order by d.id desc limit 1);
end;
$$;

-- As public.review_decide_area_photo, for an amenity check's photo.
create function public.review_decide_amenity_photo(
  p_check_id uuid,
  p_asset_id uuid,
  p_action text,
  p_level text default 'public',
  p_reason text default null,
  p_expected_decision_id bigint default null
)
returns table (check_id uuid, asset_id uuid, state text, review_level text, changed boolean, decision_id bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid;
  v_latest bigint;
  v_row record;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select c.venue_id into v_venue from public.venue_amenity_checks c where c.id = p_check_id for update;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'amenity_photo_not_found' using errcode = 'P0002';
  end if;
  select d.id into v_latest from public.amenity_photo_decisions d
  where d.check_id = p_check_id and d.asset_id = p_asset_id order by d.id desc limit 1;
  if v_latest is distinct from p_expected_decision_id then
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('amenity', v_latest);
  end if;
  select r.check_id, r.asset_id, r.state, r.review_level, r.changed
  into v_row
  from public.decide_amenity_photo(p_check_id, p_asset_id, p_action, p_level, p_reason) r;
  return query
  select v_row.check_id, v_row.asset_id, v_row.state, v_row.review_level, v_row.changed,
    (select d.id from public.amenity_photo_decisions d
     where d.check_id = p_check_id and d.asset_id = p_asset_id order by d.id desc limit 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Set aside: the write
-- ---------------------------------------------------------------------------

-- Not used, Mark duplicate or Restore on a whole photo at the venue, against
-- the disposition the reviewer saw (p_expected_disposition_id; null for
-- none). The venue's manager or an admin; a manager not on their own photo.
--   not_used    a reason is required; the photo has no live decision (an
--               accepted or asked-again dish, place or amenity decision is
--               withdrawn first).
--   duplicate   p_duplicate_of is another ready photo at the venue that has
--               been accepted (private.asset_is_accepted); the same rule.
--   restored    the photo is set aside now; it waits again.
-- Not used and duplicate also record Not used on the photo's waiting place
-- and amenity rows, so it leaves those queues too.
create function public.review_set_aside(
  p_asset_id uuid,
  p_action text,
  p_reason_code text default null,
  p_reason text default null,
  p_duplicate_of uuid default null,
  p_expected_disposition_id bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_target public.media_assets;
  v_latest public.review_dispositions;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_code text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_role text;
  v_id bigint;
  v_row record;
  v_area_reason text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('not_used', 'duplicate', 'restored') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[a-z][a-z_]{0,39}$' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.upload_state <> 'ready' or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.uploader_id = v_uid and not private.is_active_admin() then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  v_role := case when private.is_active_admin() then 'admin' else 'manager' end;

  select d.* into v_latest from public.review_dispositions d
  where d.asset_id = p_asset_id order by d.id desc limit 1;
  if v_latest.id is distinct from p_expected_disposition_id then
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('disposition', v_latest.id);
  end if;

  if p_action = 'restored' then
    if v_latest.id is null or v_latest.action = 'restored' then
      raise exception 'nothing_to_restore' using errcode = 'P0001';
    end if;
  else
    if p_action = 'not_used' and v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    if v_latest.action in ('not_used', 'duplicate') then
      raise exception 'already_set_aside' using errcode = 'P0001';
    end if;
    -- A decided photo is withdrawn first, so a public or reference decision
    -- is never undone silently.
    if exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = p_asset_id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
      or exists (
        select 1 from public.media_area_labels l
        cross join lateral (
          select d.action from public.area_photo_decisions d
          where d.label_id = l.id order by d.id desc limit 1) d
        where l.asset_id = p_asset_id and l.removed_at is null
          and d.action in ('accepted', 'needs_another_photo'))
      or exists (
        select 1 from public.amenity_photo_decisions d
        where d.asset_id = p_asset_id
          and d.id = (select x.id from public.amenity_photo_decisions x
            where x.check_id = d.check_id and x.asset_id = d.asset_id order by x.id desc limit 1)
          and d.action in ('accepted', 'needs_another_photo')) then
      raise exception 'withdraw_first' using errcode = 'P0001';
    end if;
    if p_action = 'duplicate' then
      if p_duplicate_of is null or p_duplicate_of = p_asset_id then
        raise exception 'duplicate_target_invalid' using errcode = 'P0001';
      end if;
      select a.* into v_target from public.media_assets a where a.id = p_duplicate_of;
      if not found or v_target.venue_id <> v_asset.venue_id
         or v_target.upload_state <> 'ready' or v_target.deleted_at is not null
         or not private.asset_is_accepted(p_duplicate_of)
         or private.asset_set_aside(p_duplicate_of) then
        raise exception 'duplicate_target_invalid' using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.review_dispositions (
    venue_id, asset_id, action, reason_code, reason, duplicate_of_asset_id, previous_id,
    decided_by, decided_role)
  values (
    v_asset.venue_id, p_asset_id, p_action, v_code, v_reason,
    case when p_action = 'duplicate' then p_duplicate_of end, v_latest.id, v_uid, v_role)
  returning id into v_id;

  if p_action in ('not_used', 'duplicate') then
    v_area_reason := coalesce(v_reason, case when p_action = 'duplicate' then 'Duplicate of another photo' end);
    -- Waiting place labels of this photo.
    for v_row in
      select l.id, l.venue_id from public.media_area_labels l
      where l.asset_id = p_asset_id and l.removed_at is null
        and coalesce((select d.action from public.area_photo_decisions d
          where d.label_id = l.id order by d.id desc limit 1), 'pending') = 'pending'
    loop
      insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, review_level, reason, decided_by)
      values (v_row.id, v_row.venue_id, p_asset_id, 'not_used', 'public', v_area_reason, v_uid);
    end loop;
    -- Waiting amenity rows of this photo.
    for v_row in
      select r.check_id from private.amenity_photo_rows(v_asset.venue_id) r
      where r.asset_id = p_asset_id and r.state = 'pending'
    loop
      insert into public.amenity_photo_decisions (check_id, venue_id, asset_id, action, review_level, reason, decided_by)
      values (v_row.check_id, v_asset.venue_id, p_asset_id, 'not_used', 'public', v_area_reason, v_uid);
    end loop;
  end if;

  return jsonb_build_object('assetId', p_asset_id, 'dispositionId', v_id, 'action', p_action,
    'duplicateOf', case when p_action = 'duplicate' then p_duplicate_of end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The main queue: Needs label with Awaiting review, filters and provenance
-- ---------------------------------------------------------------------------

drop function public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer);

-- As in 20261107100700, plus:
--   pending / all       also hold Needs label photos (the unlabelled set)
--   p_section_kind      food or drinks (dish cards only)
--   p_min_age_days      uploaded at least this many days ago
--   p_possible_duplicate  only photos with a duplicate link or another photo
--                       at the venue with the same content hash
--   p_needed_by         only dishes with a live needed-by date
-- and the photo's capture time, its source, its hash duplicate link,
-- whether it may be a duplicate, and the staff note.
create function public.manager_menu_photo_queue(
  p_venue_id uuid default null,
  p_status text default 'pending',
  p_section_id uuid default null,
  p_contributor_id uuid default null,
  p_item_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_key uuid default null,
  p_limit integer default 25,
  p_section_kind text default null,
  p_min_age_days integer default null,
  p_possible_duplicate boolean default false,
  p_needed_by boolean default false
)
returns table (
  kind text,
  sort_key uuid,
  label_id uuid,
  photo_id uuid,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  section_id uuid,
  section_name text,
  staff_label jsonb,
  uploader_id uuid,
  uploader_name text,
  contributor_status text,
  can_follow_up boolean,
  is_self boolean,
  photo_state text,
  is_primary boolean,
  is_effective_primary boolean,
  basis text,
  reason text,
  recheck_kind text,
  corrects_item_id uuid,
  corrects_variant_id uuid,
  corrects_item_name text,
  item_revision integer,
  item_covered boolean,
  group_count integer,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer,
  created_at timestamptz,
  labelled_at timestamptz,
  captured_at timestamptz,
  captured_at_source text,
  duplicate_of_asset_id uuid,
  possible_duplicate boolean,
  staff_note text,
  section_kind text
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
  v_admin boolean;
  v_active uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  v_itemless boolean;
  v_before timestamptz;
begin
  perform private.assert_can_manage_venue(v_venue);
  if v_status not in (
    'pending', 'recheck', 'needs_another_photo', 'accepted', 'stale_label', 'unlabelled', 'mine', 'all'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_section_kind is not null and p_section_kind not in ('food', 'drinks') then
    raise exception 'invalid_section_kind' using errcode = '22023';
  end if;
  if p_min_age_days is not null and (p_min_age_days < 0 or p_min_age_days > 3650) then
    raise exception 'invalid_age' using errcode = '22023';
  end if;
  v_before := case when p_min_age_days is not null then now() - make_interval(days => p_min_age_days) end;
  v_admin := private.is_active_admin();
  v_active := private.active_menu_version_id(v_venue);
  v_itemless := v_status in ('stale_label', 'unlabelled');
  return query
  with m as (
    -- Items of the active countable menu.
    select e.item_id, e.id as entry_id, e.name, s.id as section_id, s.name as section_name, s.kind as section_kind
    from public.menu_entries e
    join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
    join public.menu_items i on i.id = e.item_id and i.archived_at is null
    where e.version_id = v_active
  ),
  pt as (
    select t.* from private.menu_photo_pending_tuples(v_venue, v_admin, v_status = 'mine') t
    where v_status in ('pending', 'recheck', 'mine', 'all')
  ),
  base as (
    select 'labelled'::text as kind, t.label_id, t.live_photo_id as photo_id, t.asset_id,
      t.item_id, t.variant_id, t.labelled_at
    from pt t
    where v_status <> 'recheck' or t.is_recheck
    union all
    -- Live rows: reviewer rechecks not listed above and the decided sets.
    select 'decided', null::uuid, p.id, p.asset_id, p.item_id, p.variant_id, null::timestamptz
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.venue_id = v_venue
      and (
        (v_status in ('recheck', 'all') and p.state = 'needs_recheck' and p.basis = 'reviewer'
          -- Staff labelled it the same way: the labelled branch lists it.
          and not exists (select 1 from pt where pt.live_photo_id = p.id))
        or (v_status in ('needs_another_photo', 'all') and p.state = 'better_photo_requested')
        or (v_status in ('accepted', 'all') and p.state = 'accepted')
      )
      and exists (select 1 from m where m.item_id = p.item_id)
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    union all
    select 'stale', null::uuid, null::uuid, a.id, null::uuid, null::uuid, null::timestamptz
    from public.media_assets a
    where v_status in ('stale_label', 'all')
      and a.venue_id = v_venue
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and private.menu_photo_stale_label(a.id, v_venue)
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    -- Q1 unlabelled (begin): Needs label (FA-4) is in the main queue too.
    union all
    select 'unlabelled', null::uuid, null::uuid, a.id, null::uuid, null::uuid, null::timestamptz
    from public.media_assets a
    where v_status in ('unlabelled', 'pending', 'all')
      and a.venue_id = v_venue
      and private.menu_photo_unlabelled_eligible(a.id, v_venue)
      and not private.asset_set_aside(a.id)
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
      and not exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = a.id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
    -- Q1 unlabelled (end)
  ),
  qr as (
    select b.kind, coalesce(b.label_id, b.photo_id, b.asset_id) as sort_key,
      b.label_id, b.photo_id, b.asset_id, b.item_id, b.variant_id,
      m.name as item_name, ev.name as variant_name, m.section_id, m.section_name, m.section_kind,
      a.uploader_id, up.display_name as uploader_name,
      case
        when not up.active then 'left'
        when up.role = 'manager' then 'manager'
        when up.venue_id = v_venue then 'here'
        else 'moved'
      end as contributor_status,
      a.uploader_id = v_uid as is_self,
      p.state as photo_state, coalesce(p.is_primary, false) as is_primary,
      p.basis, p.reason, p.recheck_kind, p.corrects_item_id, p.corrects_variant_id,
      a.thumbnail_path is not null as has_thumbnail, a.preview_path is not null as has_preview,
      a.width, a.height, a.created_at, b.labelled_at,
      a.captured_at, a.captured_at_source, a.duplicate_of_asset_id,
      (a.duplicate_of_asset_id is not null
        or (a.content_sha256 is not null and exists (
          select 1 from public.media_assets d
          where d.venue_id = a.venue_id and d.content_sha256 = a.content_sha256
            and d.id <> a.id and d.deleted_at is null))) as possible_duplicate,
      (select ml.note from public.media_labels ml where ml.asset_id = a.id) as staff_note,
      case when b.item_id is null then 0 else (count(*) over (partition by b.item_id))::integer - 1 end
        as group_count
    from base b
    join public.media_assets a on a.id = b.asset_id
    join public.profiles up on up.id = a.uploader_id
    left join m on m.item_id = b.item_id
    left join public.menu_entry_variants ev on ev.entry_id = m.entry_id and ev.variant_id = b.variant_id
    left join public.menu_item_photos p on p.id = b.photo_id
    where (p_contributor_id is null or a.uploader_id = p_contributor_id)
      and (p_section_id is null or v_itemless or m.section_id = p_section_id)
      and (p_item_id is null or v_itemless or b.item_id = p_item_id)
      and (p_section_kind is null or m.section_kind = p_section_kind)
      and (v_before is null or a.created_at <= v_before)
      and (not coalesce(p_needed_by, false) or exists (
        select 1 from public.menu_item_needed_by nb
        where nb.item_id = b.item_id and nb.venue_id = v_venue and nb.cleared_at is null))
  )
  select rw.kind, rw.sort_key, rw.label_id, rw.photo_id, rw.asset_id, rw.item_id, rw.variant_id,
    rw.item_name, rw.variant_name, rw.section_id, rw.section_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', li.item_id, 'variantId', li.variant_id,
        'itemName', li.item_name, 'variantName', li.variant_name,
        'onMenu', exists (select 1 from m where m.item_id = li.item_id))
        order by li.added_at, li.id)
      from public.media_label_items li where li.asset_id = rw.asset_id), '[]'::jsonb),
    rw.uploader_id, rw.uploader_name, rw.contributor_status, rw.contributor_status = 'here',
    rw.is_self, rw.photo_state, rw.is_primary,
    rw.photo_id is not null and private.menu_item_effective_primary(rw.item_id) = rw.photo_id,
    rw.basis, rw.reason, rw.recheck_kind, rw.corrects_item_id, rw.corrects_variant_id,
    case when rw.corrects_item_id is not null then coalesce(
      (select li.item_name from public.media_label_items li
       where li.asset_id = rw.asset_id and li.item_id = rw.corrects_item_id
       order by li.added_at limit 1),
      (select m.name from m where m.item_id = rw.corrects_item_id),
      (select e.name from public.menu_entries e
       join public.menu_versions mv on mv.id = e.version_id
       where e.item_id = rw.corrects_item_id
       order by mv.activated_at desc nulls last, mv.created_at desc limit 1)) end,
    case when rw.item_id is not null then
      coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = rw.item_id), 1) end,
    rw.item_id is not null and private.menu_item_effective_primary(rw.item_id) is not null,
    rw.group_count, rw.has_thumbnail, rw.has_preview, rw.width, rw.height, rw.created_at, rw.labelled_at,
    rw.captured_at, rw.captured_at_source, rw.duplicate_of_asset_id, rw.possible_duplicate,
    rw.staff_note, rw.section_kind
  from qr rw
  where (p_after_created_at is null or p_after_key is null
    or (rw.created_at, rw.sort_key) > (p_after_created_at, p_after_key))
    and (not coalesce(p_possible_duplicate, false) or rw.possible_duplicate)
  order by rw.created_at, rw.sort_key
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- One photo, for the review detail
-- ---------------------------------------------------------------------------

-- Everything a reviewer checks before deciding on one photo at the venue
-- (spec §7 M2): provenance, the group it was sent with, the staff note, its
-- dish, place and amenity slots with their current decision and approved
-- photos to compare, possible duplicates, the current disposition, and the
-- photo's review history (newest first, 50 at most). The venue's manager or
-- an admin; asset ids only (the screen signs its own image routes).
create function public.review_photo_detail(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_admin boolean;
  v_active uuid;
  v_out jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found or not private.can_manage_venue(v_asset.venue_id)
     or v_asset.upload_state <> 'ready' or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_admin := private.is_active_admin();
  v_active := private.active_menu_version_id(v_asset.venue_id);

  select jsonb_build_object(
    'assetId', v_asset.id,
    'venueId', v_asset.venue_id,
    'mediaType', v_asset.media_type,
    'width', v_asset.width,
    'height', v_asset.height,
    'sizeBytes', v_asset.size_bytes,
    'durationSeconds', v_asset.duration_seconds,
    'uploadedAt', v_asset.created_at,
    'capturedAt', v_asset.captured_at,
    'capturedAtSource', v_asset.captured_at_source,
    'hasThumbnail', v_asset.thumbnail_path is not null,
    'hasPreview', v_asset.preview_path is not null,
    'contributor', (
      select jsonb_build_object('id', p.id, 'name', p.display_name, 'active', p.active)
      from public.profiles p where p.id = v_asset.uploader_id),
    'isSelf', v_asset.uploader_id = v_uid,
    -- A manager never decides on their own photo; an admin may.
    'selfBlocked', v_asset.uploader_id = v_uid and not v_admin,
    'note', (select ml.note from public.media_labels ml where ml.asset_id = v_asset.id),
    'contentTypes', coalesce((select to_jsonb(ml.content_types) from public.media_labels ml
      where ml.asset_id = v_asset.id), '[]'::jsonb),
    'needsLabel', private.menu_photo_unlabelled_eligible(v_asset.id, v_asset.venue_id)
      and not private.asset_set_aside(v_asset.id),
    'duplicateOfAssetId', v_asset.duplicate_of_asset_id,
    'possibleDuplicates', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', d.id,
        'hasThumbnail', d.thumbnail_path is not null, 'accepted', private.asset_is_accepted(d.id),
        'uploadedAt', d.created_at) order by d.created_at, d.id)
      from public.media_assets d
      where d.venue_id = v_asset.venue_id and d.id <> v_asset.id and d.deleted_at is null
        and d.upload_state = 'ready'
        and (d.id = v_asset.duplicate_of_asset_id
          or (v_asset.content_sha256 is not null and d.content_sha256 = v_asset.content_sha256))), '[]'::jsonb),
    -- Sent together: the same person's photos from the same batch.
    'group', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', g.id,
        'hasThumbnail', g.thumbnail_path is not null, 'uploadedAt', g.created_at)
        order by g.created_at, g.id)
      from (
        select g.* from public.media_assets g
        where v_asset.client_batch_id is not null
          and g.uploader_id = v_asset.uploader_id and g.client_batch_id = v_asset.client_batch_id
          and g.venue_id = v_asset.venue_id and g.id <> v_asset.id
          and g.upload_state = 'ready' and g.deleted_at is null and g.media_type = 'image'
        order by g.created_at, g.id limit 12) g), '[]'::jsonb),
    'disposition', (
      select jsonb_build_object('id', d.id, 'action', d.action, 'reasonCode', d.reason_code,
        'reason', d.reason, 'duplicateOfAssetId', d.duplicate_of_asset_id,
        'by', p.display_name, 'at', d.decided_at)
      from public.review_dispositions d join public.profiles p on p.id = d.decided_by
      where d.asset_id = v_asset.id order by d.id desc limit 1),
    -- The dish slots: every staff label and every live reviewer row.
    'dishes', coalesce((
      select jsonb_agg(x.j order by x.ord, x.name)
      from (
        select min(t.ord) as ord, t.item_id, t.variant_id, max(t.name) as name,
          jsonb_build_object(
            'itemId', t.item_id,
            'variantId', t.variant_id,
            'itemName', coalesce(max(e.name), max(t.name)),
            'variantName', max(t.variant_name),
            'sectionName', max(s.name),
            'sectionKind', max(s.kind),
            'onMenu', bool_or(e.item_id is not null),
            'staffLabel', bool_or(t.staff),
            'waiting', exists (
              select 1 from private.menu_photo_pending_tuples(v_asset.venue_id, v_admin) pt
              where pt.asset_id = v_asset.id and pt.item_id = t.item_id
                and pt.variant_id is not distinct from t.variant_id),
            'photoId', max(lp.id::text),
            'state', max(lp.state),
            'level', max(lp.review_level),
            'basis', max(lp.basis),
            'isPrimary', bool_or(coalesce(lp.is_primary, false)),
            'itemRevision', coalesce((select h.revision from public.menu_item_photo_heads h
              where h.item_id = t.item_id), 1),
            'presentationRevision', coalesce((select pr.revision from public.menu_item_presentations pr
              where pr.item_id = t.item_id), 1),
            'presentationNote', (select pr.note from public.menu_item_presentations pr
              where pr.item_id = t.item_id),
            'neededBy', (select nb.needed_by from public.menu_item_needed_by nb
              where nb.item_id = t.item_id and nb.venue_id = v_asset.venue_id and nb.cleared_at is null),
            'publicPhotos', coalesce((
              select jsonb_agg(jsonb_build_object('assetId', ap.asset_id, 'photoId', ap.id,
                'isPrimary', ap.id = private.menu_item_effective_primary(t.item_id),
                'hasThumbnail', aa.thumbnail_path is not null)
                order by (ap.id = private.menu_item_effective_primary(t.item_id)) desc, ap.decided_at desc)
              from (
                select p.* from public.menu_item_photos p
                where p.item_id = t.item_id and p.state = 'accepted' and p.review_level = 'public'
                  and p.asset_id <> v_asset.id
                order by p.decided_at desc limit 4) ap
              join public.media_assets aa on aa.id = ap.asset_id
              where aa.upload_state = 'ready' and aa.deleted_at is null), '[]'::jsonb)
          ) as j
        from (
          select 0 as ord, li.item_id, li.variant_id, li.item_name as name, li.variant_name, true as staff
          from public.media_label_items li where li.asset_id = v_asset.id
          union all
          select 1, p.item_id, p.variant_id, p.item_name, p.variant_name, false
          from public.menu_item_photos p
          where p.asset_id = v_asset.id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
        ) t
        left join public.menu_entries e on e.item_id = t.item_id and e.version_id = v_active
        left join public.menu_sections s on s.id = e.section_id
        left join public.menu_item_photos lp
          on lp.asset_id = v_asset.id and lp.item_id = t.item_id
          and lp.variant_id is not distinct from t.variant_id
          and lp.state in ('accepted', 'better_photo_requested', 'needs_recheck')
        group by t.item_id, t.variant_id
      ) x), '[]'::jsonb),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object(
        'labelId', l.id,
        'subjectId', l.subject_id,
        'name', coalesce(ks.label, l.subject_label),
        'state', coalesce(d.action, 'pending'),
        'level', coalesce(d.review_level, 'public'),
        'decisionId', d.id,
        'isPrimary', private.slot_effective_primary('area', l.subject_id) = v_asset.id,
        'publicPhotos', coalesce((
          select jsonb_agg(jsonb_build_object('assetId', sp.asset_id,
            'isPrimary', sp.asset_id = private.slot_effective_primary('area', l.subject_id)))
          from (select e.asset_id from private.slot_public_photos('area', l.subject_id) e
                where e.asset_id <> v_asset.id limit 4) sp), '[]'::jsonb)
      ) order by l.added_at)
      from public.media_area_labels l
      left join public.knowledge_subjects ks on ks.id = l.subject_id
      left join lateral (
        select x.id, x.action, x.review_level from public.area_photo_decisions x
        where x.label_id = l.id order by x.id desc limit 1) d on true
      where l.asset_id = v_asset.id and l.removed_at is null), '[]'::jsonb),
    'amenities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'checkId', r.check_id,
        'question', t.question,
        'state', r.state,
        'level', r.review_level,
        'photoRequired', private.amenity_photo_required(c.template_key),
        'decisionId', (select x.id from public.amenity_photo_decisions x
          where x.check_id = r.check_id and x.asset_id = r.asset_id order by x.id desc limit 1),
        'isPrimary', private.slot_effective_primary('amenity', r.check_id) = r.asset_id,
        'publicPhotos', coalesce((
          select jsonb_agg(jsonb_build_object('assetId', sp.asset_id,
            'isPrimary', sp.asset_id = private.slot_effective_primary('amenity', r.check_id)))
          from (select e.asset_id from private.slot_public_photos('amenity', r.check_id) e
                where e.asset_id <> v_asset.id limit 4) sp), '[]'::jsonb)
      ) order by t.question)
      from private.amenity_photo_rows(v_asset.venue_id) r
      join public.venue_amenity_checks c on c.id = r.check_id
      join public.amenity_catalogue t on t.key = c.template_key
      where r.asset_id = v_asset.id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.j order by h.at desc, h.seq desc)
      from (
        select hh.* from (
          select ev.created_at as at, ev.id as seq, jsonb_build_object(
            'source', 'dish', 'action', ev.action, 'reason', ev.reason,
            'subject', coalesce(mp.item_name, ev.item_id::text),
            'level', ev.detail ->> 'level',
            'by', ap.display_name, 'role', ev.actor_role, 'at', ev.created_at) as j
          from public.menu_item_photo_events ev
          left join public.menu_item_photos mp on mp.id = ev.photo_id
          left join public.profiles ap on ap.id = ev.actor_id
          where ev.asset_id = v_asset.id
          union all
          select d.decided_at, d.id, jsonb_build_object(
            'source', 'place', 'action', d.action, 'reason', d.reason,
            'subject', l.subject_label, 'level', d.review_level,
            'by', p.display_name, 'at', d.decided_at)
          from public.area_photo_decisions d
          join public.media_area_labels l on l.id = d.label_id
          join public.profiles p on p.id = d.decided_by
          where d.asset_id = v_asset.id
          union all
          select d.decided_at, d.id, jsonb_build_object(
            'source', 'amenity', 'action', d.action, 'reason', d.reason,
            'subject', t.question, 'level', d.review_level,
            'by', p.display_name, 'at', d.decided_at)
          from public.amenity_photo_decisions d
          join public.venue_amenity_checks c on c.id = d.check_id
          join public.amenity_catalogue t on t.key = c.template_key
          join public.profiles p on p.id = d.decided_by
          where d.asset_id = v_asset.id
          union all
          select d.decided_at, d.id, jsonb_build_object(
            'source', 'photo', 'action', d.action, 'reason', d.reason, 'reasonCode', d.reason_code,
            'subject', null, 'level', null, 'by', p.display_name, 'at', d.decided_at)
          from public.review_dispositions d
          join public.profiles p on p.id = d.decided_by
          where d.asset_id = v_asset.id
        ) hh
        order by hh.at desc, hh.seq desc
        limit 50
      ) h), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Label corrected: tell the contributor (FA-7)
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'retake_requested', 'assigned', 'upload_problem', 'review_digest', 'exception', 'label_corrected'));

-- A reviewer matched a staff-labelled photo to another dish (Fix label): the
-- contributor sees "Label corrected" in their inbox, once per correction.
create function private.notify_on_label_corrected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.menu_item_photos;
begin
  if new.action <> 'accepted' or new.actor_id is not distinct from new.author_id then
    return null;
  end if;
  select p.* into v_photo from public.menu_item_photos p where p.id = new.photo_id;
  if v_photo.basis is distinct from 'reviewer' or v_photo.corrects_item_id is null then
    return null;
  end if;
  perform private.notify(new.author_id, new.venue_id, 'label_corrected', 'menu_item',
    new.item_id::text, format('label:menu_photo:%s', new.photo_id),
    jsonb_strip_nulls(jsonb_build_object('source', 'menu_photo', 'itemId', new.item_id,
      'photoId', new.photo_id, 'itemName', v_photo.item_name,
      'fromItemName', (select li.item_name from public.media_label_items li
        where li.asset_id = v_photo.asset_id and li.item_id = v_photo.corrects_item_id
        order by li.added_at limit 1))),
    new.created_at);
  return null;
end;
$$;

revoke all on function private.notify_on_label_corrected() from public, anon, authenticated;

create trigger menu_item_photo_events_label_corrected
  after insert on public.menu_item_photo_events
  for each row execute function private.notify_on_label_corrected();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer, text, integer, boolean, boolean)
from public, anon;
grant execute on function
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer, text, integer, boolean, boolean)
to authenticated, service_role;

revoke all on function public.review_set_aside(uuid, text, text, text, uuid, bigint) from public, anon, service_role;
revoke all on function public.review_decide_area_photo(uuid, text, text, text, bigint) from public, anon, service_role;
revoke all on function public.review_decide_amenity_photo(uuid, uuid, text, text, text, bigint) from public, anon, service_role;
revoke all on function public.review_photo_detail(uuid) from public, anon, service_role;
grant execute on function public.review_set_aside(uuid, text, text, text, uuid, bigint) to authenticated;
grant execute on function public.review_decide_area_photo(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.review_decide_amenity_photo(uuid, uuid, text, text, text, bigint) to authenticated;
grant execute on function public.review_photo_detail(uuid) to authenticated;
