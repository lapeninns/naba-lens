-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- S1-EXPORT (spec §8 A5, §10 publication states, §11, §14.2 manual, §3.3,
-- AC31, AC33): manual publication records, Release 1. No destination is
-- integrated yet (FA-40), so every record is a person's confirmation.
--
--   Destinations  public.publication_destinations: where approved files are
--                 put by hand (a venue's website page, a Google profile),
--                 scoped to one venue or to every venue. Admins only (§3.3).
--                 Each change is kept in publication_destination_events.
--   Records       public.publication_events, append-only, one ordered
--                 generation per destination and asset:
--                   published   Published (confirmed): needs the destination,
--                               a URL or reference, the date and the person;
--                               only for a file that is public-eligible now
--                   withdrawal_requested
--                               Withdrawal pending, asked for by an admin
--                   withdrawn   Withdrawn (confirmed): the external copy was
--                               taken down, confirmed by a person
--                   failed      Failed or unknown: nobody could confirm it
--   State         private.publication_pairs(venues): each destination and
--                 asset's latest record. A Published file that is no longer
--                 public-eligible reads as Withdrawal pending until a person
--                 confirms its removal (§14.2: no claim that a downloaded or
--                 posted copy has been recalled).
--
-- Exported comes only from a finished export download (20261118105000).
-- Queued and Update pending are integrated-destination states (Release 2).
--
-- Rollback: revoke execute on the public functions in 20261118105200. Tables
-- stay (append-only records).

create table public.publication_destinations (
  id uuid primary key default gen_random_uuid(),
  -- Null: every venue.
  venue_id uuid references public.venues (id) on delete restrict,
  kind text not null default 'manual' check (kind in ('manual')),
  label text not null check (length(label) between 1 and 120 and label = btrim(label)),
  url text check (url is null or (url ~ '^https?://[^[:space:]]+$' and length(url) <= 500)),
  active boolean not null default true,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create unique index publication_destinations_label_key
  on public.publication_destinations (coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(label));

comment on table public.publication_destinations is
  'S1-EXPORT: places approved files are put by hand (manual destinations, R1). Admins only; never deleted, deactivated instead.';

create table public.publication_destination_events (
  id bigint generated always as identity primary key,
  destination_id uuid not null references public.publication_destinations (id) on delete restrict,
  venue_id uuid,
  label text not null,
  url text,
  active boolean not null,
  revision integer not null,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default now()
);

comment on table public.publication_destination_events is
  'S1-EXPORT: append-only history of publication_destinations.';

create table public.publication_events (
  id bigint generated always as identity primary key,
  destination_id uuid not null references public.publication_destinations (id) on delete restrict,
  asset_id uuid not null,
  venue_id uuid not null,
  generation integer not null check (generation >= 1),
  action text not null check (action in ('published', 'withdrawal_requested', 'withdrawn', 'failed')),
  -- Snapshot of what was published, for display after the subject changes.
  subject_kind text not null check (subject_kind in ('menu_item', 'place', 'amenity')),
  subject_id uuid not null,
  subject_label text not null check (length(subject_label) between 1 and 200),
  approval_id text,
  package_id uuid references public.export_packages (id) on delete restrict,
  external_url text check (external_url is null or (external_url ~ '^https?://[^[:space:]]+$' and length(external_url) <= 500)),
  external_ref text check (external_ref is null or (length(external_ref) between 1 and 200 and external_ref = btrim(external_ref))),
  -- The day the external change happened, as the confirming person states it.
  occurred_on date not null,
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text not null,
  constraint publication_events_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint publication_events_generation_key unique (destination_id, asset_id, generation),
  constraint publication_events_request_key unique (recorded_by, request_key),
  -- Published needs where it can be found (§8 A5).
  constraint publication_events_published_where check (
    action <> 'published' or external_url is not null or external_ref is not null)
);

create index publication_events_asset_idx on public.publication_events (asset_id);
create index publication_events_venue_idx on public.publication_events (venue_id, recorded_at desc);

comment on table public.publication_events is
  'S1-EXPORT: append-only manual publication records. The latest generation per destination and asset is its state.';

do $$
declare
  t text;
begin
  foreach t in array array['publication_destination_events', 'publication_events'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

-- Destinations are never deleted, and keep their venue scope and kind.
create function private.publication_destinations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'publication_destination_immutable' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.venue_id is distinct from old.venue_id
     or new.kind is distinct from old.kind or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'publication_destination_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger publication_destinations_guard
  before update or delete on public.publication_destinations
  for each row execute function private.publication_destinations_guard();
create trigger publication_destinations_no_truncate
  before truncate on public.publication_destinations
  for each statement execute function private.append_only_guard();

revoke all on function private.publication_destinations_guard() from public, anon, authenticated, service_role;

alter table public.publication_destinations enable row level security;
alter table public.publication_destination_events enable row level security;
alter table public.publication_events enable row level security;
revoke all on table public.publication_destinations, public.publication_destination_events,
  public.publication_events
from public, anon, authenticated, service_role;
grant select on table public.publication_destinations, public.publication_destination_events,
  public.publication_events
to service_role;

-- ---------------------------------------------------------------------------
-- State
-- ---------------------------------------------------------------------------

-- Each destination and asset at these venues with its latest record and its
-- state now:
--   published_confirmed  latest is published and the file is public-eligible
--   withdrawal_pending   latest is withdrawal_requested, or latest is
--                        published and the file is no longer public-eligible
--   withdrawn_confirmed  latest is withdrawn
--   failed_unknown       latest is failed
create function private.publication_pairs(p_venue_ids uuid[])
returns table (
  destination_id uuid,
  asset_id uuid,
  venue_id uuid,
  state text,
  latest_id bigint,
  latest_action text,
  generation integer,
  subject_kind text,
  subject_id uuid,
  subject_label text,
  external_url text,
  external_ref text,
  occurred_on date,
  recorded_at timestamptz,
  eligible boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (e.destination_id, e.asset_id) e.*
    from public.publication_events e
    where e.venue_id = any(p_venue_ids)
    order by e.destination_id, e.asset_id, e.generation desc
  ),
  published as (
    -- Where the latest record is not published, keep the last published
    -- record's URL and reference for display.
    select distinct on (e.destination_id, e.asset_id) e.destination_id, e.asset_id, e.external_url, e.external_ref
    from public.publication_events e
    where e.venue_id = any(p_venue_ids) and e.action = 'published'
    order by e.destination_id, e.asset_id, e.generation desc
  ),
  venues as (
    select distinct l.venue_id from latest l where l.action = 'published'
  ),
  eligible as (
    select distinct c.asset_id
    from venues v cross join lateral private.export_candidate_rows(v.venue_id, 'public') c
  )
  select l.destination_id, l.asset_id, l.venue_id,
    case l.action
      when 'published' then case when el.asset_id is null then 'withdrawal_pending' else 'published_confirmed' end
      when 'withdrawal_requested' then 'withdrawal_pending'
      when 'withdrawn' then 'withdrawn_confirmed'
      else 'failed_unknown'
    end,
    l.id, l.action, l.generation, l.subject_kind, l.subject_id, l.subject_label,
    coalesce(l.external_url, p.external_url), coalesce(l.external_ref, p.external_ref),
    l.occurred_on, l.recorded_at, el.asset_id is not null
  from latest l
  left join published p on p.destination_id = l.destination_id and p.asset_id = l.asset_id
  left join eligible el on el.asset_id = l.asset_id;
$$;

-- One word for an asset across destinations, most urgent first:
-- withdrawal_pending, failed_unknown, published_confirmed,
-- withdrawn_confirmed, exported, not_selected.
create function private.publication_asset_state(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select pp.*
    from public.media_assets a
    cross join lateral private.publication_pairs(array[a.venue_id]) pp
    where a.id = p_asset_id and pp.asset_id = p_asset_id
  ),
  exported as (
    select private.export_asset_last_exported(p_asset_id) as at
  )
  select jsonb_build_object(
    'state', coalesce(
      (select pairs.state from pairs
        order by case pairs.state
          when 'withdrawal_pending' then 1 when 'failed_unknown' then 2
          when 'published_confirmed' then 3 else 4 end
        limit 1),
      case when (select at from exported) is not null then 'exported' else 'not_selected' end),
    'exportedAt', (select at from exported),
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
          'destinationId', pairs.destination_id, 'label', d.label, 'state', pairs.state,
          'externalUrl', pairs.external_url, 'externalRef', pairs.external_ref,
          'occurredOn', pairs.occurred_on)
        order by lower(d.label), d.id)
      from pairs join public.publication_destinations d on d.id = pairs.destination_id
    ), '[]'::jsonb));
$$;

revoke all on function private.publication_pairs(uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.publication_asset_state(uuid) from public, anon, authenticated, service_role;
