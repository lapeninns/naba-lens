-- Shared amenity catalogue and per-venue evidence checks
-- (docs/plans/amenity-catalogue.md; contract lib/amenities/contract.ts).
--
-- One shared, versioned catalogue of amenity questions. Each venue that an
-- admin enables gets its own checks with answers, assignees, notes, evidence
-- submissions and history. There is no review step: a submission that meets
-- the evidence rule becomes the venue's current answer at once; a manager
-- corrects it by reopening the check.
--
-- End users only read through the RPCs below (the catalogue, settings and
-- checks are also readable under RLS); every write is a SECURITY DEFINER
-- procedure that re-reads the caller's profile and manager grant. Submissions,
-- their assets and the event history are append-only. Nothing here writes to
-- Coverage tables, venue_amenity_facts or monthly preparation.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Changes only through a new migration generated from
-- supabase/seed/amenity_catalogue.csv by scripts/db/amenity-catalogue-sql.ts.
create table public.amenity_catalogue (
  key text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  category text not null check (length(category) between 1 and 60 and category = btrim(category)),
  question text not null check (length(question) between 1 and 200 and question = btrim(question)),
  capture_brief text not null check (length(capture_brief) between 1 and 1000 and capture_brief = btrim(capture_brief)),
  evidence_rule text not null check (evidence_rule in ('photo', 'video', 'either', 'both')),
  is_core boolean not null default false,
  position integer not null check (position >= 1),
  catalogue_version integer not null check (catalogue_version >= 1)
);

comment on table public.amenity_catalogue is
  'Shared amenity questions and evidence rules. Changed only by a migration generated from supabase/seed/amenity_catalogue.csv.';

create table public.venue_amenity_settings (
  venue_id uuid primary key references public.venues (id) on delete restrict,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references public.profiles (id) on delete restrict
);

comment on table public.venue_amenity_settings is
  'Venues an admin has enabled Amenities for. Enabling is permanent; checks are archived instead.';

create table public.venue_amenity_checks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  template_key text not null references public.amenity_catalogue (key) on delete restrict,
  status text not null default 'active' check (status in ('active', 'archived')),
  progress text not null default 'needs_capture'
    check (progress in ('needs_capture', 'complete', 'needs_recheck')),
  answer text not null default 'to_check' check (answer in ('to_check', 'yes', 'no', 'not_applicable')),
  current_submission_id uuid,
  answered_by uuid references public.profiles (id) on delete restrict,
  answered_at timestamptz,
  assignee_user_id uuid references public.profiles (id) on delete restrict,
  notes text check (notes is null or (length(notes) between 1 and 2000 and notes = btrim(notes))),
  -- Preset label, optionally followed by the manager's text.
  recheck_reason text check (recheck_reason is null or length(recheck_reason) between 1 and 600),
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_amenity_checks_venue_key unique (venue_id, template_key),
  constraint venue_amenity_checks_id_venue_key unique (id, venue_id),
  constraint venue_amenity_checks_answered check (
    (current_submission_id is null) = (answered_by is null)
    and (answered_by is null) = (answered_at is null)
    and (current_submission_id is null) = (answer = 'to_check')
  ),
  constraint venue_amenity_checks_complete_answered check (progress <> 'complete' or current_submission_id is not null),
  constraint venue_amenity_checks_recheck_reason check ((progress = 'needs_recheck') = (recheck_reason is not null))
);

create index venue_amenity_checks_assignee_idx
  on public.venue_amenity_checks (assignee_user_id) where assignee_user_id is not null;
-- The evidence-lost trigger finds checks by their current submission.
create index venue_amenity_checks_current_submission_idx
  on public.venue_amenity_checks (current_submission_id) where current_submission_id is not null;

comment on table public.venue_amenity_checks is
  'One amenity question per venue: current answer, progress, assignee and notes. Archived rows keep their history and are restored in place.';

create table public.amenity_submissions (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null,
  venue_id uuid not null,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  answer text not null check (answer in ('yes', 'no', 'not_applicable')),
  finding text check (finding is null or (length(finding) between 1 and 2000 and finding = btrim(finding))),
  limitations text check (limitations is null or (length(limitations) between 1 and 2000 and limitations = btrim(limitations))),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  template_version integer not null check (template_version >= 1),
  evidence_rule text not null check (evidence_rule in ('photo', 'video', 'either', 'both')),
  -- Wi-Fi test notes: the submitter, the venue's manager and admins only.
  internal_metadata jsonb check (internal_metadata is null or jsonb_typeof(internal_metadata) = 'object'),
  idempotency_key uuid not null,
  -- The check revision this submission produced, returned again on replay.
  result_revision integer not null check (result_revision >= 2),
  created_at timestamptz not null default now(),
  constraint amenity_submissions_idempotency_key unique (idempotency_key),
  constraint amenity_submissions_id_venue_key unique (id, venue_id),
  constraint amenity_submissions_id_check_key unique (id, check_id),
  constraint amenity_submissions_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  constraint amenity_submissions_reason check (answer = 'yes' or reason is not null)
);

create index amenity_submissions_check_idx on public.amenity_submissions (check_id, created_at desc);

alter table public.venue_amenity_checks
  add constraint venue_amenity_checks_current_submission_fkey foreign key (current_submission_id, id)
    references public.amenity_submissions (id, check_id) on delete restrict;

comment on table public.amenity_submissions is
  'Append-only findings for a venue amenity check, with the catalogue version and evidence rule they were judged against.';

create table public.amenity_submission_assets (
  submission_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('photo', 'video')),
  primary key (submission_id, asset_id),
  constraint amenity_submission_assets_submission_fkey foreign key (submission_id, venue_id)
    references public.amenity_submissions (id, venue_id) on delete restrict,
  -- Evidence venue = the asset's immutable upload-time venue.
  constraint amenity_submission_assets_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index amenity_submission_assets_asset_idx on public.amenity_submission_assets (asset_id);

create table public.amenity_check_events (
  id bigint generated always as identity primary key,
  check_id uuid not null,
  venue_id uuid not null,
  kind text not null check (kind in (
    'added', 'assigned', 'unassigned', 'notes_updated', 'submitted',
    'reopened', 'evidence_lost', 'archived', 'restored'
  )),
  -- The signed-in caller whose request caused the change (also for trigger
  -- events such as evidence_lost); NULL when there is none.
  actor_id uuid references public.profiles (id) on delete restrict,
  reason text check (reason is null or length(reason) between 1 and 600),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  constraint amenity_check_events_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict
);

create index amenity_check_events_check_idx on public.amenity_check_events (check_id, id);

comment on table public.amenity_check_events is
  'Append-only history of every change to a venue amenity check.';

-- ---------------------------------------------------------------------------
-- Catalogue (version 1)
-- ---------------------------------------------------------------------------

