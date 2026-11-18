-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R4 (V5; spec §6 S4 Change slot, §23.6; FA-21): Change slot
-- on Me as one transaction.
--
-- Before this, the app cleared the old slot (an area label, or the dish
-- labels) in one RPC and saved the new one in another. When the second was
-- refused (a stale label revision, the menu changed, a dish or place retired)
-- the photo was left with no slot at all, and the next try was told a
-- manager had just checked it.
--
-- public.move_my_upload_slot(asset, expected revision, catalogue version,
-- target kind, target id, shared kind) does the whole move in one call:
--
--   1. It locks the photo (the same row lock set_media_area_label, the label
--      saves, finalise and delete take) and checks it is the caller's own,
--      ready image.
--   2. It reads the photo the way My uploads does (public.my_uploads, one
--      rule for staff and managers) and refuses unless it has exactly one
--      dish or place slot that nobody has decided on: 'upload_decided' once
--      anything on it was decided, 'upload_no_slot' when it has no slot.
--   3. It checks the label revision (label_conflict).
--   4. It moves: to a dish (save_media_labels with that one item), to a
--      shared kind (save_media_labels with that content type), or to a place
--      (save_media_labels with nothing, then set_media_area_label). A place
--      label is cleared first when the photo is leaving a place. Every step
--      runs as the caller through the existing RPCs, so their checks (venue,
--      catalogue, retired items or places, withdrawn area credit) all apply.
--
-- Any refusal at any step raises, so the whole move rolls back and the photo
-- keeps its old slot. The label note (an "I'm not sure" note, say) is kept.
--
-- Rollback: drop function public.move_my_upload_slot(uuid, integer, uuid,
-- text, uuid, text).

create function public.move_my_upload_slot(
  p_asset_id uuid,
  p_expected_revision integer,
  p_catalogue_version_id uuid,
  p_target_kind text,
  p_target_id uuid default null,
  p_shared_kind text default null
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
  v_upload jsonb;
  v_slot jsonb;
  v_from text;
  v_revision integer;
  v_note text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_asset_id is null or p_expected_revision is null
     or p_target_kind is null or p_target_kind not in ('dish', 'area', 'shared')
     or (p_target_kind in ('dish', 'area') and (p_target_id is null or p_shared_kind is not null))
     or (p_target_kind = 'shared' and (p_target_id is not null or p_shared_kind is null)) then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.uploader_id <> v_uid
     or v_asset.deleted_at is not null
     or v_asset.upload_state <> 'ready' then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  -- The photo as My uploads shows it: one waiting dish or place slot only.
  v_upload := public.my_uploads(p_limit => 1, p_asset_id => p_asset_id) -> 'items' -> 0;
  if v_upload is null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if jsonb_array_length(v_upload -> 'slots') = 0 then
    raise exception 'upload_no_slot' using errcode = 'P0001';
  end if;
  v_slot := v_upload -> 'slots' -> 0;
  v_from := v_slot ->> 'kind';
  if jsonb_array_length(v_upload -> 'slots') <> 1
     or v_slot ->> 'outcome' <> 'awaiting_review'
     or v_from not in ('dish', 'area') then
    raise exception 'upload_decided' using errcode = 'P0001';
  end if;

  select ml.revision, ml.note into v_revision, v_note
  from public.media_labels ml where ml.asset_id = p_asset_id;
  if coalesce(v_revision, 0) <> p_expected_revision then
    raise exception 'label_conflict' using errcode = 'P0001';
  end if;

  if p_target_kind = 'area' then
    if v_from = 'area' and (v_slot ->> 'slotId')::uuid = p_target_id then
      return jsonb_build_object('changed', false);
    end if;
    if v_from = 'dish' then
      perform 1 from public.save_media_labels(
        p_asset_id, p_expected_revision, array[]::text[], v_note, '[]'::jsonb,
        null, p_catalogue_version_id);
    end if;
    perform 1 from public.set_media_area_label(p_asset_id, p_target_id);
  else
    if p_target_kind = 'dish' and v_from = 'dish'
       and (v_slot ->> 'slotId')::uuid = p_target_id then
      return jsonb_build_object('changed', false);
    end if;
    if v_from = 'area' then
      perform 1 from public.set_media_area_label(p_asset_id, null);
    end if;
    if p_target_kind = 'dish' then
      perform 1 from public.save_media_labels(
        p_asset_id, p_expected_revision, array[]::text[], v_note,
        jsonb_build_array(jsonb_build_object('itemId', p_target_id, 'variantId', null)),
        null, p_catalogue_version_id);
    else
      perform 1 from public.save_media_labels(
        p_asset_id, p_expected_revision, array[p_shared_kind], v_note, '[]'::jsonb,
        null, p_catalogue_version_id);
    end if;
  end if;

  return jsonb_build_object('changed', true);
end;
$$;

comment on function public.move_my_upload_slot(uuid, integer, uuid, text, uuid, text) is
  'S3-R4 (V5), spec §6 S4: moves the caller''s own waiting photo to another dish, place or shared kind in one transaction; any refusal leaves its old slot.';

revoke all on function public.move_my_upload_slot(uuid, integer, uuid, text, uuid, text) from public, anon, service_role;
grant execute on function public.move_my_upload_slot(uuid, integer, uuid, text, uuid, text) to authenticated;
