-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- S1-EXPORT (docs/plans/full-app-v1/sprint-plan.md; spec §14.1, §8 A5, §7 M3,
-- §10 inv. 9, AC31, AC32): manual export packages, Release 1.
--
--   Profiles   public.export_profiles: Original, Website image, Social image
--              and Custom size. Website and Social keep an editable format,
--              size and quality (an admin changes them with
--              export_profile_set; every change is kept in
--              export_profile_events). Custom takes its size per package.
--   Eligible   private.export_candidate_rows(venue, mode): the one rule for
--              what may be exported. Ready, undeleted still images whose use
--              has not been withdrawn (media_asset_use_state), and
--                public    a menu photo accepted for an item on the active
--                          menu; a place's photo whose latest decision is
--                          accepted (place not retired); an amenity photo on
--                          a current Yes only when the question's public media
--                          rule says so and a public use grant is in force
--                internal  also photos waiting for review, asked again or
--                          needing a recheck (admins only, marked internal)
--   Packages   export_packages and export_package_items record the exact
--              snapshot: each file's asset, venue, subject, approval and
--              version, readable filename stem, reviewed alt text and caption,
--              and use restrictions. Created by export_package_create, by a
--              venue's manager (its own venue, public only) or an admin (any
--              venue, either mode).
--   Download   export_package_download_start rechecks the caller's access and
--              every item's eligibility. When an item is no longer eligible the
--              package is invalidated (AC32) and nothing is returned: it can be
--              rebuilt without that file (export_package_rebuild). Otherwise a
--              download row is written and the route builds the ZIP; it then
--              calls export_package_download_finish with the files it wrote.
--              A finished download is the Exported record (AC31); Exported is
--              never Published (inv. 9).
--   Reads      export_candidates, export_packages_list, export_package_detail,
--              export_profiles.
--
-- Review levels (S1-COV) and fact freshness (S1-FACTS) land in parallel; when
-- they do, export_candidate_rows is the single place to tighten.
--
-- Rollback: revoke execute on the public functions below. Tables stay
-- (append-only records).

-- ---------------------------------------------------------------------------
-- Output profiles
-- ---------------------------------------------------------------------------

create table public.export_profiles (
  key text primary key check (key in ('original', 'website', 'social', 'custom')),
  label text not null check (length(label) between 1 and 60 and label = btrim(label)),
  format text not null check (format in ('original', 'webp', 'jpeg')),
  max_width integer check (max_width is null or max_width between 64 and 8192),
  max_height integer check (max_height is null or max_height between 64 and 8192),
  quality integer check (quality is null or quality between 40 and 100),
  position integer not null check (position >= 1),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint export_profiles_original check ((key = 'original') = (format = 'original')),
  constraint export_profiles_quality check ((format = 'original') = (quality is null)),
  -- Website and Social carry a size; Original has none; Custom takes it per package.
  constraint export_profiles_size check (
    case when key in ('website', 'social') then max_width is not null and max_height is not null
      else max_width is null and max_height is null end)
);

comment on table public.export_profiles is
  'S1-EXPORT: output profiles for export packages. Editable presets, not claims about any platform. Changed only through export_profile_set.';

insert into public.export_profiles (key, label, format, max_width, max_height, quality, position) values
  ('original', 'Original', 'original', null, null, null, 1),
  ('website', 'Website image', 'webp', 1600, 1600, 82, 2),
  ('social', 'Social image', 'jpeg', 1080, 1350, 85, 3),
  ('custom', 'Custom size', 'jpeg', null, null, 85, 4);

create trigger export_profiles_no_delete
  before delete on public.export_profiles
  for each row execute function private.append_only_guard();
create trigger export_profiles_no_truncate
  before truncate on public.export_profiles
  for each statement execute function private.append_only_guard();

create table public.export_profile_events (
  id bigint generated always as identity primary key,
  key text not null references public.export_profiles (key) on delete restrict,
  label text not null,
  format text not null,
  max_width integer,
  max_height integer,
  quality integer,
  revision integer not null,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default now()
);

comment on table public.export_profile_events is
  'S1-EXPORT: append-only history of export_profiles changes.';

-- ---------------------------------------------------------------------------
-- Packages, items, downloads
-- ---------------------------------------------------------------------------

