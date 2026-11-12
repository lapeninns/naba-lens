<!-- Generated from lib/ops by scripts/ops/write-docs.ts. Do not edit by hand. -->

# Switch catalogue

B10-02b. Every NabaLens disable switch, its scope, and what keeps running while it is off. Use the narrowest one that stops harm. A switch marked owner-gated changes production configuration (an environment variable, a schedule or reviewed SQL) and needs the owner's approval (X1) first. External destinations are out of scope and have no switch here.

| ID    | Switch                                          | Scope              | Mechanism    | Owner-gated | Used by                    |
| ----- | ----------------------------------------------- | ------------------ | ------------ | ----------- | -------------------------- |
| SW-01 | Knowledge working list (per venue and question) | venue_and_question | admin_rpc    | no          | RB-04, RB-05, RB-18, RB-19 |
| SW-02 | Internal reader (whole service)                 | feature            | env_var      | yes         | RB-07, RB-12               |
| SW-03 | One internal reader consumer                    | consumer           | env_var      | yes         | RB-07                      |
| SW-04 | Staff Home layout (B02 or B01)                  | venue              | env_var      | yes         | RB-18                      |
| SW-05 | Shared Add entry (B02 or B01)                   | venue              | env_var      | yes         | RB-18                      |
| SW-06 | Manager triage (B02 or B01)                     | feature            | env_var      | yes         | RB-18                      |
| SW-07 | My contributions (B02 or B01)                   | feature            | env_var      | yes         | RB-18                      |
| SW-08 | Cleanup job schedule                            | job                | schedule     | yes         | RB-03, RB-06               |
| SW-09 | Media archive job schedule                      | job                | schedule     | yes         | RB-06, RB-11               |
| SW-10 | Archive watchdog schedule                       | job                | schedule     | yes         | RB-06, RB-11               |
| SW-11 | Monthly coverage preparation schedule           | job                | schedule     | yes         | RB-06                      |
| SW-12 | One staff account                               | account            | app_ui       | no          | RB-13, RB-21               |
| SW-13 | One venue-manager grant                         | account            | app_ui       | no          | RB-21                      |
| SW-14 | Coverage access withdrawal                      | feature            | reviewed_sql | yes         | RB-18                      |

## SW-01 Knowledge working list (per venue and question)

- Turn off: An admin calls public.knowledge_set_working_list(venue, keys, false, reason) for the affected keys.
- Stops: Knowledge sends and adoption on those questions at that venue. The internal reader answers 404 for a venue with no question in scope.
- Keeps running: Every contribution, decision and adopted submission is kept. Staff fall back to the existing amenity list, and non-adopting decisions stay possible.
- Restore: Enable the keys again. Pending disputes come back at once, judged against the answer current then.
- Operator: OPS. Source: `supabase/migrations/20261109145934_knowledge_b01_functions.sql`

## SW-02 Internal reader (whole service)

- Turn off: Set KNOWLEDGE_READER_ENABLED to anything other than true. An environment change in Vercel takes effect on the next deployment.
- Stops: Every internal reader request (the route reports it disabled).
- Keeps running: All capture, review and staff screens. No knowledge data changes.
- Restore: Set KNOWLEDGE_READER_ENABLED=true and redeploy.
- Operator: WS5. Source: `app/api/knowledge/_reader/credentials.ts`

## SW-03 One internal reader consumer

- Turn off: Set "disabled": true on the consumer in KNOWLEDGE_READER_CONSUMERS. An environment change in Vercel takes effect on the next deployment.
- Stops: Reads with that consumer's credentials (401).
- Keeps running: Every other consumer and the whole app.
- Restore: Set disabled back to false, or rotate to a new credential.
- Operator: WS5. Source: `app/api/knowledge/_reader/credentials.ts`

## SW-04 Staff Home layout (B02 or B01)

- Turn off: Add the venue id to NABALENS_HOME_LAYOUT_B01_VENUES, or set NABALENS_HOME_LAYOUT=b01 for everyone. An environment change in Vercel takes effect on the next deployment.
- Stops: The B02 Home (To do) for that venue; the B01 Home shows instead.
- Keeps running: All data and URLs; the same work is reachable from the B01 Home.
- Restore: Remove the venue id, or unset the variable (default b02).
- Operator: OPS. Source: `lib/config/home-layout.ts`

## SW-05 Shared Add entry (B02 or B01)

- Turn off: Add the venue id to NABALENS_CONTRIBUTION_ENTRY_B01_VENUES, or set NABALENS_CONTRIBUTION_ENTRY=b01 for everyone. An environment change in Vercel takes effect on the next deployment.
- Stops: The B02 intent step, context strip and Home's Answer a venue question at that venue.
- Keeps running: The B01 Add sheet and every capture path.
- Restore: Remove the venue id, or unset the variable (default b02).
- Operator: OPS. Source: `lib/config/contribution-entry.ts`

