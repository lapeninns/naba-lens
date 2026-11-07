-- Menu activation invalidates every open review of an item on the new version.
--
-- 20261106130000 bumped item heads only for items with an accepted photo, so a
-- reviewer holding a candidate for an item with no accepted photo (or only
-- better-photo or recheck decisions) kept a valid revision across a material
-- rename and could accept against the dish they never saw. Every item on the
-- activated version that could be under review (it has a head row or a label)
-- now gets one increment; a stale decision then fails with coverage_conflict
-- and the reviewer reloads the current entry.
--
-- Heads are bumped in item_id order, matching the label-removal trigger, so the
-- two paths take item head locks in the same order.

create or replace function private.bump_item_photo_heads(p_item_ids uuid[], p_venue_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.menu_item_photo_heads as h (item_id, venue_id, revision)
  select u.id, p_venue_id, 2
  from (select distinct x.id from unnest(p_item_ids) as x(id)) u
  order by u.id
  on conflict (item_id) do update set revision = h.revision + 1;
$$;

create or replace function private.reconcile_menu_item_photos(p_venue_id uuid, p_version_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_kind text;
  v_items uuid[];
  v_lost uuid[] := '{}'::uuid[];
begin
  -- Only an item someone could already be reviewing can hold a stale revision:
  -- one with a head row or a photo labelled with it. A brand-new item cannot.
  select array_agg(distinct e.item_id) into v_items
  from public.menu_entries e
  where e.version_id = p_version_id
    and (exists (select 1 from public.menu_item_photo_heads h where h.item_id = e.item_id)
      or exists (select 1 from public.media_label_items l
                 where l.item_id = e.item_id and l.venue_id = p_venue_id));
  if v_items is null then
    return;
  end if;
  perform private.bump_item_photo_heads(v_items, p_venue_id);

  for v_row in
    select p.id, p.item_id, p.variant_id, p.item_name, p.section_kind as old_kind, p.is_primary,
      e.name as entry_name, s.name as section_name, s.kind as new_kind,
      ev.variant_id as offered_variant, ev.name as variant_name
    from public.menu_item_photos p
    join public.menu_entries e on e.version_id = p_version_id and e.item_id = p.item_id
    join public.menu_sections s on s.id = e.section_id
    left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p.variant_id
    where p.venue_id = p_venue_id and p.state = 'accepted'
    order by p.item_id, p.id
    for update of p
  loop
    v_kind := case
      when v_row.variant_id is not null and v_row.offered_variant is null then 'variant_removed'
      when private.menu_name_key(v_row.entry_name) <> private.menu_name_key(v_row.item_name) then 'name_changed'
      when v_row.new_kind <> v_row.old_kind then 'section_changed'
    end;
    if v_kind is null then
      update public.menu_item_photos p
      set menu_version_id = p_version_id, item_name = v_row.entry_name,
          section_name = v_row.section_name, variant_name = v_row.variant_name,
          revision = p.revision + 1
      where p.id = v_row.id;
      perform private.record_item_photo_event(v_row.id, 'carried', 'accepted', null, false, null, 'system',
        jsonb_build_object('menuVersionId', p_version_id));
    else
      if v_row.is_primary then
        v_lost := v_lost || v_row.item_id;
      end if;
      update public.menu_item_photos p
      set state = 'needs_recheck', recheck_kind = v_kind, is_primary = false, revision = p.revision + 1
      where p.id = v_row.id;
      perform private.record_item_photo_event(v_row.id, 'needs_recheck', 'accepted', null, false, null, 'system',
        jsonb_build_object('kind', v_kind, 'menuVersionId', p_version_id));
    end if;
  end loop;

  for v_row in select distinct u.id from unnest(v_lost) as u(id) loop
    perform private.promote_item_primary(v_row.id, 'system');
  end loop;
end;
$$;
