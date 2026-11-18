-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-ADMIN (spec §8 A2; checklist A2-venue-crud, A2-timezone,
-- A2-operating-status, A2-reviewer-responsibility, A2-setup-checklist,
-- A2-templates, A2-scope-impact-preview; FA-33).
--
--   Venue        admins create and edit a venue's name, locality, address and
--                timezone (IANA, default Europe/London), and set its operating
--                status with a reason. Permanently closed archives the venue
--                (venues.active false, archived_at): every row it owns stays,
--                and private.venue_role_of already refuses an inactive venue,
--                so nobody but an admin reaches it. Reopening restores it.
--                Every change is a row in public.activity_events (S1-OPS),
--                which is append-only, with the before and after values.
--   Reviewers    The main and backup reviewer of a venue live in S2-MGR's
--                public.venue_reviewer_assignments (20261118113000, with
--                history and automatic handover); admins name them here. Only a person who reviews there today
--                (private.venue_role_of is manager or admin) can be named; a
--                named person who later loses that role still shows, marked
--                not eligible, and the setup checklist reopens.
--   Setup        private.venue_setup_checklist derives the five items of spec
--                §8 A2 from existing data; nothing is stored.
--   Templates    public.admin_venue_template_preview / _apply copy the group
--                catalogue's core amenity questions, or another venue's list
--                of questions and places, as new draft requirements
--                (unanswered checks and new places). Answers, facts, review
--                decisions, photos and scope never copy (AC23).
--   Scope        public.venue_scope_impact previews a collection-scope change
--                (S1-MENUS venue_scope_set): what would change in the venue's
--                coverage, before the reason is given (AC29).
--   MFA          public.admin_reset_mfa_authorise checks and records an
--                admin's reset of another person's lost authenticator; the
--                server then removes the factors with the Auth admin API.
--
-- Rollback: revoke execute on the public functions below. The venue columns
-- are additive and may stay.

-- ---------------------------------------------------------------------------
-- Venue columns
-- ---------------------------------------------------------------------------

alter table public.venues
  add column address text
    check (address is null or (length(address) between 1 and 300 and address = btrim(address))),
  add column revision integer not null default 1 check (revision >= 1),
  add column archived_at timestamptz,
  add column updated_at timestamptz not null default now();

comment on column public.venues.address is
  'S2-ADMIN: street address shown to admins and managers (spec §8 A2 location). Locality is the town.';
comment on column public.venues.archived_at is
  'S2-ADMIN: when an admin archived the closed venue (active false). History stays; NULL while it is not archived.';
comment on column public.venues.revision is
  'S2-ADMIN: bumped by every admin edit, for stale-edit protection.';

-- ---------------------------------------------------------------------------
-- Reviewers
-- ---------------------------------------------------------------------------

-- Coordinator merge (Sprint 2): S2-ADMIN and S2-MGR each built a reviewer
-- model. One store is kept, S2-MGR's public.venue_reviewer_assignments; this
-- migration reads and writes it.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.is_iana_timezone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_name is not null and p_name ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2}$'
    and exists (select 1 from pg_catalog.pg_timezone_names t where t.name = p_name);
$$;