-- BEGIN generated by scripts/db/amenity-catalogue-sql.ts
insert into public.amenity_catalogue
  (key, category, question, capture_brief, evidence_rule, is_core, position, catalogue_version)
values
  ('pool_table', 'Games', 'Is there a pool table?', 'Show the table and playing space. Record cost, access times and any restrictions.', 'photo', false, 1, 1),
  ('darts', 'Games', 'Can guests play darts?', 'Show the board, throw line and playing space. Record whether equipment is available.', 'photo', false, 2, 1),
  ('fruit_machine', 'Games', 'Is there a fruit machine?', 'Show the machine in its guest area without people playing. Record any venue restrictions.', 'photo', false, 3, 1),
  ('snooker', 'Games', 'Is there a snooker table?', 'Show the table and playing space. Record booking or access conditions.', 'photo', false, 4, 1),
  ('board_games', 'Games', 'Are board games available?', 'Show the games guests can borrow and where to find them.', 'photo', false, 5, 1),
  ('arcade', 'Games', 'Are arcade games available?', 'Show the machines and access area. Record any charge.', 'photo', false, 6, 1),
  ('sports_screen', 'Entertainment', 'Can guests watch live sport?', 'Show the screens from guest seating. Record where and when fixtures are shown.', 'photo', false, 7, 1),
  ('live_music', 'Entertainment', 'Does the venue host live music?', 'Capture a real setup or approved performance clip. Record the date and usual programme if applicable.', 'either', false, 8, 1),
  ('pub_quiz', 'Entertainment', 'Is there a pub quiz?', 'Show the current venue sign or event setup. Record the schedule and date verified.', 'photo', false, 9, 1),
  ('fireplace', 'Entertainment', 'Is there a fireplace in the guest area?', 'Show it from guest seating. Record whether and when it is in use.', 'photo', false, 10, 1),
  ('guest_wifi', 'Connectivity', 'Is guest Wi-Fi available?', 'Show guest instructions with credentials and join QR hidden. Film a successful connection and speed test. Record free or paid, test spot, date and speeds internally.', 'both', true, 11, 1),
  ('charging', 'Connectivity', 'Can guests charge a device?', 'Show the public sockets or charging point. Record the areas served.', 'photo', false, 12, 1),
  ('step_free_entrance', 'Accessibility', 'Is there a step-free entrance?', 'Film the full approach through the entrance. Show surfaces, slopes, thresholds and doors.', 'video', true, 13, 1),
  ('accessible_parking', 'Accessibility', 'Is designated accessible parking available?', 'Show markings and signs, then film the route to the entrance.', 'both', false, 14, 1),
  ('accessible_seating', 'Accessibility', 'Is there a wheelchair-accessible table?', 'Show the route to a usable table and its approach and clearance. Record exact areas and constraints.', 'both', false, 15, 1),
  ('accessible_toilet', 'Accessibility', 'Is there a wheelchair-accessible toilet?', 'Film the route to the door and photograph the empty facility and access features.', 'both', false, 16, 1),
  ('hearing_loop', 'Accessibility', 'Is a hearing loop or listening aid available?', 'Show the sign or equipment. Ask staff to check it works and record where it can be used.', 'photo', false, 17, 1),
  ('braille_menu', 'Accessibility', 'Is a Braille menu available?', 'Show the actual menu and record how guests request it.', 'photo', false, 18, 1),
  ('onsite_parking', 'Arrival', 'Is there on-site guest parking?', 'Show the entrance, lot and signs. Record surface, restrictions and charges.', 'photo', true, 19, 1),
  ('street_parking', 'Arrival', 'Is street parking available nearby?', 'Show nearby spaces and restrictions. Record any charge or time limit.', 'photo', false, 20, 1),
  ('cycle_parking', 'Arrival', 'Is there somewhere to lock a bike?', 'Show the rack and its location relative to the entrance.', 'photo', false, 21, 1),
  ('ev_charging', 'Arrival', 'Is EV charging available to guests?', 'Show the charge point and parking bay. Record access and check current availability.', 'photo', false, 22, 1),
  ('dogs_inside', 'Pets', 'Are dogs welcome inside?', 'Show the permitted area or policy sign. Have the duty lead confirm zones and conditions.', 'photo', false, 23, 1),
  ('dogs_outside', 'Pets', 'Are dogs welcome outside?', 'Show the permitted outdoor area. Have the duty lead confirm zones and conditions.', 'photo', false, 24, 1),
  ('dog_water', 'Pets', 'Are water bowls available for dogs?', 'Show a bowl at the guest water point or where staff provide it.', 'photo', false, 25, 1),
  ('dog_treats', 'Pets', 'Are dog treats or a dog menu available?', 'Show the actual offering and record any charge.', 'photo', false, 26, 1),
  ('outdoor_seating', 'Outdoor', 'Is there outdoor seating?', 'Show the full guest seating area and where guests enter.', 'photo', false, 27, 1),
  ('covered_seating', 'Outdoor', 'Is there covered outdoor seating?', 'Show seating under the cover and record its extent.', 'photo', false, 28, 1),
  ('outdoor_heating', 'Outdoor', 'Is outdoor heating available?', 'Show the heaters and the seating they serve. Record when they are used.', 'photo', false, 29, 1),
  ('high_chairs', 'Family', 'Are high chairs available?', 'Show an available high chair and where guests request it.', 'photo', false, 30, 1),
  ('baby_changing', 'Family', 'Is there a baby changing station?', 'Show the sign and empty station. Record which facility it is in.', 'photo', false, 31, 1),
  ('play_area', 'Family', 'Is there a children''s play area?', 'Show the equipment and boundary with the area empty. Record access conditions.', 'photo', false, 32, 1),
  ('guest_toilets', 'Facilities', 'Are there customer toilets?', 'Show the sign and empty facility.', 'photo', true, 33, 1),
  ('gender_neutral_toilet', 'Facilities', 'Is there a gender-neutral toilet?', 'Show the sign and location. Have the duty lead confirm availability.', 'photo', false, 34, 1),
  ('onsite_bar', 'Facilities', 'Is there a bar guests can order from?', 'Show the bar as guests see it. A service clip can demonstrate ordering.', 'either', false, 35, 1),
  ('private_room', 'Facilities', 'Is there a private room for hire?', 'Show the room and layout. Record booking conditions and available setup.', 'either', false, 36, 1),
  ('takeaway_pickup', 'Service', 'Is there a takeaway collection point?', 'Show the collection point and signs. Record how guests collect.', 'photo', false, 37, 1),
  ('curbside_pickup', 'Service', 'Can guests collect an order at their car?', 'Film a staff demonstration and record the exact collection point and process.', 'video', false, 38, 1),
  ('swimming_pool', 'Lodging and leisure', 'Is there a swimming pool guests can use?', 'Show the pool and guest access area. Record access rules and availability.', 'photo', false, 39, 1)
