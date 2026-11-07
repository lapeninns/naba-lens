-- Review queue: one card per reviewer recheck.
--
-- 20261107100500's manager_menu_photo_queue emits a reviewer row needing a
-- recheck from its live-rows branch ('decided'). When the photo's uploader
-- has since labelled it with the same item and variant (a manager assigned an
-- unlabelled photo, staff then labelled it the same way, a menu change sent
-- the acceptance for recheck), private.menu_photo_pending_tuples matches that
-- label tuple to the same live row whatever its basis, so the labelled branch
-- already emits it as a recheck card. The UNION ALL then listed the decision
-- twice under different sort keys: duplicate review actions, an inflated
-- group_count and the same decision on two pages.
--
-- The live-rows recheck branch now leaves out rows the labelled branch
-- already carries (a waiting tuple whose live row is this one), so the two
-- branches are mutually exclusive. The labelled card is the one kept: it
-- carries the staff label and the same live row. A reviewer recheck with no
-- matching staff label (an unlabelled photo, or a corrected one) is still
-- listed once as a decided card. Nothing else changes.
--
-- Other readers are unaffected: the overview, items, item and contributor
-- functions count waiting tuples (private.menu_photo_pending_tuples) and live
-- rows (private.menu_item_photo_rows, private.menu_photo_contributor_rows)
-- separately, never through this union.

