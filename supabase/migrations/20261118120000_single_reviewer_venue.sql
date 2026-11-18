-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R1 K6 (FA-9, spec §7 M2): a single-reviewer venue.
--
--   Setting    public.venues.single_reviewer, off by default. Only an admin
--              turns it on or off (public.admin_venue_set_single_reviewer),
--              with a reason, against the venue's revision; each change is a
--              row in public.activity_events.
--   Rule       private.review_self_allowed(venue): the caller is the venue's
--              active manager and the venue is single-reviewer. Then the
--              manager may decide on their own photo there. The decision is
--              recorded with the manager's own identity, as any other.
--              Admins keep the rules they had (an admin may decide on their
--              own dish photo; nobody else changes).
--   Helpers    private.menu_photo_self_blocked,
--              private.menu_photo_reviewable_uploader and the
--              menu_item_photos self-review trigger read the rule, so every
--              dish decision path follows it. The place, amenity and set-aside
--              paths read it in 20261118120100 and 20261118120200.
--   Spot check public.admin_venue_review_settings(venue): the setting, the
--              venue revision and the latest decisions people made on their
--              own photos at the venue (dish, place, amenity and set aside),
--              newest first, for an admin's spot check.
--
-- Rollback: re-apply the three helpers from 20261107100300, revoke the two
-- public functions; the column may stay (false keeps the old rule).

alter table public.venues
  add column single_reviewer boolean not null default false;

comment on column public.venues.single_reviewer is
  'S3-R1 K6 (FA-9): an admin marked this venue single-reviewer; its manager may decide on their own photos, listed for admin spot checks.';

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

create function private.venue_single_reviewer(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.single_reviewer from public.venues v where v.id = p_venue_id), false);
$$;

