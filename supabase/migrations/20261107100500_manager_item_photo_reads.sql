-- Venue manager workspace, item photos (part 3 of 3): manager reads.
--
-- The manager Overview, Menu, Review, item and contributor screens read
-- through these functions only. Each resolves the venue as the caller's
-- effective manager venue (an admin names one) and raises not_venue_manager
-- (42501) otherwise, so a failed request is never an empty one. Functions
-- taking an item or contributor id return zero rows for ids outside the
-- venue. No storage path, request key or actor id leaves the database.
--
-- Item headline (covered / awaiting_review / needs_photo) and the overview's
-- item counts are the same for every caller: they use the caller-independent
-- waiting set (private.menu_photo_pending_tuples(venue, true)). Candidate
-- counts and the Review queue are what the caller can act on.

-- ---------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------

create function public.manager_menu_photo_overview(p_venue_id uuid default null)
returns table (
  venue_id uuid,
  venue_name text,
  menu_state text,
  menu_version_id uuid,
  menu_title text,
  activated_at timestamptz,
  eligible_items integer,
  covered_items integer,
  awaiting_review_items integer,
  needs_photo_items integer,
  replacement_pending_items integer,
  needs_recheck_items integer,
  pending_photos integer,
  own_waiting_photos integer,
  oldest_pending_at timestamptz,
  carried_items integer,
  new_items integer,
  sections jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_admin boolean;
  v_name text;
  v_active uuid;
  v_title text;
  v_activated timestamptz;
  v_retired uuid;
  v_own integer := 0;
begin
  perform private.assert_can_manage_venue(v_venue);
  v_admin := private.is_active_admin();
  v_name := (select v.name from public.venues v where v.id = v_venue);
  v_active := private.active_menu_version_id(v_venue);
  if v_active is null then
    return query select v_venue, v_name, 'no_menu'::text, null::uuid, null::text, null::timestamptz,
      0, 0, 0, 0, 0, 0, 0, 0, null::timestamptz, 0, 0, '[]'::jsonb;
    return;
  end if;
  select mv.title, mv.activated_at into v_title, v_activated
  from public.menu_versions mv where mv.id = v_active;
  -- The version this activation retired (not necessarily the draft's base).
  select mv.id into v_retired
  from public.menu_versions mv
  where mv.venue_id = v_venue and mv.status = 'retired' and mv.retired_at <= v_activated
  order by mv.retired_at desc, mv.id desc
  limit 1;
  if private.is_active_manager() then
    v_own := (select count(*)::integer from private.menu_photo_pending_tuples(v_venue, v_admin, true));
  end if;

  return query
  with r as (
    select * from private.menu_item_photo_rows(v_venue, true, v_admin)
  ),
  waiting as (
    select t.item_id, count(*)::integer as n
    from private.menu_photo_pending_tuples(v_venue, true) t
    group by t.item_id
  ),
  x as (
    select r.*, coalesce(w.n, 0) as any_waiting,
      v_retired is not null and not exists (
        select 1 from public.menu_entries pe
        where pe.version_id = v_retired and pe.item_id = r.item_id) as is_new
    from r left join waiting w on w.item_id = r.item_id
  ),
  secs as (
    select x.section_id, x.section_name, x.section_kind, x.section_position,
      count(*)::integer as eligible,
      (count(*) filter (where x.covered))::integer as covered,
      (count(*) filter (where not x.covered and x.any_waiting > 0))::integer as awaiting,
      (count(*) filter (where not x.covered and x.any_waiting = 0))::integer as needs_photo
    from x
    group by x.section_id, x.section_name, x.section_kind, x.section_position
  )
  select v_venue, v_name,
    case when count(x.item_id) = 0 then 'empty' else 'ready' end,
    v_active, v_title, v_activated,
    count(x.item_id)::integer,
    (count(*) filter (where x.covered))::integer,
    (count(*) filter (where not x.covered and x.any_waiting > 0))::integer,
    (count(*) filter (where not x.covered and x.any_waiting = 0))::integer,
    (count(*) filter (where x.covered and x.any_waiting > 0))::integer,
    (count(*) filter (where x.needs_recheck_count > 0))::integer,
    coalesce(sum(x.candidate_count), 0)::integer,
    v_own,
    min(x.oldest_candidate_at),
    (select count(distinct ce.item_id)::integer
     from public.menu_item_photo_events ce
     join r cr on cr.item_id = ce.item_id and cr.covered
     where ce.venue_id = v_venue and ce.action = 'carried'
       and ce.detail ->> 'menuVersionId' = v_active::text),
    (count(*) filter (where x.is_new))::integer,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sectionId', secs.section_id, 'name', secs.section_name, 'kind', secs.section_kind,
        'position', secs.section_position, 'eligible', secs.eligible, 'covered', secs.covered,
        'awaitingReview', secs.awaiting, 'needsPhoto', secs.needs_photo)
        order by secs.section_position, secs.section_id)
      from secs), '[]'::jsonb)
  from x;
