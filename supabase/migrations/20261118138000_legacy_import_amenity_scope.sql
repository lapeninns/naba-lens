-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-R3 (S5 review Y5; FA-54): an import staged on an amenity
-- always reaches a review queue.
--
-- The amenity photo queue (private.amenity_photo_rows) lists only active
-- checks on the venue's working list (private.knowledge_in_scope), while
-- private.asset_unlabelled_reason held every amenity-staged import out of
-- Needs label, whatever its check's state. An import staged on a check that
-- was off the working list, or that left it (or was archived) later, was in
-- neither queue.
--
--   Complete    public.legacy_import_complete stages an amenity only when
--               its check is active and in scope; otherwise the photo is
--               left unlabelled with its legacy label as the note (the
--               existing fallback), so it waits in Needs label. The script
--               offers only in-scope checks as candidates
--               (scripts/import/legacy-import.ts, readCandidates).
--               A staged place label belongs to the asset's uploader so the
--               place review gate recognises it. The batch records the admin.
--   Unlabelled  private.asset_unlabelled_reason holds an amenity-staged
--               import only while that check is active and in scope, the
--               same rule amenity_photo_rows reads. Once the check leaves
--               the working list or is archived, the photo falls back to
--               Needs label ('imported'); if the check comes back, it moves
--               back to the amenity queue. A decided photo stays out of
--               Needs label as before (amenity_photo_decisions).
--
-- Bodies start from the latest definitions: legacy_import_complete
-- (20261118135000; the only definition) and asset_unlabelled_reason
-- (20261118135100). Import shares the upload duplicate lock (20261118108200)
-- because its reservation is still uploading when it first stores the hash.
--
-- Rollback: re-apply those two bodies.

-- ---------------------------------------------------------------------------
-- Complete: an amenity is staged only while its check is in scope
-- ---------------------------------------------------------------------------

