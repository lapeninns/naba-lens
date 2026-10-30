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

## Status

See the bottom of this file (updated as checks run).
