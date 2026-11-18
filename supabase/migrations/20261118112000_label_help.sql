-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-ADD (spec §5.3, §6 S2, §7 M2; decisions FA-3, FA-4):
-- "I'm not sure". A person adding photos can say they do not know which
-- slot a photo fills. The photo goes to the venue's managers as Needs label,
-- never creates a catalogue item and never completes a requirement.
--
--   Ask      public.request_label_help(asset): the uploader of a live,
--            general-purpose asset at a venue they may still add photos to
--            (private.media_upload_venue_allowed, the same rule as finalise).
--            Works from reservation on, so Match can ask as soon as the
--            photo is reserved. Asking again returns the first request.
--   Mine     public.my_label_help(asset ids): which of the caller's own
--            assets they asked about and still need a label (so Match later
--            does not ask them again).
--   Queue    public.label_help_queue(venue, limit): the venue's Needs label
--            list for its managers and admins (admins name the venue),
--            oldest first: every "I'm not sure" photo still without a label,
--            and every ready photo left unmatched for 7 days or more (FA-4).
--
-- A request is open while the photo still needs a label
-- (private.asset_needs_labels): a manager's label, or the person matching it
-- later, closes it with no extra write. Requests are never edited (a trigger
-- refuses updates); they go with the asset when an abandoned reservation is
-- cleaned up. The optional short note travels as the photo's label note
-- (media_labels.note), as on every other route, and the queue shows it.
--
-- Rollback: drop the three public functions, private.label_help_open and the
-- table. Nothing else changes.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.media_label_help_requests (
  asset_id uuid primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),
  constraint media_label_help_requests_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete cascade
);

create index media_label_help_requests_venue_idx
  on public.media_label_help_requests (venue_id, requested_at);

comment on table public.media_label_help_requests is
  'FA-4: "I''m not sure" — the uploader asked a manager to label this photo. Open while the asset still needs a label.';

create function private.label_help_no_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'label_help_requests_are_kept' using errcode = '55000';
end;
$$;

revoke all on function private.label_help_no_update() from public, anon, authenticated, service_role;

create trigger media_label_help_requests_no_update
  before update on public.media_label_help_requests
  for each row execute function private.label_help_no_update();

alter table public.media_label_help_requests enable row level security;
revoke all on table public.media_label_help_requests from public, anon, authenticated, service_role;
grant select on table public.media_label_help_requests to service_role;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- Days a photo may wait unmatched before managers see it as Needs label.
create function private.label_help_unmatched_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 7 $$;

revoke all on function private.label_help_unmatched_days() from public, anon, authenticated, service_role;

-- True while the asset has a help request and still needs a label.
create function private.label_help_open(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.media_label_help_requests r
    where r.asset_id = p_asset_id
  ) and private.asset_needs_labels(p_asset_id);
$$;

revoke all on function private.label_help_open(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ask
-- ---------------------------------------------------------------------------

create function public.request_label_help(p_asset_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_asset record;
  v_at timestamptz;
  v_created boolean := false;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  select a.id, a.venue_id, a.uploader_id, a.uploader_role, a.purpose, a.deleted_at, a.upload_state
    into v_asset
  from public.media_assets a
  where a.id = p_asset_id
  for share;

  -- Someone else's asset reads as missing: nobody learns it exists.
  if v_asset.id is null or v_asset.uploader_id is distinct from v_uid
     or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  if v_asset.purpose <> 'general' or v_asset.upload_state = 'failed' then
    raise exception 'label_help_not_allowed' using errcode = '22023',
      detail = 'Only a photo or video added for the album can be sent as Needs label.';
  end if;

  -- The same rule as finalise (AC11, AC12): only at a venue the person may
  -- still add photos to.
  if not private.media_upload_venue_allowed(v_asset.uploader_id, v_asset.uploader_role, v_asset.venue_id) then
    raise exception 'upload_access_ended' using errcode = '42501',
      detail = 'You can no longer add photos at this venue.';
  end if;

  insert into public.media_label_help_requests (asset_id, venue_id, requested_by)
  values (v_asset.id, v_asset.venue_id, v_uid)
  on conflict (asset_id) do nothing
  returning requested_at into v_at;

  if v_at is null then
    select r.requested_at into v_at
    from public.media_label_help_requests r where r.asset_id = v_asset.id;
  else
    v_created := true;
  end if;

  return jsonb_build_object(
    'assetId', v_asset.id,
    'venueId', v_asset.venue_id,
    'requestedAt', v_at,
    'created', v_created
  );
end;
$$;

comment on function public.request_label_help(uuid) is
  'FA-4: the uploader sends their own photo to the venue managers as Needs label ("I''m not sure"). Idempotent.';

-- ---------------------------------------------------------------------------
-- Mine
-- ---------------------------------------------------------------------------

create function public.my_label_help(p_asset_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) = 0 then
    return;
  end if;
  if cardinality(p_asset_ids) > 200 then
    raise exception 'too_many_assets' using errcode = '22023';
  end if;
  return query
  select r.asset_id
  from public.media_label_help_requests r
  join public.media_assets a on a.id = r.asset_id
  where r.asset_id = any (p_asset_ids)
    and a.uploader_id = auth.uid()
    and r.requested_by = auth.uid()
    and private.asset_needs_labels(r.asset_id);
end;
$$;

comment on function public.my_label_help(uuid[]) is
  'FA-4: which of the caller''s own assets they sent as Needs label and still need a label.';

-- ---------------------------------------------------------------------------
-- Queue (managers and admins)
-- ---------------------------------------------------------------------------

create function public.label_help_queue(
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
  v_since timestamptz := now() - make_interval(days => private.label_help_unmatched_days());
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
      case when r.asset_id is not null then 'not_sure' else 'unmatched' end as reason,
      coalesce(r.requested_at, a.created_at) as since
    from public.media_assets a
    left join public.media_label_help_requests r on r.asset_id = a.id
    where a.venue_id = v_venue
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.purpose = 'general'
      and (r.asset_id is not null or a.created_at <= v_since)
      and private.asset_needs_labels(a.id)
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

comment on function public.label_help_queue(uuid, integer) is
  'FA-4: the venue''s Needs label list (I''m not sure, and photos unmatched for 7 days), oldest first. Managers of the venue and admins.';

revoke all on function public.request_label_help(uuid) from public, anon, service_role;
revoke all on function public.my_label_help(uuid[]) from public, anon, service_role;
revoke all on function public.label_help_queue(uuid, integer) from public, anon, service_role;
grant execute on function public.request_label_help(uuid) to authenticated;
grant execute on function public.my_label_help(uuid[]) to authenticated;
grant execute on function public.label_help_queue(uuid, integer) to authenticated;
