# Factory Droid handoff: finish the minimal Lapen Inns community

> **Superseded draft — do not dispatch.** On 1 November 2026 the owner clarified
> that the next step is to plan mandatory staff portfolios and comprehensive
> menu and venue-amenity photo coverage. The scope below predates that direction.

Prepared 1 November 2026, Europe/London. The owner's latest correction is to keep
this **minimal**. This supersedes the broader social-media roadmap for this
handoff. Finish the existing browsing feature; do not expand the product.

## Minimum scope

Lapen Inns staff should be able to discover colleagues and browse their ready
photos/videos across the organization's existing venues:

- **Explore** (`/staff/community`): shared media, venue/FOH/BOH/media-type filters,
  contributor attribution and pagination.
- **People** (`/staff/people`): colleague search and venue/team filters.
- **Colleague portfolios** (`/staff/people/[id]`): safe profile information and
  ready media; keep **My portfolio** as the person's existing upload workspace.
- Admin assignment of FOH/BOH on invite/edit; existing people stay Unassigned
  until assigned. Do not invent venues, staff or department assignments.

Explicitly defer posts, captions, richer profiles, reactions/likes, comments,
follows, announcements, notifications, saved items, collections, messaging,
manager roles, public pages and other roadmap features. Add no product extras
unless the owner expressly chooses them.

## Continue existing work

- Worktree: `/Users/amankumarshrestha/.codex/worktrees/organization-social/nabalens`
- Branch: `codex/organization-social`
- Base HEAD: `2ae4577cc309f652608345576b677ca4e63625d6` (PR #13 merge).
- Implementation is **uncommitted edits and untracked files**. Preserve it; do
  not reset/clean or replace it with the older unrelated checkout.
- Source, guides and migration details: `docs/community.md`,
  `docs/usage-staff.md`, `docs/usage-admin.md`, `lib/server/community/index.ts`,
  `lib/server/media/access.ts`, `lib/server/media/profile.ts` and new staff routes.
- Staging/test copy: `/private/tmp/nabalens-organization-social`. Final source
  was compared equal to the worktree before this documentation-only revision.
- Checks used Node 24.16.0 and pnpm 10.30.1. Read current `AGENTS.md` and relevant
  installed `node_modules/next/dist/docs/` before changing Next.js code.

## Preserve the implemented boundaries

Community shows ready, nondeleted media from active staff. Raw profile rows
remain own/admin-only; safe colleague fields exclude email, account state and
sign-in history. Staff cannot edit/delete colleagues' work, edit their labels or
use the admin original-download route. Direct Storage reads/signing remain
denied; short-lived media/avatar URLs retain the existing 60-second limit.

Deactivation currently hides the person's work from peers while admins retain
archival access. Keep that policy for this minimum release. Current department
and venue describe the person; each media item retains its upload-time venue.
Existing bearer URLs can survive until expiry; downloaded copies cannot be
recalled. Preserve owner/admin write permissions and archive/retention behavior.

## Finish and validate

1. Inspect the whole dirty change, resolve the normal build gate, and reconcile
   stale own-only/social-exclusion statements in release/spec/acceptance docs
   with this limited browsing scope. Preserve other unrelated work.
2. Verify real sign-in, actual video playback, physical-phone uploads, responsive
   browsing and admin FOH/BOH assignment; these were not all certified previously.
3. Confirm active staff can discover another venue's colleague and view ready
   photo/video media. Test anonymous/inactive users, deactivation with an existing
   session, unfinished/deleted media, profile privacy and forbidden management
   actions at server/database boundaries.
4. Prepare one reviewed bundled PR. Rebase on latest default branch, then run
   the real `~/.local/bin/lci run <profile> --pr N --post --comment` once on final
   head. Discover the profile; do not invent it, skip gates or use admin merge.
   No lci run has occurred for this branch. Do not rerun CI after merge.
5. Prepare a concrete release/pilot with owner-confirmed staff/venues. Do not
   claim production completion from local checks or assume authorization for
   unspecified production data changes or deployment.

For QA/regression/journey work load
`/Users/amankumarshrestha/.codex/skills/qa-with-e2e/SKILL.md`; execute applicable
e2e runner journeys alongside repository gates and inspect reports/screenshots.
Record actual coverage, failures, skips and unavailable prerequisites.

## Migration and release requirements

These migrations were applied only to the disposable local test stack, **not to
production by this work**:

1. `20261102110000_staff_departments.sql`
2. `20261102120000_organization_community.sql`

Nothing applies Naba-Lens migrations automatically. In the authorized release
sequence verify the exact target, apply earlier pending migrations in order,
apply these before dependent code, and independently verify compatibility and
outcome. Rolling back application code alone does not revoke the new database
read policy. Do not change real staff/venue data just to populate the feature.

## Evidence already obtained

- Typecheck/lint passed; unit/UI suite: **666 tests passed** in 67 files.
- Final isolated integration: **215 passed, 12 skipped**; security: **292 passed**.
- Focused e2e runner: **3/3 passed**, including real agent act/assert. Covered
  cross-venue discovery, filters, 24→25 pagination, loaded image preview, 390px
  mobile no-overflow and signed-out redirects. Video, physical phones, real
  email delivery and admin department interaction remain unproven.
- Required `pnpm build`/Turbopack failed: CSS worker local-port bind `EPERM`.
  Complementary `next build --webpack` and its bundle scan passed. Do not report
  the required build gate as passed. Existing libheif-js warnings remained.
- Logs: `/private/tmp/nabalens-social-verification-{typecheck,lint-final,unit-elevated,build-final,build-webpack,bundle}.log`.
- Browser report: `/private/tmp/nl-community-e2e/.e2e-community-verified/report.json`.
  Screenshots: `/private/tmp/nabalens-community-{desktop,mobile,preview}.png`.
- Temporary e2e 0.15.1 / @e2e-dev/web 0.11.1 worked around a home-runner version
  incompatibility. Use `PLAYWRIGHT_SKIP_BROWSER_GC=1`; first installation removed
  older shared browser-cache entries, so other tests may need reinstalling them.

## Isolated database safety

Never reset/stop/reuse shared local stacks for destructive tests; they retain
fixtures/uploads. Follow `docs/setup.md` to create a uniquely named owned stack
on unused ports. The prior owned `/private/tmp/nl-community-5jhcFj` stack and app
on 63310 are stopped. Rediscover ownership/ports; keep credentials out of source,
logs, reports and handoffs. Never seed development fixtures into hosted data.

Earlier auth tests mixed the isolated API with default CLI SQL discovery. Two
expiry updates targeted generated fixture IDs in the shared local DB; read-only
checks proved neither ID existed there, so they matched no shared users. No
hosted DB was involved. The corrected final run pinned API/key settings plus
`SUPABASE_DB_URL`, `SUPABASE_JWT_SECRET`, `NABALENS_TEST_DB_URL` and `MAILPIT_URL`.
Keep the new fail-closed guard in `tests/integration/auth-support.ts` and its
13 mocked-command tests: discovered API must match configured API before SQL or
signing, and partial/conflicting DB/JWT settings fail.

Complete the minimum scope, then report source/review/test/migration/deployment
and live verification as separate facts, with precise remaining blockers.
