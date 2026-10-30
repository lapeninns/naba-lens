# NabaLens merge precheck

Track: `merge-precheck`, branch `feat/nl-mergeplan`. Documentation only.
Only the integrator may merge into `feat/nabalens-mvp`. No remote, push, PR,
application edits, database changes, or running stacks are needed for this track.

## Snapshot 1: 2026-10-30 00:15 UTC

Integration base: `3a23c9bf065a5e7d369a7bdac0006e5c38a0dfbd`.
All refs were resolved before checking, then immutable SHAs were used. These
results describe committed trees, not uncommitted work or completed tracks.

| Branch | Pinned tip | Unique work at snapshot |
| --- | --- | --- |
| `feat/nl-journey` | `4c97963` | Production browser config, helpers, core journey |
| `feat/nl-visual` | `23c46f1` | Separate visual config, fixtures, axe/overflow checks |
| `feat/nl-library` | `f3ee17b` | Shared admin portfolio, preview recovery |
| `feat/nl-authedge` | `078b60a` | None yet; ancestor of integration base |
| `feat/nl-uploads` | `a70a27b` | Recovery/limits integration tests, fixture generator |
| `feat/nl-ci` | `2f389c4` | CI workflow, local gate, isolated config/stack |
| `feat/nl-docs2` | `b175917` | Operator setup, operations, release and usage docs |
| `feat/nl-docs` | `575c336` | Already contained in `feat/nl-docs2` |
| `feat/nl-acceptance` | `3a23c9b` | None yet |
| `feat/nl-privacy` | `3a23c9b` | None yet |
| `feat/nl-migrations` | `3a23c9b` | None yet |
| `feat/nl-load` | `3a23c9b` | None yet |
| `review/nl-wave3` | `f6ff865` | In-progress review handoff only |
| `review/nl-scope` | `3894911` | Scope audit against `3a23c9b` |
| `review/nl-upload-path2` | `3a23c9b` | None yet |

Actual scan output:

```text
COUNTS {"merge_tree_checks": 120, "clean": 120, "conflicting": 0}
```

This is 15 integration-base checks and all 105 branch pairs (including both
documentation alternatives). `git merge-tree --write-tree <left-sha> <right-sha>`
returned exit 0 for every pair. It writes Git objects only, not refs, the index,
or the worktree. It does not establish that a cumulative integration will compile.

Only `package.json`, `pnpm-lock.yaml`, and the seven original docs paths overlap
between branch deltas at this snapshot. The docs overlap is ancestry, not competing
edits: use `feat/nl-docs2`, do not merge `feat/nl-docs` separately.

### Cumulative order check

At 00:20 UTC, the 14-step order below was also checked against the same pinned
snapshot (excluding superseded `feat/nl-docs`). Every cumulative merge-tree
returned exit 0:

```text
migrations -> authedge -> privacy -> library -> uploads -> journey -> visual
-> load -> ci -> review-wave3 -> review-upload-path2 -> review-scope
-> docs2 -> acceptance
14 cumulative checks: 14 clean, 0 conflicting
final tree: bfb9d928d9c23143f6430bf58e2fbd410859bbb0
```

Each intermediate tree was wrapped with `git commit-tree <tree> -p <previous>
-p <branch>` solely to preserve ancestry for the next merge-tree call. These are
unreferenced scratch objects, not commits on any branch. No checkout, index,
branch ref, or application file changed. These trees were not installed or tested.

## Recommended order

This is conditional on final track commits and review findings, not an instruction
to merge unfinished branches just because they currently have no conflicts.

1. Read `review/nl-wave3`, `review/nl-upload-path2`, and the privacy/migration
   findings first. Merge any required security/schema corrections before accepting
   browser evidence. An empty diff or WIP handoff is not a completed review.
2. `feat/nl-migrations`, then `feat/nl-authedge` and `feat/nl-privacy` if they gain
   actual changes. Keep append-only migration history and current-account checks.
3. `feat/nl-library`. This supplies download/delete/refresh in the admin's
   individual portfolio and removes the interim duplicate gallery/query.
4. `feat/nl-uploads`. Preserve transport recovery and validation/idempotency tests;
   rerun them against any preceding schema/auth changes.