-- A URL-safe slug from a name, unique among venues.
create function private.venue_slug_for(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text := left(btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-'), 70);
  v_slug text;
  v_n integer := 1;
begin
  if v_base = '' then
    v_base := 'venue';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.venues v where v.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

create function private.venue_json(p_venue public.venues)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_venue.id, 'name', p_venue.name, 'slug', p_venue.slug,
    'locality', p_venue.locality, 'address', p_venue.address,
    'timezone', p_venue.timezone, 'operatingStatus', p_venue.operating_status,
    'active', p_venue.active, 'archivedAt', p_venue.archived_at,
    'revision', p_venue.revision, 'createdAt', p_venue.created_at,
    'updatedAt', p_venue.updated_at);
$$;

-- The named reviewers, each with whether they still review at the venue.
-- revision counts the role's assignment events (each nomination and each end),
-- 0 when nobody holds the role, so a stale admin form is refused.
create function private.admin_venue_reviewer_revision(p_venue_id uuid, p_role text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.venue_reviewer_assignments a
                 where a.venue_id = p_venue_id and a.role = p_role and a.ended_at is null)
    then (select (count(*) + count(a.ended_at))::integer from public.venue_reviewer_assignments a
          where a.venue_id = p_venue_id and a.role = p_role)
    else 0 end;
$$;

create function private.admin_venue_reviewers_json(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'main', (
      select jsonb_build_object('profileId', a.profile_id, 'name', p.display_name,
        'eligible', private.venue_reviewer_eligible(a.profile_id, p_venue_id),
        'revision', private.admin_venue_reviewer_revision(p_venue_id, 'main'), 'setAt', a.assigned_at)
      from public.venue_reviewer_assignments a join public.profiles p on p.id = a.profile_id
      where a.venue_id = p_venue_id and a.role = 'main' and a.ended_at is null),
    'backup', (
      select jsonb_build_object('profileId', a.profile_id, 'name', p.display_name,
        'eligible', private.venue_reviewer_eligible(a.profile_id, p_venue_id),
        'revision', private.admin_venue_reviewer_revision(p_venue_id, 'backup'), 'setAt', a.assigned_at)
      from public.venue_reviewer_assignments a join public.profiles p on p.id = a.profile_id
      where a.venue_id = p_venue_id and a.role = 'backup' and a.ended_at is null));
$$;

-- Spec §8 A2 setup checklist, derived. Each item: key, done and the numbers
-- behind it. Coverage reads the one slot rule (S1-COV).
create function private.venue_setup_checklist(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_menu record;
  v_reviewers jsonb := private.admin_venue_reviewers_json(p_venue_id);
  v_staff integer;
  v_checks integer;
  v_unanswered integer;
  v_places integer;
  v_covered integer;
  v_items jsonb;
begin
  select m.id, m.title into v_menu from public.menu_versions m
  where m.venue_id = p_venue_id and m.status = 'active'
  order by m.activated_at desc limit 1;

  select count(*) into v_staff from public.venue_memberships vm
  join public.profiles p on p.id = vm.profile_id and p.active
  where vm.venue_id = p_venue_id and vm.ended_at is null;

  select count(*), count(*) filter (where c.answer = 'to_check')
  into v_checks, v_unanswered
  from public.venue_amenity_checks c
  where c.venue_id = p_venue_id and c.status = 'active';

  select count(*) into v_places from public.knowledge_subjects s
  where s.venue_id = p_venue_id and s.retired_at is null;

  select count(*) into v_covered from private.coverage_slot_rows(p_venue_id) r
  where r.state = 'covered';

  v_items := jsonb_build_array(
    jsonb_build_object('key', 'inventory', 'done', v_menu.id is not null,
      'menuVersionId', v_menu.id, 'menuTitle', v_menu.title),
    jsonb_build_object('key', 'reviewers',
      'done', coalesce((v_reviewers -> 'main' ->> 'eligible')::boolean, false)
        and coalesce((v_reviewers -> 'backup' ->> 'eligible')::boolean, false),
      'main', v_reviewers -> 'main' is not null and v_reviewers -> 'main' <> 'null'::jsonb,
      'backup', v_reviewers -> 'backup' is not null and v_reviewers -> 'backup' <> 'null'::jsonb),
    jsonb_build_object('key', 'staff', 'done', v_staff > 0, 'members', v_staff),
    jsonb_build_object('key', 'spaces', 'done', v_checks > 0 and v_unanswered = 0 and v_places > 0,
      'checks', v_checks, 'unanswered', v_unanswered, 'places', v_places),
    jsonb_build_object('key', 'collection', 'done', v_covered > 0, 'covered', v_covered)
  );
  return jsonb_build_object(
    'items', v_items,
    'done', (select count(*) from jsonb_array_elements(v_items) i where (i ->> 'done')::boolean),
    'total', jsonb_array_length(v_items));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (admins)
-- ---------------------------------------------------------------------------

create function public.admin_venues_list(p_include_archived boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.venue_json(v) || jsonb_build_object(
        'reviewers', private.admin_venue_reviewers_json(v.id),
        'setup', private.venue_setup_checklist(v.id))
      order by v.active desc, lower(v.name), v.id)
    from public.venues v
    where v.active or coalesce(p_include_archived, false)
  ), '[]'::jsonb));
end;
$$;

