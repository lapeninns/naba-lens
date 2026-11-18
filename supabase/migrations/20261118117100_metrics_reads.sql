-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-METRICS part 2 of 2: the measures of spec §18.1 (AC39).
--
--   Coverage      Required-media coverage per category (food, drinks,
--                 spaces, facilities, other) is public.coverage_slots' own
--                 counts, with the counted slots alongside so the number can
--                 be reproduced (AC39). Nothing here counts slots another
--                 way. Item coverage: a subject with every mandatory
--                 requirement satisfied. In Release 1 a dish and a space
--                 have one photo requirement each, so their item coverage
--                 equals their slot coverage; a facility is satisfied when
--                 its fact is currently confirmed and, where the catalogue
--                 asks for a photo, the photo is covered (FA-32).
--   Facts         Confirmed fact coverage on the rule of
--                 public.knowledge_fact_coverage (private.knowledge_fact_rows).
--   Review delay  First decision on each photo-slot pair in the period,
--                 from ready for review (labelled and processed) to the
--                 decision; processing time (reserve to ready) separately.
--   Labels        Correction rate on dish photos a person proposed a dish
--                 for: corrected when the reviewer chose another dish or
--                 variant (assign_menu_item_photo with corrects_*), by the
--                 capture route recorded at submission (product_events);
--                 "not recorded" before instrumentation.
--   Needs label   Ready photos at the venue awaiting classification
--                 (private.asset_needs_labels), duplicates left out.
--   Useful        First public acceptance on a slot, or a public acceptance
--                 after the slot's earlier photos stopped being current.
--                 An acceptance beside a current photo is an extra; a
--                 duplicate, a reference photo, the same photo accepted
--                 again or a carried (back-filled) decision never counts
--                 (§18.1, AC21).
--   Content use   Exports (packages, completed downloads, files) and
--                 acknowledged publications, separately.
--   Reliability   Failed and unfinished transfers, stuck processing,
--                 recovered failures, client-reported failures and retries,
--                 failed export downloads and failed destination actions.
--                 Technical failures are counted apart from editorial
--                 retakes (§9.1).
--
--   Reads    public.venue_metrics(venue, days): the venue's manager or an
--            admin (an admin names the venue). public.metrics_overview(days):
--            admins, every active venue. public.my_contribution_metrics(days):
--            the signed-in person's own useful contributions only. No read
--            ranks or compares people (§18.1, DESIGN.md §9).
--
-- Rollback: drop the three public functions and the private helpers
-- metrics_scope, metrics_days, metrics_acceptances and metrics_venue_json.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The venue a metrics read may cover: an admin (second step passed) names
-- any venue; otherwise the caller must be the named venue's manager
-- (private.venue_role_of), defaulting to the venue they manage.
create function private.metrics_scope(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if private.is_active_admin() then
    if p_venue_id is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.venues v where v.id = p_venue_id) then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    return p_venue_id;
  end if;
  v_venue := coalesce(p_venue_id, private.my_manager_venue_id());
  if v_venue is null or private.venue_role_of(v_uid, v_venue) is distinct from 'manager' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return v_venue;
end;
$$;

