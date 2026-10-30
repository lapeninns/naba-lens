# Handoff: load-sanity (`feat/nl-load`)

## Goal

Measure upload and finalise behaviour of a production build (`pnpm build && next start`) on
an isolated local stack:

- (a) 10 staff each uploading a 10-file mixed batch, 2 transfers at once per client;
- (b) 5 simultaneous 12 MP HEIC finalises, with HEIC concurrency 1;
- (c) memory during a 200 MiB video finalise.

Then recommend Node function memory, timeout and concurrency. This track owns
`tests/load/**` and `docs/runtime-sizing.md`.

## Done (complete)

- **Results and recommendations:** `docs/runtime-sizing.md`. These are macOS arm64 numbers,
  not deployed proof.
- **Harness in `tests/load/`:**
  - `prepare-stack.mjs`: stack `nabalens-load`, ports 615xx. Studio, Realtime, Analytics,
    Edge Runtime and Mailpit are off.
  - `fixtures.mjs`: synthetic fixtures, written to `$TMPDIR`.
  - `stack-env.mjs`: env for build and start, read from `supabase status`. No keys are
    printed.
  - `server-probe.mjs`: an `--import` preload that logs HEIC worker and server-fetch timings.
  - `run.mjs`: the runner.
  - `storage-range-burst.mjs`: a Storage-only repro.
  - `results/*.json`: raw reports.
- **Fix in `lib/media/heic.ts`.** HEIC callers now wait for the single slot in arrival order
  (at most `heicTimeoutMs`) instead of getting `decoder_busy` at once.
  - `tests/media/review.test.ts`: the immediate-busy test was replaced by a FIFO test and a
    bounded-wait test.
  - `docs/media-pipeline.md`: one paragraph updated.
  - Results: 20 simultaneous HEIC finalises went from 9/20 ready to 20/20. The all-HEIC
    batch went from 69/100 to 100/100.

## Outside this track's paths (unavoidable, listed)

- `lib/media/heic.ts`, `tests/media/review.test.ts`, `docs/media-pipeline.md` (media track).
  Allowed by the brief: "fix only if confined to `lib/media` worker queueing".

## Open items for other tracks

1. **Slice (`lib/server/media/finalise.ts`).** `BUSY_RETRIES = 8` now compounds with the
   15 s FIFO wait. The worst case is about 170 s. Lower it to 1 or 2, or set `maxDuration`
   300 on `app/staff/page.tsx`.
2. **Foundation or slice.** When `loadProfile` throws on a PostgREST error, `reserveUpload`
   and `finaliseUpload` answer HTTP 500 instead of a `{ ok: false }` value.
3. **Release.** Repeat the runs against hosted Supabase and a Linux function, and check the
   hosted Storage connection pool. Local Storage returned `544 DatabaseTimeout` at about 20
   concurrent signs/PUTs.
4. **Integrator.** `docs/fanout/STATUS.md` still says "a second concurrent call gets
   `decoder_busy`". It now waits for up to 15 s first.

## How to run

See "How to run" in `docs/runtime-sizing.md`. The stack `nabalens-load` (615xx) was
**stopped** at the end; the workdir is `$TMPDIR/nabalens-load-stack`.
