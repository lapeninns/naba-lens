-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-LIBRARY: the admin Library (spec §8 A4, §11, §16; AC13,
-- AC20, AC21, AC31-AC35; docs/plans/full-app-v1/checklist.md "S2-LIBRARY").
--
--   Withdraw   public.library_withdraw_asset(asset, reason) takes an asset out
--              of use and keeps the record: one row in media_asset_withdrawals
--              while withdrawn, and the append-only media_asset_withdrawal_events.
--              public.library_restore_asset(asset, reason) brings it back.
--              Withdrawn means private.export_candidate_rows (S1-EXPORT's one
--              eligibility rule, redefined here with one extra condition) no
--              longer offers it, so a package holding it is invalidated at
--              download (AC32), and it cannot be made a primary photo (two
--              triggers below). Review
--              decisions and coverage are not changed: a manager suspends or
--              re-reviews through Review (M3-suspend, S2-REVIEW).
--   Correct    public.admin_correct_asset_venue(asset, venue, reason): the
--              audited venue correction of spec §11. media_assets.venue_id is
--              the immutable upload-time venue (18 venue-scoped foreign keys
--              and append-only histories hang off it), so the original
--              declaration is never rewritten: the correction is an
--              append-only media_venue_corrections row naming the venue the
--              file really belongs to, and it withdraws the asset (approvals
--              suspended, exports invalidated) until someone re-reviews it.
--   Tags       Controlled vocabulary: library_tags (admins create, rename,
--              retire), library_asset_tags (which assets carry which tag),
--              library_tag_events (append-only). Only an active tag is added.
--   Collect    library_collections and library_collection_items reference
--              assets; removing an asset from a collection deletes only the
--              reference row, never the asset (spec §8 A4).
--   Detail     public.library_asset_detail(asset): provenance, renditions
--              (media_renditions, S1-UPLOAD) with the approval they carry,
--              labels and label history, review decisions, slots and primary,
--              eligibility, evidence links, exports and publications
--              (export_asset_status, S1-EXPORT), tags, collections, possible
--              duplicates, withdrawal, removal requests and corrections.
--   Filters    public.library_page gains: withdrawn state, review state,
--              capture dates, orientation, request, collection, publication
--              destination and tag. Its earlier arguments, rows and order are
--              unchanged (an extra filter only narrows the result), except
--              that withdrawn assets are left out unless asked for.
--   Lists      public.library_tags, public.library_collections,
--              public.library_filter_lists (requests and destinations).
--
-- Admins only, on an aal2 session (private.is_active_admin). Every write is
-- also written to the activity log (private.record_activity, S1-OPS).
--
-- Rollback: a forward migration restoring library_page (20261101100000) and
-- export_candidate_rows (20261118105000), dropping the two primary triggers
-- and revoking execute on the new public functions. Tables stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.media_asset_withdrawals (
  asset_id uuid primary key,
  venue_id uuid not null,
  withdrawn_by uuid not null references public.profiles (id) on delete restrict,
  withdrawn_at timestamptz not null default now(),
  reason text not null check (length(reason) between 3 and 500 and reason = btrim(reason)),
  constraint media_asset_withdrawals_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

comment on table public.media_asset_withdrawals is
  'S2-LIBRARY: assets withdrawn from use (record kept). One row while withdrawn; restore deletes it. History in media_asset_withdrawal_events.';

create table public.media_asset_withdrawal_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null,
  venue_id uuid not null references public.venues (id) on delete restrict,
  action text not null check (action in ('withdrawn', 'restored')),
  reason text not null check (length(reason) between 3 and 500),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index media_asset_withdrawal_events_asset_idx
  on public.media_asset_withdrawal_events (asset_id, id);

create table public.media_venue_corrections (
  id bigint generated always as identity primary key,
  asset_id uuid not null,
  -- The original declaration (media_assets.venue_id, never changed).
  declared_venue_id uuid not null,
  corrected_venue_id uuid not null references public.venues (id) on delete restrict,
  reason text not null check (length(reason) between 3 and 500 and reason = btrim(reason)),
  corrected_by uuid not null references public.profiles (id) on delete restrict,
  corrected_at timestamptz not null default now(),
  constraint media_venue_corrections_asset_fkey foreign key (asset_id, declared_venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_venue_corrections_differs check (corrected_venue_id <> declared_venue_id)
);

create index media_venue_corrections_asset_idx on public.media_venue_corrections (asset_id, id);

comment on table public.media_venue_corrections is
  'S2-LIBRARY (spec §11): admin corrections of a wrongly declared source venue. Append-only; the original declaration stays on media_assets.';

create table public.library_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 40 and name = btrim(name)),
  active boolean not null default true,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index library_tags_name_key on public.library_tags (lower(name));

comment on table public.library_tags is
  'S2-LIBRARY: the controlled tag vocabulary (spec §8 A4). Admins add, rename and retire tags; a retired tag stays on assets but cannot be added.';

create table public.library_asset_tags (
  asset_id uuid not null,
  venue_id uuid not null,
  tag_id uuid not null references public.library_tags (id) on delete restrict,
  added_by uuid not null references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (asset_id, tag_id),
  constraint library_asset_tags_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index library_asset_tags_tag_idx on public.library_asset_tags (tag_id, asset_id);

create table public.library_tag_events (
  id bigint generated always as identity primary key,
  tag_id uuid not null references public.library_tags (id) on delete restrict,
  asset_id uuid,
  action text not null check (action in ('created', 'renamed', 'retired', 'restored', 'added', 'removed')),
  name text not null,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index library_tag_events_asset_idx on public.library_tag_events (asset_id, id) where asset_id is not null;

create table public.library_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80 and name = btrim(name)),
  purpose text check (purpose is null or (length(purpose) between 1 and 500 and purpose = btrim(purpose))),
  archived_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.library_collections is
  'S2-LIBRARY: campaign collections (spec §8 A4, §11). They reference assets; they never copy or own files.';

create table public.library_collection_items (
  collection_id uuid not null references public.library_collections (id) on delete restrict,
  asset_id uuid not null,
  venue_id uuid not null,
  added_by uuid not null references public.profiles (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (collection_id, asset_id),
  constraint library_collection_items_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index library_collection_items_asset_idx on public.library_collection_items (asset_id);

create table public.library_collection_events (
  id bigint generated always as identity primary key,
  collection_id uuid not null references public.library_collections (id) on delete restrict,
  asset_id uuid,
  action text not null check (action in ('created', 'changed', 'archived', 'restored', 'added', 'removed')),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Histories are append-only.
create trigger media_asset_withdrawal_events_append_only
  before update or delete on public.media_asset_withdrawal_events
  for each row execute function private.append_only_guard();
create trigger media_asset_withdrawal_events_no_truncate
  before truncate on public.media_asset_withdrawal_events
  for each statement execute function private.append_only_guard();
create trigger media_venue_corrections_append_only
  before update or delete on public.media_venue_corrections
  for each row execute function private.append_only_guard();
create trigger media_venue_corrections_no_truncate
  before truncate on public.media_venue_corrections
  for each statement execute function private.append_only_guard();
create trigger library_tag_events_append_only
  before update or delete on public.library_tag_events
  for each row execute function private.append_only_guard();
create trigger library_tag_events_no_truncate
  before truncate on public.library_tag_events
  for each statement execute function private.append_only_guard();
create trigger library_collection_events_append_only
  before update or delete on public.library_collection_events
  for each row execute function private.append_only_guard();
create trigger library_collection_events_no_truncate
  before truncate on public.library_collection_events
  for each statement execute function private.append_only_guard();

-- Read and written only through the functions below.
alter table public.media_asset_withdrawals enable row level security;
alter table public.media_asset_withdrawal_events enable row level security;
alter table public.media_venue_corrections enable row level security;
alter table public.library_tags enable row level security;
alter table public.library_asset_tags enable row level security;
alter table public.library_tag_events enable row level security;
alter table public.library_collections enable row level security;
alter table public.library_collection_items enable row level security;
alter table public.library_collection_events enable row level security;
revoke all on table
  public.media_asset_withdrawals, public.media_asset_withdrawal_events,
  public.media_venue_corrections, public.library_tags, public.library_asset_tags,
  public.library_tag_events, public.library_collections,
  public.library_collection_items, public.library_collection_events
  from public, anon, authenticated;
grant select on table
  public.media_asset_withdrawals, public.media_asset_withdrawal_events,
  public.media_venue_corrections, public.library_tags, public.library_asset_tags,
  public.library_tag_events, public.library_collections,
  public.library_collection_items, public.library_collection_events
  to service_role;

-- ---------------------------------------------------------------------------
-- Withdrawn means withdrawn from use everywhere
-- ---------------------------------------------------------------------------

-- S1-EXPORT's one eligibility rule (20261118105000), unchanged but for one
-- condition in `usable`: a photo withdrawn in the Library is left out, so it
-- is not offered and a package holding it is invalidated at download (AC32).
-- S2-INT also redefines this function (review levels): the coordinator keeps
-- both changes. private.media_asset_use_state is deliberately NOT changed:
-- asset search pins and mirrors its body.
-- Coordinator merge: S2-INT's rule (20261118109100: review level, place
-- freshness, amenity photo acceptance) plus S2-LIBRARY's withdrawal rule.
create or replace function private.export_candidate_rows(p_venue_id uuid, p_mode text)
returns table (
  asset_id uuid,
  venue_id uuid,
  subject_kind text,
  subject_id uuid,
  subject_label text,
  subject_slug text,
  category text,
  approval_kind text,
  approval_id text,
  approval_version text,
  approval_level text,
  uploaded_at timestamptz,
  width integer,
  height integer,
  use_baseline text
)
language sql
stable
security definer
set search_path = ''
as $$
  with assets as (
    select a.id, a.venue_id, a.created_at, a.width, a.height, a.use_baseline,
      private.media_asset_use_state(a.id, now()) as use_state,
      -- The public audience alone (review R21): in_force, withdrawn or null.
      (select case
          when bool_or(private.media_use_grant_state(g, now()) = 'in_force') then 'in_force'
          when bool_or(private.media_use_grant_state(g, now()) = 'withdrawn') then 'withdrawn'
        end
        from public.media_use_grants g where g.asset_id = a.id and g.audience = 'public') as public_use
    from public.media_assets a
    where a.venue_id = p_venue_id
      and a.upload_state = 'ready'
      and a.deleted_at is null
      and a.media_type = 'image'
  ),
  usable as (
    select * from assets
    where use_state is distinct from 'withdrawn'
      -- S2-LIBRARY: a photo withdrawn in the Library is not exportable.
      and not exists (select 1 from public.media_asset_withdrawals w where w.asset_id = assets.id)
  ),
  menu as (
    select distinct on (p.asset_id, p.item_id)
      p.asset_id, p.item_id, e.name, s.kind, p.id as photo_id, p.revision, p.state, p.review_level
    from public.menu_item_photos p
    join usable u on u.id = p.asset_id
    join public.menu_items i on i.id = p.item_id and i.archived_at is null
    join public.menu_versions v on v.venue_id = p.venue_id and v.status = 'active'
    join public.menu_entries e on e.version_id = v.id and e.item_id = p.item_id
    join public.menu_sections s on s.id = e.section_id and s.version_id = v.id
    where p.venue_id = p_venue_id
      and ((p.state = 'accepted' and p.review_level = 'public')
        or (p_mode = 'internal' and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')))
    order by p.asset_id, p.item_id, (p.state = 'accepted' and p.review_level = 'public') desc,
      (p.state = 'accepted') desc, p.decided_at desc, p.id
  ),
  area as (
    select l.asset_id, l.subject_id, s.label, l.id as label_id, d.id as decision_id, d.action,
      (d.action = 'accepted' and d.review_level = 'public'
        and private.area_photo_freshness(l.id) ->> 'state' = 'current') as public_ok
    from public.media_area_labels l
    join usable u on u.id = l.asset_id
    join public.knowledge_subjects s on s.id = l.subject_id and s.venue_id = l.venue_id and s.retired_at is null
    left join lateral (
      select d.id, d.action, d.review_level from public.area_photo_decisions d
      where d.label_id = l.id order by d.id desc limit 1
    ) d on true
    where l.venue_id = p_venue_id
      and l.removed_at is null
      and (d.action = 'accepted'
        or (p_mode = 'internal' and (d.action is null or d.action = 'needs_another_photo')))
  ),
  -- Amenity photos from their own review (FA-32, review R1/R21): the
  -- latest amenity_photo_decisions row per (check, photo). Public needs an
  -- acceptance at the public level, a public-audience grant in force (an
  -- internal grant is not enough), the question's public media rule and a
  -- current confirmed Yes.
  amenity_photo as (
    select r.check_id, r.asset_id, r.state, r.review_level,
      (select max(d.id) from public.amenity_photo_decisions d
        where d.check_id = r.check_id and d.asset_id = r.asset_id) as decision_id
    from private.amenity_photo_rows(p_venue_id) r
    join usable u on u.id = r.asset_id
    where r.state in ('accepted', 'pending', 'needs_another_photo')
  ),
  amenity_rated as (
    select ap.asset_id, c.id as check_id, c.template_key, cat.question, ap.decision_id,
      (ap.state = 'accepted' and ap.review_level = 'public'
        and u.public_use = 'in_force'
        and c.progress = 'complete' and c.answer = 'yes'
        and coalesce((private.knowledge_check_service_end(c.id, now()) ->> 'inEffect')::boolean, false) = false
        and coalesce((private.knowledge_public_media_eligible(p_venue_id, c.template_key) ->> 'eligible')::boolean, false)
      ) as public_ok
    from amenity_photo ap
    join usable u on u.id = ap.asset_id
    join public.venue_amenity_checks c on c.id = ap.check_id
    join public.amenity_catalogue cat on cat.key = c.template_key
  ),
  rows as (
    select m.asset_id, 'menu_item'::text as subject_kind, m.item_id as subject_id, m.name as subject_label,
      m.name as slug_source,
      case m.kind when 'food' then 'food' when 'drinks' then 'drinks' else 'other' end as category,
      'menu_item_photo'::text as approval_kind, m.photo_id::text as approval_id, m.revision::text as approval_version,
      case when m.state = 'accepted' and m.review_level = 'public' then 'public' else 'internal' end as approval_level
    from menu m
    union all
    select ar.asset_id, 'place', ar.subject_id, ar.label, ar.label, 'spaces',
      case when ar.decision_id is null then 'area_label' else 'area_photo_decision' end,
      coalesce(ar.decision_id::text, ar.label_id::text),
      coalesce(ar.decision_id::text, ar.label_id::text),
      case when ar.public_ok then 'public' else 'internal' end
    from area ar
    union all
    select r.asset_id, 'amenity', r.check_id, r.question, replace(r.template_key, '_', ' '), 'facilities',
      'amenity_photo_decision', coalesce(r.decision_id::text, 'pending'), coalesce(r.decision_id::text, 'pending'),
      case when r.public_ok then 'public' else 'internal' end
    from amenity_rated r
  )
  select r.asset_id, p_venue_id, r.subject_kind, r.subject_id, r.subject_label,
    coalesce(nullif(private.export_slug(r.slug_source, 60), ''), 'photo'),
    r.category, r.approval_kind, r.approval_id, r.approval_version, x.level,
    u.created_at, u.width, u.height, u.use_baseline
  from rows r
  join usable u on u.id = r.asset_id
  -- A withdrawn public use keeps any photo out of public packages, whatever
  -- internal grant remains (review R21).
  cross join lateral (
    select case when r.approval_level = 'public' and u.public_use is distinct from 'withdrawn'
      then 'public' else 'internal' end as level
  ) x
  where p_mode = 'internal' or x.level = 'public';
$$;

-- A withdrawn asset cannot become a primary photo.
create function private.library_primary_not_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- (Nested: PL/pgSQL resolves every field in one expression, and
  -- slot_primary_choices has no is_primary.)
  if tg_table_name = 'menu_item_photos' then
    if not (new.is_primary and not old.is_primary) then
      return new;
    end if;
  end if;
  if exists (select 1 from public.media_asset_withdrawals w where w.asset_id = new.asset_id) then
    raise exception 'asset_withdrawn' using errcode = 'P0001',
      detail = 'Restore this photo before making it the main photo.';
  end if;
  return new;
end;
$$;

revoke all on function private.library_primary_not_withdrawn() from public, anon, authenticated;

create trigger slot_primary_choices_not_withdrawn
  before insert on public.slot_primary_choices
  for each row execute function private.library_primary_not_withdrawn();
create trigger menu_item_photos_primary_not_withdrawn
  before update of is_primary on public.menu_item_photos
  for each row execute function private.library_primary_not_withdrawn();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.library_assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create function private.library_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_reason, ''));
begin
  if length(v) < 3 or length(v) > 500 then
    raise exception 'reason_required' using errcode = '22023',
      detail = 'A reason of 3 to 500 characters.';
  end if;
  return v;
end;
$$;

-- The asset's review state across every kind of slot: public (approved for
-- public use somewhere), reference (kept as reference, nowhere public),
-- not_used (decided, never accepted) or unreviewed (no decision yet).
-- Null for a caller who is not an active admin (library_page is invoker).
create function private.library_review_state(p_asset_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with levels as (
    select m.review_level as level from public.menu_item_photos m
    where m.asset_id = p_asset_id and m.state in ('accepted', 'needs_recheck')
    union all
    select 'public' from public.coverage_submission_items ci
    where ci.asset_id = p_asset_id and ci.state = 'accepted'
    union all
    select d.review_level from public.media_area_labels l
    cross join lateral (
      select x.action, x.review_level from public.area_photo_decisions x
      where x.label_id = l.id order by x.id desc limit 1) d
    where l.asset_id = p_asset_id and l.removed_at is null and d.action = 'accepted'
    union all
    select d.review_level from (
      select distinct on (x.check_id) x.action, x.review_level
      from public.amenity_photo_decisions x where x.asset_id = p_asset_id
      order by x.check_id, x.id desc) d
    where d.action = 'accepted'
  ),
  decided as (
    select 1 from public.menu_item_photos m where m.asset_id = p_asset_id
    union all
    select 1 from public.area_photo_decisions d where d.asset_id = p_asset_id
    union all
    select 1 from public.amenity_photo_decisions d where d.asset_id = p_asset_id
    union all
    select 1 from public.coverage_submission_items ci
    where ci.asset_id = p_asset_id and ci.state <> 'submitted'
  )
  select case
    when not coalesce(private.is_active_admin(), false) then null
    when exists (select 1 from levels where level = 'public') then 'public'
    when exists (select 1 from levels) then 'reference'
    when exists (select 1 from decided) then 'not_used'
    else 'unreviewed'
  end;
$$;

revoke all on function private.library_review_state(uuid) from public, anon;
grant execute on function private.library_review_state(uuid) to authenticated, service_role;

create function private.library_is_withdrawn(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.media_asset_withdrawals w where w.asset_id = p_asset_id);
$$;

create function private.library_any_withdrawn()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.media_asset_withdrawals);
$$;

revoke all on function private.library_any_withdrawn() from public, anon;
grant execute on function private.library_any_withdrawn() to authenticated, service_role;

revoke all on function private.library_is_withdrawn(uuid) from public, anon;
grant execute on function private.library_is_withdrawn(uuid) to authenticated, service_role;

-- Asset ids for a library filter that names one record: a collection, a
-- tag, a request (coverage requirement) or a publication destination.
-- Empty for a caller who is not an active admin.
create function private.library_ref_ids(p_kind text, p_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when not coalesce(private.is_active_admin(), false) then '{}'::uuid[]
  else coalesce((
    select array_agg(distinct x.asset_id) from (
      select ci.asset_id from public.library_collection_items ci
      where p_kind = 'collection' and ci.collection_id = p_id
      union all
      select t.asset_id from public.library_asset_tags t
      where p_kind = 'tag' and t.tag_id = p_id
      union all
      select s.asset_id from public.coverage_submission_items s
      where p_kind = 'request' and s.requirement_id = p_id
      union all
      select e.asset_id from public.publication_events e
      where p_kind = 'destination' and e.destination_id = p_id
    ) x
  ), '{}'::uuid[]) end;
$$;

revoke all on function private.library_ref_ids(text, uuid) from public, anon;
grant execute on function private.library_ref_ids(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Withdraw and restore
-- ---------------------------------------------------------------------------

create function public.library_withdraw_asset(p_asset_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_reason text;
  v_asset record;
begin
  select a.id, a.venue_id, a.deleted_at into v_asset
  from public.media_assets a where a.id = p_asset_id for update;
  if v_asset.id is null or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.library_reason(p_reason);
  if exists (select 1 from public.media_asset_withdrawals w where w.asset_id = p_asset_id) then
    return jsonb_build_object('assetId', p_asset_id, 'withdrawn', true, 'changed', false);
  end if;
  insert into public.media_asset_withdrawals (asset_id, venue_id, withdrawn_by, reason)
  values (p_asset_id, v_asset.venue_id, v_uid, v_reason);
  insert into public.media_asset_withdrawal_events (asset_id, venue_id, action, reason, actor_id)
  values (p_asset_id, v_asset.venue_id, 'withdrawn', v_reason, v_uid);
  perform private.record_activity(v_asset.venue_id, 'library_asset_withdrawn', 'media_asset',
    p_asset_id::text, null, null, v_reason, null, null);
  return jsonb_build_object('assetId', p_asset_id, 'withdrawn', true, 'changed', true);
end;
$$;

create function public.library_restore_asset(p_asset_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_reason text;
  v_asset record;
begin
  select a.id, a.venue_id, a.deleted_at into v_asset
  from public.media_assets a where a.id = p_asset_id for update;
  if v_asset.id is null or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.library_reason(p_reason);
  delete from public.media_asset_withdrawals w where w.asset_id = p_asset_id;
  if not found then
    return jsonb_build_object('assetId', p_asset_id, 'withdrawn', false, 'changed', false);
  end if;
  insert into public.media_asset_withdrawal_events (asset_id, venue_id, action, reason, actor_id)
  values (p_asset_id, v_asset.venue_id, 'restored', v_reason, v_uid);
  perform private.record_activity(v_asset.venue_id, 'library_asset_restored', 'media_asset',
    p_asset_id::text, null, null, v_reason, null, null);
  return jsonb_build_object('assetId', p_asset_id, 'withdrawn', false, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Venue correction (spec §11)
-- ---------------------------------------------------------------------------

create function public.admin_correct_asset_venue(p_asset_id uuid, p_venue_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_reason text;
  v_asset record;
  v_current uuid;
  v_id bigint;
begin
  select a.id, a.venue_id, a.deleted_at into v_asset
  from public.media_assets a where a.id = p_asset_id for update;
  if v_asset.id is null or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.library_reason(p_reason);
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  select c.corrected_venue_id into v_current from public.media_venue_corrections c
  where c.asset_id = p_asset_id order by c.id desc limit 1;
  -- A correction names another venue than the declared one and than the
  -- latest correction.
  if p_venue_id = v_asset.venue_id or p_venue_id = v_current then
    raise exception 'venue_unchanged' using errcode = '22023',
      detail = 'The photo is already recorded at this venue.';
  end if;

  insert into public.media_venue_corrections (asset_id, declared_venue_id, corrected_venue_id, reason, corrected_by)
  values (p_asset_id, v_asset.venue_id, p_venue_id, v_reason, v_uid)
  returning id into v_id;

  -- Approvals at the declared venue are suspended until someone re-reviews:
  -- the asset is withdrawn from use (exports and primaries stop).
  if not exists (select 1 from public.media_asset_withdrawals w where w.asset_id = p_asset_id) then
    insert into public.media_asset_withdrawals (asset_id, venue_id, withdrawn_by, reason)
    values (p_asset_id, v_asset.venue_id, v_uid, left('Venue corrected: ' || v_reason, 500));
    insert into public.media_asset_withdrawal_events (asset_id, venue_id, action, reason, actor_id)
    values (p_asset_id, v_asset.venue_id, 'withdrawn', left('Venue corrected: ' || v_reason, 500), v_uid);
  end if;

  perform private.record_activity(v_asset.venue_id, 'library_venue_corrected', 'media_asset',
    p_asset_id::text, null, null, v_reason,
    jsonb_build_object('venueId', coalesce(v_current, v_asset.venue_id)),
    jsonb_build_object('venueId', p_venue_id));
  return jsonb_build_object('assetId', p_asset_id, 'correctionId', v_id,
    'declaredVenueId', v_asset.venue_id, 'correctedVenueId', p_venue_id, 'withdrawn', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

create function public.library_tags()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.library_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'active', t.active, 'revision', t.revision,
        'assetCount', (select count(*) from public.library_asset_tags x where x.tag_id = t.id))
      order by t.active desc, lower(t.name), t.id)
    from public.library_tags t
  ), '[]'::jsonb);
end;
$$;

-- Creates a tag (p_tag_id null) or renames / retires / restores one.
create function public.library_tag_save(
  p_tag_id uuid, p_name text, p_active boolean default true, p_expected_revision integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_tag public.library_tags;
begin
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'tag_name_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.library_tags t
             where lower(t.name) = lower(v_name) and t.id is distinct from p_tag_id) then
    raise exception 'tag_name_taken' using errcode = '23505';
  end if;
  if p_tag_id is null then
    insert into public.library_tags (name, active, created_by)
    values (v_name, true, v_uid) returning * into v_tag;
    insert into public.library_tag_events (tag_id, action, name, actor_id)
    values (v_tag.id, 'created', v_name, v_uid);
  else
    select t.* into v_tag from public.library_tags t where t.id = p_tag_id for update;
    if v_tag.id is null then
      raise exception 'tag_not_found' using errcode = 'P0002';
    end if;
    if p_expected_revision is not null and p_expected_revision <> v_tag.revision then
      raise exception 'tag_conflict' using errcode = '40001';
    end if;
    if v_tag.name is distinct from v_name then
      insert into public.library_tag_events (tag_id, action, name, actor_id)
      values (v_tag.id, 'renamed', v_name, v_uid);
    end if;
    if v_tag.active is distinct from coalesce(p_active, v_tag.active) then
      insert into public.library_tag_events (tag_id, action, name, actor_id)
      values (v_tag.id, case when p_active then 'restored' else 'retired' end, v_name, v_uid);
    end if;
    update public.library_tags t
    set name = v_name, active = coalesce(p_active, t.active),
        revision = t.revision + 1, updated_at = now()
    where t.id = v_tag.id returning * into v_tag;
  end if;
  return jsonb_build_object('id', v_tag.id, 'name', v_tag.name, 'active', v_tag.active,
    'revision', v_tag.revision);
end;
$$;

-- Adds or removes one tag on up to 200 assets. Returns how many changed.
create function public.library_asset_tag(p_asset_ids uuid[], p_tag_id uuid, p_add boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_tag public.library_tags;
  v_count integer := 0;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) < 1 or cardinality(p_asset_ids) > 200
     or p_add is null then
    raise exception 'assets_invalid' using errcode = '22023';
  end if;
  select t.* into v_tag from public.library_tags t where t.id = p_tag_id;
  if v_tag.id is null then
    raise exception 'tag_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(p_asset_ids) x(id)
             where not exists (select 1 from public.media_assets a
                               where a.id = x.id and a.deleted_at is null)) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if p_add then
    if not v_tag.active then
      raise exception 'tag_retired' using errcode = 'P0001';
    end if;
    with ins as (
      insert into public.library_asset_tags (asset_id, venue_id, tag_id, added_by)
      select a.id, a.venue_id, v_tag.id, v_uid
      from public.media_assets a where a.id = any (p_asset_ids)
      on conflict do nothing
      returning asset_id
    ), ev as (
      insert into public.library_tag_events (tag_id, asset_id, action, name, actor_id)
      select v_tag.id, ins.asset_id, 'added', v_tag.name, v_uid from ins
      returning 1
    )
    select count(*) into v_count from ev;
  else
    with del as (
      delete from public.library_asset_tags x
      where x.tag_id = v_tag.id and x.asset_id = any (p_asset_ids)
      returning x.asset_id
    ), ev as (
      insert into public.library_tag_events (tag_id, asset_id, action, name, actor_id)
      select v_tag.id, del.asset_id, 'removed', v_tag.name, v_uid from del
      returning 1
    )
    select count(*) into v_count from ev;
  end if;
  return jsonb_build_object('tagId', v_tag.id, 'changed', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------

create function public.library_collections(p_include_archived boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.library_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'purpose', c.purpose, 'archivedAt', c.archived_at,
        'revision', c.revision, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
        'assetCount', (select count(*) from public.library_collection_items i
                       join public.media_assets a on a.id = i.asset_id and a.deleted_at is null
                       where i.collection_id = c.id),
        'venues', coalesce((
          select jsonb_agg(jsonb_build_object('venueId', v.id, 'venueName', v.name, 'count', n.count)
            order by v.name, v.id)
          from (select i.venue_id, count(*) as count from public.library_collection_items i
                join public.media_assets a on a.id = i.asset_id and a.deleted_at is null
                where i.collection_id = c.id group by i.venue_id) n
          join public.venues v on v.id = n.venue_id), '[]'::jsonb))
      order by c.archived_at is not null, c.updated_at desc, c.id)
    from public.library_collections c
    where coalesce(p_include_archived, false) or c.archived_at is null
  ), '[]'::jsonb);
end;
$$;

create function public.library_collection_save(
  p_collection_id uuid, p_name text, p_purpose text default null,
  p_archived boolean default false, p_expected_revision integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_row public.library_collections;
begin
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'collection_name_invalid' using errcode = '22023';
  end if;
  if v_purpose is not null and length(v_purpose) > 500 then
    raise exception 'collection_purpose_invalid' using errcode = '22023';
  end if;
  if p_collection_id is null then
    insert into public.library_collections (name, purpose, created_by)
    values (v_name, v_purpose, v_uid) returning * into v_row;
    insert into public.library_collection_events (collection_id, action, actor_id)
    values (v_row.id, 'created', v_uid);
  else
    select c.* into v_row from public.library_collections c where c.id = p_collection_id for update;
    if v_row.id is null then
      raise exception 'collection_not_found' using errcode = 'P0002';
    end if;
    if p_expected_revision is not null and p_expected_revision <> v_row.revision then
      raise exception 'collection_conflict' using errcode = '40001';
    end if;
    insert into public.library_collection_events (collection_id, action, actor_id)
    values (v_row.id,
      case when coalesce(p_archived, false) and v_row.archived_at is null then 'archived'
           when not coalesce(p_archived, false) and v_row.archived_at is not null then 'restored'
           else 'changed' end,
      v_uid);
    update public.library_collections c
    set name = v_name, purpose = v_purpose,
        archived_at = case when coalesce(p_archived, false) then coalesce(c.archived_at, now()) else null end,
        revision = c.revision + 1, updated_at = now()
    where c.id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'purpose', v_row.purpose,
    'archivedAt', v_row.archived_at, 'revision', v_row.revision);
end;
$$;

-- Adds or removes up to 200 assets. Removing deletes the reference only.
create function public.library_collection_set_items(
  p_collection_id uuid, p_asset_ids uuid[], p_add boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_row public.library_collections;
  v_count integer := 0;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) < 1 or cardinality(p_asset_ids) > 200
     or p_add is null then
    raise exception 'assets_invalid' using errcode = '22023';
  end if;
  select c.* into v_row from public.library_collections c where c.id = p_collection_id for update;
  if v_row.id is null then
    raise exception 'collection_not_found' using errcode = 'P0002';
  end if;
  if p_add then
    if v_row.archived_at is not null then
      raise exception 'collection_archived' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(p_asset_ids) x(id)
               where not exists (select 1 from public.media_assets a
                                 where a.id = x.id and a.deleted_at is null)) then
      raise exception 'media_asset_not_found' using errcode = 'P0002';
    end if;
    with ins as (
      insert into public.library_collection_items (collection_id, asset_id, venue_id, added_by)
      select v_row.id, a.id, a.venue_id, v_uid
      from public.media_assets a where a.id = any (p_asset_ids)
      on conflict do nothing
      returning asset_id
    ), ev as (
      insert into public.library_collection_events (collection_id, asset_id, action, actor_id)
      select v_row.id, ins.asset_id, 'added', v_uid from ins
      returning 1
    )
    select count(*) into v_count from ev;
  else
    with del as (
      delete from public.library_collection_items i
      where i.collection_id = v_row.id and i.asset_id = any (p_asset_ids)
      returning i.asset_id
    ), ev as (
      insert into public.library_collection_events (collection_id, asset_id, action, actor_id)
      select v_row.id, del.asset_id, 'removed', v_uid from del
      returning 1
    )
    select count(*) into v_count from ev;
  end if;
  if v_count > 0 then
    update public.library_collections c set updated_at = now() where c.id = v_row.id;
  end if;
  return jsonb_build_object('collectionId', v_row.id, 'changed', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Filter lists: requests and publication destinations
-- ---------------------------------------------------------------------------

create function public.library_filter_lists(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.library_assert_admin();
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.title, 'venueId', r.venue_id,
          'venueName', v.name, 'status', r.status)
        order by v.name, r.title, r.id)
      from public.coverage_requirements r
      join public.venues v on v.id = r.venue_id
      where (p_venue_id is null or r.venue_id = p_venue_id)
        and exists (select 1 from public.coverage_submission_items s where s.requirement_id = r.id)
    ), '[]'::jsonb),
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.label, 'venueId', d.venue_id,
          'venueName', v.name, 'active', d.active)
        order by v.name nulls first, d.label, d.id)
      from public.publication_destinations d
      left join public.venues v on v.id = d.venue_id
      where p_venue_id is null or d.venue_id is null or d.venue_id = p_venue_id
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Asset detail
-- ---------------------------------------------------------------------------

