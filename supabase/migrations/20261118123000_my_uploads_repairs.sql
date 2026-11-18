-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R4 repair of public.my_uploads (20261118111000, spec §6 S3,
-- S4; FA-7, FA-21). Body as there, plus:
--
--   V11  a dish photo whose accepted row was moved to needs_recheck is still
--        accepted (private.asset_is_accepted counts it): it reads as its
--        accepted level, never as awaiting_review, so Me offers Ask to remove
--        and not Withdraw or Change slot.
--   K4   a reviewer's Fix label (menu_item_photos basis 'reviewer' with
--        corrects_item_id, S2-REVIEW) reads as label_corrected on the new
--        dish, so "Label corrected" shows on Me.
--   E8   a retake is answered only by a newer own photo of the same slot sent
--        after the retake was asked (created after its decided_at), read
--        across all the caller's uploads, not just this page: each slot
--        carries retakeAnswered. replacesAssetId keeps its meaning, with the
--        same "sent after it was asked" rule.
--   E4   labelHelp: the caller asked "I'm not sure" about this photo and it
--        still has no label (private.label_help_open, S2-ADD), so Me says the
--        manager will choose its slot instead of pointing at Match later.
--   V14  p_slot_kind / p_slot_id: only the caller's photos of one dish or
--        place slot, so the slot page finds them (and the reviewer's exact
--        retake reason) however many newer photos were sent since.
--
-- The new parameters change the signature, so the 20261118111000 function is
-- dropped and created again with the same grants.
--
-- Rollback: drop function public.my_uploads(timestamptz, uuid, integer, uuid,
-- text, uuid) and re-apply the function from 20261118111000.

drop function public.my_uploads(timestamptz, uuid, integer, uuid);

-- Whether one of the caller's assets is matched to a dish or place slot: a
-- dish label or decision row for the item, or a live place label.
create function private.my_upload_in_slot(p_asset_id uuid, p_kind text, p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'dish' then exists (
        select 1 from public.media_label_items li
        where li.asset_id = p_asset_id and li.item_id = p_slot_id)
      or exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = p_asset_id and p.item_id = p_slot_id)
    when 'area' then exists (
        select 1 from public.media_area_labels l
        where l.asset_id = p_asset_id and l.subject_id = p_slot_id and l.removed_at is null)
    else false
  end;
$$;

revoke all on function private.my_upload_in_slot(uuid, text, uuid) from public, anon, authenticated, service_role;

