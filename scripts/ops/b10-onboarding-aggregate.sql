-- B10-03c aggregate read: one JSON row per active venue for the onboarding
-- records. Counts, question keys and dates only: no names, emails, free text,
-- media paths or Wi-Fi data. Each row matches VenueAggregate in
-- lib/ops/onboarding.ts, and `b10-records.ts apply-aggregate` refuses any
-- other shape.
--
-- Read-only: it runs inside a read-only transaction that is rolled back.
-- Run it first on an owned isolated stack. On production it needs the
-- owner's approval (b10-design §14.6: an owner-approved read-only query run
-- by the coordinator), as a role that can read private.* (for example the
-- postgres role in the SQL editor), never through the Data API.
--
--   psql "$DB" -X -q -t -A -f scripts/ops/b10-onboarding-aggregate.sql > aggregate.json

begin transaction read only;

with month as (
  select date_trunc('month', (now() at time zone 'Europe/London'))::date as start
)
select coalesce(jsonb_agg(row_json order by slug), '[]'::jsonb)
from (
  select
    v.slug,
    jsonb_build_object(
      'venueId', v.id,
      'active', v.active,
      'managerAccounts', (
        select count(*) from public.profiles p
        where p.venue_id = v.id and p.active and p.role = 'manager'
      ),
      'staff', jsonb_build_object(
        'foh', (select count(*) from public.profiles p
                where p.venue_id = v.id and p.active and p.role = 'staff'
                  and p.department = 'foh'),
        'boh', (select count(*) from public.profiles p
                where p.venue_id = v.id and p.active and p.role = 'staff'
                  and p.department = 'boh'),
        'unassigned', (select count(*) from public.profiles p
                       where p.venue_id = v.id and p.active and p.role = 'staff'
                         and p.department is null)
      ),
      'staffWithLegacyGrant', (
        select count(distinct g.staff_id)
        from public.venue_manager_grants g
        join public.profiles p on p.id = g.staff_id
        where g.venue_id = v.id and g.revoked_at is null
          and p.active and p.role = 'staff'
      ),
      'amenitiesEnabledOn', (
        select to_char(s.enabled_at at time zone 'Europe/London', 'YYYY-MM-DD')
        from public.venue_amenity_settings s where s.venue_id = v.id
      ),
      'amenityChecks', coalesce((
        select jsonb_object_agg(progress, n)
        from (select c.progress, count(*) as n
              from public.venue_amenity_checks c
              where c.venue_id = v.id and c.status = 'active'
              group by c.progress) x
      ), '{}'::jsonb),
      'workingListKeys', coalesce((
        select jsonb_agg(w.question_key order by w.question_key)
        from public.knowledge_working_list w
        where w.venue_id = v.id and w.disabled_at is null
      ), '[]'::jsonb),
      'activeMenuVersions', (
        select count(*) from public.menu_versions m
        where m.venue_id = v.id and m.status = 'active'
      ),
      'activeMenuActivatedOn', (
        select to_char(max(m.activated_at) at time zone 'Europe/London', 'YYYY-MM-DD')
        from public.menu_versions m
        where m.venue_id = v.id and m.status = 'active'
      ),
      'coverageRequirements', coalesce((
        select jsonb_object_agg(status, n)
        from (select r.status, count(*) as n
              from public.coverage_requirements r
              where r.venue_id = v.id
              group by r.status) x
      ), '{}'::jsonb),
      'venueMonthlyTarget', (
        select t.target_count
        from private.venue_monthly_completion_targets t, month
        where t.venue_id = v.id and t.starts_on <= month.start
        order by t.starts_on desc
        limit 1
      ),
      'staffTargetsThisMonth', jsonb_build_object(
        'set', (select count(*) from public.monthly_targets mt, month
                where mt.venue_id = v.id and mt.period_month = month.start
                  and mt.target_count is not null),
        'needsSetup', (select count(*) from public.monthly_targets mt, month
                       where mt.venue_id = v.id and mt.period_month = month.start
                         and mt.target_count is null)
      ),
      'londonMonth', (select to_char(month.start, 'YYYY-MM') from month)
    ) as row_json
  from public.venues v
  where v.active
) rows;

rollback;
