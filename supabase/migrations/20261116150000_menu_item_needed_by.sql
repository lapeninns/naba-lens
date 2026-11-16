-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- G-7 (docs/plans/goals-not-tasks.md, decision 1; v0.5 rule 24 and §4):
-- "needed by" on one still-needed dish.
--
-- * A new table keyed by (item_id, venue_id). Not a column on
--   menu_item_photo_heads: that table's update guard bumps the revision
--   reviewers use for compare-and-set, and a date is not a photo decision.
-- * set_menu_item_needed_by / clear_menu_item_needed_by: the venue's manager
--   (grant holder or manager account) for their own venue, or an admin for
--   any venue. The dish must be on the active menu, in a food or drinks
--   section, and still needed (no accepted photo).
-- * A date clears itself when a photo of the dish is newly accepted after it
--   was set (a menu_item_photo_events row with action 'accepted'; carried
--   and primary_set rows do not count). Derived at read time, as decision 4:
--   nothing is written by the review path, and a later withdrawal does not
--   bring the date back. Clearing by hand stamps cleared_at; setting again
--   starts a fresh set_at. Every set and clear is also kept in an insert-only
--   history (decision 7: nothing is deleted).
-- * menu_item_photo_items and manager_menu_photo_items are dropped and
--   recreated: a dish with a live date leads the list, earliest date first,
--   then menu order. The keyset cursor gains p_after_needed_by (null for a
--   dish without a date). Two return columns are added: needed_by and
--   needed_by_passed (the London date is after needed_by). There is no
--   overdue state: after the date the dish stays first and shows "Needed".
--   Every other parameter, return column, filter and grant is unchanged.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

create table public.menu_item_needed_by (
  item_id uuid not null,
  venue_id uuid not null,
  needed_by date not null,
  set_by uuid not null references public.profiles (id) on delete restrict,
  set_by_role text not null check (set_by_role in ('manager', 'admin')),
  set_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references public.profiles (id) on delete restrict,
  cleared_by_role text check (cleared_by_role in ('manager', 'admin')),
  primary key (item_id, venue_id),
  constraint menu_item_needed_by_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_item_needed_by_cleared_together check (
    (cleared_at is null and cleared_by is null and cleared_by_role is null)
    or (cleared_at is not null and cleared_by is not null and cleared_by_role is not null)
  )
);

create index menu_item_needed_by_venue_idx on public.menu_item_needed_by (venue_id);

comment on table public.menu_item_needed_by is
  'G-7: an optional date a manager puts on one still-needed dish. Orders Still needed; never overdue. Live while cleared_at is null and no photo of the dish was accepted after set_at.';

create table public.menu_item_needed_by_events (
  id bigint generated always as identity primary key,
  item_id uuid not null,
  venue_id uuid not null,
  action text not null check (action in ('set', 'cleared')),
  needed_by date,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  actor_role text not null check (actor_role in ('manager', 'admin')),
  created_at timestamptz not null default now(),
  constraint menu_item_needed_by_events_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_item_needed_by_events_date check ((action = 'set') = (needed_by is not null))
);

create index menu_item_needed_by_events_item_idx
  on public.menu_item_needed_by_events (venue_id, item_id, created_at);

comment on table public.menu_item_needed_by_events is
  'G-7: insert-only history of needed-by sets and clears.';

-- ---------------------------------------------------------------------------
-- Live dates
-- ---------------------------------------------------------------------------