create function public.library_asset_detail(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.media_assets;
  v_review text;
  v_usages jsonb;
  v_exports jsonb;
  v_export_ok boolean;
begin
  perform private.library_assert_admin();
  select a.* into v_a from public.media_assets a where a.id = p_asset_id;
  if v_a.id is null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_review := private.library_review_state(p_asset_id);
  if v_a.deleted_at is null then
    v_usages := coalesce(public.asset_usages(v_a.venue_id, p_asset_id) -> 'items', '[]'::jsonb);
    v_exports := public.export_asset_status(p_asset_id);
    v_export_ok := exists (select 1 from private.export_candidate_rows(v_a.venue_id, 'public') c
                           where c.asset_id = p_asset_id);
  else
    v_usages := '[]'::jsonb;
    v_exports := null;
    v_export_ok := false;
  end if;

  return jsonb_build_object(
    'asset', jsonb_build_object(
      'id', v_a.id, 'venueId', v_a.venue_id,
      'venueName', (select v.name from public.venues v where v.id = v_a.venue_id),
      'uploaderId', v_a.uploader_id,
      'uploaderName', (select p.display_name from public.profiles p where p.id = v_a.uploader_id),
      'uploaderActive', (select p.active from public.profiles p where p.id = v_a.uploader_id),
      'uploaderRole', v_a.uploader_role,
      'mediaType', v_a.media_type, 'mimeType', v_a.validated_mime_type,
      'originalFilename', v_a.original_filename, 'sizeBytes', v_a.size_bytes,
      'width', v_a.width, 'height', v_a.height, 'durationSeconds', v_a.duration_seconds,
      'uploadState', v_a.upload_state, 'createdAt', v_a.created_at,
      'capturedAt', v_a.captured_at, 'capturedAtSource', v_a.captured_at_source,
      'contentSha256', v_a.content_sha256, 'duplicateOfAssetId', v_a.duplicate_of_asset_id,
      'deletedAt', v_a.deleted_at,
      'timezone', (select v.timezone from public.venues v where v.id = v_a.venue_id)),
    'review', v_review,
    'useState', private.media_asset_use_state(p_asset_id, now()),
    'exportEligible', v_export_ok,
    'withdrawal', (
      select jsonb_build_object('withdrawnAt', w.withdrawn_at, 'reason', w.reason,
        'byName', (select p.display_name from public.profiles p where p.id = w.withdrawn_by))
      from public.media_asset_withdrawals w where w.asset_id = p_asset_id),
    'renditions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'kind', r.kind, 'objectKey', r.object_key, 'mimeType', r.mime_type,
          'width', r.width, 'height', r.height, 'pipelineVersion', r.pipeline_version,
          'createdAt', r.created_at,
          -- The approval a rendition carries is its asset's: renditions are
          -- derived from the unchanged original (edited versions are R2, FA-42).
          'approval', v_review)
        order by r.kind)
      from public.media_renditions r where r.asset_id = p_asset_id
    ), '[]'::jsonb),
    'labels', jsonb_build_object(
      'note', (select l.note from public.media_labels l where l.asset_id = p_asset_id),
      'contentTypes', coalesce((select to_jsonb(l.content_types) from public.media_labels l where l.asset_id = p_asset_id), '[]'::jsonb),
      'revision', (select l.revision from public.media_labels l where l.asset_id = p_asset_id),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('itemId', li.item_id, 'itemName', li.item_name,
            'variantName', li.variant_name, 'sectionName', li.section_name, 'addedAt', li.added_at)
          order by li.item_name, li.id)
        from public.media_label_items li where li.asset_id = p_asset_id), '[]'::jsonb),
      'places', coalesce((
        select jsonb_agg(jsonb_build_object('subjectId', l.subject_id, 'label', l.subject_label,
            'addedAt', l.added_at, 'removedAt', l.removed_at)
          order by l.added_at, l.id)
        from public.media_area_labels l where l.asset_id = p_asset_id), '[]'::jsonb)),
    'labelHistory', coalesce((
      select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at,
          'byName', (select p.display_name from public.profiles p where p.id = e.actor_id),
          'role', e.actor_role)
        order by e.id desc)
      from (select * from public.media_label_events e where e.asset_id = p_asset_id
            order by e.id desc limit 50) e), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(d.j order by d.at desc)
      from (
        select e.created_at as at, jsonb_build_object('kind', 'dish', 'slotName',
            coalesce((select m.item_name from public.menu_item_photos m where m.id = e.photo_id), 'Dish'),
            'action', e.action, 'to', e.to_state, 'reason', e.reason, 'at', e.created_at,
            'byName', (select p.display_name from public.profiles p where p.id = e.actor_id),
            'selfReview', e.self_review) as j
        from public.menu_item_photo_events e where e.asset_id = p_asset_id
        union all
        select d.decided_at, jsonb_build_object('kind', 'area', 'slotName', l.subject_label,
            'action', d.action, 'to', d.review_level, 'reason', d.reason, 'at', d.decided_at,
            'byName', (select p.display_name from public.profiles p where p.id = d.decided_by),
            'selfReview', false)
        from public.area_photo_decisions d
        join public.media_area_labels l on l.id = d.label_id
        where d.asset_id = p_asset_id
        union all
        select d.decided_at, jsonb_build_object('kind', 'amenity', 'slotName',
            coalesce((select q.question from public.venue_amenity_checks c
                      join public.amenity_catalogue q on q.key = c.template_key
                      where c.id = d.check_id), 'Facility'),
            'action', d.action, 'to', d.review_level, 'reason', d.reason, 'at', d.decided_at,
            'byName', (select p.display_name from public.profiles p where p.id = d.decided_by),
            'selfReview', false)
        from public.amenity_photo_decisions d where d.asset_id = p_asset_id
        union all
        select ci.decided_at, jsonb_build_object('kind', 'request', 'slotName',
            coalesce((select r.title from public.coverage_requirements r where r.id = ci.requirement_id), 'Request'),
            'action', ci.state, 'to', null, 'reason', ci.decision_reason, 'at', ci.decided_at,
            'byName', (select p.display_name from public.profiles p where p.id = ci.decided_by),
            'selfReview', coalesce(ci.self_review, false))
        from public.coverage_submission_items ci
        where ci.asset_id = p_asset_id and ci.decided_at is not null
      ) d), '[]'::jsonb),
    -- Required-item links: every slot the asset is used for, with its review
    -- state (asset_usages, S1-COV) and whether it is that slot's primary.
    'slots', coalesce((
      select jsonb_agg(s.j order by s.kind, s.name)
      from (
        select u ->> 'kind' as kind,
          coalesce(m.item_name, l.subject_label, t.title, 'Unknown') as name,
          jsonb_build_object(
            'kind', u ->> 'kind', 'slotId', u ->> 'slotId', 'state', u ->> 'state',
            'decidedAt', u -> 'decidedAt',
            'name', coalesce(m.item_name, l.subject_label, t.title, 'Unknown'),
            'variantName', m.variant_name,
            'photoId', m.id,
            'itemRevision', case when m.id is not null then coalesce(
              (select h.revision from public.menu_item_photo_heads h where h.item_id = m.item_id), 1) end,
            'isPrimary', case u ->> 'kind'
              when 'dish' then coalesce(m.is_primary, false)
              else private.slot_effective_primary(u ->> 'kind', (u ->> 'slotId')::uuid) is not distinct from p_asset_id
            end) as j
        from jsonb_array_elements(v_usages) u
        left join lateral (
          select m.* from public.menu_item_photos m
          where u ->> 'kind' = 'dish' and m.asset_id = p_asset_id and m.item_id = (u ->> 'slotId')::uuid
          order by m.created_at desc limit 1) m on true
        left join lateral (
          select l.subject_label from public.media_area_labels l
          where u ->> 'kind' = 'area' and l.asset_id = p_asset_id and l.subject_id = (u ->> 'slotId')::uuid
          order by l.added_at desc limit 1) l on true
        left join lateral (
          select q.question as title from public.venue_amenity_checks c
          join public.amenity_catalogue q on q.key = c.template_key
          where u ->> 'kind' = 'amenity' and c.id = (u ->> 'slotId')::uuid) t on true
      ) s), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(e.j)
      from (
        select jsonb_build_object('kind', 'amenity_fact', 'name', coalesce(t.title, f.amenity_key)) as j
        from public.venue_amenity_fact_media fm
        join public.venue_amenity_facts f on f.id = fm.fact_id
        left join public.coverage_amenity_templates t on t.key = f.amenity_key
        where fm.asset_id = p_asset_id
        union all
        select distinct jsonb_build_object('kind', 'amenity_answer', 'name', coalesce(q.question, c.template_key))
        from public.amenity_submission_assets sa
        join public.amenity_submissions s on s.id = sa.submission_id
        join public.venue_amenity_checks c on c.id = s.check_id
        left join public.amenity_catalogue q on q.key = c.template_key
        where sa.asset_id = p_asset_id
        union all
        select distinct jsonb_build_object('kind', 'fact', 'name', k.question_key)
        from public.knowledge_contribution_assets ka
        join public.knowledge_contributions k on k.id = ka.contribution_id
        where ka.asset_id = p_asset_id
      ) e), '[]'::jsonb),
    'exports', v_exports,
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'active', t.active)
        order by lower(t.name))
      from public.library_asset_tags x join public.library_tags t on t.id = x.tag_id
      where x.asset_id = p_asset_id), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'archivedAt', c.archived_at)
        order by c.name)
      from public.library_collection_items i join public.library_collections c on c.id = i.collection_id
      where i.asset_id = p_asset_id), '[]'::jsonb),
    -- Same file (SHA-256, FA-35) anywhere in the group, or marked a duplicate
    -- of / by this one. Admins see the whole group (spec §12.4).
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', d.id, 'venueName', v.name,
          'uploaderName', p.display_name, 'createdAt', d.created_at,
          'relation', case
            when d.id = v_a.duplicate_of_asset_id then 'original'
            when d.duplicate_of_asset_id = v_a.id then 'marked_duplicate'
            else 'same_file' end)
        order by d.created_at, d.id)
      from public.media_assets d
      join public.venues v on v.id = d.venue_id
      join public.profiles p on p.id = d.uploader_id
      where d.id <> v_a.id and d.deleted_at is null and d.upload_state = 'ready'
        and ((v_a.content_sha256 is not null and d.content_sha256 = v_a.content_sha256)
          or d.id = v_a.duplicate_of_asset_id or d.duplicate_of_asset_id = v_a.id)
      limit 20), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.j order by h.at desc)
      from (
        select w.created_at as at, jsonb_build_object('action', w.action, 'reason', w.reason,
            'at', w.created_at,
            'byName', (select p.display_name from public.profiles p where p.id = w.actor_id)) as j
        from public.media_asset_withdrawal_events w where w.asset_id = p_asset_id
        union all
        select r.created_at, jsonb_build_object('action', 'removal_' || r.action, 'reason', r.reason,
            'at', r.created_at,
            'byName', (select p.display_name from public.profiles p where p.id = r.actor_id))
        from public.media_removal_events r where r.asset_id = p_asset_id
        union all
        select t.created_at, jsonb_build_object('action', 'tag_' || t.action, 'reason', t.name,
            'at', t.created_at,
            'byName', (select p.display_name from public.profiles p where p.id = t.actor_id))
        from public.library_tag_events t where t.asset_id = p_asset_id
      ) h), '[]'::jsonb),
    'removalRequests', coalesce((
      select jsonb_agg(jsonb_build_object('requestId', r.id, 'reason', r.reason, 'state', r.state,
          'createdAt', r.created_at,
          'requesterName', (select p.display_name from public.profiles p where p.id = r.requested_by))
        order by r.created_at desc)
      from public.media_removal_requests r where r.asset_id = p_asset_id), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id,
          'declaredVenueName', (select v.name from public.venues v where v.id = c.declared_venue_id),
          'correctedVenueId', c.corrected_venue_id,
          'correctedVenueName', (select v.name from public.venues v where v.id = c.corrected_venue_id),
          'reason', c.reason, 'at', c.corrected_at,
          'byName', (select p.display_name from public.profiles p where p.id = c.corrected_by))
        order by c.id desc)
      from public.media_venue_corrections c where c.asset_id = p_asset_id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- library_page with the A4 filters