end;
$$;

-- ---------------------------------------------------------------------------
-- Menu items
-- ---------------------------------------------------------------------------

-- Eligible items of the active version in menu order (keyset on section
-- position, entry position, item id), with the caller-independent headline
-- and the caller's own and others' waiting photos. p_status: null (all),
-- covered, awaiting_review, needs_photo, recheck, replacement (covered with a
-- photo waiting).
create function public.manager_menu_photo_items(
  p_venue_id uuid default null,
  p_status text default null,
  p_section_id uuid default null,
  p_query text default null,
  p_after_section_position integer default null,
  p_after_entry_position integer default null,
  p_after_item_id uuid default null,
  p_limit integer default 50
)
returns table (
  venue_id uuid,
  menu_version_id uuid,
  item_id uuid,
  section_id uuid,
  section_name text,
  section_kind text,
  section_position integer,
  entry_position integer,
  name text,
  description text,
  variants jsonb,
  covered boolean,
  accepted_count integer,
  needs_recheck_count integer,
  primary_photo_id uuid,
  primary_asset_id uuid,
  primary_has_thumbnail boolean,
  primary_has_preview boolean,
  primary_width integer,
  primary_height integer,
  item_revision integer,
  candidate_count integer,
  oldest_candidate_at timestamptz,
  status text,
  has_pending_replacement boolean,
  needs_recheck boolean,
  own_waiting integer,
  others_waiting integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_admin boolean;
  v_manager boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
  v_query text := left(nullif(btrim(p_query), ''), 80);
  v_pattern text;
begin
  perform private.assert_can_manage_venue(v_venue);
  if p_status is not null
     and p_status not in ('covered', 'awaiting_review', 'needs_photo', 'recheck', 'replacement') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  v_admin := private.is_active_admin();
  v_manager := private.is_active_manager();
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  with waiting as (
    select t.item_id, count(*)::integer as n
    from private.menu_photo_pending_tuples(v_venue, true) t
    group by t.item_id
  ),
  own as (
    select t.item_id, count(*)::integer as n
    from private.menu_photo_pending_tuples(v_venue, v_admin, true) t
    where v_manager
    group by t.item_id
  ),
  x as (
    select r.*, coalesce(w.n, 0) as any_waiting, coalesce(o.n, 0) as own_n,
      case
        when r.covered then 'covered'
        when coalesce(w.n, 0) > 0 then 'awaiting_review'
        else 'needs_photo'
      end as headline
    from private.menu_item_photo_rows(v_venue, true, v_admin) r
    left join waiting w on w.item_id = r.item_id
    left join own o on o.item_id = r.item_id
  )
  select v_venue, x.menu_version_id, x.item_id, x.section_id, x.section_name, x.section_kind,
    x.section_position, x.entry_position, x.name, x.description, x.variants, x.covered,
    x.accepted_count, x.needs_recheck_count, x.primary_photo_id, x.primary_asset_id,
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    x.item_revision, x.candidate_count, x.oldest_candidate_at,
    x.headline,
    x.covered and x.any_waiting > 0,
    x.needs_recheck_count > 0,
    x.own_n,
    greatest(x.any_waiting - x.candidate_count - x.own_n, 0)
  from x
  left join public.media_assets a on a.id = x.primary_asset_id
  where (p_section_id is null or x.section_id = p_section_id)
    and (p_status is null
      or (p_status in ('covered', 'awaiting_review', 'needs_photo') and x.headline = p_status)
      or (p_status = 'recheck' and x.needs_recheck_count > 0)
      or (p_status = 'replacement' and x.covered and x.any_waiting > 0))
    and (v_pattern is null or x.name ilike v_pattern
      or exists (select 1 from unnest(x.aliases) as al(alias) where al.alias ilike v_pattern))
    and (p_after_section_position is null or p_after_entry_position is null or p_after_item_id is null
      or (x.section_position, x.entry_position, x.item_id)
        > (p_after_section_position, p_after_entry_position, p_after_item_id))
  order by x.section_position, x.entry_position, x.item_id
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review queue
-- ---------------------------------------------------------------------------

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
create function public.manager_menu_photo_queue(
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
    -- Live rows: reviewer rechecks and the decided sets.
    select 'decided', null::uuid, p.id, p.asset_id, p.item_id, p.variant_id, null::timestamptz
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.venue_id = v_venue
      and (
        (v_status in ('recheck', 'all') and p.state = 'needs_recheck' and p.basis = 'reviewer')
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
-- One item
-- ---------------------------------------------------------------------------

-- An item of the venue's active countable menu with its preferred photo and
-- every live decision (zero rows for any other item).
create function public.manager_menu_photo_item(p_venue_id uuid, p_item_id uuid)
returns table (
  item_id uuid,
  name text,
  description text,
  section_id uuid,
  section_name text,
  section_kind text,
  variants jsonb,
  status text,
  item_revision integer,
  covered boolean,
  preferred_photo_id uuid,
  preferred_asset_id uuid,
  preferred_is_fallback boolean,
  photos jsonb
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
  v_admin boolean;
begin
  perform private.assert_can_manage_venue(v_venue);
  v_admin := private.is_active_admin();
  return query
  select r.item_id, r.name, r.description, r.section_id, r.section_name, r.section_kind, r.variants,
    case
      when r.covered then 'covered'
      when exists (select 1 from private.menu_photo_pending_tuples(v_venue, true) t where t.item_id = r.item_id)
        then 'awaiting_review'
      else 'needs_photo'
    end,
    r.item_revision, r.covered, r.primary_photo_id, r.primary_asset_id,
    r.primary_photo_id is not null
      and not coalesce((select p.is_primary from public.menu_item_photos p where p.id = r.primary_photo_id), false),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'photoId', p.id, 'assetId', p.asset_id, 'state', p.state, 'basis', p.basis,
        'isPrimary', p.is_primary, 'isEffective', p.id = r.primary_photo_id,
        'variantId', p.variant_id, 'variantName', p.variant_name, 'recheckKind', p.recheck_kind,
        'reason', p.reason, 'decidedAt', p.decided_at, 'decidedByName', dp.display_name,
        'authorId', p.author_id, 'authorName', up.display_name,
        'contributorStatus', case
          when not up.active then 'left'
          when up.role = 'manager' then 'manager'
          when up.venue_id = v_venue then 'here'
          else 'moved'
        end,
        'canFollowUp', up.active and up.role = 'staff' and up.venue_id = v_venue,
        'correctsItemId', p.corrects_item_id, 'correctsVariantId', p.corrects_variant_id,
        'correctsItemName', case when p.corrects_item_id is not null then coalesce(
          (select li.item_name from public.media_label_items li
           where li.asset_id = p.asset_id and li.item_id = p.corrects_item_id
           order by li.added_at limit 1),
          (select e.name from public.menu_entries e
           join public.menu_versions mv on mv.id = e.version_id
           where e.item_id = p.corrects_item_id
           order by mv.activated_at desc nulls last, mv.created_at desc limit 1)) end,
        'hasThumbnail', a.thumbnail_path is not null, 'hasPreview', a.preview_path is not null,
        'width', a.width, 'height', a.height, 'isSelf', p.author_id = v_uid)
        order by p.is_primary desc, p.decided_at, p.id)
      from public.menu_item_photos p
      join public.media_assets a on a.id = p.asset_id
      join public.profiles up on up.id = p.author_id
      left join public.profiles dp on dp.id = p.decided_by
      where p.item_id = r.item_id
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
        and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null), '[]'::jsonb)
  from private.menu_item_photo_rows(v_venue, true, v_admin) r
  where r.item_id = p_item_id;
