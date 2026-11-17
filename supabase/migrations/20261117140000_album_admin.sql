-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Album A4, admin albums (docs/design-system/DESIGN.md §6.6; plan
-- docs/plans/album-a3-a5.md AL-5, 17 Nov 2026): every venue's album as
-- "filled of total" for Food, Drinks, Amenities and Areas.
--
-- Areas already have an admin-scoped read (public.album_area_states names
-- the venue). Dishes and amenities do not: staff Album reads them through
-- the caller's own venue (menu_item_photo_items pages, the knowledge working
-- list), and Our menu's summary counts an item with an accepted photo as
-- covered even while a recheck is open, where Album shows it as empty. So
-- one admin-only read gives, for a named venue:
--
--   sections   each active-menu food or drinks section: its eligible items,
--              those accepted (an accepted photo and no open recheck, as
--              lib/album/model.ts dishState) and those waiting (not accepted,
--              with a labelled photo waiting for a decision)
--   amenities  each in-scope active amenity question on the venue's list:
--              its catalogue category, progress, the answer in use when
--              available, and whether any finding is still open. The slot
--              state is worked out in lib/album/model.ts amenityState, the
--              same rule staff Album uses.
--
-- Admins only. No table, no write; nothing here changes coverage, amenity,
-- credit or review rules.
--
-- Rollback: drop function public.album_admin_counts(uuid).

create function public.album_admin_counts(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_active uuid;
begin
  if not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_venue_id is null then
    raise exception 'venue_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_active := private.active_menu_version_id(p_venue_id);

  return jsonb_build_object(
    'venueId', p_venue_id,
    'menuState', case when v_active is null then 'no_menu' else 'ready' end,
    'sections', case when v_active is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'sectionId', g.section_id, 'name', g.section_name, 'kind', g.section_kind,
          'total', g.total, 'accepted', g.accepted, 'waiting', g.waiting)
        order by g.section_position, g.section_id)
      from (
        select r.section_id, r.section_name, r.section_kind, r.section_position,
          count(*)::integer as total,
          (count(*) filter (where r.covered and r.needs_recheck_count = 0))::integer as accepted,
          (count(*) filter (
            where not (r.covered and r.needs_recheck_count = 0)
              and coalesce(r.candidate_count, 0) > 0))::integer as waiting
        from private.menu_item_photo_rows(p_venue_id, true, true) r
        group by r.section_id, r.section_name, r.section_kind, r.section_position
      ) g
    ), '[]'::jsonb) end,
    'amenities', coalesce((
      select jsonb_agg(jsonb_build_object(
          'checkId', c.id,
          'category', t.category,
          'progress', c.progress,
          'answer', case when s.slot ->> 'status' = 'available'
            then s.slot -> 'answerInUse' ->> 'value' end,
          'open', exists (
            select 1 from public.knowledge_contributions x
            where x.check_id = c.id and not private.knowledge_is_terminal(x.id)))
        order by t.position, c.template_key)
      from public.venue_amenity_checks c
      join public.amenity_catalogue t on t.key = c.template_key
      cross join lateral (
        select private.knowledge_slot_json(c, v_uid, 'admin') as slot
      ) s
      where c.venue_id = p_venue_id and c.status = 'active'
        and private.knowledge_in_scope(c.venue_id, c.template_key)
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.album_admin_counts(uuid) is
  'Album A4 (DESIGN.md §6.6): an admin''s read of one venue''s dish and amenity slots for /admin/albums.';

revoke all on function public.album_admin_counts(uuid) from public, anon, service_role;
grant execute on function public.album_admin_counts(uuid) to authenticated;
