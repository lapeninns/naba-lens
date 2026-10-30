# Handoff: uploads track (`feat/nl-uploads`)

Base: `feat/nabalens-mvp` @ 078b60a. Worktree: `~/.t3/worktrees/nabalens/feat-nl-uploads`.
Status: **complete**, all checks green (30 Oct 2026). Nothing in progress.

## Goal

Upload recovery and video handling in the real app: mixed batch, retry/cancel/duplicate
finalise, TUS interruption and resume, reload states, video playback matrix, provider and
bucket limits.

## Done

| Item                                | Evidence                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Mixed batch in the real UI        | e2e "mixed batch": 12 chosen. Oversized and 11th refused with reasons. 8 ready (JPEG, PNG, WebP, HEIC via `sips`, H.264 MP4, MOV, WebM, JPEG). Disguised and corrupt fail with reasons. Max 2 storage requests in flight (observed: exactly 2). No orphan ready rows (type, size, original, derivatives checked).                                       |
| 2 Retry, cancel, duplicate finalise | e2e "retry … cancel": a dropped PUT is retried by the user, keeping the same asset id with one row. Cancel during reserve, during PUT and while queued: no finalise (network), no reservation for the queued file, tombstoned by `prepare_media_cleanup` after 24 h. Integration: duplicate and concurrent finalise are no-ops; a wrong key is refused. |
| 3 TUS interruption                  | e2e "TUS": a dropped chunk is followed by HEAD and PATCH from the offset; finished chunks are never resent. A lost connection past the retries shows the action ("…then retry: the upload continues where it stopped"), and Retry resumes the same asset with no new POST. Integration: abort/resume against real storage.                              |
| 4 Reload / fresh context            | e2e: completed, failed and unfinished states shown from the server after a reload and in a fresh context. A reload mid-TUS, then choosing the same file: same asset, resumes at 12 MiB.                                                                                                                                                                 |
| 5 Video                             | e2e "video preview": H.264 plays in Chromium, HEVC shows "Preview unavailable in this browser", and the admin download of the HEVC original is byte-identical (SHA-256). Matrix in `docs/media-pipeline.md`.                                                                                                                                            |
| 6 Limits                            | `upload-limits.test.ts`: bucket limits, a real 200 MiB TUS upload finalised ready (34 chunks), storage 413 at 200 MiB + 1, and 201 at exactly 200 MiB. Global `FILE_SIZE_LIMIT=209715200` read from the storage container env.                                                                                                                          |

### Code changes

- `lib/upload/upload-keys.ts` (new): `localUploadKeyStore()` remembers unfinished
  uploads' idempotency keys per local file. It is indexed by a SHA-256 of name, size,
  type and mtime, kept in `localStorage`, and expires after 20 h (before the 24 h
  cleanup). Re-choosing the same file after a reload reuses the asset, and TUS resumes.
- `lib/upload/queue-adapter.ts`: `keys` option. The key is forgotten on ready or failed
  validation. The same file twice in one batch gets two keys. `reservation_gone` drops
  the key so a retry starts fresh. Transient failures keep it, so no duplicates.
- `lib/upload/errors.ts` / `uploader.ts` / `types.ts`: `ReservationGoneError` gives the
  new `reservation_gone` code.
- `lib/upload/tus.ts`: `tusFailureMessage` gives plain messages for a lost connection,
  401/403 (sign in again) and 413 (storage limit).
- `app/_media/use-media-uploader.ts`: passes `localUploadKeyStore()` and maps reserve
  404 to `ReservationGoneError`.
- **Outside my paths (tiny, unavoidable):** `app/staff/actions.ts` (slice). `reserveUpload`'s
  failure result now carries `status`, so the client can tell "reservation removed"
  (404) from transient errors.
- **Outside my listed paths:** `tests/upload/upload-keys.test.ts`, unit tests for the
  new `lib/upload` module, next to the transport's existing tests.
- `lib/server/media/reserve.ts` and `finalise.ts`: **unchanged**. Every server-side
  recovery case already behaved correctly under test.

### Tests and fixtures

- `tests/fixtures/uploads/generate.mjs`: all fixtures are synthetic and generated at
  test time into `$TMPDIR/nabalens-upload-fixtures` (cached). Needs ffmpeg with
  libx264/libx265/libvpx-vp9, and macOS `sips` for HEIC. `--big` writes the exact
  200 MiB MP4. No binaries are committed.
