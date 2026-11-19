-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-REQ: requests and shot lists (spec §7 M4, §2 "Task",
-- §11; FA-5; AC01, AC24, AC39).
--
--   Request    public.media_requests: a request to help satisfy one slot's
--              requirement, or a New brief for a subject with no slot yet.
--              It points at the slot (dish, area or amenity, as
--              public.coverage_slots names it) or at a fact (an amenity
--              check); it is never a second copy of the requirement, so it
--              never adds to or removes from coverage (§2, AC39).
--   Types      missing_photo, replacement (required); optional_angle,
--              campaign (optional creative work, outside coverage);
--              fact_confirmation (a fact, assigned to a manager or admin).
--   Fields     required: subject (the slot's name, or typed for a New
--              brief), a one-line brief (the short instruction, as
--              album_briefs) and the intended use. Defaults: the manager's
--              venue, the team from the slot's category, one photograph,
--              normal priority. Optional: person, date, reference image,
--              orientation, video asked, capture window, shot list.
--   Dates      FA-5: a request on a slot carries a "needed by" date that is
--              never overdue (DESIGN.md §7, §9); a request with no slot and a
--              shot list may carry a real due date, which can be overdue.
--   States     Open, Submitted, Completed, Blocked, Cancelled (§7 M4).
--              Cancelled (with a reason) and Completed are stored; Blocked is
--              a stored reason or a temporarily unavailable slot (sold out,
--              inv. 7); Submitted is a photo waiting for review on the slot,
--              or a fact contribution after the request; else Open (a retake
--              reopens it).
--   Completion private.media_requests_settle(venue) closes open requests
--              whose rule is met, called by every read and write here:
--                missing_photo   the slot is covered (public level)
--                                and, if more than one photo was requested,
--                                that many new public acceptances
--                replacement     the requested number of new public acceptances
--                optional_angle, campaign on a slot
--                                the requested number of new acceptances at either level
--                fact_confirmation
--                                the fact reads Confirmed and a manager
--                                decision or reconfirmation was recorded after
--                                the request; staff findings never complete it
--              A slot that reads Not here or Inactive, or is no longer
--              listed, cancels its open requests ("No longer needed", AC24).
--              A request with no slot is completed by a manager by hand.
--   Notify     naming a person sends them an 'assigned' notice (S1-OPS);
--              closing the request resolves it.
--   Access     managers of the venue and admins write and read everything
--              (S3.3); staff read the open media requests of their venue
--              (public.my_media_requests), never fact requests.
--   History    public.media_request_events (append-only), plus the activity
--              log for creation, blocking and closing.
--
-- Rollback: revoke execute on the public functions below. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.shot_lists (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  name text not null check (length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  purpose text not null check (purpose in ('menu_launch', 'quiet_period', 'campaign')),
  due_on date,
  note text check (note is null or (length(note) between 1 and 280 and note = btrim(note))),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete restrict,
  cancel_reason text check (cancel_reason is null or (length(cancel_reason) between 1 and 500)),
  revision integer not null default 1 check (revision >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shot_lists_id_venue_key unique (id, venue_id),
  constraint shot_lists_cancelled check ((cancelled_at is null) = (cancel_reason is null))
);

create index shot_lists_venue_idx on public.shot_lists (venue_id, created_at desc);

comment on table public.shot_lists is
  'S2-REQ (spec §7 M4): a few requests grouped for a menu launch, a quiet service period or a campaign. Completed when every request in it that is not cancelled is completed.';

create table public.media_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  request_type text not null check (request_type in (
    'missing_photo', 'replacement', 'optional_angle', 'fact_confirmation', 'campaign')),
  slot_kind text check (slot_kind in ('dish', 'area', 'amenity')),
  slot_id uuid,
  fact_check_id uuid,
  subject text not null check (length(subject) between 1 and 120 and subject = btrim(subject) and subject !~ '[[:cntrl:]]'),
  brief text not null check (length(brief) between 1 and 140 and brief = btrim(brief) and brief !~ '[[:cntrl:]]'),
  intended_use text not null check (intended_use in ('public', 'social', 'reference', 'internal')),
  team text not null default 'any' check (team in ('foh', 'boh', 'any')),
  photo_count integer not null default 1 check (photo_count between 1 and 20),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee_id uuid references public.profiles (id) on delete restrict,
  due_on date,
  reference_asset_id uuid references public.media_assets (id) on delete restrict,
  orientation text check (orientation in ('portrait', 'landscape', 'square')),
  wants_video boolean not null default false,
  capture_window text check (capture_window is null or (
    length(capture_window) between 1 and 80 and capture_window = btrim(capture_window) and capture_window !~ '[[:cntrl:]]')),
  shot_list_id uuid,
  blocked_reason text check (blocked_reason is null or (length(blocked_reason) between 1 and 500)),
  closed_state text check (closed_state in ('completed', 'cancelled')),
  closed_reason text check (closed_reason is null or (length(closed_reason) between 1 and 500)),
  closed_by uuid references public.profiles (id) on delete restrict,
  closed_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_requests_id_venue_key unique (id, venue_id),
  constraint media_requests_shot_list_fkey foreign key (shot_list_id, venue_id)
    references public.shot_lists (id, venue_id) on delete restrict,
  constraint media_requests_fact_fkey foreign key (fact_check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  constraint media_requests_slot_pair check ((slot_kind is null) = (slot_id is null)),
  -- A fact request points at a fact and no slot; a replacement needs a slot.
  constraint media_requests_fact_shape check (
    (request_type = 'fact_confirmation') = (fact_check_id is not null)
    and (request_type <> 'fact_confirmation' or slot_id is null)),
  constraint media_requests_replacement_slot check (request_type <> 'replacement' or slot_id is not null),
  constraint media_requests_closed check (
    (closed_state is null) = (closed_at is null)
    and (closed_state is distinct from 'cancelled' or closed_reason is not null))
);

-- One open required request per slot, and one open request per fact.
create unique index media_requests_open_slot_key on public.media_requests (venue_id, slot_kind, slot_id)
  where closed_state is null and request_type in ('missing_photo', 'replacement');
create unique index media_requests_open_fact_key on public.media_requests (fact_check_id)
  where closed_state is null;
create index media_requests_venue_idx on public.media_requests (venue_id, closed_state, created_at desc);
create index media_requests_assignee_idx on public.media_requests (assignee_id) where closed_state is null;

comment on table public.media_requests is
  'S2-REQ (spec §7 M4, FA-5): a request on a slot or fact, or a New brief. Never part of coverage; completion follows the slot or fact (private.media_requests_settle).';

create table public.media_request_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  request_id uuid,
  shot_list_id uuid,
  kind text not null check (kind in (
    'created', 'edited', 'blocked', 'unblocked', 'completed', 'cancelled',
    'list_created', 'list_edited', 'list_cancelled')),
  -- Null when the rule closed the request (no person acted).
  actor_id uuid references public.profiles (id) on delete restrict,
  reason text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  constraint media_request_events_subject check (request_id is not null or shot_list_id is not null)
);

create index media_request_events_request_idx on public.media_request_events (request_id, id);
create index media_request_events_list_idx on public.media_request_events (shot_list_id, id);

comment on table public.media_request_events is
  'S2-REQ: append-only history of media_requests and shot_lists.';

create trigger media_request_events_append_only
  before update or delete on public.media_request_events
  for each row execute function private.append_only_guard();
create trigger media_request_events_no_truncate
  before truncate on public.media_request_events
  for each statement execute function private.append_only_guard();

-- Reads and writes go through the functions below only.
alter table public.shot_lists enable row level security;
alter table public.media_requests enable row level security;
alter table public.media_request_events enable row level security;
revoke all on table public.shot_lists, public.media_requests, public.media_request_events
  from public, anon, authenticated, service_role;
grant select on table public.shot_lists, public.media_requests, public.media_request_events to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The venue a manager or admin writes or reads requests for: an admin names
-- one; a manager gets their own (or names it).
create function private.media_request_manager_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
begin
  perform private.amenity_assert_active_user();
  if v_venue is null then
    if private.is_active_admin() then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  perform private.assert_can_manage_venue(v_venue);
  return v_venue;
end;
$$;

-- When the requested number of distinct photos were accepted at or after
-- p_since (null while short). A later withdrawal or rejection removes a photo.
create function private.media_request_fulfilled_at(
  p_venue_id uuid, p_kind text, p_slot_id uuid, p_since timestamptz,
  p_public_only boolean, p_photo_count integer
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(x.at) from (
    select p.asset_id, p.decided_at as at
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p_kind = 'dish' and p.venue_id = p_venue_id and p.item_id = p_slot_id
      and p.state in ('accepted', 'needs_recheck') and p.decided_at >= p_since
      and (not p_public_only or p.review_level = 'public')
      and a.deleted_at is null
    union all
    select l.asset_id, d.decided_at
    from public.media_area_labels l
    join public.area_photo_decisions d on d.label_id = l.id
    join public.media_assets a on a.id = l.asset_id
    where p_kind = 'area' and l.venue_id = p_venue_id and l.subject_id = p_slot_id
      and l.removed_at is null
      and a.deleted_at is null
      and d.action = 'accepted' and d.decided_at >= p_since
      and (not p_public_only or d.review_level = 'public')
      and not exists (select 1 from public.area_photo_decisions n where n.label_id = d.label_id and n.id > d.id)
    union all
    select d.asset_id, d.decided_at
    from public.amenity_photo_decisions d
    join public.media_assets a on a.id = d.asset_id
    where p_kind = 'amenity' and d.venue_id = p_venue_id and d.check_id = p_slot_id
      and d.action = 'accepted' and d.decided_at >= p_since
      and a.deleted_at is null
      and (not p_public_only or d.review_level = 'public')
      and not exists (
        select 1 from public.amenity_photo_decisions n
        where n.check_id = d.check_id and n.asset_id = d.asset_id and n.id > d.id)
  ) x
  group by x.asset_id
  order by min(x.at)
  offset (p_photo_count - 1) limit 1;
$$;

-- The team that usually photographs a category (M4 defaults): kitchen for
-- food, front of house for drinks, spaces and facilities.
create function private.media_request_default_team(p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'food' then 'boh'
    when 'drinks' then 'foh'
    when 'spaces' then 'foh'
    when 'facilities' then 'foh'
    else 'any'
  end;
$$;

create function private.media_request_event(
  p_venue_id uuid, p_request_id uuid, p_shot_list_id uuid, p_kind text,
  p_reason text default null, p_detail jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.media_request_events (venue_id, request_id, shot_list_id, kind, actor_id, reason, detail)
  values (p_venue_id, p_request_id, p_shot_list_id, p_kind,
    (select p.id from public.profiles p where p.id = auth.uid()),
    nullif(btrim(p_reason), ''), coalesce(p_detail, '{}'::jsonb));
$$;

-- Sends the named person an 'assigned' notice (S1-OPS), unless they named
-- themselves. A failed notice never stops the request saving.
create function private.media_request_notify(p_request public.media_requests)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_request.assignee_id is null or p_request.assignee_id = auth.uid() then
    return;
  end if;
  perform private.notify(p_request.assignee_id, p_request.venue_id, 'assigned', 'media_request',
    p_request.id::text, format('assigned:media_request:%s:%s:%s',
      p_request.id, p_request.assignee_id, p_request.revision),
    jsonb_strip_nulls(jsonb_build_object('source', 'media_request', 'requestId', p_request.id,
      'requestType', p_request.request_type, 'subject', p_request.subject, 'brief', p_request.brief,
      'slotKind', p_request.slot_kind, 'slotId', p_request.slot_id,
      'neededBy', to_char(p_request.due_on, 'YYYY-MM-DD'))));
exception when others then
  raise warning 'media_request_notify failed: %', sqlerrm;
end;
$$;

-- Closes open requests whose rule is met (see the header). Idempotent;
-- serialised per venue so two readers never close the same request twice.
create function private.media_requests_settle(p_venue_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_at timestamptz;
  v_state text;
  v_reason text;
begin
  if p_venue_id is null or not exists (
    select 1 from public.media_requests m where m.venue_id = p_venue_id and m.closed_state is null
  ) then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_media_requests:' || p_venue_id::text, 0));

  for r in
    with slots as (select * from private.coverage_slot_rows(p_venue_id)),
    facts as (
      select f.check_id, f.verification from private.knowledge_fact_rows(p_venue_id) f
      where exists (
        select 1 from public.media_requests m
        where m.venue_id = p_venue_id and m.closed_state is null and m.fact_check_id = f.check_id)
    )
    select m.*, s.state as slot_state, s.covered_since as slot_covered_since,
      (s.slot_id is not null) as slot_listed, f.verification
    from public.media_requests m
    left join slots s on s.slot_kind = m.slot_kind and s.slot_id = m.slot_id
    left join facts f on f.check_id = m.fact_check_id
    where m.venue_id = p_venue_id and m.closed_state is null
    for update of m
  loop
    v_state := null;
    v_at := null;
    v_reason := null;
    if r.request_type = 'fact_confirmation' then
      if r.verification = 'confirmed' then
        select min(e.created_at) into v_at from public.knowledge_events e
        where e.venue_id = p_venue_id and e.check_id = r.fact_check_id
          and e.created_at >= r.created_at
          and (e.kind = 'decision_recorded'
            or (e.kind = 'fact_reconfirmed' and e.detail ->> 'checkedOn' is not null));
        if v_at is not null then
          v_state := 'completed';
        end if;
      end if;
    elsif r.slot_id is not null then
      if not r.slot_listed then
        v_state := 'cancelled';
        v_reason := 'No longer listed';
      elsif r.slot_state in ('not_here', 'inactive') then
        v_state := 'cancelled';
        v_reason := 'No longer needed';
      elsif r.request_type = 'missing_photo' and r.slot_state not in ('covered', 'check_due') then
        continue;
      elsif r.request_type = 'missing_photo' and r.photo_count = 1 then
        v_state := 'completed';
        v_at := coalesce(r.slot_covered_since, now());
      else
        v_at := private.media_request_fulfilled_at(p_venue_id, r.slot_kind, r.slot_id, r.created_at,
          r.request_type in ('missing_photo', 'replacement'), r.photo_count);
        if v_at is not null then
          v_state := 'completed';
        end if;
      end if;
    end if;

    if v_state is not null then
      update public.media_requests m
      set closed_state = v_state, closed_reason = v_reason, closed_by = null,
        closed_at = greatest(coalesce(v_at, now()), r.created_at),
        revision = m.revision + 1, updated_at = now()
      where m.id = r.id;
      insert into public.media_request_events (venue_id, request_id, kind, actor_id, reason, detail)
      values (p_venue_id, r.id, v_state, null, v_reason, jsonb_build_object('by', 'rule'));
      perform private.notification_resolve('assigned', 'media_request', r.id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Each request of a venue with its state (§7 M4). Internal: callers check
-- access first and settle before reading.
create function private.media_request_rows(p_venue_id uuid)
returns table (
  request public.media_requests,
  state text,
  slot_name text,
  slot_category text,
  slot_state text,
  slot_unavailable boolean,
  fact_key text,
  fact_verification text,
  submitted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with slots as (select * from private.coverage_slot_rows(p_venue_id)),
  facts as (
    select f.check_id, f.question_key, f.verification from private.knowledge_fact_rows(p_venue_id) f
    where exists (
      select 1 from public.media_requests m
      where m.venue_id = p_venue_id and m.fact_check_id = f.check_id)
  ),
  base as (
    select m, s.name as slot_name, s.category as slot_category, s.state as slot_state,
      coalesce(s.unavailable, false) as slot_unavailable,
      f.question_key, f.verification,
      case
        when m.fact_check_id is not null then exists (
          select 1 from public.knowledge_events e
          where e.venue_id = m.venue_id and e.check_id = m.fact_check_id
            and e.kind = 'contribution_recorded' and e.created_at >= m.created_at)
        else coalesce(s.pending_count, 0) > 0
      end as submitted
    from public.media_requests m
    left join slots s on s.slot_kind = m.slot_kind and s.slot_id = m.slot_id
    left join facts f on f.check_id = m.fact_check_id
    where m.venue_id = p_venue_id
  )
  select b.m,
    case
      when (b.m).closed_state is not null then (b.m).closed_state
      when (b.m).blocked_reason is not null or b.slot_unavailable then 'blocked'
      when b.submitted then 'submitted'
      else 'open'
    end,
    b.slot_name, b.slot_category, b.slot_state, b.slot_unavailable,
    b.question_key, b.verification, b.submitted
  from base b;
$$;

-- One request as the screens read it.
create function private.media_request_json(
  p_request public.media_requests, p_state text, p_slot_name text, p_slot_category text,
  p_slot_state text, p_slot_unavailable boolean, p_fact_key text, p_fact_verification text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_request.id,
    'venueId', p_request.venue_id,
    'type', p_request.request_type,
    'required', p_request.request_type in ('missing_photo', 'replacement', 'fact_confirmation'),
    'slot', case when p_request.slot_id is not null then jsonb_build_object(
      'kind', p_request.slot_kind, 'slotId', p_request.slot_id, 'name', p_slot_name,
      'category', p_slot_category, 'state', p_slot_state, 'unavailable', p_slot_unavailable) end,
    'fact', case when p_request.fact_check_id is not null then jsonb_build_object(
      'checkId', p_request.fact_check_id, 'key', p_fact_key, 'verification', p_fact_verification) end,
    'subject', p_request.subject,
    'brief', p_request.brief,
    'intendedUse', p_request.intended_use,
    'team', p_request.team,
    'photoCount', p_request.photo_count,
    'priority', p_request.priority,
    'assignee', case when p_request.assignee_id is not null then jsonb_build_object(
      'id', p_request.assignee_id,
      'name', (select p.display_name from public.profiles p where p.id = p_request.assignee_id)) end,
    'date', to_char(p_request.due_on, 'YYYY-MM-DD'),
    -- FA-5: a slot request's date is "needed by" and never overdue.
    'dateKind', case when p_request.due_on is null then null
      when p_request.slot_id is not null then 'needed_by' else 'due' end,
    'overdue', p_request.due_on is not null and p_request.slot_id is null
      and p_state not in ('completed', 'cancelled')
      and p_request.due_on < (now() at time zone private.venue_timezone(p_request.venue_id))::date,
    'referenceAssetId', p_request.reference_asset_id,
    'orientation', p_request.orientation,
    'wantsVideo', p_request.wants_video,
    'captureWindow', p_request.capture_window,
    'shotListId', p_request.shot_list_id,
    'state', p_state,
    'blockedReason', coalesce(p_request.blocked_reason,
      case when p_slot_unavailable and p_request.closed_state is null then 'Temporarily unavailable' end),
    'retake', p_request.closed_state is null and p_slot_state = 'replacement_needed',
    'closedReason', p_request.closed_reason,
    'closedAt', p_request.closed_at,
    'closedByRule', p_request.closed_state is not null and p_request.closed_by is null,
    'revision', p_request.revision,
    'createdAt', p_request.created_at,
    'createdBy', (select p.display_name from public.profiles p where p.id = p_request.created_by)
  );
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Every request and shot list at the venue, for its managers and admins
-- (an admin names the venue). Closed requests only when asked. Also the
-- people a request may name: active members of the venue.
create function public.media_requests(p_venue_id uuid default null, p_include_closed boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.media_request_manager_venue(p_venue_id);
begin
  perform private.media_requests_settle(v_venue);
  return jsonb_build_object(
    'venueId', v_venue,
    'today', to_char((now() at time zone private.venue_timezone(v_venue))::date, 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(private.media_request_json(r.request, r.state, r.slot_name, r.slot_category,
          r.slot_state, r.slot_unavailable, r.fact_key, r.fact_verification)
        order by case r.state when 'blocked' then 0 when 'open' then 1 when 'submitted' then 2
            when 'completed' then 3 else 4 end,
          case (r.request).priority when 'high' then 0 when 'normal' then 1 else 2 end,
          (r.request).due_on nulls last, (r.request).created_at desc)
      from private.media_request_rows(v_venue) r
      where coalesce(p_include_closed, false) or r.state not in ('completed', 'cancelled')
    ), '[]'::jsonb),
    'shotLists', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id, 'name', l.name, 'purpose', l.purpose, 'note', l.note,
          'date', to_char(l.due_on, 'YYYY-MM-DD'),
          'state', case when l.cancelled_at is not null then 'cancelled'
            when c.total > 0 and c.completed = c.total then 'completed' else 'open' end,
          'overdue', l.due_on is not null and l.cancelled_at is null and not (c.total > 0 and c.completed = c.total)
            and l.due_on < (now() at time zone private.venue_timezone(v_venue))::date,
          'total', c.total, 'completed', c.completed,
          'cancelReason', l.cancel_reason, 'revision', l.revision, 'createdAt', l.created_at)
        order by (l.cancelled_at is not null), l.due_on nulls last, l.created_at desc)
      from public.shot_lists l
      cross join lateral (
        select (count(*) filter (where m.closed_state is distinct from 'cancelled'))::integer as total,
          (count(*) filter (where m.closed_state = 'completed'))::integer as completed
        from public.media_requests m where m.shot_list_id = l.id
      ) c
      where l.venue_id = v_venue
        and (coalesce(p_include_closed, false) or (l.cancelled_at is null and not (c.total > 0 and c.completed = c.total)))
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name,
          'role', private.venue_role_of(p.id, v_venue), 'team', p.department)
        order by p.display_name, p.id)
      from public.profiles p
      where p.active and private.venue_role_of(p.id, v_venue) in ('staff', 'manager')
    ), '[]'::jsonb)
  );
end;
$$;

-- One request with its history, for its venue's managers and admins.
create function public.media_request_detail(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_out jsonb;
begin
  perform private.amenity_assert_active_user();
  select m.venue_id into v_venue from public.media_requests m where m.id = p_request_id;
  if v_venue is null or not private.can_manage_venue(v_venue) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform private.media_requests_settle(v_venue);
  select private.media_request_json(r.request, r.state, r.slot_name, r.slot_category,
      r.slot_state, r.slot_unavailable, r.fact_key, r.fact_verification)
  into v_out
  from private.media_request_rows(v_venue) r where (r.request).id = p_request_id;
  return v_out || jsonb_build_object('history', coalesce((
    select jsonb_agg(jsonb_build_object('kind', e.kind, 'reason', e.reason, 'detail', e.detail,
        'actor', (select p.display_name from public.profiles p where p.id = e.actor_id),
        'at', e.created_at) order by e.id)
    from public.media_request_events e where e.request_id = p_request_id
  ), '[]'::jsonb));
end;
$$;

-- Staff (and managers using Album) read the open media requests of their
-- venue as slots with the brief (§7 M4, AC01): never fact requests, never
-- closed ones. A reference image shows only when the caller may see it.
create function public.my_media_requests(p_venue_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
  v_uid uuid := auth.uid();
begin
  perform private.media_requests_settle(v_venue);
  return jsonb_build_object(
    'venueId', v_venue,
    'today', to_char((now() at time zone private.venue_timezone(v_venue))::date, 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', (r.request).id,
          'type', (r.request).request_type,
          'slot', case when (r.request).slot_id is not null then jsonb_build_object(
            'kind', (r.request).slot_kind, 'slotId', (r.request).slot_id, 'name', r.slot_name,
            'category', r.slot_category, 'state', r.slot_state) end,
          'subject', (r.request).subject,
          'brief', (r.request).brief,
          'photoCount', (r.request).photo_count,
          'neededBy', to_char((r.request).due_on, 'YYYY-MM-DD'),
          'orientation', (r.request).orientation,
          'wantsVideo', (r.request).wants_video,
          'captureWindow', (r.request).capture_window,
          'referenceAssetId', case when (r.request).reference_asset_id is not null
            and private.media_visible_to_caller((r.request).reference_asset_id)
            then (r.request).reference_asset_id end,
          'forMe', coalesce((r.request).assignee_id = v_uid, false),
          'state', r.state,
          'priority', (r.request).priority)
        order by coalesce((r.request).assignee_id = v_uid, false) desc,
          case (r.request).priority when 'high' then 0 when 'normal' then 1 else 2 end,
          (r.request).due_on nulls last, (r.request).created_at)
      from private.media_request_rows(v_venue) r
      where (r.request).request_type <> 'fact_confirmation'
        and r.state in ('open', 'submitted')
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Checks the optional fields shared by create and edit. Raises on bad input.
create function private.media_request_check_fields(
  p_venue_id uuid, p_assignee_id uuid, p_due_on date, p_reference_asset_id uuid,
  p_shot_list_id uuid, p_is_fact boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone private.venue_timezone(p_venue_id))::date;
  v_role text;
begin
  if p_assignee_id is not null then
    v_role := private.venue_role_of(p_assignee_id, p_venue_id);
    if v_role is null then
      raise exception 'invalid_assignee' using errcode = '22023';
    end if;
    -- A fact is confirmed by someone with verification permission (§7 M4).
    if p_is_fact and v_role not in ('manager', 'admin') then
      raise exception 'assignee_cannot_verify' using errcode = '22023';
    end if;
  end if;
  if p_due_on is not null and (p_due_on < v_today or p_due_on > v_today + 366) then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  if p_reference_asset_id is not null and not exists (
    select 1 from public.media_assets a
    where a.id = p_reference_asset_id and a.venue_id = p_venue_id
      and a.deleted_at is null and a.upload_state = 'ready'
      and private.asset_is_accepted(a.id)
  ) then
    raise exception 'invalid_reference' using errcode = '22023';
  end if;
  if p_shot_list_id is not null and not exists (
    select 1 from public.shot_lists l
    where l.id = p_shot_list_id and l.venue_id = p_venue_id and l.cancelled_at is null
  ) then
    raise exception 'invalid_shot_list' using errcode = '22023';
  end if;
end;
$$;

create function private.media_request_one_line(p_value text, p_max integer, p_code text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := private.clean_text(p_value, p_max, p_code);
begin
  if v_text is not null and v_text ~ '[[:cntrl:]]' then
    raise exception '%', p_code using errcode = '22023';
  end if;
  return v_text;
end;
$$;

-- Creates a request (§7 M4). From a requirement: name the slot (kind and
-- id as coverage_slots gives them); the subject is the slot's name. A New
-- brief: no slot, a typed subject. A fact confirmation: the amenity check;
-- the person named (default the caller) must be a manager or admin there.
create function public.media_request_create(
  p_type text,
  p_venue_id uuid default null,
  p_brief text default null,
  p_intended_use text default null,
  p_slot_kind text default null,
  p_slot_id uuid default null,
  p_fact_check_id uuid default null,
  p_subject text default null,
  p_team text default null,
  p_photo_count integer default 1,
  p_priority text default 'normal',
  p_assignee_id uuid default null,
  p_due_on date default null,
  p_reference_asset_id uuid default null,
  p_orientation text default null,
  p_wants_video boolean default false,
  p_capture_window text default null,
  p_shot_list_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid := private.media_request_manager_venue(p_venue_id);
  v_slot record;
  v_fact record;
  v_subject text;
  v_brief text;
  v_use text := p_intended_use;
  v_team text := p_team;
  v_assignee uuid := p_assignee_id;
  v_row public.media_requests;
begin
  perform private.amenity_assert_venue_active(v_venue);
  if p_type is null or p_type not in ('missing_photo', 'replacement', 'optional_angle', 'fact_confirmation', 'campaign') then
    raise exception 'invalid_type' using errcode = '22023';
  end if;
  v_brief := private.media_request_one_line(p_brief, 140, 'invalid_brief');
  v_subject := private.media_request_one_line(p_subject, 120, 'invalid_subject');
  if (p_slot_kind is null) <> (p_slot_id is null)
     or (p_slot_kind is not null and p_slot_kind not in ('dish', 'area', 'amenity')) then
    raise exception 'invalid_slot' using errcode = '22023';
  end if;
  if p_orientation is not null and p_orientation not in ('portrait', 'landscape', 'square') then
    raise exception 'invalid_orientation' using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  if p_photo_count is null or p_photo_count not between 1 and 20 then
    raise exception 'invalid_photo_count' using errcode = '22023';
  end if;
  if v_team is not null and v_team not in ('foh', 'boh', 'any') then
    raise exception 'invalid_team' using errcode = '22023';
  end if;

  perform private.media_requests_settle(v_venue);

  if p_type = 'fact_confirmation' then
    if p_slot_id is not null or p_fact_check_id is null then
      raise exception 'invalid_slot' using errcode = '22023';
    end if;
    select c.id, t.question into v_fact
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    where c.id = p_fact_check_id and c.venue_id = v_venue and c.status = 'active';
    if not found then
      raise exception 'unknown_fact' using errcode = '22023';
    end if;
    v_subject := left(v_fact.question, 120);
    v_brief := coalesce(v_brief, 'Confirm the answer is still right.');
    v_use := coalesce(v_use, 'internal');
    v_assignee := coalesce(v_assignee, v_uid);
  else
    if p_fact_check_id is not null then
      raise exception 'invalid_slot' using errcode = '22023';
    end if;
    if v_brief is null then
      raise exception 'brief_required' using errcode = '22023';
    end if;
    if p_slot_id is not null then
      select s.* into v_slot from private.coverage_slot_rows(v_venue) s
      where s.slot_kind = p_slot_kind and s.slot_id = p_slot_id;
      if not found then
        raise exception 'unknown_slot' using errcode = '22023';
      end if;
      if v_slot.state in ('not_here', 'inactive') then
        raise exception 'slot_not_needed' using errcode = '22023';
      end if;
      if p_type = 'missing_photo' and v_slot.state in ('covered', 'check_due') then
        raise exception 'slot_already_covered' using errcode = '22023';
      end if;
      if p_type = 'replacement' and v_slot.state = 'missing' then
        raise exception 'slot_has_no_photo' using errcode = '22023';
      end if;
      v_subject := left(v_slot.name, 120);
      v_team := coalesce(v_team, private.media_request_default_team(v_slot.category));
    else
      if p_type = 'replacement' then
        raise exception 'invalid_slot' using errcode = '22023';
      end if;
      if v_subject is null then
        raise exception 'subject_required' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_use is null then
    raise exception 'intended_use_required' using errcode = '22023';
  end if;
  if v_use not in ('public', 'social', 'reference', 'internal') then
    raise exception 'invalid_intended_use' using errcode = '22023';
  end if;
  perform private.media_request_check_fields(v_venue, v_assignee, p_due_on, p_reference_asset_id,
    p_shot_list_id, p_type = 'fact_confirmation');

  begin
    insert into public.media_requests (venue_id, request_type, slot_kind, slot_id, fact_check_id,
      subject, brief, intended_use, team, photo_count, priority, assignee_id, due_on,
      reference_asset_id, orientation, wants_video, capture_window, shot_list_id, created_by)
    values (v_venue, p_type, p_slot_kind, p_slot_id, p_fact_check_id,
      v_subject, v_brief, v_use, coalesce(v_team, 'any'),
      case when p_type = 'fact_confirmation' then 1 else p_photo_count end,
      p_priority, v_assignee, p_due_on, p_reference_asset_id, p_orientation,
      coalesce(p_wants_video, false) and p_type <> 'fact_confirmation',
      private.media_request_one_line(p_capture_window, 80, 'invalid_capture_window'),
      p_shot_list_id, v_uid)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'request_exists' using errcode = '23505',
      detail = jsonb_build_object('requestId', (
        select m.id from public.media_requests m
        where m.venue_id = v_venue and m.closed_state is null
          and ((p_fact_check_id is not null and m.fact_check_id = p_fact_check_id)
            or (p_slot_id is not null and m.slot_kind = p_slot_kind and m.slot_id = p_slot_id
              and m.request_type in ('missing_photo', 'replacement')))
        limit 1))::text;
  end;

  perform private.media_request_event(v_venue, v_row.id, v_row.shot_list_id, 'created', null,
    jsonb_strip_nulls(jsonb_build_object('type', v_row.request_type, 'assigneeId', v_row.assignee_id)));
  perform private.record_activity(v_venue, 'media_request_created', 'media_request', v_row.id::text,
    null, v_row.revision, null, null,
    jsonb_strip_nulls(jsonb_build_object('type', v_row.request_type, 'subject', v_row.subject)));
  perform private.media_request_notify(v_row);

  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision);
end;
$$;

-- Locks one open request for a write by its venue's manager or an admin,
-- checking the expected revision (stale writes are refused).
create function private.media_request_for_write(p_request_id uuid, p_revision integer)
returns public.media_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.media_requests;
begin
  perform private.amenity_assert_active_user();
  select m.* into v_row from public.media_requests m where m.id = p_request_id;
  if not found or not private.can_manage_venue(v_row.venue_id) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform private.amenity_assert_venue_active(v_row.venue_id);
  perform private.media_requests_settle(v_row.venue_id);
  select m.* into v_row from public.media_requests m where m.id = p_request_id for update;
  if p_revision is distinct from v_row.revision then
    raise exception 'request_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_row.revision)::text;
  end if;
  if v_row.closed_state is not null then
    raise exception 'request_closed' using errcode = 'P0001',
      detail = jsonb_build_object('state', v_row.closed_state)::text;
  end if;
  return v_row;
end;
$$;

-- Changes an open request's fields. p_patch keys (any of): brief, intendedUse,
-- team, photoCount, priority, assigneeId, date, referenceAssetId,
-- orientation, wantsVideo, captureWindow, shotListId. A key with null clears
-- an optional field. The slot, fact and type never change.
create function public.media_request_edit(p_request_id uuid, p_revision integer, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.media_requests := private.media_request_for_write(p_request_id, p_revision);
  v_new public.media_requests := v_old;
  v_is_fact boolean := v_old.request_type = 'fact_confirmation';
  v_key text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('brief', 'intendedUse', 'team', 'photoCount', 'priority', 'assigneeId', 'date',
        'referenceAssetId', 'orientation', 'wantsVideo', 'captureWindow', 'shotListId') then
      raise exception 'invalid_patch' using errcode = '22023';
    end if;
  end loop;

  if p_patch ? 'brief' then
    v_new.brief := private.media_request_one_line(p_patch ->> 'brief', 140, 'invalid_brief');
    if v_new.brief is null then
      raise exception 'brief_required' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'intendedUse' then
    v_new.intended_use := p_patch ->> 'intendedUse';
    if v_new.intended_use is null or v_new.intended_use not in ('public', 'social', 'reference', 'internal') then
      raise exception 'invalid_intended_use' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'team' then
    v_new.team := coalesce(p_patch ->> 'team', 'any');
    if v_new.team not in ('foh', 'boh', 'any') then
      raise exception 'invalid_team' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'photoCount' and not v_is_fact then
    if jsonb_typeof(p_patch -> 'photoCount') <> 'number'
       or (p_patch ->> 'photoCount')::numeric not between 1 and 20
       or (p_patch ->> 'photoCount')::numeric <> trunc((p_patch ->> 'photoCount')::numeric) then
      raise exception 'invalid_photo_count' using errcode = '22023';
    end if;
    v_new.photo_count := (p_patch ->> 'photoCount')::integer;
  end if;
  if p_patch ? 'priority' then
    v_new.priority := p_patch ->> 'priority';
    if v_new.priority is null or v_new.priority not in ('low', 'normal', 'high') then
      raise exception 'invalid_priority' using errcode = '22023';
    end if;
  end if;
  begin
    if p_patch ? 'assigneeId' then
      v_new.assignee_id := (p_patch ->> 'assigneeId')::uuid;
    end if;
    if p_patch ? 'date' then
      v_new.due_on := (p_patch ->> 'date')::date;
    end if;
    if p_patch ? 'referenceAssetId' then
      v_new.reference_asset_id := (p_patch ->> 'referenceAssetId')::uuid;
    end if;
    if p_patch ? 'shotListId' then
      v_new.shot_list_id := (p_patch ->> 'shotListId')::uuid;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'invalid_patch' using errcode = '22023';
  end;
  if v_is_fact and v_new.assignee_id is null then
    raise exception 'assignee_cannot_verify' using errcode = '22023';
  end if;
  if p_patch ? 'orientation' then
    v_new.orientation := p_patch ->> 'orientation';
    if v_new.orientation is not null and v_new.orientation not in ('portrait', 'landscape', 'square') then
      raise exception 'invalid_orientation' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'wantsVideo' and not v_is_fact then
    if jsonb_typeof(p_patch -> 'wantsVideo') <> 'boolean' then
      raise exception 'invalid_patch' using errcode = '22023';
    end if;
    v_new.wants_video := (p_patch ->> 'wantsVideo')::boolean;
  end if;
  if p_patch ? 'captureWindow' then
    v_new.capture_window := private.media_request_one_line(p_patch ->> 'captureWindow', 80, 'invalid_capture_window');
  end if;

  -- Only changed fields are checked again, so an earlier date stays allowed.
  perform private.media_request_check_fields(v_old.venue_id,
    case when v_new.assignee_id is distinct from v_old.assignee_id then v_new.assignee_id end,
    case when v_new.due_on is distinct from v_old.due_on then v_new.due_on end,
    case when v_new.reference_asset_id is distinct from v_old.reference_asset_id then v_new.reference_asset_id end,
    case when v_new.shot_list_id is distinct from v_old.shot_list_id then v_new.shot_list_id end,
    v_is_fact);

  if v_new is not distinct from v_old then
    return jsonb_build_object('id', v_old.id, 'revision', v_old.revision, 'changed', false);
  end if;

  update public.media_requests m
  set brief = v_new.brief, intended_use = v_new.intended_use, team = v_new.team,
    photo_count = v_new.photo_count, priority = v_new.priority, assignee_id = v_new.assignee_id,
    due_on = v_new.due_on, reference_asset_id = v_new.reference_asset_id,
    orientation = v_new.orientation, wants_video = v_new.wants_video,
    capture_window = v_new.capture_window, shot_list_id = v_new.shot_list_id,
    revision = m.revision + 1, updated_at = now()
  where m.id = v_old.id
  returning * into v_new;

  perform private.media_request_event(v_old.venue_id, v_old.id, v_new.shot_list_id, 'edited', null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
      from jsonb_object_keys(p_patch) k)));
  if v_new.assignee_id is distinct from v_old.assignee_id then
    if v_old.assignee_id is not null then
      perform private.notification_resolve('assigned', 'media_request', v_old.id::text, v_old.assignee_id);
    end if;
    perform private.media_request_notify(v_new);
  end if;
  return jsonb_build_object('id', v_new.id, 'revision', v_new.revision, 'changed', true);
end;
$$;

-- Blocks an open request with a reason (Blocked), or unblocks it with null.
create function public.media_request_set_blocked(p_request_id uuid, p_revision integer, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.media_requests := private.media_request_for_write(p_request_id, p_revision);
  v_reason text := private.media_request_one_line(p_reason, 500, 'invalid_reason');
begin
  if v_reason is not distinct from v_row.blocked_reason then
    return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'changed', false);
  end if;
  update public.media_requests m
  set blocked_reason = v_reason, revision = m.revision + 1, updated_at = now()
  where m.id = v_row.id
  returning * into v_row;
  perform private.media_request_event(v_row.venue_id, v_row.id, v_row.shot_list_id,
    case when v_reason is null then 'unblocked' else 'blocked' end, v_reason);
  perform private.record_activity(v_row.venue_id,
    case when v_reason is null then 'media_request_unblocked' else 'media_request_blocked' end,
    'media_request', v_row.id::text, v_row.revision - 1, v_row.revision, v_reason, null, null);
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'changed', true);
end;
$$;

-- Closes an open request: Cancelled with a reason (a manager's archive of a
-- task, S3.3), or Completed by hand for a request with no slot. A request
-- on a slot or a fact completes only through its rule (§7 M4): approved
-- content, or a confirmed fact revision.
create function public.media_request_close(
  p_request_id uuid, p_revision integer, p_state text, p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.media_requests := private.media_request_for_write(p_request_id, p_revision);
  v_reason text := private.media_request_one_line(p_reason, 500, 'invalid_reason');
begin
  if p_state is null or p_state not in ('completed', 'cancelled') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if p_state = 'cancelled' and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_state = 'completed' and (v_row.slot_id is not null or v_row.fact_check_id is not null) then
    raise exception 'completes_automatically' using errcode = 'P0001';
  end if;
  update public.media_requests m
  set closed_state = p_state, closed_reason = v_reason, closed_by = auth.uid(), closed_at = now(),
    revision = m.revision + 1, updated_at = now()
  where m.id = v_row.id
  returning * into v_row;
  perform private.media_request_event(v_row.venue_id, v_row.id, v_row.shot_list_id, p_state, v_reason);
  perform private.record_activity(v_row.venue_id, 'media_request_' || p_state, 'media_request',
    v_row.id::text, v_row.revision - 1, v_row.revision, v_reason, null, null);
  perform private.notification_resolve('assigned', 'media_request', v_row.id::text);
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'state', p_state);
end;
$$;

-- Creates a shot list for a menu launch, a quiet period or a campaign. It
-- may carry a real due date (FA-5).
create function public.shot_list_create(
  p_name text, p_purpose text, p_venue_id uuid default null, p_due_on date default null, p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.media_request_manager_venue(p_venue_id);
  v_name text := private.media_request_one_line(p_name, 80, 'invalid_name');
  v_note text := private.clean_text(p_note, 280, 'invalid_note');
  v_row public.shot_lists;
begin
  perform private.amenity_assert_venue_active(v_venue);
  if v_name is null then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('menu_launch', 'quiet_period', 'campaign') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  perform private.media_request_check_fields(v_venue, null, p_due_on, null, null, false);
  insert into public.shot_lists (venue_id, name, purpose, due_on, note, created_by)
  values (v_venue, v_name, p_purpose, p_due_on, v_note, auth.uid())
  returning * into v_row;
  perform private.media_request_event(v_venue, null, v_row.id, 'list_created', null,
    jsonb_build_object('purpose', p_purpose));
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision);
end;
$$;

-- Cancels a shot list with a reason; its open requests are cancelled with
-- the same reason.
create function public.shot_list_cancel(p_shot_list_id uuid, p_revision integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.shot_lists;
  v_reason text := private.media_request_one_line(p_reason, 500, 'invalid_reason');
  v_req record;
  v_count integer := 0;
begin
  perform private.amenity_assert_active_user();
  select l.* into v_row from public.shot_lists l where l.id = p_shot_list_id;
  if not found or not private.can_manage_venue(v_row.venue_id) then
    raise exception 'shot_list_not_found' using errcode = 'P0002';
  end if;
  perform private.amenity_assert_venue_active(v_row.venue_id);
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  perform private.media_requests_settle(v_row.venue_id);
  select l.* into v_row from public.shot_lists l where l.id = p_shot_list_id for update;
  if p_revision is distinct from v_row.revision then
    raise exception 'request_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_row.revision)::text;
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  update public.shot_lists l
  set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason,
    revision = l.revision + 1, updated_at = now()
  where l.id = v_row.id
  returning * into v_row;
  for v_req in
    select m.id from public.media_requests m
    where m.shot_list_id = v_row.id and m.closed_state is null
    for update
  loop
    update public.media_requests m
    set closed_state = 'cancelled', closed_reason = v_reason, closed_by = auth.uid(), closed_at = now(),
      revision = m.revision + 1, updated_at = now()
    where m.id = v_req.id;
    perform private.media_request_event(v_row.venue_id, v_req.id, v_row.id, 'cancelled', v_reason,
      jsonb_build_object('by', 'shot_list'));
    perform private.notification_resolve('assigned', 'media_request', v_req.id::text);
    v_count := v_count + 1;
  end loop;
  perform private.media_request_event(v_row.venue_id, null, v_row.id, 'list_cancelled', v_reason,
    jsonb_build_object('requestsCancelled', v_count));
  perform private.record_activity(v_row.venue_id, 'shot_list_cancelled', 'shot_list', v_row.id::text,
    v_row.revision - 1, v_row.revision, v_reason, null, jsonb_build_object('requestsCancelled', v_count));
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'requestsCancelled', v_count);
end;
$$;

-- Both membership removal and a standalone handover call this function.
-- The replacement is ordinary staff, so fact confirmations still require
-- a manager or admin. Settle satisfied requests before moving open work.
create or replace function private.membership_reassign_work(
  p_from uuid, p_to uuid, p_venue uuid, p_actor uuid, p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_counts jsonb := private.membership_reassign_checks(p_from, p_to, p_venue, p_actor, p_reason);
  v_request public.media_requests;
  v_moved integer := 0;
begin
  perform private.media_requests_settle(p_venue);
  for v_request in
    update public.media_requests m
    set assignee_id = p_to, revision = m.revision + 1, updated_at = now()
    where m.venue_id = p_venue and m.assignee_id = p_from
      and m.closed_state is null and m.request_type <> 'fact_confirmation'
    returning m.*
  loop
    perform private.media_request_event(p_venue, v_request.id, v_request.shot_list_id, 'edited', p_reason,
      jsonb_build_object('fields', jsonb_build_array('assigneeId'),
        'previousAssigneeId', p_from, 'assigneeId', p_to));
    perform private.notification_resolve('assigned', 'media_request', v_request.id::text, p_from);
    perform private.media_request_notify(v_request);
    v_moved := v_moved + 1;
  end loop;
  return v_counts || jsonb_build_object('mediaRequests', v_moved);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.media_request_manager_venue(uuid) from public, anon, authenticated;
revoke all on function private.media_request_fulfilled_at(uuid, text, uuid, timestamptz, boolean, integer) from public, anon, authenticated;
revoke all on function private.media_request_default_team(text) from public, anon, authenticated;
revoke all on function private.media_request_event(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.media_request_notify(public.media_requests) from public, anon, authenticated;
revoke all on function private.media_requests_settle(uuid) from public, anon, authenticated;
revoke all on function private.media_request_rows(uuid) from public, anon, authenticated;
revoke all on function private.media_request_json(public.media_requests, text, text, text, text, boolean, text, text)
  from public, anon, authenticated;
revoke all on function private.media_request_check_fields(uuid, uuid, date, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.media_request_one_line(text, integer, text) from public, anon, authenticated;
revoke all on function private.media_request_for_write(uuid, integer) from public, anon, authenticated;

revoke all on function public.media_requests(uuid, boolean) from public, anon, service_role;
revoke all on function public.media_request_detail(uuid) from public, anon, service_role;
revoke all on function public.my_media_requests(uuid) from public, anon, service_role;
revoke all on function public.media_request_create(text, uuid, text, text, text, uuid, uuid, text, text, integer,
  text, uuid, date, uuid, text, boolean, text, uuid) from public, anon, service_role;
revoke all on function public.media_request_edit(uuid, integer, jsonb) from public, anon, service_role;
revoke all on function public.media_request_set_blocked(uuid, integer, text) from public, anon, service_role;
revoke all on function public.media_request_close(uuid, integer, text, text) from public, anon, service_role;
revoke all on function public.shot_list_create(text, text, uuid, date, text) from public, anon, service_role;
revoke all on function public.shot_list_cancel(uuid, integer, text) from public, anon, service_role;

grant execute on function public.media_requests(uuid, boolean) to authenticated;
grant execute on function public.media_request_detail(uuid) to authenticated;
grant execute on function public.my_media_requests(uuid) to authenticated;
grant execute on function public.media_request_create(text, uuid, text, text, text, uuid, uuid, text, text, integer,
  text, uuid, date, uuid, text, boolean, text, uuid) to authenticated;
grant execute on function public.media_request_edit(uuid, integer, jsonb) to authenticated;
grant execute on function public.media_request_set_blocked(uuid, integer, text) to authenticated;
grant execute on function public.media_request_close(uuid, integer, text, text) to authenticated;
grant execute on function public.shot_list_create(text, text, uuid, date, text) to authenticated;
grant execute on function public.shot_list_cancel(uuid, integer, text) to authenticated;
