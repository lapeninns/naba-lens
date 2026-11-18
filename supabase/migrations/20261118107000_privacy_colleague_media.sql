-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-PRIVACY (spec §3.3, §16; decision FA-20): staff see a
-- colleague's photo only once it has been accepted, and only at a venue
-- whose album they can see. Unreviewed media stays with its uploader, the
-- venue's manager and admins. This reverses Goals v0.5's "review never gates
-- visibility" for staff; managers still see everything at their venue.
--
--   Accepted   private.asset_is_accepted(asset): a person with authority
--              has accepted the asset somewhere. Any of
--                menu       a menu_item_photos row in accepted or
--                           needs_recheck (accepted, flagged after a menu
--                           change)
--                area       a live media_area_labels row whose latest
--                           area_photo_decisions action is accepted
--                coverage   a coverage_submission_items row in accepted
--                amenity    evidence of an amenity submission or knowledge
--                           contribution that a venue manager or admin
--                           confirmed or reaffirmed, or a legacy
--                           venue_amenity_fact_media row (added by a
--                           manager)
--              A reference decision (S1-COV, FA-31) is still an accepted
--              decision, so it counts.
--   Album      private.can_view_venue_album(venue): the caller is active
--              staff at the venue or can manage it (manager account or
--              grant, or an admin). The one place to switch to per-venue
--              memberships (FA-22, S1-PEOPLE).
--   Visible    private.media_visible_to_caller(asset): own, a manager of the
--              asset's venue (or an admin), or accepted at a venue whose
--              album the caller can see.
--
-- Applied to every colleague read:
--   community_readable_assets   gate of /api/media/[id]/* for colleagues and
--                               of the coverage and menu screens' photos
--   community_media_page        the staff Photos feed and people pages
--   community_members           media_count counts what the caller can see
--   album_slot_photos           Album tiles: a colleague's waiting area
--   album_slot_asset            photo, or an unconfirmed amenity photo, is
--                               no longer drawn for other staff; the slot
--                               keeps its Waiting state from
--                               album_area_states, with no photo
--
-- The bodies are those of 20261107130000_amenity_media_purpose.sql and
-- 20261117150000_album_slot_photos.sql plus the visibility rule; nothing
-- else changes. Nothing here changes review, coverage, credit or label rules.
--
-- Rollback: re-apply the bodies of those two migrations (create or replace),
-- then drop the three private functions.

-- ---------------------------------------------------------------------------
-- Predicates
-- ---------------------------------------------------------------------------

create function private.asset_is_accepted(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.menu_item_photos m
      where m.asset_id = p_asset_id and m.state in ('accepted', 'needs_recheck')
    )
    or exists (
      select 1 from public.coverage_submission_items ci
      where ci.asset_id = p_asset_id and ci.state = 'accepted'
    )
    or exists (
      select 1 from public.media_area_labels l
      where l.asset_id = p_asset_id
        and l.removed_at is null
        and (select d.action from public.area_photo_decisions d
              where d.label_id = l.id order by d.id desc limit 1) = 'accepted'
    )
    or exists (
      select 1 from public.venue_amenity_fact_media fm where fm.asset_id = p_asset_id
    )
    or exists (
      select 1
      from public.amenity_submission_assets sa
      join public.knowledge_decisions d on d.submission_id = sa.submission_id
      where sa.asset_id = p_asset_id
        and d.decision in ('confirmed', 'reaffirmed')
        and d.decider_basis in ('venue_manager', 'admin')
    )
    or exists (
      select 1
      from public.knowledge_contribution_assets ka
      join public.knowledge_decisions d on d.contribution_id = ka.contribution_id
      where ka.asset_id = p_asset_id
        and d.decision in ('confirmed', 'reaffirmed')
        and d.decider_basis in ('venue_manager', 'admin')
    );
$$;

comment on function private.asset_is_accepted(uuid) is
  'FA-20/FA-21: true when a manager or admin has accepted the asset in any review (menu, area, coverage, amenity evidence).';

create function private.can_view_venue_album(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_venue_id is not null
    and (
      coalesce(private.active_staff_venue_id() = p_venue_id, false)
      or private.can_manage_venue(p_venue_id)
    );
$$;

comment on function private.can_view_venue_album(uuid) is
  'Spec §3.3: the caller may see this venue''s current album (staff at the venue, its manager, or an admin). Switch to venue memberships here (FA-22).';

create function private.media_visible_to_caller(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.media_assets a
    where a.id = p_asset_id
      and (select private.is_active_user())
      and (
        a.uploader_id = (select auth.uid())
        or private.can_manage_venue(a.venue_id)
        or (private.can_view_venue_album(a.venue_id) and private.asset_is_accepted(a.id))
      )
  );
$$;

comment on function private.media_visible_to_caller(uuid) is
  'Spec §3.3 row 3, FA-20: own media, any media at a venue the caller manages (or as admin), otherwise only accepted media at a venue whose album the caller can see.';

revoke all on function private.asset_is_accepted(uuid) from public, anon;
revoke all on function private.can_view_venue_album(uuid) from public, anon;
revoke all on function private.media_visible_to_caller(uuid) from public, anon;
grant execute on function private.asset_is_accepted(uuid) to authenticated, service_role;
grant execute on function private.can_view_venue_album(uuid) to authenticated, service_role;
grant execute on function private.media_visible_to_caller(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Community reads
-- ---------------------------------------------------------------------------

-- Body as in 20261107130000_amenity_media_purpose.sql; a colleague's asset
-- must also be visible to the caller (accepted at a venue whose album they
-- see, or at a venue they manage: the transitional staff-held manager's
-- Coverage review reads its venue's waiting photos through this function).
create or replace function public.community_readable_assets(p_asset_ids uuid[])
returns table (
  id uuid, uploader_id uuid, venue_id uuid, media_type public.media_type,
  validated_mime_type text, size_bytes bigint, width integer, height integer,
  duration_seconds numeric, has_preview boolean, has_thumbnail boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_ids' using errcode = '22023',
      detail = 'Between 0 and 100 asset ids.';
  end if;
  return query
  select a.id, a.uploader_id, a.venue_id, a.media_type, a.validated_mime_type,
    a.size_bytes, a.width, a.height, a.duration_seconds,
    a.preview_path is not null, a.thumbnail_path is not null, a.created_at
  from public.media_assets a
  where a.id = any(p_asset_ids)
    and a.upload_state = 'ready' and a.deleted_at is null
    and (select private.is_active_staff() or private.is_active_admin())
    and (
      a.uploader_id = (select auth.uid())
      or (select private.is_active_admin())
      or (
        private.is_community_member(a.uploader_id)
        and (
          (
            a.purpose = 'general'
            and not exists (
              select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
            )
          )
          or exists (
            select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
          )
          or exists (
            select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
          )
        )
        and private.media_visible_to_caller(a.id)
      )
    )
  order by a.id;
end;
$$;

-- Body as in 20261107130000_amenity_media_purpose.sql, limited to media the
-- caller can see (FA-20). Own photos stay in the caller's own view.
create or replace function public.community_media_page(
  p_venue uuid default null,
  p_uploader uuid default null,
  p_type public.media_type default null,
  p_department text default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  id uuid, uploader_id uuid, contributor_name text, venue_name text,
  media_type public.media_type, has_thumbnail boolean, has_preview boolean,
  validated_mime_type text, original_filename text, created_at timestamptz,
  width integer, height integer, duration_seconds numeric, size_bytes bigint
)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.uploader_id, p.display_name, v.name, a.media_type,
    a.thumbnail_path is not null, a.preview_path is not null,
    a.validated_mime_type,
    case when a.uploader_id = (select auth.uid()) then a.original_filename end,
    a.created_at, a.width, a.height, a.duration_seconds, a.size_bytes
  from public.media_assets a
  join public.profiles p on p.id = a.uploader_id and p.active and p.role = 'staff'
  join public.venues v on v.id = a.venue_id
  where (select private.is_active_staff() or private.is_active_admin())
    and a.upload_state = 'ready' and a.deleted_at is null
    and (
      (
        a.purpose = 'general'
        and not exists (
          select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
        )
      )
      or exists (
        select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
      )
      or exists (
        select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
      )
    )
    and private.media_visible_to_caller(a.id)
    and (p_venue is null or a.venue_id = p_venue)
    and (p_uploader is null or a.uploader_id = p_uploader)
    and (p_type is null or a.media_type = p_type)
    and (p_department is null or p.department = p_department)
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101);
$$;

-- Body as in 20261107130000_amenity_media_purpose.sql; media_count counts
-- only what the caller can see, so it matches the member's page.
create or replace function public.community_members(
  p_venue uuid default null,
  p_member uuid default null,
  p_department text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, display_name text, job_title text, department text,
  venue_id uuid, venue_name text, avatar_path text, media_count bigint
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.job_title, p.department,
    p.venue_id, v.name, p.avatar_path,
    (select count(*) from public.media_assets a
      where a.uploader_id = p.id and a.upload_state = 'ready' and a.deleted_at is null
        and (
          (
            a.purpose = 'general'
            and not exists (
              select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
            )
          )
          or exists (
            select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
          )
          or exists (
            select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
          )
        )
        and private.media_visible_to_caller(a.id))
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  where (select private.is_active_staff() or private.is_active_admin())
    and p.active and p.role = 'staff'
    and (p_venue is null or p.venue_id = p_venue)
    and (p_member is null or p.id = p_member)
    and (p_department is null or p.department = p_department)
    and (p_query is null or strpos(lower(p.display_name), lower(left(p_query, 80))) > 0)
  order by p.display_name, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 101)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;

-- ---------------------------------------------------------------------------
-- Album tiles
-- ---------------------------------------------------------------------------

-- Body as in 20261117150000_album_slot_photos.sql: only photos the caller
-- can see. A slot whose current photo is a colleague's waiting one is drawn
-- without a photo; its state (Waiting) still comes from album_area_states.
create or replace function public.album_slot_photos(p_venue_id uuid default null)
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
    where private.media_visible_to_caller(r.asset_id)
  ), '[]'::jsonb));
end;
$$;

-- Body as in 20261117150000_album_slot_photos.sql, plus the same rule.
create or replace function public.album_slot_asset(p_asset_id uuid)
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
    and private.media_visible_to_caller(a.id)
    and exists (
      select 1 from private.album_slot_photo_rows(a.venue_id) r
      where r.asset_id = a.id
    );
$$;
