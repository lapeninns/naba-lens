-- Venue coverage and monthly participation records (part 2 of 3).
--
-- Requirements describe what a venue needs photographed (menu sections,
-- amenities, service areas, venue-specific subjects). Monthly targets say how
-- many new photos each staff member contributes per Europe/London month.
-- Submissions reference existing media assets (the one upload pipeline); each
-- submitted photo is an item reviewed by the venue manager or an admin.
--
-- Venue consistency is structural: every child row carries venue_id and
-- references its parent by (id, venue_id), and an item references its asset
-- by (asset_id, venue_id), so evidence always belongs to the asset's
-- immutable upload-time venue. End users only read (RLS); every write is a
-- SECURITY DEFINER procedure in part 3.

-- ---------------------------------------------------------------------------
-- Amenity and service template (candidate requirements, not venue claims)
-- ---------------------------------------------------------------------------

create table public.coverage_amenity_templates (
  key text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  kind text not null check (kind in ('amenity', 'service')),
  title text not null check (length(title) between 1 and 120 and title = btrim(title)),
  default_guidance text check (default_guidance is null or length(default_guidance) between 1 and 2000),
  suggested_photo_target integer not null default 1 check (suggested_photo_target between 1 and 200),
  -- Amenities need a confirmed present/absent fact before a photo requirement can be confirmed.
  needs_fact boolean not null default false,
  position integer not null check (position >= 0),
  active boolean not null default true,
  constraint coverage_amenity_templates_fact_kind check (kind = 'amenity' or not needs_fact)
);

insert into public.coverage_amenity_templates
  (key, kind, title, default_guidance, suggested_photo_target, needs_fact, position)
values
  ('exterior_signage', 'service', 'Exterior and signage', 'The building from the street with the venue sign readable.', 1, false, 0),
  ('entrance', 'service', 'Entrance', 'The main entrance as a guest arrives.', 1, false, 1),
  ('bar_area', 'service', 'Bar area', 'The bar as guests see it, tidy and well lit.', 1, false, 2),
  ('dining_area', 'service', 'Dining area', 'The main dining space set for service.', 1, false, 3),
  ('service_area', 'service', 'Other service areas', 'Function rooms, snugs or other guest areas in use.', 1, false, 4),
  ('toilets', 'amenity', 'Toilets', 'Clean guest toilets with nobody in the photo.', 1, true, 5),
  ('access_routes', 'amenity', 'Access features and routes', 'Step-free routes, ramps, handrails or level access exactly as they are.', 1, true, 6),
  ('accessible_toilet', 'amenity', 'Accessible toilet', 'Only where one is present: the accessible toilet and its door.', 1, true, 7),
  ('outdoor_seating', 'amenity', 'Outdoor seating or garden', 'Outdoor seating or the garden as guests use it.', 1, true, 8),
  ('parking', 'amenity', 'Parking', 'The car park or nearby parking as guests find it.', 1, true, 9),
  ('dog_facilities', 'amenity', 'Dog facilities and policy', 'Water bowls, dog areas or signs that show the house policy.', 1, true, 10),
  ('family_facilities', 'amenity', 'Family facilities', 'High chairs, baby changing or play areas where present.', 1, true, 11);

comment on table public.coverage_amenity_templates is
  'Organisation-wide candidate coverage entries. A venue confirms each one before it becomes a requirement.';

-- ---------------------------------------------------------------------------
-- Amenity facts (separate from photo requirements)
-- ---------------------------------------------------------------------------

create table public.venue_amenity_facts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  amenity_key text not null references public.coverage_amenity_templates (key) on delete restrict,
  presence text not null default 'unknown' check (presence in ('present', 'absent', 'unknown')),
  facts text check (facts is null or (length(facts) between 1 and 2000 and facts = btrim(facts))),
  policy text check (policy is null or (length(policy) between 1 and 2000 and policy = btrim(policy))),
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  constraint venue_amenity_facts_venue_key unique (venue_id, amenity_key),
  constraint venue_amenity_facts_id_venue_key unique (id, venue_id),
  constraint venue_amenity_facts_confirmed_pair check ((confirmed_at is null) = (confirmed_by is null)),
  -- Unknown stays "needs verification": it can never be confirmed.
  constraint venue_amenity_facts_unknown_unconfirmed check (confirmed_at is null or presence <> 'unknown')
);

