-- One review per photo, ORP-3b (docs/plans/one-review-per-photo.md): what
-- accepting a labelled photo for an item also counts for, shown on the
-- manager's review card ("Also counts for: Starters · Priya's November").
-- Read-only and derived from the same rules as ORP-1
-- (20261115100000_menu_photo_counts.sql):
--   * tasks: the venue's current menu_section requirements whose section, in
--     the requirement's menu version, holds the item;
--   * month: the London month the upload started, only for a still image the
--     uploader labelled with that item themselves.
-- Scope: a manager of the venue (manager account or legacy grant) or an admin
-- naming it, as manager_menu_photo_queue. At most 50 photos per call.

create function public.menu_photo_also_counts(p_venue_id uuid, p_asset_ids uuid[])
returns table (
  asset_id uuid,
  item_id uuid,
  task_titles text[],
  credit_month date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  perform private.assert_can_manage_venue(v_venue);
  if p_asset_ids is null or cardinality(p_asset_ids) > 50 then
    raise exception 'invalid_asset_ids' using errcode = '22023';
  end if;

  return query
  select li.asset_id, li.item_id,
    coalesce(array(
      select r.title
      from public.coverage_requirements r
      join public.menu_entries me
        on me.version_id = r.menu_version_id
        and me.section_id = r.menu_section_id
        and me.venue_id = r.venue_id
      where r.venue_id = v_venue
        and r.kind = 'menu_section'
        and me.item_id = li.item_id
        and private.requirement_is_current(r.id)
      order by r.title
    ), '{}'::text[]),
    case
      when bool_or(li.added_by = a.uploader_id) and a.media_type = 'image'
        then private.london_month(a.created_at)
    end
  from public.media_label_items li
  join public.media_assets a on a.id = li.asset_id and a.venue_id = li.venue_id
  where li.venue_id = v_venue
    and li.asset_id = any(p_asset_ids)
  group by li.asset_id, li.item_id, a.uploader_id, a.media_type, a.created_at;
end;
$$;

revoke all on function public.menu_photo_also_counts(uuid, uuid[]) from public, anon;
grant execute on function public.menu_photo_also_counts(uuid, uuid[]) to authenticated, service_role;
