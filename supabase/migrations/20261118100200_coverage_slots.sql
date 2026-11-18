-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-COV part 3 of 3: one coverage rule for every slot (spec
-- §2, §10, §18.1; FA-6, FA-11, FA-30, FA-32; AC39).
--
--   Rule     private.coverage_slot_rows(venue): one row per photo slot at the
--            venue with its requirement coverage state:
--              covered             a current public-level photo
--              check_due           covered, but a check is due (a dish photo
--                                  needs a recheck after a menu change, an
--                                  amenity's answer needs a recheck, or the
--                                  freshness hook says so); not in the
--                                  covered numerator (§9.3)
--              pending             a photo is waiting for review
--              replacement_needed  a reviewer asked for another photo
--              missing             none of the above
--              not_here            an amenity confirmed No or Not applicable,
--                                  or its service has ended (inv. 8)
--              inactive            no active photo requirement: a policy
--                                  question whose fact is enough (FA-32)
--            not_here and inactive leave the total. A reference photo never
--            covers (inv. 4). Categories (FA-6): food and drinks (menu
--            sections), spaces (places), facilities (amenity questions);
--            other has no slots yet. `unavailable` flags a temporarily
--            unavailable slot: it stays in the total with its state (inv. 7).
--   Hooks    private.coverage_temporarily_unavailable and
--            private.coverage_check_due return false here. S1-MENUS
--            (availability) and S1-FACTS (freshness policy) replace them in
--            later migrations; the rule above does not change.
--   Reads    public.coverage_slots(venue): the rows and per-category counts,
--            for staff and managers at the venue and admins naming one.
--            public.asset_usages(venue, asset): every photo usage with its
--            review state (§10), managers and admins.
--            album_admin_counts, album_area_states, album_slot_photo_rows and
--            menu_item_photo_summary are re-created on the rule, so staff
--            Album, admin albums and Our menu count the same way.
--
-- Rollback: re-apply public.album_admin_counts (20261117140000),
-- public.album_area_states (20261117120000), private.album_slot_photo_rows
-- (20261117150000) and public.menu_item_photo_summary (20261106130000);
-- revoke execute on public.coverage_slots and public.asset_usages.

-- ---------------------------------------------------------------------------
-- Hooks
-- ---------------------------------------------------------------------------

-- Whether a slot is temporarily unavailable (a dish sold out). Replaced by
-- the availability work; never removes a slot from the total.
create function private.coverage_temporarily_unavailable(p_kind text, p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

-- Whether a covered slot's routine check is due (a freshness policy).
-- p_covered_since is when its current photo was accepted, when known.
create function private.coverage_check_due(p_kind text, p_slot_id uuid, p_covered_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

create function private.coverage_slot_rows(p_venue_id uuid)
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
        where t.item_id = r.item_id and not t.is_recheck), 0)::integer as pending,
      exists (
        select 1 from public.menu_item_photos p
        join public.media_assets a on a.id = p.asset_id
        where p.item_id = r.item_id and p.state = 'better_photo_requested'
          and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      ) as retake
    from private.menu_item_photo_rows(p_venue_id, false, true) r
  ),
  area_live as (
    select l.subject_id, l.asset_id, l.added_at, d.action, d.review_level, d.decided_at
    from public.media_area_labels l
    join public.media_assets a on a.id = l.asset_id and a.venue_id = l.venue_id
    left join lateral (
      select x.action, x.review_level, x.decided_at from public.area_photo_decisions x
      where x.label_id = l.id order by x.id desc limit 1
    ) d on true
    where l.venue_id = p_venue_id and l.removed_at is null and l.added_by = a.uploader_id
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
  ),
  area as (
    select s.id, s.label,
      bool_or(l.action = 'accepted' and l.review_level = 'public') as has_public,
      max(l.decided_at) filter (where l.action = 'accepted' and l.review_level = 'public') as covered_since,
      (count(*) filter (where l.subject_id is not null and l.action is null))::integer as pending,
      bool_or(l.action = 'needs_another_photo') as retake
    from public.knowledge_subjects s
    left join area_live l on l.subject_id = s.id
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
    group by r.check_id
  ),
  amenity as (
    select c.id, t.question, t.category as catalogue_category, t.position, c.progress,
      private.amenity_photo_required(c.template_key) as required,
      (coalesce(sub.answer in ('no', 'not_applicable'), false)
        or coalesce((private.knowledge_check_service_end(c.id, now()) ->> 'inEffect')::boolean, false)
      ) as not_here,
      coalesce(ap.has_public, false) as has_public, ap.covered_since,
      coalesce(ap.pending, 0) as pending, coalesce(ap.retake, false) as retake
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    left join public.amenity_submissions sub on sub.id = c.current_submission_id
    left join amenity_photos ap on ap.check_id = c.id
    where c.venue_id = p_venue_id and c.status = 'active'
      and private.knowledge_in_scope(c.venue_id, c.template_key)
  )
  select 'dish'::text, d.item_id, d.name, d.section_id::text, d.section_name, d.section_position,
    d.section_kind, true,
    case
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
      when coalesce(a.has_public, false) and private.coverage_check_due('area', a.id, a.covered_since) then 'check_due'
      when coalesce(a.has_public, false) then 'covered'
      when a.pending > 0 then 'pending'
      when coalesce(a.retake, false) then 'replacement_needed'
      else 'missing'
    end,
    private.coverage_temporarily_unavailable('area', a.id),
    case when coalesce(a.has_public, false) then private.slot_effective_primary('area', a.id) end,
    a.pending, a.covered_since
  from area a
  union all
  select 'amenity', m.id, m.question, m.catalogue_category, m.catalogue_category, m.position,
    'facilities', m.required and not m.not_here,
    case
      when m.not_here then 'not_here'
      when not m.required then 'inactive'
      when m.has_public and (m.progress = 'needs_recheck'
        or private.coverage_check_due('amenity', m.id, m.covered_since)) then 'check_due'
      when m.has_public then 'covered'
      when m.pending > 0 then 'pending'
      when m.retake then 'replacement_needed'
      else 'missing'
    end,
    private.coverage_temporarily_unavailable('amenity', m.id),
    -- Not here and inactive slots show no photo.
    case when m.has_public and m.required and not m.not_here
      then private.slot_effective_primary('amenity', m.id) end,
    m.pending, m.covered_since
  from amenity m;
