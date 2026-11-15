-- One review per photo, ORP-1 (docs/plans/one-review-per-photo.md): an
-- accepted menu item photo also counts toward the uploader's month and toward
-- the menu-section task that holds the dish. Read-through only: no rows are
-- written, no write path changes, and manager accounts stay denied every
-- coverage write (deny_manager_coverage_writes). The two counting functions
-- every reader goes through gain a second source:
--
--   private.monthly_credit_items  (coverage_staff_progress: the month)
--   private.requirement_status_rows (coverage_requirement_progress,
--                                    venue_coverage_summary: the tasks)
--
-- Rules (decided 15 Nov 2026):
--   * Month: a still image the uploader labelled themselves, accepted for an
--     item (state accepted, or needs_recheck: credit stays after a menu
--     change), counts for the London month its upload started. Withdrawn and
--     invalidated rows (label removed) earn nothing. A photo the reviewer
--     matched without the uploader's label earns nothing, as attached photos
--     earn nothing. A photo already credited through a submission is not
--     counted again; callers count distinct assets either way.
--   * Task: an accepted (not needs_recheck) row counts toward a menu_section
--     requirement when its item is an entry of that requirement's section in
--     that requirement's menu version. Distinct assets across both sources.
--   * No backfill: history is not rewritten; the counts are derived at read
--     time from rows that already exist.
-- Signatures, return columns and grants are unchanged.

-- ---------------------------------------------------------------------------
-- Month
-- ---------------------------------------------------------------------------

create or replace function private.monthly_credit_items(p_month date)
returns table (
  author_id uuid,
  venue_id uuid,
  asset_id uuid,
  decided_at timestamptz,
  evidence_removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with submitted as (
    -- As in 20261102150000: the author submitted their own ready image,
    -- uploaded and submitted in that London month, at its upload venue.
    select i.author_id, i.venue_id, i.asset_id, i.decided_at,
      a.deleted_at is not null as evidence_removed
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    where i.submitted_month = p_month
      and i.uploaded_month = p_month
      and i.state = 'accepted'
      and i.origin = 'submitted'
      and i.submitted_by = i.author_id
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month))
  ),
  menu as (
    -- One row per asset however many items it was accepted for; the earliest
    -- decision decides whether it was a late acceptance.
    select m.author_id, m.venue_id, m.asset_id, min(m.decided_at) as decided_at,
      bool_or(a.deleted_at is not null) as evidence_removed
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id
    where m.state in ('accepted', 'needs_recheck')
      and private.london_month(a.created_at) = p_month
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= private.london_month_end(p_month))
      -- The uploader's own label for the reviewed tuple.
      and exists (
        select 1 from public.media_label_items li
        where li.asset_id = m.asset_id
          and li.item_id = m.item_id
          and li.variant_id is not distinct from m.variant_id
          and li.added_by = m.author_id
      )
      and not exists (select 1 from submitted s where s.asset_id = m.asset_id)
    group by m.author_id, m.venue_id, m.asset_id
  )
  select s.author_id, s.venue_id, s.asset_id, s.decided_at, s.evidence_removed
  from submitted s
  union all
  select m.author_id, m.venue_id, m.asset_id, m.decided_at, m.evidence_removed
  from menu m;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create or replace function private.requirement_status_rows(p_venue_id uuid)
returns table (
  requirement_id uuid,
  venue_id uuid,
  kind text,
  status text,
  photo_target integer,
  due_on date,
  menu_plan_status text,
  is_current boolean,
  in_scope boolean,
  accepted_count integer,
  pending_count integer,
  needs_another_photo_count integer,
  evidence_removed_count integer,
  open_assignee_ids uuid[],
  had_departed_assignee boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.venue_id, r.kind, r.status, r.photo_target, r.due_on, mp.status,
    r.status = 'active' and (r.kind <> 'menu_section' or coalesce(mp.status = 'confirmed', false)),
    r.status in ('needs_setup', 'active') and (r.kind <> 'menu_section' or coalesce(mp.status = 'confirmed', false)),
    coalesce(acc.accepted, 0), coalesce(e.pending, 0), coalesce(e.needs_another, 0), coalesce(acc.removed, 0),
    coalesce(asg.ids, '{}'::uuid[]), coalesce(asg.departed, false)
  from public.coverage_requirements r
  left join public.menu_coverage_plans mp on mp.id = r.menu_plan_id
  left join lateral (
    select
      (count(*) filter (
        where i.state = 'submitted' and a.upload_state = 'ready' and a.deleted_at is null))::integer as pending,
      (count(*) filter (where i.state = 'needs_another_photo' and rp.replaced is null))::integer as needs_another
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id
    left join lateral (
      select true as replaced
      from public.coverage_submission_items n
      where n.replaces_item_id = i.id
      limit 1
    ) rp on true
    where i.requirement_id = r.id and i.archived_at is null
  ) e on true
  -- Accepted evidence: submitted or attached photos, then (menu sections only)
  -- photos accepted for one of the section's dishes. Distinct assets.
  left join lateral (
    select
      (count(distinct x.asset_id) filter (where x.available))::integer as accepted,
      (count(distinct x.asset_id) filter (where x.removed))::integer as removed
    from (
      select i.asset_id,
        a.upload_state = 'ready' and a.deleted_at is null as available,
        a.deleted_at is not null as removed
      from public.coverage_submission_items i
      join public.media_assets a on a.id = i.asset_id
      where i.requirement_id = r.id and i.archived_at is null and i.state = 'accepted'
      union all
      select m.asset_id,
        a.upload_state = 'ready' and a.deleted_at is null,
        a.deleted_at is not null
      from public.menu_entries me
      join public.menu_item_photos m
        on m.item_id = me.item_id and m.venue_id = me.venue_id and m.state = 'accepted'
      join public.media_assets a on a.id = m.asset_id and a.media_type = 'image'
      where r.kind = 'menu_section'
        and me.version_id = r.menu_version_id
        and me.section_id = r.menu_section_id
        and me.venue_id = r.venue_id
    ) x
  ) acc on true
  left join lateral (
    select
      array_agg(x.staff_id order by x.assigned_at) filter (where x.ended_at is null) as ids,
      bool_or(x.end_kind in ('transferred', 'deactivated')) as departed
    from public.coverage_requirement_assignees x
    where x.requirement_id = r.id
  ) asg on true
  where p_venue_id is null or r.venue_id = p_venue_id;
$$;
