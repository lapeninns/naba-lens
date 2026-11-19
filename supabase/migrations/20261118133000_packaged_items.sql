-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-PACKAGED (FA-51; spec §4.2; AC39): packaged drinks.
--
-- A manager of the venue or an admin marks a menu item or a local offering
-- (a special's item) Packaged (bottled or canned), and optionally Photo
-- wanted (the collection plan's designation). A packaged item without Photo
-- wanted is optional: it is still listed, takes photos and can be accepted,
-- but it leaves the total and is never empty in any count.
--
--   Table    public.menu_item_packaging: one row per item that is packaged
--            (absent = not packaged, today's behaviour). Menu import and new
--            versions never touch it, so a stable item keeps its designation
--            and a new item starts with the defaults. RLS on, no direct
--            grants: read and write through the functions below.
--   Write    public.menu_item_packaging_set(item, packaged, photo_wanted):
--            the item's venue manager or an admin (with MFA, through
--            private.menu_manage_item); an item on the active menu or a
--            running special. Photo wanted needs Packaged. Audited in
--            menu_events ('packaging_set'). No reason (reason-free confirm).
--   Read     public.menu_item_packaging(venue): the venue's active menu items
--            and current specials with their designation, for the manager
--            and admin menu screens; managers of that venue and admins.
--   Rule     private.coverage_slot_rows (body of 20261118109000): a dish slot
--            whose item is packaged without Photo wanted has required =
--            false and state 'inactive' (report word "No photo needed"), so
--            every count that reads the rule (coverage_slots, metrics,
--            manager and admin overviews, Album, How this is counted) leaves
--            it out of the total and the numerator. Its primary photo and
--            waiting count are still given, so Album can draw its photos.
--   Readers  public.album_admin_counts (body of 20261118100200) and
--            public.menu_item_photo_summary (body of 20261118100200) leave
--            the optional dish out of their per-section totals.
--
-- Rollback: re-apply private.coverage_slot_rows from 20261118109000,
-- public.album_admin_counts and public.menu_item_photo_summary from
-- 20261118100200; drop the two functions and the table; restore the
-- menu_events action check of 20261118103000.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.menu_item_packaging (
  item_id uuid primary key,
  venue_id uuid not null,
  packaged boolean not null default true,
  photo_wanted boolean not null default false,
  set_by uuid references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  constraint menu_item_packaging_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  -- Photo wanted is a designation of a packaged item only.
  constraint menu_item_packaging_wanted_needs_packaged check (packaged or not photo_wanted)
);

create index menu_item_packaging_venue_idx on public.menu_item_packaging (venue_id);

comment on table public.menu_item_packaging is
  'FA-51: a packaged (bottled or canned) menu item or local offering, and whether the collection plan wants its photo. Absent = not packaged.';

alter table public.menu_item_packaging enable row level security;
revoke all on table public.menu_item_packaging from public, anon, authenticated;

alter table public.menu_events drop constraint menu_events_action_check;
alter table public.menu_events add constraint menu_events_action_check check (action in (
  'draft_created', 'draft_saved', 'activated', 'retired', 'discarded',
  'item_archived', 'item_unarchived', 'suggestion_resolved', 'suggestion_dismissed',
  'scheduled', 'schedule_cleared', 'schedule_lapsed',
  'availability_set', 'availability_cleared', 'display_name_set', 'display_name_cleared',
  'presentation_changed',
  'special_created', 'special_suggested', 'special_accepted', 'special_declined',
  'special_extended', 'special_ended',
  'change_requested', 'change_request_decided',
  'packaging_set'
));

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

create function public.menu_item_packaging_set(p_item_id uuid, p_packaged boolean, p_photo_wanted boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_old public.menu_item_packaging;
  v_wanted boolean := coalesce(p_photo_wanted, false);
begin
  if p_packaged is null then
    raise exception 'invalid_packaging' using errcode = '22023';
  end if;
  if v_wanted and not p_packaged then
    raise exception 'invalid_packaging' using errcode = '22023';
  end if;
  v_venue := private.menu_manage_item(p_item_id);
  select k.* into v_old from public.menu_item_packaging k where k.item_id = p_item_id for update;

  if coalesce(v_old.packaged, false) = p_packaged
    and coalesce(v_old.photo_wanted, false) = v_wanted then
    return jsonb_build_object('itemId', p_item_id, 'packaged', p_packaged,
      'photoWanted', v_wanted, 'changed', false);
  end if;

  if p_packaged then
    insert into public.menu_item_packaging (item_id, venue_id, packaged, photo_wanted, set_by)
    values (p_item_id, v_venue, true, v_wanted, v_uid)
    on conflict (item_id) do update
      set packaged = true, photo_wanted = excluded.photo_wanted, set_by = excluded.set_by, set_at = now();
  else
    delete from public.menu_item_packaging k where k.item_id = p_item_id;
  end if;

  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v_venue, p_item_id, v_uid, 'packaging_set', jsonb_build_object(
    'previous', jsonb_build_object('packaged', coalesce(v_old.packaged, false),
      'photoWanted', coalesce(v_old.photo_wanted, false)),
    'packaged', p_packaged, 'photoWanted', v_wanted));
  return jsonb_build_object('itemId', p_item_id, 'packaged', p_packaged,
    'photoWanted', v_wanted, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The venue's offerings a designation can be set on: items of the active
-- menu (food and drinks sections) and running or upcoming specials, each
-- with packaged and photoWanted. Managers of the venue and admins (MFA).
create function public.menu_item_packaging(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
begin
  perform private.assert_can_manage_venue(v_venue);
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'itemId', o.item_id, 'name', o.name, 'sectionName', o.section_name,
        'kind', o.kind, 'source', o.source,
        'packaged', coalesce(k.packaged, false),
        'photoWanted', coalesce(k.photo_wanted, false))
      order by o.source, o.section_position, o.position, o.name, o.item_id)
    from (
      select e.item_id, e.name, s.name as section_name, s.kind, 'menu'::text as source,
        s.position as section_position, e.position
      from public.menu_versions v
      join public.menu_sections s on s.version_id = v.id and s.kind in ('food', 'drinks')
      join public.menu_entries e on e.version_id = v.id and e.section_id = s.id
      join public.menu_items i on i.id = e.item_id and i.archived_at is null
      where v.venue_id = v_venue and v.status = 'active'
      union all
      select sp.item_id, sp.name, null, sp.kind, 'special', 0, 0
      from public.menu_specials sp
      where sp.venue_id = v_venue and sp.status = 'running'
        and sp.ends_on >= private.london_today()
        and not exists (
          select 1 from public.menu_entries e
          join public.menu_versions v on v.id = e.version_id and v.status = 'active'
          where e.item_id = sp.item_id)
    ) o
    left join public.menu_item_packaging k on k.item_id = o.item_id
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- Signature and states as in 20261118109000. Change: FA-51, a dish whose
-- item is packaged without Photo wanted is optional (required false, state
-- inactive), keeping its primary photo and waiting count.
create or replace function private.coverage_slot_rows(p_venue_id uuid)
returns table (
  slot_kind text,
  slot_id uuid,
  name text,
  group_key text,
  group_name text,
  group_position integer,
  category text,
  required boolean,
  state text,
  unavailable boolean,
  primary_asset_id uuid,
  pending_count integer,
  covered_since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with dish as (
    select r.item_id, r.name, r.section_id, r.section_name, r.section_kind, r.section_position,
      r.entry_position, r.covered, r.needs_recheck_count, r.primary_asset_id,
      (select p.decided_at from public.menu_item_photos p where p.id = r.primary_photo_id) as covered_since,
      coalesce((
        select count(*) from private.menu_photo_pending_tuples(p_venue_id, true) t
        join public.media_assets a on a.id = t.asset_id
        where t.item_id = r.item_id and not t.is_recheck and not private.media_duplicate_suppressed(a.id)), 0)::integer as pending,
      exists (
        select 1 from public.menu_item_photos p
        join public.media_assets a on a.id = p.asset_id
        where p.item_id = r.item_id and p.state = 'better_photo_requested'
          and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      ) as retake
      -- FA-51: packaged and not marked Photo wanted is an optional slot.
      , coalesce(k.packaged and not k.photo_wanted, false) as optional
    from private.menu_item_photo_rows(p_venue_id, false, true) r
    left join public.menu_item_packaging k on k.item_id = r.item_id
  ),
  area_live as (
    select l.id as label_id, l.subject_id, l.asset_id, l.added_at, d.action, d.review_level, d.decided_at,
      private.media_duplicate_suppressed(a.id) as duplicate
    from public.media_area_labels l
    join public.media_assets a on a.id = l.asset_id and a.venue_id = l.venue_id
    left join lateral (
      select x.action, x.review_level, x.decided_at from public.area_photo_decisions x
      where x.label_id = l.id order by x.id desc limit 1
    ) d on true
    where l.venue_id = p_venue_id and l.removed_at is null and l.added_by = a.uploader_id
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
  ),
  area_rated as (
    select l.*,
      case when l.action = 'accepted' and l.review_level = 'public' and not l.duplicate
        then private.area_photo_freshness(l.label_id) ->> 'state' end as freshness
    from area_live l
  ),
  area as (
    select s.id, s.label,
      bool_or(l.freshness is not null) as has_public,
      bool_or(l.freshness = 'current') as has_current,
      bool_or(l.freshness = 'check_due') as has_check_due,
      max(l.decided_at) filter (where l.freshness is not null) as covered_since,
      (count(*) filter (where l.subject_id is not null and l.action is null and not l.duplicate))::integer as pending,
      bool_or(l.action = 'needs_another_photo') as retake
    from public.knowledge_subjects s
    left join area_rated l on l.subject_id = s.id
    where s.venue_id = p_venue_id and s.retired_at is null
    group by s.id, s.label
  ),
  amenity_photos as (
    select r.check_id,
      bool_or(r.state = 'accepted' and r.review_level = 'public') as has_public,
      max(r.decided_at) filter (where r.state = 'accepted' and r.review_level = 'public') as covered_since,
      (count(*) filter (where r.state = 'pending'))::integer as pending,
      bool_or(r.state = 'needs_another_photo') as retake
    from private.amenity_photo_rows(p_venue_id) r
    join public.media_assets a on a.id = r.asset_id
    where not private.media_duplicate_suppressed(a.id) or r.state = 'needs_another_photo'
    group by r.check_id
  ),
  facts as (
    select f.check_id, f.verification, f.unavailable from private.coverage_amenity_facts(p_venue_id) f
  ),
  amenity as (
    select c.id, t.question, t.category as catalogue_category, t.position, c.progress,
      private.amenity_photo_required(c.template_key) as required,
      (coalesce(sub.answer in ('no', 'not_applicable'), false)
        or coalesce((private.knowledge_check_service_end(c.id, now()) ->> 'inEffect')::boolean, false)
      ) as not_here,
      coalesce(ap.has_public, false) as has_public, ap.covered_since,
      coalesce(ap.pending, 0) as pending, coalesce(ap.retake, false) as retake,
      f.verification, coalesce(f.unavailable, false) as unavailable
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    left join public.amenity_submissions sub on sub.id = c.current_submission_id
    left join amenity_photos ap on ap.check_id = c.id
    left join facts f on f.check_id = c.id
    where c.venue_id = p_venue_id and c.status = 'active'
      and private.knowledge_in_scope(c.venue_id, c.template_key)
  )
  select 'dish'::text, d.item_id, d.name, d.section_id::text, d.section_name, d.section_position,
    d.section_kind, not d.optional,
    case
      -- FA-51: an optional packaged item leaves the total and is never
      -- empty; its photos still show (primary, waiting count) below.
      when d.optional then 'inactive'
      when d.needs_recheck_count > 0 then 'check_due'
      when d.covered and private.coverage_check_due('dish', d.item_id, d.covered_since) then 'check_due'
      when d.covered then 'covered'
      when d.pending > 0 then 'pending'
      when d.retake then 'replacement_needed'
      else 'missing'
    end,
    private.coverage_temporarily_unavailable('dish', d.item_id),
    case when d.covered then d.primary_asset_id end,
    d.pending, case when d.covered then d.covered_since end
  from dish d
  union all
  select 'area', a.id, a.label, a.id::text, a.label, 0, 'spaces', true,
    case
      when coalesce(a.has_current, false) then 'covered'
      when coalesce(a.has_check_due, false) then 'check_due'
      when a.pending > 0 then 'pending'
      when coalesce(a.has_public, false) or coalesce(a.retake, false) then 'replacement_needed'
      else 'missing'
    end,
    false,
    case when coalesce(a.has_current, false) or coalesce(a.has_check_due, false)
      then private.slot_effective_primary('area', a.id) end,
    a.pending, a.covered_since
  from area a
  union all
  select 'amenity', m.id, m.question, m.catalogue_category, m.catalogue_category, m.position,
    'facilities', m.required and not m.not_here,
    case
      when m.not_here then 'not_here'
      when not m.required then 'inactive'
      when m.has_public and (m.progress = 'needs_recheck'
        or m.verification is distinct from 'confirmed') then 'check_due'
      when m.has_public then 'covered'
      when m.pending > 0 then 'pending'
      when m.retake then 'replacement_needed'
      else 'missing'
    end,
    m.unavailable,
    -- Not here and inactive slots show no photo.
    case when m.has_public and m.required and not m.not_here
      then private.slot_effective_primary('amenity', m.id) end,
    m.pending, m.covered_since
  from amenity m;
$$;


-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

-- Signature and keys as in 20261118100200. Change: a section's total leaves
-- out an optional packaged item (FA-51).
create or replace function public.album_admin_counts(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_active uuid;
  v_has_menu boolean;
  v_cov jsonb;
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
  v_cov := private.coverage_slots_json(p_venue_id);
  -- A venue with running specials and no published menu still has dishes
  -- (private.current_photo_menu_items, 20261118103100): its menu is ready.
  v_has_menu := v_active is not null or exists (
    select 1 from jsonb_array_elements(v_cov -> 'slots') s where s ->> 'kind' = 'dish');

  return jsonb_build_object(
    'venueId', p_venue_id,
    'menuState', case when v_has_menu then 'ready' else 'no_menu' end,
    'sections', case when not v_has_menu then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'sectionId', g.section_id, 'name', g.section_name, 'kind', g.section_kind,
          'total', g.total, 'accepted', g.accepted, 'waiting', g.waiting)
        order by g.section_position, g.section_id)
      from (
        select (s ->> 'groupKey')::uuid as section_id, s ->> 'groupName' as section_name,
          s ->> 'category' as section_kind, (s ->> 'groupPosition')::integer as section_position,
          count(*)::integer as total,
          (count(*) filter (where s ->> 'state' = 'covered'))::integer as accepted,
          (count(*) filter (where s ->> 'state' = 'pending'))::integer as waiting
        from jsonb_array_elements(v_cov -> 'slots') s
        -- FA-51: an optional packaged item leaves the section's total.
        where s ->> 'kind' = 'dish' and s ->> 'state' <> 'inactive'
        group by 1, 2, 3, 4
      ) g
    ), '[]'::jsonb) end,
    'amenities', coalesce((
      select jsonb_agg(jsonb_build_object(
          'checkId', c.id,
          'category', t.category,
          'progress', c.progress,
          'answer', case when sl.slot ->> 'status' = 'available'
            then sl.slot -> 'answerInUse' ->> 'value' end,
          'openState', (
            select private.knowledge_contribution_view(x.id) ->> 'state'
            from public.knowledge_contributions x
            where x.check_id = c.id and not private.knowledge_is_terminal(x.id)
            order by x.created_at desc, x.id desc
            limit 1),
          'state', cov ->> 'state')
        order by t.position, c.template_key)
      from public.venue_amenity_checks c
      join public.amenity_catalogue t on t.key = c.template_key
      join lateral (
        select s as cov from jsonb_array_elements(v_cov -> 'slots') s
        where s ->> 'kind' = 'amenity' and (s ->> 'slotId')::uuid = c.id
      ) cv on true
      cross join lateral (
        select private.knowledge_slot_json(c, v_uid, 'admin') as slot
      ) sl
      where c.venue_id = p_venue_id and cv.cov ->> 'state' <> 'inactive'
    ), '[]'::jsonb),
    'slots', v_cov -> 'slots',
    'categories', v_cov -> 'categories',
    'totals', v_cov -> 'totals'
  );
end;
$$;

-- Signature and columns as in 20261118100200. Change: eligible items leave
-- out an optional packaged item (FA-51).
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
    r.section_position, count(*)::integer,
    (count(*) filter (where cov.state = 'covered'))::integer,
    (count(*) filter (where r.needs_recheck_count > 0))::integer,
    case when v_reviewer then sum(r.candidate_count)::integer end,
    case when v_reviewer then min(r.oldest_candidate_at) end
  from private.menu_item_photo_rows(v_venue, v_reviewer, private.is_active_admin()) r
  left join cov on cov.slot_id = r.item_id
  -- FA-51: an optional packaged item (state inactive) is not eligible.
  where cov.state is distinct from 'inactive'
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

revoke all on function private.coverage_slot_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function public.menu_item_packaging_set(uuid, boolean, boolean) from public, anon, service_role;
revoke all on function public.menu_item_packaging(uuid) from public, anon, service_role;
grant execute on function public.menu_item_packaging_set(uuid, boolean, boolean) to authenticated;
grant execute on function public.menu_item_packaging(uuid) to authenticated;
