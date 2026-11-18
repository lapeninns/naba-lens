-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R1: the Review reads.
--
--   Queue    public.manager_menu_photo_queue, as in 20261118110000, plus:
--              Needs label  the one unlabelled rule (K1,
--                           private.asset_unlabelled): I'm not sure, food or
--                           drink with no dish, and no label for 7 days
--                           (FA-4), photos and videos;
--              p_media_type image or video (K11, spec §7 M2 filters);
--              disposition_id  the photo's latest review_dispositions id, so
--                           a batch Not used is made against what the screen
--                           saw (V16);
--              self_review_allowed  the caller's own photo at their
--                           single-reviewer venue (K6);
--              unlabelled_reason  why a Needs label card waits;
--              media_type.
--   Detail   public.review_photo_detail: selfBlocked follows K6, plus
--            selfReviewAllowed and unlabelledReason.
--   Queues   public.area_photo_queue and public.amenity_photo_queue:
--            can_decide follows K6.
--
-- Rollback: re-create public.manager_menu_photo_queue and re-apply
-- public.review_photo_detail (20261118110000), public.area_photo_queue
-- (20261116170000) and public.amenity_photo_queue (20261118100100).

drop function public.manager_menu_photo_queue(
  uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer, text, integer, boolean, boolean);

create function public.manager_menu_photo_queue(
  p_venue_id uuid default null,
  p_status text default 'pending',
  p_section_id uuid default null,
  p_contributor_id uuid default null,
  p_item_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_key uuid default null,
  p_limit integer default 25,
  p_section_kind text default null,
  p_min_age_days integer default null,
  p_possible_duplicate boolean default false,
  p_needed_by boolean default false,
  p_media_type text default null
)
returns table (
  kind text,
  sort_key uuid,
  label_id uuid,
  photo_id uuid,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  section_id uuid,
  section_name text,
  staff_label jsonb,
  uploader_id uuid,
  uploader_name text,
  contributor_status text,
  can_follow_up boolean,
  is_self boolean,
  photo_state text,
  is_primary boolean,
  is_effective_primary boolean,
  basis text,
  reason text,
  recheck_kind text,
  corrects_item_id uuid,
  corrects_variant_id uuid,
  corrects_item_name text,
  item_revision integer,
  item_covered boolean,
  group_count integer,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer,
  created_at timestamptz,
  labelled_at timestamptz,
  captured_at timestamptz,
  captured_at_source text,
  duplicate_of_asset_id uuid,
  possible_duplicate boolean,
  staff_note text,
  section_kind text,
  disposition_id bigint,
  self_review_allowed boolean,
  unlabelled_reason text,
  media_type text
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
  v_admin boolean;
  v_active uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  v_itemless boolean;
  v_before timestamptz;
  v_self_allowed boolean;
begin
  perform private.assert_can_manage_venue(v_venue);
  if v_status not in (
    'pending', 'recheck', 'needs_another_photo', 'accepted', 'stale_label', 'unlabelled', 'mine', 'all'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_section_kind is not null and p_section_kind not in ('food', 'drinks') then
    raise exception 'invalid_section_kind' using errcode = '22023';
  end if;
  if p_media_type is not null and p_media_type not in ('image', 'video') then
    raise exception 'invalid_media_type' using errcode = '22023';
  end if;
  if p_min_age_days is not null and (p_min_age_days < 0 or p_min_age_days > 3650) then
    raise exception 'invalid_age' using errcode = '22023';
  end if;
  v_before := case when p_min_age_days is not null then now() - make_interval(days => p_min_age_days) end;
  v_admin := private.is_active_admin();
  v_active := private.active_menu_version_id(v_venue);
  v_itemless := v_status in ('stale_label', 'unlabelled');
  v_self_allowed := private.review_self_allowed(v_venue);
  return query
  with m as (
    -- Items of the active countable menu.
    select e.item_id, e.id as entry_id, e.name, s.id as section_id, s.name as section_name, s.kind as section_kind
    from public.menu_entries e
    join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
    join public.menu_items i on i.id = e.item_id and i.archived_at is null
    where e.version_id = v_active
  ),
  pt as (
    select t.* from private.menu_photo_pending_tuples(v_venue, v_admin, v_status = 'mine') t
    where v_status in ('pending', 'recheck', 'mine', 'all')
  ),
  base as (
    select 'labelled'::text as kind, t.label_id, t.live_photo_id as photo_id, t.asset_id,
      t.item_id, t.variant_id, t.labelled_at
    from pt t
    where v_status <> 'recheck' or t.is_recheck
    union all
    -- Live rows: reviewer rechecks not listed above and the decided sets.
    select 'decided', null::uuid, p.id, p.asset_id, p.item_id, p.variant_id, null::timestamptz
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.venue_id = v_venue
      and (
        (v_status in ('recheck', 'all') and p.state = 'needs_recheck' and p.basis = 'reviewer'
          -- Staff labelled it the same way: the labelled branch lists it.
          and not exists (select 1 from pt where pt.live_photo_id = p.id))
        or (v_status in ('needs_another_photo', 'all') and p.state = 'better_photo_requested')
        or (v_status in ('accepted', 'all') and p.state = 'accepted')
      )
      and exists (select 1 from m where m.item_id = p.item_id)
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    union all
    select 'stale', null::uuid, null::uuid, a.id, null::uuid, null::uuid, null::timestamptz
    from public.media_assets a
    where v_status in ('stale_label', 'all')
      and a.venue_id = v_venue
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and private.menu_photo_stale_label(a.id, v_venue)
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    -- Needs label (FA-4, K1): the one unlabelled rule, photos and videos.
    union all
    select 'unlabelled', null::uuid, null::uuid, a.id, null::uuid, null::uuid, null::timestamptz
    from public.media_assets a
    where v_status in ('unlabelled', 'pending', 'all')
      and a.venue_id = v_venue
      and a.upload_state = 'ready' and a.deleted_at is null and a.purpose = 'general'
      and private.menu_photo_can_review_unlabelled()
      and private.asset_unlabelled(a.id)
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
  ),
  qr as (
    select b.kind, coalesce(b.label_id, b.photo_id, b.asset_id) as sort_key,
      b.label_id, b.photo_id, b.asset_id, b.item_id, b.variant_id,
      m.name as item_name, ev.name as variant_name, m.section_id, m.section_name, m.section_kind,
      a.uploader_id, up.display_name as uploader_name,
      case
        when not up.active then 'left'
        when up.role = 'manager' then 'manager'
        when up.venue_id = v_venue then 'here'
        else 'moved'
      end as contributor_status,
      a.uploader_id = v_uid as is_self,
      p.state as photo_state, coalesce(p.is_primary, false) as is_primary,
      p.basis, p.reason, p.recheck_kind, p.corrects_item_id, p.corrects_variant_id,
      a.thumbnail_path is not null as has_thumbnail, a.preview_path is not null as has_preview,
      a.width, a.height, a.created_at, b.labelled_at, a.media_type::text as media_type,
      a.captured_at, a.captured_at_source, a.duplicate_of_asset_id,
      (a.duplicate_of_asset_id is not null
        or (a.content_sha256 is not null and exists (
          select 1 from public.media_assets d
          where d.venue_id = a.venue_id and d.content_sha256 = a.content_sha256
            and d.id <> a.id and d.deleted_at is null))) as possible_duplicate,
      (select ml.note from public.media_labels ml where ml.asset_id = a.id) as staff_note,
      case when b.item_id is null then 0 else (count(*) over (partition by b.item_id))::integer - 1 end
        as group_count
    from base b
    join public.media_assets a on a.id = b.asset_id
    join public.profiles up on up.id = a.uploader_id
    left join m on m.item_id = b.item_id
    left join public.menu_entry_variants ev on ev.entry_id = m.entry_id and ev.variant_id = b.variant_id
    left join public.menu_item_photos p on p.id = b.photo_id
    where (p_contributor_id is null or a.uploader_id = p_contributor_id)
      and (p_section_id is null or v_itemless or m.section_id = p_section_id)
      and (p_item_id is null or v_itemless or b.item_id = p_item_id)
      and (p_section_kind is null or m.section_kind = p_section_kind)
      and (v_before is null or a.created_at <= v_before)
      and (p_media_type is null or a.media_type::text = p_media_type)
      and (not coalesce(p_needed_by, false) or exists (
        select 1 from public.menu_item_needed_by nb
        where nb.item_id = b.item_id and nb.venue_id = v_venue and nb.cleared_at is null))
  )
  select rw.kind, rw.sort_key, rw.label_id, rw.photo_id, rw.asset_id, rw.item_id, rw.variant_id,
    rw.item_name, rw.variant_name, rw.section_id, rw.section_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', li.item_id, 'variantId', li.variant_id,
        'itemName', li.item_name, 'variantName', li.variant_name,
        'onMenu', exists (select 1 from m where m.item_id = li.item_id))
        order by li.added_at, li.id)
      from public.media_label_items li where li.asset_id = rw.asset_id), '[]'::jsonb),
    rw.uploader_id, rw.uploader_name, rw.contributor_status, rw.contributor_status = 'here',
    rw.is_self, rw.photo_state, rw.is_primary,
    rw.photo_id is not null and private.menu_item_effective_primary(rw.item_id) = rw.photo_id,
    rw.basis, rw.reason, rw.recheck_kind, rw.corrects_item_id, rw.corrects_variant_id,
    case when rw.corrects_item_id is not null then coalesce(
      (select li.item_name from public.media_label_items li
       where li.asset_id = rw.asset_id and li.item_id = rw.corrects_item_id
       order by li.added_at limit 1),
      (select m.name from m where m.item_id = rw.corrects_item_id),
      (select e.name from public.menu_entries e
       join public.menu_versions mv on mv.id = e.version_id
       where e.item_id = rw.corrects_item_id
       order by mv.activated_at desc nulls last, mv.created_at desc limit 1)) end,
    case when rw.item_id is not null then
      coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = rw.item_id), 1) end,
    rw.item_id is not null and private.menu_item_effective_primary(rw.item_id) is not null,
    rw.group_count, rw.has_thumbnail, rw.has_preview, rw.width, rw.height, rw.created_at, rw.labelled_at,
    rw.captured_at, rw.captured_at_source, rw.duplicate_of_asset_id, rw.possible_duplicate,
    rw.staff_note, rw.section_kind,
    (select d.id from public.review_dispositions d where d.asset_id = rw.asset_id order by d.id desc limit 1),
    rw.is_self and v_self_allowed,
    case when rw.kind = 'unlabelled' then private.asset_unlabelled_reason(rw.asset_id) end,
    rw.media_type
  from qr rw
  where (p_after_created_at is null or p_after_key is null
    or (rw.created_at, rw.sort_key) > (p_after_created_at, p_after_key))
    and (not coalesce(p_possible_duplicate, false) or rw.possible_duplicate)
  order by rw.created_at, rw.sort_key
  limit v_limit;
