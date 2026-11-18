-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-R1 (FA-51; review findings Y1, Y2, Y3): the older
-- menu-photo readers follow the packaged rule.
--
-- FA-51 puts one rule in private.coverage_slot_rows: a dish whose item is
-- packaged without Photo wanted is optional (state 'inactive'). It is listed,
-- takes photos and can be accepted, but it is never in a total, never a gap
-- and never has a needed-by date. S5-PACKAGED (20261118133000) applied it to
-- the rule and to the section readers; the readers below compute their own
-- headline from private.menu_item_photo_rows and still counted and listed an
-- optional item as missing.
--
--   Helper   private.menu_optional_item_ids(venue): the dish slots the rule
--            calls 'inactive'. Every reader below reads the rule through it,
--            so there is still one rule.
--   Y1       public.manager_menu_photo_overview (body of 20261107100500):
--            an optional item leaves eligible, covered, awaiting, needs
--            photo, replacement, recheck, carried and new counts, in the
--            totals and in every section. Its waiting photos still count in
--            pending_photos and oldest_pending_at (they still need a
--            decision). menu_state is 'empty' only when the active version
--            has no items at all; a section of optional items stays, with 0.
--   Y2       public.manager_menu_photo_items (body of 20261116150000) and
--            public.manager_menu_photo_item (body of 20261107100500): the
--            headline of an optional item with no accepted photo and nothing
--            waiting is 'optional' (never 'needs_photo'); every status filter
--            leaves optional items out, so a filtered list matches the
--            overview's counts; needed_by is null.
--            public.menu_item_photo_items (body of 20261116150000; staff Our
--            menu): "Still needs a photo" (p_gaps_only) leaves optional
--            items out, needed_by is null, and a new last column `optional`
--            lets the screen say Optional. The function is dropped and
--            recreated (return type), with the same arguments and grants.
--   Y3       public.menu_item_photo_summary (body of 20261118133000): an
--            optional item leaves eligible (and recheck) through a count
--            filter instead of a WHERE, so a menu of only optional items is
--            'ready' with sections at 0, never 'empty', and their waiting
--            photos still count in pending_candidates.
--
-- Rollback: re-apply public.manager_menu_photo_overview and
-- public.manager_menu_photo_item from 20261107100500,
-- public.menu_item_photo_items and public.manager_menu_photo_items from
-- 20261116150000 (drop the 9-argument menu_item_photo_items first, then
-- re-run its grants), public.menu_item_photo_summary from 20261118133000;
-- drop private.menu_optional_item_ids.

-- ---------------------------------------------------------------------------
-- The rule, read once
-- ---------------------------------------------------------------------------

