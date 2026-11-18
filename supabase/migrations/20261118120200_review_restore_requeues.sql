-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R1: Restore ("Used again") puts a photo's place and amenity
-- rows back in their queues (V17), and the single-reviewer rule (K6) for set
-- aside.
--
--   Link     area_photo_decisions and amenity_photo_decisions gain
--            disposition_id: the Not used rows public.review_set_aside writes
--            for a set-aside photo carry the review_dispositions id that
--            caused them.
--   Restore  public.review_set_aside('restored') reopens each of the photo's
--            place and amenity rows whose latest decision is one of those Not
--            used rows (or, for rows written before this migration, a Not
--            used row by the same person at the same moment as the set
--            aside):
--              place    the label is closed and the same label is added
--                       again (same place, labeller and labelled time), so
--                       every place reader sees a label with no decision,
--                       which is waiting. The closed label keeps its history.
--              amenity  a 'pending' decision is appended (amenity state is
--                       always the latest decision, and private.amenity_photo_rows
--                       reads 'pending' as waiting).
--            A row someone decided again after the set aside is left alone.
--   K6       a manager may set aside or restore their own photo at a
--            single-reviewer venue.
--
-- Rollback: re-apply public.review_set_aside (20261118110000); the column
-- and the wider action check may stay.

alter table public.area_photo_decisions add column disposition_id bigint;
alter table public.amenity_photo_decisions add column disposition_id bigint;

comment on column public.area_photo_decisions.disposition_id is
  'S3-R1 V17: the review_dispositions row (Not used or Mark duplicate) that wrote this Not used decision; Restore reopens it.';
comment on column public.amenity_photo_decisions.disposition_id is
  'S3-R1 V17: the review_dispositions row (Not used or Mark duplicate) that wrote this Not used decision; Restore reopens it.';

alter table public.amenity_photo_decisions
  drop constraint amenity_photo_decisions_action_check,
  add constraint amenity_photo_decisions_action_check
    check (action in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn', 'pending'));

comment on constraint amenity_photo_decisions_action_check on public.amenity_photo_decisions is
  'pending: S3-R1 V17, written only by Restore; the photo waits again.';

-- Body as in 20261118110000, plus: the Not used rows it writes carry the
-- disposition id, Restore reopens them (V17), and the K6 single-reviewer
-- rule.
create or replace function public.review_set_aside(
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
  if v_asset.uploader_id = v_uid and not private.is_active_admin()
     and not private.review_self_allowed(v_asset.venue_id) then
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
      insert into public.area_photo_decisions (
        label_id, venue_id, asset_id, action, review_level, reason, decided_by, disposition_id)
      values (v_row.id, v_row.venue_id, p_asset_id, 'not_used', 'public', v_area_reason, v_uid, v_id);
    end loop;
    -- Waiting amenity rows of this photo.
    for v_row in
      select r.check_id from private.amenity_photo_rows(v_asset.venue_id) r
      where r.asset_id = p_asset_id and r.state = 'pending'
    loop
      insert into public.amenity_photo_decisions (
        check_id, venue_id, asset_id, action, review_level, reason, decided_by, disposition_id)
      values (v_row.check_id, v_asset.venue_id, p_asset_id, 'not_used', 'public', v_area_reason, v_uid, v_id);
    end loop;
  else
    -- Restore: the place and amenity rows the set aside closed wait again.
    for v_row in
      select l.* from public.media_area_labels l
      cross join lateral (
        select d.action, d.disposition_id, d.decided_by, d.decided_at from public.area_photo_decisions d
        where d.label_id = l.id order by d.id desc limit 1) d
      where l.asset_id = p_asset_id and l.removed_at is null
        and d.action = 'not_used'
        and (d.disposition_id = v_latest.id
          or (d.disposition_id is null and d.decided_by = v_latest.decided_by
            and d.decided_at = v_latest.decided_at))
    loop
      update public.media_area_labels l
      set removed_at = now(), removed_by = v_uid
      where l.id = v_row.id;
      insert into public.media_area_labels (
        asset_id, venue_id, subject_id, subject_kind, subject_label, added_by, added_at)
      values (v_row.asset_id, v_row.venue_id, v_row.subject_id, v_row.subject_kind,
        v_row.subject_label, v_row.added_by, v_row.added_at);
    end loop;
    for v_row in
      select d.check_id from public.amenity_photo_decisions d
      where d.asset_id = p_asset_id and d.venue_id = v_asset.venue_id
        and d.id = (select max(x.id) from public.amenity_photo_decisions x
          where x.check_id = d.check_id and x.asset_id = d.asset_id)
        and d.action = 'not_used'
        and (d.disposition_id = v_latest.id
          or (d.disposition_id is null and d.decided_by = v_latest.decided_by
            and d.decided_at = v_latest.decided_at))
    loop
      insert into public.amenity_photo_decisions (
        check_id, venue_id, asset_id, action, review_level, reason, decided_by, disposition_id)
      values (v_row.check_id, v_asset.venue_id, p_asset_id, 'pending', 'public', 'Used again', v_uid, v_id);
    end loop;
  end if;

  return jsonb_build_object('assetId', p_asset_id, 'dispositionId', v_id, 'action', p_action,
    'duplicateOf', case when p_action = 'duplicate' then p_duplicate_of end);
end;
$$;
