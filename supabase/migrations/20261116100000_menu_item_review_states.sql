-- G-1 (goals-not-tasks decision 11): whether each listed dish has a photo
-- waiting for review, for every viewer at the venue.
--
-- * public.menu_item_review_states(p_venue_id, p_item_ids): for each listed
--   item with a labelled photo waiting, `waiting` (a first decision is still
--   to be made) and `rechecking` (an accepted photo is being checked again
--   after a menu change). Still needed rows say "Waiting for review" or
--   "Being checked", so a colleague knows a photo is on its way and may still
--   add another.
-- * It reads the same waiting set as the manager's overview
--   (private.menu_photo_pending_tuples with p_admin = true: every uploader's
--   photo, a manager's own included, since another reviewer decides on it),
--   so it reimplements no rule. It returns item ids and two flags only:
--   never who took the photo, how many there are, or any photo id.
-- * The venue is checked by private.menu_photo_read_venue, as for
--   menu_item_photo_items: staff (managers included) their own venue, admins
--   any venue. Read-only; nothing existing is re-created.
--
-- Rollback: drop the function; Our menu then shows no review state per dish.

create function public.menu_item_review_states(p_venue_id uuid, p_item_ids uuid[])
returns table (item_id uuid, waiting boolean, rechecking boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid;
begin
  perform private.amenity_assert_active_user();
  if p_item_ids is null or cardinality(p_item_ids) > 100 then
    raise exception 'invalid_item_list' using errcode = '22023';
  end if;
  v_venue := private.menu_photo_read_venue(p_venue_id);
  return query
  select t.item_id, bool_or(not t.is_recheck), bool_or(t.is_recheck)
  from private.menu_photo_pending_tuples(v_venue, true) t
  where t.item_id = any(p_item_ids)
  group by t.item_id;
end;
$$;

revoke all on function public.menu_item_review_states(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.menu_item_review_states(uuid, uuid[]) to authenticated;
