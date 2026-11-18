# S1-OPS worker report

Final report from the T3 worker, kept verbatim as the hand-off record (branch `fa/s1-ops`, merged into `feat/full-app-v1`).

# S1-OPS report: audit, notifications, settings and ops

S1-OPS is built and committed on `fa/s1-ops` in 8 commits, with a clean tree. Typecheck, lint, Prettier, the unit suite and the full security suite all pass. Nothing was pushed, deployed or run on a hosted project, and the isolated stack is stopped.

**Gaps:**

- Notification inbox: there is no staff or manager screen for it yet. That is Sprint 2 work.
- **AC38:** the hosted restore rehearsal still needs the owner's approval. Only the written procedure is done.
- **Category aliases:** not built.
- **Shot templates:** admin editing is not built.

## Checklist results

| ID                            | Result                      | Notes                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A7-activity-log               | **Built**                   | New `activity_events` table. `admin_activity` shows it together with all 12 existing history tables, with filters and paging. New triggers record account deactivation, reactivation, role and venue changes, and removal of finished uploads. `/admin/activity` page.                                                          |
| S11-audit-notification-job    | **Built**                   | Notifications record state, attempts, version and timestamps. A new `ops_job_runs` table records job runs; its state is running, succeeded or failed.                                                                                                                                                                           |
| S17-inapp-staff               | **Built (data and server)** | Staff get a notice when a retake is asked for (menu, checklist or area photo), when a check is assigned to them, when an upload fails, and when their labels can't be applied. The notice resolves itself once the problem is fixed. No staff inbox screen yet.                                                                 |
| S17-manager-queue             | **Built**                   | Hourly job sends each venue manager a digest of photos waiting for review and checks past due. It is sent at most once per reminder period and never during quiet hours.                                                                                                                                                        |
| S17-admin-exceptions          | **Built**                   | Admins are told about: storage near the quota, stuck or repeated processing failures, a failed job, failed archive or preparation runs, a long review backlog, and venue setup gaps. Notices resolve when the problem clears; the same list is shown on Settings.                                                               |
| S17-quiet-hours               | **Built**                   | Default 21:00–08:00 in each venue's timezone, changeable in Settings. Each person can set their own.                                                                                                                                                                                                                            |
| S17-dedupe                    | **Built**                   | Each notice has a unique key per person. A new one isn't written while the same kind of notice about the same thing is still unread.                                                                                                                                                                                            |
| S17-toast-conflict            | **Built**                   | Notices are an inbox list and badges, never toasts.                                                                                                                                                                                                                                                                             |
| S5-notification-prefs         | **Partly built**            | Database and server functions exist (on/off per kind, personal quiet hours). The toggles on Me are a Sprint 2 job; push is Release 2.                                                                                                                                                                                           |
| A7-limits-reminders-retention | **Built**                   | Settings covers quiet hours, reminder cadence, backlog threshold, orphan window, allowed export profiles, storage quota and alert level. Each save needs the current version number and a reason, and is logged in Activity. Media limits are shown read-only because they live in `lib/config/media.ts`, which S1-UPLOAD owns. |
| A7-ops-monitoring             | **Built**                   | Settings shows storage against the quota, stuck and failed processing, the archive check, preparation failures, each job's runs, and the last restore rehearsal.                                                                                                                                                                |
| S16-monitoring-capacity       | **Built (in-app)**          | The storage alert goes to admins in the app and never deletes anything. It does not email through the archive-monitor alert sink.                                                                                                                                                                                               |
| S16-orphan-cleanup            | **Built**                   | Scheduled cleanup now uses the Settings window (default 7 days); if the setting can't be read it falls back to 7 days, never less. The cron was already in `vercel.json`. Finished uploads, and so anything labelled or accepted, are never removed. Each run is recorded.                                                      |
| A7-integrations-secrets       | **Built**                   | Integrations show only "Set up" or "Not set up", never a value. The watchdog email recipient can now be set with `ARCHIVE_WATCHDOG_EMAIL_TO`; the old hard-coded address is the fallback.                                                                                                                                       |
| S16-backup-recovery / AC38    | **Partly built**            | The hosted rehearsal procedure is written in `docs/backup-restore.md` §3, and Settings shows the last recorded rehearsal. The rehearsal itself has not been run.                                                                                                                                                                |
| S13-error-taxonomy            | **Partly built**            | One shared error shape in `lib/server/http/errors.ts`: it names the field or file, says what to do next, and marks only service failures as retryable. It has its own tests. My code uses it; the older domains are not moved onto it yet.                                                                                      |
| S9.1-technical-vs-editorial   | **Partly built**            | Processing failures are counted separately from editorial retakes in monitoring. Separate counts in the metrics belong to S2-METRICS.                                                                                                                                                                                           |
| A7-shot-templates             | **Not built**               | Managers already edit briefs. Admin default templates would need a fallback in album reads, which S1-COV owns.                                                                                                                                                                                                                  |
| A7-categories-aliases         | **Partly built**            | The five fixed categories are shown on Settings. Item aliases are not built; they belong with menu identity (S1-MENUS) and label search (S2-ADD).                                                                                                                                                                               |

