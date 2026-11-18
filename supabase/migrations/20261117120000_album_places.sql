-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Album A2 (docs/design-system/DESIGN.md §5a, §6.2; decisions D8 and D9,
-- 17 Nov 2026): every thing that needs a photo is a slot in the venue's
-- album, and slots are grouped by the place where staff stand to photograph
-- them (the bar, the kitchen pass, the garden).
--
--   Places    the venue's places from B03 venue knowledge
--             (public.knowledge_subjects). No second list.
--   Sources   two kinds of slot are placed by group, not one by one:
--               menu_section      a menu section, by its slug, which stays
--                                 the same across menu versions
--               amenity_category  an amenity catalogue category ("Games")
--             The third kind, an area, is a place itself.
--   Writes    public.album_place_set: the venue's manager (account or grant)
--             or an admin. One row per venue, source and key; setting null
--             removes it. A place can be set only for a section slug on the
--             venue's active menu or a category in public.amenity_catalogue
--             (else unknown_slot, as album_brief_set); clearing takes any key,
--             so a placement left by an old menu can still be removed. Every change is also written to
--             public.album_place_events (append-only), so who placed what is
--             never lost.
--   Reads     public.album_places: everyone at the venue (staff read it to
--             draw Album). public.album_area_states: each active place's
--             photo state, from G-9's media_area_labels and
--             area_photo_decisions.
--
-- Nothing here changes coverage, amenity, credit or review rules.
--
-- Rollback: roll back the app first (AL-8 and AL-2), then revoke execute on
-- the three public functions below. Tables stay. Revoking alone leaves staff
-- Home drawing every slot under Not placed yet and every area slot left out
-- (lib/server/album.ts reads a failed placement read as none).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.album_places (
  venue_id uuid not null references public.venues (id) on delete restrict,
  source text not null check (source in ('menu_section', 'amenity_category')),
  source_key text not null check (length(source_key) between 1 and 120 and source_key = btrim(source_key)),
  subject_id uuid not null,
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now(),
  constraint album_places_pkey primary key (venue_id, source, source_key),
  -- The place belongs to the same venue.
  constraint album_places_subject_fkey foreign key (subject_id, venue_id)
    references public.knowledge_subjects (id, venue_id) on delete restrict
);

create index album_places_subject_idx on public.album_places (subject_id);

comment on table public.album_places is
  'Album A2: the place where a menu section (by slug) or an amenity category is photographed. One row per venue, source and key.';

create table public.album_place_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  source text not null check (source in ('menu_section', 'amenity_category')),
  source_key text not null,
  subject_id uuid,
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_at timestamptz not null default now()
);

create index album_place_events_venue_idx on public.album_place_events (venue_id, set_at);

comment on table public.album_place_events is
  'Album A2: append-only history of album_places. subject_id null means the place was cleared.';

create trigger album_place_events_append_only
  before update or delete on public.album_place_events
  for each row execute function private.append_only_guard();
create trigger album_place_events_no_truncate
  before truncate on public.album_place_events
  for each statement execute function private.append_only_guard();

-- Reads and writes go through the functions below only.
alter table public.album_places enable row level security;
alter table public.album_place_events enable row level security;
revoke all on table public.album_places, public.album_place_events from public, anon, authenticated, service_role;
grant select on table public.album_places, public.album_place_events to service_role;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Where each placed group is photographed. Staff, managers and admins of the
-- venue (an admin names the venue). Retired places are left out: a group
-- placed in a retired place reads as not placed. Also the active menu's
-- sections with their slugs, since placements are kept by slug and screens
-- know sections by id.
create function public.album_places(p_venue_id uuid default null)
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
        jsonb_build_object('source', ap.source, 'key', ap.source_key, 'subjectId', ap.subject_id)
        order by ap.source, ap.source_key)
      from public.album_places ap
      join public.knowledge_subjects s on s.id = ap.subject_id and s.venue_id = ap.venue_id
      where ap.venue_id = v_venue and s.retired_at is null
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object('sectionId', ms.id, 'slug', ms.slug, 'name', ms.name, 'kind', ms.kind)
        order by ms.position, ms.id)
      from public.menu_versions mv
      join public.menu_sections ms on ms.version_id = mv.id and ms.venue_id = mv.venue_id
      where mv.venue_id = v_venue and mv.status = 'active'
    ), '[]'::jsonb));
end;
$$;

