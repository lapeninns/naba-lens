-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-PRIVACY (spec §3.3, §16; decision FA-21): accepted
-- originals are kept. Staff withdraw their own unreviewed uploads; nobody
-- but an admin removes an accepted one, and an admin does it with a reason,
-- after an impact preview, and never while it is published.
--
--   Withdraw   public.delete_media_asset(asset) (same name and arguments as
--              20261029120100_nabalens_access.sql): the uploader while
--              active staff, or an admin (as before), for an asset
--              that is not accepted (private.asset_is_accepted). An accepted
--              asset raises media_asset_retained. Repeating on a removed
--              asset still succeeds. Each removal is written to
--              media_removal_events.
--   Request    public.request_media_removal(asset, reason): the uploader of
--              an accepted asset, or a manager of its venue, asks an admin to
--              remove it. One open request per person and asset; asking
--              again returns the open one. The requester may cancel it.
--   Preview    public.media_removal_impact(asset): what removing it touches
--              (menu items and whether it is their primary photo, area
--              places, coverage sends, amenity answers, active use grants by
--              audience, open requests) and a token for exactly that state.
--              Admins, and managers of the venue.
--   Remove     public.admin_delete_media_asset(asset, reason, token): admin
--              only, with a 3 to 500 character reason and the preview's
--              token (impact_changed when it no longer matches). Refused
--              while a public use grant is active (media_asset_published):
--              withdraw the use first. Closes open requests as completed.
--   Decline    public.decline_media_removal_request(request, reason): admin.
--   List       public.media_removal_requests(state, venue): admins all,
--              managers their venue, everyone else their own.
--
-- media_removal_events is append-only (actor, asset, venue, request, action,
-- reason, impact snapshot). Tables are read and written only through these
-- functions. Nothing here changes review, coverage or label rules; storage
-- objects are removed by the app after the tombstone, as before.
--
-- Rollback: re-apply delete_media_asset from 20261029120100 and revoke
-- execute on the new public functions. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.media_removal_requests (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  venue_id uuid not null,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  reason text not null check (length(reason) between 3 and 500 and reason = btrim(reason)),
  state text not null default 'open' check (state in ('open', 'completed', 'declined', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or (length(decision_reason) between 3 and 500 and decision_reason = btrim(decision_reason))),
  created_at timestamptz not null default now(),
  constraint media_removal_requests_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_removal_requests_decided check ((state = 'open') = (decided_at is null)),
  constraint media_removal_requests_decider check ((decided_at is null) = (decided_by is null))
);

create unique index media_removal_requests_one_open
  on public.media_removal_requests (asset_id, requested_by) where state = 'open';
create index media_removal_requests_venue_idx
  on public.media_removal_requests (venue_id, state, created_at);

comment on table public.media_removal_requests is
  'FA-21: requests to remove an accepted original; an admin completes (removes) or declines them.';

create table public.media_removal_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null,
  venue_id uuid not null references public.venues (id) on delete restrict,
  request_id uuid references public.media_removal_requests (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  action text not null check (action in ('withdrawn', 'requested', 'cancelled', 'declined', 'removed')),
  reason text,
  impact jsonb check (impact is null or jsonb_typeof(impact) = 'object'),
  created_at timestamptz not null default now()
);

create index media_removal_events_asset_idx on public.media_removal_events (asset_id, id);

comment on table public.media_removal_events is
  'FA-21: append-only history of withdrawals, removal requests and admin removals (with reason and impact snapshot).';

create trigger media_removal_events_append_only
  before update or delete on public.media_removal_events
  for each row execute function private.append_only_guard();
create trigger media_removal_events_no_truncate
  before truncate on public.media_removal_events
  for each statement execute function private.append_only_guard();

alter table public.media_removal_requests enable row level security;
alter table public.media_removal_events enable row level security;
revoke all on table public.media_removal_requests, public.media_removal_events from public, anon, authenticated, service_role;
grant select on table public.media_removal_requests, public.media_removal_events to service_role;

-- ---------------------------------------------------------------------------
-- Impact
-- ---------------------------------------------------------------------------

-- What removing the asset touches. No access check: callers check first.
create function private.media_removal_impact_of(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assetId', a.id,
    'venueId', a.venue_id,
    'uploaderId', a.uploader_id,
    'removed', a.deleted_at is not null,
    'accepted', private.asset_is_accepted(a.id),
    'menuItems', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemId', m.item_id, 'name', m.item_name, 'state', m.state, 'isPrimary', m.is_primary)
        order by m.item_name, m.item_id)
      from public.menu_item_photos m
      where m.asset_id = a.id and m.state in ('accepted', 'better_photo_requested', 'needs_recheck')
    ), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
          'subjectId', l.subject_id, 'label', l.subject_label,
          'state', coalesce((select d.action from public.area_photo_decisions d
                              where d.label_id = l.id order by d.id desc limit 1), 'waiting'))
        order by l.subject_label, l.subject_id)
      from public.media_area_labels l
      where l.asset_id = a.id and l.removed_at is null
    ), '[]'::jsonb),
    'coverageSends', (
      select count(*) from public.coverage_submission_items ci
      where ci.asset_id = a.id and ci.state in ('submitted', 'accepted')
    ),
    'amenityAnswers', (
      select count(distinct c.id)
      from public.venue_amenity_checks c
      join public.amenity_submission_assets sa on sa.submission_id = c.current_submission_id
      where sa.asset_id = a.id
    ),
    'publicUses', (
      select count(*) from public.media_use_grants g
      where g.asset_id = a.id and g.audience = 'public'
        and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
        and (g.effective_until is null or g.effective_until > now())
    ),
    'internalUses', (
      select count(*) from public.media_use_grants g
      where g.asset_id = a.id and g.audience = 'internal'
        and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
        and (g.effective_until is null or g.effective_until > now())
    ),
    'openRequests', (
      select count(*) from public.media_removal_requests r
      where r.asset_id = a.id and r.state = 'open'
    )
  )
  from public.media_assets a
  where a.id = p_asset_id;
