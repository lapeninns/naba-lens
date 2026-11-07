-- Venue manager workspace, item photos (part 1 of 3): rules.
--
-- Amends the Our menu item-photo model (20261106130000) for venue manager
-- accounts, additively:
--   * a decision records its source: `staff_label` (every earlier row) or
--     `reviewer` (a reviewer chose the item: a corrected staff label, a label
--     for an item no longer on the menu, or an unlabelled photo);
--   * manager accounts never decide on their own photos (all of them predate
--     the conversion). Legacy staff-held grants keep the recorded self-review
--     until the cut-over migration;
--   * reviewers may decide on photos of active staff and manager accounts
--     (people who moved venue, converted managers' history). Leavers' photos
--     stay admin-only, as in the coverage policy (20261102150000);
--   * manager accounts read Our menu through the definer functions, never the
--     item-photo tables directly.
-- Replaced functions keep their signatures and return columns; each body is
-- the 20261106130000 body plus the insertion its comment names.

-- ---------------------------------------------------------------------------
-- Decision source
-- ---------------------------------------------------------------------------

-- Defaults keep every existing row a staff-label decision.
alter table public.menu_item_photos
  add column basis text not null default 'staff_label',
  add column corrects_item_id uuid,
  add column corrects_variant_id uuid,
  add constraint menu_item_photos_basis_check check (basis in ('staff_label', 'reviewer')),
  add constraint menu_item_photos_corrects_basis check (
    basis = 'reviewer' or (corrects_item_id is null and corrects_variant_id is null)
  ),
  add constraint menu_item_photos_corrects_variant check (
    corrects_variant_id is null or corrects_item_id is not null
  ),
  -- An option-only correction (X/small -> X/large) is allowed; the tuple must differ.
  add constraint menu_item_photos_corrects_other check (
    corrects_item_id is null
    or (corrects_item_id, corrects_variant_id) is distinct from (item_id, variant_id)
  ),
  add constraint menu_item_photos_corrects_item_fkey foreign key (corrects_item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  add constraint menu_item_photos_corrects_variant_fkey foreign key (corrects_variant_id, corrects_item_id)
    references public.menu_variants (id, item_id) on delete restrict;

create index menu_item_photos_corrects_idx on public.menu_item_photos (asset_id, corrects_item_id)
  where corrects_item_id is not null;

-- The source of a decision never changes (menu_item_photos_guard covers the
-- original identity columns only).
create function private.menu_item_photos_basis_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.basis is distinct from old.basis
     or new.corrects_item_id is distinct from old.corrects_item_id
     or new.corrects_variant_id is distinct from old.corrects_variant_id then
    raise exception 'menu_item_photo_identity_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_item_photos_basis_guard
  before update on public.menu_item_photos
  for each row execute function private.menu_item_photos_basis_guard();

-- No self-review for manager accounts, whoever writes the row. Fires only on
-- an explicit reviewer write (decided_by/decided_at or withdrawn_by set),
-- never on automatic carry or promote updates, so withdrawing a colleague's
-- primary can still promote the manager's own earlier accepted photo. The
-- author's current role decides: a self-review recorded while the author held
-- a staff grant stays as history. set_menu_item_primary_photo changes only
-- is_primary and is guarded by its own check.
create function private.menu_item_photos_no_manager_self_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_manager boolean;
  v_decided boolean;
  v_withdrawn boolean;
begin
  select p.role = 'manager' into v_author_manager from public.profiles p where p.id = new.author_id;
  if not coalesce(v_author_manager, false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_decided := new.decided_by = new.author_id;
    v_withdrawn := new.withdrawn_by = new.author_id;
  else
    v_decided := new.decided_by = new.author_id
      and (new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at);
    v_withdrawn := new.withdrawn_by = new.author_id and new.withdrawn_by is distinct from old.withdrawn_by;
  end if;
  if coalesce(v_decided, false) or coalesce(v_withdrawn, false) then
    raise exception 'self_review_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_item_photos_no_manager_self_review
  before insert or update on public.menu_item_photos
  for each row execute function private.menu_item_photos_no_manager_self_review();

-- ---------------------------------------------------------------------------
-- Rules, once
-- ---------------------------------------------------------------------------

-- Whose photos the caller may decide on. Admins: anyone's. Their own upload:
-- only when the caller is not a manager account (a legacy staff grant: the
-- recorded self-review). Anyone else's: active staff and manager accounts.
-- Leavers' photos stay admin-only.
create function private.menu_photo_reviewable_uploader(p_uploader uuid, p_admin boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_admin, false)
    or case
      when p_uploader = (select auth.uid()) then not private.is_active_manager()
      else exists (
        select 1 from public.profiles up
        where up.id = p_uploader and up.active and up.role in ('staff', 'manager'))
    end;
$$;

-- A manager account's own photo: another reviewer decides on it.
create function private.menu_photo_self_blocked(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_author = (select auth.uid()), false) and private.is_active_manager();
$$;

-- A staff-label tuple a reviewer corrected since it was (re)saved: decided
-- while that reviewer row is live, so it leaves the waiting queue. Withdrawing
-- the reviewer row makes the tuple wait again (a mistaken correction can be
-- undone). Labels keep added_at across saves; a removed and re-added label is
-- a new tuple.
create function private.menu_photo_tuple_relinked(
  p_asset uuid,
  p_item uuid,
  p_variant uuid,
  p_since timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.menu_item_photos r
    where r.asset_id = p_asset and r.corrects_item_id = p_item
      and r.corrects_variant_id is not distinct from p_variant
      and r.created_at >= p_since
      and r.state in ('accepted', 'better_photo_requested', 'needs_recheck'));
$$;

-- Q1 unlabelled (begin) -------------------------------------------------------
-- Only manager accounts and admins see unlabelled photos; legacy staff
-- grantees do not (that would be a staff photo feed).
create function private.menu_photo_can_review_unlabelled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_manager() or private.is_active_admin();
$$;

-- A usable unlabelled photo at the venue: a ready image with no item tuple
-- that staff tagged as food or drink (content_types defaults to '{}', so a
-- positive tag is required). Item-photo rows do not exclude it: one photo can
-- cover several items through separate decisions.
create function private.menu_photo_unlabelled_eligible(p_asset uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.menu_photo_can_review_unlabelled() and exists (
    select 1
    from public.media_assets a
    join public.media_labels ml on ml.asset_id = a.id
    where a.id = p_asset and a.venue_id = p_venue
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and not exists (select 1 from public.media_label_items li where li.asset_id = a.id)
      and ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[]);
$$;
-- Q1 unlabelled (end) ---------------------------------------------------------

-- A photo labelled at the venue only for items no longer on the active
-- countable menu, with no live decision: a contribution from an earlier menu.
create function private.menu_photo_stale_label(p_asset uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.media_label_items li
      where li.asset_id = p_asset and li.venue_id = p_venue)
    and not exists (
      select 1
      from public.media_label_items li
      join public.menu_entries e
        on e.item_id = li.item_id and e.version_id = private.active_menu_version_id(p_venue)
      join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
      join public.menu_items i on i.id = li.item_id and i.archived_at is null
      where li.asset_id = p_asset)
    and not exists (
      select 1 from public.menu_item_photos p
      where p.asset_id = p_asset
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck'));
$$;

-- The waiting rule, once: label tuples of the venue's active countable menu
-- that are undecided (or need a recheck), not withdrawn since the label was
-- saved, not corrected by a live reviewer row, with an uploader the caller may
-- decide on. p_own_only returns only the caller's own tuples instead (a
-- manager's photos waiting for another reviewer). p_admin = true is the
-- caller-independent set.
create function private.menu_photo_pending_tuples(
  p_venue_id uuid,
  p_admin boolean,
  p_own_only boolean default false
)
returns table (
  label_id uuid,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  entry_id uuid,
  uploader_id uuid,
  created_at timestamptz,
  labelled_at timestamptz,
  live_photo_id uuid,
  is_recheck boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select li.id, a.id, li.item_id, li.variant_id, e.id, a.uploader_id, a.created_at, li.added_at,
    lp.id, coalesce(lp.state = 'needs_recheck', false)
  from public.menu_versions v
  join public.menu_entries e on e.version_id = v.id
  join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
  join public.menu_items i on i.id = e.item_id and i.archived_at is null
  join public.media_label_items li on li.item_id = e.item_id and li.venue_id = p_venue_id
  join public.media_assets a on a.id = li.asset_id
  left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = li.variant_id
  left join lateral (
    select p.id, p.state from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
  ) lp on true
  left join lateral (
    select 1 as hit from public.menu_item_photos p
    where p.asset_id = li.asset_id and p.item_id = li.item_id
      and p.variant_id is not distinct from li.variant_id
      and p.state = 'withdrawn' and p.withdrawn_at >= li.added_at
    limit 1
  ) wd on true
  where v.venue_id = p_venue_id and v.status = 'active'
    and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
    -- A variant no longer offered still waits while its row needs a recheck.
    and (li.variant_id is null or ev.variant_id is not null or lp.state = 'needs_recheck')
    and (lp.state = 'needs_recheck' or (lp.id is null and wd.hit is null))
    and not private.menu_photo_tuple_relinked(li.asset_id, li.item_id, li.variant_id, li.added_at)
    and case
      when coalesce(p_own_only, false) then a.uploader_id = (select auth.uid())
      else private.menu_photo_reviewable_uploader(a.uploader_id, p_admin)
    end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced read rules
-- ---------------------------------------------------------------------------

-- Body as in 20261106130000, plus manager accounts at their effective venue.
create or replace function private.menu_photo_read_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff_venue uuid := private.active_staff_venue_id();
  v_manager_venue uuid := case when private.is_active_manager() then private.my_manager_venue_id() end;
  v_venue uuid := coalesce(p_venue_id, v_staff_venue, v_manager_venue);
begin
  if auth.uid() is null or v_venue is null
     -- coalesce: with no staff or manager venue the comparison is NULL, which must deny.
     or not (
       private.is_active_admin()
       or coalesce(v_venue = v_staff_venue, false)
       or coalesce(v_venue = v_manager_venue, false)
     ) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  return v_venue;
end;
$$;

-- Body as in 20261106130000, with (a) the reviewable-uploader rule for
-- rechecks and (b) candidates from private.menu_photo_pending_tuples, called
-- once and grouped by item.
create or replace function private.menu_item_photo_rows(p_venue_id uuid, p_reviewer boolean, p_admin boolean)
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
        and private.menu_photo_reviewable_uploader(a.uploader_id, p_admin)))::integer as recheck
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = e.item_id and p.state in ('accepted', 'needs_recheck')
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  ) ac on true
  left join (
    select t.item_id, count(*)::integer as n, min(t.created_at) as oldest
    from private.menu_photo_pending_tuples(p_venue_id, p_admin) t
    where p_reviewer
    group by t.item_id
  ) c on c.item_id = e.item_id
  where v.venue_id = p_venue_id and v.status = 'active';
$$;

-- Body as in 20261106130000, with (a) the reviewable-uploader rule and (b)
-- tuples corrected by a live reviewer row left out of the waiting list.
create or replace function public.menu_item_photo_candidates(
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
    a.uploader_id, up.display_name, up.active and up.role in ('staff', 'manager'), a.uploader_id = v_uid,
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
    and private.menu_photo_reviewable_uploader(a.uploader_id, v_admin)
    and (coalesce(p_include_reviewed, false) or lp.state = 'needs_recheck'
      or (lp.id is null and wd.withdrawn_at is null))
    and (coalesce(p_include_reviewed, false)
      or not private.menu_photo_tuple_relinked(li.asset_id, li.item_id, li.variant_id, li.added_at))
    and (p_after_created_at is null or p_after_label_id is null
      or (a.created_at, li.id) > (p_after_created_at, p_after_label_id))
  order by a.created_at, li.id
  limit v_limit;
end;
$$;

-- Body as in 20261106130000; the reviewer branch also admits photos with an
-- item-photo row (a reviewer association) and, for manager accounts and
-- admins, usable unlabelled photos.
create or replace function public.menu_item_photo_asset(p_asset_id uuid)
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
        and (
          exists (select 1 from public.media_label_items li where li.asset_id = a.id)
          or exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
          -- Q1 unlabelled
          or private.menu_photo_unlabelled_eligible(a.id, a.venue_id)
        )
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

-- Body as in 20261106130000, limited to staff-label rows: a reviewer
-- association has its own provenance and outlives the staff label.
create or replace function private.menu_item_photos_label_removed()
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
        and p.state in ('accepted', 'better_photo_requested', 'needs_recheck')
        and p.basis = 'staff_label')
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
      and p.basis = 'staff_label'
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

-- ---------------------------------------------------------------------------
-- Direct table reads
-- ---------------------------------------------------------------------------

-- Manager accounts read item photos only through the definer functions. The
-- venue branch stays for legacy staff-held grants until the cut-over; the
-- author branch is for staff (their own "Accepted for menu use").
drop policy menu_item_photos_select on public.menu_item_photos;
create policy menu_item_photos_select on public.menu_item_photos
  for select to authenticated
  using (
    (select private.is_active_admin())
    or (venue_id = (select private.my_manager_venue_id()) and not (select private.is_active_manager()))
    or (author_id = (select auth.uid()) and (select private.is_active_staff()))
  );

drop policy menu_item_photo_events_select on public.menu_item_photo_events;
create policy menu_item_photo_events_select on public.menu_item_photo_events
  for select to authenticated
  using (
    (select private.is_active_admin())
    or (venue_id = (select private.my_manager_venue_id()) and not (select private.is_active_manager()))
    or (author_id = (select auth.uid()) and (select private.is_active_staff()))
  );

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_item_photos_basis_guard(),
  private.menu_item_photos_no_manager_self_review()
from public, anon;

grant execute on function
  private.menu_item_photos_basis_guard(),
  private.menu_item_photos_no_manager_self_review()
to authenticated, service_role;

revoke all on function
  private.menu_photo_reviewable_uploader(uuid, boolean),
  private.menu_photo_self_blocked(uuid),
  private.menu_photo_tuple_relinked(uuid, uuid, uuid, timestamptz),
  private.menu_photo_can_review_unlabelled(),
  private.menu_photo_unlabelled_eligible(uuid, uuid),
  private.menu_photo_stale_label(uuid, uuid),
  private.menu_photo_pending_tuples(uuid, boolean, boolean)
from public, anon, authenticated;

grant execute on function
  private.menu_photo_reviewable_uploader(uuid, boolean),
  private.menu_photo_self_blocked(uuid),
  private.menu_photo_tuple_relinked(uuid, uuid, uuid, timestamptz),
  private.menu_photo_can_review_unlabelled(),
  private.menu_photo_unlabelled_eligible(uuid, uuid),
  private.menu_photo_stale_label(uuid, uuid),
  private.menu_photo_pending_tuples(uuid, boolean, boolean)
to service_role;
