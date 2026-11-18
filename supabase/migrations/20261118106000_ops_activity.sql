-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-OPS: the activity log (spec §8 A7, §11, §16; checklist
-- A7-activity-log, S11-audit-notification-job; AC34).
--
--   activity_events   one append-only table for important changes that have
--                     no history table of their own: account deactivation and
--                     reactivation, role and venue changes, media removal,
--                     settings changes. Other code adds rows through
--                     private.record_activity (actor and role come from the
--                     session, never from the caller's arguments).
--   admin_activity    the admin's Activity screen: activity_events plus every
--                     existing history table (coverage, menus, menu photos,
--                     area photos, knowledge, labels, album places and briefs,
--                     amenity checks, needed-by dates) on common columns:
--                     actor, venue, action, object, old/new revision, reason,
--                     time. Admins only; newest first with a keyset cursor.
--
-- Nothing here changes an existing table's rows or rules. The two triggers
-- only append to activity_events.
--
-- Rollback: roll back the app (/admin/activity) first, then revoke execute on
-- public.admin_activity and drop the two triggers. The table stays.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.activity_events (
  id bigint generated always as identity primary key,
  -- NULL for system actions (scheduler, service role).
  actor_id uuid references public.profiles (id) on delete restrict,
  actor_role text not null check (actor_role in ('admin', 'manager', 'staff', 'system')),
  -- NULL for organisation-wide changes (settings).
  venue_id uuid references public.venues (id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z_]{0,59}$'),
  object_type text not null check (object_type ~ '^[a-z][a-z_]{0,39}$'),
  object_id text check (object_id is null or length(object_id) between 1 and 120),
  old_revision integer check (old_revision is null or old_revision >= 0),
  new_revision integer check (new_revision is null or new_revision >= 0),
  reason text check (reason is null or length(reason) between 1 and 500),
  before jsonb check (before is null or jsonb_typeof(before) = 'object'),
  after jsonb check (after is null or jsonb_typeof(after) = 'object'),
  created_at timestamptz not null default now()
);

create index activity_events_created_idx on public.activity_events (created_at desc, id desc);
create index activity_events_venue_idx on public.activity_events (venue_id, created_at desc);
create index activity_events_actor_idx on public.activity_events (actor_id, created_at desc);

comment on table public.activity_events is
  'S1-OPS: append-only activity for important changes without their own history table (accounts, media removal, settings). Read through public.admin_activity.';

create trigger activity_events_append_only
  before update or delete on public.activity_events
  for each row execute function private.append_only_guard();
create trigger activity_events_no_truncate
  before truncate on public.activity_events
  for each statement execute function private.append_only_guard();

alter table public.activity_events enable row level security;
revoke all on table public.activity_events from public, anon, authenticated, service_role;
grant select on table public.activity_events to service_role;

-- ---------------------------------------------------------------------------
-- Writer
-- ---------------------------------------------------------------------------

-- The signed-in caller's role for the log ('system' without a session or
-- profile). Reads the current profile, so it is the role at the time of the
-- change.
create function private.activity_actor_role(p_actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role::text from public.profiles p where p.id = p_actor),
    'system');
$$;

