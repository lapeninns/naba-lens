-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R6 (K11 part: M3-suspend; spec §7 M3
-- "immediately suspend inaccurate media from public use"; checklist
-- M3-suspend).
--
-- Library "Withdraw from use" (S2-LIBRARY) keeps every review decision, so a
-- slot the photo fills still counts as covered. public.library_suspend_asset
-- is the stronger action: in one transaction it
--   1. withdraws the photo in the Library (no exports, no main photo), and
--   2. withdraws every approval it holds through the review's own decision
--      functions, so each slot it filled counts its other photos only (empty
--      when it has none) and the review history records who and why:
--        dish      public.withdraw_menu_item_photo (accepted, asked for a
--                  recheck or for another photo: the live row of each dish)
--        place     public.decide_area_photo_level(..., 'withdrawn')
--        facility  public.decide_amenity_photo(..., 'withdrawn')
-- Those functions keep their own checks (venue scope, self-review, revision,
-- primary hand-over); any refusal undoes the whole suspension. Restore (the
-- Library withdrawal) does not bring approvals back: the photo is reviewed
-- again, as after any withdrawal.
--
-- Admins on an aal2 session only (private.library_assert_admin).
--
-- Rollback: revoke execute on public.library_suspend_asset and drop it.

create function public.library_suspend_asset(p_asset_id uuid, p_reason text)
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

  -- Place approvals: labels whose latest decision is an acceptance.
  for v_row in
    select l.id from public.media_area_labels l
    where l.asset_id = p_asset_id and l.removed_at is null
      and (select d.action from public.area_photo_decisions d
           where d.label_id = l.id order by d.id desc limit 1) = 'accepted'
    order by l.id
  loop
    perform 1 from public.decide_area_photo_level(v_row.id, 'withdrawn', 'public', v_reason);
    v_places := v_places + 1;
  end loop;

  -- Facility approvals: checks whose latest decision on this photo accepts it.
  for v_row in
    select x.check_id from (
      select distinct on (d.check_id) d.check_id, d.action
      from public.amenity_photo_decisions d
      where d.asset_id = p_asset_id
      order by d.check_id, d.id desc
    ) x
    where x.action = 'accepted'
    order by x.check_id
  loop
    perform 1 from public.decide_amenity_photo(v_row.check_id, p_asset_id, 'withdrawn', 'public', v_reason);
    v_facilities := v_facilities + 1;
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
    'approvals', jsonb_build_object('dishes', v_dishes, 'places', v_places,
      'facilities', v_facilities));
end;
$$;

revoke all on function public.library_suspend_asset(uuid, text) from public, anon, service_role;
grant execute on function public.library_suspend_asset(uuid, text) to authenticated;
