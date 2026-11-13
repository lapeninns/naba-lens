-- B05-m1: purpose-specific use grants (contracts/b05-design.md §2, tasks
-- B05-02a to B05-02g; build brief §13.2).
--
-- * media_assets.use_baseline: every row that exists when this runs reads
--   'legacy_unknown' through a constant default (metadata only: no UPDATE, no
--   trigger, no updated_at change). New rows default to 'none'. The value is
--   fixed: an unconditional BEFORE UPDATE guard compares OLD and NEW (L1).
-- * private.media_use_settings records the cutover. A BEFORE INSERT trigger
--   turns a row created before the cutover (a restore or a re-import that
--   keeps created_at) into 'legacy_unknown' (L2). Replica-mode loads bypass
--   triggers; scripts/db/check-use-baseline.sql checks them instead.
-- * Tables: media_use_destinations (registry; rows by migration only,
--   WS5 signs off the columns), media_use_granters (named granters, left
--   empty until the owner names people, OD-B5-1), media_use_grants and
--   media_use_grant_withdrawals (append-only). A grant's state is computed at
--   read time: scheduled, in_force, expired or withdrawn.
-- * private.media_use_clearance_versions holds the clearance checklist
--   versions. The proposed checklist (OD-B5-4) is seeded inactive: no grant
--   can be created until the owner approves a version.
-- * Commands media_use_grant_create, media_use_grant_withdraw and
--   media_use_withdraw_asset (request key and replay); read asset_use_status;
--   helper private.media_asset_use_summary(uuid, text) for WS1's B05-m5.
-- * Public grants are refused with profile_unavailable until B05-m2 adds the
--   derivative profiles. amenity_illustration is refused with
--   subject_not_publishable until WS1's K2 eligibility check exists.
-- * Nothing here creates a grant from anything else: no trigger, and no
--   existing function is re-created. Credit functions are untouched.
--
-- Rollback: switch the app's publicUseGrants off AND keep (or set) every
-- clearance version inactive. The switch gates only the app; with no active
-- version media_use_grant_create refuses every call, including direct RPC
-- calls by admins or named granters. Withdrawal keeps working. The tables
-- stay (append-only records).

-- ---------------------------------------------------------------------------
-- Baseline (B05-02a)
-- ---------------------------------------------------------------------------

alter table public.media_assets
  add column use_baseline text not null default 'legacy_unknown'
    constraint media_assets_use_baseline_check check (use_baseline in ('legacy_unknown', 'none'));
alter table public.media_assets alter column use_baseline set default 'none';

comment on column public.media_assets.use_baseline is
  'Use state before any grant: legacy_unknown for content that existed before B05-m1, none for later uploads. Fixed once set; never implies permission.';

create table private.media_use_settings (
  singleton boolean primary key default true check (singleton),
  cutover_at timestamptz not null
);
insert into private.media_use_settings (cutover_at) values (now());

create trigger media_use_settings_append_only
  before update or delete on private.media_use_settings
  for each row execute function private.append_only_guard();
create trigger media_use_settings_no_truncate
  before truncate on private.media_use_settings
  for each statement execute function private.append_only_guard();
revoke all on private.media_use_settings from public, anon, authenticated, service_role;

create function private.media_assets_use_baseline_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.use_baseline is distinct from old.use_baseline then
    raise exception 'media_asset_reservation_immutable' using errcode = '42501',
      detail = 'The use baseline is fixed.';
  end if;
  return new;
end;
$$;

-- No column list: an UPDATE that does not name use_baseline is checked too.
create trigger media_assets_use_baseline_guard
  before update on public.media_assets
  for each row execute function private.media_assets_use_baseline_guard();

-- Definer: the cutover row is private, and service-role and function inserts
-- must all see it.
create function private.media_assets_use_baseline_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_at < (select s.cutover_at from private.media_use_settings s) then
    new.use_baseline := 'legacy_unknown';
  end if;
  return new;
end;
$$;

create trigger media_assets_use_baseline_on_insert
  before insert on public.media_assets
  for each row execute function private.media_assets_use_baseline_on_insert();

revoke all on function
  private.media_assets_use_baseline_guard(),
  private.media_assets_use_baseline_on_insert()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registry, granters, clearance (B05-02b; OD-B5-1, OD-B5-4)
