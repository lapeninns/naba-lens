-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-MGR: the lightweight monthly menu confirmation and the
-- manager Overview's venue summary (spec §7 M1, §9.3; checklist
-- S9.3-menu-monthly-confirmation, M1-unlabelled-count,
-- M1-active-menu-reviewers).
--
--   menu_month_checks       append-only: a manager or admin said the active
--                           menu is still right for a month (venue time). A
--                           change goes through the existing change requests
--                           and activation rechecks; this only records the
--                           routine "still right".
--   confirm_menu_month      record this month's confirmation (idempotent per
--                           venue, month and menu version).
--   manager_venue_summary   one read for Overview: the month's menu check,
--                           the venue-wide unlabelled photo count and the
--                           main and backup reviewers.
--
-- private.venue_unlabelled_photos(venue) is the single unlabelled count. It
-- uses the rule Review's "Needs labels" filter already uses
-- (private.menu_photo_unlabelled_eligible), so the number and the list it
-- links to agree. A wider Needs label queue (FA-4) should redefine this
-- function rather than count another way.
--
-- Rollback: revoke execute on the two public functions. The table stays.

create table public.menu_month_checks (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  -- First day of the month in the venue's timezone.
  month date not null check (extract(day from month) = 1),
  menu_version_id uuid not null references public.menu_versions (id) on delete restrict,
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  confirmed_by uuid not null references public.profiles (id) on delete restrict,
  confirmer_role text not null check (confirmer_role in ('manager', 'admin')),
  confirmed_at timestamptz not null default now(),
  constraint menu_month_checks_once unique (venue_id, month, menu_version_id)
);

create index menu_month_checks_venue_idx on public.menu_month_checks (venue_id, confirmed_at desc);

comment on table public.menu_month_checks is
  'S2-MGR: monthly "menu still right" confirmations (spec §9.3). Append-only.';

create trigger menu_month_checks_append_only
  before update or delete on public.menu_month_checks
  for each row execute function private.append_only_guard();
create trigger menu_month_checks_no_truncate
  before truncate on public.menu_month_checks
  for each statement execute function private.append_only_guard();

alter table public.menu_month_checks enable row level security;
revoke all on table public.menu_month_checks from public, anon, authenticated, service_role;
grant select on table public.menu_month_checks to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.venue_month(p_venue_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', (now() at time zone coalesce(
    (select v.timezone from public.venues v where v.id = p_venue_id), 'Europe/London')))::date;
$$;

create function private.venue_unlabelled_photos(p_venue_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.media_assets a
  where a.venue_id = p_venue_id
    and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
    and private.menu_photo_unlabelled_eligible(a.id, p_venue_id);
$$;

-- {month, menuVersionId, menuTitle, due, confirmedAt, confirmedBy} for the
-- venue's active menu; null without one.
create function private.menu_month_check_json(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active as (
    select mv.id, mv.title
    from public.menu_versions mv
    where mv.id = private.active_menu_version_id(p_venue_id)
  ),
  latest as (
    select c.* from public.menu_month_checks c, active
    where c.venue_id = p_venue_id and c.menu_version_id = active.id
      and c.month = private.venue_month(p_venue_id)
    order by c.confirmed_at desc
    limit 1
  )
  select case when active.id is null then null else jsonb_build_object(
    'month', private.venue_month(p_venue_id),
    'menuVersionId', active.id,
    'menuTitle', active.title,
    'due', latest.id is null,
    'confirmedAt', latest.confirmed_at,
    'confirmedBy', (select p.display_name from public.profiles p where p.id = latest.confirmed_by))
  end
  from (select 1) one
  left join active on true
  left join latest on true;
$$;

-- ---------------------------------------------------------------------------
-- Public functions
-- ---------------------------------------------------------------------------

-- "Still right" for this month's active menu. A second call in the same
-- month for the same menu returns the existing confirmation unchanged.
create function public.confirm_menu_month(p_venue_id uuid default null, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_version uuid;
  v_note text;
begin
  v_venue := private.reviewer_scope_venue(p_venue_id);
  v_version := private.active_menu_version_id(v_venue);
  if v_version is null then
    raise exception 'no_active_menu' using errcode = 'P0002';
  end if;
  v_note := private.clean_text(p_note, 500, 'note_too_long');
  insert into public.menu_month_checks (venue_id, month, menu_version_id, note, confirmed_by, confirmer_role)
  values (v_venue, private.venue_month(v_venue), v_version, v_note, v_uid,
    case when private.is_active_admin() then 'admin' else 'manager' end)
  on conflict (venue_id, month, menu_version_id) do nothing;
  if found then
    perform private.record_activity(
      v_venue, 'menu_month_confirmed', 'menu_version', v_version::text,
      null, null, v_note, null, jsonb_build_object('month', private.venue_month(v_venue)));
  end if;
  return private.menu_month_check_json(v_venue);
end;
$$;

-- Overview's venue summary: {venueId, menuCheck, unlabelledPhotos,
-- reviewers: {main, backup}}.
create function public.manager_venue_summary(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.reviewer_scope_venue(p_venue_id);
  v_reviewers jsonb := private.venue_reviewers_json(v_venue);
begin
  return jsonb_build_object(
    'venueId', v_venue,
    'menuCheck', private.menu_month_check_json(v_venue),
    'unlabelledPhotos', private.venue_unlabelled_photos(v_venue),
    'reviewers', jsonb_build_object('main', v_reviewers -> 'main', 'backup', v_reviewers -> 'backup'));
end;
$$;

revoke all on function
  private.venue_month(uuid),
  private.venue_unlabelled_photos(uuid),
  private.menu_month_check_json(uuid)
from public, anon, authenticated;

revoke all on function
  public.confirm_menu_month(uuid, text),
  public.manager_venue_summary(uuid)
from public, anon, service_role;
grant execute on function
  public.confirm_menu_month(uuid, text),
  public.manager_venue_summary(uuid)
to authenticated;
