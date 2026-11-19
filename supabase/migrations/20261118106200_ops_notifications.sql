-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-OPS: in-app notifications (spec §17, §11; FA-10, FA-43;
-- checklist S17-inapp-staff, S17-dedupe, S17-quiet-hours, S17-toast-conflict,
-- S11-audit-notification-job).
--
--   notifications   one row per notice to one person. Shown as an inbox list
--                   and badges, never toasts (FA-10, DESIGN.md §9). Push and
--                   email are Release 2 (FA-43); the attempts and
--                   deliver_after columns are what an out-of-app sender will
--                   use, so it waits out quiet hours (21:00-08:00 in the
--                   venue's timezone by default, or the person's own).
--   Kinds           retake_requested  a manager asked the uploader for
--                                     another photo (menu, checklist, area)
--                   assigned          a check was assigned to the person
--                   upload_problem    the person's upload failed, or its
--                                     labels could not be applied
--                   review_digest     manager: work waiting at the venue
--                                     (written by the notification job)
--                   exception         admin: setup gaps, sustained backlog,
--                                     processing/export/storage failures
--                                     (written by the notification job)
--   No repeats      dedupe_key is unique per person, and a new notice is not
--                   written while the same person still has an unread,
--                   unresolved notice of the same kind about the same thing.
--   Resolution      a notice whose problem has gone (the failed upload is
--                   ready or removed, the labels applied) is resolved: it
--                   leaves the unread count but stays in the list.
--   Preferences     notification_preferences (20261118106100) turns kinds
--                   off per person; exceptions cannot be turned off.
--
-- Writers are the triggers below and private.notify (for Sprint 2 requests
-- and the job in 20261118106300). Readers: my_notifications,
-- my_notification_count; mark_notifications_read.
--
-- Rollback: roll back the app first, then revoke execute on the three public
-- functions and drop the six triggers. The table stays.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete restrict,
  kind text not null check (kind in (
    'retake_requested', 'assigned', 'upload_problem', 'review_digest', 'exception')),
  subject_type text not null check (subject_type ~ '^[a-z][a-z_]{0,39}$'),
  subject_id text check (subject_id is null or length(subject_id) between 1 and 120),
  dedupe_key text not null check (length(dedupe_key) between 1 and 300),
  -- Words and counts for the screen. Never location, file names or photo
  -- content (§18.3).
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  created_at timestamptz not null default now(),
  -- Quiet hours: when an out-of-app sender (R2) may send it.
  deliver_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  read_at timestamptz,
  resolved_at timestamptz,
  version integer not null default 1 check (version >= 1),
  constraint notifications_dedupe unique (recipient_id, dedupe_key)
);

create index notifications_recipient_idx on public.notifications (recipient_id, id desc);
create index notifications_open_idx on public.notifications (recipient_id, kind, subject_type, subject_id)
  where read_at is null and resolved_at is null;
create index notifications_subject_idx on public.notifications (subject_type, subject_id)
  where resolved_at is null;

comment on table public.notifications is
  'S1-OPS: in-app notices (§17). Unique dedupe_key per recipient; written by triggers and private.notify only.';

alter table public.notifications enable row level security;
revoke all on table public.notifications from public, anon, authenticated, service_role;
grant select on table public.notifications to service_role;

-- ---------------------------------------------------------------------------
-- Quiet hours
-- ---------------------------------------------------------------------------

-- True when p_at falls inside [p_start, p_end) in p_tz. A window that crosses
-- midnight (21:00-08:00) wraps; equal start and end means no quiet hours.
create function private.in_quiet_hours(p_at timestamptz, p_tz text, p_start time, p_end time)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start is null or p_end is null or p_start = p_end then false
    when p_start < p_end then (p_at at time zone p_tz)::time >= p_start
      and (p_at at time zone p_tz)::time < p_end
    else (p_at at time zone p_tz)::time >= p_start
      or (p_at at time zone p_tz)::time < p_end
  end;
$$;