-- Each active place's own photo, for its area slot (DESIGN.md §4):
--   accepted  a live label whose latest decision is accepted
--   waiting   else, a live label with no decision yet
--   retake    else, a live label whose latest decision is needs_another_photo
--   needed    else
-- With the newest asset of the winning state. Only ready, undeleted still
-- images count, as for month credit.
create function public.album_area_states(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
begin
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    with live as (
      select l.subject_id, l.asset_id, l.added_at,
        (select d.action from public.area_photo_decisions d
          where d.label_id = l.id order by d.id desc limit 1) as action
      from public.media_area_labels l
      join public.media_assets a on a.id = l.asset_id
      where l.venue_id = v_venue
        and l.removed_at is null
        and a.deleted_at is null
        and a.upload_state = 'ready'
        and a.media_type = 'image'
    ),
    ranked as (
      select live.subject_id, live.asset_id,
        case
          when live.action = 'accepted' then 'accepted'
          when live.action is null then 'waiting'
          when live.action = 'needs_another_photo' then 'retake'
        end as state,
        row_number() over (
          partition by live.subject_id
          order by case
              when live.action = 'accepted' then 1
              when live.action is null then 2
              when live.action = 'needs_another_photo' then 3
              else 4 end,
            live.added_at desc
        ) as rn
      from live
      where live.action is distinct from 'withdrawn'
    )
    select jsonb_agg(
      jsonb_build_object(
        'subjectId', s.id, 'kind', s.kind, 'label', s.label,
        'state', coalesce(r.state, 'needed'), 'assetId', r.asset_id)
      order by lower(s.label), s.id)
    from public.knowledge_subjects s
    left join ranked r on r.subject_id = s.id and r.rn = 1
    where s.venue_id = v_venue and s.retired_at is null
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

-- Place one menu section (by slug) or amenity category at one of the venue's
-- active places, or clear it with a null place. Repeating the same call
-- changes nothing and writes no event.
create function public.album_place_set(
  p_venue_id uuid, p_source text, p_key text, p_subject_id uuid
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
  v_current uuid;
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
  if p_source is null or p_source not in ('menu_section', 'amenity_category') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if v_key is null then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  -- Placing needs a real group; clearing takes any key (see the header).
  if p_subject_id is not null and p_source = 'menu_section' and not exists (
    select 1
    from public.menu_versions mv
    join public.menu_sections ms on ms.version_id = mv.id and ms.venue_id = mv.venue_id
    where mv.venue_id = v_venue and mv.status = 'active' and ms.slug = v_key
  ) then
    raise exception 'unknown_slot' using errcode = '22023';
  end if;
  if p_subject_id is not null and p_source = 'amenity_category' and not exists (
    select 1 from public.amenity_catalogue t where t.category = v_key
  ) then
    raise exception 'unknown_slot' using errcode = '22023';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.knowledge_subjects s
    where s.id = p_subject_id and s.venue_id = v_venue and s.retired_at is null
  ) then
    raise exception 'unknown_place' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nabalens_album_place:' || v_venue::text, 0));
  select ap.subject_id into v_current from public.album_places ap
  where ap.venue_id = v_venue and ap.source = p_source and ap.source_key = v_key;

  if v_current is not distinct from p_subject_id then
    return jsonb_build_object('source', p_source, 'key', v_key, 'subjectId', p_subject_id, 'changed', false);
  end if;

  if p_subject_id is null then
    delete from public.album_places
    where venue_id = v_venue and source = p_source and source_key = v_key;
  else
    insert into public.album_places (venue_id, source, source_key, subject_id, set_by)
    values (v_venue, p_source, v_key, p_subject_id, v_uid)
    on conflict (venue_id, source, source_key)
    do update set subject_id = excluded.subject_id, set_by = excluded.set_by, set_at = now();
  end if;

  insert into public.album_place_events (venue_id, source, source_key, subject_id, set_by)
  values (v_venue, p_source, v_key, p_subject_id, v_uid);

  return jsonb_build_object('source', p_source, 'key', v_key, 'subjectId', p_subject_id, 'changed', true);
end;
$$;

revoke all on function public.album_places(uuid) from public, anon, service_role;
revoke all on function public.album_area_states(uuid) from public, anon, service_role;
revoke all on function public.album_place_set(uuid, text, text, uuid) from public, anon, service_role;
grant execute on function public.album_places(uuid) to authenticated;
grant execute on function public.album_area_states(uuid) to authenticated;
grant execute on function public.album_place_set(uuid, text, text, uuid) to authenticated;