$$;

revoke all on function private.media_removal_impact_of(uuid) from public, anon, authenticated, service_role;

-- The impact plus a token over exactly that state, for the admin's removal.
create function public.media_removal_impact(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_impact jsonb;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select a.venue_id into v_venue from public.media_assets a where a.id = p_asset_id;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_impact := private.media_removal_impact_of(p_asset_id);
  return v_impact || jsonb_build_object(
    'blocked', (v_impact ->> 'publicUses')::bigint > 0,
    'token', md5(v_impact::text));
end;
$$;

-- ---------------------------------------------------------------------------
-- Withdraw an unreviewed upload (staff, manager accounts, admins)
-- ---------------------------------------------------------------------------

create or replace function public.delete_media_asset(p_asset_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_venue uuid;
  v_deleted timestamptz;
begin
  select a.uploader_id, a.venue_id, a.deleted_at into v_owner, v_venue, v_deleted
  from public.media_assets a where a.id = p_asset_id;

  if v_uid is null or v_owner is null
     or not (private.is_active_admin() or (private.is_active_staff() and v_owner = v_uid)) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  -- Removing a removed asset succeeds again.
  if v_deleted is not null then
    return;
  end if;

  -- FA-21: an accepted original is kept; an admin removes it with a reason.
  if private.asset_is_accepted(p_asset_id) then
    raise exception 'media_asset_retained' using errcode = 'P0001',
      detail = 'Accepted media is kept. Ask an admin to remove it.';
  end if;

  update public.media_assets a
  set deleted_at = now()
  where a.id = p_asset_id and a.deleted_at is null;

  if found then
    insert into public.media_removal_events (asset_id, venue_id, actor_id, action)
    values (p_asset_id, v_venue, v_uid, 'withdrawn');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ask an admin to remove an accepted asset
-- ---------------------------------------------------------------------------

create function public.request_media_removal(p_asset_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_asset record;
  v_open uuid;
  v_id uuid;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select a.id, a.uploader_id, a.venue_id, a.deleted_at, a.upload_state into v_asset
  from public.media_assets a where a.id = p_asset_id;
  if v_asset.id is null or v_asset.deleted_at is not null
     or not (v_asset.uploader_id = v_uid or private.can_manage_venue(v_asset.venue_id)) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = '22023',
      detail = 'A reason of 3 to 500 characters.';
  end if;
  -- The uploader withdraws an unreviewed upload directly.
  if v_asset.uploader_id = v_uid and not private.asset_is_accepted(p_asset_id)
     and not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'withdraw_instead' using errcode = 'P0001',
      detail = 'This upload has not been accepted, so it can be withdrawn.';
  end if;

  select r.id into v_open from public.media_removal_requests r
  where r.asset_id = p_asset_id and r.requested_by = v_uid and r.state = 'open';
  if v_open is not null then
    return jsonb_build_object('requestId', v_open, 'state', 'open', 'created', false);
  end if;

  insert into public.media_removal_requests (asset_id, venue_id, requested_by, reason)
  values (p_asset_id, v_asset.venue_id, v_uid, v_reason)
  returning id into v_id;
  insert into public.media_removal_events (asset_id, venue_id, request_id, actor_id, action, reason)
  values (p_asset_id, v_asset.venue_id, v_id, v_uid, 'requested', v_reason);
  return jsonb_build_object('requestId', v_id, 'state', 'open', 'created', true);
end;
$$;

create function public.cancel_media_removal_request(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select r.* into v_req from public.media_removal_requests r
  where r.id = p_request_id for update;
  if v_req.id is null or v_req.requested_by <> v_uid then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_req.state = 'cancelled' then
    return jsonb_build_object('requestId', v_req.id, 'state', 'cancelled');
  end if;
  if v_req.state <> 'open' then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  update public.media_removal_requests
  set state = 'cancelled', decided_by = v_uid, decided_at = now()
  where id = v_req.id;
  insert into public.media_removal_events (asset_id, venue_id, request_id, actor_id, action)
  values (v_req.asset_id, v_req.venue_id, v_req.id, v_uid, 'cancelled');
  return jsonb_build_object('requestId', v_req.id, 'state', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin decisions
-- ---------------------------------------------------------------------------

create function public.decline_media_removal_request(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_req record;
begin
  if not private.is_active_admin() then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select r.* into v_req from public.media_removal_requests r
  where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_req.state <> 'open' then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  update public.media_removal_requests
  set state = 'declined', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
  where id = v_req.id;
  insert into public.media_removal_events (asset_id, venue_id, request_id, actor_id, action, reason)
  values (v_req.asset_id, v_req.venue_id, v_req.id, v_uid, 'declined', v_reason);
  return jsonb_build_object('requestId', v_req.id, 'state', 'declined');
end;
$$;

-- Removes any asset, accepted or not, with a reason and the preview's token.
create function public.admin_delete_media_asset(
  p_asset_id uuid, p_reason text, p_impact_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_venue uuid;
  v_deleted timestamptz;
  v_impact jsonb;
  v_closed uuid[];
begin
  if not private.is_active_admin() then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  select a.venue_id, a.deleted_at into v_venue, v_deleted
  from public.media_assets a where a.id = p_asset_id for update;
  if v_venue is null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = '22023',
      detail = 'A reason of 3 to 500 characters.';
  end if;
  if v_deleted is not null then
    return jsonb_build_object('assetId', p_asset_id, 'removed', true, 'closedRequests', '[]'::jsonb);
  end if;
  v_impact := private.media_removal_impact_of(p_asset_id);
  if p_impact_token is distinct from md5(v_impact::text) then
    raise exception 'impact_changed' using errcode = '40001',
      detail = 'What this removal touches has changed. Check the preview again.';
  end if;
  if (v_impact ->> 'publicUses')::bigint > 0 then
    raise exception 'media_asset_published' using errcode = 'P0001',
      detail = 'Withdraw its public uses first.';
  end if;

  update public.media_assets set deleted_at = now() where id = p_asset_id;

  with closed as (
    update public.media_removal_requests r
    set state = 'completed', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
    where r.asset_id = p_asset_id and r.state = 'open'
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into v_closed from closed;

  insert into public.media_removal_events (asset_id, venue_id, request_id, actor_id, action, reason, impact)
  select p_asset_id, v_venue, rid, v_uid, 'removed', v_reason, v_impact
  from unnest(case when cardinality(v_closed) = 0 then array[null::uuid] else v_closed end) as rid;

  return jsonb_build_object('assetId', p_asset_id, 'removed', true,
    'closedRequests', to_jsonb(v_closed));
end;
$$;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

create function public.media_removal_requests(
  p_state text default 'open', p_venue_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := private.is_active_admin();
begin
  if not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('open', 'completed', 'declined', 'cancelled') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'requestId', r.id, 'assetId', r.asset_id, 'venueId', r.venue_id,
        'venueName', v.name, 'requestedBy', r.requested_by,
        'requesterName', p.display_name, 'reason', r.reason, 'state', r.state,
        'createdAt', r.created_at, 'decidedAt', r.decided_at,
        'decisionReason', r.decision_reason, 'mine', r.requested_by = v_uid)
      order by r.created_at, r.id)
    from public.media_removal_requests r
    join public.venues v on v.id = r.venue_id
    join public.profiles p on p.id = r.requested_by
    where (p_state is null or r.state = p_state)
      and (p_venue_id is null or r.venue_id = p_venue_id)
      and (v_admin or r.requested_by = v_uid or private.can_manage_venue(r.venue_id))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.media_removal_impact(uuid) from public, anon, service_role;
revoke all on function public.request_media_removal(uuid, text) from public, anon, service_role;
revoke all on function public.cancel_media_removal_request(uuid) from public, anon, service_role;
revoke all on function public.decline_media_removal_request(uuid, text) from public, anon, service_role;
revoke all on function public.admin_delete_media_asset(uuid, text, text) from public, anon, service_role;
revoke all on function public.media_removal_requests(text, uuid) from public, anon, service_role;
grant execute on function public.media_removal_impact(uuid) to authenticated;
grant execute on function public.request_media_removal(uuid, text) to authenticated;
grant execute on function public.cancel_media_removal_request(uuid) to authenticated;
grant execute on function public.decline_media_removal_request(uuid, text) to authenticated;
grant execute on function public.admin_delete_media_asset(uuid, text, text) to authenticated;
grant execute on function public.media_removal_requests(text, uuid) to authenticated;
