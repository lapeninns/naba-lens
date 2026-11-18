-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-METRICS part 1 of 2: instrumentation (spec §18.3).
--
--   product_events      Flow events the database can't see for itself: flow
--                       started, capture route, subject selected, uncertain
--                       label, Match later, batch grouping, submitted
--                       receipt, transfer failure and retry. One row per
--                       event, written only by public.record_product_events,
--                       which takes a fixed set of fields: ids, a route, a
--                       count, a stage and a short code. Any other field is
--                       refused, so no location, file name, note, EXIF or
--                       photo content can be stored (§18.3, AC13).
--   media_state_times   When each upload became ready or failed, kept by a
--                       trigger on media_assets, so technical processing
--                       time and recovered failures are measured apart from
--                       review delay (§18.1). History before this migration
--                       has no ready time: review delay falls back to the
--                       upload's reserve time, and processing time is
--                       measured from now on.
--
-- Decisions, label corrections, requirements satisfied and export and
-- publication results are already recorded in their own append-only
-- histories (menu_item_photo_events, area_photo_decisions,
-- amenity_photo_decisions, coverage_submission_items, export_package_downloads,
-- publication_events); the metrics read (part 2) reports them from there.
--
-- Rollback: drop function public.record_product_events(jsonb); drop triggers
-- media_assets_state_times and media_assets_state_times_insert on
-- public.media_assets; drop function private.product_event_fields(); drop function
-- private.media_state_times_track(); drop table public.media_state_times;
-- drop table public.product_events.

-- ---------------------------------------------------------------------------
-- Product events
-- ---------------------------------------------------------------------------

create table public.product_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  actor_role text not null check (actor_role in ('staff', 'manager', 'admin')),
  name text not null check (name in (
    'flow_started', 'subject_selected', 'label_uncertain', 'match_later', 'not_for_slot',
    'batch_grouped', 'submitted', 'transfer_failed', 'transfer_retried')),
  -- How the photo was started (spec §5.2): from a slot, the gallery (Match),
  -- a manager's request, or Match later.
  route text check (route in ('slot', 'gallery', 'request', 'match_later')),
  batch_key uuid,
  asset_id uuid references public.media_assets (id) on delete set null,
  subject_kind text check (subject_kind in ('dish', 'area', 'amenity')),
  subject_id uuid,
  item_count integer check (item_count between 0 and 1000),
  stage text check (stage in ('transfer', 'processing', 'label')),
  outcome text check (outcome ~ '^[a-z][a-z_]{0,39}$'),
  client_event_id uuid not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint product_events_client_key unique (actor_id, client_event_id),
  constraint product_events_subject check ((subject_kind is null) = (subject_id is null))
);

create index product_events_venue_idx on public.product_events (venue_id, occurred_at desc);
create index product_events_asset_idx on public.product_events (asset_id, occurred_at desc)
  where asset_id is not null;

alter table public.product_events enable row level security;
revoke all on table public.product_events from public, anon, authenticated;

comment on table public.product_events is
  'Spec §18.3: workflow events from the Add photos and Match flows. Ids, route, counts and short codes only: never location, file names, notes or photo content. Written by public.record_product_events.';

-- The fields an event may carry. Anything else is refused.
create function private.product_event_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['name', 'route', 'venueId', 'batchId', 'assetId', 'subjectKind', 'subjectId',
    'count', 'stage', 'outcome', 'clientEventId', 'occurredAt'];
$$;