-- E8: a retake asked on one of the person's photos is answered once they
-- send another photo of the same slot after it was asked (not deleted, not
-- failed). A photo sent earlier, even in the same batch, never answers it.
create function private.my_retake_answered(
  p_uid uuid,
  p_venue_id uuid,
  p_kind text,
  p_slot_id uuid,
  p_asset_id uuid,
  p_asked_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_asked_at is not null and case p_kind
    when 'dish' then exists (
      select 1 from public.media_label_items li
      join public.media_assets b on b.id = li.asset_id
      where li.item_id = p_slot_id and b.id <> p_asset_id and b.uploader_id = p_uid
        and b.deleted_at is null and b.upload_state <> 'failed' and b.created_at > p_asked_at)
    when 'area' then exists (
      select 1 from public.media_area_labels l
      join public.media_assets b on b.id = l.asset_id
      where l.subject_id = p_slot_id and l.removed_at is null and b.id <> p_asset_id
        and b.uploader_id = p_uid and b.deleted_at is null and b.upload_state <> 'failed'
        and b.created_at > p_asked_at)
    when 'amenity' then exists (
      select 1 from private.amenity_photo_rows(p_venue_id) r
      where r.check_id = p_slot_id and r.asset_id <> p_asset_id and r.uploader_id = p_uid
        and r.uploaded_at > p_asked_at)
    else false
  end;
$$;

revoke all on function private.my_retake_answered(uuid, uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create function public.my_uploads(
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30,
  p_asset_id uuid default null,
  p_slot_kind text default null,
  p_slot_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_items jsonb;
  v_next jsonb;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if (p_before is null) <> (p_before_id is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;
  if (p_slot_kind is null) <> (p_slot_id is null)
     or (p_slot_kind is not null and p_slot_kind not in ('dish', 'area')) then
    raise exception 'invalid_slot' using errcode = '22023';
  end if;

  with mine as (
    select a.id, a.venue_id, a.media_type::text as media_type, a.upload_state::text as upload_state,
      a.created_at, a.captured_at, a.captured_at_source, a.duplicate_of_asset_id
    from public.media_assets a
    where a.uploader_id = v_uid and a.deleted_at is null
      and (p_before is null or (a.created_at, a.id) < (p_before, p_before_id))
      and (p_asset_id is null or a.id = p_asset_id)
      and (p_slot_kind is null or private.my_upload_in_slot(a.id, p_slot_kind, p_slot_id))
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ),
  page as (
    select * from mine order by created_at desc, id desc limit v_limit
  ),
  venues as (
    select distinct venue_id from page
  ),
  uses as (
    -- Dish decisions: the live row of a tuple, else its latest final row.
    select p.asset_id, 'dish'::text as kind, p.item_id as slot_id,
      p.item_name || coalesce(' (' || p.variant_name || ')', '') as name,
      case
        -- K4: a reviewer matched it to this dish instead of the staff label.
        when p.state in ('accepted', 'needs_recheck') and p.basis = 'reviewer'
          and p.corrects_item_id is not null and p.decided_by is distinct from v_uid
          then 'label_corrected'
        -- V11: a recheck keeps the photo accepted at its level.
        when p.state in ('accepted', 'needs_recheck') then coalesce(p.review_level, 'public')
        when p.state = 'better_photo_requested' then 'retake_requested'
        else 'not_used'
      end as outcome,
      case when p.state in ('better_photo_requested', 'withdrawn') then p.reason end as reason,
      p.decided_at, p.created_at as since
    from public.menu_item_photos p
    join page m on m.id = p.asset_id
    where not exists (
      select 1 from public.menu_item_photos n
      where n.asset_id = p.asset_id and n.item_id = p.item_id
        and n.variant_id is not distinct from p.variant_id and n.created_at > p.created_at)
    union all
    -- Dish labels with no decision yet: waiting for review.
    select t.asset_id, 'dish', t.item_id,
      li.item_name || coalesce(' (' || li.variant_name || ')', ''),
      'awaiting_review', null::text, null::timestamptz, t.labelled_at
    from venues vv
    cross join lateral private.menu_photo_pending_tuples(vv.venue_id, false, true) t
    join page m on m.id = t.asset_id
    join public.media_label_items li on li.id = t.label_id
    where not t.is_recheck
    union all
    -- Place (area) photos.
    select r.asset_id, 'area', r.subject_id, r.subject_label,
      case r.state
        when 'pending' then 'awaiting_review'
        when 'accepted' then coalesce((
          select x.review_level from public.area_photo_decisions x
          where x.label_id = r.label_id order by x.id desc limit 1), 'public')
        when 'needs_another_photo' then 'retake_requested'
        when 'withdrawn' then 'not_used'
        else r.state
      end,
      case when r.state = 'needs_another_photo' then r.reason end,
      r.decided_at, r.labelled_at
    from venues vv
    cross join lateral private.area_photo_rows(vv.venue_id, v_uid) r
    join page m on m.id = r.asset_id
    union all
    -- Amenity photos.
    select r.asset_id, 'amenity', r.check_id, t.question,
      case r.state
        when 'pending' then 'awaiting_review'
        when 'accepted' then r.review_level
        when 'needs_another_photo' then 'retake_requested'
        when 'withdrawn' then 'not_used'
        else r.state
      end,
      case when r.state = 'needs_another_photo' then r.reason end,
      r.decided_at, r.uploaded_at
    from venues vv
    cross join lateral private.amenity_photo_rows(vv.venue_id) r
    join page m on m.id = r.asset_id
    join public.venue_amenity_checks c on c.id = r.check_id
    join public.amenity_catalogue t on t.key = c.template_key
    where r.uploader_id = v_uid
  ),
  earlier as (
    -- The caller's own photos of each slot that were asked to be retaken.
    select u.kind, u.slot_id, u.asset_id, m.created_at, u.decided_at
    from uses u join page m on m.id = u.asset_id
    where u.outcome = 'retake_requested'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'assetId', m.id,
      'venueId', m.venue_id,
      'venueName', v.name,
      'mediaType', m.media_type,
      'uploadState', m.upload_state,
      'uploadedAt', m.created_at,
      'capturedAt', m.captured_at,
      'capturedAtSource', m.captured_at_source,
      'duplicate', m.duplicate_of_asset_id is not null,
      'labelRevision', coalesce(ml.revision, 0),
      'sharedKinds', coalesce(to_jsonb(ml.content_types), '[]'::jsonb),
      'slots', coalesce((
        select jsonb_agg(jsonb_build_object(
            'kind', u.kind, 'slotId', u.slot_id, 'name', u.name,
            'outcome', u.outcome, 'reason', u.reason, 'decidedAt', u.decided_at,
            'replacesAssetId', (
              select e.asset_id from earlier e
              where e.kind = u.kind and e.slot_id = u.slot_id
                and e.asset_id <> u.asset_id and e.created_at < m.created_at
                -- E8: only a photo sent after the retake was asked answers it.
                and e.decided_at < m.created_at
              order by e.created_at desc limit 1),
            'retakeAnswered', u.outcome = 'retake_requested'
              and private.my_retake_answered(v_uid, m.venue_id, u.kind, u.slot_id, u.asset_id, u.decided_at))
          order by u.since, u.kind, u.slot_id)
        from uses u where u.asset_id = m.id), '[]'::jsonb),
      'labelHelp', private.label_help_open(m.id),
      'removalRequested', exists (
        select 1 from public.media_removal_requests rr
        where rr.asset_id = m.id and rr.requested_by = v_uid and rr.state = 'open'),
      'removalRequestId', (
        select rr.id from public.media_removal_requests rr
        where rr.asset_id = m.id and rr.requested_by = v_uid and rr.state = 'open'
        order by rr.created_at desc limit 1)
    ) order by m.created_at desc, m.id desc), '[]'::jsonb)
  into v_items
  from page m
  join public.venues v on v.id = m.venue_id
  left join public.media_labels ml on ml.asset_id = m.id;

  -- The cursor: the last row of this page, when another row follows it.
  select case when count(*) > v_limit then jsonb_build_object(
      'before', (array_agg(y.created_at order by y.created_at desc, y.id desc))[v_limit],
      'beforeId', (array_agg(y.id order by y.created_at desc, y.id desc))[v_limit])
    end
  into v_next
  from (
    select a.id, a.created_at
    from public.media_assets a
    where a.uploader_id = v_uid and a.deleted_at is null
      and (p_before is null or (a.created_at, a.id) < (p_before, p_before_id))
      and (p_asset_id is null or a.id = p_asset_id)
      and (p_slot_kind is null or private.my_upload_in_slot(a.id, p_slot_kind, p_slot_id))
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ) y;

  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;

comment on function public.my_uploads(timestamptz, uuid, integer, uuid, text, uuid) is
  'S2-STAFF, spec §6 S4 (S3-R4 repair): the caller''s own uploads (any venue, or one dish or place slot) with venue, dates, slots, review outcomes and whether each retake was answered; never a colleague''s.';

revoke all on function public.my_uploads(timestamptz, uuid, integer, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.my_uploads(timestamptz, uuid, integer, uuid, text, uuid) to authenticated;