-- The first moment at or after p_at outside the person's quiet hours (their
-- own, else the organisation's), in the venue's timezone (the notice's venue,
-- else the person's).
create function private.notification_deliver_after(p_recipient uuid, p_venue_id uuid, p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start time;
  v_end time;
  v_tz text;
  v_local timestamp;
  v_end_local timestamp;
begin
  select coalesce(np.quiet_start, s.quiet_start), coalesce(np.quiet_end, s.quiet_end),
    private.venue_timezone(coalesce(p_venue_id, p.venue_id))
  into v_start, v_end, v_tz
  from public.ops_settings s
  left join public.profiles p on p.id = p_recipient
  left join public.notification_preferences np on np.profile_id = p_recipient
  where s.id;
  v_tz := coalesce(v_tz, 'Europe/London');
  if not private.in_quiet_hours(p_at, v_tz, v_start, v_end) then
    return p_at;
  end if;
  v_local := p_at at time zone v_tz;
  v_end_local := v_local::date + v_end;
  if v_end_local <= v_local then
    v_end_local := v_end_local + interval '1 day';
  end if;
  return v_end_local at time zone v_tz;
end;
$$;

revoke all on function private.in_quiet_hours(timestamptz, text, time, time) from public, anon, authenticated;
revoke all on function private.notification_deliver_after(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writer
-- ---------------------------------------------------------------------------

-- Writes one notice, or nothing (returns null) when: the person is inactive
-- or unknown; they turned the kind off; the same dedupe key exists; they
-- still have an unread, unresolved notice of this kind about this subject; or
-- the insert fails (a warning is logged; the caller's change still commits).
-- For triggers and security definer functions only.
create function private.notify(
  p_recipient uuid,
  p_venue_id uuid,
  p_kind text,
  p_subject_type text,
  p_subject_id text,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb,
  p_at timestamptz default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_on boolean;
  v_id bigint;
begin
  if p_recipient is null or not exists (
    select 1 from public.profiles p where p.id = p_recipient and p.active
  ) then
    return null;
  end if;
  select case p_kind
      when 'retake_requested' then coalesce(np.retakes, true)
      when 'assigned' then coalesce(np.assignments, true)
      when 'upload_problem' then coalesce(np.upload_problems, true)
      when 'review_digest' then coalesce(np.digests, true)
      else true end
  into v_on
  from (select 1) one
  left join public.notification_preferences np on np.profile_id = p_recipient;
  if not v_on then
    return null;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.recipient_id = p_recipient and n.kind = p_kind
      and n.subject_type = p_subject_type and n.subject_id is not distinct from p_subject_id
      and n.read_at is null and n.resolved_at is null
  ) then
    return null;
  end if;
  -- A notice must never block the decision that caused it: a failure here is
  -- logged as a warning and the caller's transaction goes on.
  begin
    insert into public.notifications (
      recipient_id, venue_id, kind, subject_type, subject_id, dedupe_key, payload,
      created_at, deliver_after)
    values (
      p_recipient, p_venue_id, p_kind, p_subject_type, p_subject_id, p_dedupe_key,
      coalesce(p_payload, '{}'::jsonb), v_at,
      private.notification_deliver_after(p_recipient, p_venue_id, v_at))
    on conflict (recipient_id, dedupe_key) do nothing
    returning id into v_id;
  exception when others then
    raise warning 'notify_failed: % (%)', sqlerrm, sqlstate;
    return null;
  end;
  return v_id;
end;
$$;

-- Resolves the open notices of one kind about one subject (every recipient,
-- or one).
create function private.notification_resolve(
  p_kind text, p_subject_type text, p_subject_id text, p_recipient uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications n
  set resolved_at = now(), version = n.version + 1
  where n.kind = p_kind and n.subject_type = p_subject_type and n.subject_id = p_subject_id
    and n.resolved_at is null
    and (p_recipient is null or n.recipient_id = p_recipient);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.notify(uuid, uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function private.notification_resolve(text, text, text, uuid) from public, anon, authenticated;
grant execute on function private.notify(uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function private.notification_resolve(text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Triggers on committed decisions
-- ---------------------------------------------------------------------------

-- Menu photo: "better photo requested" (the spec's Ask for another photo).
create function private.notify_on_menu_photo_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'better_photo_requested' and new.actor_id is distinct from new.author_id then
    perform private.notify(new.author_id, new.venue_id, 'retake_requested', 'menu_item',
      new.item_id::text, format('retake:menu_photo:%s:%s', new.photo_id, new.revision),
      jsonb_strip_nulls(jsonb_build_object('source', 'menu_photo', 'itemId', new.item_id,
        'photoId', new.photo_id, 'reason', new.reason,
        'itemName', (select e.name from private.current_photo_menu_items(new.venue_id) e
          where e.item_id = new.item_id))),
      new.created_at);
  end if;
  return null;
end;
$$;

create trigger menu_item_photo_events_notify
  after insert on public.menu_item_photo_events
  for each row execute function private.notify_on_menu_photo_event();

-- Checklist photo: needs another photo.
create function private.notify_on_coverage_review_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'needs_another_photo' and new.actor_id is distinct from new.author_id then
    perform private.notify(new.author_id, new.venue_id, 'retake_requested', 'checklist_item',
      new.item_id::text, format('retake:coverage:%s:%s', new.item_id, new.revision),
      jsonb_strip_nulls(jsonb_build_object('source', 'checklist', 'itemId', new.item_id,
        'requirementId', new.requirement_id, 'reason', new.reason)),
      new.created_at);
  end if;
  return null;
end;
$$;

create trigger coverage_review_events_notify
  after insert on public.coverage_review_events
  for each row execute function private.notify_on_coverage_review_event();

-- Area photo: needs another photo.
create function private.notify_on_area_photo_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploader uuid;
  v_subject uuid;
  v_label text;
begin
  if new.action = 'needs_another_photo' then
    select a.uploader_id into v_uploader from public.media_assets a where a.id = new.asset_id;
    select l.subject_id, l.subject_label into v_subject, v_label
    from public.media_area_labels l where l.id = new.label_id;
    if v_uploader is distinct from new.decided_by then
      perform private.notify(v_uploader, new.venue_id, 'retake_requested', 'area',
        v_subject::text, format('retake:area:%s', new.id),
        jsonb_strip_nulls(jsonb_build_object('source', 'area', 'subjectId', v_subject,
          'placeName', v_label, 'reason', new.reason)),
        new.decided_at);
    end if;
  end if;
  return null;
end;
$$;

create trigger area_photo_decisions_notify
  after insert on public.area_photo_decisions
  for each row execute function private.notify_on_area_photo_decision();

-- Direct assignment of a venue check.
create function private.notify_on_amenity_check_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
begin
  if new.kind = 'assigned' then
    begin
      v_assignee := (new.detail ->> 'assigneeId')::uuid;
    exception when others then
      v_assignee := null;
    end;
    if v_assignee is not null and v_assignee is distinct from new.actor_id then
      perform private.notify(v_assignee, new.venue_id, 'assigned', 'amenity_check',
        new.check_id::text, format('assigned:amenity:%s', new.id),
        jsonb_strip_nulls(jsonb_build_object('checkId', new.check_id,
          'question', (select c.template_key from public.venue_amenity_checks c where c.id = new.check_id))),
        new.created_at);
    end if;
  end if;
  return null;
end;
$$;

create trigger amenity_check_events_notify
  after insert on public.amenity_check_events
  for each row execute function private.notify_on_amenity_check_event();

-- Upload needing intervention: the upload failed. Resolved when the asset
-- becomes ready (a retry worked) or is removed.
create function private.notify_on_media_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null and new.upload_state = 'failed'
      and old.upload_state is distinct from 'failed' then
    perform private.notify(new.uploader_id, new.venue_id, 'upload_problem', 'media_asset',
      new.id::text, format('upload_failed:%s:%s', new.id, extract(epoch from new.updated_at)),
      jsonb_build_object('problem', 'upload_failed', 'mediaType', new.media_type));
  elsif (new.upload_state = 'ready' and old.upload_state is distinct from 'ready')
      or (new.deleted_at is not null and old.deleted_at is null) then
    perform private.notification_resolve('upload_problem', 'media_asset', new.id::text);
  end if;
  return null;
end;
$$;

create trigger media_assets_notify
  after update of upload_state, deleted_at on public.media_assets
  for each row execute function private.notify_on_media_state();

-- Labels saved on the phone that could not be applied (needs_attention).
-- Resolved when the labels are applied (row removed) or pending again.
create function private.notify_on_pending_labels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'needs_attention'
      and (tg_op = 'INSERT' or old.status is distinct from 'needs_attention') then
    perform private.notify(new.uploader_id, new.venue_id, 'upload_problem', 'media_asset',
      new.asset_id::text, format('labels_attention:%s:%s', new.asset_id, extract(epoch from clock_timestamp())),
      jsonb_build_object('problem', 'labels_not_applied'));
  elsif tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.status <> 'needs_attention') then
    perform private.notification_resolve('upload_problem', 'media_asset',
      coalesce(new.asset_id, old.asset_id)::text,
      coalesce(new.uploader_id, old.uploader_id));
  end if;
  return null;
end;
$$;

create trigger media_pending_labels_notify
  after insert or update of status or delete on public.media_pending_labels
  for each row execute function private.notify_on_pending_labels();

revoke all on function private.notify_on_menu_photo_event() from public, anon, authenticated;
revoke all on function private.notify_on_coverage_review_event() from public, anon, authenticated;
revoke all on function private.notify_on_area_photo_decision() from public, anon, authenticated;
revoke all on function private.notify_on_amenity_check_event() from public, anon, authenticated;
revoke all on function private.notify_on_media_state() from public, anon, authenticated;
revoke all on function private.notify_on_pending_labels() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

-- The caller's notices, newest first. p_before: the last id of the previous
-- page. Returns {items, unread, nextBefore}.
create function public.my_notifications(p_before bigint default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_items jsonb;
  v_count integer;
begin
  with page as (
    select n.* from public.notifications n
    where n.recipient_id = v_uid and (p_before is null or n.id < p_before)
    order by n.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'kind', page.kind, 'subjectType', page.subject_type,
      'subjectId', page.subject_id, 'venueId', page.venue_id, 'venueName', v.name,
      'payload', page.payload, 'createdAt', page.created_at,
      'readAt', page.read_at, 'resolvedAt', page.resolved_at,
      'state', case when page.resolved_at is not null then 'resolved'
        when page.read_at is not null then 'read' else 'unread' end)
      order by page.id desc) filter (where rn <= v_limit), '[]'::jsonb),
    count(*)::integer
  into v_items, v_count
  from (select page.*, row_number() over (order by page.id desc) as rn from page) page
  left join public.venues v on v.id = page.venue_id;

  return jsonb_build_object('items', v_items,
    'unread', public.my_notification_count(),
    'nextBefore', case when v_count > v_limit then (v_items -> (v_limit - 1) ->> 'id')::bigint end);
end;
$$;

-- Unread, unresolved notices: the badge number.
create function public.my_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  return (select count(*)::integer from public.notifications n
    where n.recipient_id = v_uid and n.read_at is null and n.resolved_at is null);
end;
$$;

-- Marks the caller's notices read: the given ids, or all when p_ids is null.
-- Other people's ids are ignored. Returns how many changed.
create function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_count integer;
begin
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'too_many_ids' using errcode = '22023';
  end if;
  update public.notifications n
  set read_at = now(), version = n.version + 1
  where n.recipient_id = v_uid and n.read_at is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.my_notifications(bigint, integer) from public, anon, service_role;
revoke all on function public.my_notification_count() from public, anon, service_role;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon, service_role;
grant execute on function public.my_notifications(bigint, integer) to authenticated;
grant execute on function public.my_notification_count() to authenticated;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;
