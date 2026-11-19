-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-MENUS (spec §4.4, §8 A2; AC29): collection scope changes
-- need permission, a reason and an audit record, so completion cannot be
-- improved by excluding a real required item.
--
--   Venue scope  public.venue_scope_set (admin): whether a whole kind of
--                requirement applies at a venue. Today one key,
--                accommodation (bedrooms and guest rooms); it does not apply
--                until an admin says so, so a pub without accommodation never
--                gets bedroom slots (AC29). Every change needs a reason and is
--                kept in public.venue_scope_events (append-only), with the
--                previous value. public.venue_scope_read: everyone at the
--                venue. private.venue_scope_applies(venue, key) is the one
--                gate any requirement source must use before it adds slots
--                of that kind.
--   Amenities    public.amenity_check_set_applicability: archive (not
--                applicable here) or restore one amenity check with a
--                required reason, recorded in public.amenity_scope_events.
--                Core checks are admin-only through this path. It wraps the
--                existing keyed archive and restore, so their own events and
--                idempotency still apply.
--
-- Nothing here changes coverage counts directly.
--
-- Rollback: revoke execute on the public functions below. Tables stay.

create table public.venue_scope (
  venue_id uuid not null references public.venues (id) on delete restrict,
  scope_key text not null check (scope_key in ('accommodation')),
  applicable boolean not null,
  reason text not null check (length(reason) between 1 and 500 and reason = btrim(reason)),
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  constraint venue_scope_pkey primary key (venue_id, scope_key)
);

comment on table public.venue_scope is
  'S1-MENUS: whether a kind of requirement applies at a venue (spec §4.4). A missing row reads as not applicable.';

create table public.venue_scope_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  scope_key text not null,
  applicable_before boolean,
  applicable_after boolean not null,
  reason text not null,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index venue_scope_events_venue_idx on public.venue_scope_events (venue_id, created_at);

create table public.amenity_scope_events (
  id bigint generated always as identity primary key,
  check_id uuid not null,
  venue_id uuid not null,
  template_key text not null,
  applicable boolean not null,
  reason text not null check (length(reason) between 1 and 500),
  result_revision integer not null,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint amenity_scope_events_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict
);

create index amenity_scope_events_check_idx on public.amenity_scope_events (check_id, created_at);

create trigger venue_scope_events_append_only
  before update or delete on public.venue_scope_events
  for each row execute function private.append_only_guard();
create trigger venue_scope_events_no_truncate
  before truncate on public.venue_scope_events
  for each statement execute function private.append_only_guard();
create trigger amenity_scope_events_append_only
  before update or delete on public.amenity_scope_events
  for each row execute function private.append_only_guard();
create trigger amenity_scope_events_no_truncate
  before truncate on public.amenity_scope_events
  for each statement execute function private.append_only_guard();

alter table public.venue_scope enable row level security;
alter table public.venue_scope_events enable row level security;
alter table public.amenity_scope_events enable row level security;
revoke all on table public.venue_scope, public.venue_scope_events, public.amenity_scope_events
from public, anon, authenticated, service_role;
grant select on table public.venue_scope, public.venue_scope_events, public.amenity_scope_events
to service_role;

-- ---------------------------------------------------------------------------
-- Gate and reads
-- ---------------------------------------------------------------------------

create function private.venue_scope_applies(p_venue_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.applicable from public.venue_scope s where s.venue_id = p_venue_id and s.scope_key = p_key
  ), false);
$$;

