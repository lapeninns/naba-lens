# Handoff: merge-precheck

- **Goal/scope:** documentation-only integration planning on `feat/nl-mergeplan`,
  whose application tree is still `3a23c9b`. Own only this file and
  `docs/fanout/merge-plan.md`; no application edits or real merges.
- **Latest full sweep:** snapshot 4, **2026-10-30 01:16:11.276550 UTC**.
  Integration is `69f3d081fada8067a414f1dd8da66d7e9e1b4fee`, not the old base.
  It contains migrations, privacy, library, CI, reviews, docs2, acceptance, gaps
  and our previous `4c03805`. Do not recommend remerging ancestor tips.
- **Actual results:** original 120 checks: **116 clean, 4 conflicts** (14/15
  base checks, 102/105 pairs clean). Three manifestations of the filter conflict:
  integration/journey, journey/library, journey/authedge. New journey/visual
  conflict in staff-directory row naming. Raw cumulative stops at step 6:
  5 clean then conflict. Proposed object-only resolutions complete 14 steps:
  12 automatic, 2 manual. Duration deduplication remains necessary.
- **Supplemental branch:** integrator's #4b also needs `feat/nl-secfix`, pinned
  later at `de6b03172e19aaa916b48a6b00babd4acc5fd6b4` (01:12:48 UTC,
  observed `%cr` 7 minutes ago). Sixteen separate pairs: 11 clean, 5 conflicts,
  with integration/library/authedge/uploads/privacy. After the proposed
  cumulative tree, secfix conflicts in four paths. Recipes were simulated in
  scratch objects only, final tree `c14a65c84def551b049f8309e79285cc7e4720ef`.
  Do not mix these checks into the original matrix or quiet denominator.
- **Quiet criterion not met:** **7/14**, compared with snapshot 3 across
  1194.127837 seconds (19m54s). Quiet: CI, docs2, acceptance, privacy and the
  three reviews. Changed/recent: journey, visual, library, authedge, uploads,
  migrations, load. Library/migrations are already integrated, not necessarily
  active implementation. Quiet refs are not completion claims.
- **Next:** expected tick **2026-10-30 01:35:04.208 UTC**, then every 20 minutes.
  Repin integration and all 15 original targets, record `%cr` and absolute times,
  run all base/105 pairwise/cumulative checks, inspect changed semantics and
  migration timestamps, update and commit both owned docs. Compare against
  **snapshot 4**, not earlier snapshots. Repin secfix for supplemental checks.
  Pause only when at least **8/14** original non-superseded refs are unchanged
  across about 20 minutes and their latest commit is at least 20 minutes old.

## Exact resolutions and remaining gates

- Filter: combine `filtersToSearch` with optimistic `shown`/`setShown`; committed
  filters still key/load the gallery. Blob `13842e348da452cd07265b2f1c3200c69428fd59`.
- Row link: no overriding mobile `aria-label`; visible content plus one hidden
  `, open portfolio` suffix. Visual's comment-free blob
  `76fd4a8ad97a089228800790fdf1e6c1ee45521a` resolves the comment-only conflict.
- Tile: keep journey's single trailing `duration m:ss`, not visual's prepend.
  Blob `fe0f7d6255f5f6c9bb664770e88362413cb3747b`; preserve other visual fixes.
- Secfix: keep library's `accounts/portfolio.ts` **deletion**; combine service
  signing after authorisation with shortening-only TTL and journey's missing-
  original error-body drain in `access.ts`; keep uploads' tombstone cleanup/
  size-before-read/`claimLost` handler with secfix's DB-time takeover in
  `finalise.ts`; use one security-header implementation including `nosniff`.
  Exact recipes/blobs and raw versus proposed results are in snapshot 4.
- Security fixes now exist on secfix, and uploads `ac58e9c` fixes the finalise/
  delete race. Earlier "no fix exists" statements are historical, not current.
  They are not yet in pinned integration or validated together by this track.
  Append unique `20261030100000_security_hardening.sql` after the five originals.
  Keep nullable upload keys/optional RPC arguments.