-- One venue: its fields, reviewers and setup, and the people who could be
-- named reviewer (they review there today).
create function public.admin_venue_detail(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  perform private.assert_active_admin();
  select v.* into v_venue from public.venues v where v.id = p_venue_id;
  if v_venue.id is null then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  return private.venue_json(v_venue) || jsonb_build_object(
    'reviewers', private.admin_venue_reviewers_json(v_venue.id),
    'setup', private.venue_setup_checklist(v_venue.id),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.display_name,
          'role', private.venue_role_of(p.id, v_venue.id))
        order by lower(p.display_name), p.id)
      from public.profiles p
      -- S2-MGR's rule (private.venue_reviewer_eligible): reviewers are the
      -- venue's managers; admins review every venue without being named.
      where p.active and private.venue_reviewer_eligible(p.id, v_venue.id)
    ), '[]'::jsonb));
end;
$$;

-- What archiving would affect: people whose access to this venue ends, and
-- open work that stays parked (nothing is deleted).
create function public.admin_venue_archive_impact(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'venueId', p_venue_id,
    'members', (select count(*) from public.venue_memberships vm
      join public.profiles p on p.id = vm.profile_id and p.active
      where vm.venue_id = p_venue_id and vm.ended_at is null),
    'onlyVenue', (select count(*) from public.venue_memberships vm
      join public.profiles p on p.id = vm.profile_id and p.active and p.role <> 'admin'
      where vm.venue_id = p_venue_id and vm.ended_at is null
        and not exists (select 1 from public.venue_memberships o
          join public.venues ov on ov.id = o.venue_id and ov.active
          where o.profile_id = vm.profile_id and o.ended_at is null and o.venue_id <> p_venue_id)),
    'scheduledMenus', (select count(*) from public.menu_versions m
      where m.venue_id = p_venue_id and m.status = 'draft' and m.scheduled_for is not null),
    'photos', (select count(*) from public.media_assets a
      where a.venue_id = p_venue_id and a.deleted_at is null),
    'destinations', (select count(*) from public.publication_destinations d
      where d.venue_id = p_venue_id and d.active));
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes (admins)
-- ---------------------------------------------------------------------------

-- Create (p_venue_id NULL) or edit a venue's name and location. p_revision
-- is the revision read (ignored on create). Same values again change
-- nothing.
create function public.admin_venue_save(
  p_venue_id uuid,
  p_name text,
  p_locality text,
  p_address text,
  p_timezone text,
  p_revision integer,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_name text := private.clean_text(p_name, 120, 'venue_name_too_long');
  v_locality text := private.clean_text(p_locality, 120, 'venue_locality_too_long');
  v_address text := private.clean_text(p_address, 300, 'venue_address_too_long');
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'Europe/London');
  v_reason text := private.clean_text(p_reason, 500, 'reason_too_long');
  v_old public.venues;
  v_new public.venues;
begin
  if v_name is null then
    raise exception 'venue_name_required' using errcode = '22023';
  end if;
  if not private.is_iana_timezone(v_tz) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if exists (select 1 from public.venues v
      where lower(v.name) = lower(v_name) and v.id is distinct from p_venue_id) then
    raise exception 'venue_name_taken' using errcode = '23505';
  end if;

  if p_venue_id is null then
    insert into public.venues (name, slug, locality, address, timezone)
    values (v_name, private.venue_slug_for(v_name), v_locality, v_address, v_tz)
    returning * into v_new;
    perform private.record_activity(v_new.id, 'venue_created', 'venue', v_new.id::text,
      null, v_new.revision, v_reason, null,
      jsonb_build_object('name', v_new.name, 'locality', v_new.locality,
        'address', v_new.address, 'timezone', v_new.timezone));
    return private.venue_json(v_new) || jsonb_build_object('changed', true, 'created', true);
  end if;

  select v.* into v_old from public.venues v where v.id = p_venue_id for update;
  if v_old.id is null then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if v_old.revision is distinct from p_revision then
    raise exception 'venue_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_old.revision)::text;
  end if;
  if v_old.name = v_name and v_old.locality is not distinct from v_locality
     and v_old.address is not distinct from v_address and v_old.timezone = v_tz then
    return private.venue_json(v_old) || jsonb_build_object('changed', false, 'created', false);
  end if;

  update public.venues v
  set name = v_name, locality = v_locality, address = v_address, timezone = v_tz,
      revision = v.revision + 1, updated_at = now()
  where v.id = p_venue_id
  returning * into v_new;
  perform private.record_activity(v_new.id, 'venue_updated', 'venue', v_new.id::text,
    v_old.revision, v_new.revision, v_reason,
    jsonb_build_object('name', v_old.name, 'locality', v_old.locality,
      'address', v_old.address, 'timezone', v_old.timezone),
    jsonb_build_object('name', v_new.name, 'locality', v_new.locality,
      'address', v_new.address, 'timezone', v_new.timezone));
  return private.venue_json(v_new) || jsonb_build_object('changed', true, 'created', false);
