-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-INT part 3 of 4: upload, album and manager scope read the
-- per-venue memberships (S1-PEOPLE, FA-22), and the last direct admin role
-- checks require the second factor (S1-PRIVACY, FA-23). Spec §3.1-§3.3,
-- §12.4; AC12, AC13, AC14, AC40.
--
--   Manager    private.effective_manager_venue_id(user): the person's active
--              venue when private.venue_role_of says manager there (an open
--              manager membership and an open grant, person and venue
--              active). A grant without a manager membership no longer
--              counts. Everything built on it follows: my_manager_venue_id,
--              can_manage_venue (export access, S1-EXPORT), the ops digest
--              recipients (private.ops_venue_managers, S1-OPS) and the RLS
--              policies. The rule is written out (not a call to
--              venue_role_of) so per-row RLS and per-venue loops stay cheap.
--              Multi-venue digest recipients (review R24) are S2-FIX's. A
--              person who manages A and is staff at B manages A
--              only while A is their active venue, and nothing at B (AC14).
--   Upload     private.media_upload_venue_allowed(uploader, role, venue):
--                staff    an active person with an open staff membership at
--                         the (active) venue (or, for a legacy staff account
--                         holding a grant, working there now)
--                manager  an active person who manages the venue
--                         (venue_role_of = manager)
--              Neither depends on the active venue, so switching to another
--              of one's venues does not end an upload in flight (review R10;
--              lib/server/media/finalise.ts's matching check is S2-FIX's).
--                admin    an active admin, any active venue; when the
--                         uploader is the caller, on an aal2 session
--              private.uploadable_venue_id also needs the open membership.
--              public.reserve_media_asset gains p_venue_id (default null): an
--              admin names the active venue it uploads to; staff and
--              managers may omit it or name their own venue (else
--              wrong_venue). The reservation records the role it was made
--              under; losing that role at the venue stops the upload at
--              storage and finalise (AC12).
--   Album      private.can_view_venue_album(venue): the venue's manager or an
--              admin (can_manage_venue), or staff whose active venue it is
--              with an open membership there. Reads of an inactive venue stay
--              possible, as before.
--   Admin MFA  private.can_read_asset_labels and public.coverage_access_scope
--              tested role = 'admin' directly; both now use
--              private.is_active_admin (aal2).
--
-- Rollback: re-apply private.effective_manager_venue_id (20261107100100),
-- private.media_upload_venue_allowed (20261118102000),
-- private.uploadable_venue_id (20261110090145), private.can_view_venue_album
-- (20261118107000), private.can_read_asset_labels and
-- public.coverage_access_scope (their latest definitions); drop the 8-argument
-- public.reserve_media_asset and re-create the 7-argument one
-- (20261118102000).

-- ---------------------------------------------------------------------------
-- Manager scope
-- ---------------------------------------------------------------------------

