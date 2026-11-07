-- Menu item photos: which ready, labelled still image is accepted for which
-- stable menu item ("Our menu"). Additive and separate from the monthly
-- targets and section coverage, which keep their own counting rules.
--
-- Counting rule (private.menu_item_photo_rows, in one place):
--   * eligible items: entries of the venue's ACTIVE version in sections of kind
--     food or drinks, item not archived. `other` sections are left out.
--   * an item is covered when at least one accepted row has an asset that is
--     still ready, undeleted and an image. Deleted or ineligible photos drop out
--     at read time, as private.requirement_status_rows does for sections.
--   * one primary per item: the flagged row when its asset is eligible, else
--     the earliest eligible accepted row, else the item is a gap.
--
-- Writes: review_menu_item_photo, withdraw_menu_item_photo and
-- set_menu_item_primary_photo. Each derives the actor from auth.uid(), checks
-- the database-backed manager scope against the asset's ORIGINAL upload venue,
-- takes locks in one order (asset row, then the shared venue menu lock, then the
-- item head) and compares the item head's revision (stale -> coverage_conflict,
-- 40001). A client request key makes retries safe. Self-review is allowed and
-- recorded, as for coverage review.
--
-- Automatic changes:
--   * removing or changing a label tuple invalidates its live rows (trigger on
--     media_label_items, inside save_media_labels' asset and venue locks);
--   * activating a menu version carries accepted rows whose item is materially
--     the same, and sends the rest to needs_recheck (trigger on menu_versions,
--     under activate_menu_version's exclusive venue lock). Rows of items that
--     left the menu are untouched: they leave the denominator and keep history.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.menu_item_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  item_id uuid not null,
  -- Variant context of the label that was reviewed; coverage is per item.
  variant_id uuid,
  asset_id uuid not null,
  -- The asset's uploader (set by the insert guard check). Authorship never moves.
  author_id uuid not null references public.profiles (id) on delete restrict,
  state text not null
    check (state in ('accepted', 'better_photo_requested', 'needs_recheck', 'withdrawn', 'invalidated')),
  is_primary boolean not null default false,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  recheck_kind text check (recheck_kind in ('name_changed', 'section_changed', 'variant_removed')),
  invalidation_kind text check (invalidation_kind in ('label_removed')),
  -- Snapshot of the active entry at the decision (updated when carried).
  item_name text not null check (length(item_name) between 1 and 120),
  variant_name text check (variant_name is null or length(variant_name) between 1 and 80),
  section_name text not null check (length(section_name) between 1 and 120),
  section_kind text not null check (section_kind in ('food', 'drinks', 'other')),
  menu_version_id uuid not null,
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  self_review boolean not null,
  withdrawn_by uuid references public.profiles (id) on delete restrict,
  withdrawn_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_item_photos_id_venue_key unique (id, venue_id),
  -- Evidence venue = the asset's immutable upload-time venue.
  constraint menu_item_photos_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint menu_item_photos_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_item_photos_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint menu_item_photos_version_fkey foreign key (menu_version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_item_photos_primary_accepted check (not is_primary or state = 'accepted'),
  constraint menu_item_photos_reason check (
    state not in ('better_photo_requested', 'withdrawn') or reason is not null
  ),
  constraint menu_item_photos_recheck check ((state = 'needs_recheck') = (recheck_kind is not null)),
  constraint menu_item_photos_invalidated check ((state = 'invalidated') = (invalidation_kind is not null)),
  constraint menu_item_photos_withdrawn_pair check (
    (state = 'withdrawn') = (withdrawn_at is not null) and (withdrawn_at is null) = (withdrawn_by is null)
  ),
  constraint menu_item_photos_variant_snapshot check ((variant_id is null) = (variant_name is null))
);

-- One live decision per label tuple; re-reviewing after a final state is a new row.
create unique index menu_item_photos_one_live
  on public.menu_item_photos (asset_id, item_id, variant_id) nulls not distinct
  where state in ('accepted', 'better_photo_requested', 'needs_recheck');
create unique index menu_item_photos_one_primary
  on public.menu_item_photos (item_id) where is_primary;
create index menu_item_photos_item_idx
  on public.menu_item_photos (item_id, state, decided_at, id);
create index menu_item_photos_venue_state_idx
  on public.menu_item_photos (venue_id, state);
create index menu_item_photos_asset_idx on public.menu_item_photos (asset_id);
create index menu_item_photos_author_idx on public.menu_item_photos (author_id);

comment on table public.menu_item_photos is
  'Explicit per-item review of a labelled photo for Our menu. Acceptance governs item completion only, never visibility.';

-- Per-item compare-and-set head: concurrent reviewers of one item conflict.
-- A missing head reads as revision 1.
create table public.menu_item_photo_heads (
  item_id uuid primary key,
  venue_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint menu_item_photo_heads_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict
);

create index menu_item_photo_heads_venue_idx on public.menu_item_photo_heads (venue_id);

create table public.menu_item_photo_events (
  id bigint generated always as identity primary key,
  photo_id uuid not null references public.menu_item_photos (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  item_id uuid not null,
  variant_id uuid,
  asset_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete restrict,
  actor_role text not null check (actor_role in ('staff', 'manager', 'admin', 'system')),
  action text not null check (action in (
    'accepted', 'better_photo_requested', 'withdrawn', 'primary_set', 'primary_cleared',
    'invalidated', 'needs_recheck', 'carried'
  )),
  from_state text check (from_state in ('accepted', 'better_photo_requested', 'needs_recheck', 'withdrawn', 'invalidated')),
  to_state text not null check (to_state in ('accepted', 'better_photo_requested', 'needs_recheck', 'withdrawn', 'invalidated')),
  revision integer not null check (revision >= 1),
  item_revision integer not null check (item_revision >= 1),
  reason text check (reason is null or length(reason) between 1 and 500),
  self_review boolean not null default false,
  client_request_key text check (client_request_key is null or client_request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

-- A retried write with the same key is recognised, never recorded twice.
create unique index menu_item_photo_events_request_key
  on public.menu_item_photo_events (actor_id, client_request_key)
  where client_request_key is not null;
create index menu_item_photo_events_photo_idx on public.menu_item_photo_events (photo_id, id);
create index menu_item_photo_events_venue_idx on public.menu_item_photo_events (venue_id, created_at desc);
create index menu_item_photo_events_self_review_idx
  on public.menu_item_photo_events (venue_id, created_at desc) where self_review;

comment on table public.menu_item_photo_events is
  'Append-only history of every item-photo decision and automatic change, with self-review recorded.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Author is the asset's uploader whoever inserts; rows start live at revision 1.
create function private.menu_item_photos_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.media_assets a
    where a.id = new.asset_id and a.uploader_id = new.author_id
  ) then
    raise exception 'menu_item_photo_author_mismatch' using errcode = '42501';
  end if;
  if new.revision <> 1 or new.state not in ('accepted', 'better_photo_requested') then
    raise exception 'menu_item_photo_must_start_live' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Identity never changes; withdrawn and invalidated are final (re-accepting is
-- a new row); every change increments the revision.
create function private.menu_item_photos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.venue_id is distinct from old.venue_id
     or new.item_id is distinct from old.item_id
     or new.variant_id is distinct from old.variant_id
     or new.asset_id is distinct from old.asset_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'menu_item_photo_identity_immutable' using errcode = '42501';
  end if;
  if old.state in ('withdrawn', 'invalidated')
     or (new.state is distinct from old.state and not (
       (old.state = 'accepted' and new.state in ('withdrawn', 'invalidated', 'needs_recheck'))
       or (old.state = 'better_photo_requested' and new.state in ('accepted', 'withdrawn', 'invalidated'))
       or (old.state = 'needs_recheck'
           and new.state in ('accepted', 'better_photo_requested', 'withdrawn', 'invalidated'))
     )) then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.state, new.state);
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.menu_item_photo_heads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.item_id is distinct from old.item_id or new.venue_id is distinct from old.venue_id then
    raise exception 'menu_item_photo_identity_immutable' using errcode = '42501';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'coverage_revision_must_increment' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger menu_item_photos_insert_guard
  before insert on public.menu_item_photos
  for each row execute function private.menu_item_photos_insert_guard();
create trigger menu_item_photos_guard
  before update on public.menu_item_photos
  for each row execute function private.menu_item_photos_guard();
create trigger menu_item_photos_set_updated_at
  before update on public.menu_item_photos
  for each row execute function private.set_updated_at();
create trigger menu_item_photo_heads_guard
  before update on public.menu_item_photo_heads
  for each row execute function private.menu_item_photo_heads_guard();
create trigger menu_item_photo_heads_set_updated_at
  before update on public.menu_item_photo_heads
  for each row execute function private.set_updated_at();

-- History is never deleted.
create trigger menu_item_photos_no_delete
  before delete on public.menu_item_photos
  for each row execute function private.append_only_guard();
create trigger menu_item_photos_no_truncate
  before truncate on public.menu_item_photos
  for each statement execute function private.append_only_guard();
create trigger menu_item_photo_heads_no_delete
  before delete on public.menu_item_photo_heads
  for each row execute function private.append_only_guard();
create trigger menu_item_photo_heads_no_truncate
  before truncate on public.menu_item_photo_heads
  for each statement execute function private.append_only_guard();
create trigger menu_item_photo_events_append_only
  before update or delete on public.menu_item_photo_events
  for each row execute function private.append_only_guard();
create trigger menu_item_photo_events_no_truncate
  before truncate on public.menu_item_photo_events
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- "Materially the same" name: case, outer and repeated spaces are ignored.
create function private.menu_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'));
$$;

-- Locks the item's head row (creating it at revision 1) and returns its revision.
create function private.lock_item_photo_head(p_item_id uuid, p_venue_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revision integer;
begin
  insert into public.menu_item_photo_heads (item_id, venue_id)
  values (p_item_id, p_venue_id)
  on conflict (item_id) do nothing;
  select h.revision into v_revision
  from public.menu_item_photo_heads h
  where h.item_id = p_item_id
  for update;
  return v_revision;
end;
$$;

-- One increment per operation per item (an absent head was revision 1).
create function private.bump_item_photo_heads(p_item_ids uuid[], p_venue_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.menu_item_photo_heads as h (item_id, venue_id, revision)
  select distinct u.id, p_venue_id, 2 from unnest(p_item_ids) as u(id)
  on conflict (item_id) do update set revision = h.revision + 1;
$$;

-- Records the photo row's current state as the result of p_action.
create function private.record_item_photo_event(
  p_photo_id uuid,
  p_action text,
  p_from_state text,
  p_reason text,
  p_self_review boolean,
  p_key text,
  p_actor_role text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.menu_item_photo_events (
    photo_id, venue_id, item_id, variant_id, asset_id, author_id, actor_id, actor_role,
    action, from_state, to_state, revision, item_revision, reason, self_review,
    client_request_key, detail
  )
  select p.id, p.venue_id, p.item_id, p.variant_id, p.asset_id, p.author_id,
    (select pr.id from public.profiles pr where pr.id = (select auth.uid())),
    coalesce(p_actor_role, private.coverage_actor_role(p.venue_id)),
    p_action, p_from_state, p.state, p.revision,
    coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = p.item_id), 1),
    p_reason, coalesce(p_self_review, false), p_key, coalesce(p_detail, '{}'::jsonb)
  from public.menu_item_photos p
  where p.id = p_photo_id;
$$;

-- The item's effective primary: the flagged row when its asset is eligible,
-- otherwise the earliest eligible accepted row, otherwise none (a gap).
create function private.menu_item_effective_primary(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.menu_item_photos p
  join public.media_assets a on a.id = p.asset_id
  where p.item_id = p_item_id and p.state = 'accepted'
    and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  order by p.is_primary desc, p.decided_at, p.id
  limit 1;
$$;

-- Clears every primary flag of the item except p_keep, recording each.
create function private.clear_item_primary(p_item_id uuid, p_keep uuid, p_actor_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.menu_item_photos p
    where p.item_id = p_item_id and p.is_primary and p.id is distinct from p_keep
    for update
  loop
    update public.menu_item_photos p
    set is_primary = false, revision = p.revision + 1
    where p.id = v_id;
    perform private.record_item_photo_event(v_id, 'primary_cleared', 'accepted', null, false, null, p_actor_role);
  end loop;
end;
$$;

-- After a primary was withdrawn, invalidated or sent for recheck: flag the
-- earliest eligible accepted row, or leave the item a gap. Returns the
-- effective primary.
create function private.promote_item_primary(p_item_id uuid, p_actor_role text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  if exists (
    select 1 from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = p_item_id and p.is_primary
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  ) then
    return private.menu_item_effective_primary(p_item_id);
  end if;
  v_next := private.menu_item_effective_primary(p_item_id);
  if v_next is not null then
    perform private.clear_item_primary(p_item_id, v_next, p_actor_role);
    update public.menu_item_photos p
    set is_primary = true, revision = p.revision + 1
    where p.id = v_next;
    perform private.record_item_photo_event(v_next, 'primary_set', 'accepted', null, false, null, p_actor_role);
  end if;
  return v_next;
end;
$$;

-- The venue whose Our menu the caller may read: active staff at their current
-- venue (managers included) or an active admin naming one. Anything else is
-- the same venue_not_found.
create function private.menu_photo_read_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff_venue uuid := private.active_staff_venue_id();
  v_venue uuid := coalesce(p_venue_id, v_staff_venue);
begin
  if auth.uid() is null or v_venue is null
     or not (private.is_active_admin() or v_venue = v_staff_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  return v_venue;
end;
$$;

-- The counting rule, once: one row per eligible item of the venue's active
-- version. Candidate counts (labelled, eligible, not yet decided or needing a
-- recheck) are filled only for reviewers; managers count active uploaders' and
-- their own photos, admins everyone's.
create function private.menu_item_photo_rows(p_venue_id uuid, p_reviewer boolean, p_admin boolean)
returns table (
  menu_version_id uuid,
  section_id uuid,
  section_name text,
  section_kind text,
  section_position integer,
  item_id uuid,
  entry_position integer,
  name text,
  description text,
  aliases text[],
  variants jsonb,
  covered boolean,
  accepted_count integer,
  needs_recheck_count integer,
  primary_photo_id uuid,
  primary_asset_id uuid,
  item_revision integer,
  candidate_count integer,
  oldest_candidate_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, s.id, s.name, s.kind, s.position, e.item_id, e.position, e.name, e.description, e.aliases,
    coalesce((
      select jsonb_agg(jsonb_build_object('variantId', ev.variant_id, 'name', ev.name) order by ev.position)
      from public.menu_entry_variants ev where ev.entry_id = e.id), '[]'::jsonb),
    pr.photo_id is not null,
    coalesce(ac.accepted, 0), coalesce(ac.recheck, 0),
    pr.photo_id, pr.asset_id,
    coalesce(h.revision, 1),
    case when p_reviewer then coalesce(c.n, 0) end,
    case when p_reviewer then c.oldest end
  from public.menu_versions v
  join public.menu_sections s on s.version_id = v.id and s.kind in ('food', 'drinks')
  join public.menu_entries e on e.version_id = v.id and e.section_id = s.id
  join public.menu_items i on i.id = e.item_id and i.archived_at is null
  left join public.menu_item_photo_heads h on h.item_id = e.item_id
  left join lateral (
    select p.id as photo_id, p.asset_id
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = e.item_id and p.state = 'accepted'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
    order by p.is_primary desc, p.decided_at, p.id
    limit 1
  ) pr on true
  left join lateral (
    select
      (count(distinct p.asset_id) filter (where p.state = 'accepted'))::integer as accepted,
      -- Rechecks count only where this caller's reviewers can act on them:
      -- the same uploader scope as candidates and review (admins: all).
      (count(*) filter (where p.state = 'needs_recheck'
        and (p_admin or (up.active and up.role = 'staff') or a.uploader_id = (select auth.uid()))))::integer as recheck
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    join public.profiles up on up.id = a.uploader_id
    where p.item_id = e.item_id and p.state in ('accepted', 'needs_recheck')
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  ) ac on true
  left join lateral (
    select count(*)::integer as n, min(a.created_at) as oldest
    from public.media_label_items li
    join public.media_assets a on a.id = li.asset_id
    join public.profiles up on up.id = a.uploader_id
    where p_reviewer
      and li.item_id = e.item_id and li.venue_id = p_venue_id
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      -- A variant no longer offered still counts while its row awaits a
      -- recheck (withdraw-only), so the queue and this count agree.
      and (li.variant_id is null or exists (
        select 1 from public.menu_entry_variants ev
        where ev.entry_id = e.id and ev.variant_id = li.variant_id)
        or exists (
          select 1 from public.menu_item_photos p
          where p.asset_id = li.asset_id and p.item_id = li.item_id
            and p.variant_id = li.variant_id and p.state = 'needs_recheck'))
      and (p_admin or (up.active and up.role = 'staff') or a.uploader_id = (select auth.uid()))
      and not exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = li.asset_id and p.item_id = li.item_id
          and p.variant_id is not distinct from li.variant_id
          and p.state in ('accepted', 'better_photo_requested'))
      -- Withdrawn since the label was (re)saved: decided, not waiting.
      and not exists (
        select 1 from public.menu_item_photos p
        where p.asset_id = li.asset_id and p.item_id = li.item_id
          and p.variant_id is not distinct from li.variant_id
          and p.state = 'withdrawn' and p.withdrawn_at >= li.added_at
          and not exists (
            select 1 from public.menu_item_photos q
            where q.asset_id = p.asset_id and q.item_id = p.item_id
              and q.variant_id is not distinct from p.variant_id
              and q.state = 'needs_recheck'))
  ) c on true
  where v.venue_id = p_venue_id and v.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Automatic changes
-- ---------------------------------------------------------------------------

-- A removed (or changed: delete + insert) label tuple invalidates its live
-- rows. Runs inside save_media_labels after its asset lock and shared venue
-- lock. One statement can remove tuples for several items, so the trigger is
-- statement-level: it locks every affected item head in item_id order (the
-- same order activation uses) before touching photo rows, so two concurrent
-- label saves cannot lock heads in opposite orders. Lock order: asset, venue,
-- item heads by item_id. Each item's head is bumped once per statement.
create function private.menu_item_photos_label_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_row record;
  v_items uuid[] := '{}'::uuid[];
  v_venue uuid;
  v_lost uuid[] := '{}'::uuid[];
begin
  for v_item in
    select distinct r.item_id, r.venue_id
    from removed r
    where exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = r.asset_id and p.item_id = r.item_id
        and p.variant_id is not distinct from r.variant_id
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'))
    order by r.item_id
  loop
    perform private.lock_item_photo_head(v_item.item_id, v_item.venue_id);
    v_items := v_items || v_item.item_id;
  end loop;
  if cardinality(v_items) = 0 then
    return null;
  end if;
  for v_venue in
    select distinct r.venue_id from removed r where r.item_id = any(v_items) order by r.venue_id
  loop
    perform private.bump_item_photo_heads(
      array(select distinct r.item_id from removed r
            where r.venue_id = v_venue and r.item_id = any(v_items)),
      v_venue);
  end loop;

  for v_row in
    select p.id, p.item_id, p.state, p.is_primary
    from public.menu_item_photos p
    where p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
      and exists (
        select 1 from removed r
        where r.asset_id = p.asset_id and r.item_id = p.item_id
          and r.variant_id is not distinct from p.variant_id)
    order by p.item_id, p.id
    for update
  loop
    if v_row.is_primary then
      v_lost := v_lost || v_row.item_id;
    end if;
    update public.menu_item_photos p
    set state = 'invalidated', invalidation_kind = 'label_removed', recheck_kind = null,
        is_primary = false, revision = p.revision + 1
    where p.id = v_row.id;
    perform private.record_item_photo_event(v_row.id, 'invalidated', v_row.state, null, false, null, 'system',
      jsonb_build_object('kind', 'label_removed'));
  end loop;
  for v_item in select distinct u.id from unnest(v_lost) as u(id) order by u.id loop
    perform private.promote_item_primary(v_item.id, 'system');
  end loop;
  return null;
end;
$$;

create trigger media_label_items_invalidate_menu_item_photos
  after delete on public.media_label_items
  referencing old table as removed
  for each statement execute function private.menu_item_photos_label_removed();

-- On activation: for each accepted row whose item is on the new version, carry
-- it (same normalised name, same section kind, variant still offered) or send it
-- to needs_recheck. Rows of items not on the new version are untouched. Runs
-- under activate_menu_version's exclusive venue lock; touches only heads and
-- photo rows, never asset rows.
create function private.reconcile_menu_item_photos(p_venue_id uuid, p_version_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_kind text;
  v_items uuid[];
  v_lost uuid[] := '{}'::uuid[];
begin
  select array_agg(distinct p.item_id) into v_items
  from public.menu_item_photos p
  join public.menu_entries e on e.version_id = p_version_id and e.item_id = p.item_id
  where p.venue_id = p_venue_id and p.state = 'accepted';
  if v_items is null then
    return;
  end if;
  perform private.bump_item_photo_heads(v_items, p_venue_id);

  for v_row in
    select p.id, p.item_id, p.variant_id, p.item_name, p.section_kind as old_kind, p.is_primary,
      e.name as entry_name, s.name as section_name, s.kind as new_kind,
      ev.variant_id as offered_variant, ev.name as variant_name
    from public.menu_item_photos p
    join public.menu_entries e on e.version_id = p_version_id and e.item_id = p.item_id
    join public.menu_sections s on s.id = e.section_id
    left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p.variant_id
    where p.venue_id = p_venue_id and p.state = 'accepted'
    order by p.item_id, p.id
    for update of p
  loop
    v_kind := case
      when v_row.variant_id is not null and v_row.offered_variant is null then 'variant_removed'
      when private.menu_name_key(v_row.entry_name) <> private.menu_name_key(v_row.item_name) then 'name_changed'
      when v_row.new_kind <> v_row.old_kind then 'section_changed'
    end;
    if v_kind is null then
      update public.menu_item_photos p
      set menu_version_id = p_version_id, item_name = v_row.entry_name,
          section_name = v_row.section_name, variant_name = v_row.variant_name,
          revision = p.revision + 1
      where p.id = v_row.id;
      perform private.record_item_photo_event(v_row.id, 'carried', 'accepted', null, false, null, 'system',
        jsonb_build_object('menuVersionId', p_version_id));
    else
      if v_row.is_primary then
        v_lost := v_lost || v_row.item_id;
      end if;
      update public.menu_item_photos p
      set state = 'needs_recheck', recheck_kind = v_kind, is_primary = false, revision = p.revision + 1
      where p.id = v_row.id;
      perform private.record_item_photo_event(v_row.id, 'needs_recheck', 'accepted', null, false, null, 'system',
        jsonb_build_object('kind', v_kind, 'menuVersionId', p_version_id));
    end if;
  end loop;

  for v_row in select distinct u.id from unnest(v_lost) as u(id) loop
    perform private.promote_item_primary(v_row.id, 'system');
  end loop;
end;
$$;

create function private.menu_versions_reconcile_item_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_menu_item_photos(new.venue_id, new.id);
  return null;
end;
$$;

create trigger menu_versions_reconcile_item_photos
  after update of status on public.menu_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function private.menu_versions_reconcile_item_photos();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Accept a labelled photo for one item, or ask for a better photo (reason
-- required). The asset's original upload venue decides scope; the label tuple
-- (asset, item, variant) must exist and the item be eligible on the active
-- version. Repeating the decision a live row already has is a no-op replay.
-- Accepting makes the photo primary when asked, or when the item has no
-- eligible accepted photo yet. Managers may review their own photos: recorded
-- as self-review for admin oversight.
create function public.review_menu_item_photo(
  p_asset_id uuid,
  p_item_id uuid,
  p_variant_id uuid,
  p_decision text,
  p_expected_revision integer,
  p_reason text default null,
  p_make_primary boolean default false,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  item_id uuid,
  state text,
  is_primary boolean,
  item_revision integer,
  self_review boolean,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.menu_item_photo_events;
  v_asset public.media_assets;
  v_active uuid;
  v_entry_name text;
  v_section_name text;
  v_section_kind text;
  v_variant_name text;
  v_head integer;
  v_live public.menu_item_photos;
  v_reason text;
  v_self boolean;
  v_role text;
  v_primary boolean := false;
  v_photo uuid;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      -- A replay answers only someone still in scope, and only the same decision.
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'media_asset_not_found' using errcode = 'P0002';
      end if;
      if v_event.asset_id <> p_asset_id or v_event.item_id <> p_item_id
         or v_event.variant_id is distinct from p_variant_id
         or v_event.action is distinct from p_decision then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_id := v_event.item_id;
      state := v_event.to_state;
      is_primary := coalesce((v_event.detail ->> 'isPrimary')::boolean, false);
      item_revision := v_event.item_revision;
      self_review := v_event.self_review;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  if p_decision is null or p_decision not in ('accepted', 'better_photo_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision = 'better_photo_requested' then
    v_reason := private.require_reason(p_reason);
  else
    v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  end if;

  -- Lock order: asset row, shared venue menu lock, item head.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found or not private.can_manage_venue(v_asset.venue_id) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  -- Managers review active colleagues' photos (and their own); admins also
  -- retained photos of people who have left.
  if not private.is_active_admin() and v_asset.uploader_id <> v_uid and not exists (
    select 1 from public.profiles p where p.id = v_asset.uploader_id and p.active and p.role = 'staff'
  ) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_venue_menu(v_asset.venue_id, true);

  -- The item (of the asset's venue) is on the active version in a food or
  -- drinks section, not archived, and offers the variant.
  v_active := private.active_menu_version_id(v_asset.venue_id);
  select e.name, s.name, s.kind, ev.name
  into v_entry_name, v_section_name, v_section_kind, v_variant_name
  from public.menu_items i
  join public.menu_entries e on e.item_id = i.id and e.version_id = v_active
  join public.menu_sections s on s.id = e.section_id
  left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p_variant_id
  where i.id = p_item_id and i.venue_id = v_asset.venue_id and i.archived_at is null
    and s.kind in ('food', 'drinks')
    and (p_variant_id is null or ev.variant_id is not null);
  if not found then
    raise exception 'menu_item_unavailable' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.media_label_items li
    where li.asset_id = p_asset_id and li.item_id = p_item_id
      and li.variant_id is not distinct from p_variant_id
  ) then
    raise exception 'menu_item_not_labelled' using errcode = 'P0001';
  end if;
  if v_asset.deleted_at is not null then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;
  if v_asset.media_type <> 'image' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_image';
  end if;
  if v_asset.upload_state <> 'ready' then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'not_ready';
  end if;

  v_head := private.lock_item_photo_head(p_item_id, v_asset.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;

  select p.* into v_live from public.menu_item_photos p
  where p.asset_id = p_asset_id and p.item_id = p_item_id
    and p.variant_id is not distinct from p_variant_id
    and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  for update;
  if found and v_live.state = p_decision then
    photo_id := v_live.id;
    item_id := v_live.item_id;
    state := v_live.state;
    is_primary := v_live.is_primary;
    item_revision := v_head;
    self_review := v_live.self_review;
    replayed := true;
    return next;
    return;
  end if;
  if found and v_live.state = 'accepted' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', v_live.state, p_decision);
  end if;

  v_self := v_uid = v_asset.uploader_id;
  v_role := private.coverage_actor_role(v_asset.venue_id);
  perform private.bump_item_photo_heads(array[p_item_id], v_asset.venue_id);
  v_head := v_head + 1;

  if p_decision = 'accepted' then
    v_primary := coalesce(p_make_primary, false)
      or private.menu_item_effective_primary(p_item_id) is null;
    if v_primary then
      perform private.clear_item_primary(p_item_id, null, v_role);
    end if;
  end if;

  if v_live.id is null then
    insert into public.menu_item_photos as p (
      venue_id, item_id, variant_id, asset_id, author_id, state, is_primary, reason,
      item_name, variant_name, section_name, section_kind, menu_version_id,
      decided_by, self_review
    )
    values (
      v_asset.venue_id, p_item_id, p_variant_id, p_asset_id, v_asset.uploader_id, p_decision, v_primary,
      v_reason, v_entry_name, v_variant_name, v_section_name, v_section_kind, v_active, v_uid, v_self
    )
    returning p.id into v_photo;
  else
    update public.menu_item_photos p
    set state = p_decision, reason = v_reason, recheck_kind = null, is_primary = v_primary,
        item_name = v_entry_name, variant_name = v_variant_name, section_name = v_section_name,
        section_kind = v_section_kind, menu_version_id = v_active,
        decided_by = v_uid, decided_at = now(), self_review = v_self, revision = p.revision + 1
    where p.id = v_live.id
    returning p.id into v_photo;
  end if;
  perform private.record_item_photo_event(v_photo, p_decision, v_live.state, v_reason, v_self,
    p_client_request_key, v_role, jsonb_build_object('isPrimary', v_primary));
  if p_decision = 'accepted' and not v_primary then
    -- A flagged primary whose photo was deleted gives way to the earliest eligible one.
    perform private.promote_item_primary(p_item_id, v_role);
  end if;

  photo_id := v_photo;
  item_id := p_item_id;
  state := p_decision;
  is_primary := v_primary;
  item_revision := v_head;
  self_review := v_self;
  replayed := false;
  return next;
end;
$$;

-- Undo an acceptance (or a better-photo request, or a pending recheck) with a
-- reason. A withdrawn primary hands over to the earliest other eligible
-- accepted photo, or the item reopens as a gap.
create function public.withdraw_menu_item_photo(
  p_photo_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_client_request_key text default null
)
returns table (
  photo_id uuid,
  state text,
  item_revision integer,
  new_primary_photo_id uuid,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.menu_item_photo_events;
  v_photo public.menu_item_photos;
  v_reason text;
  v_head integer;
  v_role text;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
      end if;
      if v_event.photo_id <> p_photo_id or v_event.action <> 'withdrawn' then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      state := v_event.to_state;
      item_revision := v_event.item_revision;
      new_primary_photo_id := (v_event.detail ->> 'newPrimaryPhotoId')::uuid;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id;
  if not found or not private.can_manage_venue(v_photo.venue_id) then
    raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.require_reason(p_reason);

  perform 1 from public.media_assets a where a.id = v_photo.asset_id for update;
  perform private.lock_venue_menu(v_photo.venue_id, true);
  v_head := private.lock_item_photo_head(v_photo.item_id, v_photo.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;
  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id for update;
  if v_photo.state not in ('accepted', 'better_photo_requested', 'needs_recheck') then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> withdrawn', v_photo.state);
  end if;

  v_role := private.coverage_actor_role(v_photo.venue_id);
  perform private.bump_item_photo_heads(array[v_photo.item_id], v_photo.venue_id);
  update public.menu_item_photos p
  set state = 'withdrawn', reason = v_reason, recheck_kind = null, is_primary = false,
      withdrawn_by = v_uid, withdrawn_at = now(), revision = p.revision + 1
  where p.id = p_photo_id;
  v_next := private.promote_item_primary(v_photo.item_id, v_role);
  perform private.record_item_photo_event(p_photo_id, 'withdrawn', v_photo.state, v_reason, false,
    p_client_request_key, v_role, jsonb_build_object('newPrimaryPhotoId', v_next));

  photo_id := p_photo_id;
  state := 'withdrawn';
  item_revision := v_head + 1;
  new_primary_photo_id := v_next;
  replayed := false;
  return next;
end;
$$;

-- Make an accepted, eligible photo the item's primary; the previous primary
-- stays accepted.
create function public.set_menu_item_primary_photo(
  p_photo_id uuid,
  p_expected_revision integer,
  p_client_request_key text default null
)
returns table (photo_id uuid, item_revision integer, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_event public.menu_item_photo_events;
  v_photo public.menu_item_photos;
  v_head integer;
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_client_request_key is not null then
    perform private.assert_request_key(p_client_request_key);
    perform private.lock_coverage_request(v_uid, p_client_request_key);
    select e.* into v_event from public.menu_item_photo_events e
    where e.actor_id = v_uid and e.client_request_key = p_client_request_key;
    if found then
      if not private.can_manage_venue(v_event.venue_id) then
        raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
      end if;
      if v_event.photo_id <> p_photo_id or v_event.action <> 'primary_set' then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
      photo_id := v_event.photo_id;
      item_revision := v_event.item_revision;
      replayed := true;
      return next;
      return;
    end if;
  end if;

  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id;
  if not found or not private.can_manage_venue(v_photo.venue_id) then
    raise exception 'menu_item_photo_not_found' using errcode = 'P0002';
  end if;

  perform 1 from public.media_assets a where a.id = v_photo.asset_id for update;
  perform private.lock_venue_menu(v_photo.venue_id, true);
  v_head := private.lock_item_photo_head(v_photo.item_id, v_photo.venue_id);
  if p_expected_revision is distinct from v_head then
    raise exception 'coverage_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_head)::text;
  end if;
  select p.* into v_photo from public.menu_item_photos p where p.id = p_photo_id for update;
  if v_photo.state <> 'accepted' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> primary', v_photo.state);
  end if;
  if not exists (
    select 1 from public.media_assets a
    where a.id = v_photo.asset_id and a.upload_state = 'ready' and a.deleted_at is null
      and a.media_type = 'image'
  ) then
    raise exception 'evidence_not_eligible' using errcode = 'P0001', detail = 'evidence_removed';
  end if;
  if v_photo.is_primary then
    photo_id := p_photo_id;
    item_revision := v_head;
    replayed := true;
    return next;
    return;
  end if;

  v_role := private.coverage_actor_role(v_photo.venue_id);
  perform private.bump_item_photo_heads(array[v_photo.item_id], v_photo.venue_id);
  perform private.clear_item_primary(v_photo.item_id, p_photo_id, v_role);
  update public.menu_item_photos p
  set is_primary = true, revision = p.revision + 1
  where p.id = p_photo_id;
  perform private.record_item_photo_event(p_photo_id, 'primary_set', 'accepted', null, false,
    p_client_request_key, v_role);

  photo_id := p_photo_id;
  item_revision := v_head + 1;
  replayed := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Our menu totals per section for staff at the venue, its manager or an admin.
-- `no_menu`: no active version (one row, no section). `empty`: an active
-- version with no eligible item (one row, no section). `ready`: one row per
-- food or drinks section with eligible items. Candidate figures are null for
-- callers who cannot review.
create function public.menu_item_photo_summary(p_venue_id uuid default null)
returns table (
  venue_id uuid,
  venue_name text,
  menu_state text,
  menu_version_id uuid,
  section_id uuid,
  section_name text,
  section_kind text,
  section_position integer,
  eligible_items integer,
  covered_items integer,
  needs_recheck_items integer,
  pending_candidates integer,
  oldest_candidate_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.menu_photo_read_venue(p_venue_id);
  v_name text := (select v.name from public.venues v where v.id = v_venue);
  v_active uuid := private.active_menu_version_id(v_venue);
  v_reviewer boolean := private.can_manage_venue(v_venue);
begin
  if v_active is null then
    return query select v_venue, v_name, 'no_menu'::text, null::uuid, null::uuid, null::text, null::text,
      null::integer, 0, 0, 0, null::integer, null::timestamptz;
    return;
  end if;
  return query
  select v_venue, v_name, 'ready'::text, r.menu_version_id, r.section_id, r.section_name, r.section_kind,
    r.section_position, count(*)::integer, (count(*) filter (where r.covered))::integer,
    (count(*) filter (where r.needs_recheck_count > 0))::integer,
    case when v_reviewer then sum(r.candidate_count)::integer end,
    case when v_reviewer then min(r.oldest_candidate_at) end
  from private.menu_item_photo_rows(v_venue, v_reviewer, private.is_active_admin()) r
  group by r.menu_version_id, r.section_id, r.section_name, r.section_kind, r.section_position
  order by r.section_position, r.section_id;
  if not found then
    return query select v_venue, v_name, 'empty'::text, v_active, null::uuid, null::text, null::text,
      null::integer, 0, 0, 0, case when v_reviewer then 0 end, null::timestamptz;
  end if;
end;
$$;

-- Eligible items of the active version in menu order, keyset on (section
-- position, entry position, item id). Search covers names and aliases; the
-- query is trimmed and capped at 80 characters. `p_gaps_only` lists items
-- without an accepted photo.
create function public.menu_item_photo_items(
  p_venue_id uuid default null,
  p_section_id uuid default null,
  p_gaps_only boolean default false,
  p_query text default null,
  p_after_section_position integer default null,
  p_after_entry_position integer default null,
  p_after_item_id uuid default null,
  p_limit integer default 50
)
returns table (
  venue_id uuid,
  menu_version_id uuid,
  item_id uuid,
  section_id uuid,
  section_name text,
  section_kind text,
  section_position integer,
  entry_position integer,
  name text,
  description text,
  variants jsonb,
  covered boolean,
  accepted_count integer,
  needs_recheck_count integer,
  primary_photo_id uuid,
  primary_asset_id uuid,
  primary_has_thumbnail boolean,
  primary_has_preview boolean,
  primary_width integer,
  primary_height integer,
  item_revision integer,
  candidate_count integer,
  oldest_candidate_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.menu_photo_read_venue(p_venue_id);
  v_reviewer boolean := private.can_manage_venue(v_venue);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
  v_query text := left(nullif(btrim(p_query), ''), 80);
  v_pattern text;
begin
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select v_venue, r.menu_version_id, r.item_id, r.section_id, r.section_name, r.section_kind,
    r.section_position, r.entry_position, r.name, r.description, r.variants, r.covered,
    r.accepted_count, r.needs_recheck_count, r.primary_photo_id, r.primary_asset_id,
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    r.item_revision, r.candidate_count, r.oldest_candidate_at
  from private.menu_item_photo_rows(v_venue, v_reviewer, private.is_active_admin()) r
  left join public.media_assets a on a.id = r.primary_asset_id
  where (p_section_id is null or r.section_id = p_section_id)
    and (not coalesce(p_gaps_only, false) or not r.covered)
    and (v_pattern is null or r.name ilike v_pattern
      or exists (select 1 from unnest(r.aliases) as al(alias) where al.alias ilike v_pattern))
    and (p_after_section_position is null or p_after_entry_position is null or p_after_item_id is null
      or (r.section_position, r.entry_position, r.item_id)
        > (p_after_section_position, p_after_entry_position, p_after_item_id))
  order by r.section_position, r.entry_position, r.item_id
  limit v_limit;
end;
$$;

-- Labelled photos a reviewer can decide for items of the venue's active
-- version, oldest upload first; keyset on (asset created_at, label row id).
-- Default: undecided tuples and those needing a recheck. With
-- p_include_reviewed, also accepted and better-photo rows (an item's review
-- screen). Managers (their venue) see active uploaders' and their own photos;
-- admins everyone's.
create function public.menu_item_photo_candidates(
  p_venue_id uuid default null,
  p_item_id uuid default null,
  p_include_reviewed boolean default false,
  p_after_created_at timestamptz default null,
  p_after_label_id uuid default null,
  p_limit integer default 25
)
returns table (
  label_id uuid,
  asset_id uuid,
  venue_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  section_name text,
  uploader_id uuid,
  uploader_name text,
  uploader_active boolean,
  is_self boolean,
  photo_id uuid,
  photo_state text,
  is_primary boolean,
  item_revision integer,
  has_thumbnail boolean,
  has_preview boolean,
  width integer,
  height integer,
  created_at timestamptz,
  labelled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_admin boolean := private.is_active_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 101);
  v_active uuid;
begin
  perform private.assert_can_manage_venue(v_venue);
  v_active := private.active_menu_version_id(v_venue);
  return query
  select li.id, a.id, a.venue_id, li.item_id, li.variant_id, e.name, ev.name, s.name,
    a.uploader_id, up.display_name, up.active and up.role = 'staff', a.uploader_id = v_uid,
    lp.id, lp.state, coalesce(lp.is_primary, false), coalesce(h.revision, 1),
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    a.created_at, li.added_at
  from public.media_label_items li
  join public.media_assets a on a.id = li.asset_id
  join public.profiles up on up.id = a.uploader_id
  join public.menu_items i on i.id = li.item_id and i.archived_at is null
  join public.menu_entries e on e.version_id = v_active and e.item_id = li.item_id
  join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
  left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = li.variant_id
  left join public.menu_item_photo_heads h on h.item_id = li.item_id
  left join lateral (
    select p.id, p.state, p.is_primary from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  ) lp on true
  -- A withdrawal since the label was (re)saved: the tuple is decided, so it
  -- stays out of the waiting queue (still listed with p_include_reviewed).
  left join lateral (
    select p.withdrawn_at from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state = 'withdrawn' and p.withdrawn_at >= li.added_at
    order by p.withdrawn_at desc
    limit 1
  ) wd on true
  where li.venue_id = v_venue
    and (p_item_id is null or li.item_id = p_item_id)
    -- A variant no longer offered stays listed while its row awaits a recheck,
    -- with a null variant_name: reviewers can withdraw it (review rejects it).
    and (li.variant_id is null or ev.variant_id is not null or lp.state = 'needs_recheck')
    and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
    and (v_admin or a.uploader_id = v_uid or (up.active and up.role = 'staff'))
    and (coalesce(p_include_reviewed, false) or lp.state = 'needs_recheck'
      or (lp.id is null and wd.withdrawn_at is null))
    and (p_after_created_at is null or p_after_label_id is null
      or (a.created_at, li.id) > (p_after_created_at, p_after_label_id))
  order by a.created_at, li.id
  limit v_limit;
end;
$$;

-- Scoped item-photo preview check (same shape as task_evidence_asset): a
-- ready, undeleted asset that the venue's manager or an admin may see because
-- it is labelled there; that staff at the venue may see because it is the
-- primary photo of an item on the active menu; or that its uploader (or an
-- admin, for the self-review audit) may see because it has an item-photo
-- decision. No storage keys leave the database.
create function public.menu_item_photo_asset(p_asset_id uuid)
returns table (
  asset_id uuid,
  venue_id uuid,
  uploader_id uuid,
  media_type public.media_type,
  validated_mime_type text,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.venue_id, a.uploader_id, a.media_type, a.validated_mime_type,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and private.is_active_user()
    and (
      (
        private.can_manage_venue(a.venue_id)
        and exists (select 1 from public.media_label_items li where li.asset_id = a.id)
      )
      or (
        a.venue_id = private.active_staff_venue_id()
        and exists (
          select 1
          from public.menu_item_photos p
          join public.menu_entries e
            on e.item_id = p.item_id and e.version_id = private.active_menu_version_id(a.venue_id)
          where p.asset_id = a.id and p.state = 'accepted'
            and private.menu_item_effective_primary(p.item_id) = p.id
        )
      )
      or (
        a.uploader_id = (select auth.uid())
        and exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
      )
      -- Admin oversight (self-review audit) keeps the photo after its label goes.
      or (
        private.is_active_admin()
        and exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.menu_item_photos, public.menu_item_photo_heads, public.menu_item_photo_events
from public, anon, authenticated, service_role;

grant select on public.menu_item_photos, public.menu_item_photo_heads, public.menu_item_photo_events
to authenticated;
grant select, insert, update on public.menu_item_photos, public.menu_item_photo_heads to service_role;
grant select, insert on public.menu_item_photo_events to service_role;

alter table public.menu_item_photos enable row level security;
alter table public.menu_item_photo_heads enable row level security;
alter table public.menu_item_photo_events enable row level security;

-- Personal records: admins, the effective manager of the venue, the uploader
-- (their own "Accepted for menu use"). Staff see venue totals only through the
-- read RPCs.
create policy menu_item_photos_select on public.menu_item_photos
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (author_id = (select auth.uid()) and (select private.is_active_user()))
  );
create policy menu_item_photo_heads_select on public.menu_item_photo_heads
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.active_staff_venue_id())
  );
create policy menu_item_photo_events_select on public.menu_item_photo_events
  for select to authenticated
  using (
    (select private.is_active_admin())
    or venue_id = (select private.my_manager_venue_id())
    or (author_id = (select auth.uid()) and (select private.is_active_user()))
  );

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_item_photos_insert_guard(),
  private.menu_item_photos_guard(),
  private.menu_item_photo_heads_guard(),
  private.menu_item_photos_label_removed(),
  private.menu_versions_reconcile_item_photos()
from public, anon;

grant execute on function
  private.menu_item_photos_insert_guard(),
  private.menu_item_photos_guard(),
  private.menu_item_photo_heads_guard(),
  private.menu_item_photos_label_removed(),
  private.menu_versions_reconcile_item_photos()
to authenticated, service_role;

revoke all on function
  private.menu_name_key(text),
  private.lock_item_photo_head(uuid, uuid),
  private.bump_item_photo_heads(uuid[], uuid),
  private.record_item_photo_event(uuid, text, text, text, boolean, text, text, jsonb),
  private.menu_item_effective_primary(uuid),
  private.clear_item_primary(uuid, uuid, text),
  private.promote_item_primary(uuid, text),
  private.menu_photo_read_venue(uuid),
  private.menu_item_photo_rows(uuid, boolean, boolean),
  private.reconcile_menu_item_photos(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.menu_name_key(text),
  private.lock_item_photo_head(uuid, uuid),
  private.bump_item_photo_heads(uuid[], uuid),
  private.record_item_photo_event(uuid, text, text, text, boolean, text, text, jsonb),
  private.menu_item_effective_primary(uuid),
  private.clear_item_primary(uuid, uuid, text),
  private.promote_item_primary(uuid, text),
  private.menu_photo_read_venue(uuid),
  private.menu_item_photo_rows(uuid, boolean, boolean),
  private.reconcile_menu_item_photos(uuid, uuid)
to service_role;

revoke all on function
  public.review_menu_item_photo(uuid, uuid, uuid, text, integer, text, boolean, text),
  public.withdraw_menu_item_photo(uuid, integer, text, text),
  public.set_menu_item_primary_photo(uuid, integer, text),
  public.menu_item_photo_summary(uuid),
  public.menu_item_photo_items(uuid, uuid, boolean, text, integer, integer, uuid, integer),
  public.menu_item_photo_candidates(uuid, uuid, boolean, timestamptz, uuid, integer),
  public.menu_item_photo_asset(uuid)
from public, anon;

grant execute on function
  public.review_menu_item_photo(uuid, uuid, uuid, text, integer, text, boolean, text),
  public.withdraw_menu_item_photo(uuid, integer, text, text),
  public.set_menu_item_primary_photo(uuid, integer, text),
  public.menu_item_photo_summary(uuid),
  public.menu_item_photo_items(uuid, uuid, boolean, text, integer, integer, uuid, integer),
  public.menu_item_photo_candidates(uuid, uuid, boolean, timestamptz, uuid, integer),
  public.menu_item_photo_asset(uuid)
to authenticated, service_role;
