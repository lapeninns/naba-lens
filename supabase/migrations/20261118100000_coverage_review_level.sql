-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S1-COV part 1 of 3: the review level and the amenity photo
-- requirement (spec §2, §10 inv. 3, 4, 8; decisions FA-30, FA-31, FA-32).
--
--   Review level   every accepting photo decision has a level: public (it can
--                  close a public-photo requirement) or reference (kept as
--                  useful evidence; it never closes one, AC16). Added to the
--                  two existing decision stores as a column whose default,
--                  public, is what every acceptance meant until now:
--                    menu_item_photos.review_level (dishes)
--                    area_photo_decisions.review_level (places)
--                  A primary photo is always public (constraint and trigger).
--                  Areas also gain a Not used decision (declined, no retake).
--   Amenity photo  a facility question's photo is a requirement separate from
--                  its fact (FA-32). Until now a confirmed Yes with any photo
--                  evidence filled the album slot with no photo review.
--                    amenity_photo_requirements  per catalogue question:
--                      required (default for a question not listed) or none
--                      (a policy question: the confirmed fact is enough).
--                    amenity_photo_decisions  append-only review of one photo
--                      for one amenity check: accepted (public or reference),
--                      needs_another_photo, not_used or withdrawn.
--                  Carried over: each active, in-scope check whose current
--                  answer is a confirmed Yes gets one accepted (public)
--                  decision on the photo Album shows today (the newest photo
--                  evidence on its current submission), recorded as origin
--                  'carried', so a slot that is filled today stays filled.
--   Primaries      slot_primary_choices: append-only choice of the primary
--                  photo of an area or amenity slot per use (public only for
--                  now). Dishes keep menu_item_photos.is_primary.
--   Venue          timezone (default Europe/London), locality and operating
--                  status (FA-33). Nothing reads them yet; the London helpers
--                  stay until a second timezone is needed.
--
-- Rollback: drop the three new tables and the new columns; restore the two
-- check constraints changed below.

-- ---------------------------------------------------------------------------
-- Venue (FA-33)
-- ---------------------------------------------------------------------------

alter table public.venues
  add column timezone text not null default 'Europe/London'
    check (length(timezone) between 1 and 64 and timezone = btrim(timezone)),
  add column locality text
    check (locality is null or (length(locality) between 1 and 120 and locality = btrim(locality))),
  add column operating_status text not null default 'open'
    check (operating_status in ('open', 'temporarily_closed', 'permanently_closed'));

comment on column public.venues.timezone is
  'IANA timezone dates are shown in (FA-33). Europe/London until a venue elsewhere exists.';
comment on column public.venues.operating_status is
  'Trading state, separate from venues.active (whether the app is turned on for the venue).';

-- ---------------------------------------------------------------------------
-- Dishes: review level on menu_item_photos
-- ---------------------------------------------------------------------------

alter table public.menu_item_photos
  add column review_level text not null default 'public'
    check (review_level in ('public', 'reference')),
  add constraint menu_item_photos_primary_public check (not is_primary or review_level = 'public');

comment on column public.menu_item_photos.review_level is
  'FA-31: public closes the dish''s public-photo requirement; reference keeps the photo as evidence and leaves it open.';

-- A primary is a public photo: a readable error before the constraint.
create function private.menu_item_photos_primary_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_primary and new.review_level <> 'public' then
    raise exception 'photo_reference_only' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger menu_item_photos_primary_guard
  before insert or update on public.menu_item_photos
  for each row execute function private.menu_item_photos_primary_guard();

-- A level change is recorded as its own event.
alter table public.menu_item_photo_events
  drop constraint menu_item_photo_events_action_check,
  add constraint menu_item_photo_events_action_check check (action in (
    'accepted', 'better_photo_requested', 'withdrawn', 'primary_set', 'primary_cleared',
    'invalidated', 'needs_recheck', 'carried', 'level_set'
  ));

-- ---------------------------------------------------------------------------
-- Areas: review level and Not used on area_photo_decisions
-- ---------------------------------------------------------------------------

