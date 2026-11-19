-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Album shelves (docs/design-system/DESIGN.md §5d; decision D16, 18 Nov
-- 2026; plan docs/plans/album-shelves.md AS-3): Album is browsed by type,
-- then shelf, then menu section. Naba-Lens ships one fixed shelf set in the
-- app (lib/album/shelves.ts) and suggests each section's shelf from words in
-- its name. This file keeps only a venue manager's own choice, where it
-- differs from the suggestion.
--
--   Rows      one per venue and menu section slug (slugs stay the same
--             across menu versions). shelf_key is the app's shelf key; it
--             must belong to the section's own kind (a food section takes a
--             food.* shelf). The app ignores a key it does not know, so a
--             retired shelf falls back to the suggestion.
--   Writes    public.album_shelf_set: the venue's manager (account or grant)
--             or an admin, as public.album_place_set. Setting null removes
--             the choice. A shelf can be set only for a section on the
--             venue's active menu (else unknown_slot); clearing takes any
--             slug, so a choice left by an old menu can still be removed.
--             Every change is also written to public.album_shelf_events
--             (append-only).
--   Reads     public.album_shelves: everyone at the venue (staff read it to
--             draw Album).
--
-- Nothing here changes coverage, review, credit or placement rules.
--
-- Rollback: roll back the app first, then revoke execute on the two public
-- functions below. Tables stay. Revoking alone leaves Album on the
-- suggestions (lib/server/album.ts reads a failed shelves read as none).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.album_shelves (
  venue_id uuid not null references public.venues (id) on delete restrict,
  section_slug text not null check (length(section_slug) between 1 and 120 and section_slug = btrim(section_slug)),
  shelf_key text not null check (shelf_key ~ '^(food|drinks)\.[a-z]{1,40}$'),
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  constraint album_shelves_pkey primary key (venue_id, section_slug)
);

comment on table public.album_shelves is
  'Album shelves (DESIGN.md §5d): a venue manager''s shelf for a menu section (by slug), where it differs from the app''s suggestion.';

create table public.album_shelf_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  section_slug text not null,
  shelf_key text,
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now()
);

create index album_shelf_events_venue_idx on public.album_shelf_events (venue_id, set_at);

comment on table public.album_shelf_events is
  'Album shelves: append-only history of album_shelves. shelf_key null means the choice was cleared.';

create trigger album_shelf_events_append_only
  before update or delete on public.album_shelf_events
  for each row execute function private.append_only_guard();
create trigger album_shelf_events_no_truncate
  before truncate on public.album_shelf_events
  for each statement execute function private.append_only_guard();

-- Reads and writes go through the functions below only.
alter table public.album_shelves enable row level security;
alter table public.album_shelf_events enable row level security;
revoke all on table public.album_shelves, public.album_shelf_events from public, anon, authenticated, service_role;
grant select on table public.album_shelves, public.album_shelf_events to service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- Each section's chosen shelf at the venue. Staff, managers and admins of
-- the venue (an admin names the venue), as public.album_places.
create function public.album_shelves(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
begin
  return jsonb_build_object('venueId', v_venue,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object('key', s.section_slug, 'shelf', s.shelf_key)
        order by s.section_slug)
      from public.album_shelves s
      where s.venue_id = v_venue
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

-- Put one menu section (by slug) on a shelf, or clear the choice with null
-- (back to the suggestion). Repeating the same call changes nothing and
-- writes no event.
create function public.album_shelf_set(
  p_venue_id uuid, p_key text, p_shelf text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_key text;
  v_kind text;
  v_current text;
begin
  perform private.amenity_assert_active_user();
  -- Staff have no managed venue: refused as not a manager. An admin names one.
  if v_venue is null then
    if private.is_active_admin() then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  perform private.assert_can_manage_venue(v_venue);
  perform private.amenity_assert_venue_active(v_venue);
  -- Input is checked only once the caller may write here.
  v_key := private.clean_text(p_key, 120, 'invalid_key');
  if v_key is null then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  if p_shelf is not null then
    select ms.kind into v_kind
    from public.menu_versions mv
    join public.menu_sections ms on ms.version_id = mv.id and ms.venue_id = mv.venue_id
    where mv.venue_id = v_venue and mv.status = 'active' and ms.slug = v_key
    limit 1;
    if v_kind is null then
      raise exception 'unknown_slot' using errcode = '22023';
    end if;
    if p_shelf !~ '^(food|drinks)\.[a-z]{1,40}$' or split_part(p_shelf, '.', 1) <> v_kind then
      raise exception 'invalid_shelf' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nabalens_album_shelf:' || v_venue::text, 0));
  select s.shelf_key into v_current from public.album_shelves s
  where s.venue_id = v_venue and s.section_slug = v_key;

  if v_current is not distinct from p_shelf then
    return jsonb_build_object('key', v_key, 'shelf', p_shelf, 'changed', false);
  end if;

  if p_shelf is null then
    delete from public.album_shelves
    where venue_id = v_venue and section_slug = v_key;
  else
    insert into public.album_shelves (venue_id, section_slug, shelf_key, set_by)
    values (v_venue, v_key, p_shelf, v_uid)
    on conflict (venue_id, section_slug)
    do update set shelf_key = excluded.shelf_key, set_by = excluded.set_by, set_at = now();
  end if;

  insert into public.album_shelf_events (venue_id, section_slug, shelf_key, set_by)
  values (v_venue, v_key, p_shelf, v_uid);

  return jsonb_build_object('key', v_key, 'shelf', p_shelf, 'changed', true);
end;
$$;

revoke all on function public.album_shelves(uuid) from public, anon, service_role;
revoke all on function public.album_shelf_set(uuid, text, text) from public, anon, service_role;
grant execute on function public.album_shelves(uuid) to authenticated;
grant execute on function public.album_shelf_set(uuid, text, text) to authenticated;
