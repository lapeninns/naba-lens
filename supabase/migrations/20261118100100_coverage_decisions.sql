-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-COV part 2 of 3: decisions with a review level, amenity
-- photo review and primaries for every slot kind (spec §7 M2, §10 inv. 3, 4;
-- FA-31, FA-32). Tables are in 20261118100000.
--
--   Dishes     the counting rule and the effective primary read public-level
--              photos only (private.menu_item_photo_rows,
--              private.menu_item_effective_primary). New write
--              public.set_menu_item_photo_level: Keep as reference (or
--              Approve for public use) on a waiting, rechecking or accepted
--              label tuple, atomically under the item head. A reference
--              primary gives way to the next public photo.
--   Areas      public.decide_area_photo keeps its signature and means a
--              public acceptance; public.decide_area_photo_level adds the
--              level and Not used.
--   Amenities  private.amenity_photo_rows: the photos that can be reviewed
--              for a check (current answer's evidence, open findings'
--              evidence, or any photo already decided), with their state.
--              public.decide_amenity_photo and public.amenity_photo_queue.
--   Primaries  private.slot_public_photos and private.slot_effective_primary
--              for area and amenity slots: the latest still-eligible choice,
--              else the newest public photo; public.set_slot_primary_photo
--              records a choice under a per-slot lock.
--
-- Nobody decides on a photo they uploaded (as for areas and dishes). A
-- reference acceptance still earns month credit: it is an acceptance.
--
-- Rollback: re-apply private.menu_item_photo_rows (20261107100300),
-- private.menu_item_effective_primary (20261106130000) and
-- public.decide_area_photo (20261116170000); revoke execute on the new public
-- functions.

-- ---------------------------------------------------------------------------
-- Dishes: public-level photos only count
-- ---------------------------------------------------------------------------

-- Body as in 20261107100300, with review_level = 'public' on the covering
-- photo, the accepted count and the recheck count.
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
  select v.id, s.id, s.name, s.kind, s.position, e.item_id, e.position, e.name, e.description, e.aliases,
    coalesce((
      select jsonb_agg(jsonb_build_object('variantId', ev.variant_id, 'name', ev.name) order by ev.position)
      from public.menu_entry_variants ev where ev.entry_id = e.id), '[]'::jsonb),
    pr.photo_id is not null,
    coalesce(ac.accepted, 0), coalesce(ac.recheck, 0),
    pr.photo_id, pr.asset_id,
    coalesce(h.revision, 1),
    case when p_reviewer then coalesce(c.n, 0) end,
    case when p_reviewer then c.oldest end
  from public.menu_versions v
  join public.menu_sections s on s.version_id = v.id and s.kind in ('food', 'drinks')
  join public.menu_entries e on e.version_id = v.id and e.section_id = s.id
  join public.menu_items i on i.id = e.item_id and i.archived_at is null
  left join public.menu_item_photo_heads h on h.item_id = e.item_id
  left join lateral (
    select p.id as photo_id, p.asset_id
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = e.item_id and p.state = 'accepted' and p.review_level = 'public'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
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
  ) ac on true
  left join (
    select t.item_id, count(*)::integer as n, min(t.created_at) as oldest
    from private.menu_photo_pending_tuples(p_venue_id, p_admin) t
    where p_reviewer
    group by t.item_id
  ) c on c.item_id = e.item_id
  where v.venue_id = p_venue_id and v.status = 'active';
$$;