-- The photos a reviewer works through, oldest upload first; keyset on
-- (created_at, sort_key). Status sets:
--   pending              labelled tuples waiting (including staff-label rechecks)
--   recheck              staff-label rechecks and reviewer rows needing a recheck
--   mine                 the caller's own waiting tuples (decided by someone else)
--   needs_another_photo  live rows asking for another photo
--   accepted             live accepted rows
--   stale_label          photos labelled only for items no longer on the menu
--   unlabelled           usable unlabelled photos with no live decision yet
--                        (manager accounts and admins only)
--   all                  pending, recheck, the two decided sets and stale_label
-- Section and item filters do not apply to stale_label and unlabelled; in
-- `all` they leave those rows out.
create or replace function public.manager_menu_photo_queue(
  p_venue_id uuid default null,
  p_status text default 'pending',
  p_section_id uuid default null,
  p_contributor_id uuid default null,
  p_item_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_key uuid default null,
  p_limit integer default 25
)
returns table (
  kind text,
  sort_key uuid,
  label_id uuid,
  photo_id uuid,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  section_id uuid,
  section_name text,
  staff_label jsonb,
  uploader_id uuid,
  uploader_name text,
  contributor_status text,
  can_follow_up boolean,
  is_self boolean,
  photo_state text,
  is_primary boolean,
  is_effective_primary boolean,
  basis text,
  reason text,
  recheck_kind text,
  corrects_item_id uuid,
  corrects_variant_id uuid,
  corrects_item_name text,
  item_revision integer,
  item_covered boolean,
  group_count integer,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer,
  created_at timestamptz,
  labelled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_status text := coalesce(p_status, 'pending');
  v_admin boolean;
  v_active uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  v_itemless boolean;
begin
  perform private.assert_can_manage_venue(v_venue);
  if v_status not in (
    'pending', 'recheck', 'needs_another_photo', 'accepted', 'stale_label', 'unlabelled', 'mine', 'all'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  v_admin := private.is_active_admin();
  v_active := private.active_menu_version_id(v_venue);
  v_itemless := v_status in ('stale_label', 'unlabelled');
  return query
  with m as (
    -- Items of the active countable menu.
    select e.item_id, e.id as entry_id, e.name, s.id as section_id, s.name as section_name
    from public.menu_entries e
    join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
    join public.menu_items i on i.id = e.item_id and i.archived_at is null
    where e.version_id = v_active
  ),
  pt as (
    select t.* from private.menu_photo_pending_tuples(v_venue, v_admin, v_status = 'mine') t
    where v_status in ('pending', 'recheck', 'mine', 'all')
  ),
  base as (
    select 'labelled'::text as kind, t.label_id, t.live_photo_id as photo_id, t.asset_id,
      t.item_id, t.variant_id, t.labelled_at
    from pt t
    where v_status <> 'recheck' or t.is_recheck
    union all
    -- Live rows: reviewer rechecks not listed above and the decided sets.
    select 'decided', null::uuid, p.id, p.asset_id, p.item_id, p.variant_id, null::timestamptz
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.venue_id = v_venue
      and (
        (v_status in ('recheck', 'all') and p.state = 'needs_recheck' and p.basis = 'reviewer'
          -- Staff labelled it the same way: the labelled branch lists it.
          and not exists (select 1 from pt where pt.live_photo_id = p.id))
        or (v_status in ('needs_another_photo', 'all') and p.state = 'better_photo_requested')
        or (v_status in ('accepted', 'all') and p.state = 'accepted')
      )
      and exists (select 1 from m where m.item_id = p.item_id)
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    union all
    select 'stale', null::uuid, null::uuid, a.id, null::uuid, null::uuid, null::timestamptz
    from public.media_assets a
    where v_status in ('stale_label', 'all')
      and a.venue_id = v_venue
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and private.menu_photo_stale_label(a.id, v_venue)
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    -- Q1 unlabelled (begin)
    union all
    select 'unlabelled', null::uuid, null::uuid, a.id, null::uuid, null::uuid, null::timestamptz
    from public.media_assets a
    where v_status = 'unlabelled'
      and a.venue_id = v_venue
      and private.menu_photo_unlabelled_eligible(a.id, v_venue)
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
      and not exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = a.id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
    -- Q1 unlabelled (end)
  ),
  qr as (
    select b.kind, coalesce(b.label_id, b.photo_id, b.asset_id) as sort_key,
      b.label_id, b.photo_id, b.asset_id, b.item_id, b.variant_id,
      m.name as item_name, ev.name as variant_name, m.section_id, m.section_name,
      a.uploader_id, up.display_name as uploader_name,
      case
        when not up.active then 'left'
        when up.role = 'manager' then 'manager'
        when up.venue_id = v_venue then 'here'
        else 'moved'
      end as contributor_status,
      a.uploader_id = v_uid as is_self,
      p.state as photo_state, coalesce(p.is_primary, false) as is_primary,
      p.basis, p.reason, p.recheck_kind, p.corrects_item_id, p.corrects_variant_id,
      a.thumbnail_path is not null as has_thumbnail, a.preview_path is not null as has_preview,
      a.width, a.height, a.created_at, b.labelled_at,
      case when b.item_id is null then 0 else (count(*) over (partition by b.item_id))::integer - 1 end
        as group_count
    from base b
    join public.media_assets a on a.id = b.asset_id
    join public.profiles up on up.id = a.uploader_id
    left join m on m.item_id = b.item_id
    left join public.menu_entry_variants ev on ev.entry_id = m.entry_id and ev.variant_id = b.variant_id
    left join public.menu_item_photos p on p.id = b.photo_id
    where (p_contributor_id is null or a.uploader_id = p_contributor_id)
      and (p_section_id is null or v_itemless or m.section_id = p_section_id)
      and (p_item_id is null or v_itemless or b.item_id = p_item_id)
  )
  select rw.kind, rw.sort_key, rw.label_id, rw.photo_id, rw.asset_id, rw.item_id, rw.variant_id,
    rw.item_name, rw.variant_name, rw.section_id, rw.section_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', li.item_id, 'variantId', li.variant_id,
        'itemName', li.item_name, 'variantName', li.variant_name,
        'onMenu', exists (select 1 from m where m.item_id = li.item_id))
        order by li.added_at, li.id)
      from public.media_label_items li where li.asset_id = rw.asset_id), '[]'::jsonb),
    rw.uploader_id, rw.uploader_name, rw.contributor_status, rw.contributor_status = 'here',
    rw.is_self, rw.photo_state, rw.is_primary,
    rw.photo_id is not null and private.menu_item_effective_primary(rw.item_id) = rw.photo_id,
    rw.basis, rw.reason, rw.recheck_kind, rw.corrects_item_id, rw.corrects_variant_id,
    case when rw.corrects_item_id is not null then coalesce(
      (select li.item_name from public.media_label_items li
       where li.asset_id = rw.asset_id and li.item_id = rw.corrects_item_id
       order by li.added_at limit 1),
      (select m.name from m where m.item_id = rw.corrects_item_id),
      (select e.name from public.menu_entries e
       join public.menu_versions mv on mv.id = e.version_id
       where e.item_id = rw.corrects_item_id
       order by mv.activated_at desc nulls last, mv.created_at desc limit 1)) end,
    case when rw.item_id is not null then
      coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = rw.item_id), 1) end,
    rw.item_id is not null and private.menu_item_effective_primary(rw.item_id) is not null,
    rw.group_count, rw.has_thumbnail, rw.has_preview, rw.width, rw.height, rw.created_at, rw.labelled_at
  from qr rw
  where p_after_created_at is null or p_after_key is null
    or (rw.created_at, rw.sort_key) > (p_after_created_at, p_after_key)
  order by rw.created_at, rw.sort_key
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer)
from public, anon;

grant execute on function
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer)
to authenticated, service_role;
