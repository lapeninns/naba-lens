-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-INT part 1 of 4: the coverage rule reads what Sprint 1
-- built in parallel (spec §2, §9.3, §10 inv. 7, §12.4; FA-11, FA-35; AC21,
-- AC26, AC30).
--
--   Sold out    private.coverage_temporarily_unavailable (an S1-COV stub
--               until now) reads S1-MENUS' dish availability
--               (public.menu_item_availability, an until date in the past
--               reads as available, as menu_offering_states does) and an
--               amenity whose answer in use is a Yes recorded as temporarily
--               unavailable (until a date not yet passed). Places have no
--               unavailability yet. The slot keeps its state and stays in the
--               total (AC26, inv. 7).
--   Freshness   private.coverage_check_due (an S1-COV stub) reads S1-FACTS:
--                 dish     a public photo of the dish waits for a recheck
--                          (menu change or presentation change)
--                 area     no accepted public photo of the place is current
--                          by private.area_photo_freshness (review date
--                          passed, change reported, known change, end date)
--                 amenity  the answer in use is not currently confirmed
--                          (private.knowledge_fact_verification: Unconfirmed,
--                          Check due, Withdrawn), or the check needs a recheck
--               The rule itself now tells a place's states apart: a current
--               public photo covers; a reported change or a passed review
--               date is check_due; a known change or an end date that has
--               passed (needs_replacement, expired) is replacement_needed,
--               or pending while a new photo waits (spec §9.3).
--   Duplicates  private.media_duplicate_suppressed(asset): an asset with
--               media_assets.duplicate_of_asset_id set (S1-UPLOAD, FA-35)
--               while its original is still live and accepted. Such a copy
--               never covers a slot and is not counted as pending, for
--               dishes, places and amenities (AC21; review R4), and earns no
--               monthly credit. Once the original is removed or was never
--               accepted, the copy is the photo that counts and is credited
--               (review R9). private.menu_item_photo_rows leaves suppressed
--               copies out of covered, primary and accepted counts, so Our
--               menu and the staff Album agree with the rule.
--   Credit     private.monthly_credit_items (S1-UPLOAD's wrapper) reads the
--               same helper, and its execute is revoked from public, anon and
--               authenticated (service role only, as before; review R11).
--   Anchor     private.area_photo_freshness counts checks from the start of
--               the photo's current accepted run, so changing its review level
--               no longer clears a reported change, a known change or an end
--               date, nor restarts the 90-day clock (review R17).
--
-- Signatures are unchanged: coverage_slots, album_admin_counts,
-- album_area_states, album_slot_photo_rows and menu_item_photo_summary read
-- the rule and need no change.
--
-- Rollback: re-apply private.monthly_credit_items (20261118102000) and
-- private.area_photo_freshness (20261118104000); drop
-- private.media_duplicate_suppressed; re-apply
-- private.coverage_temporarily_unavailable,
-- private.coverage_check_due and private.coverage_slot_rows from
-- 20261118100200 and private.menu_item_photo_rows from 20261118100100; drop
-- private.coverage_area_freshness and private.coverage_amenity_facts.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A duplicate that counts for nothing: its original (same venue, same bytes)
-- is still live and accepted somewhere. Removing or never accepting the
-- original lets the copy count (review R9).
create function private.media_duplicate_suppressed(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_assets a
    join public.media_assets o on o.id = a.duplicate_of_asset_id
    where a.id = p_asset_id and o.deleted_at is null
      and private.asset_is_accepted(o.id)
  );
$$;

-- A place's photo freshness over its live accepted public photos that are not
-- duplicates: current when any is current; else check_due when any is; else
-- needs_replacement when it has one; null when it has none.
create function private.coverage_area_freshness(p_subject_id uuid, p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with public_labels as (
    select private.area_photo_freshness(l.id, p_now) ->> 'state' as state
    from public.media_area_labels l
    join public.knowledge_subjects s on s.id = l.subject_id and s.venue_id = l.venue_id
    join public.media_assets a on a.id = l.asset_id and a.venue_id = l.venue_id
    cross join lateral (
      select x.action, x.review_level from public.area_photo_decisions x
      where x.label_id = l.id order by x.id desc limit 1
    ) d
    where l.subject_id = p_subject_id and l.removed_at is null and l.added_by = a.uploader_id
      and s.retired_at is null
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and not private.media_duplicate_suppressed(a.id)
      and d.action = 'accepted' and d.review_level = 'public'
  )
  select case
    when not exists (select 1 from public_labels) then null
    when exists (select 1 from public_labels p where p.state = 'current') then 'current'
    when exists (select 1 from public_labels p where p.state = 'check_due') then 'check_due'
    else 'needs_replacement'
  end;
$$;

-- Every active check of a venue with its answer's verification (spec §10 fact
-- verification, S1-FACTS) and whether a Yes in use is temporarily
-- unavailable. One resolver call for the venue.
create function private.coverage_amenity_facts(p_venue_id uuid, p_now timestamptz default now())
returns table (check_id uuid, verification text, unavailable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with keys as (
    select array_agg(c.template_key order by c.template_key) as ks
    from public.venue_amenity_checks c where c.venue_id = p_venue_id and c.status = 'active'
  )
  select s.check_id,
    private.knowledge_fact_verification(s.status, s.reason, s.detail),
    coalesce(s.qualifier = 'temporarily_unavailable'
      and coalesce(private.knowledge_safe_date(s.qualified_detail -> 'availability' ->> 'until')
        >= (p_now at time zone private.venue_timezone(p_venue_id))::date, true), false)
  from keys
  cross join lateral private.knowledge_slot_state_b03(p_venue_id, keys.ks, p_now) s
  where keys.ks is not null and s.check_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- Hooks (S1-COV stubs replaced)
-- ---------------------------------------------------------------------------

create or replace function private.coverage_temporarily_unavailable(p_kind text, p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'dish' then exists (
      select 1 from public.menu_item_availability a
      where a.item_id = p_slot_id
        and (a.until_on is null or a.until_on >= private.london_today()))
    when 'amenity' then coalesce((
      select f.unavailable
      from public.venue_amenity_checks c
      cross join lateral private.coverage_amenity_facts(c.venue_id) f
      where c.id = p_slot_id and f.check_id = c.id), false)
    else false
  end;
$$;

-- p_covered_since is kept for the signature; the S1-FACTS rules count from
-- each photo's own acceptance and reconfirmations.
create or replace function private.coverage_check_due(p_kind text, p_slot_id uuid, p_covered_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'dish' then exists (
      select 1 from public.menu_item_photos p
      join public.media_assets a on a.id = p.asset_id
      where p.item_id = p_slot_id and p.state = 'needs_recheck' and p.review_level = 'public'
        and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
        and not private.media_duplicate_suppressed(a.id))
    when 'area' then coalesce(private.coverage_area_freshness(p_slot_id) <> 'current', false)
    when 'amenity' then coalesce((
      select c.progress = 'needs_recheck' or f.verification is distinct from 'confirmed'
      from public.venue_amenity_checks c
      left join lateral (
        select x.verification from private.coverage_amenity_facts(c.venue_id) x where x.check_id = c.id
      ) f on true
      where c.id = p_slot_id), false)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Dish photo rows: duplicates leave covered, primary and accepted counts
-- ---------------------------------------------------------------------------

-- Body as in 20261118100100, plus no suppressed duplicate in the
-- primary and accepted-count reads (AC21).
create or replace function private.menu_item_photo_rows(p_venue_id uuid, p_reviewer boolean, p_admin boolean)
returns table (
  menu_version_id uuid,
  section_id uuid,
  section_name text,
  section_kind text,
  section_position integer,
  item_id uuid,
  entry_position integer,
  name text,
  description text,
  aliases text[],
  variants jsonb,
  covered boolean,
  accepted_count integer,
  needs_recheck_count integer,
  primary_photo_id uuid,
  primary_asset_id uuid,
  item_revision integer,
  candidate_count integer,
  oldest_candidate_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.menu_version_id, e.section_id, e.section_name, e.section_kind, e.section_position,
    e.item_id, e.entry_position, e.name, e.description, e.aliases,
    coalesce((
      select jsonb_agg(jsonb_build_object('variantId', ev.variant_id, 'name', ev.name) order by ev.position)
      from public.menu_entry_variants ev where ev.entry_id = e.entry_id), '[]'::jsonb),
    pr.photo_id is not null,
    coalesce(ac.accepted, 0), coalesce(ac.recheck, 0),
    pr.photo_id, pr.asset_id,
    coalesce(h.revision, 1),
    case when p_reviewer then coalesce(c.n, 0) end,
    case when p_reviewer then c.oldest end
  from private.current_photo_menu_items(p_venue_id) e
  left join public.menu_item_photo_heads h on h.item_id = e.item_id
  left join lateral (
    select p.id as photo_id, p.asset_id
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = e.item_id and p.state = 'accepted' and p.review_level = 'public'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      and not private.media_duplicate_suppressed(a.id)
    order by p.is_primary desc, p.decided_at, p.id
    limit 1
  ) pr on true
  left join lateral (
    select
      (count(distinct p.asset_id) filter (where p.state = 'accepted'))::integer as accepted,
      (count(*) filter (where p.state = 'needs_recheck'
        and private.menu_photo_reviewable_uploader(a.uploader_id, p_admin)))::integer as recheck
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = e.item_id and p.state in ('accepted', 'needs_recheck')
      and p.review_level = 'public'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      and not private.media_duplicate_suppressed(a.id)
  ) ac on true
  left join (
    select t.item_id, count(*)::integer as n, min(t.created_at) as oldest
    from private.menu_photo_pending_tuples(p_venue_id, p_admin) t
    where p_reviewer
    group by t.item_id
  ) c on c.item_id = e.item_id
  where e.section_kind in ('food', 'drinks');
$$;

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- Signature and states as in 20261118100200. Changes: duplicates never cover
-- or count as pending; dish unavailability and check-due read the hooks; a
-- place reads its photo freshness; an amenity reads its fact verification and
-- temporary unavailability from one resolver call.
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
    from private.menu_item_photo_rows(p_venue_id, false, true) r
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
-- Monthly credit: a duplicate counts once its original no longer does (R9)
-- ---------------------------------------------------------------------------

-- Signature and columns as in 20261118102000.
create or replace function private.monthly_credit_items(p_month date)
returns table (author_id uuid, venue_id uuid, asset_id uuid, decided_at timestamptz, evidence_removed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.author_id, c.venue_id, c.asset_id, c.decided_at, c.evidence_removed
  from private.monthly_credit_items_base(p_month) c
  where not private.media_duplicate_suppressed(c.asset_id);
$$;

-- ---------------------------------------------------------------------------
-- Area photo freshness anchored to the accepted run (R17)
-- ---------------------------------------------------------------------------

-- Body as in 20261118104000, with the checks and the basis counted from the
-- first acceptance after the latest non-accepting decision.
create or replace function private.area_photo_freshness(p_label_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_label public.media_area_labels;
  v_latest record;
  v_start timestamptz;
  v_tz text;
  v_last public.area_photo_checks;
  v_until date;
  v_basis date;
  v_policy public.knowledge_freshness_policies;
  v_entry jsonb;
begin
  select l.* into v_label from public.media_area_labels l where l.id = p_label_id;
  if not found then
    return null;
  end if;
  select d.action, d.decided_at into v_latest
  from public.area_photo_decisions d
  where d.label_id = p_label_id and d.decided_at <= p_now
  order by d.id desc limit 1;
  if v_latest.action is distinct from 'accepted' then
    return jsonb_build_object('state', 'not_accepted');
  end if;
  -- S2-INT (review R17): checks count from the start of the current accepted
  -- run, so a level change (reference <-> public) is not a reconfirmation.
  select min(d.decided_at) into v_start
  from public.area_photo_decisions d
  where d.label_id = p_label_id and d.decided_at <= p_now and d.action = 'accepted'
    and d.id > coalesce((
      select max(x.id) from public.area_photo_decisions x
      where x.label_id = p_label_id and x.decided_at <= p_now and x.action <> 'accepted'), 0);
  v_tz := private.venue_timezone(v_label.venue_id);

  select c.valid_until into v_until from public.area_photo_checks c
  where c.label_id = p_label_id and c.kind = 'end_date_set'
    and c.created_at >= v_start and c.created_at <= p_now
  order by c.id desc limit 1;
  if v_until is not null and (p_now at time zone v_tz)::date > v_until then
    return jsonb_build_object('state', 'expired', 'cause', 'end_date_passed',
      'validUntil', to_char(v_until, 'YYYY-MM-DD'), 'nextCheckDue', null, 'verifiedOn', null, 'dueSoon', false);
  end if;

  select c.* into v_last from public.area_photo_checks c
  where c.label_id = p_label_id and c.kind in ('reconfirmed', 'change_reported', 'replacement_needed')
    and c.created_at >= v_start and c.created_at <= p_now
  order by c.id desc limit 1;
  if v_last.kind in ('change_reported', 'replacement_needed') then
    return jsonb_build_object(
      'state', case v_last.kind when 'change_reported' then 'check_due' else 'needs_replacement' end,
      'cause', v_last.kind, 'reason', v_last.reason, 'reportedAt', v_last.created_at,
      'validUntil', to_char(v_until, 'YYYY-MM-DD'), 'nextCheckDue', null, 'verifiedOn', null, 'dueSoon', false);
  end if;

  v_basis := greatest((v_start at time zone v_tz)::date,
    (select max(c.checked_on) from public.area_photo_checks c
      where c.label_id = p_label_id and c.kind = 'reconfirmed'
        and c.created_at >= v_start and c.created_at <= p_now));
  v_policy := private.knowledge_policy_as_of('space_photo', 'public', p_now);
  if v_policy.id is null then
    return jsonb_build_object('state', 'current', 'cause', null, 'verifiedOn', to_char(v_basis, 'YYYY-MM-DD'),
      'nextCheckDue', null, 'dueSoon', false, 'validUntil', to_char(v_until, 'YYYY-MM-DD'));
  end if;
  v_entry := private.knowledge_freshness_entry('public', v_policy.max_age, v_policy.recheck_lead,
    v_policy.basis, v_basis, null, p_now, v_tz);
  return jsonb_build_object(
    'state', case when v_entry ->> 'state' = 'expired' then 'check_due' else 'current' end,
    'cause', case when v_entry ->> 'state' = 'expired' then 'review_date_passed' end,
    'verifiedOn', to_char(v_basis, 'YYYY-MM-DD'),
    'nextCheckDue', v_entry -> 'nextCheckDue',
    'dueSoon', v_entry ->> 'state' = 'due_soon',
    'validUntil', to_char(v_until, 'YYYY-MM-DD'),
    'policyId', v_policy.id, 'policyVersion', v_policy.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.media_duplicate_suppressed(uuid) from public, anon, authenticated, service_role;
revoke all on function private.monthly_credit_items(date) from public, anon, authenticated;
grant execute on function private.monthly_credit_items(date) to service_role;
revoke all on function private.area_photo_freshness(uuid, timestamptz) from public, anon, authenticated;

revoke all on function private.coverage_area_freshness(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.coverage_amenity_facts(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.coverage_temporarily_unavailable(text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.coverage_check_due(text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.coverage_slot_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function private.menu_item_photo_rows(uuid, boolean, boolean) from public, anon, authenticated, service_role;
