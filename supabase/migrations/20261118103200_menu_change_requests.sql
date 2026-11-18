-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-MENUS (spec §3.3, §7 M5, §8 A3): managers request
-- permanent catalogue changes; admins decide. Retiring a permanent dish is an
-- admin action with an impact preview.
--
--   Requests  public.menu_change_request_create: the venue's manager (or an
--             admin) asks to add, rename, remove or change the presentation
--             of a dish, or something else, in 1 to 1000 characters.
--             public.menu_change_request_decide (admin): approve, decline or
--             ask for clarification (a reason is required unless approving);
--             the requester may withdraw an open one
--             (public.menu_change_request_withdraw). Approving records the
--             decision; the admin then edits a menu draft. Every step is a
--             menu_events row.
--   Reads     public.menu_change_requests_list: the venue's manager sees
--             their venue's requests; an admin sees one venue or, with a
--             null venue, every venue.
--   Impact    public.menu_item_retirement_impact (manager of the venue or
--             admin): what removing a dish would affect (accepted photos,
--             labelled photos, primary, open requests, local state).
--
-- Rollback: revoke execute on the public functions below. The table stays.

create table public.menu_change_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  item_id uuid,
  kind text not null check (kind in ('add', 'rename', 'remove', 'presentation', 'other')),
  detail text not null check (length(detail) between 1 and 1000 and detail = btrim(detail)),
  status text not null default 'open'
    check (status in ('open', 'approved', 'declined', 'clarification_requested', 'withdrawn')),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or (length(decision_reason) between 1 and 500 and decision_reason = btrim(decision_reason))),
  revision integer not null default 1 check (revision >= 1),
  constraint menu_change_requests_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_change_requests_item_needed check (kind in ('add', 'other') or item_id is not null),
  constraint menu_change_requests_reason check (
    status not in ('declined', 'clarification_requested') or decision_reason is not null
  )
);

create index menu_change_requests_venue_idx on public.menu_change_requests (venue_id, status, requested_at);
create index menu_change_requests_open_idx on public.menu_change_requests (requested_at) where status = 'open';

comment on table public.menu_change_requests is
  'S1-MENUS: a manager''s request for a permanent catalogue change, decided by an admin (spec §7 M5, §8 A3).';

alter table public.menu_change_requests enable row level security;
revoke all on table public.menu_change_requests from public, anon, authenticated, service_role;
grant select on table public.menu_change_requests to service_role;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create function public.menu_change_request_create(p_venue_id uuid, p_item_id uuid, p_kind text, p_detail text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_detail text;
  v_id uuid;
begin
  if p_venue_id is null then
    raise exception 'venue_required' using errcode = '22023';
  end if;
  perform private.assert_can_manage_venue(p_venue_id);
  perform private.amenity_assert_venue_active(p_venue_id);
  if p_kind is null or p_kind not in ('add', 'rename', 'remove', 'presentation', 'other') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  v_detail := private.clean_text(p_detail, 1000, 'invalid_detail');
  if v_detail is null then
    raise exception 'invalid_detail' using errcode = '22023';
  end if;
  if p_item_id is not null and not exists (
    select 1 from public.menu_items i where i.id = p_item_id and i.venue_id = p_venue_id
  ) then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  if p_item_id is null and p_kind not in ('add', 'other') then
    raise exception 'item_required' using errcode = '22023';
  end if;

  insert into public.menu_change_requests (venue_id, item_id, kind, detail, requested_by)
  values (p_venue_id, p_item_id, p_kind, v_detail, v_uid)
  returning id into v_id;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (p_venue_id, p_item_id, v_uid, 'change_requested',
    jsonb_build_object('requestId', v_id, 'kind', p_kind));
  return jsonb_build_object('requestId', v_id, 'status', 'open', 'revision', 1);
end;
$$;

-- Admin: approved | declined | clarification_requested (reason required
-- unless approving). Only an open request is decided.
create function public.menu_change_request_decide(
  p_request_id uuid, p_decision text, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v public.menu_change_requests;
  v_reason text;
begin
  if p_decision is null or p_decision not in ('approved', 'declined', 'clarification_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select r.* into v from public.menu_change_requests r where r.id = p_request_id for update;
  if v.id is null then
    raise exception 'menu_change_request_not_found' using errcode = 'P0002';
  end if;
  if v.revision is distinct from p_revision then
    raise exception 'menu_change_request_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v.revision)::text;
  end if;
  if v.status <> 'open' then
    raise exception 'menu_change_request_not_open' using errcode = 'P0001';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'reason_too_long');
  if p_decision <> 'approved' and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.menu_change_requests r
  set status = p_decision, decided_by = v_uid, decided_at = now(), decision_reason = v_reason,
      revision = r.revision + 1
  where r.id = v.id;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v.venue_id, v.item_id, v_uid, 'change_request_decided',
    jsonb_build_object('requestId', v.id, 'decision', p_decision, 'reason', v_reason));
  return jsonb_build_object('requestId', v.id, 'status', p_decision, 'revision', v.revision + 1);
end;
$$;

-- The requester withdraws their own open (or clarification) request.
create function public.menu_change_request_withdraw(p_request_id uuid, p_revision integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v public.menu_change_requests;
begin
  select r.* into v from public.menu_change_requests r where r.id = p_request_id for update;
  if v.id is null or v.requested_by <> v_uid then
    raise exception 'menu_change_request_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_can_manage_venue(v.venue_id);
  if v.revision is distinct from p_revision then
    raise exception 'menu_change_request_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v.revision)::text;
  end if;
  if v.status not in ('open', 'clarification_requested') then
    raise exception 'menu_change_request_not_open' using errcode = 'P0001';
  end if;
  update public.menu_change_requests r
  set status = 'withdrawn', revision = r.revision + 1
  where r.id = v.id;
  insert into public.menu_events (venue_id, item_id, actor_id, action, detail)
  values (v.venue_id, v.item_id, v_uid, 'change_request_decided',
    jsonb_build_object('requestId', v.id, 'decision', 'withdrawn'));
  return jsonb_build_object('requestId', v.id, 'status', 'withdrawn', 'revision', v.revision + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- p_status null = every status. An admin may pass a null venue for all venues.
create function public.menu_change_requests_list(p_venue_id uuid default null, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  perform private.amenity_assert_active_user();
  v_admin := private.is_active_admin();
  if p_venue_id is null and not v_admin then
    raise exception 'venue_required' using errcode = '22023';
  end if;
  if p_venue_id is not null then
    perform private.assert_can_manage_venue(p_venue_id);
  end if;
  if p_status is not null
     and p_status not in ('open', 'approved', 'declined', 'clarification_requested', 'withdrawn') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'requestId', r.id, 'venueId', r.venue_id, 'venueName', vn.name,
        'itemId', r.item_id,
        'itemName', (select e.name from public.menu_entries e
          join public.menu_versions mv on mv.id = e.version_id
          where e.item_id = r.item_id order by (mv.status = 'active') desc, mv.created_at desc limit 1),
        'kind', r.kind, 'detail', r.detail, 'status', r.status,
        'requestedBy', r.requested_by,
        'requestedByName', case when v_admin then pr.display_name else split_part(pr.display_name, ' ', 1) end,
        'requestedAt', r.requested_at, 'decidedAt', r.decided_at, 'decisionReason', r.decision_reason,
        'revision', r.revision)
      order by (r.status = 'open') desc, r.requested_at, r.id)
    from public.menu_change_requests r
    join public.venues vn on vn.id = r.venue_id
    left join public.profiles pr on pr.id = r.requested_by
    where (p_venue_id is null or r.venue_id = p_venue_id)
      and (p_status is null or r.status = p_status)
  ), '[]'::jsonb));