create function private.metrics_days(p_days integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  return p_days;
end;
$$;

-- Every public acceptance of a photo on a slot at the venue, with the end of
-- its public decision interval and whether it was useful (see the header).
create function private.metrics_acceptances(p_venue_id uuid)
returns table (
  slot_kind text,
  slot_id uuid,
  asset_id uuid,
  uploader_id uuid,
  accepted_at timestamptz,
  ended_at timestamptz,
  usefulness text
)
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    -- A dish photo's events with the review level each one leaves it at:
    -- an accept or level change sets it (public when not stated: decisions
    -- before review levels were all public); other events keep it.
    select e.id, e.photo_id, e.item_id, e.asset_id, e.created_at, e.action, e.to_state,
      case when e.action in ('accepted', 'level_set', 'carried')
        then coalesce(e.detail ->> 'level', 'public') end as lvl
    from public.menu_item_photo_events e
    where e.venue_id = p_venue_id
  ),
  ev_grouped as (
    select ev.*, count(ev.lvl) over (partition by ev.photo_id order by ev.id) as grp
    from ev
  ),
  ev_public as (
    select g.*,
      g.to_state = 'accepted'
        and coalesce(first_value(g.lvl) over (partition by g.photo_id, g.grp order by g.id), 'public')
          = 'public' as pub
    from ev_grouped g
  ),
  -- One decision can write several events in one transaction (an accept
  -- then its level): only the state each transaction leaves counts.
  ev_tx as (
    select p.* from (
      select p.*, row_number() over (partition by p.photo_id, p.created_at order by p.id desc) as rn
      from ev_public p
    ) p
    where p.rn = 1
  ),
  ev_edges as (
    select p.*, lag(p.pub) over (partition by p.photo_id order by p.id) as prev_pub
    from ev_tx p
  ),
  dish_starts as (
    select x.id as event_id, x.photo_id, x.item_id as slot_id, x.asset_id,
      x.created_at as started_at, x.action = 'carried' as carried
    from ev_edges x
    where x.pub and not coalesce(x.prev_pub, false)
  ),
  raw as (
    select 'dish'::text as kind, s.slot_id, s.asset_id, s.started_at, s.carried,
      (select min(x.created_at) from ev_tx x
        where x.photo_id = s.photo_id and x.id > s.event_id and not x.pub) as ended_at,
      null::uuid as area_label_id
    from dish_starts s
    union all
    select 'area', l.subject_id, d.asset_id, d.decided_at, false,
      least(
        (select min(n.decided_at) from public.area_photo_decisions n
          where n.label_id = d.label_id and n.id > d.id),
        l.removed_at), l.id
    from public.area_photo_decisions d
    join public.media_area_labels l on l.id = d.label_id
    where d.venue_id = p_venue_id and d.action = 'accepted' and d.review_level = 'public'
    union all
    select 'amenity', d.check_id, d.asset_id, d.decided_at, d.origin = 'carried',
      (select min(n.decided_at) from public.amenity_photo_decisions n
        where n.check_id = d.check_id and n.asset_id = d.asset_id and n.id > d.id),
      null::uuid
    from public.amenity_photo_decisions d
    where d.venue_id = p_venue_id and d.action = 'accepted' and d.review_level = 'public'
  ),
  acc as (
    select r.kind, r.slot_id, r.asset_id, a.uploader_id, r.started_at, r.carried, r.area_label_id,
      least(r.ended_at, a.deleted_at) as ended_at,
      a.duplicate_of_asset_id is not null as duplicate
    from raw r
    join public.media_assets a on a.id = r.asset_id
  )
  select r.kind, r.slot_id, r.asset_id, r.uploader_id, r.started_at, r.ended_at,
    case
      when r.duplicate then 'duplicate'
      when r.carried then 'carried'
      -- The same photo accepted again on the same slot (a level changed
      -- back, a decision repeated) is not a new contribution.
      when exists (
        select 1 from acc b
        where b.kind = r.kind and b.slot_id = r.slot_id and b.asset_id = r.asset_id
          and b.started_at < r.started_at
      ) then 'repeat'
      when not exists (
        select 1 from acc b
        where b.kind = r.kind and b.slot_id = r.slot_id and not b.duplicate
          and (b.started_at < r.started_at
            or (b.started_at = r.started_at and b.asset_id < r.asset_id))
      ) then 'first'
      when exists (
        select 1 from acc b
        where b.kind = r.kind and b.slot_id = r.slot_id and not b.duplicate
          and b.asset_id <> r.asset_id
          and b.started_at <= r.started_at
          and (b.ended_at is null or b.ended_at > r.started_at)
          -- Within a public decision interval, a space photo can become
          -- stale, expire or be reconfirmed. Use the state at the new
          -- acceptance so later checks do not rewrite its credit.
          and (b.area_label_id is null
            or private.area_photo_freshness(b.area_label_id, r.started_at) ->> 'state' = 'current')
      ) then 'extra'
      else 'replacement'
    end
  from acc r;
$$;

-- ---------------------------------------------------------------------------
-- One venue's measures (no access check: callers check first)
-- ---------------------------------------------------------------------------

