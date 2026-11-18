-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R8 (K1 gap): label_help_queue lists the photos whose
-- uploader the caller may review, as the Review queue's Needs label branch
-- (public.manager_menu_photo_queue, 20261118120400) and Overview's count
-- (private.venue_unlabelled_photos, 20261118120300) already do. Before this
-- it also listed the manager's own photos (outside a single-reviewer venue)
-- and photos of people who have left, so its total differed from both.
--
-- Body as in 20261118120300, plus private.menu_photo_reviewable_uploader in
-- the set. Signature, grants and errors unchanged.
--
-- Rollback: re-apply public.label_help_queue from 20261118120300.

create or replace function public.label_help_queue(
  p_venue_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid := p_venue_id;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_admin boolean;
  v_result jsonb;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  v_admin := private.is_active_admin();
  if v_venue is null and not v_admin then
    select p.venue_id into v_venue from public.profiles p where p.id = v_uid;
  end if;
  if v_venue is null then
    raise exception 'venue_required' using errcode = '22023';
  end if;
  if not (v_admin or coalesce(private.venue_role_of(v_uid, v_venue) = 'manager', false)) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  with q as (
    select a.id, a.uploader_id, a.media_type, a.created_at, a.captured_at,
      a.thumbnail_path is not null as has_thumbnail,
      r.requested_at,
      private.asset_unlabelled_reason(a.id) as reason,
      coalesce(r.requested_at, a.created_at) as since
    from public.media_assets a
    left join public.media_label_help_requests r on r.asset_id = a.id
    where a.venue_id = v_venue
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.purpose = 'general'
      and private.asset_unlabelled(a.id)
      -- Whose photos the caller may decide on: the Review queue's rule.
      and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
  )
  select jsonb_build_object(
    'venueId', v_venue,
    'unmatchedDays', private.label_help_unmatched_days(),
    'total', (select count(*) from q),
    'notSure', (select count(*) from q where q.reason = 'not_sure'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'assetId', s.id,
          'reason', s.reason,
          'note', l.note,
          'uploaderId', s.uploader_id,
          'uploaderName', up.display_name,
          'mediaType', s.media_type,
          'createdAt', s.created_at,
          'capturedAt', s.captured_at,
          'requestedAt', s.requested_at,
          'hasThumbnail', s.has_thumbnail
        ) order by s.since, s.id)
      from (select * from q order by q.since, q.id limit v_limit) s
      join public.profiles up on up.id = s.uploader_id
      left join public.media_labels l on l.asset_id = s.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
