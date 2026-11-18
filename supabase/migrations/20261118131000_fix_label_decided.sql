-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R13: Fix label reaches every photo a manager can review
-- (spec §7 M2 Fix label, AC15: "Managers can correct labels without a
-- re-upload").
--
-- X7  public.assign_menu_item_photo refused a correction while the staff
--     label had a live decision ('withdraw first'), and once withdrawn the
--     photo left the queue, so a dish label decided wrongly (accepted, asked
--     again, needs a recheck) could not be moved without a re-upload. A
--     correction now withdraws the staff label's live row in the same step,
--     under the same item-head locks, with the reason, and records it as its
--     own 'withdrawn' event (detail op 'fix_label' and the new dish). The
--     staff label itself (media_label_items) is never touched, so the
--     history keeps what staff chose. A label that was already corrected once
--     (a live reviewer row corrects it) still refuses ('menu_item_relinked'):
--     withdraw that correction first.
--
-- X8  public.review_fix_label moves a photo to another slot: a place or an
--     amenity, or a dish when the photo was on a place or an amenity. It ends
--     the source with the existing decision functions (a place or amenity
--     acceptance is withdrawn, anything else is Not used; a dish staff label
--     is withdrawn with the reason), then accepts the photo for the target:
--       place    a new area label for the photo, credited to its uploader
--                (area labels earn the uploader's credit; the coverage rule
--                reads added_by = uploader), with fixed_by = the reviewer and
--                fixes_label_id = the label it replaced; then
--                decide_area_photo_level('accepted').
--       amenity  an accepted amenity_photo_decisions row for the check and
--                photo (a reviewed link, as private.amenity_photo_rows reads
--                decisions); decide_amenity_photo when the pair was Not used.
--       dish     public.assign_menu_item_photo (unlabelled path). That path
--                only takes a photo the unlabelled rule lists or one tagged
--                food or drink; a photo the reviewer is moving off a place or
--                amenity in this same transaction is allowed through
--                private.review_fix_label_moving (a transaction-local
--                setting only review_fix_label sets).
--     Dish to dish stays Fix label's relink (assign_menu_item_photo), and a
--     Needs label photo to a dish stays assign_unlabelled. Every check the
--     decision functions make still applies: the venue, the role, the
--     reviewer's own photo, a set-aside photo, a removed or video photo.
--
-- Reads  public.review_photo_detail adds 'relinked' to each dish (its staff
--        label is already corrected by a live reviewer row), so the screen
--        offers Fix label only where the database takes it.
--
-- Rollback: re-apply public.assign_menu_item_photo (20261118120300) and
-- public.review_photo_detail (20261118120400); drop public.review_fix_label
-- and private.review_fix_label_moving; drop the two media_area_labels
-- columns.

-- ---------------------------------------------------------------------------
-- Place labels a reviewer fixed
-- ---------------------------------------------------------------------------

alter table public.media_area_labels
  add column fixed_by uuid references public.profiles (id) on delete restrict,
  add column fixes_label_id uuid references public.media_area_labels (id) on delete restrict,
  add constraint media_area_labels_fixed_pair check (fixes_label_id is null or fixed_by is not null);

comment on column public.media_area_labels.fixed_by is
  'S3-R13 X8: the reviewer who moved the photo to this place with Fix label (added_by stays the uploader, whose credit it is).';
comment on column public.media_area_labels.fixes_label_id is
  'S3-R13 X8: the place label this one replaced, when Fix label moved the photo from another place.';

-- ---------------------------------------------------------------------------
-- The photo review_fix_label is moving, for this transaction only
-- ---------------------------------------------------------------------------

create function private.review_fix_label_moving(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('nabalens.fix_label_asset', true), '') = p_asset_id::text;
$$;

revoke all on function private.review_fix_label_moving(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- X7: assign_menu_item_photo withdraws a decided staff label in the same step
-- ---------------------------------------------------------------------------

-- Body as in 20261118120300, plus: a correction of a staff label with a live
-- decision withdraws that row (under the item-head locks) instead of
-- refusing, and the unlabelled path takes a photo review_fix_label is moving.
create or replace function public.assign_menu_item_photo(
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
  v_staff_live uuid;
  v_staff public.menu_item_photos;
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
      -- S3-R13 X7: a decision on the staff label (accepted, asked again,
      -- needs a recheck) is withdrawn in this step, below, with the reason.
      select p.id into v_staff_live from public.menu_item_photos p
      where p.asset_id = p_asset_id and p.item_id = p_corrects_item_id
        and p.variant_id is not distinct from p_corrects_variant_id
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck');
      if v_staff_live is not null and v_reason is null then
        v_reason := private.require_reason(p_reason);
      end if;
    else
      -- Q1 unlabelled (begin)
      if not private.menu_photo_can_review_unlabelled() then
        raise exception 'not_venue_manager' using errcode = '42501';
      end if;
      if exists (select 1 from public.media_label_items li where li.asset_id = p_asset_id) then
        raise exception 'asset_has_labels' using errcode = 'P0001';
      end if;
      -- S3-R1 K1: any photo the unlabelled rule lists (I'm not sure, Match
      -- later for 7 days), as well as a food or drink tag. S3-R13 X8: or a
      -- photo review_fix_label is moving off a place or an amenity.
      if private.asset_unlabelled_reason(p_asset_id) is null and not exists (
        select 1 from public.media_labels ml
        where ml.asset_id = p_asset_id
          and ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[]
      ) and not private.review_fix_label_moving(p_asset_id) then
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

  -- S3-R13 X7: withdraw the staff label's live decision (as
  -- withdraw_menu_item_photo does), now that both heads are locked.
  if v_staff_live is not null then
    select p.* into v_staff from public.menu_item_photos p where p.id = v_staff_live for update;
    if v_staff.state in ('accepted', 'better_photo_requested', 'needs_recheck') then
      update public.menu_item_photos p
      set state = 'withdrawn', reason = v_reason, recheck_kind = null, is_primary = false,
          withdrawn_by = v_uid, withdrawn_at = now(), revision = p.revision + 1
      where p.id = v_staff_live;
      perform private.record_item_photo_event(v_staff_live, 'withdrawn', v_staff.state, v_reason, v_self,
        null, v_role, jsonb_build_object('op', 'fix_label', 'toItemId', p_item_id,
          'toVariantId', p_variant_id));
      if p_corrects_item_id is distinct from p_item_id then
        perform private.promote_item_primary(p_corrects_item_id, v_role);
      end if;
    end if;
  end if;

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
-- X8: move a photo to a place, an amenity, or off one onto a dish
-- ---------------------------------------------------------------------------

create function public.review_fix_label(
  p_asset_id uuid,
  p_from_kind text,
  p_from_id uuid,
  p_from_variant_id uuid,
  p_to_kind text,
  p_to_id uuid,
  p_to_variant_id uuid default null,
  p_level text default 'public',
  p_reason text default null,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_admin boolean;
  v_level text := coalesce(p_level, 'public');
  v_reason text;
  v_latest bigint;
  v_active uuid;
  v_label public.media_area_labels;
  v_state text;
  v_label_at timestamptz;
  v_live public.menu_item_photos;
  v_pending boolean;
  v_head integer;
  v_role text;
  v_entry_name text;
  v_section_name text;
  v_section_kind text;
  v_variant_name text;
  v_photo uuid;
  v_subject public.knowledge_subjects;
  v_check public.venue_amenity_checks;
  v_new_label uuid;
  v_out jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_from_kind is null or p_from_kind not in ('dish', 'area', 'amenity', 'none')
     or p_to_kind is null or p_to_kind not in ('dish', 'area', 'amenity')
     or p_to_id is null
     or (p_from_kind <> 'none' and p_from_id is null)
     or (p_from_kind <> 'dish' and p_from_variant_id is not null)
     or (p_to_kind <> 'dish' and p_to_variant_id is not null)
     -- Dish to dish is Fix label's relink, and a Needs label photo to a dish
     -- is assign_unlabelled (public.assign_menu_item_photo).
     or (p_to_kind = 'dish' and p_from_kind in ('dish', 'none')) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_level not in ('public', 'reference') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  if p_from_kind = p_to_kind and p_from_id = p_to_id then
    raise exception 'fix_label_same_slot' using errcode = '22023';
  end if;
  v_reason := case when p_from_kind = 'none'
    then private.clean_text(p_reason, 500, 'invalid_reason')
    else private.require_reason(p_reason) end;

  -- Lock order: the asset row first, as every decision path.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_admin := private.is_active_admin();
  if not private.menu_photo_reviewable_uploader(v_asset.uploader_id, v_admin) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.uploader_id = v_uid and not private.review_self_allowed(v_asset.venue_id) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  if v_asset.deleted_at is not null or v_asset.upload_state <> 'ready' then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
  end if;
  if private.asset_set_aside(v_asset.id) then
    select d.id into v_latest from public.review_dispositions d
    where d.asset_id = v_asset.id order by d.id desc limit 1;
    raise exception 'review_conflict' using errcode = '40001',
      detail = private.review_conflict_detail('disposition', v_latest);
  end if;

  -- ---- The source ----------------------------------------------------------
  if p_from_kind = 'none' then
    -- A photo with no slot: what the Needs label list holds.
    if not private.menu_photo_can_review_unlabelled() then
      raise exception 'not_venue_manager' using errcode = '42501';
    end if;
    if exists (select 1 from public.media_label_items li where li.asset_id = v_asset.id)
       or exists (select 1 from public.media_area_labels l
                  where l.asset_id = v_asset.id and l.removed_at is null)
       or exists (select 1 from private.amenity_photo_rows(v_asset.venue_id) r
                  where r.asset_id = v_asset.id
                    and r.state in ('pending', 'accepted', 'needs_another_photo')) then
      raise exception 'asset_has_labels' using errcode = 'P0001';
    end if;

  elsif p_from_kind = 'dish' then
    perform private.lock_venue_menu(v_asset.venue_id, true);
    select li.added_at into v_label_at from public.media_label_items li
    where li.asset_id = v_asset.id and li.item_id = p_from_id
      and li.variant_id is not distinct from p_from_variant_id;
    if not found then
      raise exception 'relink_requires_label' using errcode = 'P0001';
    end if;
    if private.menu_photo_tuple_relinked(v_asset.id, p_from_id, p_from_variant_id, v_label_at) then
      raise exception 'menu_item_relinked' using errcode = 'P0001';
    end if;
    v_head := private.lock_item_photo_head(p_from_id, v_asset.venue_id);
    if p_expected_revision is distinct from v_head then
      raise exception 'coverage_conflict' using errcode = '40001',
        detail = jsonb_build_object('revision', v_head)::text;
    end if;
    select p.* into v_live from public.menu_item_photos p
    where p.asset_id = v_asset.id and p.item_id = p_from_id
      and p.variant_id is not distinct from p_from_variant_id
      and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
    for update;
    v_pending := v_live.id is null and exists (
      select 1 from private.menu_photo_pending_tuples(v_asset.venue_id, v_admin) pt
      where pt.asset_id = v_asset.id and pt.item_id = p_from_id
        and pt.variant_id is not distinct from p_from_variant_id);
    v_role := private.coverage_actor_role(v_asset.venue_id);
    if v_live.id is not null or v_pending then
      perform private.bump_item_photo_heads(array[p_from_id], v_asset.venue_id);
    end if;
    if v_pending then
      -- A staff label still waiting: its row starts live (the insert guard)
      -- and is withdrawn at once, so the label leaves the queue with the
      -- reason, as a decided one does.
      v_active := private.active_menu_version_id(v_asset.venue_id);
      select e.name, s.name, s.kind, ev.name
      into v_entry_name, v_section_name, v_section_kind, v_variant_name
      from public.menu_entries e
      join public.menu_sections s on s.id = e.section_id
      left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p_from_variant_id
      where e.item_id = p_from_id and e.version_id = v_active;
      insert into public.menu_item_photos as p (
        venue_id, item_id, variant_id, asset_id, author_id, state, is_primary, reason,
        item_name, variant_name, section_name, section_kind, menu_version_id,
        decided_by, self_review, basis
      )
      values (
        v_asset.venue_id, p_from_id, p_from_variant_id, v_asset.id, v_asset.uploader_id, 'accepted', false,
        null, v_entry_name, case when p_from_variant_id is null then null else v_variant_name end,
        v_section_name, v_section_kind, v_active, v_uid, v_asset.uploader_id = v_uid, 'staff_label'
      )
      returning p.id into v_photo;
      select p.* into v_live from public.menu_item_photos p where p.id = v_photo;
    end if;
    if v_live.id is not null then
      update public.menu_item_photos p
      set state = 'withdrawn', reason = v_reason, recheck_kind = null, is_primary = false,
          withdrawn_by = v_uid, withdrawn_at = now(), revision = p.revision + 1
      where p.id = v_live.id;
      perform private.record_item_photo_event(v_live.id, 'withdrawn',
        case when v_pending then null else v_live.state end, v_reason, v_asset.uploader_id = v_uid,
        null, v_role, jsonb_build_object('op', 'fix_label', 'toKind', p_to_kind, 'toId', p_to_id));
      perform private.promote_item_primary(p_from_id, v_role);
    end if;

  elsif p_from_kind = 'area' then
    select l.* into v_label from public.media_area_labels l
    where l.id = p_from_id and l.asset_id = v_asset.id and l.removed_at is null
    for update;
    if not found then
      raise exception 'area_photo_not_found' using errcode = 'P0002';
    end if;
    if p_to_kind = 'area' and v_label.subject_id = p_to_id then
      raise exception 'fix_label_same_slot' using errcode = '22023';
    end if;
    select coalesce(d.action, 'pending') into v_state
    from (select 1) one left join lateral private.area_photo_latest(v_label.id) d on true;
    if v_state in ('pending', 'needs_another_photo', 'accepted') then
      perform public.decide_area_photo_level(v_label.id,
        case when v_state = 'accepted' then 'withdrawn' else 'not_used' end, 'public', v_reason);
    end if;
    update public.media_area_labels l set removed_at = now(), removed_by = v_uid
    where l.id = v_label.id;

  else -- amenity
    select r.state into v_state from private.amenity_photo_rows(v_asset.venue_id) r
    where r.check_id = p_from_id and r.asset_id = v_asset.id;
    if not found then
      raise exception 'amenity_photo_not_found' using errcode = 'P0002';
    end if;
    if v_state in ('pending', 'needs_another_photo', 'accepted') then
      perform public.decide_amenity_photo(p_from_id, v_asset.id,
        case when v_state = 'accepted' then 'withdrawn' else 'not_used' end, 'public', v_reason);
    end if;
  end if;

  -- ---- The target ----------------------------------------------------------
  if p_to_kind = 'area' then
    select s.* into v_subject from public.knowledge_subjects s where s.id = p_to_id;
    if not found or v_subject.venue_id <> v_asset.venue_id then
      raise exception 'area_wrong_venue' using errcode = '22023';
    end if;
    if v_subject.retired_at is not null then
      raise exception 'area_unavailable' using errcode = 'P0001';
    end if;
    -- One place per photo: another live place label is decided on its own.
    if exists (select 1 from public.media_area_labels l
               where l.asset_id = v_asset.id and l.removed_at is null) then
      raise exception 'area_photo_labelled' using errcode = 'P0001';
    end if;
    insert into public.media_area_labels (
      asset_id, venue_id, subject_id, subject_kind, subject_label, added_by, fixed_by, fixes_label_id)
    values (v_asset.id, v_asset.venue_id, v_subject.id, v_subject.kind, v_subject.label,
      v_asset.uploader_id, v_uid, case when p_from_kind = 'area' then p_from_id end)
    returning id into v_new_label;
    perform public.decide_area_photo_level(v_new_label, 'accepted', v_level, v_reason);
    v_out := jsonb_build_object('toKind', 'area', 'toId', v_subject.id, 'labelId', v_new_label);

  elsif p_to_kind = 'amenity' then
    select c.* into v_check from public.venue_amenity_checks c where c.id = p_to_id for update;
    if not found or v_check.venue_id <> v_asset.venue_id or v_check.status <> 'active'
       or not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
      raise exception 'amenity_photo_not_found' using errcode = 'P0002';
    end if;
    select r.state into v_state from private.amenity_photo_rows(v_asset.venue_id) r
    where r.check_id = v_check.id and r.asset_id = v_asset.id;
    if found then
      if v_state <> 'not_used' then
        raise exception 'amenity_photo_conflict' using errcode = '40001',
          detail = jsonb_build_object('state', v_state)::text;
      end if;
      perform public.decide_amenity_photo(v_check.id, v_asset.id, 'accepted', v_level, v_reason);
    else
      insert into public.amenity_photo_decisions (check_id, venue_id, asset_id, action, review_level, reason, decided_by)
      values (v_check.id, v_asset.venue_id, v_asset.id, 'accepted', v_level, v_reason, v_uid);
    end if;
    v_out := jsonb_build_object('toKind', 'amenity', 'toId', v_check.id);

  else -- dish, from a place or an amenity
    perform set_config('nabalens.fix_label_asset', v_asset.id::text, true);
    select to_jsonb(r) into v_out
    from public.assign_menu_item_photo(v_asset.id, p_to_id, p_to_variant_id, null, null,
      v_reason, p_expected_revision, false, null) r;
    perform set_config('nabalens.fix_label_asset', '', true);
    v_out := jsonb_build_object('toKind', 'dish', 'toId', p_to_id,
      'itemRevision', v_out -> 'item_revision');
  end if;

  return v_out;
end;
$$;

comment on function public.review_fix_label(uuid, text, uuid, uuid, text, uuid, uuid, text, text, integer) is
  'S3-R13 X8: Fix label to a place or an amenity (or off one onto a dish): ends the source with the decision functions and accepts the photo for the target.';

revoke all on function public.review_fix_label(uuid, text, uuid, uuid, text, uuid, uuid, text, text, integer)
  from public, anon, service_role;
grant execute on function public.review_fix_label(uuid, text, uuid, uuid, text, uuid, uuid, text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reads: whether a dish staff label is already corrected
-- ---------------------------------------------------------------------------

-- Body as in 20261118120400, plus 'relinked' on each dish.
create or replace function public.review_photo_detail(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_admin boolean;
  v_active uuid;
  v_out jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found or not private.can_manage_venue(v_asset.venue_id)
     or v_asset.upload_state <> 'ready' or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_admin := private.is_active_admin();
  v_active := private.active_menu_version_id(v_asset.venue_id);

  select jsonb_build_object(
    'assetId', v_asset.id,
    'venueId', v_asset.venue_id,
    'mediaType', v_asset.media_type,
    'width', v_asset.width,
    'height', v_asset.height,
    'sizeBytes', v_asset.size_bytes,
    'durationSeconds', v_asset.duration_seconds,
    'uploadedAt', v_asset.created_at,
    'capturedAt', v_asset.captured_at,
    'capturedAtSource', v_asset.captured_at_source,
    'hasThumbnail', v_asset.thumbnail_path is not null,
    'hasPreview', v_asset.preview_path is not null,
    'contributor', (
      select jsonb_build_object('id', p.id, 'name', p.display_name, 'active', p.active)
      from public.profiles p where p.id = v_asset.uploader_id),
    'isSelf', v_asset.uploader_id = v_uid,
    -- A manager never decides on their own photo; an admin may.
    'selfBlocked', v_asset.uploader_id = v_uid and not v_admin
      and not private.review_self_allowed(v_asset.venue_id),
    -- K6: the venue is single-reviewer and this is the manager's own photo.
    'selfReviewAllowed', v_asset.uploader_id = v_uid and private.review_self_allowed(v_asset.venue_id),
    'note', (select ml.note from public.media_labels ml where ml.asset_id = v_asset.id),
    'contentTypes', coalesce((select to_jsonb(ml.content_types) from public.media_labels ml
      where ml.asset_id = v_asset.id), '[]'::jsonb),
    'needsLabel', private.menu_photo_unlabelled_eligible(v_asset.id, v_asset.venue_id)
      and not private.asset_set_aside(v_asset.id),
    -- K1: why it needs a label (not_sure, no_dish, unmatched), or null.
    'unlabelledReason', private.asset_unlabelled_reason(v_asset.id),
    'duplicateOfAssetId', v_asset.duplicate_of_asset_id,
    'possibleDuplicates', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', d.id,
        'hasThumbnail', d.thumbnail_path is not null, 'accepted', private.asset_is_accepted(d.id),
        'uploadedAt', d.created_at) order by d.created_at, d.id)
      from public.media_assets d
      where d.venue_id = v_asset.venue_id and d.id <> v_asset.id and d.deleted_at is null
        and d.upload_state = 'ready'
        and (d.id = v_asset.duplicate_of_asset_id
          or (v_asset.content_sha256 is not null and d.content_sha256 = v_asset.content_sha256))), '[]'::jsonb),
    -- Sent together: the same person's photos from the same batch.
    'group', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', g.id,
        'hasThumbnail', g.thumbnail_path is not null, 'uploadedAt', g.created_at)
        order by g.created_at, g.id)
      from (
        select g.* from public.media_assets g
        where v_asset.client_batch_id is not null
          and g.uploader_id = v_asset.uploader_id and g.client_batch_id = v_asset.client_batch_id
          and g.venue_id = v_asset.venue_id and g.id <> v_asset.id
          and g.upload_state = 'ready' and g.deleted_at is null and g.media_type = 'image'
        order by g.created_at, g.id limit 12) g), '[]'::jsonb),
    'disposition', (
      select jsonb_build_object('id', d.id, 'action', d.action, 'reasonCode', d.reason_code,
        'reason', d.reason, 'duplicateOfAssetId', d.duplicate_of_asset_id,
        'by', p.display_name, 'at', d.decided_at)
      from public.review_dispositions d join public.profiles p on p.id = d.decided_by
      where d.asset_id = v_asset.id order by d.id desc limit 1),
    -- The dish slots: every staff label and every live reviewer row.
    'dishes', coalesce((
      select jsonb_agg(x.j order by x.ord, x.name)
      from (
        select min(t.ord) as ord, t.item_id, t.variant_id, max(t.name) as name,
          jsonb_build_object(
            'itemId', t.item_id,
            'variantId', t.variant_id,
            'itemName', coalesce(max(e.name), max(t.name)),
            'variantName', max(t.variant_name),
            'sectionName', max(s.name),
            'sectionKind', max(s.kind),
            'onMenu', bool_or(e.item_id is not null),
            'staffLabel', bool_or(t.staff),
            -- S3-R13: a live reviewer row already corrects this staff label.
            'relinked', bool_or(t.staff) and exists (
              select 1 from public.media_label_items li2
              where li2.asset_id = v_asset.id and li2.item_id = t.item_id
                and li2.variant_id is not distinct from t.variant_id
                and private.menu_photo_tuple_relinked(v_asset.id, t.item_id, t.variant_id, li2.added_at)),
            'waiting', exists (
              select 1 from private.menu_photo_pending_tuples(v_asset.venue_id, v_admin) pt
              where pt.asset_id = v_asset.id and pt.item_id = t.item_id
                and pt.variant_id is not distinct from t.variant_id),
            'photoId', max(lp.id::text),
            'state', max(lp.state),
            'level', max(lp.review_level),
            'basis', max(lp.basis),
            'isPrimary', bool_or(coalesce(lp.is_primary, false)),
            'itemRevision', coalesce((select h.revision from public.menu_item_photo_heads h
              where h.item_id = t.item_id), 1),
            'presentationRevision', coalesce((select pr.revision from public.menu_item_presentations pr
              where pr.item_id = t.item_id), 1),
            'presentationNote', (select pr.note from public.menu_item_presentations pr
              where pr.item_id = t.item_id),
            'neededBy', (select nb.needed_by from public.menu_item_needed_by nb
              where nb.item_id = t.item_id and nb.venue_id = v_asset.venue_id and nb.cleared_at is null),
            'publicPhotos', coalesce((
              select jsonb_agg(jsonb_build_object('assetId', ap.asset_id, 'photoId', ap.id,
                'isPrimary', ap.id = private.menu_item_effective_primary(t.item_id),
                'hasThumbnail', aa.thumbnail_path is not null)
                order by (ap.id = private.menu_item_effective_primary(t.item_id)) desc, ap.decided_at desc)
              from (
                select p.* from public.menu_item_photos p
                where p.item_id = t.item_id and p.state = 'accepted' and p.review_level = 'public'
                  and p.asset_id <> v_asset.id
                order by p.decided_at desc limit 4) ap
              join public.media_assets aa on aa.id = ap.asset_id
              where aa.upload_state = 'ready' and aa.deleted_at is null), '[]'::jsonb)
          ) as j
        from (
          select 0 as ord, li.item_id, li.variant_id, li.item_name as name, li.variant_name, true as staff
          from public.media_label_items li where li.asset_id = v_asset.id
          union all
          select 1, p.item_id, p.variant_id, p.item_name, p.variant_name, false
          from public.menu_item_photos p
          where p.asset_id = v_asset.id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
        ) t
        left join public.menu_entries e on e.item_id = t.item_id and e.version_id = v_active
        left join public.menu_sections s on s.id = e.section_id
        left join public.menu_item_photos lp
          on lp.asset_id = v_asset.id and lp.item_id = t.item_id
          and lp.variant_id is not distinct from t.variant_id
          and lp.state in ('accepted', 'better_photo_requested', 'needs_recheck')
        group by t.item_id, t.variant_id
      ) x), '[]'::jsonb),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object(
        'labelId', l.id,
        'subjectId', l.subject_id,
        'name', coalesce(ks.label, l.subject_label),
        'state', coalesce(d.action, 'pending'),
        'level', coalesce(d.review_level, 'public'),
        'decisionId', d.id,
        'isPrimary', private.slot_effective_primary('area', l.subject_id) = v_asset.id,
        'publicPhotos', coalesce((
          select jsonb_agg(jsonb_build_object('assetId', sp.asset_id,
            'isPrimary', sp.asset_id = private.slot_effective_primary('area', l.subject_id)))
          from (select e.asset_id from private.slot_public_photos('area', l.subject_id) e
                where e.asset_id <> v_asset.id limit 4) sp), '[]'::jsonb)
      ) order by l.added_at)
      from public.media_area_labels l
      left join public.knowledge_subjects ks on ks.id = l.subject_id
      left join lateral (
        select x.id, x.action, x.review_level from public.area_photo_decisions x
        where x.label_id = l.id order by x.id desc limit 1) d on true
      where l.asset_id = v_asset.id and l.removed_at is null), '[]'::jsonb),
    'amenities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'checkId', r.check_id,
        'question', t.question,
        'state', r.state,
        'level', r.review_level,
        'photoRequired', private.amenity_photo_required(c.template_key),
        'decisionId', (select x.id from public.amenity_photo_decisions x
          where x.check_id = r.check_id and x.asset_id = r.asset_id order by x.id desc limit 1),
        'isPrimary', private.slot_effective_primary('amenity', r.check_id) = r.asset_id,
        'publicPhotos', coalesce((
          select jsonb_agg(jsonb_build_object('assetId', sp.asset_id,
            'isPrimary', sp.asset_id = private.slot_effective_primary('amenity', r.check_id)))
          from (select e.asset_id from private.slot_public_photos('amenity', r.check_id) e
                where e.asset_id <> v_asset.id limit 4) sp), '[]'::jsonb)
      ) order by t.question)
      from private.amenity_photo_rows(v_asset.venue_id) r
      join public.venue_amenity_checks c on c.id = r.check_id
      join public.amenity_catalogue t on t.key = c.template_key
      where r.asset_id = v_asset.id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.j order by h.at desc, h.seq desc)
      from (
        select hh.* from (
          select ev.created_at as at, ev.id as seq, jsonb_build_object(
            'source', 'dish', 'action', ev.action, 'reason', ev.reason,
            'subject', coalesce(mp.item_name, ev.item_id::text),
            'level', ev.detail ->> 'level',
            'by', ap.display_name, 'role', ev.actor_role, 'at', ev.created_at) as j
          from public.menu_item_photo_events ev
          left join public.menu_item_photos mp on mp.id = ev.photo_id
          left join public.profiles ap on ap.id = ev.actor_id
          where ev.asset_id = v_asset.id
          union all
          select d.decided_at, d.id, jsonb_build_object(
            'source', 'place', 'action', d.action, 'reason', d.reason,
            'subject', l.subject_label, 'level', d.review_level,
            'by', p.display_name, 'at', d.decided_at)
          from public.area_photo_decisions d
          join public.media_area_labels l on l.id = d.label_id
          join public.profiles p on p.id = d.decided_by
          where d.asset_id = v_asset.id
          union all
          select d.decided_at, d.id, jsonb_build_object(
            'source', 'amenity', 'action', d.action, 'reason', d.reason,
            'subject', t.question, 'level', d.review_level,
            'by', p.display_name, 'at', d.decided_at)
          from public.amenity_photo_decisions d
          join public.venue_amenity_checks c on c.id = d.check_id
          join public.amenity_catalogue t on t.key = c.template_key
          join public.profiles p on p.id = d.decided_by
          where d.asset_id = v_asset.id
          union all
          select d.decided_at, d.id, jsonb_build_object(
            'source', 'photo', 'action', d.action, 'reason', d.reason, 'reasonCode', d.reason_code,
            'subject', null, 'level', null, 'by', p.display_name, 'at', d.decided_at)
          from public.review_dispositions d
          join public.profiles p on p.id = d.decided_by
          where d.asset_id = v_asset.id
        ) hh
        order by hh.at desc, hh.seq desc
        limit 50
      ) h), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