create function private.metrics_venue_json(p_venue_id uuid, p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_from timestamptz := now() - make_interval(days => p_days);
  v_cov jsonb := private.coverage_slots_json(p_venue_id);
  v_backlog jsonb := private.ops_venue_backlog(p_venue_id, now());
  v_facts jsonb;
  v_items jsonb;
  v_review jsonb;
  v_labels jsonb;
  v_needs jsonb;
  v_useful jsonb;
  v_content jsonb;
  v_reliability jsonb;
  v_flow jsonb;
begin
  -- Facts: the rule of public.knowledge_fact_coverage.
  with r as (
    select * from private.knowledge_fact_rows(p_venue_id) x where x.applicable
  ),
  g as (
    select r.category,
      (count(*) filter (where r.verification = 'confirmed'))::integer as numerator,
      count(*)::integer as denominator
    from r group by r.category
  )
  select jsonb_build_object(
    'numerator', (select count(*) filter (where r.verification = 'confirmed') from r)::integer,
    'denominator', (select count(*) from r)::integer,
    'checkDue', (select count(*) filter (where r.verification = 'check_due') from r)::integer,
    'unconfirmed', (select count(*) filter (where r.verification = 'unconfirmed') from r)::integer,
    'withdrawn', (select count(*) filter (where r.verification = 'withdrawn') from r)::integer,
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', g.category,
      'numerator', g.numerator, 'denominator', g.denominator) order by g.category) from g), '[]'::jsonb))
  into v_facts;

  -- Item coverage per category.
  with fact as (
    select r.check_id, r.verification
    from private.knowledge_fact_rows(p_venue_id) r
    where r.applicable and r.check_id is not null
  ),
  slots as (
    select s from jsonb_array_elements(v_cov -> 'slots') s
  ),
  facility as (
    select count(*)::integer as total,
      (count(*) filter (where f.verification = 'confirmed'
        and coalesce(sl.s ->> 'state' in ('covered', 'not_here', 'inactive'), true)))::integer as satisfied
    from fact f
    left join slots sl on sl.s ->> 'kind' = 'amenity' and (sl.s ->> 'slotId')::uuid = f.check_id
  )
  select jsonb_agg(jsonb_build_object(
      'category', c.key,
      'satisfied', case when c.key = 'facilities' then (select satisfied from facility)
        else coalesce((cat ->> 'covered')::integer, 0) end,
      'total', case when c.key = 'facilities' then (select total from facility)
        else coalesce((cat ->> 'total')::integer, 0) end)
    order by c.ord)
  into v_items
  from (values ('food', 1), ('drinks', 2), ('spaces', 3), ('facilities', 4), ('other', 5)) as c(key, ord)
  left join lateral (
    select x as cat from jsonb_array_elements(v_cov -> 'categories') x where x ->> 'category' = c.key
  ) cc on true;

  -- Review delay and processing time.
  with ready as (
    select a.id, a.created_at, t.ready_at, coalesce(t.ready_at, a.created_at) as ready_or_reserved
    from public.media_assets a
    left join public.media_state_times t on t.asset_id = a.id
    where a.venue_id = p_venue_id
  ),
  decisions as (
    select 'dish'::text as kind, p.decided_at,
      greatest(r.ready_or_reserved, coalesce(li.added_at, r.ready_or_reserved)) as ready_at
    from public.menu_item_photos p
    join ready r on r.id = p.asset_id
    left join lateral (
      select min(x.added_at) as added_at from public.media_label_items x
      where x.asset_id = p.asset_id
        and x.item_id = case when p.basis = 'staff_label' then p.item_id else p.corrects_item_id end
    ) li on true
    where p.venue_id = p_venue_id and p.decided_at >= v_from
      and not exists (
        select 1 from public.menu_item_photos q
        where q.asset_id = p.asset_id and q.item_id = p.item_id
          and q.variant_id is not distinct from p.variant_id and q.created_at < p.created_at)
    union all
    select 'area', d.decided_at, greatest(r.ready_or_reserved, l.added_at)
    from public.area_photo_decisions d
    join public.media_area_labels l on l.id = d.label_id
    join ready r on r.id = d.asset_id
    where d.venue_id = p_venue_id and d.decided_at >= v_from
      and not exists (select 1 from public.area_photo_decisions n where n.label_id = d.label_id and n.id < d.id)
    union all
    select 'amenity', d.decided_at, r.ready_or_reserved
    from public.amenity_photo_decisions d
    join ready r on r.id = d.asset_id
    where d.venue_id = p_venue_id and d.origin = 'review' and d.decided_at >= v_from
      and not exists (
        select 1 from public.amenity_photo_decisions n
        where n.check_id = d.check_id and n.asset_id = d.asset_id and n.id < d.id)
    union all
    select 'checklist', i.decided_at, greatest(r.ready_or_reserved, i.submitted_at)
    from public.coverage_submission_items i
    join ready r on r.id = i.asset_id
    where i.venue_id = p_venue_id and i.decided_at is not null and i.decided_at >= v_from
  ),
  d as (
    select kind, greatest(0, extract(epoch from decided_at - ready_at)) as secs from decisions
  ),
  processed as (
    select extract(epoch from r.ready_at - r.created_at) as secs
    from ready r where r.ready_at is not null and r.ready_at >= v_from
  )
  select jsonb_build_object(
    'decided', (select count(*) from d)::integer,
    'medianSeconds', (select round(percentile_cont(0.5) within group (order by secs))::bigint from d),
    'p90Seconds', (select round(percentile_cont(0.9) within group (order by secs))::bigint from d),
    'byKind', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'decided', k.n, 'medianSeconds', k.med)
        order by k.kind)
      from (
        select kind, count(*)::integer as n,
          round(percentile_cont(0.5) within group (order by secs))::bigint as med
        from d group by kind
      ) k), '[]'::jsonb),
    'waiting', coalesce((v_backlog ->> 'waiting')::integer, 0),
    'oldestWaitingAt', v_backlog -> 'oldestWaitingAt',
    'overdueChecks', coalesce((v_backlog ->> 'overdueChecks')::integer, 0),
    'processing', jsonb_build_object(
      'count', (select count(*) from processed)::integer,
      'medianSeconds', (select round(percentile_cont(0.5) within group (order by secs))::bigint from processed),
      'p90Seconds', (select round(percentile_cont(0.9) within group (order by secs))::bigint from processed)))
  into v_review;

  -- Label correction by capture route (dish photos with a proposed dish).
  with tuples as (
    select p.asset_id,
      case when p.basis = 'staff_label' then p.item_id else p.corrects_item_id end as proposed,
      min(p.decided_at) as decided_at,
      bool_or(p.basis = 'reviewer' and p.corrects_item_id is not null) as corrected
    from public.menu_item_photos p
    where p.venue_id = p_venue_id and (p.basis = 'staff_label' or p.corrects_item_id is not null)
    group by 1, 2
    having min(p.decided_at) >= v_from
  ),
  routed as (
    select t.*, coalesce((
      select e.route from public.product_events e
      where e.asset_id = t.asset_id and e.name = 'submitted' and e.route is not null
      order by e.occurred_at desc, e.id desc limit 1), 'not_recorded') as route
    from tuples t
  )
  select jsonb_build_object(
    'reviewed', (select count(*) from routed)::integer,
    'corrected', (select count(*) filter (where corrected) from routed)::integer,
    'byRoute', coalesce((
      select jsonb_agg(jsonb_build_object('route', x.route, 'reviewed', x.n, 'corrected', x.c)
        order by x.route)
      from (select route, count(*)::integer as n, (count(*) filter (where corrected))::integer as c
            from routed group by route) x), '[]'::jsonb),
    'labelledByReviewer', (
      select count(distinct p.asset_id) from public.menu_item_photos p
      where p.venue_id = p_venue_id and p.basis = 'reviewer' and p.corrects_item_id is null
        and p.decided_at >= v_from
        and not exists (select 1 from public.menu_item_photos q
          where q.asset_id = p.asset_id and q.created_at < p.created_at))::integer)
  into v_labels;

  -- Needs-label backlog.
  select jsonb_build_object(
    'count', count(*)::integer,
    'oldestAt', min(a.created_at),
    'inManagerQueue', (count(*) filter (where a.created_at < v_now - interval '7 days'))::integer)
  into v_needs
  from public.media_assets a
  where a.venue_id = p_venue_id and a.upload_state = 'ready' and a.deleted_at is null
    and a.purpose = 'general' and a.duplicate_of_asset_id is null
    and private.asset_needs_labels(a.id);

  -- Useful contributions.
  select jsonb_build_object(
    'useful', (count(*) filter (where m.usefulness in ('first', 'replacement')))::integer,
    'firstFulfilment', (count(*) filter (where m.usefulness = 'first'))::integer,
    'replacement', (count(*) filter (where m.usefulness = 'replacement'))::integer,
    'extra', (count(*) filter (where m.usefulness = 'extra'))::integer,
    'duplicates', (count(*) filter (where m.usefulness = 'duplicate'))::integer)
  into v_useful
  from private.metrics_acceptances(p_venue_id) m
  where m.accepted_at >= v_from;

  -- Content use: exports and publications, separately.
  select jsonb_build_object(
    'exports', jsonb_build_object(
      'packages', (select count(*) from public.export_packages k
        where k.venue_id = p_venue_id and k.created_at >= v_from)::integer,
      'downloads', (select count(*) from public.export_package_downloads d
        join public.export_packages k on k.id = d.package_id
        where k.venue_id = p_venue_id and d.completed_at >= v_from)::integer,
      'files', (select coalesce(sum(k.item_count), 0) from public.export_package_downloads d
        join public.export_packages k on k.id = d.package_id
        where k.venue_id = p_venue_id and d.completed_at >= v_from)::integer),
    'publications', jsonb_build_object(
      'published', (select count(*) from public.publication_events e
        where e.venue_id = p_venue_id and e.action = 'published' and e.recorded_at >= v_from)::integer,
      'assets', (select count(distinct e.asset_id) from public.publication_events e
        where e.venue_id = p_venue_id and e.action = 'published' and e.recorded_at >= v_from)::integer,
      'withdrawn', (select count(*) from public.publication_events e
        where e.venue_id = p_venue_id and e.action = 'withdrawn' and e.recorded_at >= v_from)::integer))
  into v_content;

  -- Reliability: technical failures apart from editorial retakes.
  with up as (
    select
      count(*)::integer as started,
      (count(*) filter (where a.upload_state = 'failed'))::integer as failed,
      (count(*) filter (where a.upload_state = 'uploading'
        and a.created_at < v_now - interval '24 hours'))::integer as not_finished
    from public.media_assets a
    where a.venue_id = p_venue_id and a.created_at >= v_from and a.deleted_at is null
  ),
  t as (
    select
      (select count(*) from public.media_assets a
        where a.venue_id = p_venue_id and a.deleted_at is null and a.upload_state = 'processing'
          and a.updated_at < v_now - interval '30 minutes')::integer as stuck,
      (select count(*) from public.media_state_times s
        where s.venue_id = p_venue_id and s.failure_count > 0 and s.ready_at >= v_from)::integer as recovered,
      (select count(*) from public.product_events e
        where e.venue_id = p_venue_id and e.name = 'transfer_failed' and e.occurred_at >= v_from)::integer as client_failed,
      (select count(*) from public.product_events e
        where e.venue_id = p_venue_id and e.name = 'transfer_retried' and e.occurred_at >= v_from)::integer as client_retried,
      (select count(*) from public.export_package_downloads d
        join public.export_packages k on k.id = d.package_id
        where k.venue_id = p_venue_id and d.failed_at >= v_from)::integer as export_failed,
      (select count(*) from public.publication_events e
        where e.venue_id = p_venue_id and e.action = 'failed' and e.recorded_at >= v_from)::integer as destination_failed,
      ((select count(*) from public.menu_item_photo_events e
          where e.venue_id = p_venue_id and e.action = 'better_photo_requested' and e.created_at >= v_from)
        + (select count(*) from public.area_photo_decisions d
          where d.venue_id = p_venue_id and d.action = 'needs_another_photo' and d.decided_at >= v_from)
        + (select count(*) from public.amenity_photo_decisions d
          where d.venue_id = p_venue_id and d.action = 'needs_another_photo' and d.decided_at >= v_from)
      )::integer as editorial
  )
  select jsonb_build_object(
    'uploads', up.started, 'failed', up.failed, 'notFinished', up.not_finished,
    'stuckProcessing', t.stuck, 'recovered', t.recovered,
    'clientFailures', t.client_failed, 'clientRetries', t.client_retried,
    'exportFailures', t.export_failed, 'destinationFailures', t.destination_failed,
    'technical', up.failed + up.not_finished + t.stuck + t.export_failed + t.destination_failed,
    'editorial', t.editorial)
  into v_reliability
  from up, t;

  -- Workflow events (§18.3), by name and route.
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'route', x.route, 'count', x.n)
      order by x.name, x.route nulls first), '[]'::jsonb)
  into v_flow
  from (
    select e.name, e.route, count(*)::integer as n
    from public.product_events e
    where e.venue_id = p_venue_id and e.occurred_at >= v_from
    group by e.name, e.route
  ) x;

  return jsonb_build_object(
    'venueId', p_venue_id,
    'venueName', (select v.name from public.venues v where v.id = p_venue_id),
    'days', p_days,
    'from', v_from,
    'generatedAt', v_now,
    'coverage', jsonb_build_object('categories', v_cov -> 'categories', 'totals', v_cov -> 'totals'),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'kind', s ->> 'kind', 'slotId', s ->> 'slotId', 'name', s ->> 'name',
          'groupName', s ->> 'groupName', 'category', s ->> 'category', 'state', s ->> 'state',
          'counted', (s ->> 'counted')::boolean, 'unavailable', (s ->> 'unavailable')::boolean)
        order by o)
      from jsonb_array_elements(v_cov -> 'slots') with ordinality as t(s, o)), '[]'::jsonb),
    'items', v_items,
    'facts', v_facts,
    'review', v_review,
    'labels', v_labels,
    'needsLabel', v_needs,
    'contributions', v_useful,
    'contentUse', v_content,
    'reliability', v_reliability,
    'flow', v_flow);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Spec §18.1 for one venue over the last p_days days: its manager, or an