-- True when the caller is the active manager of p_venue_id and that venue is
-- single-reviewer: their own photo there is theirs to decide (FA-9).
create function private.review_self_allowed(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_venue_id is not null
    and private.is_active_manager()
    and coalesce(private.my_manager_venue_id() = p_venue_id, false)
    and private.venue_single_reviewer(p_venue_id);
$$;

revoke all on function private.venue_single_reviewer(uuid) from public, anon, authenticated, service_role;
revoke all on function private.review_self_allowed(uuid) from public, anon, authenticated, service_role;

-- Body as in 20261107100300, plus: not at the manager's single-reviewer
-- venue. A manager decides only at the venue they manage, so the venue is
-- theirs.
create or replace function private.menu_photo_self_blocked(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_author = (select auth.uid()), false)
    and private.is_active_manager()
    and not private.review_self_allowed(private.my_manager_venue_id());
$$;

-- Body as in 20261107100300; a manager's own upload is reviewable at their
-- single-reviewer venue.
create or replace function private.menu_photo_reviewable_uploader(p_uploader uuid, p_admin boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_admin, false)
    or case
      when p_uploader = (select auth.uid()) then
        not private.is_active_manager()
        or private.review_self_allowed(private.my_manager_venue_id())
      else exists (
        select 1 from public.profiles up
        where up.id = p_uploader and up.active and up.role in ('staff', 'manager'))
    end;
$$;

-- Body as in 20261107100300, plus: a manager's own decision is allowed at a
-- single-reviewer venue (the row's venue).
create or replace function private.menu_item_photos_no_manager_self_review()
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
  if private.venue_single_reviewer(new.venue_id) then
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

-- ---------------------------------------------------------------------------
-- Admin: the setting and the spot-check list
-- ---------------------------------------------------------------------------

-- Decisions people made on their own photos at the venue, newest first.
create function private.self_review_decisions(p_venue_id uuid, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by x.at desc, x.seq desc), '[]'::jsonb)
  from (
    select s.at, s.seq, jsonb_build_object(
      'source', s.source, 'action', s.action, 'level', s.level, 'reason', s.reason,
      'subject', s.subject, 'assetId', s.asset_id, 'by', p.display_name, 'byId', s.by_id,
      'role', s.role, 'at', s.at) as j
    from (
      select ev.created_at as at, ev.id as seq, 'dish'::text as source, ev.action,
        ev.detail ->> 'level' as level, ev.reason,
        coalesce(mp.item_name, ev.item_id::text) as subject, ev.asset_id,
        ev.actor_id as by_id, ev.actor_role as role
      from public.menu_item_photo_events ev
      left join public.menu_item_photos mp on mp.id = ev.photo_id
      where ev.venue_id = p_venue_id and ev.actor_id = ev.author_id
        and ev.action in ('accepted', 'better_photo_requested', 'withdrawn', 'level_set', 'primary_set')
      union all
      select d.decided_at, d.id, 'place', d.action, d.review_level, d.reason, l.subject_label,
        d.asset_id, d.decided_by, null
      from public.area_photo_decisions d
      join public.media_area_labels l on l.id = d.label_id
      join public.media_assets a on a.id = d.asset_id
      where d.venue_id = p_venue_id and d.decided_by = a.uploader_id
      union all
      select d.decided_at, d.id, 'amenity', d.action, d.review_level, d.reason, t.question,
        d.asset_id, d.decided_by, null
      from public.amenity_photo_decisions d
      join public.venue_amenity_checks c on c.id = d.check_id
      join public.amenity_catalogue t on t.key = c.template_key
      join public.media_assets a on a.id = d.asset_id
      where d.venue_id = p_venue_id and d.decided_by = a.uploader_id
      union all
      select d.decided_at, d.id, 'photo', d.action, null, d.reason, null, d.asset_id,
        d.decided_by, d.decided_role
      from public.review_dispositions d
      join public.media_assets a on a.id = d.asset_id
      where d.venue_id = p_venue_id and d.decided_by = a.uploader_id
      order by 1 desc, 2 desc
      limit greatest(least(coalesce(p_limit, 50), 200), 1)
    ) s
    join public.profiles p on p.id = s.by_id
  ) x;
$$;

revoke all on function private.self_review_decisions(uuid, integer) from public, anon, authenticated, service_role;

-- The venue's review settings for an admin: single-reviewer, the venue
-- revision (for the stale check) and the self-decisions to spot check.
create function public.admin_venue_review_settings(p_venue_id uuid, p_limit integer default 50)
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
  return jsonb_build_object(
    'venueId', v_venue.id,
    'singleReviewer', v_venue.single_reviewer,
    'revision', v_venue.revision,
    'selfDecisions', private.self_review_decisions(v_venue.id, p_limit));
end;
$$;

-- Turn single-reviewer on or off, with a reason, against the revision read.
create function public.admin_venue_set_single_reviewer(
  p_venue_id uuid, p_enabled boolean, p_reason text, p_revision integer
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
  if p_enabled is null then
    raise exception 'invalid_input' using errcode = '22023';
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
  if v_old.single_reviewer = p_enabled then
    return jsonb_build_object('venueId', v_old.id, 'singleReviewer', v_old.single_reviewer,
      'revision', v_old.revision, 'changed', false);
  end if;
  update public.venues v
  set single_reviewer = p_enabled, revision = v.revision + 1, updated_at = now()
  where v.id = p_venue_id
  returning * into v_new;
  perform private.record_activity(v_new.id, 'venue_single_reviewer_changed',
    'venue', v_new.id::text, v_old.revision, v_new.revision, v_reason,
    jsonb_build_object('singleReviewer', v_old.single_reviewer),
    jsonb_build_object('singleReviewer', v_new.single_reviewer));
  return jsonb_build_object('venueId', v_new.id, 'singleReviewer', v_new.single_reviewer,
    'revision', v_new.revision, 'changed', true);
end;
$$;

revoke all on function public.admin_venue_review_settings(uuid, integer) from public, anon, service_role;
revoke all on function public.admin_venue_set_single_reviewer(uuid, boolean, text, integer) from public, anon, service_role;
grant execute on function public.admin_venue_review_settings(uuid, integer) to authenticated;
grant execute on function public.admin_venue_set_single_reviewer(uuid, boolean, text, integer) to authenticated;