-- ---------------------------------------------------------------------------

drop function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer
);

-- As 20261101100000 (read its comment for the strategy), with these filters
-- added after the label filters. Each only narrows the result:
--   p_withdrawn        'active' (default: not withdrawn), 'withdrawn' or 'all'
--   p_review           public, reference, not_used or unreviewed
--   p_captured_from/to capture-time range (assets with an unknown capture
--                      time are left out while either is set)
--   p_orientation      landscape, portrait or square (from width and height)
--   p_request          a coverage requirement the asset was sent for
--   p_collection       a library collection
--   p_destination      a publication destination with any record for it
--   p_tag              a controlled tag
create function public.library_page(
  p_venue uuid default null,
  p_staff uuid default null,
  p_type public.media_type default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_item uuid default null,
  p_variant uuid default null,
  p_category text default null,
  p_content_type text default null,
  p_label_state text default null,
  p_query text default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25,
  p_candidate_cap integer default 3000,
  p_withdrawn text default 'active',
  p_review text default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null,
  p_orientation text default null,
  p_request uuid default null,
  p_collection uuid default null,
  p_destination uuid default null,
  p_tag uuid default null
)
returns setof public.media_assets
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_cap integer := least(greatest(coalesce(p_candidate_cap, 3000), 0), 20000);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 25);
  v_pattern text;
  v_ids uuid[];
  v_supplier text;
  v_query_items uuid[];
  v_category_items uuid[];
  v_ref_ids uuid[];
  v_ref_set boolean := false;
  v_sql text;