-- Records up to 50 events from the signed-in person's own flow. The venue
-- must be one where they hold a role (private.venue_role_of), or any venue
-- for an admin; a named photo must be theirs or at a venue they manage. A
-- replayed client event id is recognised and not stored twice. Returns how
-- many new events were stored.
create function public.record_product_events(p_events jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fields text[] := private.product_event_fields();
  v_event jsonb;
  v_key text;
  v_venue uuid;
  v_role text;
  v_asset uuid;
  v_at timestamptz;
  v_count integer := 0;
  v_added integer;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'invalid_events' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 50 then
    raise exception 'too_many_events' using errcode = '22023';
  end if;

  for v_event in select e from jsonb_array_elements(p_events) e loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception 'invalid_events' using errcode = '22023';
    end if;
    for v_key in select k from jsonb_object_keys(v_event) k loop
      if not (v_key = any (v_fields)) then
        raise exception 'event_field_not_allowed' using errcode = '22023',
          detail = 'field: ' || left(v_key, 40);
      end if;
    end loop;
    -- Every value is a scalar: no nested objects that could carry content.
    if exists (select 1 from jsonb_each(v_event) x where jsonb_typeof(x.value) in ('object', 'array')) then
      raise exception 'invalid_events' using errcode = '22023';
    end if;

    begin
      v_venue := (v_event ->> 'venueId')::uuid;
      v_asset := (v_event ->> 'assetId')::uuid;
      v_at := coalesce((v_event ->> 'occurredAt')::timestamptz, now());
    exception when others then
      raise exception 'invalid_events' using errcode = '22023';
    end;
    if v_venue is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;

    v_role := private.venue_role_of(v_uid, v_venue);
    if private.is_active_admin() then
      if not exists (select 1 from public.venues v where v.id = v_venue) then
        raise exception 'wrong_venue' using errcode = '42501';
      end if;
      v_role := 'admin';
    elsif v_role is null or v_role = 'admin' then
      -- An admin without their second step is not an admin here.
      raise exception 'wrong_venue' using errcode = '42501';
    end if;

    if v_asset is not null and not exists (
      select 1 from public.media_assets a
      where a.id = v_asset and a.venue_id = v_venue
        and (a.uploader_id = v_uid or private.can_manage_venue(a.venue_id))
    ) then
      raise exception 'event_asset_not_found' using errcode = '42501';
    end if;

    -- A clock far off is not trusted; the server's time is used instead.
    if v_at < now() - interval '7 days' or v_at > now() + interval '5 minutes' then
      v_at := now();
    end if;

    begin
      insert into public.product_events (
        venue_id, actor_id, actor_role, name, route, batch_key, asset_id, subject_kind,
        subject_id, item_count, stage, outcome, client_event_id, occurred_at)
      values (
        v_venue, v_uid, v_role, v_event ->> 'name', v_event ->> 'route',
        (v_event ->> 'batchId')::uuid, v_asset, v_event ->> 'subjectKind',
        (v_event ->> 'subjectId')::uuid, (v_event ->> 'count')::integer, v_event ->> 'stage',
        v_event ->> 'outcome', (v_event ->> 'clientEventId')::uuid, v_at)
      on conflict (actor_id, client_event_id) do nothing;
      get diagnostics v_added = row_count;
    exception
      when check_violation or not_null_violation or invalid_text_representation
        or numeric_value_out_of_range or invalid_parameter_value then
        raise exception 'invalid_events' using errcode = '22023';
    end;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.product_event_fields() from public, anon, authenticated;
revoke all on function public.record_product_events(jsonb) from public, anon, service_role;
grant execute on function public.record_product_events(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Upload state times
-- ---------------------------------------------------------------------------

create table public.media_state_times (
  asset_id uuid primary key references public.media_assets (id) on delete cascade,
  venue_id uuid not null,
  reserved_at timestamptz not null,
  ready_at timestamptz,
  first_failed_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);

create index media_state_times_venue_ready_idx on public.media_state_times (venue_id, ready_at);

alter table public.media_state_times enable row level security;
revoke all on table public.media_state_times from public, anon, authenticated;

comment on table public.media_state_times is
  'Spec §18.1: when an upload first became ready and how often it failed, so processing time and recovered failures are measured apart from review delay.';

create function private.media_state_times_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.upload_state = 'ready' then
    insert into public.media_state_times (asset_id, venue_id, reserved_at, ready_at)
    values (new.id, new.venue_id, new.created_at, now())
    on conflict (asset_id) do update
      set ready_at = coalesce(public.media_state_times.ready_at, excluded.ready_at);
  elsif new.upload_state = 'failed' then
    insert into public.media_state_times (asset_id, venue_id, reserved_at, first_failed_at, failure_count)
    values (new.id, new.venue_id, new.created_at, now(), 1)
    on conflict (asset_id) do update
      set first_failed_at = coalesce(public.media_state_times.first_failed_at, excluded.first_failed_at),
        failure_count = public.media_state_times.failure_count + 1;
  end if;
  return null;
end;
$$;

revoke all on function private.media_state_times_track() from public, anon, authenticated;

create trigger media_assets_state_times_insert
  after insert on public.media_assets
  for each row
  when (new.upload_state in ('ready', 'failed'))
  execute function private.media_state_times_track();

-- Only a real change of state counts (a failed upload failing again counts
-- once per transition into failed).
create trigger media_assets_state_times
  after update of upload_state on public.media_assets
  for each row
  when (new.upload_state in ('ready', 'failed') and old.upload_state is distinct from new.upload_state)
  execute function private.media_state_times_track();
