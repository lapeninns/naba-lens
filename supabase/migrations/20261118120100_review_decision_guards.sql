-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R1: guards on the review decision paths.
--
--   V3   Place and amenity decisions lock the photo's media_assets row
--        (for update) before they decide, as the dish path does, and re-check
--        under that lock that it is still ready and not removed. The R28
--        withdraw (public.delete_media_asset, 20261118108600) takes the same
--        lock, so an acceptance and a withdrawal of one photo never pass each
--        other: whichever comes second sees the first. Lock order everywhere
--        is the asset row, then the label or check row (as
--        public.review_set_aside), so the two never deadlock.
--   V15  A photo set aside (Not used or Mark duplicate, the latest
--        review_dispositions row) is never accepted or asked again for a
--        dish: a trigger on public.menu_item_photos refuses it with
--        review_conflict (40001) and the disposition in the detail, whichever
--        function writes the row (review_menu_item_photo,
--        set_menu_item_photo_level, assign_menu_item_photo). Every dish
--        decision path locks the asset row first, as review_set_aside does,
--        so the check reads the committed disposition.
--        The same rule holds for place and amenity acceptances here.
--   K6   Place and amenity decisions allow the venue's manager on their own
--        photo at a single-reviewer venue (private.review_self_allowed).
--
-- Rollback: re-apply public.decide_area_photo_level and
-- public.decide_amenity_photo (20261118100100), public.review_decide_area_photo
-- and public.review_decide_amenity_photo (20261118110000); drop the trigger
-- and its function.

-- ---------------------------------------------------------------------------
-- V15: a set-aside photo is never accepted for a dish
-- ---------------------------------------------------------------------------

create function private.menu_item_photos_not_set_aside()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest bigint;
begin
  if new.state not in ('accepted', 'better_photo_requested') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.state is not distinct from new.state then
    return new;
  end if;
  if private.asset_set_aside(new.asset_id) then
    select d.id into v_latest from public.review_dispositions d
    where d.asset_id = new.asset_id order by d.id desc limit 1;
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('disposition', v_latest);
  end if;
  return new;
end;
$$;

revoke all on function private.menu_item_photos_not_set_aside() from public, anon, authenticated, service_role;

create trigger menu_item_photos_not_set_aside
  before insert or update of state on public.menu_item_photos
  for each row execute function private.menu_item_photos_not_set_aside();

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

-- Body as in 20261118100100, plus: the asset row is locked first (V3), a
-- set-aside photo is not accepted or asked again (V15), and the venue's
-- manager may decide on their own photo at a single-reviewer venue (K6).
create or replace function public.decide_area_photo_level(
  p_label_id uuid,
  p_action text,
  p_level text default 'public',
  p_reason text default null
)
returns table (label_id uuid, state text, review_level text, changed boolean)
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
  v_asset_id uuid;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_level text := coalesce(p_level, 'public');
  v_current text;
  v_current_level text;
  v_latest bigint;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if v_level not in ('public', 'reference') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if p_action <> 'accepted' then
    v_level := 'public';
  end if;

  -- Lock order: the asset row, then the label (labels never change asset).
  select l.asset_id into v_asset_id from public.media_area_labels l where l.id = p_label_id;
  if v_asset_id is null then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  select a.* into v_asset from public.media_assets a where a.id = v_asset_id for update;
  select l.* into v_label from public.media_area_labels l where l.id = p_label_id for update;
  if not found or not private.can_manage_venue(v_label.venue_id) then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  if v_label.removed_at is not null
     or v_asset.id is null
     or v_label.added_by <> v_asset.uploader_id
     or v_asset.media_type <> 'image'
     or v_asset.upload_state <> 'ready'
     or v_asset.deleted_at is not null then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  if (v_asset.uploader_id = v_uid or v_label.added_by = v_uid)
     and not private.review_self_allowed(v_label.venue_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if p_action <> 'accepted' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_action in ('accepted', 'needs_another_photo') and private.asset_set_aside(v_asset.id) then
    select d.id into v_latest from public.review_dispositions d
    where d.asset_id = v_asset.id order by d.id desc limit 1;
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('disposition', v_latest);
  end if;

  select coalesce(d.action, 'pending'), coalesce(d.review_level, 'public')
  into v_current, v_current_level
  from (select 1) one
  left join lateral (
    select x.action, x.review_level from public.area_photo_decisions x
    where x.label_id = v_label.id order by x.id desc limit 1
  ) d on true;

  if v_current = p_action and (p_action <> 'accepted' or v_current_level = v_level) then
    return query select v_label.id, v_current, v_current_level, false;
    return;
  end if;
  if not (
    (v_current = 'pending' and p_action in ('accepted', 'needs_another_photo', 'not_used'))
    or (v_current = 'needs_another_photo' and p_action in ('accepted', 'not_used'))
    or (v_current = 'not_used' and p_action = 'accepted')
    or (v_current = 'accepted' and p_action in ('accepted', 'withdrawn'))
  ) then
    raise exception 'area_photo_conflict' using errcode = '40001',
      detail = jsonb_build_object('state', v_current)::text;
  end if;

  insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, review_level, reason, decided_by)
  values (v_label.id, v_label.venue_id, v_label.asset_id, p_action, v_level, v_reason, v_uid);
  return query select v_label.id, p_action, v_level, true;