begin
  if p_query is not null and pg_catalog.btrim(p_query) <> '' then
    v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
      pg_catalog.btrim(p_query), pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92)),
      '%', pg_catalog.chr(92) || '%'), '_', pg_catalog.chr(92) || '_') || '%';
  end if;

  if v_cap > 0 then
    if p_item is not null or p_variant is not null then
      v_ids := private.library_candidate_ids('item', p_item, p_variant, null, v_cap);
      if v_ids is not null then v_supplier := 'item'; end if;
    end if;
    if v_supplier is null and v_pattern is not null then
      v_ids := private.library_candidate_ids('query', null, null, v_pattern, v_cap);
      if v_ids is not null then v_supplier := 'query'; end if;
    end if;
    if v_supplier is null and p_category is not null then
      v_ids := private.library_candidate_ids('category', null, null, p_category, v_cap);
      if v_ids is not null then v_supplier := 'category'; end if;
    end if;
    if v_supplier is null and p_content_type is not null then
      v_ids := private.library_candidate_ids('content', null, null, p_content_type, v_cap);
      if v_ids is not null then v_supplier := 'content'; end if;
    end if;
  end if;

  if v_cap > 0 and v_supplier is null
     and p_label_state in ('labelled', 'unlabelled')
     and p_item is null and p_variant is null and p_category is null
     and p_content_type is null and v_pattern is null
     -- The set page cannot leave rows out afterwards (a short page would
     -- read as the end), so it is used only when the withdrawn filter
     -- removes nothing.
     and (coalesce(p_withdrawn, 'active') = 'all'
       or (coalesce(p_withdrawn, 'active') = 'active' and not private.library_any_withdrawn()))
     and p_review is null
     and p_captured_from is null and p_captured_to is null and p_orientation is null
     and p_request is null and p_collection is null and p_destination is null and p_tag is null then
    v_ids := private.library_label_state_page(
      p_label_state, p_venue, p_staff, p_type, p_from, p_to,
      p_after_created_at, p_after_id, v_limit
    );
    if v_ids is not null then v_supplier := 'state'; end if;
  end if;

  if v_supplier is null then v_ids := null; end if;

  -- Record filters (collection, tag, request, destination): the intersection
  -- of their asset ids.
  if p_collection is not null then
    v_ref_ids := private.library_ref_ids('collection', p_collection); v_ref_set := true;
  end if;
  if p_tag is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('tag', p_tag)))
      else private.library_ref_ids('tag', p_tag) end;
    v_ref_set := true;
  end if;
  if p_request is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('request', p_request)))
      else private.library_ref_ids('request', p_request) end;
    v_ref_set := true;
  end if;
  if p_destination is not null then
    v_ref_ids := case when v_ref_set
      then array(select unnest(v_ref_ids) intersect select unnest(private.library_ref_ids('destination', p_destination)))
      else private.library_ref_ids('destination', p_destination) end;
    v_ref_set := true;
  end if;

  if v_pattern is not null and v_supplier is distinct from 'query' then
    v_query_items := private.library_candidate_ids('query_items', null, null, v_pattern, 5000);
  end if;
  if p_category is not null and v_supplier is distinct from 'category' then
    v_category_items := private.library_candidate_ids('category_items', null, null, p_category, 5000);
  end if;

  -- $1-$16 as 20261101100000; $17 review, $18 captured from, $19 captured
  -- to, $20 record-filter asset ids.
  v_sql := 'select a.* from public.media_assets a'
    || ' where a.deleted_at is null and a.upload_state = ''ready''';
  if p_venue is not null then v_sql := v_sql || ' and a.venue_id = $1'; end if;
  if p_staff is not null then v_sql := v_sql || ' and a.uploader_id = $2'; end if;
  if p_type is not null then v_sql := v_sql || ' and a.media_type = $3'; end if;
  if p_from is not null then v_sql := v_sql || ' and a.created_at >= $4'; end if;
  if p_to is not null then v_sql := v_sql || ' and a.created_at < $5'; end if;
  if p_after_created_at is not null and p_after_id is not null then
    v_sql := v_sql || ' and (a.created_at, a.id) < ($11, $12)';
  end if;
  if v_supplier is not null then v_sql := v_sql || ' and a.id = any ($13)'; end if;

  if (p_item is not null or p_variant is not null) and v_supplier is distinct from 'item' then
    v_sql := v_sql
      || ' and exists (select 1 from public.media_label_items li where li.asset_id = a.id'
      || case when p_item is not null then ' and li.item_id = $6' else '' end
      || case when p_variant is not null then ' and li.variant_id = $7' else '' end
      || ' offset 0)';
  end if;
  if p_category is not null and v_supplier is distinct from 'category' then
    v_sql := v_sql
      || ' and (exists (select 1 from public.media_label_items li'
      || ' where li.asset_id = a.id and li.section_slug = $8 offset 0)'
      || case when v_category_items is not null
        then ' or exists (select 1 from public.media_label_items li'
          || ' where li.asset_id = a.id and li.item_id = any ($16) offset 0))'
        else ' or exists (select 1 from public.media_label_items li'
          || ' join public.menu_entries e on e.item_id = li.item_id'
          || ' join public.menu_versions v on v.id = e.version_id'
          || ' join public.menu_sections s on s.id = e.section_id'
          || ' where li.asset_id = a.id and v.venue_id = a.venue_id'
          || ' and v.status = ''active'' and s.slug = $8 offset 0))'
        end;
  end if;
  if p_content_type is not null and v_supplier is distinct from 'content' then
    v_sql := v_sql
      || ' and exists (select 1 from public.media_labels l'
      || ' where l.asset_id = a.id and $9 = any (l.content_types) offset 0)';
  end if;
  if p_label_state is not null and v_supplier is distinct from 'state' then
    if p_label_state = 'labelled' then
      v_sql := v_sql
        || ' and exists (select 1 from public.media_labels l'
        || ' where l.asset_id = a.id and l.has_labels offset 0)';
    elsif p_label_state = 'unlabelled' then
      v_sql := v_sql
        || ' and not exists (select 1 from public.media_labels l'
        || ' where l.asset_id = a.id and l.has_labels offset 0)';
    else
      v_sql := v_sql || ' and false';
    end if;
  end if;
  if v_pattern is not null and v_supplier is distinct from 'query' then
    v_sql := v_sql
      || ' and (exists (select 1 from public.media_labels l'
      || ' where l.asset_id = a.id and l.note ilike $10 offset 0)'
      || ' or exists (select 1 from public.media_label_items li where li.asset_id = a.id'
      || ' and (li.item_name ilike $10 or li.variant_name ilike $10 or li.section_name ilike $10) offset 0)'
      || case when v_query_items is not null
        then ' or exists (select 1 from public.media_label_items li'
          || ' where li.asset_id = a.id and li.item_id = any ($15) offset 0)'
        else ' or exists (select 1 from public.media_label_items li'
          || ' join public.menu_entries e on e.item_id = li.item_id'
          || ' where li.asset_id = a.id and (e.name ilike $10'
          || ' or exists (select 1 from pg_catalog.unnest(e.aliases) as al(alias) where al.alias ilike $10)) offset 0)'
        end
      || ' or exists (select 1 from public.menu_item_suggestions su'
      || ' where su.asset_id = a.id and su.status = ''open'' and su.suggested_name ilike $10 offset 0))';
  end if;

  -- The A4 filters.
  if coalesce(p_withdrawn, 'active') = 'active' then
    v_sql := v_sql || ' and not private.library_is_withdrawn(a.id)';
  elsif p_withdrawn = 'withdrawn' then
    v_sql := v_sql || ' and private.library_is_withdrawn(a.id)';
  elsif p_withdrawn <> 'all' then
    v_sql := v_sql || ' and false';
  end if;
  if p_review is not null then
    if p_review in ('public', 'reference', 'not_used', 'unreviewed') then
      v_sql := v_sql || ' and private.library_review_state(a.id) = $17';
    else
      v_sql := v_sql || ' and false';
    end if;
  end if;
  if p_captured_from is not null then v_sql := v_sql || ' and a.captured_at >= $18'; end if;
  if p_captured_to is not null then v_sql := v_sql || ' and a.captured_at < $19'; end if;
  if p_orientation is not null then
    v_sql := v_sql || case p_orientation
      when 'landscape' then ' and a.width > a.height'
      when 'portrait' then ' and a.height > a.width'
      when 'square' then ' and a.width = a.height'
      else ' and false' end;
  end if;
  if v_ref_set then v_sql := v_sql || ' and a.id = any ($20)'; end if;

  v_sql := v_sql || ' order by a.created_at desc, a.id desc limit $14';

  return query execute v_sql
    using p_venue, p_staff, p_type, p_from, p_to, p_item, p_variant, p_category,
      p_content_type, v_pattern, p_after_created_at, p_after_id, v_ids, v_limit,
      v_query_items, v_category_items, p_review, p_captured_from, p_captured_to,
      coalesce(v_ref_ids, '{}'::uuid[]);