end;
$$;

-- Operating status with a reason. permanently_closed archives the venue;
-- leaving it restores the venue. History is never removed.
create function public.admin_venue_set_status(
  p_venue_id uuid, p_status text, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.clean_text(p_reason, 500, 'reason_too_long');
  v_old public.venues;
  v_new public.venues;
begin
  if p_status is null or p_status not in ('open', 'temporarily_closed', 'permanently_closed') then
    raise exception 'invalid_operating_status' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select v.* into v_old from public.venues v where v.id = p_venue_id for update;
  if v_old.id is null then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if v_old.revision is distinct from p_revision then
    raise exception 'venue_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_old.revision)::text;
  end if;
  if v_old.operating_status = p_status then
    return private.venue_json(v_old) || jsonb_build_object('changed', false);
  end if;

  update public.venues v
  set operating_status = p_status,
      active = p_status <> 'permanently_closed',
      archived_at = case when p_status = 'permanently_closed' then now() end,
      revision = v.revision + 1, updated_at = now()
  where v.id = p_venue_id
  returning * into v_new;
  perform private.record_activity(v_new.id,
    case
      when p_status = 'permanently_closed' then 'venue_archived'
      when v_old.operating_status = 'permanently_closed' then 'venue_restored'
      else 'venue_status_changed'
    end,
    'venue', v_new.id::text, v_old.revision, v_new.revision, v_reason,
    jsonb_build_object('operatingStatus', v_old.operating_status, 'active', v_old.active),
    jsonb_build_object('operatingStatus', v_new.operating_status, 'active', v_new.active));
  return private.venue_json(v_new) || jsonb_build_object('changed', true);
end;
$$;

-- Name (p_profile_id) or clear (NULL) the main or backup reviewer.
-- p_revision is the revision read, 0 when none is named.
create function public.admin_set_venue_reviewer(
  p_venue_id uuid, p_responsibility text, p_profile_id uuid, p_reason text, p_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.clean_text(p_reason, 500, 'reason_too_long');
  v_old uuid;
  v_other uuid;
  v_revision integer;
begin
  if p_responsibility is null or p_responsibility not in ('main', 'backup') then
    raise exception 'invalid_responsibility' using errcode = '22023';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  -- The same lock S2-MGR's set_venue_reviewer takes.
  perform 1 from public.venues v where v.id = p_venue_id for update;
  v_revision := private.admin_venue_reviewer_revision(p_venue_id, p_responsibility);
  if v_revision is distinct from p_revision then
    raise exception 'reviewer_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  select a.profile_id into v_old from public.venue_reviewer_assignments a
  where a.venue_id = p_venue_id and a.role = p_responsibility and a.ended_at is null;
  if v_old is not distinct from p_profile_id then
    return jsonb_build_object('changed', false, 'reviewers', private.admin_venue_reviewers_json(p_venue_id));
  end if;
  if p_profile_id is not null then
    select a.profile_id into v_other from public.venue_reviewer_assignments a
    where a.venue_id = p_venue_id and a.role <> p_responsibility and a.ended_at is null;
    if v_other = p_profile_id then
      raise exception 'reviewer_same_person' using errcode = '22023';
    end if;
  end if;
  -- Eligibility, history and handover are S2-MGR's (reviewer_not_eligible).
  perform public.set_venue_reviewer(p_venue_id, p_responsibility, p_profile_id, v_reason);
  perform private.record_activity(p_venue_id, 'venue_reviewer_set', 'venue_reviewer',
    p_venue_id::text || ':' || p_responsibility, v_revision,
    private.admin_venue_reviewer_revision(p_venue_id, p_responsibility), v_reason,
    jsonb_build_object('responsibility', p_responsibility, 'profileId', v_old),
    jsonb_build_object('responsibility', p_responsibility, 'profileId', p_profile_id));
  return jsonb_build_object('changed', true, 'reviewers', private.admin_venue_reviewers_json(p_venue_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Templates (AC23): only the list of what is needed copies
-- ---------------------------------------------------------------------------

-- The questions and places a template would add at p_venue_id. Source NULL:
-- the group catalogue's core questions. Otherwise another venue's active
-- questions and places. Nothing already at the venue is listed.
create function private.venue_template_rows(p_venue_id uuid, p_source_venue_id uuid)
returns table (kind text, key text, label text, place_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'question'::text, t.key, t.question, null::text
  from public.amenity_catalogue t
  where (
      (p_source_venue_id is null and t.is_core)
      or exists (select 1 from public.venue_amenity_checks c
        where c.venue_id = p_source_venue_id and c.template_key = t.key and c.status = 'active')
    )
    and not exists (select 1 from public.venue_amenity_checks c
      where c.venue_id = p_venue_id and c.template_key = t.key and c.status = 'active')
  union all
  select 'place', null, s.label, s.kind
  from public.knowledge_subjects s
  where p_source_venue_id is not null and s.venue_id = p_source_venue_id and s.retired_at is null
    and not exists (select 1 from public.knowledge_subjects x
      where x.venue_id = p_venue_id and x.kind = s.kind and lower(x.label) = lower(s.label)
        and x.retired_at is null);
$$;

create function private.venue_template_assert(p_venue_id uuid, p_source_venue_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.active) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_source_venue_id is not null and (p_source_venue_id = p_venue_id
      or not exists (select 1 from public.venues v where v.id = p_source_venue_id)) then
    raise exception 'template_source_invalid' using errcode = '22023';
  end if;
end;
$$;

create function public.admin_venue_template_preview(p_venue_id uuid, p_source_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();
  perform private.venue_template_assert(p_venue_id, p_source_venue_id);
  return jsonb_build_object(
    'venueId', p_venue_id, 'sourceVenueId', p_source_venue_id,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'label', r.label) order by r.label)
      from private.venue_template_rows(p_venue_id, p_source_venue_id) r where r.kind = 'question'), '[]'::jsonb),
    'places', coalesce((select jsonb_agg(jsonb_build_object('label', r.label, 'kind', r.place_kind) order by r.label)
      from private.venue_template_rows(p_venue_id, p_source_venue_id) r where r.kind = 'place'), '[]'::jsonb));
end;
$$;

-- Adds the previewed questions (unanswered checks on the venue's working
-- list) and places. Never copies an answer, fact, decision, photo or scope.
create function public.admin_venue_apply_template(
  p_venue_id uuid, p_source_venue_id uuid, p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.clean_text(p_reason, 500, 'reason_too_long');
  v_row record;
  v_check_id uuid;
  v_status text;
  v_keys text[] := '{}';
  v_questions integer := 0;
  v_places integer := 0;
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  perform private.venue_template_assert(p_venue_id, p_source_venue_id);
  perform private.lock_amenity_venue(p_venue_id);

  insert into public.venue_amenity_settings (venue_id, enabled_by)
  values (p_venue_id, v_uid)
  on conflict (venue_id) do nothing;

  for v_row in select * from private.venue_template_rows(p_venue_id, p_source_venue_id) r loop
    if v_row.kind = 'question' then
      select c.id, c.status into v_check_id, v_status from public.venue_amenity_checks c
      where c.venue_id = p_venue_id and c.template_key = v_row.key for update;
      if v_check_id is null then
        insert into public.venue_amenity_checks (venue_id, template_key, created_by)
        values (p_venue_id, v_row.key, v_uid)
        returning id into v_check_id;
        perform private.amenity_event(v_check_id, p_venue_id, 'added', null,
          jsonb_build_object('source', 'template', 'sourceVenueId', p_source_venue_id));
      elsif v_status = 'archived' then
        update public.venue_amenity_checks c
        set status = 'active', revision = c.revision + 1
        where c.id = v_check_id;
        perform private.amenity_event(v_check_id, p_venue_id, 'restored', null,
          jsonb_build_object('source', 'template'));
      end if;
      if exists (select 1 from public.knowledge_question_rules q where q.question_key = v_row.key) then
        v_keys := v_keys || v_row.key;
      end if;
      v_questions := v_questions + 1;
      v_check_id := null;
      v_status := null;
    else
      insert into public.knowledge_subjects (venue_id, kind, label, created_by)
      values (p_venue_id, v_row.place_kind, v_row.label, v_uid);
      v_places := v_places + 1;
    end if;
  end loop;

  if cardinality(v_keys) > 0 then
    perform public.knowledge_set_working_list(p_venue_id, v_keys, true, v_reason);
  end if;

  if v_questions + v_places > 0 then
    perform private.record_activity(p_venue_id, 'venue_template_applied', 'venue', p_venue_id::text,
      null, null, v_reason, null,
      jsonb_build_object('sourceVenueId', p_source_venue_id, 'questions', v_questions, 'places', v_places));
  end if;
  return jsonb_build_object('questions', v_questions, 'places', v_places);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scope impact (AC29)
-- ---------------------------------------------------------------------------

-- What a venue_scope_set change would do to the venue's coverage. Today no
-- requirement source is gated by a scope key yet (S1-MENUS gate), so slot
-- totals do not move; the preview says so with numbers instead of guessing.
-- A future gated source adds its rows here.
create function public.venue_scope_impact(p_venue_id uuid, p_key text, p_applicable boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current boolean;
  v_totals jsonb;
begin
  perform private.assert_active_admin();
  if p_key is null or p_key not in ('accommodation') then
    raise exception 'invalid_scope_key' using errcode = '22023';
  end if;
  if p_applicable is null then
    raise exception 'invalid_applicable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_current := private.venue_scope_applies(p_venue_id, p_key);
  v_totals := private.coverage_slots_json(p_venue_id) -> 'totals';
  return jsonb_build_object(
    'venueId', p_venue_id, 'key', p_key,
    'applicableBefore', v_current, 'applicableAfter', p_applicable,
    'changes', v_current is distinct from p_applicable,
    'slotsBefore', coalesce((v_totals ->> 'total')::integer, 0),
    'coveredBefore', coalesce((v_totals ->> 'covered')::integer, 0),
    -- Requirements gated by this key: none exist yet, so nothing is added or removed.
    'slotsAdded', 0,
    'slotsRemoved', 0,
    'roomPlaces', (select count(*) from public.knowledge_subjects s
      where s.venue_id = p_venue_id and s.kind = 'room' and s.retired_at is null));
end;
$$;

-- ---------------------------------------------------------------------------
-- MFA reset (FA-23, S1-PRIVACY hand-off)
-- ---------------------------------------------------------------------------

-- An admin resets another person's second factor (a lost phone). Checks and
-- records the reset; the server removes the factors with the Auth admin API
-- right after. Never one's own (that needs another admin).
create function public.admin_reset_mfa_authorise(p_profile_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text := private.clean_text(p_reason, 500, 'reason_too_long');
  v_target public.profiles;
  v_factors integer;
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id;
  if v_target.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if v_target.id = v_uid then
    raise exception 'mfa_reset_self' using errcode = '42501';
  end if;
  select count(*) into v_factors from auth.mfa_factors f where f.user_id = p_profile_id;
  perform private.record_activity(v_target.venue_id, 'mfa_reset', 'profile', p_profile_id::text,
    null, null, v_reason, jsonb_build_object('factors', v_factors), jsonb_build_object('factors', 0));
  return jsonb_build_object('profileId', p_profile_id, 'factors', v_factors);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  private.is_iana_timezone(text),
  private.venue_slug_for(text),
  private.venue_json(public.venues),
  private.admin_venue_reviewer_revision(uuid, text),
  private.admin_venue_reviewers_json(uuid),
  private.venue_setup_checklist(uuid),
  private.venue_template_rows(uuid, uuid),
  private.venue_template_assert(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.admin_venues_list(boolean),
  public.admin_venue_detail(uuid),
  public.admin_venue_archive_impact(uuid),
  public.admin_venue_save(uuid, text, text, text, text, integer, text),
  public.admin_venue_set_status(uuid, text, text, integer),
  public.admin_set_venue_reviewer(uuid, text, uuid, text, integer),
  public.admin_venue_template_preview(uuid, uuid),
  public.admin_venue_apply_template(uuid, uuid, text),
  public.venue_scope_impact(uuid, text, boolean),
  public.admin_reset_mfa_authorise(uuid, text)
from public, anon, service_role;

grant execute on function
  public.admin_venues_list(boolean),
  public.admin_venue_detail(uuid),
  public.admin_venue_archive_impact(uuid),
  public.admin_venue_save(uuid, text, text, text, text, integer, text),
  public.admin_venue_set_status(uuid, text, text, integer),
  public.admin_set_venue_reviewer(uuid, text, uuid, text, integer),
  public.admin_venue_template_preview(uuid, uuid),
  public.admin_venue_apply_template(uuid, uuid, text),
  public.venue_scope_impact(uuid, text, boolean),
  public.admin_reset_mfa_authorise(uuid, text)
to authenticated;
