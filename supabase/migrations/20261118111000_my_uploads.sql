-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-STAFF (spec §6 S4; FA-1, FA-7, FA-21; AC09, AC16, AC17,
-- AC34): My uploads on Me. One read of the caller's own uploads, newest
-- first, each with
--
--   venue        the asset's own (upload-time) venue and its name, so a
--                person who works at two pubs sees where each photo went
--   dates        uploaded, and captured with its source (S1-UPLOAD)
--   slots        every slot the photo was matched to (dish, area, amenity)
--                with its review outcome in the spec's terms:
--                  awaiting_review   waiting for a manager
--                  public            approved for public use (In the album)
--                  reference         kept as reference
--                  retake_requested  another photo requested, with reason
--                  not_used          a manager set it aside, or withdrew an
--                                    acceptance (menu withdrawn/invalidated)
--                  withdrawn         the uploader withdrew it
--   replaces     a derived link to the caller's own earlier photo of the
--                same slot that was asked to be retaken: the new upload
--                links to the earlier attempt and both keep their history
--                (spec §6 S4). Nothing is stored; the read derives it.
--   requests     whether an open removal request (FA-21) or an open
--                correction request (20261118111100) exists
--   p_asset_id   reads one own upload (a Change slot re-checks it is still
--                waiting before it saves)
--   revision     the photo's label revision, for a version-checked Change
--                slot (save_media_labels' expected revision)
--
-- Only the caller's own assets are read (uploader_id = auth.uid()), at any
-- venue: nothing about a colleague is ever returned. The per-kind rows come
-- from the same private helpers the manager's asset_usages reads
-- (20261118100200_coverage_slots.sql), so staff and managers see one rule.
--
-- Rollback: drop function public.my_uploads(timestamptz, uuid, integer, uuid).

create function public.my_uploads(
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30,
  p_asset_id uuid default null
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

  with mine as (
    select a.id, a.venue_id, a.media_type::text as media_type, a.upload_state::text as upload_state,
      a.created_at, a.captured_at, a.captured_at_source, a.duplicate_of_asset_id
    from public.media_assets a
    where a.uploader_id = v_uid and a.deleted_at is null
      and (p_before is null or (a.created_at, a.id) < (p_before, p_before_id))
      and (p_asset_id is null or a.id = p_asset_id)
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
      case p.state
        when 'accepted' then coalesce(p.review_level, 'public')
        when 'better_photo_requested' then 'retake_requested'
        when 'needs_recheck' then 'awaiting_review'
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
    select u.kind, u.slot_id, u.asset_id, m.created_at
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
              order by e.created_at desc limit 1))
          order by u.since, u.kind, u.slot_id)
        from uses u where u.asset_id = m.id), '[]'::jsonb),
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
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ) y;

  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;

comment on function public.my_uploads(timestamptz, uuid, integer, uuid) is
  'S2-STAFF, spec §6 S4: the caller''s own uploads (any venue) with venue, dates, slots and review outcomes; never a colleague''s.';

revoke all on function public.my_uploads(timestamptz, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.my_uploads(timestamptz, uuid, integer, uuid) to authenticated;