on conflict (key) do update set
  category = excluded.category,
  question = excluded.question,
  capture_brief = excluded.capture_brief,
  evidence_rule = excluded.evidence_rule,
  is_core = excluded.is_core,
  position = excluded.position,
  catalogue_version = excluded.catalogue_version;
-- END generated

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function private.venue_amenity_checks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.template_key is distinct from old.template_key
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'amenity_check_identity_immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger venue_amenity_checks_guard
  before update on public.venue_amenity_checks
  for each row execute function private.venue_amenity_checks_guard();
create trigger venue_amenity_checks_no_delete
  before delete on public.venue_amenity_checks
  for each row execute function private.append_only_guard();
create trigger venue_amenity_checks_no_truncate
  before truncate on public.venue_amenity_checks
  for each statement execute function private.append_only_guard();

create trigger venue_amenity_settings_append_only
  before update or delete on public.venue_amenity_settings
  for each row execute function private.append_only_guard();
create trigger venue_amenity_settings_no_truncate
  before truncate on public.venue_amenity_settings
  for each statement execute function private.append_only_guard();

create trigger amenity_submissions_append_only
  before update or delete on public.amenity_submissions
  for each row execute function private.append_only_guard();
create trigger amenity_submissions_no_truncate
  before truncate on public.amenity_submissions
  for each statement execute function private.append_only_guard();

create trigger amenity_submission_assets_append_only
  before update or delete on public.amenity_submission_assets
  for each row execute function private.append_only_guard();
create trigger amenity_submission_assets_no_truncate
  before truncate on public.amenity_submission_assets
  for each statement execute function private.append_only_guard();

create trigger amenity_check_events_append_only
  before update or delete on public.amenity_check_events
  for each row execute function private.append_only_guard();
create trigger amenity_check_events_no_truncate
  before truncate on public.amenity_check_events
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Legacy Coverage amenity template keys whose venue media a manager or admin
-- may attach (contract LEGACY_COVERAGE_MATCHES; the unit test compares them).
create function private.amenity_legacy_coverage_keys(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select m.keys from (values
      ('step_free_entrance', array['access_routes', 'entrance']),
      ('accessible_toilet', array['accessible_toilet']),
      ('onsite_parking', array['parking']),
      ('street_parking', array['parking']),
      ('guest_toilets', array['toilets']),
      ('outdoor_seating', array['outdoor_seating']),
      ('covered_seating', array['outdoor_seating']),
      ('dogs_inside', array['dog_facilities']),
      ('dogs_outside', array['dog_facilities']),
      ('dog_water', array['dog_facilities']),
      ('high_chairs', array['family_facilities']),
      ('baby_changing', array['family_facilities']),
      ('play_area', array['family_facilities']),
      ('onsite_bar', array['bar_area'])
    ) as m(key, keys)
    where m.key = p_key
  ), '{}'::text[]);
$$;

