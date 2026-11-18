-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R2 (release review V12; spec §6 S4; FA-21).
--
-- V12  set_media_area_label let the uploader clear or move an area label a
--      reviewer had already decided on, so a manager's acceptance could be
--      undone from the browser and the place's slot went back to Needed.
--      It now refuses ('area_photo_decided', P0001) any change to a live
--      label whose latest decision is not 'withdrawn' (accepted,
--      needs_another_photo, not_used). Reviewed photos go through a removal
--      or correction request instead.
--
-- Rollback: restore the 20261116170000 body.

-- Body as in 20261116170000, plus the decided-label refusal.
create or replace function public.set_media_area_label(p_asset_id uuid, p_subject_id uuid)
returns table (label_id uuid, subject_id uuid, changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_asset public.media_assets;
  v_live public.media_area_labels;
  v_subject public.knowledge_subjects;
  v_id uuid;
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_asset_id is null then
    raise exception 'invalid_asset' using errcode = '22023';
  end if;

  -- Serialises with label saves, finalise and delete of the photo.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.uploader_id <> v_uid
     or v_asset.deleted_at is not null
     or v_asset.upload_state = 'failed' then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'area_label_image_only' using errcode = '22023';
  end if;

  select l.* into v_live from public.media_area_labels l
  where l.asset_id = p_asset_id and l.removed_at is null
  for update;

  if p_subject_id is not null then
    select s.* into v_subject from public.knowledge_subjects s where s.id = p_subject_id;
    if not found or v_subject.venue_id <> v_asset.venue_id then
      raise exception 'area_wrong_venue' using errcode = '22023';
    end if;
    if v_subject.retired_at is not null then
      raise exception 'area_unavailable' using errcode = 'P0001';
    end if;
  end if;

  -- S3-R2 (V12; spec §6 S4, FA-21): only an unreviewed area may be changed
  -- or removed. Once a reviewer has decided on the live label (accepted,
  -- asked for another photo, not used), the uploader cannot undo it by
  -- clearing or moving the area; a withdrawn label keeps its own rule below
  -- (clearing allowed, a new place refused). The live label is locked FOR
  -- UPDATE above, as decide_area_photo_level locks it, so this serialises
  -- with a reviewer's decision. Choosing the area it already has still
  -- changes nothing.
  if v_live.id is not null and v_live.subject_id is distinct from p_subject_id and exists (
    select 1 from private.area_photo_latest(v_live.id) d
    where d.action is not null and d.action <> 'withdrawn'
  ) then
    raise exception 'area_photo_decided' using errcode = 'P0001';
  end if;

  if v_live.id is not null and v_live.subject_id is not distinct from p_subject_id then
    return query select v_live.id, v_live.subject_id, false;
    return;
  end if;
  if v_live.id is null and p_subject_id is null then
    return query select null::uuid, null::uuid, false;
    return;
  end if;

  -- A reviewer withdrew this photo's area credit: that is final for the
  -- photo. Removing the area and choosing one again must not send it back
  -- to the queue with no history. Clearing the area stays allowed.
  if p_subject_id is not null and exists (
    select 1
    from public.media_area_labels l
    cross join lateral private.area_photo_latest(l.id) d
    where l.asset_id = p_asset_id and d.action = 'withdrawn'
  ) then
    raise exception 'area_photo_withdrawn' using errcode = 'P0001';
  end if;

  if v_live.id is not null then
    update public.media_area_labels l
    set removed_at = now(), removed_by = v_uid
    where l.id = v_live.id;
  end if;

  if p_subject_id is null then
    return query select null::uuid, null::uuid, true;
    return;
  end if;

  insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
  values (p_asset_id, v_asset.venue_id, v_subject.id, v_subject.kind, v_subject.label, v_uid)
  returning id into v_id;
  return query select v_id, v_subject.id, true;
end;
$$;

revoke all on function public.set_media_area_label(uuid, uuid) from public, anon, service_role;
grant execute on function public.set_media_area_label(uuid, uuid) to authenticated;