-- Body as in 20261106130000, public-level photos only.
create or replace function private.menu_item_effective_primary(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.menu_item_photos p
  join public.media_assets a on a.id = p.asset_id
  where p.item_id = p_item_id and p.state = 'accepted' and p.review_level = 'public'
    and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  order by p.is_primary desc, p.decided_at, p.id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Dishes: Keep as reference / Approve for public use
-- ---------------------------------------------------------------------------

-- Sets the review level of a label tuple's photo. A waiting or rechecking
-- tuple is first accepted (public.review_menu_item_photo, same locks and
-- checks), then given the level; an accepted one changes level only. The
-- item head moves on every change; p_expected_revision is checked against it
-- by whichever step runs first. A primary kept as reference stops being
-- primary and the next public photo is promoted. Same level: no change.
create function public.set_menu_item_photo_level(
  p_asset_id uuid,
  p_item_id uuid,
  p_variant_id uuid,
  p_level text,
  p_expected_revision integer,
  p_reason text default null,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  item_id uuid,
  state text,
  review_level text,
  is_primary boolean,
  item_revision integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.menu_item_photo_events;
  v_asset public.media_assets;
  v_live public.menu_item_photos;
  v_row public.menu_item_photos;
  v_head integer;
  v_role text;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_photo uuid;
  v_key text := p_client_request_key;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_level is null or p_level not in ('public', 'reference') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if v_key is not null then
    perform private.assert_request_key(v_key);
    perform private.lock_coverage_request(v_uid, v_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = v_key;
    if found then
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'media_asset_not_found' using errcode = 'P0002';
      end if;
      if v_event.asset_id is distinct from p_asset_id or v_event.item_id is distinct from p_item_id
         or v_event.variant_id is distinct from p_variant_id
         or v_event.action not in ('accepted', 'level_set')
         or coalesce(v_event.detail ->> 'level', 'public') is distinct from p_level then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      select p.* into v_row from public.menu_item_photos p where p.id = v_event.photo_id;
      return query select v_row.id, v_row.item_id, v_row.state, v_row.review_level, v_row.is_primary,
        coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = v_row.item_id), 1),
        true;
      return;
    end if;
  end if;

  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  select p.* into v_live from public.menu_item_photos p
  where p.asset_id = p_asset_id and p.item_id = p_item_id
    and p.variant_id is not distinct from p_variant_id
    and p.state in ('accepted', 'better_photo_requested', 'needs_recheck');

  if v_live.id is null or v_live.state <> 'accepted' then
    -- Accept first, with every check review_menu_item_photo makes. The
    -- request key goes on the acceptance for a public level, else on the
    -- level_set event that follows.
    select r.photo_id into v_photo
    from public.review_menu_item_photo(p_asset_id, p_item_id, p_variant_id, 'accepted',
      p_expected_revision, v_reason, false, case when p_level = 'public' then v_key end) r;
    if p_level = 'public' then
      v_key := null;
    end if;
  else
    -- Same lock order as review: asset row, shared venue menu lock, item head.
    perform 1 from public.media_assets a where a.id = p_asset_id for update;
    if private.menu_photo_self_blocked(v_asset.uploader_id) then
      raise exception 'self_review_not_allowed' using errcode = '42501';
    end if;
    if not private.menu_photo_reviewable_uploader(v_asset.uploader_id, private.is_active_admin()) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    perform private.lock_venue_menu(v_asset.venue_id, true);
    v_head := private.lock_item_photo_head(p_item_id, v_asset.venue_id);
    if p_expected_revision is distinct from v_head then
      raise exception 'coverage_conflict' using errcode = '40001',
        detail = jsonb_build_object('revision', v_head)::text;
    end if;
    v_photo := v_live.id;
  end if;

  select p.* into v_row from public.menu_item_photos p where p.id = v_photo for update;
  v_role := private.coverage_actor_role(v_row.venue_id);

  if v_row.review_level <> p_level then
    perform private.bump_item_photo_heads(array[p_item_id], v_row.venue_id);
    update public.menu_item_photos p
    set review_level = p_level,
        is_primary = case when p_level = 'reference' then false else p.is_primary end,
        revision = p.revision + 1
    where p.id = v_photo;
    perform private.record_item_photo_event(v_photo, 'level_set', 'accepted', v_reason,
      v_uid = v_row.author_id, v_key, v_role,
      jsonb_build_object('level', p_level, 'from', v_row.review_level, 'wasPrimary', v_row.is_primary));
    if v_row.is_primary and p_level = 'reference' then
      perform private.record_item_photo_event(v_photo, 'primary_cleared', 'accepted', null, false, null, v_role);
    end if;
    perform private.promote_item_primary(p_item_id, v_role);
  elsif v_live.id is not null and v_live.state = 'accepted' then
    -- Already at this level: nothing changes.
    return query select v_row.id, v_row.item_id, v_row.state, v_row.review_level, v_row.is_primary,
      coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = p_item_id), 1),
      true;
    return;
  end if;

  select p.* into v_row from public.menu_item_photos p where p.id = v_photo;
  return query select v_row.id, v_row.item_id, v_row.state, v_row.review_level, v_row.is_primary,
    coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = p_item_id), 1),
    false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Areas: level and Not used