5. `feat/nl-journey`, then `feat/nl-visual`. Keep both suites and their appropriate
   independent configs instead of overwriting the root browser config twice.
6. `feat/nl-load`, then `feat/nl-ci`. Consolidate CI discovery once the actual
   browser/load commands and isolation requirements are known.
7. `review/nl-scope` and any remaining review documents. Its current audit is a
   PASS on `3a23c9b`, not on the future integrated tree.
8. `feat/nl-docs2`, then `feat/nl-acceptance`. Reconcile operational commands and
   release evidence with the integrated tests, never with an anticipated pass.
9. Merge this documentation branch when useful; rerun its precheck against the
   then-current integration head immediately before each real merge.

## Resolution rules and semantic overlaps

No textual conflicts need resolving in snapshot 1. The following are explicit
resolution recipes for shared-file changes that appear in later commits.

- **`package.json`: combine, do not choose an entire side.** Retain the integration
  scripts and all new suite commands. Keep additive browser-test dependencies from
  journey/visual. Do not upgrade unrelated packages or replace the existing test
  commands with a narrower suite. Specifically, both add identical
  `@axe-core/playwright: "^4.14.0"`; keep it once, plus visual's
  `"test:visual": "node tests/visual/run.mjs"`.
- **`pnpm-lock.yaml`: preserve manifest union and policy.** The current journey and
  visual deltas merge cleanly, but frozen install must confirm the combined tree.
  If later hunks conflict, resolve `package.json` first and regenerate only the lock
  from that agreed manifest with pnpm. Do not take a stale whole lockfile.
  Keep `pnpm-workspace.yaml`'s `minimumReleaseAge: 1440` and build permissions:
  `esbuild: false`, `sharp: true`, `unrs-resolver: true`, `msw: false`.
  At the audited journey/visual tips their entire lock blobs are identical
  (`173549f…`, baseline `a123bd8…`); either identical blob is sufficient at this
  snapshot. Regeneration is only needed if a later manifest/lock diverges.
- **`app/admin/staff/[id]`: library's architecture wins.** Keep `page.tsx` using
  `getMediaActor("admin")`, `listLibrary`, and the new `AdminPortfolio`; retain the
  existing `AccountHeader`/account editing. Do not restore deleted
  `portfolio-gallery.tsx`, `lib/server/accounts/portfolio.ts`, its exports, or
  `loadMorePortfolioAction`. Use `loadLibraryPage({ staff: staffId }, cursor)` and
  shared `MediaGallery` for stable paging, preview, download, deletion, and polling.
- **`components/nabalens/media-viewer.tsx`: combine visual changes with library's
  `failedUrl` logic.** A changed authorised preview URL must clear its prior failure
  state. Keep full-image display, native-video fallback and permission-aware
  callbacks. Presentational components must remain free of Supabase imports.
- **`app/_media/media-gallery.tsx`: retain shared behavior.** Preserve library's
  preview recovery, existing foreground-only 15-second/focus refresh, current
  filters, delete confirmation, paging and authorisation routes. Do not replace it
  with another account-only implementation or long-lived signed URL storage.
- **`lib/config/media.ts`: integration's canonical names/values win.** No target
  branch changes it in snapshot 1. Preserve 10 files / 2 transfers / 20 MiB photos /
  200 MiB videos / 5 MiB avatars, 60-second signed links and the processing budgets.
  Library's `signedUrlTtlSeconds()` in `lib/server/media/access.ts` only permits a
  test override that shortens the canonical TTL; do not restore the old
  `signedUrlTtlSeconds` or `abandonedUploadHours` config names.
- **Reviews are not automatically fixes.** Scope's preview-only portfolio finding
  is addressed structurally by library `f3ee17b`; confirm it in the integrated UI
  before closing the finding. Future security findings take precedence over
  cosmetic or test-only changes, without weakening RLS, checks, or assertions.
- **Uploads after snapshot 1:** inspected `84bab92`, which adds
  `lib/upload/upload-keys.ts`, `ReservationGoneError`, queue/TUS changes and the
  app uploader hook wiring. Preserve them together with `app/staff/actions.ts`'s
  returned status so a removed reservation is distinguishable from other failures.
  Keep the stored idempotency key, not bytes or credentials, and the new unit
  coverage. This is resume-after-file-reselection, not offline/background upload.
  The next matrix must use this newer tip; snapshot 1 predates it.