end;
$$;

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

-- Body as in 20261116170000, with can_decide following K6.
create or replace function public.area_photo_queue(
  p_venue_id uuid default null,
  p_status text default 'pending',
  p_limit integer default 50
)
returns table (
  label_id uuid,
  asset_id uuid,
  venue_id uuid,
  author_id uuid,
  author_name text,
  subject_id uuid,
  subject_kind text,
  subject_label text,
  labelled_at timestamptz,
  uploaded_at timestamptz,
  credit_month date,
  state text,
  reason text,
  decided_at timestamptz,
  can_decide boolean,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer
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
  if v_status not in ('pending', 'accepted', 'needs_another_photo', 'withdrawn', 'all') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  perform private.assert_can_manage_venue(v_venue);

  return query
  select r.label_id, r.asset_id, r.venue_id, r.author_id, p.display_name,
    r.subject_id, r.subject_kind, r.subject_label, r.labelled_at, r.uploaded_at,
    private.london_month(r.uploaded_at), r.state, r.reason, r.decided_at,
    (r.author_id <> v_uid or private.review_self_allowed(v_venue)) and r.state <> 'withdrawn',
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height
  from private.area_photo_rows(v_venue, null) r
  join public.media_assets a on a.id = r.asset_id
  join public.profiles p on p.id = r.author_id
  where r.ready and r.deleted_at is null
    and (v_status = 'all' or r.state = v_status)
  order by
    case when v_status = 'pending' then r.labelled_at end asc,
    coalesce(r.decided_at, r.labelled_at) desc,
    r.label_id
  limit v_limit;
end;
$$;

-- Body as in 20261118100100, with can_decide following K6.
create or replace function public.amenity_photo_queue(
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
    (r.uploader_id <> v_uid or private.review_self_allowed(v_venue)) and r.state <> 'withdrawn',
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

revoke all on function
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer, text, integer, boolean, boolean, text)
from public, anon;
grant execute on function
  public.manager_menu_photo_queue(uuid, text, uuid, uuid, uuid, timestamptz, uuid, integer, text, integer, boolean, boolean, text)
to authenticated, service_role;