comment on table public.venue_amenity_facts is
  'Manager-confirmed amenity facts and policy per venue. Photos never establish these facts by themselves.';

create table public.venue_amenity_fact_media (
  fact_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  added_by uuid references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (fact_id, asset_id),
  constraint venue_amenity_fact_media_fact_fkey foreign key (fact_id, venue_id)
    references public.venue_amenity_facts (id, venue_id) on delete cascade,
  constraint venue_amenity_fact_media_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index venue_amenity_fact_media_asset_idx on public.venue_amenity_fact_media (asset_id);

-- ---------------------------------------------------------------------------
-- Menu coverage plans (one per manager-confirmed menu version)
-- ---------------------------------------------------------------------------

create table public.menu_coverage_plans (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  menu_version_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded', 'discarded')),
  previous_plan_id uuid,
  reconciliation_required boolean not null default false,
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles (id) on delete restrict,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  discarded_by uuid references public.profiles (id) on delete restrict,
  discarded_at timestamptz,
  constraint menu_coverage_plans_id_venue_key unique (id, venue_id),
  constraint menu_coverage_plans_identity_key unique (id, menu_version_id, venue_id),
  constraint menu_coverage_plans_version_fkey foreign key (menu_version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_coverage_plans_previous_fkey foreign key (previous_plan_id, venue_id)
    references public.menu_coverage_plans (id, venue_id) on delete restrict,
  constraint menu_coverage_plans_previous_not_self check (previous_plan_id is distinct from id),
  constraint menu_coverage_plans_confirmed_has_time check (
    status not in ('confirmed', 'superseded') or (confirmed_at is not null and confirmed_by is not null)
  ),
  constraint menu_coverage_plans_superseded_has_time check ((status = 'superseded') = (superseded_at is not null)),
  constraint menu_coverage_plans_discarded_has_time check ((status = 'discarded') = (discarded_at is not null)),
  constraint menu_coverage_plans_reconciled_pair check ((reconciled_at is null) = (reconciled_by is null))
);

create unique index menu_coverage_plans_one_confirmed
  on public.menu_coverage_plans (venue_id) where status = 'confirmed';
create unique index menu_coverage_plans_one_draft
  on public.menu_coverage_plans (venue_id) where status = 'draft';
create unique index menu_coverage_plans_one_per_version
  on public.menu_coverage_plans (menu_version_id) where status in ('draft', 'confirmed');

comment on table public.menu_coverage_plans is
  'Menu section coverage built from one active menu version. A newer active menu needs a new plan and explicit reconciliation.';

-- ---------------------------------------------------------------------------
-- Coverage requirements
-- ---------------------------------------------------------------------------

create table public.coverage_requirements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  kind text not null check (kind in ('menu_section', 'amenity', 'service', 'venue_specific')),
  title text not null check (length(title) between 1 and 120 and title = btrim(title)),
  guidance text check (guidance is null or (length(guidance) between 1 and 2000 and guidance = btrim(guidance))),
  photo_target integer not null default 1 check (photo_target between 1 and 200),
  due_on date,
  status text not null default 'needs_setup'
    check (status in ('needs_setup', 'active', 'not_applicable', 'retired')),
  status_reason text check (status_reason is null or (length(status_reason) between 1 and 500 and status_reason = btrim(status_reason))),
  retire_kind text check (retire_kind in ('manual', 'menu_replaced', 'reconciled')),
  status_changed_by uuid references public.profiles (id) on delete restrict,
  status_changed_at timestamptz,
  amenity_key text references public.coverage_amenity_templates (key) on delete restrict,
  menu_plan_id uuid,
  menu_version_id uuid,
  menu_section_id uuid,
  -- Display only ({name, slug, kind, position, itemCount}); never an identity.
  section_snapshot jsonb check (section_snapshot is null or jsonb_typeof(section_snapshot) = 'object'),
  replaced_by_requirement_id uuid,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  -- Keyed creates only: a retry with the same key and arguments (hash) returns
  -- this requirement instead of adding another.
  client_request_key text check (client_request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  client_request_hash text check (client_request_hash ~ '^[0-9a-f]{64}$'),
  constraint coverage_requirements_id_venue_key unique (id, venue_id),
  constraint coverage_requirements_request_key check (
    (client_request_key is null) = (client_request_hash is null)
    and (client_request_key is null or created_by is not null)
  ),
  constraint coverage_requirements_plan_fkey foreign key (menu_plan_id, menu_version_id, venue_id)
    references public.menu_coverage_plans (id, menu_version_id, venue_id) on delete restrict,
  -- The section of exactly that (frozen, non-draft) version of this venue.
  constraint coverage_requirements_section_fkey foreign key (menu_section_id, menu_version_id, venue_id)
    references public.menu_sections (id, version_id, venue_id) on delete restrict,
  constraint coverage_requirements_replaced_by_fkey foreign key (replaced_by_requirement_id, venue_id)
    references public.coverage_requirements (id, venue_id) on delete restrict,
  constraint coverage_requirements_menu_shape check (
    (kind = 'menu_section') = (menu_plan_id is not null)
    and (menu_plan_id is null) = (menu_version_id is null)
    and (menu_version_id is null) = (menu_section_id is null)
    and (menu_section_id is null) = (section_snapshot is null)
  ),
  constraint coverage_requirements_amenity_shape check (
    (kind <> 'amenity' or amenity_key is not null)
    and (amenity_key is null or kind in ('amenity', 'service'))
  ),
  constraint coverage_requirements_closed_reason check (
    status not in ('not_applicable', 'retired') or status_reason is not null
  ),
  constraint coverage_requirements_retire_kind check ((status = 'retired') = (retire_kind is not null)),
  constraint coverage_requirements_not_self_replaced check (replaced_by_requirement_id is distinct from id)
);

create unique index coverage_requirements_one_per_template
  on public.coverage_requirements (venue_id, amenity_key)
  where amenity_key is not null and status <> 'retired';
create unique index coverage_requirements_one_per_plan_section
  on public.coverage_requirements (menu_plan_id, menu_section_id)
  where menu_section_id is not null;
create index coverage_requirements_venue_status_idx
  on public.coverage_requirements (venue_id, status);
create unique index coverage_requirements_request_key_idx
  on public.coverage_requirements (created_by, client_request_key)
  where client_request_key is not null;

comment on table public.coverage_requirements is
  'What a venue needs photographed and how many accepted photos satisfy it. Not applicable and retired rows keep their reasons.';

create table public.coverage_requirement_assignees (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null,
  venue_id uuid not null,
  staff_id uuid not null references public.profiles (id) on delete restrict,
  assigned_by uuid references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete restrict,
  end_kind text check (end_kind in ('unassigned', 'transferred', 'deactivated', 'requirement_closed')),
  end_reason text check (end_reason is null or length(end_reason) between 1 and 500),
  constraint coverage_requirement_assignees_requirement_fkey foreign key (requirement_id, venue_id)
    references public.coverage_requirements (id, venue_id) on delete restrict,
  constraint coverage_requirement_assignees_ended_pair check ((ended_at is null) = (end_kind is null))
);

create unique index coverage_requirement_assignees_one_open
  on public.coverage_requirement_assignees (requirement_id, staff_id) where ended_at is null;
create index coverage_requirement_assignees_staff_open_idx
  on public.coverage_requirement_assignees (staff_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- Monthly targets
-- ---------------------------------------------------------------------------

create table public.monthly_targets (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  -- NULL: prepared for the month but not set yet (needs setup, never complete).
  target_count integer check (target_count between 1 and 500),
  due_on date not null,
  source text not null check (source in ('manager', 'copied', 'placeholder', 'admin_correction')),
  copied_from_target_id uuid references public.monthly_targets (id) on delete restrict,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint monthly_targets_period_key unique (staff_id, venue_id, period_month),
  constraint monthly_targets_due_in_month check (
    due_on >= period_month and due_on < period_month + interval '1 month'
  ),
  constraint monthly_targets_placeholder check ((target_count is null) = (source = 'placeholder')),
  constraint monthly_targets_copied_from check (source <> 'copied' or copied_from_target_id is not null)
);

create index monthly_targets_venue_period_idx on public.monthly_targets (venue_id, period_month);

comment on table public.monthly_targets is
  'One manager-set photo target per staff member, venue and Europe/London calendar month.';

-- ---------------------------------------------------------------------------
-- Submissions, per-photo items and review events
-- ---------------------------------------------------------------------------

create table public.coverage_submissions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('staff_submit', 'manager_attach', 'reconcile')),
  requirement_id uuid,
  client_request_key text not null check (client_request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  -- The request as sent, so a retry with the same key can be recognised.
  asset_ids uuid[] not null check (
    cardinality(asset_ids) between 1 and 200 and array_position(asset_ids, null) is null
  ),
  created_at timestamptz not null default now(),
  constraint coverage_submissions_id_venue_key unique (id, venue_id),
  constraint coverage_submissions_request_key unique (submitted_by, client_request_key),
  constraint coverage_submissions_requirement_fkey foreign key (requirement_id, venue_id)
    references public.coverage_requirements (id, venue_id) on delete restrict
);

create table public.coverage_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  -- Always the asset's uploader: attaching a photo never transfers authorship.
  author_id uuid not null references public.profiles (id) on delete restrict,
  requirement_id uuid,
  origin text not null check (origin in ('submitted', 'attached', 'reconciled')),
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  submitted_month date not null,
  uploaded_at timestamptz not null,
  uploaded_month date not null,
  state text not null default 'submitted'
    check (state in ('submitted', 'accepted', 'needs_another_photo')),
  decision_reason text check (decision_reason is null or (length(decision_reason) between 1 and 500 and decision_reason = btrim(decision_reason))),
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  self_review boolean,
  replaces_item_id uuid references public.coverage_submission_items (id) on delete restrict,
  reconciled_from_item_id uuid references public.coverage_submission_items (id) on delete restrict,
  archived_at timestamptz,
  archive_kind text check (archive_kind in ('requirement_retired', 'reconciled')),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint coverage_submission_items_submission_fkey foreign key (submission_id, venue_id)
    references public.coverage_submissions (id, venue_id) on delete restrict,
  -- Evidence venue = the asset's immutable upload-time venue.
  constraint coverage_submission_items_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint coverage_submission_items_requirement_fkey foreign key (requirement_id, venue_id)
    references public.coverage_requirements (id, venue_id) on delete restrict,
  constraint coverage_submission_items_submitted_month check (submitted_month = private.london_month(submitted_at)),
  constraint coverage_submission_items_uploaded_month check (uploaded_month = private.london_month(uploaded_at)),
  constraint coverage_submission_items_reason check (state <> 'needs_another_photo' or decision_reason is not null),
  constraint coverage_submission_items_decided check (
    (state in ('accepted', 'needs_another_photo')) = (decided_by is not null)
    and (decided_by is null) = (decided_at is null)
    and (decided_at is null) = (self_review is null)
  ),
  constraint coverage_submission_items_origin_requirement check (origin = 'submitted' or requirement_id is not null),
  constraint coverage_submission_items_reconciled_from check ((origin = 'reconciled') = (reconciled_from_item_id is not null)),
  constraint coverage_submission_items_archived_pair check ((archived_at is null) = (archive_kind is null))
);

-- One live item per photo: it counts at most once toward one current requirement.
create unique index coverage_submission_items_one_live_per_asset
  on public.coverage_submission_items (asset_id)
  where state in ('submitted', 'accepted') and archived_at is null;
create index coverage_submission_items_venue_queue_idx
  on public.coverage_submission_items (venue_id, state, submitted_at, id);
create index coverage_submission_items_author_month_idx
  on public.coverage_submission_items (author_id, submitted_month);
create index coverage_submission_items_requirement_idx
  on public.coverage_submission_items (requirement_id) where archived_at is null;
create index coverage_submission_items_asset_idx
  on public.coverage_submission_items (asset_id);

comment on table public.coverage_submission_items is
  'Per-photo review state of a submitted or attached media asset. Acceptance governs completion only, never visibility.';

create table public.coverage_review_events (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.coverage_submission_items (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  author_id uuid not null references public.profiles (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete restrict,
  actor_role text not null check (actor_role in ('staff', 'manager', 'admin', 'system')),
  action text not null check (action in (
    'submitted', 'attached', 'reconciled', 'accepted', 'needs_another_photo',
    'relinked', 'archived'
  )),
  from_state text check (from_state in ('submitted', 'accepted', 'needs_another_photo')),
  to_state text not null check (to_state in ('submitted', 'accepted', 'needs_another_photo')),
  revision integer not null check (revision >= 1),
  requirement_id uuid,
  reason text check (reason is null or length(reason) between 1 and 500),
  self_review boolean not null default false,
  client_request_key text check (client_request_key is null or client_request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  -- The request a moved replacement stopped answering (relinked only).
  cleared_replaces_item_id uuid references public.coverage_submission_items (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint coverage_review_events_cleared_link check (cleared_replaces_item_id is null or action = 'relinked')
);

-- A retried review with the same key is recognised, never recorded twice.
create unique index coverage_review_events_request_key
  on public.coverage_review_events (actor_id, client_request_key)
  where client_request_key is not null;
create index coverage_review_events_item_idx on public.coverage_review_events (item_id, id);
create index coverage_review_events_venue_idx on public.coverage_review_events (venue_id, created_at desc);
create index coverage_review_events_self_review_idx
  on public.coverage_review_events (venue_id, created_at desc) where self_review;

comment on table public.coverage_review_events is
  'Append-only history of every submission, decision and change to a coverage item, with self-review recorded.';

-- ---------------------------------------------------------------------------
-- Monthly preparation runs (oversight)
-- ---------------------------------------------------------------------------

create table public.coverage_preparation_runs (
  id uuid primary key default gen_random_uuid(),
  period_month date not null check (extract(day from period_month) = 1),
  run_trigger text not null check (run_trigger in ('scheduled', 'manual')),
  scope_venue_id uuid references public.venues (id) on delete restrict,
  requested_by uuid references public.profiles (id) on delete restrict,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('succeeded', 'failed')),
  staff_considered integer not null default 0 check (staff_considered >= 0),
  targets_copied integer not null default 0 check (targets_copied >= 0),
  placeholders_created integer not null default 0 check (placeholders_created >= 0),
  already_present integer not null default 0 check (already_present >= 0),
  candidates_added integer not null default 0 check (candidates_added >= 0),
  error_code text check (error_code is null or length(error_code) between 1 and 80),
  error_message text check (error_message is null or length(error_message) between 1 and 500),
  constraint coverage_preparation_runs_failure check ((status = 'failed') = (error_code is not null))
);

create index coverage_preparation_runs_period_idx
  on public.coverage_preparation_runs (period_month, started_at desc);
create index coverage_preparation_runs_venue_idx
  on public.coverage_preparation_runs (scope_venue_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function private.venue_amenity_facts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.amenity_key is distinct from old.amenity_key
     or new.created_at is distinct from old.created_at then
    raise exception 'amenity_fact_identity_immutable' using errcode = '42501';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.menu_coverage_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.menu_version_id is distinct from old.menu_version_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'menu_plan_identity_immutable' using errcode = '42501';
  end if;
  if old.status = 'discarded' then
    raise exception 'menu_plan_immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('confirmed', 'discarded'))
       or (old.status = 'confirmed' and new.status = 'superseded')
     ) then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.status, new.status);
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.coverage_requirements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.kind is distinct from old.kind
     or new.amenity_key is distinct from old.amenity_key
     or new.menu_plan_id is distinct from old.menu_plan_id
     or new.menu_version_id is distinct from old.menu_version_id
     or new.menu_section_id is distinct from old.menu_section_id
     or new.section_snapshot is distinct from old.section_snapshot
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.client_request_key is distinct from old.client_request_key
     or new.client_request_hash is distinct from old.client_request_hash then
    raise exception 'coverage_requirement_identity_immutable' using errcode = '42501';
  end if;
  if old.status = 'retired' then
    raise exception 'requirement_closed' using errcode = 'P0001',
      detail = 'A retired requirement keeps its history unchanged.';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- New assignments go to active staff currently at the requirement's venue.
-- Team (FOH/BOH) never matters here: it only suggests assignments.
create function private.coverage_requirement_assignees_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null or not exists (
    select 1 from public.profiles p
    where p.id = new.staff_id and p.active and p.role = 'staff' and p.venue_id = new.venue_id
  ) then
    raise exception 'staff_not_eligible' using errcode = 'P0001',
      detail = 'Only active staff currently at this venue can be assigned.';
  end if;
  return new;
end;
$$;

create function private.coverage_requirement_assignees_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.ended_at is not null
     or new.id is distinct from old.id
     or new.requirement_id is distinct from old.requirement_id
     or new.venue_id is distinct from old.venue_id
     or new.staff_id is distinct from old.staff_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at then
    raise exception 'assignment_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.monthly_targets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.staff_id is distinct from old.staff_id
     or new.venue_id is distinct from old.venue_id
     or new.period_month is distinct from old.period_month
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'monthly_target_identity_immutable' using errcode = '42501';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Author and upload time are the asset's own, whoever inserts the item.
create function private.coverage_submission_items_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploader uuid;
  v_created timestamptz;
begin
  select a.uploader_id, a.created_at into v_uploader, v_created
  from public.media_assets a
  where a.id = new.asset_id;
  if v_uploader is distinct from new.author_id or v_created is distinct from new.uploaded_at then
    raise exception 'coverage_item_author_mismatch' using errcode = '42501';
  end if;
  if new.revision <> 1 or new.archived_at is not null then
    raise exception 'coverage_item_must_start_open' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.coverage_submission_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.submission_id is distinct from old.submission_id
     or new.venue_id is distinct from old.venue_id
     or new.asset_id is distinct from old.asset_id
     or new.author_id is distinct from old.author_id
     or new.origin is distinct from old.origin
     or new.submitted_by is distinct from old.submitted_by
     or new.submitted_at is distinct from old.submitted_at
     or new.submitted_month is distinct from old.submitted_month
     or new.uploaded_at is distinct from old.uploaded_at
     or new.uploaded_month is distinct from old.uploaded_month
     -- The replacement link changes only when the item moves requirement.
     or (new.replaces_item_id is distinct from old.replaces_item_id
         and new.requirement_id is not distinct from old.requirement_id)
     or new.reconciled_from_item_id is distinct from old.reconciled_from_item_id then
    raise exception 'coverage_item_identity_immutable' using errcode = '42501';
  end if;
  if old.archived_at is not null and (
       new.archived_at is distinct from old.archived_at
       or new.archive_kind is distinct from old.archive_kind
       or new.requirement_id is distinct from old.requirement_id) then
    raise exception 'coverage_item_archived' using errcode = 'P0001';
  end if;
  -- A decision is final: only a submitted item is decided, and a decided item
  -- keeps its decision. Another photo is a new item (replaces_item_id).
  if (new.state is distinct from old.state
      and not (old.state = 'submitted' and new.state in ('accepted', 'needs_another_photo')))
     or (old.state <> 'submitted' and (
       new.decision_reason is distinct from old.decision_reason
       or new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at
       or new.self_review is distinct from old.self_review)) then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.state, new.state);
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- A live replacement answers a request (needs another photo) by the same
-- author on its own requirement, or both are monthly-only.
create function private.coverage_submission_items_replacement_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.replaces_item_id is null or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.replaces_item_id is not distinct from old.replaces_item_id
     and new.requirement_id is not distinct from old.requirement_id then
    return new;
  end if;
  if not exists (
    select 1 from public.coverage_submission_items r
    where r.id = new.replaces_item_id and r.venue_id = new.venue_id
      and r.author_id = new.author_id and r.state = 'needs_another_photo'
      and r.requirement_id is not distinct from new.requirement_id
  ) then
    raise exception 'coverage_item_replacement_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger venue_amenity_facts_guard
  before update on public.venue_amenity_facts
  for each row execute function private.venue_amenity_facts_guard();
create trigger venue_amenity_facts_set_updated_at
  before update on public.venue_amenity_facts
  for each row execute function private.set_updated_at();

create trigger menu_coverage_plans_guard
  before update on public.menu_coverage_plans
  for each row execute function private.menu_coverage_plans_guard();
create trigger menu_coverage_plans_set_updated_at
  before update on public.menu_coverage_plans
  for each row execute function private.set_updated_at();

create trigger coverage_requirements_guard
  before update on public.coverage_requirements
  for each row execute function private.coverage_requirements_guard();
create trigger coverage_requirements_set_updated_at
  before update on public.coverage_requirements
  for each row execute function private.set_updated_at();

create trigger coverage_requirement_assignees_insert_guard
  before insert on public.coverage_requirement_assignees
  for each row execute function private.coverage_requirement_assignees_insert_guard();
create trigger coverage_requirement_assignees_guard
  before update on public.coverage_requirement_assignees
  for each row execute function private.coverage_requirement_assignees_guard();

create trigger monthly_targets_guard
  before update on public.monthly_targets
  for each row execute function private.monthly_targets_guard();
create trigger monthly_targets_set_updated_at
  before update on public.monthly_targets
  for each row execute function private.set_updated_at();

create trigger coverage_submissions_immutable
  before update on public.coverage_submissions
  for each row execute function private.immutable_row_guard();

create trigger coverage_submission_items_insert_guard
  before insert on public.coverage_submission_items
  for each row execute function private.coverage_submission_items_insert_guard();
create trigger coverage_submission_items_guard
  before update on public.coverage_submission_items
  for each row execute function private.coverage_submission_items_guard();
create trigger coverage_submission_items_replacement_guard
  before insert or update on public.coverage_submission_items
  for each row execute function private.coverage_submission_items_replacement_guard();
create trigger coverage_submission_items_set_updated_at
  before update on public.coverage_submission_items
  for each row execute function private.set_updated_at();

-- History is never deleted: records stay for audit after a person leaves.
create trigger coverage_requirements_no_delete
  before delete on public.coverage_requirements
  for each row execute function private.append_only_guard();
create trigger coverage_requirement_assignees_no_delete
  before delete on public.coverage_requirement_assignees
  for each row execute function private.append_only_guard();
create trigger monthly_targets_no_delete
  before delete on public.monthly_targets
  for each row execute function private.append_only_guard();
create trigger coverage_submissions_no_delete
  before delete on public.coverage_submissions
  for each row execute function private.append_only_guard();
create trigger coverage_submission_items_no_delete
  before delete on public.coverage_submission_items
  for each row execute function private.append_only_guard();
create trigger menu_coverage_plans_no_delete
  before delete on public.menu_coverage_plans
  for each row execute function private.append_only_guard();

create trigger coverage_review_events_append_only
  before update or delete on public.coverage_review_events
  for each row execute function private.append_only_guard();
create trigger coverage_review_events_no_truncate
  before truncate on public.coverage_review_events
  for each statement execute function private.append_only_guard();
create trigger coverage_preparation_runs_append_only
  before update or delete on public.coverage_preparation_runs
  for each row execute function private.append_only_guard();
create trigger coverage_preparation_runs_no_truncate
  before truncate on public.coverage_preparation_runs
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Deactivation and transfer close personal assignments
-- ---------------------------------------------------------------------------

-- Pending items and past credit stay: only open assignments end, with a
-- reason, so the venue sees which requirements need reassigning.
create function private.profiles_end_coverage_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_reason text;
  v_actor uuid;
begin
  if new.active is distinct from old.active and not new.active then
    v_kind := 'deactivated';
    v_reason := 'Account deactivated.';
  elsif new.venue_id is distinct from old.venue_id then
    v_kind := 'transferred';
    v_reason := 'Moved to another venue.';
  elsif new.role is distinct from old.role and new.role <> 'staff' then
    v_kind := 'unassigned';
    v_reason := 'No longer a staff account.';
  else
    return null;
  end if;

  select p.id into v_actor from public.profiles p where p.id = auth.uid();

  with ended as (
    update public.coverage_requirement_assignees a
    set ended_at = now(), ended_by = v_actor, end_kind = v_kind, end_reason = v_reason
    where a.staff_id = new.id and a.ended_at is null
    returning a.id, a.venue_id, a.requirement_id
  )
  insert into public.coverage_audit_events (venue_id, entity, entity_id, actor_id, actor_role, action, reason, after)
  select e.venue_id, 'assignment', e.id, v_actor, private.coverage_actor_role(e.venue_id),
    'auto_ended', v_reason,
    jsonb_build_object('kind', v_kind, 'staffId', new.id, 'requirementId', e.requirement_id)
  from ended e;

  return null;
end;
$$;

create trigger profiles_end_coverage_assignments
  after update of venue_id, active, role on public.profiles
  for each row execute function private.profiles_end_coverage_assignments();

-- ---------------------------------------------------------------------------
-- Read helpers for policies
-- ---------------------------------------------------------------------------

-- Requirements the caller has (or had) their own photos on, at any venue.
create function private.own_item_requirement_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.requirement_id
  from public.coverage_submission_items i
  where i.author_id = (select auth.uid())
    and i.requirement_id is not null
    and private.is_active_user();
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on
  public.coverage_amenity_templates, public.venue_amenity_facts, public.venue_amenity_fact_media,
  public.menu_coverage_plans, public.coverage_requirements, public.coverage_requirement_assignees,
  public.monthly_targets, public.coverage_submissions, public.coverage_submission_items,
  public.coverage_review_events, public.coverage_preparation_runs
from public, anon, authenticated, service_role;

grant select on
  public.coverage_amenity_templates, public.venue_amenity_facts, public.venue_amenity_fact_media,
  public.menu_coverage_plans, public.coverage_requirements, public.coverage_requirement_assignees,
  public.monthly_targets, public.coverage_submissions, public.coverage_submission_items,
  public.coverage_review_events, public.coverage_preparation_runs
to authenticated;

grant select, insert, update on
  public.coverage_amenity_templates, public.venue_amenity_facts, public.menu_coverage_plans,
  public.coverage_requirements, public.coverage_requirement_assignees, public.monthly_targets,
  public.coverage_submission_items
to service_role;
grant select, insert on public.venue_amenity_fact_media to service_role;
grant select, insert on
  public.coverage_submissions, public.coverage_review_events, public.coverage_preparation_runs
to service_role;

alter table public.coverage_amenity_templates enable row level security;
alter table public.venue_amenity_facts enable row level security;
alter table public.venue_amenity_fact_media enable row level security;
alter table public.menu_coverage_plans enable row level security;
alter table public.coverage_requirements enable row level security;
alter table public.coverage_requirement_assignees enable row level security;
alter table public.monthly_targets enable row level security;
alter table public.coverage_submissions enable row level security;
alter table public.coverage_submission_items enable row level security;
alter table public.coverage_review_events enable row level security;
alter table public.coverage_preparation_runs enable row level security;

create policy coverage_amenity_templates_select on public.coverage_amenity_templates
  for select to authenticated using ((select private.is_active_user()));

-- Venue-wide operational records: admins everywhere, staff (managers
-- included) at their current venue.
create policy venue_amenity_facts_select on public.venue_amenity_facts
  for select to authenticated
  using ((select private.is_active_admin()) or venue_id = (select private.active_staff_venue_id()));
create policy venue_amenity_fact_media_select on public.venue_amenity_fact_media
  for select to authenticated
  using ((select private.is_active_admin()) or venue_id = (select private.active_staff_venue_id()));
create policy menu_coverage_plans_select on public.menu_coverage_plans
  for select to authenticated
  using ((select private.is_active_admin()) or venue_id = (select private.active_staff_venue_id()));
create policy coverage_requirements_select on public.coverage_requirements
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.active_staff_venue_id())
    or id in (select private.own_item_requirement_ids())
  );