-- contract evidenceSatisfies(): `both` needs a photo and a video.
create function private.amenity_rule_met(p_rule text, p_kinds text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_rule
    when 'photo' then 'photo' = any(p_kinds)
    when 'video' then 'video' = any(p_kinds)
    when 'either' then 'photo' = any(p_kinds) or 'video' = any(p_kinds)
    when 'both' then 'photo' = any(p_kinds) and 'video' = any(p_kinds)
    else false
  end;
$$;

-- One writer at a time per venue for enabling and adding checks.
create function private.lock_amenity_venue(p_venue_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('nabalens_amenity_venue:' || p_venue_id::text, 0));
$$;

create function private.amenity_assert_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = 'P0001';
  end if;
  return auth.uid();
end;
$$;

-- Every write needs an active venue; reads stay possible at an inactive one.
create function private.amenity_assert_venue_active(p_venue_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_inactive' using errcode = 'P0001';
  end if;
end;
$$;

-- The current assignee (active staff currently at the check's venue), the
-- venue's effective manager (a manager account with its grant, or a staff
-- account with a transitional pre-existing grant: private.can_manage_venue),
-- or an admin. Assignees are staff only, so a manager account submits as the
-- manager and loses every amenity path the moment its grant goes.
create function private.amenity_can_submit(p_check public.venue_amenity_checks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_active_user() and (
    private.can_manage_venue(p_check.venue_id)
    or (
      p_check.assignee_user_id = (select auth.uid())
      and private.active_staff_venue_id() = p_check.venue_id
    )
  ), false);
$$;

-- Submitters and their earlier submissions while still staff at the venue,
-- plus everyone who may submit. A manager account reads only while it
-- manages the venue.
create function private.amenity_can_read(p_check public.venue_amenity_checks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.amenity_can_submit(p_check)
    or coalesce(
      private.active_staff_venue_id() = p_check.venue_id
      and exists (
        select 1 from public.amenity_submissions s
        where s.check_id = p_check.id and s.submitted_by = (select auth.uid())
      ),
      false
    );
$$;

-- A check the caller may read, else amenity_check_not_found (unknown and
-- forbidden look the same).
create function private.amenity_readable_check(p_check_id uuid)
returns public.venue_amenity_checks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks;
begin
  perform private.amenity_assert_active_user();
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or not private.amenity_can_read(v_check) then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  return v_check;
end;
$$;

-- Locks a check for a manager/admin mutation at the expected revision.
create function private.amenity_lock_managed_check(p_check_id uuid, p_revision integer)
returns public.venue_amenity_checks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks;
begin
  v_check := private.amenity_readable_check(p_check_id);
  perform private.assert_can_manage_venue(v_check.venue_id);
  perform private.amenity_assert_venue_active(v_check.venue_id);
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  if p_revision is distinct from v_check.revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_check.revision)::text;
  end if;
  return v_check;
end;
$$;

create function private.amenity_event(
  p_check_id uuid,
  p_venue_id uuid,
  p_kind text,
  p_reason text,
  p_detail jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.amenity_check_events (check_id, venue_id, kind, actor_id, reason, detail)
  values (
    p_check_id, p_venue_id, p_kind,
    (select p.id from public.profiles p where p.id = (select auth.uid())),
    p_reason, coalesce(p_detail, '{}'::jsonb)
  );
$$;

-- Normalised Wi-Fi test notes ({testSpot, testedOn, downloadMbps, uploadMbps}),
-- or invalid_wifi_metadata.
create function private.amenity_wifi_metadata(p_metadata jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_spot text;
  v_on text;
  v_date date;
  v_down numeric;
  v_up numeric;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_metadata) k
       where k not in ('testSpot', 'testedOn', 'downloadMbps', 'uploadMbps')
     )
     or jsonb_typeof(p_metadata -> 'testSpot') is distinct from 'string'
     or jsonb_typeof(p_metadata -> 'testedOn') is distinct from 'string'
     or jsonb_typeof(p_metadata -> 'downloadMbps') is distinct from 'number'
     or jsonb_typeof(p_metadata -> 'uploadMbps') is distinct from 'number' then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;

  v_spot := btrim(p_metadata ->> 'testSpot');
  v_on := p_metadata ->> 'testedOn';
  v_down := (p_metadata ->> 'downloadMbps')::numeric;
  v_up := (p_metadata ->> 'uploadMbps')::numeric;
  if length(v_spot) not between 1 and 120
     or v_on !~ '^\d{4}-\d{2}-\d{2}$'
     or v_down not between 0 and 10000
     or v_up not between 0 and 10000 then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;
  begin
    v_date := v_on::date;
  exception when others then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> v_on or v_date > private.london_today() then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;

  return jsonb_build_object('testSpot', v_spot, 'testedOn', v_on, 'downloadMbps', v_down, 'uploadMbps', v_up);
end;
$$;

-- Legacy Coverage media of the check's venue matching its catalogue key.
create function private.amenity_is_legacy_media(p_check public.venue_amenity_checks, p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.coverage_submission_items i
      join public.coverage_requirements r on r.id = i.requirement_id and r.venue_id = i.venue_id
      where i.asset_id = p_asset_id
        and i.venue_id = p_check.venue_id
        and i.state <> 'needs_another_photo'
        and r.amenity_key = any(private.amenity_legacy_coverage_keys(p_check.template_key))
    )
    or exists (
      select 1
      from public.venue_amenity_fact_media m
      join public.venue_amenity_facts f on f.id = m.fact_id and f.venue_id = m.venue_id
      where m.asset_id = p_asset_id
        and m.venue_id = p_check.venue_id
        and f.amenity_key = any(private.amenity_legacy_coverage_keys(p_check.template_key))
    );
$$;

-- Why the caller may not attach an asset to the check (contract
-- AmenityFailure["assetReason"]), or NULL when it may. Another venue's asset
-- is not_found, like an unknown id, so its existence is never revealed;
-- ownership comes next so another person's asset state is not either.
create function private.amenity_asset_ineligibility(p_check public.venue_amenity_checks, p_asset_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
begin
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found or v_asset.venue_id <> p_check.venue_id then
    return 'not_found';
  end if;
  if v_asset.uploader_id is distinct from auth.uid()
     and not (private.can_manage_venue(p_check.venue_id) and private.amenity_is_legacy_media(p_check, p_asset_id)) then
    return 'not_own';
  end if;
  if v_asset.deleted_at is not null then
    return 'deleted';
  end if;
  if v_asset.upload_state <> 'ready' then
    return 'not_ready';
  end if;
  return null;
end;
$$;

-- Assets the caller may attach to a submission for the check, newest first.
create function private.amenity_submittable(p_check public.venue_amenity_checks)
returns table (asset_id uuid, media_type public.media_type, created_at timestamptz, source text, has_thumbnail boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.media_type, x.created_at, x.source, x.has_thumbnail
  from (
    select a.id, a.media_type, a.created_at,
      case when a.uploader_id = (select auth.uid()) then 'own' else 'legacy_coverage' end as source,
      a.thumbnail_path is not null as has_thumbnail
    from public.media_assets a
    where a.venue_id = p_check.venue_id
      and a.upload_state = 'ready'
      and a.deleted_at is null
      and private.amenity_can_submit(p_check)
      and (
        a.uploader_id = (select auth.uid())
        or (private.can_manage_venue(p_check.venue_id) and private.amenity_is_legacy_media(p_check, a.id))
      )
    order by a.created_at desc, a.id desc
    limit 200
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: evidence removed, assignee left
-- ---------------------------------------------------------------------------

-- A complete Yes whose current submission no longer meets its evidence rule
-- needs a recheck. The submission and its asset rows are kept. Only deletion
-- can remove evidence: only ready assets are attached, and
-- private.media_assets_guard keeps a ready asset ready.
create function private.media_assets_amenity_evidence_lost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check record;
begin
  -- Checks in id order, so concurrent deletions lock them in the same order.
  for v_check in
    select c.id, c.venue_id, c.current_submission_id, s.evidence_rule
    from public.amenity_submission_assets sa
    join public.venue_amenity_checks c on c.current_submission_id = sa.submission_id
    join public.amenity_submissions s on s.id = sa.submission_id
    where sa.asset_id = new.id
      and c.progress = 'complete'
      and c.answer = 'yes'
    order by c.id
    for update of c
  loop
    if not private.amenity_rule_met(v_check.evidence_rule, array(
      select x.evidence_kind
      from public.amenity_submission_assets x
      join public.media_assets a on a.id = x.asset_id
      where x.submission_id = v_check.current_submission_id
        and a.deleted_at is null and a.upload_state = 'ready'
    )) then
      update public.venue_amenity_checks c
      set progress = 'needs_recheck', recheck_reason = 'Evidence was removed', revision = c.revision + 1
      where c.id = v_check.id;
      perform private.amenity_event(v_check.id, v_check.venue_id, 'evidence_lost', null,
        jsonb_build_object('submissionId', v_check.current_submission_id, 'assetId', new.id));
    end if;
  end loop;
  return null;
end;
$$;

create trigger media_assets_amenity_evidence_lost
  after update of deleted_at on public.media_assets
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.media_assets_amenity_evidence_lost();

-- Transfer, deactivation or a role change (including conversion to a manager
-- account by convert_account_to_manager) clears the person's assignments
-- (pattern: private.profiles_revoke_manager_grants). Submissions stay.
create function private.profiles_end_amenity_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check record;
begin
  if new.venue_id is not distinct from old.venue_id
     and new.active is not distinct from old.active
     and new.role is not distinct from old.role then
    return null;
  end if;

  for v_check in
    update public.venue_amenity_checks c
    set assignee_user_id = null, revision = c.revision + 1
    where c.assignee_user_id = new.id
      and (c.venue_id is distinct from new.venue_id or not new.active or new.role <> 'staff')
    returning c.id, c.venue_id
  loop
    perform private.amenity_event(v_check.id, v_check.venue_id, 'unassigned', null,
      jsonb_build_object('cause', 'assignee_left', 'previousAssigneeId', new.id));
  end loop;
  return null;
end;
$$;

create trigger profiles_end_amenity_assignments
  after update of venue_id, active, role on public.profiles
  for each row execute function private.profiles_end_amenity_assignments();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

-- Submissions, their assets and events are read through the RPCs only, which
-- hide Wi-Fi notes from everyone but the submitter, manager and admins.
revoke all on
  public.amenity_catalogue, public.venue_amenity_settings, public.venue_amenity_checks,
  public.amenity_submissions, public.amenity_submission_assets, public.amenity_check_events
from public, anon, authenticated, service_role;

grant select on public.amenity_catalogue, public.venue_amenity_settings, public.venue_amenity_checks
to authenticated;

grant select on
  public.amenity_catalogue, public.venue_amenity_settings, public.venue_amenity_checks,
  public.amenity_submissions, public.amenity_submission_assets, public.amenity_check_events
to service_role;
grant insert on public.venue_amenity_settings to service_role;
grant insert, update on public.venue_amenity_checks to service_role;
grant insert on public.amenity_submissions, public.amenity_submission_assets, public.amenity_check_events
to service_role;

alter table public.amenity_catalogue enable row level security;
alter table public.venue_amenity_settings enable row level security;
alter table public.venue_amenity_checks enable row level security;
alter table public.amenity_submissions enable row level security;
alter table public.amenity_submission_assets enable row level security;
alter table public.amenity_check_events enable row level security;

create policy amenity_catalogue_select on public.amenity_catalogue
  for select to authenticated using ((select private.is_active_user()));
-- The venue's staff and its effective manager (a manager account has no
-- active_staff_venue_id).
create policy venue_amenity_settings_select on public.venue_amenity_settings
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.active_staff_venue_id())
    or venue_id = (select private.my_manager_venue_id())
  );
create policy venue_amenity_checks_select on public.venue_amenity_checks
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (assignee_user_id = (select auth.uid()) and venue_id = (select private.active_staff_venue_id()))
  );

-- ---------------------------------------------------------------------------
-- RPCs: reads
-- ---------------------------------------------------------------------------

create view private.amenity_check_rows as
  select c.id, c.venue_id, c.template_key, t.category, t.question, t.capture_brief, t.evidence_rule,
    t.is_core, t.position, t.catalogue_version, c.status, c.progress, c.answer,
    c.current_submission_id, c.assignee_user_id, ap.display_name as assignee_name,
    c.answered_by, bp.display_name as answered_by_name, c.answered_at, c.recheck_reason,
    c.notes, c.revision, c.updated_at
  from public.venue_amenity_checks c
  join public.amenity_catalogue t on t.key = c.template_key
  left join public.profiles ap on ap.id = c.assignee_user_id
  left join public.profiles bp on bp.id = c.answered_by;

revoke all on private.amenity_check_rows from public, anon, authenticated;

create function public.amenity_venue_state(p_venue_id uuid)
returns table (venue_id uuid, venue_name text, enabled boolean, can_enable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    if private.is_active_admin() then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  perform private.assert_can_manage_venue(p_venue_id);
  return query
    select v.id, v.name,
      exists (select 1 from public.venue_amenity_settings s where s.venue_id = v.id),
      -- amenity_enable_venue refuses an inactive venue.
      private.is_active_admin() and v.active
    from public.venues v
    where v.id = p_venue_id;
end;
$$;

create function public.amenity_checks_for_venue(p_venue_id uuid, p_include_archived boolean)
returns table (
  id uuid, venue_id uuid, template_key text, category text, question text, capture_brief text,
  evidence_rule text, is_core boolean, "position" integer, catalogue_version integer, status text,
  progress text, answer text, current_submission_id uuid, assignee_user_id uuid, assignee_name text,
  answered_by uuid, answered_by_name text, answered_at timestamptz, recheck_reason text, notes text,
  revision integer, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(p_venue_id);
  return query
    select r.* from private.amenity_check_rows r
    where r.venue_id = p_venue_id
      and (coalesce(p_include_archived, false) or r.status = 'active')
    order by r.position, r.template_key;
end;
$$;

-- The caller's open tasks: active checks assigned to them at their current
-- venue that are not complete. Staff only (a manager account has none).
create function public.amenity_my_checks()
returns table (
  id uuid, venue_id uuid, template_key text, category text, question text, capture_brief text,
  evidence_rule text, is_core boolean, "position" integer, catalogue_version integer, status text,
  progress text, answer text, current_submission_id uuid, assignee_user_id uuid, assignee_name text,
  answered_by uuid, answered_by_name text, answered_at timestamptz, recheck_reason text, notes text,
  revision integer, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  return query
    select r.* from private.amenity_check_rows r
    where r.assignee_user_id = v_uid
      and r.venue_id = private.active_staff_venue_id()
      and r.status = 'active'
      and r.progress <> 'complete'
    order by (r.progress = 'needs_recheck') desc, r.position, r.template_key;
end;
$$;

create function public.amenity_check(p_check_id uuid)
returns table (
  id uuid, venue_id uuid, template_key text, category text, question text, capture_brief text,
  evidence_rule text, is_core boolean, "position" integer, catalogue_version integer, status text,
  progress text, answer text, current_submission_id uuid, assignee_user_id uuid, assignee_name text,
  answered_by uuid, answered_by_name text, answered_at timestamptz, recheck_reason text, notes text,
  revision integer, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_readable_check(p_check_id);
  return query select r.* from private.amenity_check_rows r where r.id = p_check_id;
end;
$$;

create function public.amenity_check_submissions(p_check_id uuid)
returns table (
  id uuid, check_id uuid, answer text, finding text, limitations text, reason text,
  submitted_by uuid, submitted_by_name text, created_at timestamptz, template_version integer,
  evidence_rule text, internal_metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_readable_check(p_check_id);
  v_manager boolean := private.can_manage_venue(v_check.venue_id);
  v_uid uuid := auth.uid();
begin
  return query
    select s.id, s.check_id, s.answer, s.finding, s.limitations, s.reason, s.submitted_by,
      p.display_name, s.created_at, s.template_version, s.evidence_rule,
      case when v_manager or s.submitted_by = v_uid then s.internal_metadata end
    from public.amenity_submissions s
    left join public.profiles p on p.id = s.submitted_by
    where s.check_id = v_check.id
    order by s.created_at desc, s.id;
end;
$$;

create function public.amenity_check_submission_assets(p_check_id uuid)
returns table (
  submission_id uuid, asset_id uuid, evidence_kind text, available boolean,
  has_thumbnail boolean, has_preview boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_readable_check(p_check_id);
begin
  return query
    select sa.submission_id, sa.asset_id, sa.evidence_kind,
      a.deleted_at is null and a.upload_state = 'ready',
      a.thumbnail_path is not null, a.preview_path is not null
    from public.amenity_submissions s
    join public.amenity_submission_assets sa on sa.submission_id = s.id
    join public.media_assets a on a.id = sa.asset_id
    where s.check_id = v_check.id
    order by s.created_at desc, sa.evidence_kind, a.created_at, sa.asset_id;
end;
$$;

create function public.amenity_check_events(p_check_id uuid)
returns table (
  id text, check_id uuid, kind text, actor_id uuid, actor_name text, reason text,
  detail jsonb, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_readable_check(p_check_id);
begin
  return query
    select e.id::text, e.check_id, e.kind, e.actor_id, p.display_name, e.reason, e.detail, e.created_at
    from public.amenity_check_events e
    left join public.profiles p on p.id = e.actor_id
    where e.check_id = v_check.id
    order by e.id;
end;
$$;

-- Active staff currently at the check's venue (manager or admin only).
-- Manager accounts are never assignees.
create function public.amenity_assignee_options(p_check_id uuid)
returns table (id uuid, display_name text, job_title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_readable_check(p_check_id);
begin
  perform private.assert_can_manage_venue(v_check.venue_id);
  return query
    select p.id, p.display_name, p.job_title
    from public.profiles p
    where p.venue_id = v_check.venue_id and p.active and p.role = 'staff'
    order by lower(p.display_name), p.id;
end;
$$;

create function public.amenity_catalogue_for_venue(p_venue_id uuid)
returns table (
  key text, category text, question text, capture_brief text, evidence_rule text,
  is_core boolean, "position" integer, catalogue_version integer, check_id uuid, check_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(p_venue_id);
  return query
    select t.key, t.category, t.question, t.capture_brief, t.evidence_rule, t.is_core,
      t.position, t.catalogue_version, c.id, c.status
    from public.amenity_catalogue t
    left join public.venue_amenity_checks c on c.template_key = t.key and c.venue_id = p_venue_id
    order by t.position, t.key;
end;
$$;

create function public.amenity_submittable_assets(p_check_id uuid)
returns table (
  asset_id uuid, media_type public.media_type, created_at timestamptz, source text, has_thumbnail boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_readable_check(p_check_id);
begin
  if not private.amenity_can_submit(v_check) then
    raise exception 'amenity_not_permitted' using errcode = 'P0001';
  end if;
  return query select x.* from private.amenity_submittable(v_check) x;
end;
$$;

-- Media gate (same shape as task_evidence_asset): a row only when the asset
-- is ready and the caller is the venue's effective manager or an admin for a
-- submission containing it, or its submitter while still active staff at that
-- venue (own uploads included: a submitter converted to a manager account,
-- transferred or deactivated keeps nothing), or may attach it to a check they
-- can submit. Unknown and forbidden are the same empty result.
create function public.amenity_evidence_asset(p_asset_id uuid)
returns table (asset_id uuid, media_type public.media_type, has_thumbnail boolean, has_preview boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.media_type, a.thumbnail_path is not null, a.preview_path is not null
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and private.is_active_user()
    and (
      exists (
        select 1
        from public.amenity_submission_assets sa
        join public.amenity_submissions s on s.id = sa.submission_id
        where sa.asset_id = a.id
          and (
            private.can_manage_venue(s.venue_id)
            or (
              s.submitted_by = (select auth.uid())
              and private.active_staff_venue_id() = s.venue_id
            )
          )
      )
      or exists (
        select 1
        from public.venue_amenity_checks c
        where c.venue_id = a.venue_id
          and c.status = 'active'
          and private.amenity_can_submit(c)
          and (
            a.uploader_id = (select auth.uid())
            or (private.can_manage_venue(c.venue_id) and private.amenity_is_legacy_media(c, a.id))
          )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- RPCs: writes
-- ---------------------------------------------------------------------------

-- Admin only. Creates the missing core checks (unassigned); idempotent.
create function public.amenity_enable_venue(p_venue_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_key text;
  v_created integer := 0;
begin
  perform private.amenity_assert_active_user();
  v_uid := private.assert_active_admin();
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_amenity_venue(p_venue_id);

  insert into public.venue_amenity_settings (venue_id, enabled_by)
  values (p_venue_id, v_uid)
  on conflict (venue_id) do nothing;

  for v_key in
    select t.key from public.amenity_catalogue t
    where t.is_core
      and not exists (
        select 1 from public.venue_amenity_checks c where c.venue_id = p_venue_id and c.template_key = t.key
      )
    order by t.position
  loop
    insert into public.venue_amenity_checks (venue_id, template_key, created_by)
    values (p_venue_id, v_key, v_uid)
    returning id into v_id;
    perform private.amenity_event(v_id, p_venue_id, 'added', null, jsonb_build_object('source', 'enable'));
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

-- Manager or admin of an enabled venue. Returns one check id per key in input
-- order: an active key as is, an archived key restored in place.
create function public.amenity_add_checks(p_venue_id uuid, p_keys text[])
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_key text;
  v_check public.venue_amenity_checks;
  v_ids uuid[] := '{}';
begin
  if p_keys is null or cardinality(p_keys) not between 1 and 39
     or array_position(p_keys, null) is not null
     or (select count(distinct k) from unnest(p_keys) k) <> cardinality(p_keys) then
    raise exception 'invalid_key_list' using errcode = 'P0001';
  end if;
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    if private.is_active_admin() then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  perform private.assert_can_manage_venue(p_venue_id);
  perform private.amenity_assert_venue_active(p_venue_id);
  if not exists (select 1 from public.venue_amenity_settings s where s.venue_id = p_venue_id) then
    raise exception 'amenities_not_enabled' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_keys) k
    where not exists (select 1 from public.amenity_catalogue t where t.key = k)
  ) then
    raise exception 'amenity_key_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_amenity_venue(p_venue_id);

  foreach v_key in array p_keys loop
    select c.* into v_check
    from public.venue_amenity_checks c
    where c.venue_id = p_venue_id and c.template_key = v_key
    for update;
    if not found then
      insert into public.venue_amenity_checks (venue_id, template_key, created_by)
      values (p_venue_id, v_key, v_uid)
      returning * into v_check;
      perform private.amenity_event(v_check.id, p_venue_id, 'added', null, jsonb_build_object('source', 'manager'));
    elsif v_check.status = 'archived' then
      update public.venue_amenity_checks c
      set status = 'active', revision = c.revision + 1
      where c.id = v_check.id;
      perform private.amenity_event(v_check.id, p_venue_id, 'restored', null, '{}'::jsonb);
    end if;
    v_ids := v_ids || v_check.id;
  end loop;

  return v_ids;
end;
$$;

create function public.amenity_archive_check(p_check_id uuid, p_revision integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_lock_managed_check(p_check_id, p_revision);
  v_revision integer;
begin
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  update public.venue_amenity_checks c
  set status = 'archived', revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;
  perform private.amenity_event(v_check.id, v_check.venue_id, 'archived', null, '{}'::jsonb);
  return v_revision;
end;
$$;

create function public.amenity_restore_check(p_check_id uuid, p_revision integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_lock_managed_check(p_check_id, p_revision);
  v_revision integer;
begin
  if v_check.status = 'active' then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_check.revision)::text;
  end if;
  update public.venue_amenity_checks c
  set status = 'active', revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;
  perform private.amenity_event(v_check.id, v_check.venue_id, 'restored', null, '{}'::jsonb);
  return v_revision;
end;
$$;

-- The assignee must be active staff whose current venue is the check's
-- venue; NULL unassigns. Assigning the current assignee changes nothing.
create function public.amenity_assign_check(p_check_id uuid, p_assignee_id uuid, p_revision integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_lock_managed_check(p_check_id, p_revision);
  v_revision integer;
begin
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  if p_assignee_id is not distinct from v_check.assignee_user_id then
    return v_check.revision;
  end if;

  if p_assignee_id is not null then
    -- Serialises with a concurrent transfer or deactivation of the person.
    perform 1 from public.profiles p
    where p.id = p_assignee_id and p.active and p.role = 'staff' and p.venue_id = v_check.venue_id
    for share;
    if not found then
      raise exception 'staff_not_eligible' using errcode = 'P0001',
        detail = 'Only active staff currently at this venue can be assigned.';
    end if;
  end if;

  update public.venue_amenity_checks c
  set assignee_user_id = p_assignee_id, revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;

  if p_assignee_id is null then
    perform private.amenity_event(v_check.id, v_check.venue_id, 'unassigned', null,
      jsonb_build_object('cause', 'manager', 'previousAssigneeId', v_check.assignee_user_id));
  else
    perform private.amenity_event(v_check.id, v_check.venue_id, 'assigned', null,
      jsonb_build_object('assigneeId', p_assignee_id, 'previousAssigneeId', v_check.assignee_user_id));
  end if;
  return v_revision;
end;
$$;

-- Blank notes clear them. Unchanged notes change nothing.
create function public.amenity_set_check_notes(p_check_id uuid, p_notes text, p_revision integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_notes text := private.clean_text(p_notes, 2000, 'invalid_notes');
  v_check public.venue_amenity_checks := private.amenity_lock_managed_check(p_check_id, p_revision);
  v_revision integer;
begin
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  if v_notes is not distinct from v_check.notes then
    return v_check.revision;
  end if;
  update public.venue_amenity_checks c
  set notes = v_notes, revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;
  perform private.amenity_event(v_check.id, v_check.venue_id, 'notes_updated', null, '{}'::jsonb);
  return v_revision;
end;
$$;

-- The answer stays visible; progress becomes needs_recheck with the preset
-- label (contract REOPEN_PRESET_LABEL) and any text as the recheck reason.
create function public.amenity_reopen_check(
  p_check_id uuid,
  p_revision integer,
  p_preset text,
  p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_label text := case p_preset
    when 'credentials_visible' then 'Password or QR visible'
    when 'wrong_area' then 'Wrong area'
    when 'conditions_changed' then 'Conditions changed'
    when 'evidence_unclear' then 'Evidence unclear'
    when 'other' then 'Other'
  end;
  v_reason text;
  v_check public.venue_amenity_checks;
  v_revision integer;
begin
  if v_label is null then
    raise exception 'invalid_reopen_preset' using errcode = 'P0001';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  if p_preset = 'other' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  v_check := private.amenity_lock_managed_check(p_check_id, p_revision);
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  -- Only an answer can be reopened; a check never captured already needs capture.
  if v_check.current_submission_id is null then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_check.revision)::text;
  end if;

  update public.venue_amenity_checks c
  set progress = 'needs_recheck',
      recheck_reason = case
        when v_reason is null then v_label
        when p_preset = 'other' then v_reason
        else v_label || ': ' || v_reason
      end,
      revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;
  perform private.amenity_event(v_check.id, v_check.venue_id, 'reopened', v_reason,
    jsonb_build_object('preset', p_preset));
  return v_revision;
end;
$$;

-- The assignee, the venue's manager or an admin. A valid finding becomes the
-- venue's current answer at once (progress complete). The same idempotency
-- key from the same person for the same check returns the first result.
create function public.amenity_submit_finding(
  p_check_id uuid,
  p_revision integer,
  p_idempotency_key uuid,
  p_answer text,
  p_finding text,
  p_limitations text,
  p_reason text,
  p_asset_ids uuid[],
  p_internal_metadata jsonb,
  p_redaction_confirmed boolean
)
returns table (submission_id uuid, revision integer, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_check public.venue_amenity_checks;
  v_prior public.amenity_submissions;
  v_template public.amenity_catalogue;
  v_finding text;
  v_limitations text;
  v_reason text;
  v_assets uuid[] := coalesce(p_asset_ids, '{}');
  v_asset uuid;
  v_why text;
  v_kinds text[];
  v_metadata jsonb;
  v_id uuid;
  v_revision integer;
begin
  if p_answer is null or p_answer not in ('yes', 'no', 'not_applicable') then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  -- The service always sends a UUID; not one of the contract's RPC_ERRORS.
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  -- A retry returns the first result even if the caller has since been
  -- unassigned or the revision has moved.
  perform pg_advisory_xact_lock(hashtextextended('nabalens_amenity_submit:' || p_idempotency_key::text, 0));
  select s.* into v_prior from public.amenity_submissions s where s.idempotency_key = p_idempotency_key;
  if found then
    if v_prior.check_id = p_check_id and v_prior.submitted_by = v_uid then
      return query select v_prior.id, v_prior.result_revision, true;
      return;
    end if;
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;

  v_check := private.amenity_readable_check(p_check_id);
  if not private.amenity_can_submit(v_check) then
    raise exception 'amenity_not_permitted' using errcode = 'P0001';
  end if;

  if cardinality(v_assets) > 10
     or array_position(v_assets, null) is not null
     or (select count(distinct a) from unnest(v_assets) a) <> cardinality(v_assets) then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;

  -- Asset rows before the check row, the same order as the evidence-lost
  -- trigger: a concurrent deletion either waits for this submission (and then
  -- sees it) or commits first (and the asset is then rejected below). Only the
  -- check venue's assets are locked; any other id is rejected as not_found.
  perform 1 from public.media_assets a
  where a.id = any(v_assets) and a.venue_id = v_check.venue_id
  order by a.id
  for share;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  -- The assignee may have changed while waiting for the lock.
  if not private.amenity_can_submit(v_check) then
    raise exception 'amenity_not_permitted' using errcode = 'P0001';
  end if;
  perform private.amenity_assert_venue_active(v_check.venue_id);

  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  if p_revision is distinct from v_check.revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_check.revision)::text;
  end if;

  v_finding := private.clean_text(p_finding, 2000, 'invalid_finding');
  v_limitations := private.clean_text(p_limitations, 2000, 'invalid_limitations');
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  if p_answer <> 'yes' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  foreach v_asset in array v_assets loop
    v_why := private.amenity_asset_ineligibility(v_check, v_asset);
    if v_why is not null then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_asset, 'reason', v_why)::text;
    end if;
  end loop;

  select t.* into v_template from public.amenity_catalogue t where t.key = v_check.template_key;
  v_kinds := array(
    select case a.media_type when 'image' then 'photo' else 'video' end
    from public.media_assets a where a.id = any(v_assets)
  );
  if p_answer = 'yes' and not private.amenity_rule_met(v_template.evidence_rule, v_kinds) then
    raise exception 'evidence_rule_unmet' using errcode = 'P0001', detail = v_template.evidence_rule;
  end if;

  if v_check.template_key = 'guest_wifi' then
    if p_answer = 'yes' or p_internal_metadata is not null then
      v_metadata := private.amenity_wifi_metadata(p_internal_metadata);
    end if;
    if (p_answer = 'yes' or 'photo' = any(v_kinds)) and p_redaction_confirmed is distinct from true then
      raise exception 'redaction_not_confirmed' using errcode = 'P0001';
    end if;
  elsif p_internal_metadata is not null then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;

  insert into public.amenity_submissions (
    check_id, venue_id, submitted_by, answer, finding, limitations, reason,
    template_version, evidence_rule, internal_metadata, idempotency_key, result_revision
  )
  values (
    v_check.id, v_check.venue_id, v_uid, p_answer, v_finding, v_limitations, v_reason,
    v_template.catalogue_version, v_template.evidence_rule, v_metadata, p_idempotency_key,
    v_check.revision + 1
  )
  returning id into v_id;

  insert into public.amenity_submission_assets (submission_id, venue_id, asset_id, evidence_kind)
  select v_id, v_check.venue_id, a.id, case a.media_type when 'image' then 'photo' else 'video' end
  from public.media_assets a where a.id = any(v_assets);

  update public.venue_amenity_checks c
  set answer = p_answer, progress = 'complete', answered_by = v_uid, answered_at = now(),
      current_submission_id = v_id, recheck_reason = null, revision = c.revision + 1
  where c.id = v_check.id
  returning c.revision into v_revision;

  perform private.amenity_event(v_check.id, v_check.venue_id, 'submitted', null,
    jsonb_build_object('submissionId', v_id, 'answer', p_answer));

  return query select v_id, v_revision, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

-- Read-only checks.
revoke all on function
  private.amenity_legacy_coverage_keys(text),
  private.amenity_rule_met(text, text[]),
  private.amenity_assert_active_user(),
  private.amenity_can_submit(public.venue_amenity_checks),
  private.amenity_can_read(public.venue_amenity_checks),
  private.amenity_readable_check(uuid),
  private.amenity_wifi_metadata(jsonb),
  private.amenity_is_legacy_media(public.venue_amenity_checks, uuid),
  private.amenity_asset_ineligibility(public.venue_amenity_checks, uuid),
  private.amenity_submittable(public.venue_amenity_checks)
from public, anon;

grant execute on function
  private.amenity_legacy_coverage_keys(text),
  private.amenity_rule_met(text, text[]),
  private.amenity_assert_active_user(),
  private.amenity_can_submit(public.venue_amenity_checks),
  private.amenity_can_read(public.venue_amenity_checks),
  private.amenity_readable_check(uuid),
  private.amenity_wifi_metadata(jsonb),
  private.amenity_is_legacy_media(public.venue_amenity_checks, uuid),
  private.amenity_asset_ineligibility(public.venue_amenity_checks, uuid),
  private.amenity_submittable(public.venue_amenity_checks)
to authenticated, service_role;

-- Locks, writes and triggers: only the SECURITY DEFINER RPCs above call them,
-- running as the function owner (pattern: coverage_procedures.sql).
revoke all on function
  private.venue_amenity_checks_guard(),
  private.lock_amenity_venue(uuid),
  private.amenity_assert_venue_active(uuid),
  private.amenity_lock_managed_check(uuid, integer),
  private.amenity_event(uuid, uuid, text, text, jsonb),
  private.media_assets_amenity_evidence_lost(),
  private.profiles_end_amenity_assignments()
from public, anon, authenticated;

grant execute on function
  private.venue_amenity_checks_guard(),
  private.lock_amenity_venue(uuid),
  private.amenity_assert_venue_active(uuid),
  private.amenity_lock_managed_check(uuid, integer),
  private.amenity_event(uuid, uuid, text, text, jsonb),
  private.media_assets_amenity_evidence_lost(),
  private.profiles_end_amenity_assignments()
to service_role;

revoke all on function
  public.amenity_venue_state(uuid),
  public.amenity_checks_for_venue(uuid, boolean),
  public.amenity_my_checks(),
  public.amenity_check(uuid),
  public.amenity_check_submissions(uuid),
  public.amenity_check_submission_assets(uuid),
  public.amenity_check_events(uuid),
  public.amenity_assignee_options(uuid),
  public.amenity_catalogue_for_venue(uuid),
  public.amenity_submittable_assets(uuid),
  public.amenity_evidence_asset(uuid),
  public.amenity_enable_venue(uuid),
  public.amenity_add_checks(uuid, text[]),
  public.amenity_archive_check(uuid, integer),
  public.amenity_restore_check(uuid, integer),
  public.amenity_assign_check(uuid, uuid, integer),
  public.amenity_set_check_notes(uuid, text, integer),
  public.amenity_reopen_check(uuid, integer, text, text),
  public.amenity_submit_finding(uuid, integer, uuid, text, text, text, text, uuid[], jsonb, boolean)
from public, anon, service_role;

grant execute on function
  public.amenity_venue_state(uuid),
  public.amenity_checks_for_venue(uuid, boolean),
  public.amenity_my_checks(),
  public.amenity_check(uuid),
  public.amenity_check_submissions(uuid),
  public.amenity_check_submission_assets(uuid),
  public.amenity_check_events(uuid),
  public.amenity_assignee_options(uuid),
  public.amenity_catalogue_for_venue(uuid),
  public.amenity_submittable_assets(uuid),
  public.amenity_evidence_asset(uuid),
  public.amenity_enable_venue(uuid),
  public.amenity_add_checks(uuid, text[]),
  public.amenity_archive_check(uuid, integer),
  public.amenity_restore_check(uuid, integer),
  public.amenity_assign_check(uuid, uuid, integer),
  public.amenity_set_check_notes(uuid, text, integer),
  public.amenity_reopen_check(uuid, integer, text, text),
  public.amenity_submit_finding(uuid, integer, uuid, text, text, text, text, uuid[], jsonb, boolean)
to authenticated;
