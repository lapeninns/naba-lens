-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, review repair (PR 34): a running special is a dish slot for
-- coverage, review and the manager's photo list (20261118103100,
-- 20261118137000), so a manager can set its needed-by date too. Before, the
-- setter required an active-menu entry and always refused a special with
-- menu_item_unavailable.
--
-- Body as in 20261116150000, except the offering check, which now uses
-- private.is_current_photo_item (food and drinks, active entries and running
-- specials). Signature, errors, locks and grants are unchanged.
--
-- Rollback: re-apply public.set_menu_item_needed_by from 20261116150000.

create or replace function public.set_menu_item_needed_by(
  p_item_id uuid,
  p_needed_by date,
  p_venue_id uuid default null
)
returns table (item_id uuid, venue_id uuid, needed_by date, set_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_role text;
  v_today date := private.london_today();
  v_at timestamptz := now();
begin
  perform private.assert_can_manage_venue(v_venue);
  v_role := case when private.is_active_admin() then 'admin' else 'manager' end;
  if p_item_id is null
     or not exists (select 1 from public.menu_items i where i.id = p_item_id and i.venue_id = v_venue) then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  if p_needed_by is null or p_needed_by < v_today or p_needed_by > v_today + 366 then
    raise exception 'invalid_needed_by' using errcode = '22023';
  end if;
  -- Same lock as reviews and menu changes: the menu and the dish's photos
  -- cannot change under this check.
  perform private.lock_venue_menu(v_venue, true);
  -- A current food or drinks dish: an active-menu entry or a running special
  -- (private.is_current_photo_item, 20261118103100).
  if not private.is_current_photo_item(v_venue, p_item_id) then
    raise exception 'menu_item_unavailable' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = p_item_id and p.state = 'accepted'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  ) then
    raise exception 'menu_item_has_photo' using errcode = '55000';
  end if;

  insert into public.menu_item_needed_by as n
    (item_id, venue_id, needed_by, set_by, set_by_role, set_at)
  values (p_item_id, v_venue, p_needed_by, v_uid, v_role, v_at)
  on conflict on constraint menu_item_needed_by_pkey do update
  set needed_by = excluded.needed_by, set_by = excluded.set_by,
    set_by_role = excluded.set_by_role, set_at = excluded.set_at,
    cleared_at = null, cleared_by = null, cleared_by_role = null;
  insert into public.menu_item_needed_by_events (item_id, venue_id, action, needed_by, actor_id, actor_role, created_at)
  values (p_item_id, v_venue, 'set', p_needed_by, v_uid, v_role, v_at);

  item_id := p_item_id;
  venue_id := v_venue;
  needed_by := p_needed_by;
  set_at := v_at;
  return next;
end;
$$;
