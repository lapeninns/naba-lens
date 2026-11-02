-- Withdraws staff-coverage access without losing any evidence or audit.
-- Reverting the UI alone leaves these database capabilities callable, so a
-- rollback runs this script (in one transaction) against the target database.
-- Tables, rows, media, archive and monitoring objects are untouched; re-grant
-- by re-running the grant statements of migrations 20261102130000..150000.
-- tests/migrations/withdraw.test.ts proves it covers every coverage RPC and
-- table and changes nothing else.

revoke execute on function
  public.grant_venue_manager(uuid, uuid, text),
  public.revoke_venue_manager(uuid, text),
  public.coverage_access_scope(),
  public.save_coverage_requirement(uuid, uuid, integer, text, text, text, integer, date, text),
  public.set_coverage_requirement_status(uuid, integer, text, text),
  public.set_coverage_requirement_assignees(uuid, uuid[], text),
  public.set_amenity_fact(uuid, text, integer, text, text, text, boolean, uuid[]),
  public.set_monthly_target(uuid, uuid, date, integer, date, text, integer),
  public.prepare_coverage_month(uuid),
  public.submit_coverage_photos(uuid[], uuid, text, uuid),
  public.attach_coverage_evidence(uuid, uuid[], text, boolean),
  public.review_coverage_item(uuid, integer, text, text, text),
  public.start_menu_coverage_plan(uuid, uuid),
  public.confirm_menu_coverage_plan(uuid, integer),
  public.discard_menu_coverage_plan(uuid, integer),
  public.reconcile_menu_requirement(uuid, uuid, uuid[], text),
  public.coverage_staff_progress(uuid, date, uuid),
  public.coverage_requirement_progress(uuid, boolean),
  public.venue_coverage_summary(uuid),
  public.coverage_group_overview(date),
  public.coverage_items_page(uuid, uuid, text[], uuid, date, timestamptz, uuid, integer, boolean),
  public.task_evidence_asset(uuid),
  public.coverage_candidate_assets(uuid, uuid, timestamptz, uuid, integer),
  public.venue_manager_grant_list(uuid, boolean),
  public.coverage_preparation_status(uuid)
from authenticated;

-- Stops the hourly preparation even if the scheduler keeps calling it.
revoke execute on function public.prepare_coverage_month_scheduled() from service_role;

revoke select on
  public.venue_manager_grants,
  public.coverage_audit_events,
  public.coverage_amenity_templates,
  public.venue_amenity_facts,
  public.venue_amenity_fact_media,
  public.menu_coverage_plans,
  public.coverage_requirements,
  public.coverage_requirement_assignees,
  public.monthly_targets,
  public.coverage_submissions,
  public.coverage_submission_items,
  public.coverage_review_events,
  public.coverage_preparation_runs
from authenticated;