- Auth now uses a scanner-safe GET page then POST `/auth/confirm/verify`.
  Update journey/world, real-email journeys, library/gaps/visual/upload login
  helpers to click Continue, and privacy runtime to submit the form before
  expecting cookies/303. Retain scanner/non-consuming and cross-origin checks.
- Integration `a964290` wires bundle scanning and migration commands and removes
  library/gaps fixture retries. Preserve those changes; visual still retries
  fixture `generateLink`. Resolve remaining hidden fixture retries, project-name/
  discovery mismatches, CI isolated DB/JWT/workdir and callback URLs, Linux HEIC
  fixtures, privacy runtime inputs/deleted action probe, and journey's obsolete
  portfolio expected failure. Keep a separately executed visual gate.
  Auth-access integration tests also import/call deleted `loadMorePortfolioAction`;
  adapt them to authorised library paging without dropping role/inactive checks.
- Migration/backup handoff now reports a completed local drill, but on the old
  five-migration policy. Its direct end-user Storage download matrix conflicts
  semantically with secfix's lockdown. Require denied-direct-read assertions
  plus authorised app-path hash checks, then rerun the six-migration restore,
  including new trigger/RPC preservation. Do not carry forward the old 16
  direct-read grants as a requirement.
- Load's runtime-sizing report now exists. It is macOS/shared-host evidence,
  sometimes contended, not hosted/Linux proof. Keep bounded FIFO admission and
  memory accounting. Reconcile potentially ~170-second finalise retries with
  the 2-minute takeover window and route duration.
- Integration's own handoff reports install/typecheck/lint/124 unit/build/bundle
  passes, but **one failing profile-origin integration test**. Require success
  after secfix, not a skip/expected failure. Actual cleanup scheduling and hosted
  permission for the Storage trigger remain release gates. Use the shared
  Host-aware Origin helper for the admin avatar route too.

## Actual validation and safety

- Earlier baseline checks on this branch's unchanged `3a23c9b` application:
  frozen pnpm 10.30.1 install, typecheck, lint, unit (12 files / 102 tests), build,
  all exit 0. Full output is in the plan and local logs.
- Baseline app checks were not rerun for this docs-only sweep. No proposed merge
  tree, integration/security/lifecycle/browser/phone/deployment test is claimed.
  Other tracks' reported results are explicitly attributed.
- No application/index/other-branch changes, remote/push/PR/deploy, `.env*` reads,
  or stack starts/resets/reuse/stops. Only unreferenced Git scratch objects and
  temporary reports were written outside the two owned docs.
- Worktree:
  `/Users/amankumarshrestha/.t3/worktrees/nabalens/feat-nl-mergeplan`.
  Run Git inspection there. No server, Docker, Supabase or credentials needed.
- Local reports: `/tmp/nabalens-merge-precheck-initial.json`;
  `/tmp/nabalens-merge-precheck-snapshot-{2,3,4}.json`;
  `/tmp/nabalens-merge-precheck-cumulative-{2,3,4}.json`;
  `/tmp/nabalens-merge-precheck-resolved-{3,4}.json`;
  `/tmp/nabalens-merge-precheck-secfix-4.json`.
  Baseline logs: `/tmp/nabalens-mergeplan-{typecheck,lint,test,build}.log`.
  These are continuity scratch, not portable deliverables; relevant results
  and pinned tips are preserved in the plan.

## Scheduled continuation

- Exact task ID:
  `scheduled-task:command:mcp:b3a0e250-3655-403d-ac2d-9fef67a814e6:schedule-task:nabalens-merge-precheck-20261030`
- Bound to this thread, interval **1,200,000 ms**. Last returned cadence anchor:
  `2026-10-30T00:55:04.208Z`. Next expected tick after snapshot 4:
  `2026-10-30T01:35:04.208Z`. Do not reset the interval/prompt/binding.
- When the majority criterion is met, record final snapshot/remaining active
  refs and pause this exact task using
  `schedule_task({ scheduledTaskId: <above>, enabled: false })`; commit the final
  handoff. Until then, perform one sweep per tick and end the turn.
- Do not list/poll schedules, sleep, start watchers or claim quiet means finished.
