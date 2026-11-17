-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Album A4, AL-4 (docs/design-system/DESIGN.md §2 principle 4, §5 Brief;
-- docs/plans/album-a3-a5.md AL-4, 17 Nov 2026): every slot has a one-line
-- brief, what the photo must show. Staff read it before they take the photo;
-- the reviewer judges against the same words.
--
--   Sources   a venue's manager writes a brief for
--               menu_section  a menu section, by its slug, which stays the
--                             same across menu versions (as album_places)
--               menu_item     one dish, by its menu_items id, which also
--                             stays the same across menu versions
--             A dish uses its own brief, else its section's. Amenity slots
--             use the catalogue's capture brief (public.amenity_catalogue),
--             which this file only reads. Areas have none.
--   Writes    public.album_brief_set: the venue's manager (account or grant)
--             or an admin. One line, 1 to 140 characters; null or blank
--             clears it. Every change is also written to
--             public.album_brief_events (append-only).
--   Reads     public.album_briefs: everyone at the venue (staff read it to
--             draw Album, Match and Review).
--
-- Nothing here changes coverage, amenity, credit or review rules.
--
-- Rollback: revoke execute on the two public functions below. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.album_briefs (
  venue_id uuid not null references public.venues (id) on delete restrict,
  source text not null check (source in ('menu_section', 'menu_item')),
  source_key text not null check (length(source_key) between 1 and 120 and source_key = btrim(source_key)),
  brief text not null check (
    length(brief) between 1 and 140 and brief = btrim(brief) and brief !~ '[\r\n]'
  ),
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  constraint album_briefs_pkey primary key (venue_id, source, source_key)
);

comment on table public.album_briefs is
  'Album A4: a one-line brief for a menu section (by slug) or a dish (by menu_items id). One row per venue, source and key.';

create table public.album_brief_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  source text not null check (source in ('menu_section', 'menu_item')),
  source_key text not null,
  brief text,
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now()
);

create index album_brief_events_venue_idx on public.album_brief_events (venue_id, set_at);

comment on table public.album_brief_events is
  'Album A4: append-only history of album_briefs. brief null means the brief was cleared.';

create trigger album_brief_events_append_only
  before update or delete on public.album_brief_events
  for each row execute function private.append_only_guard();
create trigger album_brief_events_no_truncate
  before truncate on public.album_brief_events
  for each statement execute function private.append_only_guard();

-- Reads and writes go through the functions below only.
alter table public.album_briefs enable row level security;
alter table public.album_brief_events enable row level security;
revoke all on table public.album_briefs, public.album_brief_events from public, anon, authenticated, service_role;
grant select on table public.album_briefs, public.album_brief_events to service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The venue's briefs. Staff, managers and admins of the venue (an admin names
-- the venue). Also the catalogue's capture brief for each amenity question the
-- venue has, by question key.
create function public.album_briefs(p_venue_id uuid default null)
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
        jsonb_build_object('source', b.source, 'key', b.source_key, 'brief', b.brief)
        order by b.source, b.source_key)
      from public.album_briefs b
      where b.venue_id = v_venue
    ), '[]'::jsonb),
    'amenities', coalesce((
      select jsonb_agg(
        jsonb_build_object('key', t.key, 'brief', t.capture_brief)
        order by t.position, t.key)
      from public.amenity_catalogue t
      where exists (
        select 1 from public.venue_amenity_checks c
        where c.venue_id = v_venue and c.template_key = t.key
      )
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

-- Set the brief of one menu section (by its slug on the active menu) or one
-- dish of the venue, or clear it with a null or blank brief. Repeating the
-- same call changes nothing and writes no event.
create function public.album_brief_set(
  p_venue_id uuid, p_source text, p_key text, p_brief text
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
  v_key text := private.clean_text(p_key, 120, 'invalid_key');
  v_brief text := private.clean_text(p_brief, 140, 'invalid_brief');
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
  if p_source is null or p_source not in ('menu_section', 'menu_item') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if v_key is null then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  if v_brief is not null and v_brief ~ '[\r\n]' then
    raise exception 'invalid_brief' using errcode = '22023';
  end if;

  if p_source = 'menu_section' and not exists (
    select 1
    from public.menu_versions mv
    join public.menu_sections ms on ms.version_id = mv.id and ms.venue_id = mv.venue_id
    where mv.venue_id = v_venue and mv.status = 'active' and ms.slug = v_key
  ) then
    raise exception 'unknown_slot' using errcode = '22023';
  end if;
  if p_source = 'menu_item' and not exists (
    select 1 from public.menu_items i
    where i.id::text = v_key and i.venue_id = v_venue and i.archived_at is null
  ) then
    raise exception 'unknown_slot' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nabalens_album_brief:' || v_venue::text, 0));
  select b.brief into v_current from public.album_briefs b
  where b.venue_id = v_venue and b.source = p_source and b.source_key = v_key;

  if v_current is not distinct from v_brief then
    return jsonb_build_object('source', p_source, 'key', v_key, 'brief', v_brief, 'changed', false);
  end if;

  if v_brief is null then
    delete from public.album_briefs
    where venue_id = v_venue and source = p_source and source_key = v_key;
  else
    insert into public.album_briefs (venue_id, source, source_key, brief, set_by)
    values (v_venue, p_source, v_key, v_brief, v_uid)
    on conflict (venue_id, source, source_key)
    do update set brief = excluded.brief, set_by = excluded.set_by, set_at = now();
  end if;

  insert into public.album_brief_events (venue_id, source, source_key, brief, set_by)
  values (v_venue, p_source, v_key, v_brief, v_uid);

  return jsonb_build_object('source', p_source, 'key', v_key, 'brief', v_brief, 'changed', true);
end;
$$;

revoke all on function public.album_briefs(uuid) from public, anon, service_role;
revoke all on function public.album_brief_set(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.album_briefs(uuid) to authenticated;
grant execute on function public.album_brief_set(uuid, text, text, text) to authenticated;