## Test-config and helper consolidation

- Root `vitest.config.ts` remains the authoritative unit/integration project list.
  Keep the existing unit globs and integration isolation. New
  `tests/integration/upload-*.test.ts` already match its integration glob, not
  `pnpm test`'s unit project. Preserve security/lifecycle standalone configs.
- Keep journey's root `playwright.config.ts`, visual's
  `playwright.visual.config.ts`, and CI's `scripts/ci/playwright.config.ts` until
  their discovery and environment contracts are reconciled. Do not flatten them
  into a config that silently omits a suite or runs visual tests in every journey
  project. Keep `workers: 1`, `retries: 0`, no hidden retries and no server reuse.
- **Fix unrestricted test discovery before treating CI as integrated.** Journey's
  root config discovers all of `tests/e2e`, so visual's
  `tests/e2e/visual.spec.ts` would also run in ordinary E2E and CI, with the wrong
  fixture contract/timeout. Explicitly exclude `visual.spec.ts` from ordinary
  discovery and run the preserved visual config as its own gate.
- **Connect CI to journey's isolation contract.** CI's
  `scripts/ci/run-suites.mjs` exports credentials, but not
  `E2E_SUPABASE_WORKDIR`. Pass its isolated workdir through journey's resolver,
  which sets `E2E_ISOLATED_STACK` and `E2E_DB_URL`. Keep
  `tests/e2e/helpers/stack.ts`'s fail-closed `requireIsolatedStack()`.
- **Fix CI auth URLs, not auth enforcement.** CI's preparation script currently
  rewrites Supabase ports but leaves auth redirects on port 3000. Reuse journey's
  site/callback/confirm URL transformation for the actual CI app port, without
  changing invite-only settings.
- **Make HEIC fixtures deployable on CI's platform.** Journey's
  `tests/e2e/helpers/media.ts` invokes macOS `sips` unconditionally from the core
  journey. Ubuntu CI needs a real synthetic HEIC fixture or supported encoder,
  not a skipped assertion or fake JPEG substitute. Preserve ffmpeg/HEVC coverage.
- **Keep CI's project matrix explicit.** Its wrapper replaces journey projects
  with desktop/phone projects per engine, losing journey's `@core` filtering and
  mobile device settings. Decide and document the deliberate matrix, preserving
  actual browser/device settings, one worker, zero retries and all core assertions.
- **Run privacy's bundle scan after the production build.** At privacy
  `8e788ec`, `scripts/ci/scan-bundle.mjs` fails for missing build/findings, but CI
  does not invoke it. Wire a checked invocation against the same build environment
  and propagate its exit status. Never relax scanner rules to make the gate pass.
- **Keep CI's toolchain pin deliberate.** `scripts/ci/local-ci.sh` and its workflow
  pin pnpm 10.30.1. Do not remove the baseline pnpm-11 install-policy fix or claim
  a pnpm-11 CI run from the old pin; document/test each supported version.

### Duplicated helpers to unify

Prefer compatibility wrappers around shared pure primitives, not an integration
refactor that silently changes fixtures or redirects. This track makes no edits
to these helpers.

| Overlap | Concrete consolidation / behavior to retain |
| --- | --- |
| `tests/{security,lifecycle,e2e,visual,library,load}/prepare-stack.mjs`, `scripts/ci/prepare-stack.mjs` | Share copying/config transformations with per-suite options; preserve default workdirs, outputs, `.temp`/`.branches` exclusions, auth URLs and fresh migration copying. Keep separate project IDs/ports and cleanup ownership. |
| Status/env parsing in standalone runners, journey config, CI and load | Share an ESM local-stack resolver; retain `NABALENS_TEST_DB_URL` versus `E2E_DB_URL`, CLI workdir forwarding and failure propagation. Do not broaden lifecycle's `server-only` stub into root Vitest. |
| Browser fixture/login helpers and existing integration identities | Share low-level fixture primitives only. Journey must still test real Mailpit login with freshness/subject checks, without hidden retries or service-role substitution. Visual fixtures remain layout-specific; direct `verifyOtp` integration helpers are not browser-login evidence. |
| `tests/e2e/helpers/media.ts`, `tests/fixtures/uploads/generate.mjs`, `tests/load/fixtures.mjs` | Share encoding primitives only. Keep exact source hashes, codec variants, malformed cases and boundary sizes; load's near-200-MiB video is not uploads' exact 209,715,200-byte boundary file. |
| Interim account media query/gallery | Already removed by library. Keep `listLibrary` / `MediaGallery` as the common implementation rather than extracting another parallel query. |