-- admin naming it.
create function public.venue_metrics(p_venue_id uuid default null, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.metrics_scope(p_venue_id);
begin
  return private.metrics_venue_json(v_venue, private.metrics_days(p_days));
end;
$$;

-- Admins: every active venue's headline measures, plus the group's failed
-- jobs in the period.
create function public.metrics_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if auth.uid() is null or not private.is_active_user() or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  v_days := private.metrics_days(p_days);
  return jsonb_build_object(
    'days', v_days,
    'generatedAt', now(),
    'failedJobs', (select count(*) from public.ops_job_runs j
      where j.state = 'failed' and j.started_at >= now() - make_interval(days => v_days))::integer,
    'venues', coalesce((
      select jsonb_agg(m - 'slots' - 'flow' order by m ->> 'venueName', m ->> 'venueId')
      from public.venues v
      cross join lateral (select private.metrics_venue_json(v.id, v_days) as m) x
      where v.active), '[]'::jsonb));
end;
$$;

-- The signed-in person's own useful contributions in the period, across
-- every venue they added photos to. Never anyone else's.
create function public.my_contribution_metrics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_days integer;
  v_from timestamptz;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  v_days := private.metrics_days(p_days);
  v_from := now() - make_interval(days => v_days);
  return (
    select jsonb_build_object(
      'days', v_days,
      'useful', (count(*) filter (where m.usefulness in ('first', 'replacement')))::integer,
      'firstFulfilment', (count(*) filter (where m.usefulness = 'first'))::integer,
      'replacement', (count(*) filter (where m.usefulness = 'replacement'))::integer,
      'extra', (count(*) filter (where m.usefulness = 'extra'))::integer)
    from (
      select distinct a.venue_id from public.media_assets a where a.uploader_id = v_uid
    ) mine
    cross join lateral private.metrics_acceptances(mine.venue_id) m
    where m.uploader_id = v_uid and m.accepted_at >= v_from
  );
end;
$$;

revoke all on function private.metrics_scope(uuid) from public, anon, authenticated;
revoke all on function private.metrics_days(integer) from public, anon, authenticated;
revoke all on function private.metrics_acceptances(uuid) from public, anon, authenticated;
revoke all on function private.metrics_venue_json(uuid, integer) from public, anon, authenticated;
revoke all on function public.venue_metrics(uuid, integer) from public, anon, service_role;
revoke all on function public.metrics_overview(integer) from public, anon, service_role;
revoke all on function public.my_contribution_metrics(integer) from public, anon, service_role;
grant execute on function public.venue_metrics(uuid, integer) to authenticated;
grant execute on function public.metrics_overview(integer) to authenticated;
grant execute on function public.my_contribution_metrics(integer) to authenticated;