-- The venue's live needed-by dates: not cleared by hand, and no photo of the
-- dish newly accepted since the date was set. Callers also require the dish
-- to be still needed (no accepted photo now).
create function private.menu_item_needed_by_live(p_venue_id uuid)
returns table (item_id uuid, needed_by date)
language sql
stable
security definer
set search_path = ''
as $$
  select n.item_id, n.needed_by
  from public.menu_item_needed_by n
  where n.venue_id = p_venue_id
    and n.cleared_at is null
    and not exists (
      select 1 from public.menu_item_photo_events ev
      where ev.venue_id = n.venue_id and ev.item_id = n.item_id
        and ev.action = 'accepted' and ev.created_at >= n.set_at
    );
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Sets (or moves) the date on one dish of the caller's venue (admins: the
-- named venue). Refuses a dish that is not on the active menu in a food or
-- drinks section (menu_item_unavailable), one that already has an accepted
-- photo (menu_item_has_photo), and a date before today in London or more than
-- a year ahead (invalid_needed_by). Other venues' dishes are not found.
create function public.set_menu_item_needed_by(
  p_item_id uuid,
  p_needed_by date,
  p_venue_id uuid default null
)
returns table (item_id uuid, venue_id uuid, needed_by date, set_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_role text;
  v_active uuid;
  v_today date := private.london_today();
  v_at timestamptz := now();
begin
  perform private.assert_can_manage_venue(v_venue);
  v_role := case when private.is_active_admin() then 'admin' else 'manager' end;
  if p_item_id is null
     or not exists (select 1 from public.menu_items i where i.id = p_item_id and i.venue_id = v_venue) then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  if p_needed_by is null or p_needed_by < v_today or p_needed_by > v_today + 366 then
    raise exception 'invalid_needed_by' using errcode = '22023';
  end if;
  -- Same lock as reviews and menu changes: the menu and the dish's photos
  -- cannot change under this check.
  perform private.lock_venue_menu(v_venue, true);
  v_active := private.active_menu_version_id(v_venue);
  if v_active is null or not exists (
    select 1
    from public.menu_entries e
    join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
    join public.menu_items i on i.id = e.item_id and i.archived_at is null
    where e.version_id = v_active and e.item_id = p_item_id
  ) then
    raise exception 'menu_item_unavailable' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = p_item_id and p.state = 'accepted'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  ) then
    raise exception 'menu_item_has_photo' using errcode = '55000';
  end if;

  insert into public.menu_item_needed_by as n
    (item_id, venue_id, needed_by, set_by, set_by_role, set_at)
  values (p_item_id, v_venue, p_needed_by, v_uid, v_role, v_at)
  on conflict on constraint menu_item_needed_by_pkey do update
  set needed_by = excluded.needed_by, set_by = excluded.set_by,
    set_by_role = excluded.set_by_role, set_at = excluded.set_at,
    cleared_at = null, cleared_by = null, cleared_by_role = null;
  insert into public.menu_item_needed_by_events (item_id, venue_id, action, needed_by, actor_id, actor_role, created_at)
  values (p_item_id, v_venue, 'set', p_needed_by, v_uid, v_role, v_at);

  item_id := p_item_id;
  venue_id := v_venue;
  needed_by := p_needed_by;
  set_at := v_at;
  return next;
end;
$$;

