-- Amenity evidence stays out of the organisation community (review finding M1).
-- Photos taken for an amenity check (the capture form's uploads) were ordinary
-- media rows, so every active colleague could see them through the community
-- reads: community_readable_assets (and /api/media/[id]/* behind it),
-- community_media_page and the community_members media count. Guest Wi-Fi
-- photos, for example, reached staff at every venue.
--
-- * media_assets.purpose: 'general' (the portfolio, default) or 'amenity',
--   chosen at reservation and fixed afterwards.
-- * reserve_media_asset takes p_purpose (default 'general'); every earlier
--   check, the grants and the result are unchanged.
-- * The community reads skip amenity-purpose assets, and a general upload
--   attached to an amenity submission unless it is also Coverage media (a
--   Coverage submission item or venue amenity fact photo): legacy Coverage
--   photos chosen as evidence stay exactly as visible as before, so Coverage
--   review and configuration screens still find them. The uploader and admins
--   keep their access, and the amenity routes read through
--   amenity_evidence_asset, which is unchanged.

alter table public.media_assets
  add column purpose text not null default 'general'
    constraint media_assets_purpose_check check (purpose in ('general', 'amenity'));

comment on column public.media_assets.purpose is
  'Why the file was uploaded, fixed at reservation: general (portfolio, community-visible) or amenity (amenity evidence, never in community reads).';

create function private.media_assets_purpose_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purpose is distinct from old.purpose then
    raise exception 'media_asset_reservation_immutable' using errcode = '42501',
      detail = 'Purpose is fixed at reservation.';
  end if;
  return new;
end;
$$;

create trigger media_assets_purpose_guard
  before update of purpose on public.media_assets
  for each row execute function private.media_assets_purpose_guard();

-- ---------------------------------------------------------------------------
-- reserve_media_asset: + p_purpose
-- ---------------------------------------------------------------------------
-- Same checks and result as 20261030100000_security_hardening.sql. A retry of
-- an existing key returns the original reservation with its original purpose,
-- as it does with the venue snapshot. Callers that omit p_purpose (named
-- arguments) reserve a general upload as before.

drop function public.reserve_media_asset(public.media_type, text, text, bigint, text);

create function public.reserve_media_asset(
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint default null,
  p_client_upload_key text default null,
  p_purpose text default 'general'
)
returns table (
  id uuid,
  original_path text,
  venue_id uuid,
  upload_state public.upload_state,
  reused boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_id uuid := gen_random_uuid();
  v_ext text := lower(btrim(p_extension, '. '));
  v_path text;
  v_existing public.media_assets;
  v_open integer;
  v_max_bytes bigint;
  c_max_open constant integer := 20;
  c_max_image_bytes constant bigint := 20 * 1024 * 1024;
  c_max_video_bytes constant bigint := 200 * 1024 * 1024;
begin
  if v_uid is null or not private.is_active_staff() then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;

  if p_client_upload_key is null or p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;

  if p_purpose is null or p_purpose not in ('general', 'amenity') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;

  -- A retry returns the original reservation, whatever the caller's venue is now:
  -- the venue snapshot belongs to the first reservation.
  select a.* into v_existing
  from public.media_assets a
  where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;

  if found then
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002',
        detail = 'This upload was removed.';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end if;

  v_venue := private.uploadable_venue_id();
  if v_venue is null then
    raise exception 'venue_unavailable' using errcode = 'P0001',
      detail = 'Staff must be assigned to an active venue before uploading.';
  end if;

  if p_media_type is null
     or (p_media_type = 'image' and v_ext not in ('jpg', 'png', 'webp', 'heic', 'heif'))
     or (p_media_type = 'video' and v_ext not in ('mp4', 'mov', 'webm')) then
    raise exception 'invalid_extension' using errcode = '22023';
  end if;

  -- (No CASE expression here: the Supabase CLI's statement splitter misreads it.)
  if p_media_type = 'image' then
    v_max_bytes := c_max_image_bytes;
  else
    v_max_bytes := c_max_video_bytes;
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_max_bytes then
    raise exception 'invalid_size' using errcode = '22023';
  end if;

  -- Serialise this uploader's new reservations so concurrent calls cannot all
  -- pass the count below.
  perform pg_advisory_xact_lock(hashtextextended('nabalens_reserve:' || v_uid::text, 0));
  select count(*) into v_open
  from public.media_assets a
  where a.uploader_id = v_uid
    and a.deleted_at is null
    and a.upload_state <> 'ready';
  if v_open >= c_max_open then
    raise exception 'too_many_open_uploads' using errcode = 'P0001',
      detail = 'Finish, retry or delete earlier uploads before starting more.';
  end if;

  v_path := v_uid::text || '/' || v_id::text || '/original.' || v_ext;

  begin
    insert into public.media_assets as a (
      id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes,
      client_upload_key, purpose
    )
    values (
      v_id, v_uid, v_venue, v_path,
      left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
      p_media_type, p_size_bytes, p_client_upload_key, p_purpose
    );
  exception when unique_violation then
    -- A concurrent call with the same key won the race: return its reservation.
    select a.* into v_existing
    from public.media_assets a
    where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;
    if not found then
      raise;
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end;

  return query select v_id, v_path, v_venue, 'uploading'::public.upload_state, false;
end;
$$;

revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Community reads
-- ---------------------------------------------------------------------------

-- Same as 20261102160000, but a colleague no longer reads amenity evidence:
-- amenity-purpose uploads, and general uploads attached to an amenity
-- submission that are not also Coverage media. Coverage media reads as before
-- (manager Coverage review and configuration screens check photos through this
-- function). The uploader and active admins still read everything.
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
    and (select private.is_active_user())
    and (
      a.uploader_id = (select auth.uid())
      or (select private.is_active_admin())
      or (
        private.is_community_member(a.uploader_id)
        and a.purpose = 'general'
        and (
          not exists (
            select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
          )
          or exists (
            select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
          )
          or exists (
            select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
          )
        )
      )
    )
  order by a.id;
end;
$$;

-- Same as 20261102160000, without amenity evidence (the rule above, for every
-- viewer: the uploader finds theirs in their own portfolio).
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
  where (select private.is_active_user())
    and a.upload_state = 'ready' and a.deleted_at is null
    and a.purpose = 'general'
    and (
      not exists (
        select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
      )
      or exists (
        select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
      )
      or exists (
        select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
      )
    )
    and (p_venue is null or a.venue_id = p_venue)
    and (p_uploader is null or a.uploader_id = p_uploader)
    and (p_type is null or a.media_type = p_type)
    and (p_department is null or p.department = p_department)
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101);
$$;

-- Same as 20261102120000; media_count counts only community-visible media, so
-- it matches the member's community page.
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
        and a.purpose = 'general'
        and (
          not exists (
            select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id
          )
          or exists (
            select 1 from public.coverage_submission_items ci where ci.asset_id = a.id
          )
          or exists (
            select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id
          )
        ))
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  where (select private.is_active_user())
    and p.active and p.role = 'staff'
    and (p_venue is null or p.venue_id = p_venue)
    and (p_member is null or p.id = p_member)
    and (p_department is null or p.department = p_department)
    and (p_query is null or strpos(lower(p.display_name), lower(left(p_query, 80))) > 0)
  order by p.display_name, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 101)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;
