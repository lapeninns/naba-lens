-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Album AL-7 (docs/plans/album-a3-a5.md, batch A5; DESIGN.md §4, §5a,
-- §6.2): staff at a venue see the current photo of its filled slots. Review
-- never gates visibility (product rule), so a waiting area photo shows as
-- well as an accepted one. Until now only an area photo's uploader and the
-- venue's manager could open it (area_photo_asset), and an amenity's
-- evidence only its sender and the manager (amenity_evidence_asset), so
-- Album drew those filled slots with no photo.
--
--   Rows    private.album_slot_photo_rows(venue): the one photo shown on each
--           slot that has one.
--             area     the asset album_area_states shows for the place, when
--                      that place's state is accepted or waiting (a retake
--                      or withdrawn photo is not shown)
--             amenity  an accepted amenity slot (active, in scope, complete,
--                      answered neither No nor Not applicable): the newest
--                      photo evidence on the answer in use
--           Ready, undeleted still images only.
--   Read    public.album_slot_photos(venue): those rows for the caller's
--           venue (staff and managers at the venue; an admin names it).
--   Gate    public.album_slot_asset(asset): the caller-scoped check run
--           before a storage key is read, in the shape of area_photo_asset.
--           The asset must be one of the rows above at a venue the caller
--           is active staff at, manages, or an admin. Unknown, deleted and
--           forbidden all return no row (the route answers 404).
--
-- Nothing here changes coverage, amenity, area, credit or review rules, or
-- who may open an original: thumbnails and previews only, through the
-- existing signed-URL path (60 s).
--
-- Rollback: revoke execute on the two public functions below.

-- ---------------------------------------------------------------------------
-- The photo on each slot
-- ---------------------------------------------------------------------------

create function private.album_slot_photo_rows(p_venue_id uuid)
returns table (kind text, slot_id uuid, asset_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- Areas: the same winner as album_area_states (accepted, then waiting,
  -- then retake; newest first), shown only when it is accepted or waiting.
  with live as (
    select l.subject_id, l.asset_id, l.added_at,
      (select d.action from public.area_photo_decisions d
        where d.label_id = l.id order by d.id desc limit 1) as action
    from public.media_area_labels l
    join public.media_assets a on a.id = l.asset_id
    join public.knowledge_subjects s on s.id = l.subject_id and s.venue_id = l.venue_id
    where l.venue_id = p_venue_id
      and l.removed_at is null
      and s.retired_at is null
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.media_type = 'image'
  ),
  ranked as (
    select live.subject_id, live.asset_id, live.action,
      row_number() over (
        partition by live.subject_id
        order by case
            when live.action = 'accepted' then 1
            when live.action is null then 2
            when live.action = 'needs_another_photo' then 3
            else 4 end,
          live.added_at desc
      ) as rn
    from live
    where live.action is distinct from 'withdrawn'
  ),
  amenity as (
    select distinct on (c.id) c.id as check_id, a.id as asset_id
    from public.venue_amenity_checks c
    join public.amenity_submissions sub on sub.id = c.current_submission_id
    join public.amenity_submission_assets sa on sa.submission_id = sub.id
    join public.media_assets a on a.id = sa.asset_id and a.venue_id = sa.venue_id
    where c.venue_id = p_venue_id
      and c.status = 'active'
      and c.progress = 'complete'
      and sub.answer is distinct from 'no'
      and sub.answer is distinct from 'not_applicable'
      and private.knowledge_in_scope(c.venue_id, c.template_key)
      and sa.evidence_kind = 'photo'
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.media_type = 'image'
    order by c.id, a.created_at desc, a.id desc
  )
  select 'area'::text, r.subject_id, r.asset_id
  from ranked r
  where r.rn = 1 and (r.action = 'accepted' or r.action is null)
  union all
  select 'amenity'::text, am.check_id, am.asset_id
  from amenity am;
$$;

revoke all on function private.album_slot_photo_rows(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read: the slot photos at the caller's venue
-- ---------------------------------------------------------------------------

create function public.album_slot_photos(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
begin
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(
      jsonb_build_object('kind', r.kind, 'slotId', r.slot_id, 'assetId', r.asset_id)
      order by r.kind, r.slot_id)
    from private.album_slot_photo_rows(v_venue) r
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Gate: one slot photo, before signing
-- ---------------------------------------------------------------------------

create function public.album_slot_asset(p_asset_id uuid)
returns table (
  asset_id uuid,
  venue_id uuid,
  media_type public.media_type,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.venue_id, a.media_type,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and a.media_type = 'image'
    and private.is_active_user()
    and (
      private.active_staff_venue_id() = a.venue_id
      or private.can_manage_venue(a.venue_id)
      or private.is_active_admin()
    )
    and exists (
      select 1 from private.album_slot_photo_rows(a.venue_id) r
      where r.asset_id = a.id
    );
$$;

revoke all on function public.album_slot_photos(uuid) from public, anon, service_role;
revoke all on function public.album_slot_asset(uuid) from public, anon, service_role;
grant execute on function public.album_slot_photos(uuid) to authenticated;
grant execute on function public.album_slot_asset(uuid) to authenticated;