-- Appends one activity row as the current session's actor. Not callable by
-- users (private schema, no grant to authenticated beyond schema usage):
-- other security definer functions and triggers call it.
create function private.record_activity(
  p_venue_id uuid,
  p_action text,
  p_object_type text,
  p_object_id text,
  p_old_revision integer default null,
  p_new_revision integer default null,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id bigint;
begin
  -- An actor without a profile (deleted auth user) is recorded as system.
  if v_actor is not null and not exists (select 1 from public.profiles p where p.id = v_actor) then
    v_actor := null;
  end if;
  insert into public.activity_events (
    actor_id, actor_role, venue_id, action, object_type, object_id,
    old_revision, new_revision, reason, before, after)
  values (
    v_actor, private.activity_actor_role(v_actor), p_venue_id, p_action, p_object_type,
    p_object_id, p_old_revision, p_new_revision, nullif(btrim(p_reason), ''), p_before, p_after)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.activity_actor_role(uuid) from public, anon, authenticated;
revoke all on function private.record_activity(uuid, text, text, text, integer, integer, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function private.record_activity(uuid, text, text, text, integer, integer, text, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Triggers: accounts and media removal (the gaps named in A7-activity-log)
-- ---------------------------------------------------------------------------

-- Deactivation, reactivation, role and venue changes. AC34: the row records
-- that access ended; nothing else about the person changes.
create function private.activity_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active is distinct from old.active then
    perform private.record_activity(
      coalesce(new.venue_id, old.venue_id),
      case when new.active then 'account_reactivated' else 'account_deactivated' end,
      'account', new.id::text, null, null, null,
      jsonb_build_object('active', old.active), jsonb_build_object('active', new.active));
  end if;
  if new.role is distinct from old.role then
    perform private.record_activity(
      coalesce(new.venue_id, old.venue_id), 'account_role_changed', 'account', new.id::text,
      null, null, null,
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  end if;
  if new.venue_id is distinct from old.venue_id then
    perform private.record_activity(
      coalesce(new.venue_id, old.venue_id), 'account_venue_changed', 'account', new.id::text,
      null, null, null,
      jsonb_build_object('venueId', old.venue_id), jsonb_build_object('venueId', new.venue_id));
  end if;
  return new;
end;
$$;

create trigger profiles_activity
  after update of active, role, venue_id on public.profiles
  for each row execute function private.activity_on_profile_change();

-- Removal of a finished upload (a tombstone on a ready asset). Abandoned
-- reservations that cleanup tombstones are not important changes.
create function private.activity_on_media_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and old.upload_state = 'ready' then
    perform private.record_activity(
      new.venue_id, 'media_removed', 'media_asset', new.id::text, null, null, null,
      jsonb_build_object('uploaderId', new.uploader_id, 'mediaType', new.media_type), null);
  end if;
  return new;
end;
$$;

create trigger media_assets_activity
  after update of deleted_at on public.media_assets
  for each row execute function private.activity_on_media_removed();

revoke all on function private.activity_on_profile_change() from public, anon, authenticated;
revoke all on function private.activity_on_media_removed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read: admin Activity
-- ---------------------------------------------------------------------------

-- Every history table on common columns. Sources are fixed names so a cursor
-- can continue across them: (created_at, source, id), newest first.
create function private.activity_rows()
returns table (
  source text,
  id bigint,
  created_at timestamptz,
  actor_id uuid,
  actor_role text,
  venue_id uuid,
  action text,
  object_type text,
  object_id text,
  old_revision integer,
  new_revision integer,
  reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'activity', e.id, e.created_at, e.actor_id, e.actor_role, e.venue_id, e.action,
    e.object_type, e.object_id, e.old_revision, e.new_revision, e.reason
  from public.activity_events e
  union all
  select 'coverage', e.id, e.created_at, e.actor_id, e.actor_role, e.venue_id, e.action,
    e.entity, e.entity_id::text, null, null, e.reason
  from public.coverage_audit_events e
  union all
  select 'coverage_review', e.id, e.created_at, e.actor_id, e.actor_role, e.venue_id, e.action,
    'checklist_item', e.item_id::text, null, e.revision, e.reason
  from public.coverage_review_events e
  union all
  select 'menu', e.id, e.created_at, e.actor_id, null, e.venue_id, e.action,
    case when e.item_id is not null then 'menu_item' else 'menu_version' end,
    coalesce(e.item_id, e.version_id)::text, null, null, null
  from public.menu_events e
  union all
  select 'menu_photo', e.id, e.created_at, e.actor_id, e.actor_role, e.venue_id, e.action,
    'menu_item_photo', e.photo_id::text,
    case when e.revision > 1 then e.revision - 1 end, e.revision, e.reason
  from public.menu_item_photo_events e
  union all
  select 'menu_needed_by', e.id, e.created_at, e.actor_id, e.actor_role, e.venue_id,
    'needed_by_' || e.action, 'menu_item', e.item_id::text, null, null, null
  from public.menu_item_needed_by_events e
  union all
  select 'area_photo', e.id, e.decided_at, e.decided_by, null, e.venue_id, e.action,
    'area_photo', e.label_id::text, null, null, e.reason
  from public.area_photo_decisions e
  union all
  select 'knowledge', e.id, e.created_at, e.actor_id, null, e.venue_id, e.kind,
    'fact', e.question_key, null, null, null
  from public.knowledge_events e
  union all
  select 'labels', e.id, e.created_at, e.actor_id, e.actor_role::text, e.venue_id, e.action,
    'media_asset', e.asset_id::text, null, null, null
  from public.media_label_events e
  union all
  select 'amenity', e.id, e.created_at, e.actor_id, null, e.venue_id, 'check_' || e.kind,
    'amenity_check', e.check_id::text, null, null, e.reason
  from public.amenity_check_events e
  union all
  select 'album_place', e.id, e.set_at, e.set_by, null, e.venue_id,
    case when e.subject_id is null then 'place_cleared' else 'place_set' end,
    e.source, e.source_key, null, null, null
  from public.album_place_events e
  union all
  select 'album_brief', e.id, e.set_at, e.set_by, null, e.venue_id,
    case when e.brief is null then 'brief_cleared' else 'brief_set' end,
    e.source, e.source_key, null, null, null
  from public.album_brief_events e;
$$;

revoke all on function private.activity_rows() from public, anon, authenticated;

-- The admin Activity screen. Filters are optional and combine:
--   p_venue_id   one venue (organisation-wide rows have no venue)
--   p_actor_id   one person
--   p_action     exact action word
--   p_source     one history source (activity, coverage, menu, ...)
--   p_before     cursor {at, source, id} from the previous page's nextCursor
-- Returns {items, nextCursor}; nextCursor is null on the last page. Actor
-- role falls back to the person's current role where the source table has
-- none.
create function public.admin_activity(
  p_venue_id uuid default null,
  p_actor_id uuid default null,
  p_action text default null,
  p_source text default null,
  p_before jsonb default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_at timestamptz;
  v_source text;
  v_id bigint;
  v_items jsonb;
  v_count integer;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_before is not null then
    begin
      v_at := (p_before ->> 'at')::timestamptz;
      v_source := p_before ->> 'source';
      v_id := (p_before ->> 'id')::bigint;
    exception when others then
      raise exception 'invalid_cursor' using errcode = '22023';
    end;
    if v_at is null or v_source is null or v_id is null then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
  end if;

  with page as (
    select r.*
    from private.activity_rows() r
    where (p_venue_id is null or r.venue_id = p_venue_id)
      and (p_actor_id is null or r.actor_id = p_actor_id)
      and (p_action is null or r.action = p_action)
      and (p_source is null or r.source = p_source)
      and (v_at is null or (r.created_at, r.source, r.id) < (v_at, v_source, v_id))
    order by r.created_at desc, r.source desc, r.id desc
    limit v_limit + 1
  ),
  numbered as (
    select page.*, row_number() over (order by page.created_at desc, page.source desc, page.id desc) as rn
    from page
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'source', n.source, 'id', n.id, 'at', n.created_at,
      'actorId', n.actor_id, 'actorName', p.display_name,
      'actorRole', coalesce(n.actor_role, p.role::text, 'system'),
      'venueId', n.venue_id, 'venueName', v.name,
      'action', n.action, 'objectType', n.object_type, 'objectId', n.object_id,
      'oldRevision', n.old_revision, 'newRevision', n.new_revision, 'reason', n.reason)
      order by n.rn) filter (where n.rn <= v_limit), '[]'::jsonb),
    count(*)::integer
  into v_items, v_count
  from numbered n
  left join public.profiles p on p.id = n.actor_id
  left join public.venues v on v.id = n.venue_id;

  return jsonb_build_object('items', v_items,
    'nextCursor', case when v_count > v_limit then jsonb_build_object(
      'at', v_items -> (v_limit - 1) ->> 'at',
      'source', v_items -> (v_limit - 1) ->> 'source',
      'id', (v_items -> (v_limit - 1) ->> 'id')::bigint) end);
end;
$$;

revoke all on function public.admin_activity(uuid, uuid, text, text, jsonb, integer) from public, anon, service_role;
grant execute on function public.admin_activity(uuid, uuid, text, text, jsonb, integer) to authenticated;