$$;

-- Per-category counts over the rule's rows. Total leaves out not_here and
-- inactive; covered is the numerator (§18.1).
create function private.coverage_counts(p_rows jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*) filter (where s ->> 'state' not in ('not_here', 'inactive')),
    'covered', count(*) filter (where s ->> 'state' = 'covered'),
    'checkDue', count(*) filter (where s ->> 'state' = 'check_due'),
    'pending', count(*) filter (where s ->> 'state' = 'pending'),
    'replacementNeeded', count(*) filter (where s ->> 'state' = 'replacement_needed'),
    'missing', count(*) filter (where s ->> 'state' = 'missing'),
    'notHere', count(*) filter (where s ->> 'state' = 'not_here'),
    'inactive', count(*) filter (where s ->> 'state' = 'inactive'),
    'unavailable', count(*) filter (where (s ->> 'unavailable')::boolean
      and s ->> 'state' not in ('not_here', 'inactive'))
  )
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) s;
$$;

create function private.coverage_slots_json(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with slots as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'kind', r.slot_kind, 'slotId', r.slot_id, 'name', r.name,
        'groupKey', r.group_key, 'groupName', r.group_name, 'groupPosition', r.group_position,
        'category', r.category, 'required', r.required,
        'counted', r.state not in ('not_here', 'inactive'),
        'state', r.state, 'unavailable', r.unavailable,
        'primaryAssetId', r.primary_asset_id, 'pendingCount', r.pending_count,
        'coveredSince', r.covered_since)
      order by r.category, r.group_position, r.group_name, r.name, r.slot_id), '[]'::jsonb) as list
    from private.coverage_slot_rows(p_venue_id) r
  )
  select jsonb_build_object(
    'venueId', p_venue_id,
    'slots', s.list,
    'categories', (
      select jsonb_agg(jsonb_build_object('category', c.key) || private.coverage_counts((
          select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(s.list) x
          where x ->> 'category' = c.key))
        order by c.ord)
      from (values ('food', 1), ('drinks', 2), ('spaces', 3), ('facilities', 4), ('other', 5)) as c(key, ord)
    ),
    'totals', private.coverage_counts(s.list)
  )
  from slots s;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Every slot's coverage at the caller's venue: staff and managers at their
-- own venue, an admin naming one. Another venue is refused (wrong_venue).
create function public.coverage_slots(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
begin
  return private.coverage_slots_json(v_venue);
end;
$$;

-- Usage review states (spec §10) for every photo at the venue, or one asset:
-- awaiting_review, reference (kept as reference), public (accepted for public
-- use), retake_requested, not_used, withdrawn. The venue's manager or an
-- admin.
create function public.asset_usages(p_venue_id uuid default null, p_asset_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(v_venue);
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'assetId', u.asset_id, 'kind', u.kind, 'slotId', u.slot_id, 'state', u.state,
        'decidedAt', u.decided_at)
      order by u.asset_id, u.kind, u.slot_id)
    from (
      select p.asset_id, 'dish'::text as kind, p.item_id as slot_id,
        case p.state
          when 'accepted' then p.review_level
          when 'better_photo_requested' then 'retake_requested'
          when 'needs_recheck' then 'awaiting_review'
          else 'withdrawn'
        end as state,
        p.decided_at
      from public.menu_item_photos p
      where p.venue_id = v_venue
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck', 'withdrawn', 'invalidated')
        -- The live row of a tuple, else its latest final row.
        and not exists (
          select 1 from public.menu_item_photos n
          where n.asset_id = p.asset_id and n.item_id = p.item_id
            and n.variant_id is not distinct from p.variant_id and n.created_at > p.created_at)
      union all
      select t.asset_id, 'dish', t.item_id, 'awaiting_review', null::timestamptz
      from private.menu_photo_pending_tuples(v_venue, true) t
      where not t.is_recheck
      union all
      select r.asset_id, 'area', r.subject_id,
        case r.state
          when 'pending' then 'awaiting_review'
          when 'accepted' then coalesce((
            select x.review_level from public.area_photo_decisions x
            where x.label_id = r.label_id order by x.id desc limit 1), 'public')
          when 'needs_another_photo' then 'retake_requested'
          else r.state
        end,
        r.decided_at
      from private.area_photo_rows(v_venue, null) r
      where r.ready and r.deleted_at is null
      union all
      select r.asset_id, 'amenity', r.check_id,
        case r.state
          when 'pending' then 'awaiting_review'
          when 'accepted' then r.review_level
          when 'needs_another_photo' then 'retake_requested'
          else r.state
        end,
        r.decided_at
      from private.amenity_photo_rows(v_venue) r
    ) u
    where p_asset_id is null or u.asset_id = p_asset_id
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Readers re-created on the rule
-- ---------------------------------------------------------------------------