-- ---------------------------------------------------------------------------

create table public.media_use_destinations (
  key text primary key check (key ~ '^[a-z0-9_]{3,64}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  audience text not null check (audience in ('internal', 'public')),
  venue_id uuid references public.venues (id) on delete restrict,
  owner_workstream text not null check (owner_workstream ~ '^WS[0-9]{1,2}$'),
  requires_derivative boolean not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint media_use_destinations_public_derivative check (audience = 'internal' or requires_derivative)
);

comment on table public.media_use_destinations is
  'Registered places a granted asset may be used. Rows by migration only; venue_id null means organisation-wide.';

-- Only the label and the active switch may change; a key keeps its meaning.
create function private.media_use_destinations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'row_immutable' using errcode = '42501',
      detail = 'Destinations are deactivated, never deleted.';
  end if;
  if new.key is distinct from old.key or new.audience is distinct from old.audience
     or new.venue_id is distinct from old.venue_id
     or new.owner_workstream is distinct from old.owner_workstream
     or new.requires_derivative is distinct from old.requires_derivative
     or new.created_at is distinct from old.created_at then
    raise exception 'row_immutable' using errcode = '42501',
      detail = 'Only a destination''s label and active flag change.';
  end if;
  return new;
end;
$$;

create trigger media_use_destinations_guard
  before update or delete on public.media_use_destinations
  for each row execute function private.media_use_destinations_guard();
create trigger media_use_destinations_no_truncate
  before truncate on public.media_use_destinations
  for each statement execute function private.append_only_guard();

-- Named public-use granters (X4). Built empty; the owner names people.
create table public.media_use_granters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  venue_id uuid references public.venues (id) on delete restrict,
  granted_by uuid not null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint media_use_granters_period check (revoked_at is null or revoked_at >= granted_at)
);
create unique index media_use_granters_open
  on public.media_use_granters (profile_id, coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

comment on table public.media_use_granters is
  'People the owner named as public-use granters (OD-B5-1). venue_id null means every venue. Empty until the owner decides.';

-- A granter row is only ever revoked, once.
create function private.media_use_granters_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.revoked_at is not null or new.revoked_at is null
     or new.id is distinct from old.id or new.profile_id is distinct from old.profile_id
     or new.venue_id is distinct from old.venue_id or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at then
    raise exception 'row_immutable' using errcode = '42501',
      detail = 'A granter row is only revoked, once.';
  end if;
  return new;
end;
$$;

create trigger media_use_granters_guard
  before update or delete on public.media_use_granters
  for each row execute function private.media_use_granters_guard();
create trigger media_use_granters_no_truncate
  before truncate on public.media_use_granters
  for each statement execute function private.append_only_guard();

-- Clearance checklist versions (OD-B5-4). A grant attests every key of an
-- active version as true. The checklist is a control the granter attests,
-- not a right.
create table private.media_use_clearance_versions (
  version text primary key check (version ~ '^[a-z0-9_.-]{1,40}$'),
  keys text[] not null check (cardinality(keys) between 1 and 20),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
revoke all on private.media_use_clearance_versions from public, anon, authenticated, service_role;

insert into private.media_use_clearance_versions (version, keys, active) values (
  'proposal-1',
  array['no_identifiable_guest_without_consent', 'no_identifiable_staff_without_agreement',
    'no_children', 'no_screens_documents_card_machines_or_credentials', 'not_misleading_about_item'],
  false
);

-- ---------------------------------------------------------------------------
-- Grants and withdrawals (B05-02c)
-- ---------------------------------------------------------------------------

create table public.media_use_grants (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  venue_id uuid not null,
  destination_key text not null references public.media_use_destinations (key) on delete restrict,
  audience text not null check (audience in ('internal', 'public')),
  purpose text not null check (purpose in ('menu_item_image', 'venue_feature_image', 'amenity_illustration', 'general_gallery')),
  subject_kind text not null check (subject_kind in ('menu_item', 'question', 'none')),
  subject_id uuid,
  subject_key text,
  derivative_profile_key text,
  effective_from timestamptz not null,
  effective_until timestamptz,
  authorised_by uuid not null references public.profiles (id) on delete restrict,
  authority_basis text not null check (authority_basis in ('admin', 'named_granter')),
  clearance_version text not null,
  clearance jsonb not null check (jsonb_typeof(clearance) = 'object'),
  internal_note text check (internal_note is null or length(internal_note) <= 500),
  reused_from_grant_id uuid,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz not null default now(),
  constraint media_use_grants_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_use_grants_request_key unique (authorised_by, request_key),
  constraint media_use_grants_id_asset_key unique (id, asset_id),
  -- Reuse (B05-06) is another grant on the same asset, never a copy.
  constraint media_use_grants_reused_fkey foreign key (reused_from_grant_id, asset_id)
    references public.media_use_grants (id, asset_id) on delete restrict,
  constraint media_use_grants_subject check ((subject_kind = 'none') = (subject_id is null)),
  constraint media_use_grants_subject_key check ((subject_kind = 'question') = (subject_key is not null)),
  constraint media_use_grants_public_profile check (audience = 'internal' or derivative_profile_key is not null),
  constraint media_use_grants_period check (effective_until is null or effective_until > effective_from)
);
create index media_use_grants_asset_idx on public.media_use_grants (asset_id);
create index media_use_grants_destination_idx on public.media_use_grants (destination_key);

create table public.media_use_grant_withdrawals (
  grant_id uuid primary key references public.media_use_grants (id) on delete restrict,
  withdrawn_by uuid references public.profiles (id) on delete restrict,
  reason_code text not null check (reason_code in ('granter_withdrawn', 'asset_deleted', 'clearance_failed', 'subject_changed', 'owner_request', 'superseded')),
  internal_note text check (internal_note is null or length(internal_note) <= 500),
  request_key text check (request_key is null or request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  withdrawn_at timestamptz not null default now(),
  constraint media_use_grant_withdrawals_person check ((withdrawn_by is null) = (reason_code = 'asset_deleted'))
);
create index media_use_grant_withdrawals_key_idx
  on public.media_use_grant_withdrawals (withdrawn_by, request_key)
  where request_key is not null;

-- One row per withdrawal request key: which command used it, for which
-- target and with which reason and note. Both withdrawal commands share the
-- key space, so a key replays only for the same command, target and payload.
create table public.media_use_withdraw_requests (
  requested_by uuid not null references public.profiles (id) on delete restrict,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  command text not null check (command in ('grant', 'asset')),
  target_id uuid not null,
  reason_code text not null,
  internal_note text check (internal_note is null or length(internal_note) <= 500),
  created_at timestamptz not null default now(),
  primary key (requested_by, request_key)
);

do $$
declare
  t text;
begin
  foreach t in array array['media_use_grants', 'media_use_grant_withdrawals', 'media_use_withdraw_requests'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

revoke all on public.media_use_destinations, public.media_use_granters, public.media_use_grants,
  public.media_use_grant_withdrawals, public.media_use_withdraw_requests
from public, anon, authenticated, service_role;
grant select on public.media_use_destinations, public.media_use_granters, public.media_use_grants,
  public.media_use_grant_withdrawals, public.media_use_withdraw_requests
to service_role;
alter table public.media_use_destinations enable row level security;
alter table public.media_use_granters enable row level security;
alter table public.media_use_grants enable row level security;
alter table public.media_use_grant_withdrawals enable row level security;
alter table public.media_use_withdraw_requests enable row level security;

revoke all on function
  private.media_use_destinations_guard(),
  private.media_use_granters_guard()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- State (read time; no job)
-- ---------------------------------------------------------------------------

create function private.media_use_grant_state(p_grant public.media_use_grants, p_now timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = p_grant.id) then 'withdrawn'
    when p_grant.effective_until is not null and p_grant.effective_until <= p_now then 'expired'
    when p_grant.effective_from > p_now then 'scheduled'
    else 'in_force'
  end;
$$;

-- The asset's use state: granted (any grant in force), withdrawn (a
-- withdrawn grant and none in force), otherwise its baseline. Null for an
-- unknown asset.
create function private.media_asset_use_state(p_asset_id uuid, p_now timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when bool_or(st.state = 'in_force') then 'granted'
    when bool_or(st.state = 'withdrawn') then 'withdrawn'
    when a.use_baseline = 'legacy_unknown' then 'legacy_unknown'
    else 'not_granted'
  end
  from public.media_assets a
  left join lateral (
    select private.media_use_grant_state(g, p_now) as state
    from public.media_use_grants g where g.asset_id = a.id
  ) st on true
  where a.id = p_asset_id
  group by a.id, a.use_baseline;
$$;

-- Fixed signature for WS1's B05-m5 (contribution_group, feed_photo_json).
-- 'full': {state, inForce, withdrawn, destinations: [{label, state, until}]}.
-- 'uploader': {state, destinations: [label]} with the labels of grants in
-- force; no granter, period or note.
create function private.media_asset_use_summary(p_asset_id uuid, p_view text default 'full')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text := private.media_asset_use_state(p_asset_id, now());
begin
  if v_state is null then
    return null;
  end if;
  if p_view = 'uploader' then
    return jsonb_build_object(
      'state', v_state,
      'destinations', coalesce((
        select jsonb_agg(x.label order by x.label)
        from (
          select distinct d.label
          from public.media_use_grants g
          join public.media_use_destinations d on d.key = g.destination_key
          where g.asset_id = p_asset_id and private.media_use_grant_state(g, now()) = 'in_force'
        ) x), '[]'::jsonb));
  end if;
  if p_view is distinct from 'full' then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  return (
    select jsonb_build_object(
      'state', v_state,
      'inForce', count(*) filter (where s.state = 'in_force'),
      'withdrawn', count(*) filter (where s.state = 'withdrawn'),
      'destinations', coalesce(jsonb_agg(jsonb_build_object(
          'label', s.label, 'state', s.state, 'until', s.effective_until)
          order by s.label, s.created_at) filter (where s.id is not null), '[]'::jsonb))
    from (
      select g.id, g.created_at, g.effective_until, d.label, private.media_use_grant_state(g, now()) as state
      from public.media_use_grants g
      join public.media_use_destinations d on d.key = g.destination_key
      where g.asset_id = p_asset_id
    ) s
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Authority (OD-B5-1, OD-B5-2)
-- ---------------------------------------------------------------------------

-- The caller may authorise use at this venue: an active admin, or an active
-- named granter for this venue or for every venue.
create function private.can_grant_public_use(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_admin() or (
    private.is_active_user() and exists (
      select 1 from public.media_use_granters r
      where r.profile_id = (select auth.uid()) and r.revoked_at is null
        and (r.venue_id is null or r.venue_id = p_venue_id)
    )
  );
$$;

-- True when the caller could grant anywhere. Checked before any asset is
-- read, so a refusal says nothing about which assets exist.
create function private.is_any_public_use_granter()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_admin() or (
    private.is_active_user() and exists (
      select 1 from public.media_use_granters r
      where r.profile_id = (select auth.uid()) and r.revoked_at is null
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Commands (B05-02d)
-- ---------------------------------------------------------------------------

-- Creates one grant. Replays by request key; the same key with a different
-- payload is idempotency_key_reused. A deleted, unready, other-venue or
-- unknown asset is media_asset_not_found, the same for each.
create function public.media_use_grant_create(
  p_request_key text,
  p_asset_id uuid,
  p_destination_key text,
  p_purpose text,
  p_subject_kind text,
  p_subject_id uuid,
  p_profile_key text,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_clearance_version text,
  p_clearance jsonb,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_now timestamptz := now();
  v_from timestamptz := coalesce(p_effective_from, now());
  v_note text := nullif(btrim(p_note), '');
  v_grant public.media_use_grants;
  v_asset public.media_assets;
  v_dest public.media_use_destinations;
  v_keys text[];
  v_kind text;
  v_subject_key text;
  v_k2 regprocedure;
  v_eligible jsonb;
begin
  if not private.is_any_public_use_granter() then
    raise exception 'not_public_use_granter' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_media_use_grant:' || v_uid::text || ':' || p_request_key, 0));
  select g.* into v_grant from public.media_use_grants g
  where g.authorised_by = v_uid and g.request_key = p_request_key;
  if found then
    if v_grant.asset_id is distinct from p_asset_id
       or v_grant.destination_key is distinct from p_destination_key
       or v_grant.purpose is distinct from p_purpose
       or v_grant.subject_kind is distinct from p_subject_kind
       or v_grant.subject_id is distinct from p_subject_id
       or v_grant.derivative_profile_key is distinct from p_profile_key
       or (p_effective_from is not null and v_grant.effective_from is distinct from p_effective_from)
       or v_grant.effective_until is distinct from p_effective_until
       or v_grant.clearance_version is distinct from p_clearance_version
       or v_grant.clearance is distinct from p_clearance
       or v_grant.internal_note is distinct from v_note then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object('grantId', v_grant.id,
      'state', private.media_use_grant_state(v_grant, v_now), 'replayed', true);
  end if;

  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for share;
  if not found or v_asset.deleted_at is not null or v_asset.upload_state <> 'ready'
     or not private.can_grant_public_use(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.uploader_id = v_uid then
    raise exception 'own_upload_not_grantable' using errcode = '42501';
  end if;

  select d.* into v_dest from public.media_use_destinations d where d.key = p_destination_key;
  if not found or not v_dest.active or (v_dest.venue_id is not null and v_dest.venue_id <> v_asset.venue_id) then
    raise exception 'use_destination_unavailable' using errcode = 'P0002';
  end if;

  if p_purpose is null or p_purpose not in ('menu_item_image', 'venue_feature_image', 'amenity_illustration', 'general_gallery') then
    raise exception 'invalid_use_purpose' using errcode = '22023';
  end if;
  v_kind := case p_purpose
    when 'menu_item_image' then 'menu_item'
    when 'amenity_illustration' then 'question'
    else 'none'
  end;
  if p_subject_kind is distinct from v_kind or (p_subject_kind = 'none') <> (p_subject_id is null) then
    raise exception 'invalid_use_subject' using errcode = '22023';
  end if;
  if p_subject_kind = 'menu_item'
     and not private.contribution_subject_exists(v_asset.venue_id, 'menu_item', p_subject_id) then
    raise exception 'use_subject_not_found' using errcode = 'P0002';
  end if;
  if p_subject_kind = 'question' then
    select c.template_key into v_subject_key from public.venue_amenity_checks c
    where c.id = p_subject_id and c.venue_id = v_asset.venue_id and c.status = 'active';
    if v_subject_key is null then
      raise exception 'use_subject_not_found' using errcode = 'P0002';
    end if;
    -- WS1's K2 (B03-e), called only if present. Missing means not eligible,
    -- so this fails closed.
    v_k2 := to_regprocedure('private.knowledge_public_media_eligible(uuid,text,timestamptz)');
    if v_k2 is null then
      raise exception 'subject_not_publishable' using errcode = 'P0001';
    end if;
    execute format('select %s($1, $2, $3)', v_k2::oid::regproc)
      into v_eligible using v_asset.venue_id, v_subject_key, v_now;
    if coalesce((v_eligible ->> 'eligible')::boolean, false) is not true then
      raise exception 'subject_not_publishable' using errcode = 'P0001';
    end if;
  end if;

  if v_dest.audience = 'public' and p_profile_key is null then
    raise exception 'derivative_profile_required' using errcode = '22023';
  end if;
  -- B05-m2 adds the profile catalogue; until then no profile exists.
  if p_profile_key is not null then
    raise exception 'profile_unavailable' using errcode = 'P0001';
  end if;

  if v_from < v_now - interval '5 minutes'
     or (p_effective_until is not null and p_effective_until <= v_from) then
    raise exception 'invalid_use_period' using errcode = '22023';
  end if;

  select v.keys into v_keys from private.media_use_clearance_versions v
  where v.version = p_clearance_version and v.active;
  if v_keys is null or p_clearance is null or jsonb_typeof(p_clearance) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_clearance) k)
        is distinct from (select array_agg(k order by k) from unnest(v_keys) k)
     or exists (select 1 from jsonb_each(p_clearance) e where e.value <> 'true'::jsonb) then
    raise exception 'clearance_incomplete' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;

  insert into public.media_use_grants (
    asset_id, venue_id, destination_key, audience, purpose, subject_kind, subject_id, subject_key,
    derivative_profile_key, effective_from, effective_until, authorised_by, authority_basis,
    clearance_version, clearance, internal_note, request_key)
  values (
    v_asset.id, v_asset.venue_id, v_dest.key, v_dest.audience, p_purpose, p_subject_kind, p_subject_id,
    v_subject_key, p_profile_key, v_from, p_effective_until, v_uid,
    case when private.is_active_admin() then 'admin' else 'named_granter' end,
    p_clearance_version, p_clearance, v_note, p_request_key)
  returning * into v_grant;
  return jsonb_build_object('grantId', v_grant.id,
    'state', private.media_use_grant_state(v_grant, v_now), 'replayed', false);
end;
$$;

-- Withdraws the listed grants (not yet withdrawn) for the caller. Shared by
-- both withdrawal commands; the caller has already been checked.
create function private.media_use_withdraw(
  p_uid uuid, p_request_key text, p_grant_ids uuid[], p_reason_code text, p_note text
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
  insert into public.media_use_grant_withdrawals (grant_id, withdrawn_by, reason_code, internal_note, request_key)
  select g.id, p_uid, p_reason_code, p_note, p_request_key
  from public.media_use_grants g
  where g.id = any(p_grant_ids)
    and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
  order by g.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function private.media_use_withdraw_check(p_request_key text, p_reason_code text, p_note text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_any_public_use_granter() then
    raise exception 'not_public_use_granter' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  -- asset_deleted is written only by the system (B05-m3).
  if p_reason_code is null or p_reason_code not in ('granter_withdrawn', 'clearance_failed', 'subject_changed', 'owner_request', 'superseded') then
    raise exception 'invalid_reason_code' using errcode = '22023';
  end if;
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
end;
$$;

-- Records a withdrawal request key, or recognises a replay. True: the same
-- command already ran with this key for the same target, reason and note.
-- Any other earlier use of the key (the other command, another target, or a
-- changed reason or note) is idempotency_key_reused.
create function private.media_use_withdraw_request(
  p_uid uuid, p_request_key text, p_command text, p_target uuid, p_reason_code text, p_note text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior public.media_use_withdraw_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended('nabalens_media_use_withdraw:' || p_uid::text || ':' || p_request_key, 0));
  select r.* into v_prior from public.media_use_withdraw_requests r
  where r.requested_by = p_uid and r.request_key = p_request_key;
  if found then
    if v_prior.command <> p_command or v_prior.target_id <> p_target
       or v_prior.reason_code <> p_reason_code or v_prior.internal_note is distinct from p_note then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
    return true;
  end if;
  insert into public.media_use_withdraw_requests (requested_by, request_key, command, target_id, reason_code, internal_note)
  values (p_uid, p_request_key, p_command, p_target, p_reason_code, p_note);
  return false;
end;
$$;

-- Withdraws one grant. Terminal: a new grant is needed to use the asset
-- again. Replays by request key; an already withdrawn grant reads
-- alreadyWithdrawn. The same key used differently is idempotency_key_reused.
create function public.media_use_grant_withdraw(
  p_request_key text, p_grant_id uuid, p_reason_code text, p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_note text := nullif(btrim(p_note), '');
  v_grant public.media_use_grants;
  v_count integer;
begin
  perform private.media_use_withdraw_check(p_request_key, p_reason_code, p_note);
  if private.media_use_withdraw_request(v_uid, p_request_key, 'grant', p_grant_id, p_reason_code, v_note) then
    return jsonb_build_object('grantId', p_grant_id, 'withdrawn', 0, 'replayed', true);
  end if;
  select g.* into v_grant from public.media_use_grants g where g.id = p_grant_id for update;
  if not found or not private.can_grant_public_use(v_grant.venue_id) then
    raise exception 'media_use_grant_not_found' using errcode = 'P0002';
  end if;
  v_count := private.media_use_withdraw(v_uid, p_request_key, array[v_grant.id], p_reason_code, v_note);
  return jsonb_build_object('grantId', v_grant.id, 'withdrawn', v_count,
    'alreadyWithdrawn', v_count = 0, 'replayed', false);
end;
$$;

-- Withdraws every grant on the asset that is not yet withdrawn (any upload
-- state, deleted included). A replay withdraws nothing new; the same key
-- used differently is idempotency_key_reused.
create function public.media_use_withdraw_asset(
  p_request_key text, p_asset_id uuid, p_reason_code text, p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_note text := nullif(btrim(p_note), '');
  v_asset public.media_assets;
  v_ids uuid[];
  v_count integer;
begin
  perform private.media_use_withdraw_check(p_request_key, p_reason_code, p_note);
  if private.media_use_withdraw_request(v_uid, p_request_key, 'asset', p_asset_id, p_reason_code, v_note) then
    return jsonb_build_object('assetId', p_asset_id, 'withdrawn', 0, 'replayed', true);
  end if;
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for share;
  if not found or not private.can_grant_public_use(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  select array_agg(g.id order by g.id) into v_ids from public.media_use_grants g where g.asset_id = v_asset.id;
  perform 1 from public.media_use_grants g where g.id = any(v_ids) order by g.id for update;
  v_count := private.media_use_withdraw(v_uid, p_request_key, coalesce(v_ids, '{}'), p_reason_code, v_note);
  return jsonb_build_object('assetId', v_asset.id, 'withdrawn', v_count, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read (B05-02e)
-- ---------------------------------------------------------------------------

-- The uploader (a manager account: its manager-era uploads only) sees the
-- state and one line per destination, with no granter or note. The venue's
-- effective manager (where existing gates show the asset) and active admins
-- also see the purpose, period, subject and the granter's first name.
-- Anyone else: media_asset_not_found.
create function public.asset_use_status(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_asset public.media_assets;
  v_view text;
  v_now timestamptz := now();
begin
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if found then
    v_view := case
      when private.is_active_admin() then 'admin'
      when v_asset.deleted_at is not null then null
      when v_asset.uploader_id = v_uid
        and (v_asset.uploader_role = 'manager' or not private.is_active_manager()) then 'uploader'
      when private.effective_manager_venue_id(v_uid) = v_asset.venue_id
        and private.viewer_sees_asset(v_asset.id) then 'manager'
    end;
  end if;
  if v_view is null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_view = 'uploader' then
    return jsonb_build_object(
      'assetId', v_asset.id,
      'view', v_view,
      'state', private.media_asset_use_state(v_asset.id, v_now),
      'destinations', coalesce((
        select jsonb_agg(jsonb_build_object('label', d.label, 'state', s.state, 'until', g.effective_until)
          order by g.created_at, g.id)
        from public.media_use_grants g
        join public.media_use_destinations d on d.key = g.destination_key
        cross join lateral (select private.media_use_grant_state(g, v_now) as state) s
        where g.asset_id = v_asset.id), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'assetId', v_asset.id,
    'view', v_view,
    'state', private.media_asset_use_state(v_asset.id, v_now),
    'baseline', v_asset.use_baseline,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
          'grantId', g.id,
          'destinationKey', g.destination_key,
          'label', d.label,
          'audience', g.audience,
          'purpose', g.purpose,
          'subject', jsonb_build_object('kind', g.subject_kind, 'id', g.subject_id, 'key', g.subject_key),
          'effectiveFrom', g.effective_from,
          'effectiveUntil', g.effective_until,
          'state', s.state,
          'granterFirstName', split_part(btrim(p.display_name), ' ', 1),
          'withdrawnAt', w.withdrawn_at,
          'withdrawReason', w.reason_code,
          'derivative', null)
        order by g.created_at, g.id)
      from public.media_use_grants g
      join public.media_use_destinations d on d.key = g.destination_key
      join public.profiles p on p.id = g.authorised_by
      left join public.media_use_grant_withdrawals w on w.grant_id = g.id
      cross join lateral (select private.media_use_grant_state(g, v_now) as state) s
      where g.asset_id = v_asset.id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.media_use_grant_state(public.media_use_grants, timestamptz),
  private.media_asset_use_state(uuid, timestamptz),
  private.media_asset_use_summary(uuid, text),
  private.can_grant_public_use(uuid),
  private.is_any_public_use_granter(),
  private.media_use_withdraw(uuid, text, uuid[], text, text),
  private.media_use_withdraw_request(uuid, text, text, uuid, text, text),
  private.media_use_withdraw_check(text, text, text)
from public, anon, authenticated, service_role;

revoke all on function
  public.media_use_grant_create(text, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text, jsonb, text),
  public.media_use_grant_withdraw(text, uuid, text, text),
  public.media_use_withdraw_asset(text, uuid, text, text),
  public.asset_use_status(uuid)
from public, anon, service_role;

grant execute on function
  public.media_use_grant_create(text, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text, jsonb, text),
  public.media_use_grant_withdraw(text, uuid, text, text),
  public.media_use_withdraw_asset(text, uuid, text, text),
  public.asset_use_status(uuid)
to authenticated;