## SW-06 Manager triage (B02 or B01)

- Turn off: Set NABALENS_MANAGER_TRIAGE=b01. An environment change in Vercel takes effect on the next deployment.
- Stops: The Triage card, the To confirm badge and the kind filter on /manager/review.
- Keeps running: The B01 overviews and Review page; every decision path.
- Restore: Unset the variable (default b02).
- Operator: OPS. Source: `lib/config/manager-triage.ts`

## SW-07 My contributions (B02 or B01)

- Turn off: Set NABALENS_MY_CONTRIBUTIONS=b01. An environment change in Vercel takes effect on the next deployment.
- Stops: The My contributions list on Me.
- Keeps running: B01's Your findings list; no contribution changes.
- Restore: Unset the variable (default b02).
- Operator: OPS. Source: `lib/config/my-contributions.ts`

## SW-08 Cleanup job schedule

- Turn off: Remove the /api/internal/cleanup entry from vercel.json crons (a reviewed change and deploy).
- Stops: Hourly abandoned-upload and removed-asset cleanup; M-JB-1 then breaches.
- Keeps running: Uploads and removals in the app; removed assets stay hidden while their bytes wait.
- Restore: Restore the cron entry, or POST the route once with the bearer; a rerun is idempotent.
- Operator: OPS. Source: `vercel.json`

## SW-09 Media archive job schedule

- Turn off: Remove the /api/internal/media-archive entry from vercel.json crons (a reviewed change and deploy).
- Stops: Copying new originals to the archive; the archive checker then reports stale.
- Keeps running: Every app path; originals stay in Storage.
- Restore: Restore the cron entry; the next run copies what was missed. Never delete originals to catch up.
- Operator: OPS. Source: `vercel.json`

## SW-10 Archive watchdog schedule

- Turn off: Remove the /api/internal/archive-monitor/watchdog entry from vercel.json crons (a reviewed change and deploy).
- Stops: The in-app dead-man check of the independent archive monitor; its own state is kept.
- Keeps running: The archive job and the independent checker.
- Restore: Restore the cron entry.
- Operator: OPS. Source: `vercel.json`

## SW-11 Monthly coverage preparation schedule

- Turn off: Remove the /api/internal/coverage/monthly-preparation entry from vercel.json crons (a reviewed change and deploy).
- Stops: Hourly copying of targets and checklist candidates into the new month.
- Keeps running: Existing targets and credit; managers and admins can still run Prepare this month.
- Restore: Restore the cron entry, or use Prepare this month for all venues; a rerun never duplicates targets.
- Operator: OPS. Source: `vercel.json`

## SW-12 One staff account

- Turn off: A different active admin uses Deactivate in Staff (/admin/staff) and confirms it in the named-person dialog.
- Stops: Every new protected operation for that account, including from an open session; ends its venue-manager grant and closes its open coverage assignments.
- Keeps running: The account's media and history, readable by authorised admins and the venue's manager.
- Restore: Reactivate in Staff once the cause is resolved. A manager grant is not restored: grant it again if still right.
- Operator: OPS. Source: `lib/server/accounts/manage.ts`

## SW-13 One venue-manager grant

- Turn off: An admin revokes the grant under Coverage, Venue managers, with a reason (public.revoke_venue_manager).
- Stops: That staff member's manager tools at that venue (review, To confirm, targets).
- Keeps running: Their staff access, their history, and every decision they made.
- Restore: Grant it again with a reason.
- Operator: OPS. Source: `supabase/migrations/20261102130000_venue_manager_grants.sql`

## SW-14 Coverage access withdrawal

- Turn off: Rehearse with node tests/migrations/run.mjs <stack> withdraw, then an authorised operator runs tests/migrations/coverage-withdraw-access.sql in one transaction and the schedule is removed (docs/operations.md, Withdrawing coverage access).
- Stops: Signed-in access to every coverage function and table, and the scheduled preparation.
- Keeps running: Targets, photos sent, decisions, audit events, media, archive and monitoring are kept.
- Restore: Re-run the grant statements of migrations 20261102130000 to 20261102150000 as a reviewed change.
- Operator: OPS. Source: `tests/migrations/coverage-withdraw-access.sql`

## One-way settings (not switches)

- Amenities enabled for a venue (venue_amenity_settings): The table is append-only (a trigger refuses update and delete), so enabling is permanent. Use SW-01 to narrow knowledge questions instead.