-- ---------------------------------------------------------------------------

-- One decision on an area photo, with a level on an acceptance.
-- Allowed: waiting -> accepted | needs_another_photo | not_used;
-- needs_another_photo -> accepted | not_used; not_used -> accepted;
-- accepted -> accepted at the other level | withdrawn. Repeating the current
-- state (and level) changes nothing. Nobody decides on a photo they uploaded
-- or labelled. Reasons: required except on an acceptance.
create function public.decide_area_photo_level(
  p_label_id uuid,
  p_action text,
  p_level text default 'public',
  p_reason text default null
)
returns table (label_id uuid, state text, review_level text, changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_label public.media_area_labels;
  v_asset public.media_assets;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_level text := coalesce(p_level, 'public');
  v_current text;
  v_current_level text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if v_level not in ('public', 'reference') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if p_action <> 'accepted' then
    v_level := 'public';
  end if;

  select l.* into v_label from public.media_area_labels l where l.id = p_label_id for update;
  if not found or not private.can_manage_venue(v_label.venue_id) then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  select a.* into v_asset from public.media_assets a where a.id = v_label.asset_id;
  if v_label.removed_at is not null
     or v_label.added_by <> v_asset.uploader_id
     or v_asset.media_type <> 'image'
     or v_asset.upload_state <> 'ready'
     or v_asset.deleted_at is not null then
    raise exception 'area_photo_not_found' using errcode = 'P0002';
  end if;
  if v_asset.uploader_id = v_uid or v_label.added_by = v_uid then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if p_action <> 'accepted' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select coalesce(d.action, 'pending'), coalesce(d.review_level, 'public')
  into v_current, v_current_level
  from (select 1) one
  left join lateral (
    select x.action, x.review_level from public.area_photo_decisions x
    where x.label_id = v_label.id order by x.id desc limit 1
  ) d on true;

  if v_current = p_action and (p_action <> 'accepted' or v_current_level = v_level) then
    return query select v_label.id, v_current, v_current_level, false;
    return;
  end if;
  if not (
    (v_current = 'pending' and p_action in ('accepted', 'needs_another_photo', 'not_used'))
    or (v_current = 'needs_another_photo' and p_action in ('accepted', 'not_used'))
    or (v_current = 'not_used' and p_action = 'accepted')
    or (v_current = 'accepted' and p_action in ('accepted', 'withdrawn'))
  ) then
    raise exception 'area_photo_conflict' using errcode = '40001',
      detail = jsonb_build_object('state', v_current)::text;
  end if;

  insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, review_level, reason, decided_by)
  values (v_label.id, v_label.venue_id, v_label.asset_id, p_action, v_level, v_reason, v_uid);
  return query select v_label.id, p_action, v_level, true;
end;
$$;

