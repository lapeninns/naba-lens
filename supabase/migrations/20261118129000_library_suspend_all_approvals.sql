-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R11: W8 and W9 (S3-repair-review.md).
--
-- public.library_suspend_asset (20261118125500) withdrew place and facility
-- approvals through public.decide_area_photo_level and
-- public.decide_amenity_photo. Those are the reviewer's functions, with the
-- reviewer's guards, and two of the guards made the whole suspension roll back:
--
--   W8  decide_amenity_photo reads the photo through
--       private.amenity_photo_rows, which lists active, in-scope checks only.
--       A photo accepted on a check later archived or put out of scope raised
--       amenity_photo_not_found, so the admin could not suspend it at all and
--       it stayed public through its dish approval.
--   W9  Both functions refuse the photo's uploader (self_review_not_allowed),
--       and private.review_self_allowed is never true for an admin. An admin
--       could not suspend a photo they had uploaded once a place or facility
--       accepted it.
--
-- Suspending only takes a photo out of use, so neither guard protects
-- anything here (the dish path, public.withdraw_menu_item_photo, already lets
-- an admin withdraw their own photo). The place and facility withdrawals are
-- now written by this function itself, under the same locks and in the same
-- order as the review functions (the asset row first, then the label or the
-- check, as V3), re-reading the latest decision under the lock. Every
-- acceptance is withdrawn, including one on an archived or out-of-scope
-- check: if that check comes back, the suspended photo does not cover it
-- again. Each row is an ordinary decision row: the append-only, previous
-- decision and notification triggers on the decision tables run as before.
-- Dish approvals still go through public.withdraw_menu_item_photo.
--
-- Body as in 20261118125500 apart from the place and facility loops.
--
-- Rollback: re-apply public.library_suspend_asset from 20261118125500.

create or replace function public.library_suspend_asset(p_asset_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_reason text;
  v_asset record;
  v_row record;
  v_latest text;
  v_dishes integer := 0;
  v_places integer := 0;
  v_facilities integer := 0;
  v_withdrawn boolean := false;
begin
  select a.id, a.venue_id, a.deleted_at into v_asset
  from public.media_assets a where a.id = p_asset_id for update;
  if v_asset.id is null or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.library_reason(p_reason);

  -- Dish approvals: the live row of each (dish, variant).
  for v_row in
    select p.id, p.item_id from public.menu_item_photos p
    where p.asset_id = p_asset_id
      and p.state in ('accepted', 'needs_recheck', 'better_photo_requested')
    order by p.item_id, p.id
  loop
    perform 1 from public.withdraw_menu_item_photo(
      v_row.id,
      coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = v_row.item_id), 1),
      v_reason);
    v_dishes := v_dishes + 1;
  end loop;

  -- Place approvals: each label of this photo whose latest decision accepts
  -- it. Lock the label (after the asset), then re-read its latest decision.
  for v_row in
    select l.id, l.venue_id from public.media_area_labels l
    where l.asset_id = p_asset_id and l.removed_at is null
    order by l.id
    for update of l
  loop
    select d.action into v_latest from public.area_photo_decisions d
    where d.label_id = v_row.id order by d.id desc limit 1;
    if v_latest is not distinct from 'accepted' then
      insert into public.area_photo_decisions
        (label_id, venue_id, asset_id, action, review_level, reason, decided_by)
      values (v_row.id, v_row.venue_id, p_asset_id, 'withdrawn', 'public', v_reason, v_uid);
      v_places := v_places + 1;
    end if;
  end loop;

  -- Facility approvals: every check whose latest decision on this photo
  -- accepts it, whatever the check's status or scope (W8). Lock the check
  -- (after the asset), then re-read the latest decision.
  for v_row in
    select c.id, c.venue_id from public.venue_amenity_checks c
    where c.id in (select d.check_id from public.amenity_photo_decisions d where d.asset_id = p_asset_id)
    order by c.id
    for update of c
  loop
    select d.action into v_latest from public.amenity_photo_decisions d
    where d.check_id = v_row.id and d.asset_id = p_asset_id order by d.id desc limit 1;
    if v_latest is not distinct from 'accepted' then
      insert into public.amenity_photo_decisions
        (check_id, venue_id, asset_id, action, review_level, reason, decided_by)
      values (v_row.id, v_row.venue_id, p_asset_id, 'withdrawn', 'public', v_reason, v_uid);
      v_facilities := v_facilities + 1;
    end if;
  end loop;

  -- Withdrawn in the Library too (exports and main photo stop).
  if not exists (select 1 from public.media_asset_withdrawals w where w.asset_id = p_asset_id) then
    insert into public.media_asset_withdrawals (asset_id, venue_id, withdrawn_by, reason)
    values (p_asset_id, v_asset.venue_id, v_uid, left('Suspended: ' || v_reason, 500));
    insert into public.media_asset_withdrawal_events (asset_id, venue_id, action, reason, actor_id)
    values (p_asset_id, v_asset.venue_id, 'withdrawn', left('Suspended: ' || v_reason, 500), v_uid);
    v_withdrawn := true;
  end if;

  if v_withdrawn or v_dishes + v_places + v_facilities > 0 then
    perform private.record_activity(v_asset.venue_id, 'library_asset_suspended', 'media_asset',
      p_asset_id::text, null, null, v_reason, null,
      jsonb_build_object('dishes', v_dishes, 'places', v_places, 'facilities', v_facilities));
  end if;
  return jsonb_build_object('assetId', p_asset_id, 'withdrawn', true,
    'changed', v_withdrawn or v_dishes + v_places + v_facilities > 0,
    'slots', jsonb_build_object('dishes', v_dishes, 'places', v_places,
      'facilities', v_facilities));
end;
$$;

revoke all on function public.library_suspend_asset(uuid, text) from public, anon, service_role;
grant execute on function public.library_suspend_asset(uuid, text) to authenticated;