create or replace function private.menu_optional_item_ids(p_venue_id uuid)
returns table (item_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- A dish slot is 'inactive' only when FA-51 makes it optional.
  select c.slot_id
  from private.coverage_slot_rows(p_venue_id) c
  where c.slot_kind = 'dish' and c.state = 'inactive';
$$;

comment on function private.menu_optional_item_ids(uuid) is
  'FA-51: the venue''s optional dish items (packaged without Photo wanted), read from private.coverage_slot_rows.';

-- ---------------------------------------------------------------------------
-- Y1: manager Overview
-- ---------------------------------------------------------------------------

create or replace function public.manager_menu_photo_overview(p_venue_id uuid default null)
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
  opt as (
    select o.item_id from private.menu_optional_item_ids(v_venue) o
  ),
  waiting as (
    select t.item_id, count(*)::integer as n
    from private.menu_photo_pending_tuples(v_venue, true) t
    group by t.item_id
  ),
  x as (
    select r.*, coalesce(w.n, 0) as any_waiting,
      -- FA-51: an optional item is in no count below except photos to review.
      exists (select 1 from opt where opt.item_id = r.item_id) as optional,
      v_retired is not null and not exists (
        select 1 from public.menu_entries pe
        where pe.version_id = v_retired and pe.item_id = r.item_id) as is_new
    from r left join waiting w on w.item_id = r.item_id
  ),
  secs as (
    select x.section_id, x.section_name, x.section_kind, x.section_position,
      (count(*) filter (where not x.optional))::integer as eligible,
      (count(*) filter (where not x.optional and x.covered))::integer as covered,
      (count(*) filter (where not x.optional and not x.covered and x.any_waiting > 0))::integer as awaiting,
      (count(*) filter (where not x.optional and not x.covered and x.any_waiting = 0))::integer as needs_photo
    from x
    group by x.section_id, x.section_name, x.section_kind, x.section_position
  )
  select v_venue, v_name,
    -- Empty only when the active version lists no item at all (Y3).
    case when count(x.item_id) = 0 then 'empty' else 'ready' end,
    v_active, v_title, v_activated,
    (count(*) filter (where not x.optional))::integer,
    (count(*) filter (where not x.optional and x.covered))::integer,
    (count(*) filter (where not x.optional and not x.covered and x.any_waiting > 0))::integer,
    (count(*) filter (where not x.optional and not x.covered and x.any_waiting = 0))::integer,
    (count(*) filter (where not x.optional and x.covered and x.any_waiting > 0))::integer,
    (count(*) filter (where not x.optional and x.needs_recheck_count > 0))::integer,
    coalesce(sum(x.candidate_count), 0)::integer,
    v_own,
    min(x.oldest_candidate_at),
    (select count(distinct ce.item_id)::integer
     from public.menu_item_photo_events ce
     join r cr on cr.item_id = ce.item_id and cr.covered
     where ce.venue_id = v_venue and ce.action = 'carried'
       and ce.detail ->> 'menuVersionId' = v_active::text
       and not exists (select 1 from opt where opt.item_id = ce.item_id)),
    (count(*) filter (where not x.optional and x.is_new))::integer,
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
-- Y2: manager Menu list and item
-- ---------------------------------------------------------------------------

-- Body as in 20261116150000. Changes: headline 'optional' for an optional
-- item with no accepted photo and nothing waiting; every status filter
-- leaves optional items out; no needed-by date on an optional item.
create or replace function public.manager_menu_photo_items(
  p_venue_id uuid default null,
  p_status text default null,
  p_section_id uuid default null,
  p_query text default null,
  p_after_needed_by date default null,
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
  others_waiting integer,
  needed_by date,
  needed_by_passed boolean
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
  v_today date := private.london_today();
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
  opt as (
    select o.item_id from private.menu_optional_item_ids(v_venue) o
  ),
  x as (
    select r.*, coalesce(w.n, 0) as any_waiting, coalesce(o.n, 0) as own_n,
      op.item_id is not null as optional,
      case
        when r.covered then 'covered'
        when coalesce(w.n, 0) > 0 then 'awaiting_review'
        when op.item_id is not null then 'optional'
        else 'needs_photo'
      end as headline,
      case when not r.covered and op.item_id is null then nb.needed_by end as nb_date
    from private.menu_item_photo_rows(v_venue, true, v_admin) r
    left join waiting w on w.item_id = r.item_id
    left join own o on o.item_id = r.item_id
    left join opt op on op.item_id = r.item_id
    left join private.menu_item_needed_by_live(v_venue) nb on nb.item_id = r.item_id
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
    greatest(x.any_waiting - x.candidate_count - x.own_n, 0),
    x.nb_date, coalesce(x.nb_date < v_today, false)
  from x
  left join public.media_assets a on a.id = x.primary_asset_id
  where (p_section_id is null or x.section_id = p_section_id)
    -- FA-51: a status filter counts as the overview does, without optional items.
    and (p_status is null or (not x.optional and (
      (p_status in ('covered', 'awaiting_review', 'needs_photo') and x.headline = p_status)
      or (p_status = 'recheck' and x.needs_recheck_count > 0)
      or (p_status = 'replacement' and x.covered and x.any_waiting > 0))))
    and (v_pattern is null or x.name ilike v_pattern
      or exists (select 1 from unnest(x.aliases) as al(alias) where al.alias ilike v_pattern))
    and (p_after_section_position is null or p_after_entry_position is null or p_after_item_id is null
      or (coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id)
        > (coalesce(p_after_needed_by, 'infinity'::date), p_after_section_position,
           p_after_entry_position, p_after_item_id))
  order by coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id
  limit v_limit;
end;
$$;

-- Body as in 20261107100500. Change: headline 'optional' as above.
create or replace function public.manager_menu_photo_item(p_venue_id uuid, p_item_id uuid)
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
      when exists (select 1 from private.menu_optional_item_ids(v_venue) o where o.item_id = r.item_id)
        then 'optional'
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

-- ---------------------------------------------------------------------------
-- Y2: staff Our menu list
-- ---------------------------------------------------------------------------

drop function public.menu_item_photo_items(uuid, uuid, boolean, text, date, integer, integer, uuid, integer);

-- Body as in 20261116150000. Changes: "Still needs a photo" (p_gaps_only)
-- leaves optional items out, an optional item has no needed-by date, and the
-- last column says whether the item is optional.
create function public.menu_item_photo_items(
  p_venue_id uuid default null,
  p_section_id uuid default null,
  p_gaps_only boolean default false,
  p_query text default null,
  p_after_needed_by date default null,
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
  needed_by date,
  needed_by_passed boolean,
  optional boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.menu_photo_read_venue(p_venue_id);
  v_reviewer boolean := private.can_manage_venue(v_venue);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
  v_query text := left(nullif(btrim(p_query), ''), 80);
  v_today date := private.london_today();
  v_pattern text;
begin
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  with opt as (
    select o.item_id from private.menu_optional_item_ids(v_venue) o
  ),
  x as (
    select r.*, op.item_id is not null as is_optional,
      case when not r.covered and op.item_id is null then nb.needed_by end as nb_date
    from private.menu_item_photo_rows(v_venue, v_reviewer, private.is_active_admin()) r
    left join opt op on op.item_id = r.item_id
    left join private.menu_item_needed_by_live(v_venue) nb on nb.item_id = r.item_id
  )
  select v_venue, x.menu_version_id, x.item_id, x.section_id, x.section_name, x.section_kind,
    x.section_position, x.entry_position, x.name, x.description, x.variants, x.covered,
    x.accepted_count, x.needs_recheck_count, x.primary_photo_id, x.primary_asset_id,
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    x.item_revision, x.candidate_count, x.oldest_candidate_at,
    x.nb_date, coalesce(x.nb_date < v_today, false),
    x.is_optional
  from x
  left join public.media_assets a on a.id = x.primary_asset_id
  where (p_section_id is null or x.section_id = p_section_id)
    -- FA-51: an optional item is never a gap.
    and (not coalesce(p_gaps_only, false) or (not x.covered and not x.is_optional))
    and (v_pattern is null or x.name ilike v_pattern
      or exists (select 1 from unnest(x.aliases) as al(alias) where al.alias ilike v_pattern))
    and (p_after_section_position is null or p_after_entry_position is null or p_after_item_id is null
      or (coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id)
        > (coalesce(p_after_needed_by, 'infinity'::date), p_after_section_position,
           p_after_entry_position, p_after_item_id))
  order by coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Y3: Our menu summary
-- ---------------------------------------------------------------------------

-- Body as in 20261118133000. Change: the optional filter is a count filter,
-- so every section stays (eligible 0 when all its items are optional) and
-- 'empty' means the active version lists no item at all.
create or replace function public.menu_item_photo_summary(p_venue_id uuid default null)
returns table (
  venue_id uuid,
  venue_name text,
  menu_state text,
  menu_version_id uuid,
  section_id uuid,
  section_name text,
  section_kind text,
  section_position integer,
  eligible_items integer,
  covered_items integer,
  needs_recheck_items integer,
  pending_candidates integer,
  oldest_candidate_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.menu_photo_read_venue(p_venue_id);
  v_name text := (select v.name from public.venues v where v.id = v_venue);
  v_active uuid := private.active_menu_version_id(v_venue);
  v_reviewer boolean := private.can_manage_venue(v_venue);
begin
  if v_active is null then
    return query select v_venue, v_name, 'no_menu'::text, null::uuid, null::uuid, null::text, null::text,
      null::integer, 0, 0, 0, null::integer, null::timestamptz;
    return;
  end if;
  return query
  with cov as (
    select c.slot_id, c.state from private.coverage_slot_rows(v_venue) c where c.slot_kind = 'dish'
  )
  select v_venue, v_name, 'ready'::text, r.menu_version_id, r.section_id, r.section_name, r.section_kind,
    r.section_position,
    -- FA-51: an optional packaged item (state inactive) is not eligible.
    (count(*) filter (where cov.state is distinct from 'inactive'))::integer,
    (count(*) filter (where cov.state = 'covered'))::integer,
    (count(*) filter (where r.needs_recheck_count > 0 and cov.state is distinct from 'inactive'))::integer,
    -- Photos waiting on an optional item still wait for a decision.
    case when v_reviewer then sum(r.candidate_count)::integer end,
    case when v_reviewer then min(r.oldest_candidate_at) end
  from private.menu_item_photo_rows(v_venue, v_reviewer, private.is_active_admin()) r
  left join cov on cov.slot_id = r.item_id
  group by r.menu_version_id, r.section_id, r.section_name, r.section_kind, r.section_position
  order by r.section_position, r.section_id;
  if not found then
    return query select v_venue, v_name, 'empty'::text, v_active, null::uuid, null::text, null::text,
      null::integer, 0, 0, 0, case when v_reviewer then 0 end, null::timestamptz;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.menu_optional_item_ids(uuid) from public, anon, authenticated, service_role;

-- As in 20261116150000 for the recreated list.
revoke all on function
  public.menu_item_photo_items(uuid, uuid, boolean, text, date, integer, integer, uuid, integer)
from public, anon;
grant execute on function
  public.menu_item_photo_items(uuid, uuid, boolean, text, date, integer, integer, uuid, integer)
to authenticated, service_role;