create table public.export_packages (
  id uuid primary key default gen_random_uuid(),
  -- Null when the items come from more than one venue (admins).
  venue_id uuid references public.venues (id) on delete restrict,
  mode text not null check (mode in ('public', 'internal')),
  profile_key text not null references public.export_profiles (key) on delete restrict,
  -- The profile as it was when the package was made, with a Custom size.
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  note text check (note is null or (length(note) between 1 and 200 and note = btrim(note))),
  item_count integer not null check (item_count between 1 and 200),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text not null,
  rebuilt_from uuid references public.export_packages (id) on delete restrict,
  invalidated_at timestamptz,
  invalidated_reason text check (invalidated_reason in ('item_withdrawn', 'rebuilt')),
  invalidated_assets uuid[],
  constraint export_packages_request_key unique (created_by, request_key),
  constraint export_packages_invalidated check (
    (invalidated_at is null) = (invalidated_reason is null)
    and (invalidated_at is null) = (invalidated_assets is null))
);

create index export_packages_venue_idx on public.export_packages (venue_id, created_at desc);
create index export_packages_created_idx on public.export_packages (created_at desc);

comment on table public.export_packages is
  'S1-EXPORT: a prepared export (§14.1). Only the invalidation columns change, once.';

create table public.export_package_items (
  package_id uuid not null references public.export_packages (id) on delete restrict,
  position integer not null check (position between 1 and 200),
  asset_id uuid not null,
  venue_id uuid not null,
  subject_kind text not null check (subject_kind in ('menu_item', 'place', 'amenity')),
  subject_id uuid not null,
  subject_label text not null check (length(subject_label) between 1 and 200),
  category text not null check (category in ('food', 'drinks', 'spaces', 'facilities', 'other')),
  approval_kind text not null
    check (approval_kind in ('menu_item_photo', 'area_photo_decision', 'area_label', 'amenity_submission')),
  approval_id text not null,
  approval_version text not null,
  approval_level text not null check (approval_level in ('public', 'internal')),
  filename_stem text not null check (filename_stem ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(filename_stem) <= 160),
  alt_text text check (alt_text is null or (length(alt_text) between 1 and 250 and alt_text = btrim(alt_text))),
  caption text check (caption is null or (length(caption) between 1 and 500 and caption = btrim(caption))),
  use_restrictions text[] not null default '{}',
  uploaded_at timestamptz not null,
  constraint export_package_items_pkey primary key (package_id, position),
  constraint export_package_items_subject_key unique (package_id, asset_id, subject_kind, subject_id),
  constraint export_package_items_stem_key unique (package_id, filename_stem),
  constraint export_package_items_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index export_package_items_asset_idx on public.export_package_items (asset_id);

comment on table public.export_package_items is
  'S1-EXPORT: the exact snapshot of each file in a package. Append-only. Filenames never carry staff names, notes or location.';

create table public.export_package_downloads (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.export_packages (id) on delete restrict,
  downloaded_by uuid not null references public.profiles (id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  -- What the ZIP held: [{assetId, file, bytes, sha256, width, height, format}].
  files jsonb check (files is null or jsonb_typeof(files) = 'array'),
  constraint export_package_downloads_outcome check (completed_at is null or failed_at is null),
  constraint export_package_downloads_files check ((completed_at is null) = (files is null))
);

create index export_package_downloads_package_idx on public.export_package_downloads (package_id, started_at desc);

comment on table public.export_package_downloads is
  'S1-EXPORT: each ZIP download. A completed row is the Exported record (AC31); it never means Published.';

-- Append-only items and events.
do $$
declare
  t text;
begin
  foreach t in array array['export_profile_events', 'export_package_items'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

-- Packages: only the invalidation columns change, once. Downloads: only the
-- outcome, once. Neither is ever deleted.
create function private.export_packages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'export_record_immutable' using errcode = '42501';
  end if;
  if old.invalidated_at is not null
     or (to_jsonb(new) - array['invalidated_at', 'invalidated_reason', 'invalidated_assets'])
        is distinct from (to_jsonb(old) - array['invalidated_at', 'invalidated_reason', 'invalidated_assets']) then
    raise exception 'export_record_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger export_packages_guard
  before update or delete on public.export_packages
  for each row execute function private.export_packages_guard();
create trigger export_packages_no_truncate
  before truncate on public.export_packages
  for each statement execute function private.append_only_guard();

create function private.export_package_downloads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'export_record_immutable' using errcode = '42501';
  end if;
  if old.completed_at is not null or old.failed_at is not null
     or (to_jsonb(new) - array['completed_at', 'failed_at', 'files'])
        is distinct from (to_jsonb(old) - array['completed_at', 'failed_at', 'files']) then
    raise exception 'export_record_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger export_package_downloads_guard
  before update or delete on public.export_package_downloads
  for each row execute function private.export_package_downloads_guard();
create trigger export_package_downloads_no_truncate
  before truncate on public.export_package_downloads
  for each statement execute function private.append_only_guard();

revoke all on function private.export_packages_guard() from public, anon, authenticated, service_role;
revoke all on function private.export_package_downloads_guard() from public, anon, authenticated, service_role;

-- Reads and writes go through the functions below only.
alter table public.export_profiles enable row level security;
alter table public.export_profile_events enable row level security;
alter table public.export_packages enable row level security;
alter table public.export_package_items enable row level security;
alter table public.export_package_downloads enable row level security;
revoke all on table public.export_profiles, public.export_profile_events, public.export_packages,
  public.export_package_items, public.export_package_downloads
from public, anon, authenticated, service_role;
grant select on table public.export_profiles, public.export_profile_events, public.export_packages,
  public.export_package_items, public.export_package_downloads
to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A lower-case, hyphenated slug of at most p_max characters ('' when nothing
-- is left). Used for filename stems only, never as an identity.
create function private.export_slug(p_text text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(left(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), p_max), '-');
$$;

-- May the caller export from this venue in this mode? Active managers of the
-- venue (public mode) and active admins (either mode).
create function private.export_can_use_venue(p_venue_id uuid, p_mode text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_venue_id is not null
    and private.is_active_user()
    and private.can_manage_venue(p_venue_id)
    and (p_mode = 'public' or private.is_active_admin());
$$;

-- The one eligibility rule (see the header). One row per exportable
-- (asset, subject). approval_level says whether the row is public-approved.
create function private.export_candidate_rows(p_venue_id uuid, p_mode text)
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
      private.media_asset_use_state(a.id, now()) as use_state
    from public.media_assets a
    where a.venue_id = p_venue_id
      and a.upload_state = 'ready'
      and a.deleted_at is null
      and a.media_type = 'image'
  ),
  usable as (
    select * from assets where use_state is distinct from 'withdrawn'
  ),
  menu as (
    select distinct on (p.asset_id, p.item_id)
      p.asset_id, p.item_id, e.name, s.kind, p.id as photo_id, p.revision, p.state
    from public.menu_item_photos p
    join usable u on u.id = p.asset_id
    join public.menu_items i on i.id = p.item_id and i.archived_at is null
    join public.menu_versions v on v.venue_id = p.venue_id and v.status = 'active'
    join public.menu_entries e on e.version_id = v.id and e.item_id = p.item_id
    join public.menu_sections s on s.id = e.section_id and s.version_id = v.id
    where p.venue_id = p_venue_id
      and (p.state = 'accepted'
        or (p_mode = 'internal' and p.state in ('better_photo_requested', 'needs_recheck')))
    order by p.asset_id, p.item_id, (p.state = 'accepted') desc, p.decided_at desc, p.id
  ),
  area as (
    select l.asset_id, l.subject_id, s.label, l.id as label_id, d.id as decision_id, d.action
    from public.media_area_labels l
    join usable u on u.id = l.asset_id
    join public.knowledge_subjects s on s.id = l.subject_id and s.venue_id = l.venue_id and s.retired_at is null
    left join lateral (
      select d.id, d.action from public.area_photo_decisions d
      where d.label_id = l.id order by d.id desc limit 1
    ) d on true
    where l.venue_id = p_venue_id
      and l.removed_at is null
      and (d.action = 'accepted'
        or (p_mode = 'internal' and (d.action is null or d.action = 'needs_another_photo')))
  ),
  amenity as (
    select distinct on (c.id, sa.asset_id)
      sa.asset_id, c.id as check_id, c.template_key, cat.question, sub.id as submission_id,
      c.revision, u.use_state
    from public.venue_amenity_checks c
    join public.amenity_catalogue cat on cat.key = c.template_key
    join public.amenity_submissions sub on sub.id = c.current_submission_id
    join public.amenity_submission_assets sa on sa.submission_id = sub.id and sa.evidence_kind = 'photo'
    join usable u on u.id = sa.asset_id
    where c.venue_id = p_venue_id
      and c.status = 'active'
      and c.progress = 'complete'
      and sub.answer = 'yes'
      and private.knowledge_in_scope(c.venue_id, c.template_key)
      and coalesce((private.knowledge_check_service_end(c.id, now()) ->> 'inEffect')::boolean, false) = false
    order by c.id, sa.asset_id
  ),
  amenity_rated as (
    select am.*,
      (am.use_state = 'granted'
        and coalesce((private.knowledge_public_media_eligible(p_venue_id, am.template_key) ->> 'eligible')::boolean, false)
      ) as public_ok
    from amenity am
  ),
  rows as (
    select m.asset_id, 'menu_item'::text as subject_kind, m.item_id as subject_id, m.name as subject_label,
      m.name as slug_source,
      case m.kind when 'food' then 'food' when 'drinks' then 'drinks' else 'other' end as category,
      'menu_item_photo'::text as approval_kind, m.photo_id::text as approval_id, m.revision::text as approval_version,
      case when m.state = 'accepted' then 'public' else 'internal' end as approval_level
    from menu m
    union all
    select ar.asset_id, 'place', ar.subject_id, ar.label, ar.label, 'spaces',
      case when ar.decision_id is null then 'area_label' else 'area_photo_decision' end,
      coalesce(ar.decision_id::text, ar.label_id::text),
      coalesce(ar.decision_id::text, ar.label_id::text),
      case when ar.action = 'accepted' then 'public' else 'internal' end
    from area ar
    union all
    select r.asset_id, 'amenity', r.check_id, r.question, replace(r.template_key, '_', ' '), 'facilities',
      'amenity_submission', r.submission_id::text, r.revision::text,
      case when r.public_ok then 'public' else 'internal' end
    from amenity_rated r
  )
  select r.asset_id, p_venue_id, r.subject_kind, r.subject_id, r.subject_label,
    coalesce(nullif(private.export_slug(r.slug_source, 60), ''), 'photo'),
    r.category, r.approval_kind, r.approval_id, r.approval_version, r.approval_level,
    u.created_at, u.width, u.height, u.use_baseline
  from rows r
  join usable u on u.id = r.asset_id
  where p_mode = 'internal' or r.approval_level = 'public';
$$;

-- Items of a package that are no longer eligible as they were snapshotted:
-- gone from the venue's candidates in the package's mode, or (public mode)
-- approved through a different decision since.
create function private.export_package_stale(p_package_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with pkg as (
    select p.id, p.mode from public.export_packages p where p.id = p_package_id
  ),
  venues as (
    select distinct i.venue_id from public.export_package_items i where i.package_id = p_package_id
  ),
  cands as (
    select c.* from venues v cross join pkg
    cross join lateral private.export_candidate_rows(v.venue_id, pkg.mode) c
  )
  select coalesce(array_agg(distinct i.asset_id), '{}'::uuid[])
  from public.export_package_items i
  cross join pkg
  where i.package_id = p_package_id
    and not exists (
      select 1 from cands c
      where c.asset_id = i.asset_id
        and c.subject_kind = i.subject_kind
        and c.subject_id = i.subject_id
        and (pkg.mode = 'internal' or c.approval_id = i.approval_id)
    );
$$;

-- May the caller open this package? Admins: any. Others: public packages
-- whose every item's venue they manage. Rechecked on every call.
create function private.export_package_access(p_package_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (select 1 from public.export_packages p where p.id = p_package_id)
    and (
      private.is_active_admin()
      or (
        (select p.mode from public.export_packages p where p.id = p_package_id) = 'public'
        and not exists (
          select 1 from public.export_package_items i
          where i.package_id = p_package_id
            and not private.export_can_use_venue(i.venue_id, 'public')
        )
      )
    );
$$;

-- Whether a public use of the asset has a completed download (Exported).
create function private.export_asset_last_exported(p_asset_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(d.completed_at)
  from public.export_package_items i
  join public.export_package_downloads d on d.package_id = i.package_id and d.completed_at is not null
  where i.asset_id = p_asset_id;
$$;

-- Inserts a package after every check. Shared by create and rebuild.
-- p_items: [{assetId, subjectKind, subjectId, altText?, caption?}].
create function private.export_package_insert(
  p_uid uuid,
  p_request_key text,
  p_request_hash text,
  p_mode text,
  p_profile jsonb,
  p_items jsonb,
  p_note text,
  p_rebuilt_from uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_item jsonb;
  v_pos integer := 0;
  v_asset public.media_assets;
  v_slug text;
  v_cand record;
  v_alt text;
  v_caption text;
  v_stem text;
  v_stems text[] := '{}'::text[];
  v_seen text[] := '{}'::text[];
  v_key text;
  v_restrictions text[];
  v_venues uuid[] := '{}'::uuid[];
  v_rows jsonb := '[]'::jsonb;
begin
  -- Validate every item first, so the package row is written with its venue.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'assetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_item ->> 'subjectId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_item ->> 'subjectKind', '') not in ('menu_item', 'place', 'amenity') then
      raise exception 'export_item_invalid' using errcode = '22023';
    end if;
    v_key := lower(v_item ->> 'assetId') || '/' || (v_item ->> 'subjectKind') || '/' || lower(v_item ->> 'subjectId');
    if v_key = any(v_seen) then
      raise exception 'export_item_duplicate' using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;

    select a.* into v_asset from public.media_assets a where a.id = (v_item ->> 'assetId')::uuid;
    if not found or not private.export_can_use_venue(v_asset.venue_id, p_mode) then
      raise exception 'export_not_allowed' using errcode = '42501';
    end if;
    select c.* into v_cand from private.export_candidate_rows(v_asset.venue_id, p_mode) c
    where c.asset_id = v_asset.id
      and c.subject_kind = v_item ->> 'subjectKind'
      and c.subject_id = (v_item ->> 'subjectId')::uuid
    limit 1;
    if not found then
      raise exception 'export_item_unavailable' using errcode = '22023', detail = v_asset.id::text;
    end if;

    v_alt := nullif(btrim(coalesce(v_item ->> 'altText', '')), '');
    v_caption := nullif(btrim(coalesce(v_item ->> 'caption', '')), '');
    if (v_alt is not null and length(v_alt) > 250) or (v_caption is not null and length(v_caption) > 500) then
      raise exception 'export_text_too_long' using errcode = '22023';
    end if;

    select v.slug into v_slug from public.venues v where v.id = v_asset.venue_id;
    v_stem := v_slug || '-' || v_cand.subject_slug || '-' || left(replace(v_asset.id::text, '-', ''), 8);
    if v_stem = any(v_stems) then
      v_stem := v_stem || '-' || v_pos;
    end if;
    v_stems := v_stems || v_stem;

    v_restrictions := '{}'::text[];
    if p_mode = 'internal' or v_cand.approval_level = 'internal' then
      v_restrictions := v_restrictions || 'internal_only'::text;
    end if;
    if v_cand.use_baseline = 'legacy_unknown' then
      v_restrictions := v_restrictions || 'contribution_terms_unrecorded'::text;
    end if;
    if not v_asset.venue_id = any(v_venues) then
      v_venues := v_venues || v_asset.venue_id;
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'position', v_pos, 'assetId', v_asset.id, 'venueId', v_asset.venue_id,
      'subjectKind', v_cand.subject_kind, 'subjectId', v_cand.subject_id,
      'subjectLabel', left(v_cand.subject_label, 200), 'category', v_cand.category,
      'approvalKind', v_cand.approval_kind, 'approvalId', v_cand.approval_id,
      'approvalVersion', v_cand.approval_version, 'approvalLevel', v_cand.approval_level,
      'stem', v_stem, 'alt', v_alt, 'caption', v_caption,
      'restrictions', to_jsonb(v_restrictions), 'uploadedAt', v_cand.uploaded_at));
  end loop;

  insert into public.export_packages (id, venue_id, mode, profile_key, profile, note, item_count,
    created_by, request_key, request_hash, rebuilt_from)
  values (v_id, case when cardinality(v_venues) = 1 then v_venues[1] end, p_mode, p_profile ->> 'key',
    p_profile, p_note, v_pos, p_uid, p_request_key, p_request_hash, p_rebuilt_from);

  insert into public.export_package_items (package_id, position, asset_id, venue_id, subject_kind,
    subject_id, subject_label, category, approval_kind, approval_id, approval_version, approval_level,
    filename_stem, alt_text, caption, use_restrictions, uploaded_at)
  select v_id, (r ->> 'position')::integer, (r ->> 'assetId')::uuid, (r ->> 'venueId')::uuid,
    r ->> 'subjectKind', (r ->> 'subjectId')::uuid, r ->> 'subjectLabel', r ->> 'category',
    r ->> 'approvalKind', r ->> 'approvalId', r ->> 'approvalVersion', r ->> 'approvalLevel',
    r ->> 'stem', r ->> 'alt', r ->> 'caption',
    array(select jsonb_array_elements_text(r -> 'restrictions')), (r ->> 'uploadedAt')::timestamptz
  from jsonb_array_elements(v_rows) r;

  return v_id;
end;
$$;

revoke all on function private.export_slug(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.export_can_use_venue(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.export_candidate_rows(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.export_package_stale(uuid) from public, anon, authenticated, service_role;
revoke all on function private.export_package_access(uuid) from public, anon, authenticated, service_role;
revoke all on function private.export_asset_last_exported(uuid) from public, anon, authenticated, service_role;
revoke all on function private.export_package_insert(uuid, text, text, text, jsonb, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