end;
$$;

-- The item's decision history, newest first; keyset on the event id.
create function public.manager_menu_photo_item_events(
  p_venue_id uuid,
  p_item_id uuid,
  p_before_id bigint default null,
  p_limit integer default 20
)
returns table (
  id bigint,
  action text,
  actor_name text,
  actor_role text,
  photo_id uuid,
  asset_id uuid,
  from_state text,
  to_state text,
  reason text,
  detail jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 101);
begin
  perform private.assert_can_manage_venue(v_venue);
  return query
  select ev.id, ev.action, ap.display_name, ev.actor_role, ev.photo_id, ev.asset_id,
    ev.from_state, ev.to_state, ev.reason,
    jsonb_strip_nulls(jsonb_build_object(
      'op', ev.detail ->> 'op',
      'basis', ev.detail ->> 'basis',
      'kind', ev.detail ->> 'kind',
      'correctsItemName', case when ev.detail ->> 'correctsItemId' is not null then (
        select e.name from public.menu_entries e
        join public.menu_versions mv on mv.id = e.version_id
        where e.item_id = (ev.detail ->> 'correctsItemId')::uuid
        order by mv.activated_at desc nulls last, mv.created_at desc limit 1) end)),
    ev.created_at
  from public.menu_item_photo_events ev
  left join public.profiles ap on ap.id = ev.actor_id
  where ev.venue_id = v_venue and ev.item_id = p_item_id
    and (p_before_id is null or ev.id < p_before_id)
  order by ev.id desc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contributors