-- Clears the date on one dish of the caller's venue (admins: the named
-- venue). Clearing a dish with no live date changes nothing and returns
-- cleared = false. Other venues' dishes are not found.
create function public.clear_menu_item_needed_by(
  p_item_id uuid,
  p_venue_id uuid default null
)
returns table (item_id uuid, venue_id uuid, cleared boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_role text;
  v_at timestamptz := now();
  v_cleared boolean;
begin
  perform private.assert_can_manage_venue(v_venue);
  v_role := case when private.is_active_admin() then 'admin' else 'manager' end;
  if p_item_id is null
     or not exists (select 1 from public.menu_items i where i.id = p_item_id and i.venue_id = v_venue) then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  update public.menu_item_needed_by n
  set cleared_at = v_at, cleared_by = v_uid, cleared_by_role = v_role
  where n.item_id = p_item_id and n.venue_id = v_venue and n.cleared_at is null
    and exists (select 1 from private.menu_item_needed_by_live(v_venue) l where l.item_id = n.item_id);
  v_cleared := found;
  if v_cleared then
    insert into public.menu_item_needed_by_events (item_id, venue_id, action, needed_by, actor_id, actor_role, created_at)
    values (p_item_id, v_venue, 'cleared', null, v_uid, v_role, v_at);
  end if;
  item_id := p_item_id;
  venue_id := v_venue;
  cleared := v_cleared;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: dropped and recreated with the needed-by order
-- ---------------------------------------------------------------------------

drop function public.menu_item_photo_items(uuid, uuid, boolean, text, integer, integer, uuid, integer);
drop function public.manager_menu_photo_items(uuid, text, uuid, text, integer, integer, uuid, integer);

-- Body as in 20261106130000, plus the needed-by order: dishes with a live
-- date first (earliest first), then menu order. Keyset on (needed_by or
-- 'infinity', section position, entry position, item id).
create function public.menu_item_photo_items(
  p_venue_id uuid default null,
  p_section_id uuid default null,
  p_gaps_only boolean default false,
  p_query text default null,
  p_after_needed_by date default null,
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
  oldest_candidate_at timestamptz,
  needed_by date,
  needed_by_passed boolean
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
  v_today date := private.london_today();
  v_pattern text;
begin
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  with x as (
    select r.*, case when not r.covered then nb.needed_by end as nb_date
    from private.menu_item_photo_rows(v_venue, v_reviewer, private.is_active_admin()) r
    left join private.menu_item_needed_by_live(v_venue) nb on nb.item_id = r.item_id
  )
  select v_venue, x.menu_version_id, x.item_id, x.section_id, x.section_name, x.section_kind,
    x.section_position, x.entry_position, x.name, x.description, x.variants, x.covered,
    x.accepted_count, x.needs_recheck_count, x.primary_photo_id, x.primary_asset_id,
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    x.item_revision, x.candidate_count, x.oldest_candidate_at,
    x.nb_date, coalesce(x.nb_date < v_today, false)
  from x
  left join public.media_assets a on a.id = x.primary_asset_id
  where (p_section_id is null or x.section_id = p_section_id)
    and (not coalesce(p_gaps_only, false) or not x.covered)
    and (v_pattern is null or x.name ilike v_pattern
      or exists (select 1 from unnest(x.aliases) as al(alias) where al.alias ilike v_pattern))
    and (p_after_section_position is null or p_after_entry_position is null or p_after_item_id is null
      or (coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id)
        > (coalesce(p_after_needed_by, 'infinity'::date), p_after_section_position,
           p_after_entry_position, p_after_item_id))
  order by coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id
  limit v_limit;
end;
$$;

-- Body as in 20261107100500, plus the needed-by order and cursor as above.
create function public.manager_menu_photo_items(
  p_venue_id uuid default null,
  p_status text default null,
  p_section_id uuid default null,
  p_query text default null,
  p_after_needed_by date default null,
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
  oldest_candidate_at timestamptz,
  status text,
  has_pending_replacement boolean,
  needs_recheck boolean,
  own_waiting integer,
  others_waiting integer,
  needed_by date,
  needed_by_passed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_admin boolean;
  v_manager boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
  v_query text := left(nullif(btrim(p_query), ''), 80);
  v_today date := private.london_today();
  v_pattern text;
begin
  perform private.assert_can_manage_venue(v_venue);
  if p_status is not null
     and p_status not in ('covered', 'awaiting_review', 'needs_photo', 'recheck', 'replacement') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  v_admin := private.is_active_admin();
  v_manager := private.is_active_manager();
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  with waiting as (
    select t.item_id, count(*)::integer as n
    from private.menu_photo_pending_tuples(v_venue, true) t
    group by t.item_id
  ),
  own as (
    select t.item_id, count(*)::integer as n
    from private.menu_photo_pending_tuples(v_venue, v_admin, true) t
    where v_manager
    group by t.item_id
  ),
  x as (
    select r.*, coalesce(w.n, 0) as any_waiting, coalesce(o.n, 0) as own_n,
      case
        when r.covered then 'covered'
        when coalesce(w.n, 0) > 0 then 'awaiting_review'
        else 'needs_photo'
      end as headline,
      case when not r.covered then nb.needed_by end as nb_date
    from private.menu_item_photo_rows(v_venue, true, v_admin) r
    left join waiting w on w.item_id = r.item_id
    left join own o on o.item_id = r.item_id
    left join private.menu_item_needed_by_live(v_venue) nb on nb.item_id = r.item_id
  )
  select v_venue, x.menu_version_id, x.item_id, x.section_id, x.section_name, x.section_kind,
    x.section_position, x.entry_position, x.name, x.description, x.variants, x.covered,
    x.accepted_count, x.needs_recheck_count, x.primary_photo_id, x.primary_asset_id,
    a.thumbnail_path is not null, a.preview_path is not null, a.width, a.height,
    x.item_revision, x.candidate_count, x.oldest_candidate_at,
    x.headline,
    x.covered and x.any_waiting > 0,
    x.needs_recheck_count > 0,
    x.own_n,
    greatest(x.any_waiting - x.candidate_count - x.own_n, 0),
    x.nb_date, coalesce(x.nb_date < v_today, false)
  from x
  left join public.media_assets a on a.id = x.primary_asset_id
  where (p_section_id is null or x.section_id = p_section_id)
    and (p_status is null
      or (p_status in ('covered', 'awaiting_review', 'needs_photo') and x.headline = p_status)
      or (p_status = 'recheck' and x.needs_recheck_count > 0)
      or (p_status = 'replacement' and x.covered and x.any_waiting > 0))
    and (v_pattern is null or x.name ilike v_pattern
      or exists (select 1 from unnest(x.aliases) as al(alias) where al.alias ilike v_pattern))
    and (p_after_section_position is null or p_after_entry_position is null or p_after_item_id is null
      or (coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id)
        > (coalesce(p_after_needed_by, 'infinity'::date), p_after_section_position,
           p_after_entry_position, p_after_item_id))
  order by coalesce(x.nb_date, 'infinity'::date), x.section_position, x.entry_position, x.item_id
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.menu_item_needed_by, public.menu_item_needed_by_events
from public, anon, authenticated, service_role;

-- Writes go through the two functions only. Reads: admins and the venue's
-- manager; staff see dates through the item reads.
grant select on public.menu_item_needed_by, public.menu_item_needed_by_events to authenticated;
grant select, insert, update on public.menu_item_needed_by to service_role;
grant select, insert on public.menu_item_needed_by_events to service_role;

alter table public.menu_item_needed_by enable row level security;
alter table public.menu_item_needed_by_events enable row level security;

create policy menu_item_needed_by_select on public.menu_item_needed_by
  for select to authenticated
  using ((select private.can_manage_venue(venue_id)));
create policy menu_item_needed_by_events_select on public.menu_item_needed_by_events
  for select to authenticated
  using ((select private.can_manage_venue(venue_id)));

revoke all on function private.menu_item_needed_by_live(uuid) from public, anon, authenticated;
grant execute on function private.menu_item_needed_by_live(uuid) to service_role;

revoke all on function
  public.set_menu_item_needed_by(uuid, date, uuid),
  public.clear_menu_item_needed_by(uuid, uuid),
  public.menu_item_photo_items(uuid, uuid, boolean, text, date, integer, integer, uuid, integer),
  public.manager_menu_photo_items(uuid, text, uuid, text, date, integer, integer, uuid, integer)
from public, anon;

grant execute on function
  public.set_menu_item_needed_by(uuid, date, uuid),
  public.clear_menu_item_needed_by(uuid, uuid),
  public.menu_item_photo_items(uuid, uuid, boolean, text, date, integer, integer, uuid, integer),
  public.manager_menu_photo_items(uuid, text, uuid, text, date, integer, integer, uuid, integer)
to authenticated, service_role;
