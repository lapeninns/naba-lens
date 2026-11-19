# Factory Droid: mandatory staff portfolios and venue photo coverage

Prepared 1 November 2026, Europe/London. This is the owner's final accepted
workstream plan and implementation handoff. It supersedes the earlier social
roadmap and `organization-social-factory-droid.md` draft.

Execution-surface correction: the owner explicitly wants a Factory **Workstream**,
not Mission mode. The mistakenly started Mission session
`710c6ccf-6cc7-4c6f-aa18-5745a3b92b62` / `mis_31289b7e` was interrupted before
implementation; do not resume it. Its read-only investigation is retained in
`/private/tmp/nabalens-coverage-factory-dispatch.jsonl` and can inform the
Workstream. A real Workstream must be created through Factory's Workstreams UI.

## Execution instruction

Implement this plan from the existing dirty worktree. Coordinate bounded
workstreams, preserve existing changes, validate the result, and prepare one
reviewed bundled PR. Continue through all permitted local implementation and
verification work. Do not expand into unrelated social features. Do not deploy,
merge, apply hosted migrations, or modify real staff/venue data without separate
specific authorization. Report any provider/permission blockers accurately.

## 1. Objective and confirmed decisions

Build a private Lapen Inns platform where every active staff member maintains a
portfolio and meets a monthly photo contribution target, while each venue has
reviewed menu-section, service and amenity coverage.

The app must answer: what each person needs to contribute; what each venue is
missing; what awaits manager review; and where follow-up is needed.

| Area | Required behavior |
| --- | --- |
| Organization | One parent organization using existing configured venues. |
| Staff | Every active staff member has a portfolio and manager-assigned monthly target. |
| Menu | A manager-defined set of photos per required menu section, not a photo-per-dish completion rule. |
| Counts | Managers set staff and section counts; no arbitrary global target. |
| Monthly credit | New photos uploaded and submitted that month count once accepted. |
| Rollover | Copy previous manager-set staff targets; flag new staff/missing settings for setup. |
| Older photos | May satisfy ongoing venue coverage after review; cannot satisfy a new monthly staff target. |
| Sharing | Ready photos appear in portfolio/Explore immediately; acceptance governs completion only. |
| Review | Venue managers review their venue; organization admins oversee all venues. |
| Self-review | Managers MAY accept their own photos; record self-review for admin oversight. This is an explicit owner choice. |
| Manager powers | Targets, assignments, checklists and reviews; admins retain account/menu/grant management. |
| Overdue | Display for follow-up; keep uploading/task completion available. |
| Amenities | Common template, confirmed per venue by its manager. |
| Time | Europe/London calendar periods, deadlines and user-facing dates. |

Defer reactions, comments, follows, announcements, messaging, richer social posts,
leaderboards and automated employee scoring.

## 2. Source and engineering context