## Assumptions I made

- **In-app notices appear immediately, even during quiet hours.** Quiet hours hold back scheduled digests and set when a future push or email could be sent. My reading is that a person opening the app isn't being disturbed.
- **When processing counts as an exception:** any upload stuck in processing for over 30 minutes, or 5 or more failed uploads in a day.
- **Storage used is the sum of the originals' sizes.** The default quota is 100 GB with an alert at 80%.
- **Digest recipients:** managers of a venue are found with the existing `private.effective_manager_venue_id`. If S1-PEOPLE's per-venue memberships change that function, digests follow it.
- **Admin navigation:** I added one "Settings" item to the admin bar; Activity is reached from Settings.

## Migrations added (`20261118106000`–`106300`)

- `106000_ops_activity.sql`: the activity table and log, the account and media triggers, and `private.record_activity`.
- `106100_ops_settings.sql`: organisation settings and personal notification preferences.
- `106200_ops_notifications.sql`: the notifications table, quiet-hours helpers, `private.notify` and `private.notification_resolve`, six triggers, and the inbox functions. If a notice can't be written, `private.notify` logs a warning and the decision that caused it still saves.
- `106300_ops_monitoring.sql`: the job-runs table, `ops_status`, the exceptions list, and the hourly notification job.

All four applied in order on a fresh reset of my own stack (port 587xx). They are additive and don't depend on any other worker's migrations.

## Files changed

- **Mine:**
  - `app/admin/settings/**`, `app/admin/activity/**`, `app/api/internal/notifications/route.ts`
  - `lib/server/{audit,notifications,ops}/**` (`lib/server/ops` is a new folder), `lib/ops/*`, `lib/server/http/errors.ts`
  - tests: `tests/security/ops.test.ts`, `tests/unit/{ops-models,ops-server,http-errors,notifications-route}.test.ts`, `tests/ui/admin-settings.test.tsx`
- **Outside my ownership, kept small:**
  - `components/nabalens/app-shell.tsx`: adds the Settings nav item.
  - `lib/server/lifecycle/{index,cleanup}.ts`: the orphan window option and job recording. The default for direct calls is still 24 hours, so existing tests are unaffected.
  - `lib/server/archive-monitor.ts`: the configurable watchdog recipient.
  - `vercel.json`: an hourly cron for `/api/internal/notifications`.
  - `lib/db/types.ts`: my additions only.
  - Docs: `cleanup.md`, `backup-restore.md`, `design-system/catalogue.md`.
  - Tests: `tests/ui/app-shell.test.tsx` (now expects the Settings item).
  - `tests/unit/scope-guard.test.ts`: the old v0.2 ban on "notifications" now bans only push; the new routes are added to the allow-list. **S1-EXPORT will hit the same guard's ZIP ban.**

## Checks

- `pnpm typecheck`: clean, no errors.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0.
- Prettier `--check` on changed files: "All matched files use Prettier code style!"
- `pnpm test`: 365 files, 4601 tests passed.
- `pnpm test:security` on my stack: 77 files, 1173 tests passed. That run was before the final `notify` hardening.
- After that hardening: `ops.test.ts` passed 27/27, and the area photo, checklist decision, amenity, hardening and menu photo security tests passed 154/154. I did not rerun the full security suite.
- Not run: `lci` and `verify:release` (coordinator only), and browser e2e.

## What Sprint 2 workers need to know

- **Staff inbox and badge (S2-STAFF), manager badge (S2-MGR):** use `loadInbox`, `unreadCount`, `markRead`, `loadPreferences` and `savePreferences` from `lib/server/notifications`, and the words from `notificationWords` in `lib/ops/notifications.ts`.
  - Kinds: `retake_requested`, `assigned`, `upload_problem`, `review_digest`, `exception`.
  - States: `unread`, `read`, `resolved`.
- **Requests and shot lists (S2-REQ):** inside your SQL, call `private.notify(recipient, venue, 'assigned', subject_type, subject_id, dedupe_key, payload)` when a request names a person.
- **Exports (S1-EXPORT):** record failed packages with the service role: `public.ops_record_job_run('export', 'failed', …, p_error_code)`. Read the allowed profiles from `ops_settings().exportProfiles`.
- **Any important change:** log it from SQL with `private.record_activity(venue, action, object_type, object_id, old_rev, new_rev, reason, before, after)`. Actions must match `^[a-z][a-z_]{0,59}$`.
- **Errors:** the shared shape is `apiError`, `fromDbError`, `toApiError` and `errorResponse` from `lib/server/http/errors.ts`.