alter table public.area_photo_decisions
  add column review_level text not null default 'public'
    check (review_level in ('public', 'reference')),
  drop constraint area_photo_decisions_action_check,
  add constraint area_photo_decisions_action_check
    check (action in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn')),
  -- The level means something only on an acceptance.
  add constraint area_photo_decisions_level check (action = 'accepted' or review_level = 'public');

comment on column public.area_photo_decisions.review_level is
  'FA-31: on an accepted decision, public closes the place''s photo requirement; reference does not.';

-- ---------------------------------------------------------------------------
-- Amenities: the photo requirement (FA-32)
-- ---------------------------------------------------------------------------

create table public.amenity_photo_requirements (
  question_key text primary key references public.amenity_catalogue (key) on delete restrict,
  requirement text not null check (requirement in ('required', 'none')),
  reason text not null check (length(reason) between 1 and 200 and reason = btrim(reason)),
  updated_at timestamptz not null default now()
);

comment on table public.amenity_photo_requirements is
  'FA-32: whether a facility question needs a reviewed photo. A question not listed needs one (required).';

-- Policy questions: the confirmed fact answers the guest (spec §4.2).
insert into public.amenity_photo_requirements (question_key, requirement, reason)
select k.key, 'none', k.reason
from (values
  ('guest_wifi', 'Policy: the confirmed answer is enough.'),
  ('dogs_inside', 'Policy: the confirmed answer is enough.'),
  ('dogs_outside', 'Policy: the confirmed answer is enough.'),
  ('live_music', 'Event: the confirmed answer is enough.'),
  ('pub_quiz', 'Event: the confirmed answer is enough.'),
  ('curbside_pickup', 'Service: the confirmed answer is enough.')
) as k(key, reason)
where exists (select 1 from public.amenity_catalogue c where c.key = k.key);

create table public.amenity_photo_decisions (
  id bigint generated always as identity primary key,
  check_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  action text not null check (action in ('accepted', 'needs_another_photo', 'not_used', 'withdrawn')),
  review_level text not null default 'public' check (review_level in ('public', 'reference')),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  -- review: a reviewer's decision; carried: the S1-COV backfill.
  origin text not null default 'review' check (origin in ('review', 'carried')),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint amenity_photo_decisions_reason check (action = 'accepted' or reason is not null),
  constraint amenity_photo_decisions_level check (action = 'accepted' or review_level = 'public'),
  constraint amenity_photo_decisions_check_fkey foreign key (check_id, venue_id)
    references public.venue_amenity_checks (id, venue_id) on delete restrict,
  -- Evidence venue = the asset's immutable upload-time venue.
  constraint amenity_photo_decisions_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index amenity_photo_decisions_pair_idx
  on public.amenity_photo_decisions (check_id, asset_id, id desc);
create index amenity_photo_decisions_venue_idx on public.amenity_photo_decisions (venue_id, decided_at);
create index amenity_photo_decisions_asset_idx on public.amenity_photo_decisions (asset_id);

comment on table public.amenity_photo_decisions is
  'FA-32: append-only photo review for an amenity check, separate from its fact. The latest row per (check, photo) is its state.';

-- ---------------------------------------------------------------------------
-- Primaries for area and amenity slots (spec §10 inv. 3)
-- ---------------------------------------------------------------------------

create table public.slot_primary_choices (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  slot_kind text not null check (slot_kind in ('area', 'amenity')),
  slot_id uuid not null,
  -- One intended public use for now; a second use is a new value here.
  use text not null default 'public' check (use = 'public'),
  asset_id uuid not null,
  previous_asset_id uuid,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  chosen_by uuid not null references public.profiles (id) on delete restrict,
  chosen_at timestamptz not null default now(),
  constraint slot_primary_choices_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict
);

create index slot_primary_choices_slot_idx
  on public.slot_primary_choices (slot_kind, slot_id, use, id desc);

comment on table public.slot_primary_choices is
  'Append-only primary photo choices for area and amenity slots. The latest still-eligible choice is the effective primary.';

-- Append-only, like the other decision histories.
create trigger amenity_photo_decisions_append_only
  before update or delete on public.amenity_photo_decisions
  for each row execute function private.append_only_guard();
create trigger amenity_photo_decisions_no_truncate
  before truncate on public.amenity_photo_decisions
  for each statement execute function private.append_only_guard();
create trigger slot_primary_choices_append_only
  before update or delete on public.slot_primary_choices
  for each row execute function private.append_only_guard();
create trigger slot_primary_choices_no_truncate
  before truncate on public.slot_primary_choices
  for each statement execute function private.append_only_guard();

-- Reads and writes go through functions only.
alter table public.amenity_photo_requirements enable row level security;
alter table public.amenity_photo_decisions enable row level security;
alter table public.slot_primary_choices enable row level security;
revoke all on table public.amenity_photo_requirements, public.amenity_photo_decisions,
  public.slot_primary_choices from public, anon, authenticated, service_role;
grant select on table public.amenity_photo_requirements, public.amenity_photo_decisions,
  public.slot_primary_choices to service_role;

-- ---------------------------------------------------------------------------
-- Carry-over: a confirmed Yes slot filled today stays filled
-- ---------------------------------------------------------------------------

insert into public.amenity_photo_decisions (check_id, venue_id, asset_id, action, review_level, origin, decided_by, decided_at)
select x.check_id, x.venue_id, x.asset_id, 'accepted', 'public', 'carried', x.decided_by, x.decided_at
from (
  select distinct on (c.id) c.id as check_id, c.venue_id, a.id as asset_id,
    coalesce(c.answered_by, sub.submitted_by) as decided_by,
    coalesce(c.answered_at, sub.created_at) as decided_at
  from public.venue_amenity_checks c
  join public.amenity_submissions sub on sub.id = c.current_submission_id
  join public.amenity_submission_assets sa on sa.submission_id = sub.id
  join public.media_assets a on a.id = sa.asset_id and a.venue_id = sa.venue_id
  where c.status = 'active'
    and c.progress = 'complete'
    and sub.answer = 'yes'
    and sa.evidence_kind = 'photo'
    and a.deleted_at is null
    and a.upload_state = 'ready'
    and a.media_type = 'image'
  order by c.id, a.created_at desc, a.id desc
) x
where not exists (
  select 1 from public.amenity_photo_requirements r
  where r.question_key = (select c2.template_key from public.venue_amenity_checks c2 where c2.id = x.check_id)
    and r.requirement = 'none'
);