- `tests/integration/upload-recovery.test.ts` (12), `tests/integration/upload-limits.test.ts`
  (4; generates the 200 MiB file, about 40 s), `tests/e2e/upload-recovery.spec.ts` (4,
  desktop project only; it launches WebKit and Firefox itself for the matrix).

## Findings for other tracks (not fixed here)

1. **visual-a11y, `components/nabalens/media-viewer.tsx` `canPlay`:** Chromium reports
   `canPlayType("video/quicktime") === ""`, so H.264 MOVs (common from iPhones) show the
   fallback. A raw `<video>` plays the same file in Chromium. Suggestion: let the element
   try `video/quicktime` and rely on `onError` (already correct for HEVC).
2. **visual-a11y / library, `UPLOAD_STATE_LABEL.uploading = "Uploading"`, viewer "Still
   uploading.":** after a reload, cancel or closed tab, an `uploading` row is shown with
   a spinner as "Uploading", although nothing is transferring. Suggested wording: "Not
   finished: choose the file again to continue" (the new key store makes that true in
   the same browser). Cleanup removes these rows after 24 h.
3. **slice (perf):** Next dispatches Server Functions one at a time per client, so one
   file's `reserve` or `finalise` (a long HEIC decode or video probe) queues the other
   file's. Transfers still overlap. Route Handlers for reserve/finalise would remove
   this.
4. **Release (M6):** hosted Supabase's global upload limit depends on the plan (Free:
   50 MB). Check it and the `media` bucket's own limit are at least 200 MiB, or videos
   fail with 413 ("This file is larger than the storage limit.").
5. **Environment:** Playwright Firefox (1555/1543/1538) cannot launch on this Mac
   (Darwin 27: "Could not find profile folder"). The Firefox matrix column was not run.
6. The machine ran about 15 Supabase stacks (load average around 30). The first full
   integration run had 14 failures and the second one timeout, all infra (auth/PostgREST
   timeouts). The third run was clean. Rerun before treating a failure as real.

## Checks (final tree)

| Command                                             | Result                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                    | pass                                                                                          |
| `pnpm lint`                                         | pass                                                                                          |
| `pnpm test`                                         | 13 files, 109 passed                                                                          |
| `pnpm test:integration` (my stack)                  | 9 files, 100 passed (third run; see finding 6)                                                |
| `pnpm exec playwright test` upload-recovery + slice | 8 passed, 4 skipped (mobile copies of upload-recovery)                                        |
| `pnpm exec playwright test` auth + staff-accounts   | 14 passed                                                                                     |
| `pnpm build`                                        | pass; `[worker thread]` HEIC chunk in `.next/server/chunks`, listed in `/staff`'s `.nft.json` |
| `pnpm test:security`, `pnpm test:lifecycle`         | not run (no RLS/storage/lifecycle changes on this branch)                                     |

## How to run my isolated stack

```sh
W=/tmp/nabalens-uploads-stack   # copy of supabase/: project_id nabalens-uploads,
                                # ports 554xx -> 588xx, studio/realtime/analytics/
                                # edge_runtime/vector disabled (uncommitted, temp only)
supabase --workdir $W start
source /tmp/nl-uploads-env.sh   # exports NEXT_PUBLIC_SUPABASE_*, SERVICE_ROLE, MAILPIT_URL, E2E_PORT=3488
pnpm exec vitest run --project integration tests/integration/upload-*.test.ts
pnpm exec playwright test tests/e2e/upload-recovery.spec.ts --project desktop
supabase --workdir $W stop
```

To recreate it, copy `supabase/` to `$W`, set `project_id`, sed `554(\d\d)` to `588\1` and
disable the services above. The env script runs `supabase --workdir $W status -o json` and
exports `API_URL`, the keys and `DB_URL` without printing them.

## Next steps

- Integrator: merge `feat/nl-uploads`, then pass findings 1–2 to visual-a11y/library and 3 to slice.
- Firefox column: run the matrix test on a machine where Playwright Firefox launches.
- Physical iPhone/Android MOV/HEVC and HEIC: still untested (spec §10).
