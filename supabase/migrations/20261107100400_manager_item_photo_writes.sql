-- Venue manager workspace, item photos (part 2 of 3): writes.
--
-- review_menu_item_photo, withdraw_menu_item_photo and
-- set_menu_item_primary_photo keep their signatures and return columns. Each
-- body is the 20261106130000 body plus:
--   * a manager account's own photo raises self_review_not_allowed (42501);
--   * only photos of uploaders the caller may decide on are found (leavers'
--     photos stay admin-only for every write);
--   * replay comparisons are null-safe (`is distinct from`).
-- assign_menu_item_photo records a reviewer-confirmed association: a
-- corrected staff label, a label for an item no longer on the menu, an
-- unlabelled photo, or accepting a reviewer row again after a recheck.

-- ---------------------------------------------------------------------------
-- review_menu_item_photo
-- ---------------------------------------------------------------------------

-- Body as in 20261106130000, plus the self-review block, the reviewable-
-- uploader rule, the corrected-tuple check, and a replay that refuses an
-- assign_menu_item_photo key.
create or replace function public.review_menu_item_photo(
  p_asset_id uuid,
  p_item_id uuid,
  p_variant_id uuid,
  p_decision text,
  p_expected_revision integer,
  p_reason text default null,
  p_make_primary boolean default false,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  item_id uuid,
  state text,
  is_primary boolean,
  item_revision integer,
  self_review boolean,
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
  v_active uuid;
  v_entry_name text;
  v_section_name text;
  v_section_kind text;
  v_variant_name text;
  v_label_at timestamptz;
  v_head integer;
  v_live public.menu_item_photos;
  v_reason text;
  v_self boolean;
  v_role text;
  v_primary boolean := false;
  v_photo uuid;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      -- A replay answers only someone still in scope, and only the same decision.
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'media_asset_not_found' using errcode = 'P0002';
      end if;
      if v_event.asset_id is distinct from p_asset_id or v_event.item_id is distinct from p_item_id
         or v_event.variant_id is distinct from p_variant_id
         or v_event.action is distinct from p_decision
         -- An assign_menu_item_photo key is never a review.
         or v_event.detail ? 'op' then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_id := v_event.item_id;
      state := v_event.to_state;
      is_primary := coalesce((v_event.detail ->> 'isPrimary')::boolean, false);
      item_revision := v_event.item_revision;
      self_review := v_event.self_review;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  if p_decision is null or p_decision not in ('accepted', 'better_photo_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision = 'better_photo_requested' then
    v_reason := private.require_reason(p_reason);
  else
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  end if;

  -- Lock order: asset row, shared venue menu lock, item head.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  -- A manager account never decides on its own photo. Reviewers decide on
  -- active staff and manager accounts' photos; admins also on leavers'.
  if private.menu_photo_self_blocked(v_asset.uploader_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if not private.menu_photo_reviewable_uploader(v_asset.uploader_id, private.is_active_admin()) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_asset.venue_id, true);

  -- The item (of the asset's venue) is on the active version in a food or
  -- drinks section, not archived, and offers the variant.
  v_active := private.active_menu_version_id(v_asset.venue_id);
  select e.name, s.name, s.kind, ev.name
  into v_entry_name, v_section_name, v_section_kind, v_variant_name
  from public.menu_items i
  join public.menu_entries e on e.item_id = i.id and e.version_id = v_active
  join public.menu_sections s on s.id = e.section_id
  left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p_variant_id
  where i.id = p_item_id and i.venue_id = v_asset.venue_id and i.archived_at is null
    and s.kind in ('food', 'drinks')
    and (p_variant_id is null or ev.variant_id is not null);
  if not found then
    raise exception 'menu_item_unavailable' using errcode = 'P0001';
  end if;
  select li.added_at into v_label_at from public.media_label_items li
  where li.asset_id = p_asset_id and li.item_id = p_item_id
    and li.variant_id is not distinct from p_variant_id;
  if not found then
    raise exception 'menu_item_not_labelled' using errcode = 'P0001';
  end if;
  -- A reviewer moved this label to another item; withdraw that decision first.
  if private.menu_photo_tuple_relinked(p_asset_id, p_item_id, p_variant_id, v_label_at) then
    raise exception 'menu_item_relinked' using errcode = 'P0001';
  end if;
  if v_asset.deleted_at is not null then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
  end if;
  if v_asset.upload_state <> 'ready' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_ready';
  end if;

  v_head := private.lock_item_photo_head(p_item_id, v_asset.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;

  select p.* into v_live from public.menu_item_photos p
  where p.asset_id = p_asset_id and p.item_id = p_item_id
    and p.variant_id is not distinct from p_variant_id
    and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  for update;
  if found and v_live.state = p_decision then
    photo_id := v_live.id;
    item_id := v_live.item_id;
    state := v_live.state;
    is_primary := v_live.is_primary;
    item_revision := v_head;
    self_review := v_live.self_review;
    replayed := true;
    return next;
    return;
  end if;
  if found and v_live.state = 'accepted' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', v_live.state, p_decision);
  end if;

  v_self := v_uid = v_asset.uploader_id;
  v_role := private.coverage_actor_role(v_asset.venue_id);
  perform private.bump_item_photo_heads(array[p_item_id], v_asset.venue_id);
  v_head := v_head + 1;

  if p_decision = 'accepted' then
    v_primary := coalesce(p_make_primary, false)
      or private.menu_item_effective_primary(p_item_id) is null;
    if v_primary then
      perform private.clear_item_primary(p_item_id, null, v_role);
    end if;
  end if;

  if v_live.id is null then
    insert into public.menu_item_photos as p (
      venue_id, item_id, variant_id, asset_id, author_id, state, is_primary, reason,
      item_name, variant_name, section_name, section_kind, menu_version_id,
      decided_by, self_review
    )
    values (
      v_asset.venue_id, p_item_id, p_variant_id, p_asset_id, v_asset.uploader_id, p_decision, v_primary,
      v_reason, v_entry_name, v_variant_name, v_section_name, v_section_kind, v_active, v_uid, v_self
    )
    returning p.id into v_photo;
  else
    update public.menu_item_photos p
    set state = p_decision, reason = v_reason, recheck_kind = null, is_primary = v_primary,
        item_name = v_entry_name, variant_name = v_variant_name, section_name = v_section_name,
        section_kind = v_section_kind, menu_version_id = v_active,
        decided_by = v_uid, decided_at = now(), self_review = v_self, revision = p.revision + 1
    where p.id = v_live.id
    returning p.id into v_photo;
  end if;
  perform private.record_item_photo_event(v_photo, p_decision, v_live.state, v_reason, v_self,
    p_client_request_key, v_role, jsonb_build_object('isPrimary', v_primary));
  if p_decision = 'accepted' and not v_primary then
    -- A flagged primary whose photo was deleted gives way to the earliest eligible one.
    perform private.promote_item_primary(p_item_id, v_role);
  end if;

  photo_id := v_photo;
  item_id := p_item_id;
  state := p_decision;
  is_primary := v_primary;
  item_revision := v_head;
  self_review := v_self;
  replayed := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- withdraw_menu_item_photo
-- ---------------------------------------------------------------------------

-- Body as in 20261106130000, plus the self-review block, the
-- reviewable-uploader rule after the scope check, and unlabelled reviewer rows
-- for manager accounts and admins only.
create or replace function public.withdraw_menu_item_photo(
  p_photo_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  state text,
  item_revision integer,
  new_primary_photo_id uuid,
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
  v_photo public.menu_item_photos;
  v_reason text;
  v_head integer;
  v_role text;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
      end if;
      if v_event.photo_id is distinct from p_photo_id or v_event.action is distinct from 'withdrawn' then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      state := v_event.to_state;
      item_revision := v_event.item_revision;
      new_primary_photo_id := (v_event.detail ->> 'newPrimaryPhotoId')::uuid;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id;
  if not found or not private.can_manage_venue(v_photo.venue_id) then
    raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
  end if;
  if private.menu_photo_self_blocked(v_photo.author_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if not private.menu_photo_reviewable_uploader(v_photo.author_id, private.is_active_admin()) then
    raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
  end if;
  -- An unlabelled association: manager accounts and admins only.
  if v_photo.basis = 'reviewer' and v_photo.corrects_item_id is null
     and not private.menu_photo_can_review_unlabelled() then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);

  perform 1 from public.media_assets a where a.id = v_photo.asset_id for update;
  perform private.lock_venue_menu(v_photo.venue_id, true);
  v_head := private.lock_item_photo_head(v_photo.item_id, v_photo.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;
  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id for update;
  if v_photo.state not in ('accepted', 'better_photo_requested', 'needs_recheck') then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> withdrawn', v_photo.state);
  end if;

  v_role := private.coverage_actor_role(v_photo.venue_id);
  perform private.bump_item_photo_heads(array[v_photo.item_id], v_photo.venue_id);
  update public.menu_item_photos p
  set state = 'withdrawn', reason = v_reason, recheck_kind = null, is_primary = false,
      withdrawn_by = v_uid, withdrawn_at = now(), revision = p.revision + 1
  where p.id = p_photo_id;
  v_next := private.promote_item_primary(v_photo.item_id, v_role);
  perform private.record_item_photo_event(p_photo_id, 'withdrawn', v_photo.state, v_reason, false,
    p_client_request_key, v_role, jsonb_build_object('newPrimaryPhotoId', v_next));

  photo_id := p_photo_id;
  state := 'withdrawn';
  item_revision := v_head + 1;
  new_primary_photo_id := v_next;
  replayed := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_menu_item_primary_photo
-- ---------------------------------------------------------------------------

-- Body as in 20261106130000, plus the self-review block (this check is the
-- only guard: the row trigger does not watch primary flips) and the
-- reviewable-uploader rule after the scope check.
create or replace function public.set_menu_item_primary_photo(
  p_photo_id uuid,
  p_expected_revision integer,
  p_client_request_key text default null
)
returns table (photo_id uuid, item_revision integer, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.menu_item_photo_events;
  v_photo public.menu_item_photos;
  v_head integer;
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
      end if;
      if v_event.photo_id is distinct from p_photo_id or v_event.action is distinct from 'primary_set' then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_revision := v_event.item_revision;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id;
  if not found or not private.can_manage_venue(v_photo.venue_id) then
    raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
  end if;
  if private.menu_photo_self_blocked(v_photo.author_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if not private.menu_photo_reviewable_uploader(v_photo.author_id, private.is_active_admin()) then
    raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
  end if;

  perform 1 from public.media_assets a where a.id = v_photo.asset_id for update;
  perform private.lock_venue_menu(v_photo.venue_id, true);
  v_head := private.lock_item_photo_head(v_photo.item_id, v_photo.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;
  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id for update;
  if v_photo.state <> 'accepted' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> primary', v_photo.state);
  end if;
  if not exists (
    select 1 from public.media_assets a
    where a.id = v_photo.asset_id and a.upload_state = 'ready' and a.deleted_at is null
      and a.media_type = 'image'
  ) then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;
  if v_photo.is_primary then
    photo_id := p_photo_id;
    item_revision := v_head;
    replayed := true;
    return next;
    return;
  end if;

  v_role := private.coverage_actor_role(v_photo.venue_id);
  perform private.bump_item_photo_heads(array[v_photo.item_id], v_photo.venue_id);
  perform private.clear_item_primary(v_photo.item_id, p_photo_id, v_role);
  update public.menu_item_photos p
  set is_primary = true, revision = p.revision + 1
  where p.id = p_photo_id;
  perform private.record_item_photo_event(p_photo_id, 'primary_set', 'accepted', null, false,
    p_client_request_key, v_role);

  photo_id := p_photo_id;
  item_revision := v_head + 1;
  replayed := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- assign_menu_item_photo
-- ---------------------------------------------------------------------------

-- A reviewer chooses the item for a photo and accepts it for that item:
--   * p_corrects_item_id set, on the active menu: the staff label
--     (asset, corrects item, corrects variant) was wrong (reason required). The
--     label itself is kept; while this row is live, that tuple has left the
--     waiting queue;
--   * p_corrects_item_id set, not on the active menu: a label for an earlier
--     menu (reason optional);
--   * p_corrects_item_id null: an unlabelled photo tagged as food or drink
--     (manager accounts and admins only; reason optional);
--   * a live reviewer row of the same tuple that needs a recheck (or asked for
--     another photo) is accepted again; p_corrects_* must equal its stored ones
--     (an accepted one with the same p_corrects_* is a no-op, replayed=true; an
--     unlabelled one, manager accounts and admins only). A live staff-label row
--     of the tuple is refused (menu_item_labelled): use review.
-- Locks: asset row, shared venue menu lock, item heads in item_id order.
-- p_expected_revision is the target item's revision.
create function public.assign_menu_item_photo(
  p_asset_id uuid,
  p_item_id uuid,
  p_variant_id uuid,
  p_corrects_item_id uuid,
  p_corrects_variant_id uuid,
  p_reason text,
  p_expected_revision integer,
  p_make_primary boolean default false,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  item_id uuid,
  state text,
  is_primary boolean,
  item_revision integer,
  corrects_item_revision integer,
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
  v_active uuid;
  v_entry_name text;
  v_section_name text;
  v_section_kind text;
  v_variant_name text;
  v_live public.menu_item_photos;
  v_label_at timestamptz;
  v_reason text;
  v_kind text;
  v_items uuid[];
  v_item uuid;
  v_rev integer;
  v_head integer;
  v_corrects_head integer;
  v_self boolean;
  v_role text;
  v_primary boolean := false;
  v_photo uuid;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      -- A replay answers only someone still in scope, and only the same assignment.
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'media_asset_not_found' using errcode = 'P0002';
      end if;
      if v_event.action is distinct from 'accepted'
         or v_event.detail ->> 'op' is distinct from 'assign'
         or v_event.asset_id is distinct from p_asset_id
         or v_event.item_id is distinct from p_item_id
         or v_event.variant_id is distinct from p_variant_id
         or (v_event.detail ->> 'correctsItemId')::uuid is distinct from p_corrects_item_id
         or (v_event.detail ->> 'correctsVariantId')::uuid is distinct from p_corrects_variant_id
         or coalesce((v_event.detail ->> 'makePrimary')::boolean, false)
           is distinct from coalesce(p_make_primary, false) then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_id := v_event.item_id;
      state := v_event.to_state;
      is_primary := coalesce((v_event.detail ->> 'isPrimary')::boolean, false);
      item_revision := v_event.item_revision;
      corrects_item_revision := (v_event.detail ->> 'correctsItemRevision')::integer;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  if p_item_id is null or (p_corrects_variant_id is not null and p_corrects_item_id is null) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Lock order: asset row, shared venue menu lock, item heads.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if private.menu_photo_self_blocked(v_asset.uploader_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if not private.menu_photo_reviewable_uploader(v_asset.uploader_id, private.is_active_admin()) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_asset.venue_id, true);

  -- The target item is on the active version in a food or drinks section, not
  -- archived, and offers the variant (a variant_removed recheck can only be
  -- withdrawn).
  v_active := private.active_menu_version_id(v_asset.venue_id);
  select e.name, s.name, s.kind, ev.name
  into v_entry_name, v_section_name, v_section_kind, v_variant_name
  from public.menu_items i
  join public.menu_entries e on e.item_id = i.id and e.version_id = v_active
  join public.menu_sections s on s.id = e.section_id
  left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p_variant_id
  where i.id = p_item_id and i.venue_id = v_asset.venue_id and i.archived_at is null
    and s.kind in ('food', 'drinks')
    and (p_variant_id is null or ev.variant_id is not null);
  if not found then
    raise exception 'menu_item_unavailable' using errcode = 'P0001';
  end if;

  -- The live row of the target tuple decides first.
  select p.* into v_live from public.menu_item_photos p
  where p.asset_id = p_asset_id and p.item_id = p_item_id
    and p.variant_id is not distinct from p_variant_id
    and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  for update;
  if found and v_live.basis = 'staff_label' then
    raise exception 'menu_item_labelled' using errcode = 'P0001';
  end if;

  if found then
    -- Accepting a reviewer row again: same correction as stored.
    if p_corrects_item_id is distinct from v_live.corrects_item_id
       or p_corrects_variant_id is distinct from v_live.corrects_variant_id then
      raise exception 'corrects_mismatch' using errcode = '22023';
    end if;
    -- An unlabelled association: manager accounts and admins only.
    if v_live.corrects_item_id is null and not private.menu_photo_can_review_unlabelled() then
      raise exception 'not_venue_manager' using errcode = '42501';
    end if;
    -- Already accepted with the same correction: a no-op.
    if v_live.state = 'accepted' then
      photo_id := v_live.id;
      item_id := v_live.item_id;
      state := v_live.state;
      is_primary := v_live.is_primary;
      item_revision := coalesce(
        (select h.revision from public.menu_item_photo_heads h where h.item_id = p_item_id), 1);
      corrects_item_revision := null;
      replayed := true;
      return next;
      return;
    end if;
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
    v_kind := 'reaccept';
    v_items := array[p_item_id];
  else
    if p_corrects_item_id is not null then
      -- A corrected label (item on the menu) or a label for an earlier menu.
      if exists (
        select 1
        from public.menu_entries e
        join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
        join public.menu_items i on i.id = e.item_id and i.archived_at is null
        where e.version_id = v_active and e.item_id = p_corrects_item_id
      ) then
        v_reason := private.require_reason(p_reason);
        v_kind := 'correction';
      else
        v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
        v_kind := 'stale';
      end if;
      select li.added_at into v_label_at from public.media_label_items li
      where li.asset_id = p_asset_id and li.item_id = p_corrects_item_id
        and li.variant_id is not distinct from p_corrects_variant_id;
      if not found then
        raise exception 'relink_requires_label' using errcode = 'P0001';
      end if;
      if private.menu_photo_tuple_relinked(p_asset_id, p_corrects_item_id, p_corrects_variant_id, v_label_at) then
        raise exception 'menu_item_relinked' using errcode = 'P0001';
      end if;
      -- A decision on the staff label stands until withdrawn.
      if exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = p_asset_id and p.item_id = p_corrects_item_id
          and p.variant_id is not distinct from p_corrects_variant_id
          and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
      ) then
        raise exception 'invalid_transition' using errcode = 'P0001', detail = 'withdraw first';
      end if;
    else
      -- Q1 unlabelled (begin)
      if not private.menu_photo_can_review_unlabelled() then
        raise exception 'not_venue_manager' using errcode = '42501';
      end if;
      if exists (select 1 from public.media_label_items li where li.asset_id = p_asset_id) then
        raise exception 'asset_has_labels' using errcode = 'P0001';
      end if;
      if not exists (
        select 1 from public.media_labels ml
        where ml.asset_id = p_asset_id
          and ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[]
      ) then
        raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_food_or_drink';
      end if;
      v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
      v_kind := 'unlabelled';
      -- Q1 unlabelled (end)
    end if;
    if exists (
      select 1 from public.media_label_items li
      where li.asset_id = p_asset_id and li.item_id = p_item_id
        and li.variant_id is not distinct from p_variant_id
    ) then
      raise exception 'menu_item_labelled' using errcode = 'P0001';
    end if;
    v_items := array(
      select distinct u.id from unnest(array[p_item_id, p_corrects_item_id]) as u(id)
      where u.id is not null order by u.id);
  end if;

  if v_asset.deleted_at is not null then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
  end if;
  if v_asset.upload_state <> 'ready' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_ready';
  end if;

  -- Heads in item_id order; only the target's revision is compared.
  foreach v_item in array v_items loop
    v_rev := private.lock_item_photo_head(v_item, v_asset.venue_id);
    if v_item = p_item_id then
      v_head := v_rev;
    else
      v_corrects_head := v_rev;
    end if;
  end loop;
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;

  v_self := v_uid = v_asset.uploader_id;
  v_role := private.coverage_actor_role(v_asset.venue_id);
  perform private.bump_item_photo_heads(v_items, v_asset.venue_id);
  v_head := v_head + 1;
  v_corrects_head := case
    when v_kind = 'reaccept' then null
    -- An option-only correction: one item, one head.
    when p_corrects_item_id = p_item_id then v_head
    else v_corrects_head + 1
  end;

  v_primary := coalesce(p_make_primary, false)
    or private.menu_item_effective_primary(p_item_id) is null;
  if v_primary then
    perform private.clear_item_primary(p_item_id, null, v_role);
  end if;

  if v_live.id is null then
    insert into public.menu_item_photos as p (
      venue_id, item_id, variant_id, asset_id, author_id, state, is_primary, reason,
      item_name, variant_name, section_name, section_kind, menu_version_id,
      decided_by, self_review, basis, corrects_item_id, corrects_variant_id
    )
    values (
      v_asset.venue_id, p_item_id, p_variant_id, p_asset_id, v_asset.uploader_id, 'accepted', v_primary,
      v_reason, v_entry_name, v_variant_name, v_section_name, v_section_kind, v_active, v_uid, v_self,
      'reviewer', p_corrects_item_id, p_corrects_variant_id
    )
    returning p.id into v_photo;
  else
    update public.menu_item_photos p
    set state = 'accepted', reason = coalesce(v_reason, p.reason), recheck_kind = null,
        is_primary = v_primary,
        item_name = v_entry_name, variant_name = v_variant_name, section_name = v_section_name,
        section_kind = v_section_kind, menu_version_id = v_active,
        decided_by = v_uid, decided_at = now(), self_review = v_self, revision = p.revision + 1
    where p.id = v_live.id
    returning p.id into v_photo;
  end if;
  perform private.record_item_photo_event(v_photo, 'accepted', v_live.state, v_reason, v_self,
    p_client_request_key, v_role, jsonb_build_object(
      'op', 'assign',
      'basis', 'reviewer',
      'kind', v_kind,
      'correctsItemId', p_corrects_item_id,
      'correctsVariantId', p_corrects_variant_id,
      'makePrimary', coalesce(p_make_primary, false),
      'isPrimary', v_primary,
      'correctsItemRevision', v_corrects_head));
  if not v_primary then
    -- A flagged primary whose photo was deleted gives way to the earliest eligible one.
    perform private.promote_item_primary(p_item_id, v_role);
  end if;

  photo_id := v_photo;
  item_id := p_item_id;
  state := 'accepted';
  is_primary := v_primary;
  item_revision := v_head;
  corrects_item_revision := v_corrects_head;
  replayed := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.assign_menu_item_photo(uuid, uuid, uuid, uuid, uuid, text, integer, boolean, text)
from public, anon;

grant execute on function
  public.assign_menu_item_photo(uuid, uuid, uuid, uuid, uuid, text, integer, boolean, text)
to authenticated, service_role;