create function public.venue_scope_read(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
  v_manage boolean := private.can_manage_venue(v_venue);
begin
  return jsonb_build_object('venueId', v_venue, 'items', (
    select jsonb_agg(jsonb_build_object(
        'key', k.key,
        'applicable', coalesce(s.applicable, false),
        'decided', s.venue_id is not null,
        'reason', case when v_manage then s.reason end,
        'setAt', s.set_at,
        'revision', coalesce(s.revision, 0),
        'history', case when v_manage then coalesce((
          select jsonb_agg(jsonb_build_object('before', e.applicable_before, 'after', e.applicable_after,
              'reason', e.reason, 'at', e.created_at) order by e.id)
          from public.venue_scope_events e where e.venue_id = v_venue and e.scope_key = k.key
        ), '[]'::jsonb) end)
      order by k.key)
    from (values ('accommodation')) as k(key)
    left join public.venue_scope s on s.venue_id = v_venue and s.scope_key = k.key
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Admin. p_revision is the revision read (0 when never set). Same value
-- again changes nothing.
create function public.venue_scope_set(
  p_venue_id uuid, p_key text, p_applicable boolean, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text;
  v_old public.venue_scope;
begin
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_key is null or p_key not in ('accommodation') then
    raise exception 'invalid_scope_key' using errcode = '22023';
  end if;
  if p_applicable is null then
    raise exception 'invalid_applicable' using errcode = '22023';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'reason_too_long');
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nabalens_venue_scope:' || p_venue_id::text, 0));
  select s.* into v_old from public.venue_scope s
  where s.venue_id = p_venue_id and s.scope_key = p_key for update;
  if coalesce(v_old.revision, 0) is distinct from p_revision then
    raise exception 'venue_scope_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', coalesce(v_old.revision, 0))::text;
  end if;
  if v_old.venue_id is not null and v_old.applicable = p_applicable then
    return jsonb_build_object('key', p_key, 'applicable', p_applicable, 'revision', v_old.revision, 'changed', false);
  end if;

  insert into public.venue_scope as s (venue_id, scope_key, applicable, reason, set_by)
  values (p_venue_id, p_key, p_applicable, v_reason, v_uid)
  on conflict (venue_id, scope_key) do update
    set applicable = excluded.applicable, reason = excluded.reason, set_by = excluded.set_by,
        set_at = now(), revision = s.revision + 1;
  insert into public.venue_scope_events (venue_id, scope_key, applicable_before, applicable_after, reason, actor_id)
  values (p_venue_id, p_key, v_old.applicable, p_applicable, v_reason, v_uid);
  return jsonb_build_object('key', p_key, 'applicable', p_applicable,
    'revision', coalesce(v_old.revision, 0) + 1, 'changed', true);
end;
$$;

-- Archive (p_applicable false) or restore an amenity check with a reason.
create function public.amenity_check_set_applicability(
  p_check_id uuid, p_applicable boolean, p_reason text, p_revision integer, p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_check record;
  v_reason text;
  v_result jsonb;
begin
  if p_applicable is null then
    raise exception 'invalid_applicable' using errcode = '22023';
  end if;
  select c.id, c.venue_id, c.template_key, t.is_core into v_check
  from public.venue_amenity_checks c
  join public.amenity_catalogue t on t.key = c.template_key
  where c.id = p_check_id;
  if v_check.id is null then
    raise exception 'check_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_can_manage_venue(v_check.venue_id);
  if v_check.is_core and not private.is_active_admin() then
    raise exception 'core_check_admin_only' using errcode = '42501';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'reason_too_long');
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  v_result := case when p_applicable
    then public.amenity_restore_check(p_check_id, p_revision, p_idempotency_key)
    else public.amenity_archive_check(p_check_id, p_revision, p_idempotency_key) end;

  if not coalesce((v_result ->> 'replayed')::boolean, false) then
    insert into public.amenity_scope_events (check_id, venue_id, template_key, applicable, reason,
      result_revision, actor_id)
    values (p_check_id, v_check.venue_id, v_check.template_key, p_applicable, v_reason,
      (v_result ->> 'revision')::integer, v_uid);
  end if;
  return v_result;
end;
$$;

revoke all on function private.venue_scope_applies(uuid, text) from public, anon, authenticated;

revoke all on function
  public.venue_scope_read(uuid),
  public.venue_scope_set(uuid, text, boolean, text, integer),
  public.amenity_check_set_applicability(uuid, boolean, text, integer, uuid)
from public, anon, service_role;

grant execute on function
  public.venue_scope_read(uuid),
  public.venue_scope_set(uuid, text, boolean, text, integer),
  public.amenity_check_set_applicability(uuid, boolean, text, integer, uuid)
to authenticated;