create or replace function private.effective_manager_venue_id(p_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
-- private.venue_role_of's manager rule, written out so it stays cheap in RLS
-- policies and per-row loops: the open grant first (indexed; most callers
-- have none), then the manager membership. plpgsql keeps the plan for the
-- session; a SQL function here would be planned again on every call.
declare
  v_venue uuid;
begin
  select g.venue_id into v_venue
  from public.venue_manager_grants g
  join public.profiles p
    on p.id = g.staff_id and p.active and p.role in ('staff', 'manager') and p.venue_id = g.venue_id
  join public.venues v on v.id = g.venue_id and v.active
  where g.staff_id = p_user and g.revoked_at is null
    and exists (
      select 1 from public.venue_memberships m
      where m.profile_id = g.staff_id and m.venue_id = g.venue_id and m.ended_at is null and m.role = 'manager')
  limit 1;
  return v_venue;
end;
$$;


-- ---------------------------------------------------------------------------
-- Upload scope
-- ---------------------------------------------------------------------------

create or replace function private.media_upload_venue_allowed(
  p_uploader uuid,
  p_uploader_role public.app_role,
  p_venue uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uploader is not null and p_venue is not null and exists (
    select 1
    from public.profiles p
    join public.venues v on v.id = p_venue and v.active
    where p.id = p_uploader and p.active
      and (
        (p_uploader_role = 'admin' and p.role = 'admin'
          and ((select auth.uid()) is distinct from p_uploader or private.is_active_admin()))
        -- Review R10: keyed on the membership at the upload's venue, not on
        -- the active venue, so switching to another of one's venues does
        -- not end an upload in flight; ending the membership does (AC12).
        or (p_uploader_role = 'manager'
          and private.venue_role_of(p.id, p_venue) = 'manager')
        -- A staff-era reservation: an open staff membership there, or (a
        -- legacy staff account holding a grant) a staff profile working
        -- there now with any open membership. A person since made a manager
        -- there cannot finish it (manager-denials).
        or (p_uploader_role is distinct from 'manager' and p_uploader_role is distinct from 'admin'
          and (
            exists (
              select 1 from public.venue_memberships m
              where m.profile_id = p.id and m.venue_id = p_venue and m.ended_at is null
                and m.role = 'staff')
            or (p.role = 'staff' and p.venue_id = p_venue and exists (
              select 1 from public.venue_memberships m
              where m.profile_id = p.id and m.venue_id = p_venue and m.ended_at is null))))
      )
  );
$$;

create or replace function private.uploadable_venue_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.venue_id
      from public.profiles p
      join public.venues v on v.id = p.venue_id and v.active
      where p.id = (select auth.uid()) and p.active and p.role = 'staff'
        and private.venue_role_of(p.id, p.venue_id) in ('staff', 'manager')
    ),
    private.manager_upload_venue_id((select auth.uid()))
  );
$$;

drop function public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text);

create function public.reserve_media_asset(
  p_media_type public.media_type,
  p_extension text,
  p_original_filename text,
  p_size_bytes bigint default null,
  p_client_upload_key text default null,
  p_purpose text default 'general',
  p_client_batch_id text default null,
  p_venue_id uuid default null
)
returns table (id uuid, original_path text, venue_id uuid, upload_state public.upload_state, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_manager boolean := private.is_active_manager();
  v_admin boolean := private.is_active_admin();
  v_scoped boolean;
  v_role public.app_role;
  v_venue uuid;
  v_id uuid := gen_random_uuid();
  v_ext text := lower(btrim(p_extension, '. '));
  v_path text;
  v_existing public.media_assets;
  v_open integer;
  c_max_open constant integer := 20;
begin
  if v_uid is null or not (private.is_active_staff() or v_manager or v_admin) then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;
  v_scoped := v_manager or v_admin;
  v_role := case when v_admin then 'admin' when v_manager then 'manager' else 'staff' end::public.app_role;

  if p_client_upload_key is null or p_client_upload_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_upload_key' using errcode = '22023';
  end if;

  if p_client_batch_id is not null and p_client_batch_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_batch_id' using errcode = '22023';
  end if;

  if p_purpose is null or p_purpose not in ('general', 'amenity') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;

  -- A manager account reuses only within its current scope, so its venue
  -- comes first.
  if v_admin then
    -- S2-INT (spec §3.3): an admin uploads to the active venue it names.
    if p_venue_id is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
      raise exception 'venue_unavailable' using errcode = 'P0001',
        detail = 'Uploads need an active venue.';
    end if;
    v_venue := p_venue_id;
  elsif v_manager then
    v_venue := private.manager_upload_venue_id(v_uid);
    if v_venue is null then
      raise exception 'venue_unavailable' using errcode = 'P0001',
        detail = 'Staff must be assigned to an active venue before uploading.';
    end if;
  end if;

  -- A retry returns the original reservation (its batch included); storage
  -- and finalise recheck the venue (private.media_upload_venue_allowed).
  select a.* into v_existing
  from public.media_assets a
  where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;

  if found then
    if v_scoped and (
      v_existing.uploader_role is distinct from v_role
      or v_existing.venue_id is distinct from v_venue
    ) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002',
        detail = 'This upload was removed.';
    end if;
    if v_existing.purpose <> p_purpose then
      raise exception 'reservation_purpose_mismatch' using errcode = '22023',
        detail = 'This upload key was reserved for another purpose.';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end if;

  if not v_scoped then
    v_venue := private.uploadable_venue_id();
    if v_venue is null then
      raise exception 'venue_unavailable' using errcode = 'P0001',
        detail = 'Staff must be assigned to an active venue before uploading.';
    end if;
  end if;
  -- Staff and managers upload to their active venue only; naming another
  -- one is refused rather than silently ignored.
  if not v_admin and p_venue_id is not null and p_venue_id is distinct from v_venue then
    raise exception 'wrong_venue' using errcode = '42501';
  end if;

  if p_media_type is null
     or (p_media_type = 'image' and v_ext not in ('jpg', 'png', 'webp', 'heic', 'heif'))
     or (p_media_type = 'video' and v_ext not in ('mp4', 'mov', 'webm')) then
    raise exception 'invalid_extension' using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0
     or p_size_bytes > private.media_upload_max_bytes(p_media_type) then
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
      client_upload_key, purpose, uploader_role, client_batch_id
    )
    values (
      v_id, v_uid, v_venue, v_path,
      left(coalesce(nullif(btrim(p_original_filename), ''), 'upload.' || v_ext), 255),
      p_media_type, p_size_bytes, p_client_upload_key, p_purpose,
      v_role,
      p_client_batch_id
    );
  exception when unique_violation then
    -- A concurrent call with the same key won the race: return its reservation,
    -- under the same manager scope rule as above.
    select a.* into v_existing
    from public.media_assets a
    where a.uploader_id = v_uid and a.client_upload_key = p_client_upload_key;
    if not found then
      raise;
    end if;
    if v_scoped and (
      v_existing.uploader_role is distinct from v_role
      or v_existing.venue_id is distinct from v_venue
    ) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    if v_existing.purpose <> p_purpose then
      raise exception 'reservation_purpose_mismatch' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.original_path, v_existing.venue_id,
      v_existing.upload_state, true;
    return;
  end;

  return query select v_id, v_path, v_venue, 'uploading'::public.upload_state, false;
