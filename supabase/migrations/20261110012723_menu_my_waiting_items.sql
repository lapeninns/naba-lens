-- B02 addition: the caller's own menu photos waiting for review, per item
-- (UI UP-25, "Your photo is waiting for review" on an Our menu dish row).
--
-- * public.my_menu_waiting_items(p_venue_id, p_item_ids): for each listed item,
--   how many of the caller's own photos wait for a decision or a recheck at
--   the venue. It reads the same waiting set as the menu-photo overview's
--   own_waiting_photos (private.menu_photo_pending_tuples with own_only), so
--   it reimplements no rule. Own photos only (D3); never anyone else's.
-- * Nothing existing is re-created: menu_item_photo_items,
--   manager_menu_photo_overview and manager_menu_photo_queue are unchanged.
--
-- Rollback: drop the function; the Our menu read then leaves myWaiting out.

create function public.my_menu_waiting_items(p_venue_id uuid, p_item_ids uuid[])
returns table (item_id uuid, waiting integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.amenity_assert_active_user();
  if p_item_ids is null or cardinality(p_item_ids) > 100 then
    raise exception 'invalid_item_list' using errcode = '22023';
  end if;
  -- A photo labelled with two variants of one item counts once.
  return query
  select t.item_id, count(distinct t.asset_id)::integer
  from private.menu_photo_pending_tuples(p_venue_id, false, true) t
  where t.item_id = any(p_item_ids)
  group by t.item_id;
end;
$$;

revoke all on function public.my_menu_waiting_items(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.my_menu_waiting_items(uuid, uuid[]) to authenticated;