Audited default port blocks: security `564xx`, visual `577xx`, library `579xx`,
journey `583xx` (override supported), lifecycle `594xx`, load `615xx`; CI probes
a randomized block. These are descriptions, not reservations: check collisions
before starting any stack. Load disables Mailpit; browser/email suites require it.
Temporary suite configs should disable studio/realtime/analytics/edge runtime when
not needed. Never share another worktree's containers or stop them.

### Migration ledger

Across the audited committed tips there are **no new migration paths, duplicate
timestamps, divergent migration blobs, or timestamp collisions**. Migrations are:

| Order | Filename | Dependency / reason to retain |
| --- | --- | --- |
| 1 | `20261029120000_nabalens_schema.sql` | Domain/private schema, enums and tables |
| 2 | `20261029120100_nabalens_access.sql` | Depends on schema; RLS, helpers, triggers, four-argument reserve |
| 3 | `20261029120200_nabalens_storage.sql` | Depends on access helpers; private buckets/policies, original cleanup |
| 4 | `20261029150000_nabalens_media_cleanup.sql` | Cleanup leases/replacement RPC; drops prior two-argument cleanup |
| 5 | `20261029160000_media_client_upload_key.sql` | Contract amendment; immutable key/index, five-argument reserve replacing four-argument RPC |

Keep these files once and unchanged. No renumbering is justified now.
`feat/nl-migrations` still equalled base in the audited snapshot, not a completed
migration review. If it later adds corrections, prefer a new uniquely timestamped
forward migration after its dependencies. For two future new files sharing a
timestamp, rename only the not-yet-applied new file and update references/evidence;
never rewrite already-applied integration migrations. Verify a fresh isolated
reset and upgrade path before release.

### Independent audit provenance

The read-only helper/config/migration audit used snapshot-1 SHAs, then inspected
new scoped commits uploads `84bab92`, load `364b3ee`, privacy `8e788ec`.
Docs2 subsequently advanced to `a4ebc8d` outside that audit. These later scoped
findings are not substitutes for the scheduled full fresh-ref matrix. No
delegate changed files, ran services, or validated the combined application.

## Validation (own unchanged application tree at `3a23c9b`)

Required reads were completed in the requested order after starting the install.
No Next.js application code was written, so no framework implementation guide was
needed. Commands below were actually run in this worktree, not on proposed merges.

```text
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Packages: +637
Done in 5.8s using pnpm v10.30.1

$ pnpm typecheck
> tsc --noEmit

$ pnpm lint
> eslint

$ pnpm test
Test Files  12 passed (12)
     Tests  102 passed (102)
  Duration  27.41s

$ pnpm build
✓ Compiled successfully in 3.7s
  Finished TypeScript in 3.6s

typecheck=0 lint=0 test=0 build=0
```

No integration/security/lifecycle/e2e tests, browser sessions, physical devices,
live email or hosted deployments were run by this track. No Supabase stack was
started, reset, reused, or stopped.

## Cadence and remaining work

First complete scan: 00:15 UTC; next scheduled **00:34:43 UTC, 30 October 2026**. Several
branches have since gained commits, so this initial matrix is deliberately not
labelled final. Each follow-up must pin fresh refs, record
`git log -1 --format=%cr <branch>`, rerun all base and pairwise merge-tree checks,
inspect new shared-file changes and cumulative merge trees, then commit both
this plan and `docs/fanout/handoffs/merge-precheck.md`.

The continuation is bound to this thread, with its exact task ID and interval
transition recorded in the continuity handoff. This lets the requested periodic
work continue without a sleeping shell, polling loop, server, or occupied stack.

Stop recurring sweeps when a majority of tracked (non-superseded) branches have
unchanged tips across a roughly 20-minute interval and their latest commits are
at least 20 minutes old. This is an observable quiet-ref criterion, not proof that
uncommitted work has stopped. List remaining active tracks explicitly.
