-- B03 OD-20: a routine correction preserves the original submission's
-- credit. An explicit withdrawal or recheck invalidates it for the open
-- month. Correction authorship and append-only events stay intact.
-- Rollback: restore the previous monthly count and recognition function
-- bodies from 20261109120000 and 20261109145934, then drop this helper.

-- Shared by monthly counts and the staff contribution history. At the
-- requested month's cutoff, identify the original submission in the live
-- correction chain. The caller checks its author and month.
create function private.knowledge_credited_submission(
  p_check_id uuid, p_period_month date
)
returns uuid
language sql
stable
set search_path = ''
as $$
  with recursive bounds as (
    select private.london_month_end(p_period_month) as month_end
  ), latest_progress as (
    select case when e.kind = 'submitted' then (e.detail ->> 'submissionId')::uuid end as submission_id
    from public.amenity_check_events e
    cross join bounds b
    where e.check_id = p_check_id
      and e.created_at < b.month_end and e.created_at <= now()
      and e.kind in ('submitted', 'reopened', 'evidence_lost')
    order by e.id desc
    limit 1
  ), answer_lineage as (
    select s.id, s.source_contribution_id, s.result_revision
    from latest_progress p
    join public.amenity_submissions s on s.id = p.submission_id and s.check_id = p_check_id
    union all
    select previous.id, previous.source_contribution_id, previous.result_revision
    from answer_lineage current_answer
    join public.knowledge_contributions correction
      on correction.id = current_answer.source_contribution_id and correction.kind = 'correction'
    join public.amenity_submissions previous
      on previous.id = correction.based_on_submission_id and previous.check_id = p_check_id
      and previous.result_revision < current_answer.result_revision
  )
  select original.id
  from answer_lineage original
  cross join bounds b
  where not exists (
    select 1 from public.knowledge_contributions correction
    where correction.id = original.source_contribution_id and correction.kind = 'correction'
  )
  and (
    select e.kind from public.amenity_check_events e
    where e.check_id = p_check_id
      and e.created_at < b.month_end and e.created_at <= now()
      and e.kind in ('archived', 'restored')
    order by e.id desc
    limit 1
  ) is distinct from 'archived'
  and not exists (
    -- A subsequent correction cannot restore credit after a withdrawal. A
    -- genuine new answer has its own lineage and can earn new credit.
    select 1 from answer_lineage withdrawn
    join public.knowledge_decisions d on d.submission_id = withdrawn.id
    where d.check_id = p_check_id and d.decision = 'withdrawn'
      and d.created_at < b.month_end and d.created_at <= now()
  );
$$;

revoke all on function private.knowledge_credited_submission(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.monthly_venue_completion_counts(
  p_venue_id uuid, p_staff_id uuid, p_period_month date
)
returns table (menu_items_completed integer, amenity_checks_completed integer)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select private.london_month_start(p_period_month) as month_start,
      private.london_month_end(p_period_month) as month_end
  )
  select (
    select count(distinct e.item_id)::integer
    from public.menu_item_photo_events e
    cross join bounds b
    join public.media_assets a on a.id = e.asset_id and a.venue_id = e.venue_id
    join lateral (
      select x.id
      from public.menu_item_photo_events x
      where x.photo_id = e.photo_id
        and x.created_at < b.month_end
        and x.created_at <= now()
        and x.action in ('accepted', 'better_photo_requested', 'withdrawn', 'invalidated', 'needs_recheck')
      order by x.id desc
      limit 1
    ) last_decision on last_decision.id = e.id
    where e.venue_id = p_venue_id and e.author_id = p_staff_id
      and e.action = 'accepted'
      and e.created_at >= b.month_start
      and e.created_at < b.month_end
      and e.created_at <= now()
      and a.media_type = 'image'
      and a.upload_state = 'ready'
      and (a.deleted_at is null or a.deleted_at >= b.month_end or a.deleted_at > now())
  ), (
    select count(distinct s.check_id)::integer
    from public.amenity_submissions s
    cross join bounds b
    where s.venue_id = p_venue_id and s.submitted_by = p_staff_id
      and s.created_at >= b.month_start
      and s.created_at < b.month_end
      and s.created_at <= now()
      and s.id = private.knowledge_credited_submission(s.check_id, p_period_month)
  );
$$;

create or replace function private.knowledge_submission_scored(p_submission_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select x.*, (date_trunc('month', x.created_at at time zone 'Europe/London'))::date as month
    from public.amenity_submissions x where x.id = p_submission_id
  )
  select case
    when not exists (select 1 from s) then jsonb_build_object('kind', 'none')
    when private.venue_monthly_completion_target(s.venue_id, s.month) is null then jsonb_build_object('kind', 'none')
    -- Participants exactly as coverage_staff_progress_v2 counts them: a staff
    -- membership at the venue overlapping the month, or a legacy monthly
    -- target created in its own month. Anyone else (a manager account) has no
    -- credit row, so no recognition (§3.5).
    when not exists (
      select 1 from private.completion_staff_venue_memberships m
      where m.staff_id = s.submitted_by and m.venue_id = s.venue_id
        and m.started_at < private.london_month_end(s.month)
        and (m.ended_at is null or m.ended_at > private.london_month_start(s.month))
    ) and not exists (
      select 1 from public.monthly_targets t
      where t.staff_id = s.submitted_by and t.venue_id = s.venue_id and t.period_month = s.month
        and t.created_at >= private.london_month_start(s.month)
        and t.created_at < private.london_month_end(s.month)
    ) then jsonb_build_object('kind', 'none')
    when s.id = private.knowledge_credited_submission(s.check_id, s.month)
    then jsonb_build_object('kind', 'scored', 'period', to_char(s.month, 'YYYY-MM'))
    else jsonb_build_object('kind', 'not_scored')
  end
  from s
  union all
  select jsonb_build_object('kind', 'none') where not exists (select 1 from s)
  limit 1;
$$;