- Worktree: `/Users/amankumarshrestha/.codex/worktrees/organization-social/nabalens`
- Branch: `codex/organization-social`
- Base HEAD: `2ae4577cc309f652608345576b677ca4e63625d6` (PR #13 merge).
- Existing work is uncommitted edits plus untracked files. Do not reset/clean or
  replace with the older main checkout. Inspect the complete dirty change first.
- Existing foundation: portfolios/upload/media pipeline, versioned venue menus,
  optional item labels, admin account management, FOH/BOH assignment, and local
  Explore/People/colleague-portfolio browsing.
- Missing: assignments, monthly targets, review, manager grants, amenities and
  coverage dashboards. Earlier specs exclude some of these; update them to this
  explicitly accepted scope.
- Roles remain `staff`/`admin`; one current venue and optional FOH/BOH per staff.
  Media venue is its immutable upload-time venue.
- Menu sections are version-specific and IDs can be regenerated on draft save.
  Never use section UUID/name/slug as durable cross-version identity. Item and
  variant IDs are stable, but menu-item label counts are not completion counts.
- Reuse one media asset for portfolio, community and coverage evidence. Do not
  add a second storage/upload pipeline. Upload readiness is separate from review.
- Read user/repository AGENTS instructions and relevant installed
  `node_modules/next/dist/docs/` before editing Next.js code. Prior checks used
  Node 24.16.0 and pnpm 10.30.1.

Previous foundation proof (not proof of new task features): typecheck/lint passed;
666 unit/UI tests; 215 integration passed/12 skipped; 292 security passed; focused
e2e 3/3. Required Turbopack build hit CSS-worker local-port EPERM; complementary
webpack build/bundle scan passed. Resolve the required gate in an appropriate
environment; do not represent the complementary build as the required pass.

Evidence: `/private/tmp/nabalens-social-verification-{typecheck,lint-final,unit-elevated,build-final,build-webpack,bundle}.log`
and `/private/tmp/nl-community-e2e/.e2e-community-verified/report.json`.

## 3. Staff, monthly targets and venue coverage

### Staff flow

Make **My tasks** the staff landing experience; retain My portfolio, Explore and
People. Show profile setup, this month's accepted/target count, assignments,
pending review, replacement reasons, due dates and overdue work.

Flow: open task -> capture/select -> existing upload pipeline -> submit ready
photos -> review result. Staff may attach their own ready same-venue photos.
Existing upload batch/size limits apply.

Profile setup requires name, assigned venue and FOH/BOH. Personal profile image
is optional. Missing target/team shows Needs setup and never means complete.

### Monthly participation

- One target per staff member + venue + London calendar month; positive integer
  target set by manager. Part-time/joiner targets are manager-configured.
- Default due date: end of London calendar month. Manager may set an earlier
  deadline within it. Current-month edits require a recorded reason; historical
  corrections are admin-only and audited.
- Credit requires original uploader = target staff, ready undeleted image,
  upload-time venue = target venue, upload AND submission during that month,
  and reviewer acceptance. Videos do not count toward photo targets in v1.
- Count distinct assets once. Labels, retries, resubmission and duplicate review
  never add credit. Attaching someone else's photo never transfers authorship.
- Submission month fixes the period. Later review credits the original month
  and shows late acceptance when applicable; no backdated later-month uploads.
- During current month, deleted/invalid evidence stops counting. Past-month
  reports retain accepted contribution history and show evidence-removed flags.

### Ongoing coverage

Coverage persists across months. Each requirement stores venue, subject, photo
target, guidance, deadline, applicability/retirement, assignees and evidence.
Multiple named staff may share one requirement and its aggregate target. FOH/BOH
suggest assignments but never grant security permissions.

One accepted photo may count once for its author's eligible monthly target and
one current coverage requirement. Historical associations remain when replaced.
Managers may attach existing ready photos of active colleagues in their venue
for coverage review; admins may attach retained inactive contributors' evidence.

### Menu sections

Generate draft requirements from a manager-confirmed active menu version. The
manager sets selected sections, required counts, guidance, assignees and dates.
Completion counts distinct accepted photos, not labelled dishes/variants.
Existing optional dish labels remain optional. Manager checks relevance,
clarity, presentation and variety; no automated image scoring.

New active menu -> visible Menu changed—review coverage. Preserve old plan and
history. Manager explicitly reconciles old evidence to replacement requirements.
Do not map automatically by name, slug or section ID. New requirements need setup;
venue cannot show fully current menu coverage while reconciliation is pending.

### Venue/services/amenities

Provide candidate template entries: exterior/signage, entrance, bar/dining/service
areas, toilets, access features/routes, accessible toilet where present, outdoor
seating/garden, parking, dog-related facilities/policy, family facilities, and
venue-specific additions. These are candidate requirements, not venue claims.

Entries start unconfirmed. Manager confirms applicability and photo target (one
as editable starting suggestion), guidance and assignees. Record facts/policy,
present/absent/unknown, confirmer/date and supporting media separately. Unknown
stays Needs verification. Exclusions/non-applicability require reasons, remain
visible, and are excluded from applicable denominator. Photos never automatically
establish accessibility or dog-friendly claims.

### Review/lifecycle

Per-photo states: To do -> Submitted -> Accepted or Needs another photo. Requesting
replacement requires a reason. Decisions record actor/time/revision/self-review;
concurrent stale review returns conflict rather than overwriting.

Processing/failed photos cannot count. Deletion/invalidation reopens current venue
coverage. Replacement preserves history. Transfer blocks new old-venue submissions
while preserving past venue/credit. Deactivation ends access, closes outstanding
personal assignments with a reason and exposes coverage reassignment needs.
Accepted venue evidence remains available to authorized reviewers after departure;
ordinary community retains its active-staff visibility rule. Existing signed URLs
may last to expiry, saved copies cannot be recalled, and archive policy stays intact.

## 4. Permissions and minimum interfaces

Keep staff/admin roles; add admin-managed venue-manager grants for current staff.
Effective grant requires active staff, matching current venue, active venue and
unrevoked grant. Transfers never auto-grant destination access. Recheck current
scope inside every mutation/read boundary; do not infer from JWT metadata/title/team.

Manager tools: `/staff/manage`; organization oversight: `/admin/coverage`.
Manager can configure requirements/targets/applicability/facts, assign, view queue
and review own venue including self. Admin can do all venues and manage grants.
Staff see own work/target and submit; cannot review or edit assignments/targets.
Manager status adds no account invitation/deactivation, role/venue/team management,
menu publication, original download or colleague-deletion rights.

Use narrow operational roster projections (name/avatar/team/progress), not admin
account DTOs with emails/auth data. Add scoped task-evidence preview for ready,
undeleted assets attached to authorized same-venue submissions, including retained
inactive-uploader evidence. Preserve private/no-store, 60-second cap and no direct
Storage read/signing. Do not broaden ordinary community or original downloads.

Minimum concepts: manager grants; coverage requirements; assignments; monthly
targets; submissions referencing existing assets; review/audit events; amenity facts;
menu coverage revision with version/section references and display snapshots.
Database constraints enforce venue consistency; counts derive from distinct eligible
assets and acceptance. One DB worker owns all migrations and generated types.

Typed services: own tasks/progress; venue coverage/targets/queue; requirement,
assignment,target,applicability configuration; submit/review; grant/revoke;
menu reconciliation; group overview. Derive actor from auth, apply RLS plus
transactional authorisation, idempotent retries and revision conflict handling.

Monthly preparation is one idempotent operation callable by an authenticated hourly
scheduled handler and explicit manager/admin action. Compute London current month,
store UTC instants, copy latest same-venue configured target, flag missing setup,
and never copy old-venue targets after transfers. Repeated/concurrent execution
must not duplicate targets. Surface missing periods/preparation failure in oversight.

## 5. Workstreams and ownership

One coordinator owns integration, shared auth/navigation wiring, final evidence and
scope. Workers must preserve concurrent edits. Freeze typed contracts before UI
work runs in parallel. Do not independently overwrite migrations or generated types.

| Workstream | Deliverable | Dependency |
| --- | --- | --- |
| WS0 foundation | Inspect/preserve dirty source, resolve required build gate, reconcile scope docs, freeze contract. | none |
| WS1 DB/permissions | All SQL/types, manager grants/policies, requirements/targets/submissions/audit/count invariants. | WS0 |
| WS2 services/schedule | Server coverage services, rollover, menu reconciliation, scoped evidence, typed contracts; SQL via WS1 owner. | WS1 contract |
| WS3 staff UI | My tasks, progress, capture/attach/submit, replacement/retry and navigation. | WS2 contract |
| WS4 manager/admin UI | Checklist setup, assignments/targets/queue, self-review audit, amenities, reconciliation, oversight. | WS2 contract |
| WS5 verification | Independent acceptance/security/database/browser/physical-device proof and defect reports. | incremental WS1–4 |
| WS6 integration/release | Fixes, docs, one bundled PR, final lci and concrete authorized release/pilot preparation. | all required acceptance |

## 6. Required verification

Load `/Users/amankumarshrestha/.codex/skills/qa-with-e2e/SKILL.md` for every QA,
regression/journey request. Execute applicable e2e runner journeys alongside repo
checks; inspect reports/screenshots. Run typecheck, lint, unit/UI, required build,
bundle scan, DB integration, security and browser journeys. Prior proof does not
certify this new functionality.

Use only disposable fixtures and owned stacks on unused ports. Never reset/stop
or reuse shared stacks for destructive tests. Pin API, SQL DB, JWT and local inbox
to the same owned target. Keep the existing fail-closed auth-harness safeguard.
Do not print credentials or include them in artifacts. Use
`PLAYWRIGHT_SKIP_BROWSER_GC=1` to avoid deleting other cached browsers.

Acceptance cases:
- Two distinct accepted photos = 2 credits; duplicate submit/review/labels = no inflation.
- London month-end/BST/GMT, late reviews and cross-boundary uploads follow exact rules.
- Concurrent rollover is unique; targets copy; missing setup never means complete.
- Menu section completes by accepted photo count without mandatory per-dish coverage.
- Old evidence counts coverage, not a new monthly target.
- Wrong-venue resource/asset IDs fail through pages/actions/RPCs.
- Managers manage own venue only; revoke/transfer/deactivation acts on existing sessions.
- Self-review works, is recorded and visible to admins.
- Conflicting reviews are detected; retries do not duplicate events/credit.
- Nonready/deleted media cannot count; current coverage reopens and history remains auditable.
- New menu IDs require reconciliation, never silent name mapping.
- Unknown amenities block confirmation; explicit exclusions have reasons/proper denominator.
- Ready photos share before acceptance; no unintended publishing gate.
- Mobile staff flow, replacement/resubmit and progress are functional.
- No account-email/auth details, original downloads or colleague-deletion permission leaks.
- Interrupted uploads/submits, expired preview URLs and stale review recover correctly.

Cover staff/manager/admin browser roles and mobile permission states. Verify actual
video playback and physical-phone uploads as outstanding foundation checks, while
photo targets remain image-only. Record unavailable physical devices honestly.

Venue completion requires all applicable requirements satisfied and current menu
reconciliation complete. Staff monthly completion requires valid setup plus accepted
eligible photo target. Report participation separately from venue coverage.

## 7. PR, migrations, release and completion

One PR per repo for this work. Iterate with own checks. Rebase on latest default,
then run actual `~/.local/bin/lci run <discovered-profile> --pr N --post --comment`
once on final head. Discover profile, never bypass checks/--no-codex/admin merge,
copy lci, edit profiles to skip gates, or rerun CI after merge. No lci has run for
this branch yet. Git push/PR operations still follow available runtime permissions.

Existing pending local-only migrations: `20261102110000_staff_departments.sql`,
then `20261102120000_organization_community.sql`. Add new migrations afterward:
manager auth -> domain records/policies -> task procedures/reporting. Nothing
applies migrations automatically. Only in separately authorized release verify exact
target/all earlier pending migrations, apply in order, independently verify outcome
and compatibility, then deploy dependent code. Never seed hosted development fixtures.

Prepare two owner-confirmed pilot venues with real FOH/BOH staff, manager grants,
confirmed menu/amenities and explicit targets. Do not invent pilot names/data. The
handoff authorizes local implementation/verification/release preparation, not an
unspecified production deployment, merge, hosted migration or real-data mutation.

Rollback must preserve evidence/audit, stop scheduler if needed, and explicitly
revoke new DB capabilities/RPCs when withdrawing access; reverting UI alone does
not revoke database permissions. Do not undo archive/monitoring infrastructure.

Final delivery: implemented behavior/blockers; PR/commit/review status; exact tests,
skips/artifacts; migration target/outcome if authorized; deployed revision/live checks
if authorized; pilot readiness/configuration gaps. Keep those facts separate.

Earlier auth-harness incident: isolated API settings once fell back to shared local
SQL. Two generated expiry-test IDs matched no shared users (verified read-only);
no hosted DB involved. Final corrected runs pinned SUPABASE_DB_URL,
SUPABASE_JWT_SECRET, NABALENS_TEST_DB_URL and MAILPIT_URL plus API/key settings.
Preserve 13 guard tests and API/DB consistency checks. Prior owned test stack
`/private/tmp/nl-community-5jhcFj` and app port 63310 are stopped; rediscover ports.
