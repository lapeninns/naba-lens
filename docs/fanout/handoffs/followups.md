# Handoff: followups

- **Branch:** `feat/nl-followups` (base `feat/nabalens-mvp` @ 3e0a499). Worktree
  `~/.t3/worktrees/nabalens/feat-nl-followups`.
- **Goal:** small defects reported by finished tracks, each with a regression test.

## Items

| #   | Source  | Fix                                                                                                                                                                                                                                                              | Regression test                                                      |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | journey | `app/_media/media-gallery.tsx`: each refresh races a 10 s timeout (`REFRESH_TIMEOUT_MS`); a hung request is abandoned (its late answer is dropped), shows "Could not refresh", and the next interval/focus refresh runs. Server Functions take no `AbortSignal`. | `tests/ui/library-gallery.test.tsx` › abandons a hung refresh        |
| 3   | journey | Download click also sends a 1-byte `Range` GET to the same route (native download not prevented); a failure shows `role="alert"` inside the viewer (404 / 401 / network / other).                                                                                | `tests/ui/library-gallery.test.tsx` › failed downloads (3 tests)     |
| 4/8 | load    | `lib/server/media/finalise.ts`: `BUSY_RETRIES` 8 → 1; HEIC step worst case 46 s (`HEIC_FINALISE_WORST_CASE_MS`). Documented in `docs/runtime-sizing.md` (`maxDuration` 120 s).                                                                                   | `tests/unit/finalise-budget.test.ts`                                 |
| 5   | load    | `lib/server/media/context.ts`: a thrown profile read → `503` "Try again in a moment"; reserve/finalise/loadMyMedia return the status; media routes' `fail()` adds `Retry-After: 5` on 503; `/download` passes 503 through (other denials still 401/404).         | `tests/unit/media-actor-unavailable.test.ts` (fails 3/4 without fix) |
| 6   | merge   | Verify only: no `test.fail()` left in `tests/e2e/negative.spec.ts`.                                                                                                                                                                                              | run `negative.spec.ts`                                               |
| 7   | privacy | Restore `expect(invited.value.status).toBe("sent")` if invites deliver on a quiet stack.                                                                                                                                                                         | `tests/integration/privacy-runtime.test.ts`                          |

## Outside the track's paths

- `components/nabalens/media-viewer.tsx` (ui; `visual-a11y` is also running): two optional
  props, `onDownload` and `downloadError`, plus the alert paragraph. Nothing else changed.

## Stack

`W=/tmp/nl-followups-stack`: `E2E_PORT=3627 E2E_PORT_BLOCK=627 node tests/e2e/prepare-stack.mjs $W`,
then in the temp copy only: `project_id = "nabalens-followups"`, `email_sent = 100`.
`supabase --workdir $W start -x imgproxy,postgres-meta,vector,logflare,supavisor`,
`supabase --workdir $W db reset`. Stop with `supabase --workdir $W stop`.

Stack is **stopped**. Integration needs `MAILPIT_URL` exported too when using env vars.

## Also fixed (post-merge #4b test drift found while running the affected suites)

- `tests/integration/privacy-runtime.test.ts`: probed the deleted `loadMorePortfolioAction`;
  now calls `loadLibraryPage({ staff }, null)` from `/admin/staff/[A]` (as merge-plan.md asked).
- `tests/e2e/library.spec.ts`: wrote the download fixture's original after the row was
  `ready`, which secfix's `guard_media_original_write` refuses (`media_reservation_closed`).
  Now stored through `seedAsset({ original })` while still `uploading`. After: 3/3 (load ~7).
- `tests/e2e/gaps.spec.ts`: read the captured 15 s interval right after server-rendered text
  appeared (before hydration); now `expect.poll`s it. Before the fix: failed twice cold, then passed 3/3. After: 3/3 (load ~8).
- `tests/e2e/negative.spec.ts`: the missing-original test now asserts the in-app alert.

## Privacy runtime in CI (orchestrator item, test defect 3)

- The probe of `loadMorePortfolioAction` now calls `loadLibraryPage({ staff }, null)` (what
  `app/admin/staff/[id]/admin-portfolio.tsx` pages with), asserts `ok` with only staff A's
  items, and that staff A and B get `{ ok: false, "Not allowed." }`. Every response is still
  recorded for the no-store / no-foreign-PII / log checks. The 3e0a499 file: 1 failed / 10
  passed; now 11/11 (3 consecutive runs through the CI script).
- New CI step `privacy-runtime` in `scripts/ci/local-ci.sh` → `scripts/ci/privacy-runtime.mjs`:
  reuses Playwright's stack build (rebuilds if `.next` does not target the stack; that
  rebuild path is untested), `next start` on the e2e port with a captured log, fresh
  `CLEANUP_SECRET`, `PRIVACY_RUNTIME_REQUIRED=1`, requires ≥ 11 passed and 0 skipped.
- `PRIVACY_RUNTIME_REQUIRED=1` without `PRIVACY_BASE_URL` fails the file at collection.
- `scripts/ci/prepare-stack.mjs`: `email_sent = 100` in the CI stack's temp copy only.
- Full `local-ci.sh` was not run (one shared runner; the lead runs it).

## Status: done

Results (load average 3.3 to 4.1, one stack): typecheck, lint clean; unit 147/147;
integration 137 passed, 12 skipped (privacy-runtime without a server); privacy-runtime with
strict invitation 11/11 three runs; security 153/153; lifecycle 23/23; build + scan-bundle
clean; e2e chromium negative 8/8, library 3/3, gaps 4/4, slice + upload-recovery 6/6,
responsive passed; journey @core 4/4 engines.

## Next

- Integrator: merge `feat/nl-followups`. `components/nabalens/media-viewer.tsx` overlaps
  `visual-a11y`: keep both its changes and the `onDownload`/`downloadError` props.
- Release: set `export const maxDuration = 120` with the deployment (`docs/runtime-sizing.md`).
- Open: pages (`app/staff/page.tsx`, `app/admin/page.tsx`) still throw to the error boundary
  when the profile read fails; layouts call `lib/auth` (auth-edges owns it).
