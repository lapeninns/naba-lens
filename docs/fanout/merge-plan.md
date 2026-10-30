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
  commands with a narrower suite.
- **`pnpm-lock.yaml`: preserve manifest union and policy.** The current journey and
  visual deltas merge cleanly, but frozen install must confirm the combined tree.
  If later hunks conflict, resolve `package.json` first and regenerate only the lock
  from that agreed manifest with pnpm. Do not take a stale whole lockfile.
  Keep `pnpm-workspace.yaml`'s `minimumReleaseAge: 1440` and build permissions:
  `esbuild: false`, `sharp: true`, `unrs-resolver: true`, `msw: false`.
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
- Audit duplicated stack preparation, Mailpit/login, generated fixtures and
  local-Supabase lookup helpers before sharing them. Share only equivalent pure
  pieces; keep each suite's unique project ID, ports, env prefix, fixtures and
  cleanup ownership. Do not use another worktree's existing containers.
- Final exact dependency/config/helper deltas and migration ledger will be added
  after the independent committed-ref audit and the next timed sweep.

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

First complete scan: 00:15 UTC; next due approximately **00:35 UTC**. Several
branches have since gained commits, so this initial matrix is deliberately not
labelled final. Each follow-up must pin fresh refs, record
`git log -1 --format=%cr <branch>`, rerun all base and pairwise merge-tree checks,
inspect new shared-file changes and cumulative merge trees, then commit both
this plan and `docs/fanout/handoffs/merge-precheck.md`.

Stop recurring sweeps when a majority of tracked (non-superseded) branches have
unchanged tips across a roughly 20-minute interval and their latest commits are
at least 20 minutes old. This is an observable quiet-ref criterion, not proof that
uncommitted work has stopped. List remaining active tracks explicitly.