-- ---------------------------------------------------------------------------

-- People whose photos the caller may decide on, with ready images at the
-- venue that carry a label tuple or an item-photo decision. Never the caller.
create function private.menu_photo_contributor_rows(p_venue_id uuid, p_contributor_id uuid)
returns table (
  contributor_id uuid,
  display_name text,
  status text,
  labelled_photos integer,
  accepted_items integer,
  open_follow_ups integer,
  last_upload_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select up.id, up.display_name,
    case
      when not up.active then 'left'
      when up.role = 'manager' then 'manager'
      when up.venue_id = p_venue_id then 'here'
      else 'moved'
    end,
    (select count(distinct a.id)::integer from public.media_assets a
     where a.uploader_id = up.id and a.venue_id = p_venue_id
       and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
       and exists (select 1 from public.media_label_items li where li.asset_id = a.id)),
    (select count(distinct p.item_id)::integer from public.menu_item_photos p
     join public.media_assets a on a.id = p.asset_id
     where p.author_id = up.id and p.venue_id = p_venue_id and p.state = 'accepted'
       and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null),
    (select count(*)::integer from public.menu_item_photos p
     where p.author_id = up.id and p.venue_id = p_venue_id and p.state = 'better_photo_requested'),
    (select max(a.created_at) from public.media_assets a
     where a.uploader_id = up.id and a.venue_id = p_venue_id
       and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null)
  from public.profiles up
  where up.role in ('staff', 'manager')
    and up.id <> (select auth.uid())
    and (p_contributor_id is null or up.id = p_contributor_id)
    and private.menu_photo_reviewable_uploader(up.id, private.is_active_admin())
    and exists (
      select 1 from public.media_assets a
      where a.uploader_id = up.id and a.venue_id = p_venue_id
        and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
        and (exists (select 1 from public.media_label_items li where li.asset_id = a.id)
          or exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)))
  order by up.display_name, up.id;
$$;

create function public.manager_menu_photo_contributors(p_venue_id uuid default null)
returns table (
  contributor_id uuid,
  display_name text,
  status text,
  labelled_photos integer,
  accepted_items integer,
  open_follow_ups integer,
  last_upload_at timestamptz
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
  return query select c.* from private.menu_photo_contributor_rows(v_venue, null) c;
end;
$$;

-- One contributor (zero rows without a qualifying photo at the venue).
create function public.manager_menu_photo_contributor(p_venue_id uuid, p_contributor_id uuid)
returns table (
  contributor_id uuid,
  display_name text,
  status text,
  labelled_photos integer,
  accepted_items integer,
  open_follow_ups integer,
  last_upload_at timestamptz
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
  if p_contributor_id is null then
    return;
  end if;
  return query select c.* from private.menu_photo_contributor_rows(v_venue, p_contributor_id) c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.menu_photo_contributor_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function private.menu_photo_contributor_rows(uuid, uuid) to service_role;

revoke all on function
  public.manager_menu_photo_overview(uuid),
  public.manager_menu_photo_items(uuid, text, uuid, text, integer, integer, uuid, integer),
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.manager_menu_photo_item(uuid, uuid),
  public.manager_menu_photo_item_events(uuid, uuid, bigint, integer),
  public.manager_menu_photo_contributors(uuid),
  public.manager_menu_photo_contributor(uuid, uuid)
from public, anon;

grant execute on function
  public.manager_menu_photo_overview(uuid),
  public.manager_menu_photo_items(uuid, text, uuid, text, integer, integer, uuid, integer),
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer),
  public.manager_menu_photo_item(uuid, uuid),
  public.manager_menu_photo_item_events(uuid, uuid, bigint, integer),
  public.manager_menu_photo_contributors(uuid),
  public.manager_menu_photo_contributor(uuid, uuid)
to authenticated, service_role;