-- Signature as in 20261116170000: an acceptance is a public one. Accepting a
-- photo kept as reference makes it public.
create or replace function public.decide_area_photo(p_label_id uuid, p_action text, p_reason text default null)
returns table (label_id uuid, state text, changed boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select d.label_id, d.state, d.changed
  from public.decide_area_photo_level(p_label_id, p_action, 'public', p_reason) d;
$$;

-- ---------------------------------------------------------------------------
-- Amenities: photos that can be reviewed, and their review
-- ---------------------------------------------------------------------------

-- Every photo that can be reviewed for an amenity check at the venue, with
-- its latest decision: photo evidence on the check's current answer or on a
-- finding still open, or any photo already decided for it. Ready, undeleted
-- still images on active, in-scope checks.
create function private.amenity_photo_rows(p_venue_id uuid)
returns table (
  check_id uuid,
  venue_id uuid,
  asset_id uuid,
  uploader_id uuid,
  uploaded_at timestamptz,
  state text,
  review_level text,
  reason text,
  decided_by uuid,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with checks as (
    select c.id, c.venue_id, c.current_submission_id
    from public.venue_amenity_checks c
    where c.venue_id = p_venue_id and c.status = 'active'
      and private.knowledge_in_scope(c.venue_id, c.template_key)
  ),
  linked as (
    select ch.id as check_id, sa.asset_id
    from checks ch
    join public.amenity_submission_assets sa on sa.submission_id = ch.current_submission_id
    where sa.evidence_kind = 'photo'
    union
    select ch.id, ka.asset_id
    from checks ch
    join public.knowledge_contributions k on k.check_id = ch.id
    join public.knowledge_contribution_assets ka on ka.contribution_id = k.id
    where ka.evidence_kind = 'photo' and not private.knowledge_is_terminal(k.id)
    union
    select ch.id, d.asset_id
    from checks ch
    join public.amenity_photo_decisions d on d.check_id = ch.id
  )
  select l.check_id, a.venue_id, a.id, a.uploader_id, a.created_at,
    coalesce(d.action, 'pending'), coalesce(d.review_level, 'public'), d.reason, d.decided_by, d.decided_at
  from linked l
  join public.media_assets a on a.id = l.asset_id and a.venue_id = p_venue_id
  left join lateral (
    select x.action, x.review_level, x.reason, x.decided_by, x.decided_at
    from public.amenity_photo_decisions x
    where x.check_id = l.check_id and x.asset_id = l.asset_id
    order by x.id desc limit 1
  ) d on true
  where a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null;
$$;

-- One photo decision for an amenity check: accepted (public or reference),
-- needs_another_photo, not_used or withdrawn, with the area transitions.
-- The fact is untouched (FA-32). The venue's manager or an admin; nobody on
-- a photo they uploaded.
create function public.decide_amenity_photo(
  p_check_id uuid,
  p_asset_id uuid,
  p_action text,
  p_level text default 'public',
  p_reason text default null
)
returns table (check_id uuid, asset_id uuid, state text, review_level text, changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_check public.venue_amenity_checks;
  v_row record;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_level text := coalesce(p_level, 'public');
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if v_level not in ('public', 'reference') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if p_action <> 'accepted' then
    v_level := 'public';
  end if;

  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  if not found or not private.can_manage_venue(v_check.venue_id) then
    raise exception 'amenity_photo_not_found' using errcode = 'P0002';
  end if;
  select r.* into v_row
  from private.amenity_photo_rows(v_check.venue_id) r
  where r.check_id = p_check_id and r.asset_id = p_asset_id;
  if not found then
    raise exception 'amenity_photo_not_found' using errcode = 'P0002';
  end if;
  if v_row.uploader_id = v_uid then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if p_action <> 'accepted' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_row.state = p_action and (p_action <> 'accepted' or v_row.review_level = v_level) then
    return query select p_check_id, p_asset_id, v_row.state, v_row.review_level, false;
    return;
  end if;
  if not (
    (v_row.state = 'pending' and p_action in ('accepted', 'needs_another_photo', 'not_used'))
    or (v_row.state = 'needs_another_photo' and p_action in ('accepted', 'not_used'))
    or (v_row.state = 'not_used' and p_action = 'accepted')
    or (v_row.state = 'accepted' and p_action in ('accepted', 'withdrawn'))
  ) then
    raise exception 'amenity_photo_conflict' using errcode = '40001',
      detail = jsonb_build_object('state', v_row.state)::text;
  end if;

  insert into public.amenity_photo_decisions (check_id, venue_id, asset_id, action, review_level, reason, decided_by)
  values (p_check_id, v_check.venue_id, p_asset_id, p_action, v_level, v_reason, v_uid);
  return query select p_check_id, p_asset_id, p_action, v_level, true;
end;
$$;

-- The venue's amenity photos for review: p_status pending (oldest first),
-- accepted, needs_another_photo, not_used, withdrawn or all (newest first).
create function public.amenity_photo_queue(
  p_venue_id uuid default null,
  p_status text default 'pending',
  p_limit integer default 50
)
returns table (
  check_id uuid,
  question_key text,
  question text,
  category text,
  asset_id uuid,
  uploader_id uuid,
  uploader_name text,
  uploaded_at timestamptz,
  state text,
  review_level text,
  reason text,
  decided_at timestamptz,
  photo_required boolean,
  can_decide boolean,
  has_thumbnail boolean,
  has_preview boolean
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
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'accepted', 'needs_another_photo', 'not_used', 'withdrawn', 'all') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  perform private.assert_can_manage_venue(v_venue);

  return query
  select r.check_id, c.template_key, t.question, t.category, r.asset_id, r.uploader_id, p.display_name,
    r.uploaded_at, r.state, r.review_level, r.reason, r.decided_at,
    private.amenity_photo_required(c.template_key),
    r.uploader_id <> v_uid and r.state <> 'withdrawn',
    a.thumbnail_path is not null, a.preview_path is not null
  from private.amenity_photo_rows(v_venue) r
  join public.venue_amenity_checks c on c.id = r.check_id
  join public.amenity_catalogue t on t.key = c.template_key
  join public.media_assets a on a.id = r.asset_id
  join public.profiles p on p.id = r.uploader_id
  where v_status = 'all' or r.state = v_status
  order by
    case when v_status = 'pending' then r.uploaded_at end asc,
    coalesce(r.decided_at, r.uploaded_at) desc,
    r.check_id, r.asset_id
  limit v_limit;
end;
$$;

-- Whether a catalogue question needs a reviewed photo (FA-32).
create function private.amenity_photo_required(p_question_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.requirement = 'required' from public.amenity_photo_requirements r
    where r.question_key = p_question_key
  ), true);
$$;

-- ---------------------------------------------------------------------------
-- Primaries for area and amenity slots
-- ---------------------------------------------------------------------------

-- The public photos of one area or amenity slot, newest decision first.
create function private.slot_public_photos(p_kind text, p_slot_id uuid)
returns table (asset_id uuid, uploader_id uuid, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.asset_id, x.uploader_id, x.decided_at
  from (
    select l.asset_id, a.uploader_id, d.decided_at
    from public.media_area_labels l
    join public.knowledge_subjects s on s.id = l.subject_id and s.venue_id = l.venue_id
    join public.media_assets a on a.id = l.asset_id and a.venue_id = l.venue_id
    cross join lateral (
      select x.action, x.review_level, x.decided_at from public.area_photo_decisions x
      where x.label_id = l.id order by x.id desc limit 1
    ) d
    where p_kind = 'area' and l.subject_id = p_slot_id
      and l.removed_at is null and l.added_by = a.uploader_id and s.retired_at is null
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and d.action = 'accepted' and d.review_level = 'public'
    union all
    select r.asset_id, r.uploader_id, r.decided_at
    from public.venue_amenity_checks c
    cross join lateral private.amenity_photo_rows(c.venue_id) r
    where p_kind = 'amenity' and c.id = p_slot_id and r.check_id = c.id
      and r.state = 'accepted' and r.review_level = 'public'
  ) x
  order by x.decided_at desc, x.asset_id;
$$;

-- The effective primary of an area or amenity slot for public use: the latest
-- choice whose photo is still public and current, else the newest public
-- photo, else none.
create function private.slot_effective_primary(p_kind text, p_slot_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select e.asset_id, e.decided_at from private.slot_public_photos(p_kind, p_slot_id) e
  )
  select coalesce(
    (select ch.asset_id from public.slot_primary_choices ch
      where ch.slot_kind = p_kind and ch.slot_id = p_slot_id and ch.use = 'public'
        and ch.asset_id in (select eligible.asset_id from eligible)
      order by ch.id desc limit 1),
    (select eligible.asset_id from eligible order by eligible.decided_at desc, eligible.asset_id limit 1)
  );
$$;

-- Chooses the primary photo of an area or amenity slot (Select primary).
-- The photo must be one of its public photos. The venue's manager or an
-- admin; a manager not on their own photo (as for dishes). Choosing the
-- current one changes nothing.
create function public.set_slot_primary_photo(
  p_slot_kind text,
  p_slot_id uuid,
  p_asset_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_previous uuid;
  v_uploader uuid;
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_slot_kind is null or p_slot_kind not in ('area', 'amenity') then
    raise exception 'invalid_slot_kind' using errcode = '22023';
  end if;
  v_venue := case p_slot_kind
    when 'area' then (select s.venue_id from public.knowledge_subjects s where s.id = p_slot_id)
    else (select c.venue_id from public.venue_amenity_checks c where c.id = p_slot_id)
  end;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'slot_not_found' using errcode = 'P0002';
  end if;
  -- One primary change per slot at a time.
  perform pg_advisory_xact_lock(hashtextextended('slot_primary:' || p_slot_kind || ':' || p_slot_id::text, 0));

  select e.uploader_id into v_uploader
  from private.slot_public_photos(p_slot_kind, p_slot_id) e where e.asset_id = p_asset_id;
  if not found then
    raise exception 'photo_not_eligible' using errcode = 'P0001';
  end if;
  if private.menu_photo_self_blocked(v_uploader) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;

  v_previous := private.slot_effective_primary(p_slot_kind, p_slot_id);
  if v_previous = p_asset_id and exists (
    select 1 from public.slot_primary_choices ch
    where ch.slot_kind = p_slot_kind and ch.slot_id = p_slot_id and ch.asset_id = p_asset_id
  ) then
    return jsonb_build_object('slotKind', p_slot_kind, 'slotId', p_slot_id, 'assetId', p_asset_id,
      'previousAssetId', v_previous, 'changed', false);
  end if;
  insert into public.slot_primary_choices (venue_id, slot_kind, slot_id, asset_id, previous_asset_id, reason, chosen_by)
  values (v_venue, p_slot_kind, p_slot_id, p_asset_id, v_previous, v_reason, v_uid);
  return jsonb_build_object('slotKind', p_slot_kind, 'slotId', p_slot_id, 'assetId', p_asset_id,
    'previousAssetId', v_previous, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.amenity_photo_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function private.amenity_photo_required(text) from public, anon, authenticated, service_role;
revoke all on function private.slot_public_photos(text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.slot_effective_primary(text, uuid) from public, anon, authenticated, service_role;

revoke all on function public.set_menu_item_photo_level(uuid, uuid, uuid, text, integer, text, text) from public, anon, service_role;
revoke all on function public.decide_area_photo_level(uuid, text, text, text) from public, anon, service_role;
revoke all on function public.decide_amenity_photo(uuid, uuid, text, text, text) from public, anon, service_role;
revoke all on function public.amenity_photo_queue(uuid, text, integer) from public, anon, service_role;
revoke all on function public.set_slot_primary_photo(text, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.set_menu_item_photo_level(uuid, uuid, uuid, text, integer, text, text) to authenticated;
grant execute on function public.decide_area_photo_level(uuid, text, text, text) to authenticated;
grant execute on function public.decide_amenity_photo(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.amenity_photo_queue(uuid, text, integer) to authenticated;
grant execute on function public.set_slot_primary_photo(text, uuid, uuid, text) to authenticated;