-- Signature and keys as in 20261117140000; sections and amenities now come
-- from the rule (accepted = covered, waiting = pending; an amenity carries
-- its slot state, and one with no photo requirement is left out). Adds
-- `slots` and `categories` (coverage_slots' shape).
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

  return jsonb_build_object(
    'venueId', p_venue_id,
    'menuState', case when v_active is null then 'no_menu' else 'ready' end,
    'sections', case when v_active is null then '[]'::jsonb else coalesce((
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
        where s ->> 'kind' = 'dish'
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

-- Signature and keys as in 20261117120000, on the rule: accepted (covered),
-- check_due, waiting (pending), retake (replacement needed) or needed
-- (missing). assetId: the effective primary of a covered or check_due place,
-- else the newest photo of its state.
create or replace function public.album_area_states(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
begin
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'subjectId', s.id, 'kind', s.kind, 'label', s.label,
        'state', case r.state
          when 'covered' then 'accepted'
          when 'check_due' then 'check_due'
          when 'pending' then 'waiting'
          when 'replacement_needed' then 'retake'
          else 'needed' end,
        'assetId', coalesce(r.primary_asset_id, (
          select l.asset_id
          from public.media_area_labels l
          join public.media_assets a on a.id = l.asset_id
          left join lateral (
            select x.action from public.area_photo_decisions x
            where x.label_id = l.id order by x.id desc limit 1
          ) d on true
          where l.subject_id = s.id and l.removed_at is null and l.added_by = a.uploader_id
            and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
            and ((r.state = 'pending' and d.action is null)
              or (r.state = 'replacement_needed' and d.action = 'needs_another_photo'))
          order by l.added_at desc, l.id
          limit 1)))
      order by lower(s.label), s.id)
    from public.knowledge_subjects s
    join private.coverage_slot_rows(v_venue) r on r.slot_kind = 'area' and r.slot_id = s.id
    where s.venue_id = v_venue and s.retired_at is null
  ), '[]'::jsonb));
end;
$$;

-- Signature as in 20261117150000, on the rule: a covered or check_due area or
-- amenity slot shows its effective primary; a place with a photo waiting
-- shows the newest waiting one (review never gated visibility for places).
create or replace function private.album_slot_photo_rows(p_venue_id uuid)
returns table (kind text, slot_id uuid, asset_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.slot_kind, r.slot_id, coalesce(r.primary_asset_id, (
      select l.asset_id
      from public.media_area_labels l
      join public.media_assets a on a.id = l.asset_id
      where r.slot_kind = 'area' and r.state = 'pending'
        and l.subject_id = r.slot_id and l.removed_at is null and l.added_by = a.uploader_id
        and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
        and not exists (select 1 from public.area_photo_decisions x where x.label_id = l.id)
      order by l.added_at desc, l.id
      limit 1))
  from private.coverage_slot_rows(p_venue_id) r
  where r.slot_kind in ('area', 'amenity')
    and (r.primary_asset_id is not null or (r.slot_kind = 'area' and r.state = 'pending'));
$$;

-- Signature and columns as in 20261106130000. covered_items now counts items
-- the rule calls covered (a recheck makes an item check_due, not covered).
-- needs_recheck_items and the candidate counts stay scoped to what the caller
-- can act on, as before.
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

revoke all on function private.coverage_temporarily_unavailable(text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.coverage_check_due(text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.coverage_slot_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function private.coverage_counts(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.coverage_slots_json(uuid) from public, anon, authenticated, service_role;

revoke all on function public.coverage_slots(uuid) from public, anon, service_role;
revoke all on function public.asset_usages(uuid, uuid) from public, anon, service_role;
grant execute on function public.coverage_slots(uuid) to authenticated;
grant execute on function public.asset_usages(uuid, uuid) to authenticated;