end;
$$;

revoke all on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text, uuid) from public, anon;
grant execute on function public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Album
-- ---------------------------------------------------------------------------

create or replace function private.can_view_venue_album(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_venue_id is not null
    and (
      private.can_manage_venue(p_venue_id)
      or exists (
        select 1
        from public.profiles p
        join public.venue_memberships m
          on m.profile_id = p.id and m.venue_id = p.venue_id and m.ended_at is null
        where p.id = (select auth.uid()) and p.active and p.role = 'staff' and p.venue_id = p_venue_id
      )
    );
$$;

comment on function private.can_view_venue_album(uuid) is
  'Spec §3.3, FA-22: the caller may see this venue''s current album: its manager or an admin, or staff whose active venue it is with an open membership there.';

-- ---------------------------------------------------------------------------
-- Admin checks on the second factor (FA-23)
-- ---------------------------------------------------------------------------

create or replace function private.can_read_asset_labels(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_assets a
    join public.profiles p on p.id = (select auth.uid()) and p.active
    where a.id = p_asset_id
      and a.deleted_at is null
      and (
        (p.role = 'staff' and a.uploader_id = p.id)
        or (p.role = 'admin' and a.upload_state = 'ready' and (select private.is_active_admin()))
        or (p.role = 'manager' and a.uploader_id = p.id and a.uploader_role = 'manager')
      )
  );
$$;

create or replace function public.coverage_access_scope()
returns table (
  user_id uuid,
  role public.app_role,
  active boolean,
  venue_id uuid,
  venue_active boolean,
  department text,
  is_admin boolean,
  manager_venue_id uuid,
  manager_grant_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.role, p.active, p.venue_id, coalesce(v.active, false), p.department,
    p.active and p.role = 'admin' and (select private.is_active_admin()),
    m.venue_id,
    m.grant_id
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  left join lateral (
    select g.id as grant_id, g.venue_id
    from public.venue_manager_grants g
    where g.staff_id = p.id
      and g.revoked_at is null
      and g.venue_id = private.effective_manager_venue_id(p.id)
  ) m on true
  where p.id = (select auth.uid());
$$;

revoke all on function private.media_upload_venue_allowed(uuid, public.app_role, uuid) from public, anon, authenticated;
