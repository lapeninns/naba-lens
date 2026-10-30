# Handoff: uploads track (`feat/nl-uploads`)

Base: `feat/nabalens-mvp` @ 078b60a. Worktree: `~/.t3/worktrees/nabalens/feat-nl-uploads`.

## Goal

Upload recovery and video handling in the real app: mixed batch, retry/cancel/duplicate
finalise, TUS interruption and resume, reload states, video playback matrix, provider and
bucket limits. Owned paths: `lib/upload/**`, `app/_media/use-media-uploader.ts`,
`lib/server/media/{reserve,finalise}.ts`, `tests/e2e/upload-recovery.spec.ts`,
`tests/integration/upload-*.test.ts`, `tests/fixtures/uploads/**`.

## Done

- `tests/fixtures/uploads/generate.mjs`: synthetic fixtures generated at test time into a
  temp dir (JPEG/PNG/WebP, HEIC via `sips`, H.264 MP4, MOV, WebM, HEVC MP4, disguised HTML,
  truncated JPEG, 21 MiB photo, 20 MiB TUS video, `--big` exact 200 MiB MP4).
- `tests/integration/upload-recovery.test.ts` (12 tests): retry reuses the asset, lost
  response, early finalise, duplicate and concurrent finalise, wrong key, cancel before and
  during upload cleaned only after 24 h, disguised/corrupt/oversized/type mismatch never
  ready.
- `tests/integration/upload-limits.test.ts` (4 tests): bucket limits, a real 200 MiB TUS
  upload finalised ready, storage 413 at limit + 1, TUS resume from offset.

## In progress

- e2e `tests/e2e/upload-recovery.spec.ts`.

## How to run my isolated stack

```sh
W=/tmp/nabalens-uploads-stack   # copy of supabase/ with project_id nabalens-uploads,
                                # ports 554xx -> 588xx, studio/realtime/analytics/
                                # edge_runtime/vector disabled (uncommitted)
supabase --workdir $W start
source /tmp/nl-uploads-env.sh   # exports NEXT_PUBLIC_SUPABASE_* / SERVICE_ROLE from status, E2E_PORT=3488
pnpm exec vitest run --project integration tests/integration/upload-*.test.ts
supabase --workdir $W stop      # when finished
```

## Open questions

- none yet