end;
$$;

-- What retiring a dish would affect, before anyone asks for or does it.
create function public.menu_item_retirement_impact(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
begin
  perform private.amenity_assert_active_user();
  select i.venue_id into v_venue from public.menu_items i where i.id = p_item_id;
  if v_venue is null then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_can_manage_venue(v_venue);
  return jsonb_build_object(
    'itemId', p_item_id,
    'onActiveMenu', exists (select 1 from public.menu_entries e
      join public.menu_versions v on v.id = e.version_id and v.status = 'active' where e.item_id = p_item_id),
    'onScheduledMenu', exists (select 1 from public.menu_entries e
      join public.menu_versions v on v.id = e.version_id and v.status = 'draft' and v.scheduled_for is not null
      where e.item_id = p_item_id),
    'acceptedPhotos', (select count(*) from public.menu_item_photos p
      where p.item_id = p_item_id and p.state = 'accepted')::integer,
    'recheckPhotos', (select count(*) from public.menu_item_photos p
      where p.item_id = p_item_id and p.state = 'needs_recheck')::integer,
    'hasPrimary', exists (select 1 from public.menu_item_photos p where p.item_id = p_item_id and p.is_primary),
    'labelledPhotos', (select count(distinct l.asset_id) from public.media_label_items l
      where l.item_id = p_item_id)::integer,
    'openRequests', (select count(*) from public.menu_change_requests r
      where r.item_id = p_item_id and r.status in ('open', 'clarification_requested'))::integer,
    'temporarilyUnavailable', exists (select 1 from public.menu_item_availability a where a.item_id = p_item_id),
    'note', 'Retiring removes the dish from current coverage. Its photos, labels and history are kept.');
end;
$$;

revoke all on function
  public.menu_change_request_create(uuid, uuid, text, text),
  public.menu_change_request_decide(uuid, text, text, integer),
  public.menu_change_request_withdraw(uuid, integer),
  public.menu_change_requests_list(uuid, text),
  public.menu_item_retirement_impact(uuid)
from public, anon, service_role;

grant execute on function
  public.menu_change_request_create(uuid, uuid, text, text),
  public.menu_change_request_decide(uuid, text, text, integer),
  public.menu_change_request_withdraw(uuid, integer),
  public.menu_change_requests_list(uuid, text),
  public.menu_item_retirement_impact(uuid)
to authenticated;