create or replace function public.legacy_import_complete(
  p_admin uuid,
  p_asset_id uuid,
  p_line_no integer,
  p_file_path text,
  p_validated_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_captured_source text,
  p_captured_at timestamptz default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_seconds numeric default null,
  p_preview_path text default null,
  p_thumbnail_path text default null,
  p_contributor_email text default null,
  p_contributor_id uuid default null,
  p_manifest_captured_at timestamptz default null,
  p_legacy_label text default null,
  p_legacy_folder text default null,
  p_staged_kind text default null,
  p_staged_id uuid default null
)
returns table (outcome text, asset_id uuid, staged_kind text, staged_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_asset public.media_assets;
  v_duplicate uuid;
  v_ready boolean;
  v_note text;
  v_kind text := p_staged_kind;
  v_staged uuid := p_staged_id;
  v_subject public.knowledge_subjects;
  v_label text := left(nullif(btrim(p_legacy_label), ''), 200);
begin
  perform private.legacy_import_admin(p_admin);
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_content_hash' using errcode = '22023';
  end if;
  if p_captured_source is null or p_captured_source not in ('supplied', 'metadata', 'unknown')
     or ((p_captured_source = 'unknown') <> (p_captured_at is null)) then
    raise exception 'invalid_captured_at' using errcode = '22023';
  end if;
  if (v_kind is null) <> (v_staged is null)
     or (v_kind is not null and v_kind not in ('dish', 'place', 'amenity')) then
    raise exception 'invalid_staged_label' using errcode = '22023';
  end if;

  select a.* into v_asset
  from public.media_assets a
  where a.id = p_asset_id and a.provenance = 'legacy_import' and a.deleted_at is null
  for update;
  if not found then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.upload_state = 'ready' then
    -- Already done by an earlier run: the item was recorded with it.
    return query
      select i.outcome, i.asset_id, i.staged_kind, i.staged_id
      from public.media_import_items i
      where i.batch_id = v_asset.import_batch_id and i.line_no = p_line_no;
    return;
  end if;

  -- Exact duplicate (FA-35, AC21): same venue, same bytes, live and ready.
  perform private.lock_media_duplicate(v_asset.venue_id, p_content_sha256);
  select d.id into v_duplicate
  from public.media_assets d
  where d.venue_id = v_asset.venue_id
    and d.content_sha256 = p_content_sha256
    and d.id <> v_asset.id
    and d.deleted_at is null
    and d.upload_state = 'ready'
  order by d.created_at, d.id
  limit 1;

  if v_duplicate is not null then
    -- The reservation never becomes ready; cleanup removes its objects.
    update public.media_assets a
    set upload_state = 'failed', deleted_at = now()
    where a.id = p_asset_id;
    insert into public.media_import_items (
      batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
      contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id
    )
    values (
      v_asset.import_batch_id, p_line_no, left(p_file_path, 1000), v_asset.venue_id,
      p_content_sha256, nullif(btrim(p_contributor_email), ''), p_contributor_id,
      p_manifest_captured_at, v_label, left(nullif(btrim(p_legacy_folder), ''), 500),
      'duplicate', v_duplicate
    )
    on conflict (batch_id, line_no) do nothing;
    return query select 'duplicate'::text, v_duplicate, null::text, null::uuid;
    return;
  end if;

  update public.media_assets a
  set upload_state = 'processing',
      content_sha256 = p_content_sha256,
      captured_at = p_captured_at,
      captured_at_source = p_captured_source,
      captured_at_set_by = (select p_admin where p_captured_source = 'supplied')
  where a.id = p_asset_id;

  select c.became_ready into v_ready
  from private.complete_media_finalise_core(
    p_asset_id, p_validated_mime_type, p_size_bytes, p_width, p_height,
    p_duration_seconds, p_preview_path, p_thumbnail_path
  ) c;
  if not coalesce(v_ready, false) then
    raise exception 'import_not_ready' using errcode = 'P0001';
  end if;

  v_note := left('Imported' || coalesce('. Legacy label: ' || v_label, ''), 280);

  -- Stage the matched label as staff would have saved it. Anything that no
  -- longer fits (dish left the menu, place retired) leaves the photo
  -- unlabelled with its legacy label as the note instead.
  begin
    if v_kind = 'dish' then
      perform private.save_media_labels_as(
        p_admin, p_asset_id, 0, array['dish'], v_note,
        jsonb_build_array(jsonb_build_object('itemId', v_staged, 'variantId', null)),
        null, private.active_menu_version_id(v_asset.venue_id));
    elsif v_kind = 'place' then
      if v_asset.media_type <> 'image' then
        raise exception 'area_label_image_only' using errcode = '22023';
      end if;
      select s.* into v_subject from public.knowledge_subjects s
      where s.id = v_staged and s.venue_id = v_asset.venue_id and s.retired_at is null;
      if not found then
        raise exception 'area_unavailable' using errcode = 'P0001';
      end if;
      insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
      values (p_asset_id, v_asset.venue_id, v_subject.id, v_subject.kind, v_subject.label, v_asset.uploader_id);
    elsif v_kind = 'amenity' then
      if v_asset.media_type <> 'image' or not exists (
        select 1 from public.venue_amenity_checks c
        where c.id = v_staged and c.venue_id = v_asset.venue_id and c.status = 'active'
          -- S5-R3 (Y5): only a check on the working list has a queue.
          and private.knowledge_in_scope(c.venue_id, c.template_key)
      ) then
        raise exception 'amenity_unavailable' using errcode = 'P0001';
      end if;
    end if;
  exception when others then
    v_kind := null;
    v_staged := null;
  end;

  if v_kind is null or v_kind = 'amenity' or v_kind = 'place' then
    -- The note keeps the legacy label (spec §20 step 2: ambiguous legacy
    -- labels are identified, not guessed).
    perform private.save_media_labels_as(
      p_admin, p_asset_id,
      coalesce((select l.revision from public.media_labels l where l.asset_id = p_asset_id), 0),
      '{}', v_note, '[]'::jsonb, null, null);
  end if;

  insert into public.media_import_items (
    batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
    contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id,
    staged_kind, staged_id
  )
  values (
    v_asset.import_batch_id, p_line_no, left(p_file_path, 1000), v_asset.venue_id,
    p_content_sha256, nullif(btrim(p_contributor_email), ''), p_contributor_id,
    p_manifest_captured_at, v_label, left(nullif(btrim(p_legacy_folder), ''), 500),
    'imported', p_asset_id, v_kind, v_staged
  );

  return query select 'imported'::text, p_asset_id, v_kind, v_staged;
end;
$$;

revoke all on function public.legacy_import_complete(uuid, uuid, integer, text, text, bigint, text, text, timestamptz, integer, integer, numeric, text, text, text, uuid, timestamptz, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.legacy_import_complete(uuid, uuid, integer, text, text, bigint, text, text, timestamptz, integer, integer, numeric, text, text, text, uuid, timestamptz, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Unlabelled rule: the amenity hold follows the amenity queue
-- ---------------------------------------------------------------------------

-- Body as in 20261118135100, with the amenity-staged hold limited to an
-- active, in-scope check (the checks private.amenity_photo_rows lists).
create or replace function private.asset_unlabelled_reason(p_asset_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
      when exists (select 1 from public.media_label_help_requests r where r.asset_id = a.id)
        and not coalesce(ml.has_labels, false) then 'not_sure'
      when ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[] then 'no_dish'
      when not coalesce(ml.has_labels, false) and a.provenance = 'legacy_import' then 'imported'
      when not coalesce(ml.has_labels, false)
        and a.created_at <= now() - make_interval(days => private.label_help_unmatched_days()) then 'unmatched'
    end
  from public.media_assets a
  left join public.media_labels ml on ml.asset_id = a.id
  where a.id = p_asset_id
    and a.deleted_at is null
    and a.upload_state = 'ready'
    and a.purpose = 'general'
    and not exists (select 1 from public.media_label_items li where li.asset_id = a.id)
    and not exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = a.id and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
    and not exists (
      select 1 from public.media_area_labels l where l.asset_id = a.id and l.removed_at is null)
    and not exists (select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id)
    and not exists (select 1 from public.amenity_photo_decisions d where d.asset_id = a.id)
    and not exists (select 1 from public.knowledge_contribution_assets ka where ka.asset_id = a.id)
    and not exists (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id)
    and not exists (
      select 1 from public.media_import_items i
      join public.venue_amenity_checks c on c.id = i.staged_id and c.venue_id = a.venue_id
      where i.asset_id = a.id and i.outcome = 'imported' and i.staged_kind = 'amenity'
        and c.status = 'active'
        and private.knowledge_in_scope(c.venue_id, c.template_key));
$$;