end;
$$;

comment on function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer, text, text, timestamptz,
  timestamptz, text, uuid, uuid, uuid, uuid
) is
  'One page of the admin library (feed, label and A4 filters, row-value cursor). SECURITY INVOKER; the app''s read path. Withdrawn assets are left out unless p_withdrawn says otherwise.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.library_assert_admin() from public, anon, authenticated;
revoke all on function private.library_reason(text) from public, anon, authenticated;

revoke all on function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer, text, text, timestamptz,
  timestamptz, text, uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.library_page(
  uuid, uuid, public.media_type, timestamptz, timestamptz, uuid, uuid, text, text,
  text, text, timestamptz, uuid, integer, integer, text, text, timestamptz,
  timestamptz, text, uuid, uuid, uuid, uuid
) to authenticated, service_role;

revoke all on function public.library_withdraw_asset(uuid, text) from public, anon, service_role;
revoke all on function public.library_restore_asset(uuid, text) from public, anon, service_role;
revoke all on function public.admin_correct_asset_venue(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.library_tags() from public, anon, service_role;
revoke all on function public.library_tag_save(uuid, text, boolean, integer) from public, anon, service_role;
revoke all on function public.library_asset_tag(uuid[], uuid, boolean) from public, anon, service_role;
revoke all on function public.library_collections(boolean) from public, anon, service_role;
revoke all on function public.library_collection_save(uuid, text, text, boolean, integer) from public, anon, service_role;
revoke all on function public.library_collection_set_items(uuid, uuid[], boolean) from public, anon, service_role;
revoke all on function public.library_filter_lists(uuid) from public, anon, service_role;
revoke all on function public.library_asset_detail(uuid) from public, anon, service_role;
grant execute on function public.library_withdraw_asset(uuid, text) to authenticated;
grant execute on function public.library_restore_asset(uuid, text) to authenticated;
grant execute on function public.admin_correct_asset_venue(uuid, uuid, text) to authenticated;
grant execute on function public.library_tags() to authenticated;
grant execute on function public.library_tag_save(uuid, text, boolean, integer) to authenticated;
grant execute on function public.library_asset_tag(uuid[], uuid, boolean) to authenticated;
grant execute on function public.library_collections(boolean) to authenticated;
grant execute on function public.library_collection_save(uuid, text, text, boolean, integer) to authenticated;
grant execute on function public.library_collection_set_items(uuid, uuid[], boolean) to authenticated;
grant execute on function public.library_filter_lists(uuid) to authenticated;
grant execute on function public.library_asset_detail(uuid) to authenticated;
