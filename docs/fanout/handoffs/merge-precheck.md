# Handoff: merge-precheck

- **Goal:** integration planning for the listed parallel branches, no application
  code changes or merges. Branch `feat/nl-mergeplan`, based on `3a23c9b`.
- **Owned output:** `docs/fanout/merge-plan.md` and this continuity file only.
- **Done:** locked install and required reads; pinned full sweeps at
  2026-10-30 00:15:10 and 00:35:46 UTC, each 120/120 clean base/pairwise checks
  and 14/14 clean cumulative checks, without branch/index/application changes.
  Incorporated independent config/helper audit, newer component/transport/auth/
  privacy/migration deltas, and both completed security review documents.
- **Checks actually run:** typecheck, lint, unit test and build all exit 0.
  `pnpm test`: 12 files / 102 tests passed. See merge plan for actual output.
- **In progress:** only 2/14 non-superseded refs were quiet across 20m36s:
  `feat/nl-acceptance` (no unique commits, not complete) and `review/nl-scope`.
  Other 12 refs changed/recent: journey, visual, library, authedge, uploads, ci,
  docs2, privacy, migrations, load, review-wave3 and review-upload-path2.
  Next run **2026-10-30 00:55:04 UTC**, then 20-minute cadence.
- **Next exact steps:** pin all 15 branch tips and
  integration base again; record `git log -1 --format=%cr <branch>`; run
  `git merge-tree --write-tree <pinned-base> <pinned-branch>` and all 105 branch
  pairs; inspect changed deltas and cumulative order; update and commit both docs.
  Continue at roughly 20-minute cadence until most refs meet the quiet criterion
  in the merge plan. Do not call a branch finished because it still equals base.
- **Integration blockers to resolve:** reviewer-reported arbitrary-lifetime
  Storage signed reads, delete/finalise race, stale-processing cleanup and actual
  deployed cleanup schedule. Current target tips do not fix these. Library fixes
  only the old portfolio duplication/gap. Also reconcile upload project-name/
  accessible-video-name selectors, visual/CI discovery, auth isolated DB/JWT
  forwarding, privacy runtime env/log requirements, Linux HEIC generation and
  new fixture retry loops. Concrete resolutions are in snapshot 2 of the plan.
- **Contract caveat:** review's proposal to require non-null upload keys conflicts
  with the documented nullable/optional amendment. Do not adopt it silently.
  Migration track's future-dated additive SQL is test-only, not production SQL.
- **How to run this track:** no server, credentials, Docker or Supabase needed.
  Worktree: `/Users/amankumarshrestha/.t3/worktrees/nabalens/feat-nl-mergeplan`.
  Run Git inspection there; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
  validate only this branch's application tree, not hypothetical merge results.
- **Local scratch:** `/tmp/nabalens-merge-precheck-initial.json` has full pinned
  snapshot 1; `/tmp/nabalens-merge-precheck-snapshot-2.json` and
  `/tmp/nabalens-merge-precheck-cumulative-2.json` have snapshot 2 full SHA/results.
  `/tmp/nabalens-mergeplan-{typecheck,lint,test,build}.log`
  has baseline command output. These are not portable deliverables; relevant
  results and pinned tips are preserved in the merge plan.
- **Open questions/blockers:** none blocking planning. Many implementation refs
  remain active; security reviews are now available, but fixes need integrator
  assignment. `feat/nl-docs2` contains `feat/nl-docs`; merge only the successor.
  Baseline application checks were not rerun for this docs-only update; no
  hypothetical merge, service-dependent, browser or phone test is claimed.
- **Safety:** no app/shared config changed, no other branch modified, no remote
  created, no PR/push/deploy, no `.env*` read and no stack touched. Scope still
  has exactly staff/admin and no extra product features.

## Scheduled continuation

- Task ID:
  `scheduled-task:command:mcp:b3a0e250-3655-403d-ac2d-9fef67a814e6:schedule-task:nabalens-merge-precheck-20261030`
- Bound to the current thread. First scheduled run completed its sweep at
  `2026-10-30T00:35:46.931709Z`; interval updated to **1,200,000 ms**.
  Returned next run: `2026-10-30T00:55:04.208Z`.
  Do not reset the interval on each later run; preserve prompt/binding.
- Subsequent runs update both docs and commit. When the documented majority
  quiet-ref criterion is met, pause this exact task with
  `schedule_task({ scheduledTaskId: <above>, enabled: false })`, record the
  remaining active refs and final snapshot, then commit the final handoff.
- Do not list/poll schedules, sleep, or start a watcher. A scheduled run performs
  the work and ends its turn; the schedule supplies the requested cadence.