end;
$$;

-- Body as in 20261118110000, with the asset row locked before the label
-- (the lock order of public.decide_area_photo_level).
create or replace function public.review_decide_area_photo(
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
  perform 1 from public.media_assets a
  where a.id = (select l.asset_id from public.media_area_labels l where l.id = p_label_id)
  for update;
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
  select r.label_id, r.state, r.review_level, r.changed
  into v_row
  from public.decide_area_photo_level(p_label_id, p_action, p_level, p_reason) r;
  return query
  select v_row.label_id, v_row.state, v_row.review_level, v_row.changed,
    (select d.id from public.area_photo_decisions d where d.label_id = p_label_id order by d.id desc limit 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Amenities
-- ---------------------------------------------------------------------------

-- Body as in 20261118100100, plus: the asset row is locked first (V3; the
-- reverse order, where a withdrawal commits between the read and the insert,
-- is now closed), a set-aside photo is not accepted or asked again (V15), and
-- the K6 single-reviewer rule.
create or replace function public.decide_amenity_photo(
  p_check_id uuid,
  p_asset_id uuid,
  p_action text,
  p_level text default 'public',
  p_reason text default null
)
returns table (check_id uuid, asset_id uuid, state text, review_level text, changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_check public.venue_amenity_checks;
  v_row record;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_level text := coalesce(p_level, 'public');
  v_latest bigint;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if v_level not in ('public', 'reference') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if p_action <> 'accepted' then
    v_level := 'public';
  end if;

  -- Lock order: the asset row, then the check.
  perform 1 from public.media_assets a where a.id = p_asset_id for update;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  if not found or not private.can_manage_venue(v_check.venue_id) then
    raise exception 'amenity_photo_not_found' using errcode = 'P0002';
  end if;
  -- Read after the lock: a removed or not-ready photo has no row.
  select r.* into v_row
  from private.amenity_photo_rows(v_check.venue_id) r
  where r.check_id = p_check_id and r.asset_id = p_asset_id;
  if not found then
    raise exception 'amenity_photo_not_found' using errcode = 'P0002';
  end if;
  if v_row.uploader_id = v_uid and not private.review_self_allowed(v_check.venue_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if p_action <> 'accepted' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_action in ('accepted', 'needs_another_photo') and private.asset_set_aside(p_asset_id) then
    select d.id into v_latest from public.review_dispositions d
    where d.asset_id = p_asset_id order by d.id desc limit 1;
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('disposition', v_latest);
  end if;
  if v_row.state = p_action and (p_action <> 'accepted' or v_row.review_level = v_level) then
    return query select p_check_id, p_asset_id, v_row.state, v_row.review_level, false;
    return;
  end if;
  if not (
    (v_row.state = 'pending' and p_action in ('accepted', 'needs_another_photo', 'not_used'))
    or (v_row.state = 'needs_another_photo' and p_action in ('accepted', 'not_used'))
    or (v_row.state = 'not_used' and p_action = 'accepted')
    or (v_row.state = 'accepted' and p_action in ('accepted', 'withdrawn'))
  ) then
    raise exception 'amenity_photo_conflict' using errcode = '40001',
      detail = jsonb_build_object('state', v_row.state)::text;
  end if;

  insert into public.amenity_photo_decisions (check_id, venue_id, asset_id, action, review_level, reason, decided_by)
  values (p_check_id, v_check.venue_id, p_asset_id, p_action, v_level, v_reason, v_uid);
  return query select p_check_id, p_asset_id, p_action, v_level, true;
end;
$$;

-- Body as in 20261118110000, with the asset row locked before the check.
create or replace function public.review_decide_amenity_photo(
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
  perform 1 from public.media_assets a where a.id = p_asset_id for update;
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