-- Personal records: admins, the effective manager of the venue, the person.
create policy coverage_requirement_assignees_select on public.coverage_requirement_assignees
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (staff_id = (select auth.uid()) and (select private.is_active_user()))
  );
create policy monthly_targets_select on public.monthly_targets
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (staff_id = (select auth.uid()) and (select private.is_active_user()))
  );
create policy coverage_submissions_select on public.coverage_submissions
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (submitted_by = (select auth.uid()) and (select private.is_active_user()))
  );
create policy coverage_submission_items_select on public.coverage_submission_items
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (author_id = (select auth.uid()) and (select private.is_active_user()))
  );
create policy coverage_review_events_select on public.coverage_review_events
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (author_id = (select auth.uid()) and (select private.is_active_user()))
  );
create policy coverage_preparation_runs_select on public.coverage_preparation_runs
  for select to authenticated
  using (
    (select private.is_active_admin())
    or scope_venue_id = (select private.my_manager_venue_id())
  );

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.venue_amenity_facts_guard(),
  private.menu_coverage_plans_guard(),
  private.coverage_requirements_guard(),
  private.coverage_requirement_assignees_insert_guard(),
  private.coverage_requirement_assignees_guard(),
  private.monthly_targets_guard(),
  private.coverage_submission_items_insert_guard(),
  private.coverage_submission_items_guard(),
  private.coverage_submission_items_replacement_guard(),
  private.profiles_end_coverage_assignments(),
  private.own_item_requirement_ids()
from public, anon;

grant execute on function
  private.venue_amenity_facts_guard(),
  private.menu_coverage_plans_guard(),
  private.coverage_requirements_guard(),
  private.coverage_requirement_assignees_insert_guard(),
  private.coverage_requirement_assignees_guard(),
  private.monthly_targets_guard(),
  private.coverage_submission_items_insert_guard(),
  private.coverage_submission_items_guard(),
  private.coverage_submission_items_replacement_guard(),
  private.profiles_end_coverage_assignments(),
  private.own_item_requirement_ids()
to authenticated, service_role;
