# Runtime sizing (load sanity)

Measured 30 October 2026 by the load-sanity track (`feat/nl-load`).

**These are macOS arm64 numbers, not deployed proof.** Everything ran on one Apple M5 Pro
(18 cores, 64 GiB) with Node v24.16.0, using `pnpm build` and `next start`. The Mac was
shared with about 12 other Supabase stacks and many agents. **Every measurement records the
host's `uptime` load averages.** A run is flagged **contended** if the 1-minute load went above
8 at any point. The exploratory runs (load 14 to 41, all contended) are kept below for the
before/after comparison. The **final set** was repeated once the load had dropped below 8,
and it is the set to size from. Supabase ran as a local Docker stack with the **file** storage
backend. Hosted Supabase (S3-backed Storage, different pool sizes) and a Linux/Vercel function
were **not** tested. Use these numbers to choose staging settings, then repeat the runs there.

## What was measured

`tests/load/run.mjs` drives the production server the way the upload dialog does:
`reserveUpload` (Server Action), then a signed PUT or TUS upload straight to Storage, then
`finaliseUpload` (Server Action).

- **One simulated staff member is one browser tab.** It runs up to 2 transfers at once
  (`MEDIA_LIMITS.maxParallelUploads`).
- **Server Actions go one at a time per tab**, as in Next's client ("Sequential dispatch on
  the client", `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`). The runner
  holds a lock per tab to match. `--parallel-actions` removes the lock to stress the server
  harder than a browser can.
- **`finalise` is called once per file**, like `lib/upload`. The runner adds no retries.

All inputs are synthetic and come from `tests/load/fixtures.mjs`:

| Fixture            | What it is                                | Size          |
| ------------------ | ----------------------------------------- | ------------- |
| `photo-12mp.jpg`   | 4032×3024 noise JPEG                      | 5.5 MB        |
| `photo-8mp.jpg`    | 3264×2448 noise JPEG                      | 2.8 MB        |
| `photo-2mp.png`    | 1920×1080 PNG                             | 4.2 MB        |
| `photo-12mp.webp`  | 4032×3024 WebP                            | 4.8 MB        |
| `photo-12mp.heic`  | 4032×3024 HEIC, made with `sips`          | 5.2 MB        |
| `clip-20mib.mp4`   | 1080p H.264 test pattern, moov at the end | 19.5 MB       |
| `video-200mib.mp4` | 1080p H.264, 62 s, moov at the end        | 209,228,757 B |
| `synthetic.mov`    | the repo's tiny QuickTime fixture         | 1.7 KB        |

The 200 MiB video is 486 KiB under the `maxVideoBytes` limit.

The server is started with an `--import` probe (`tests/load/server-probe.mjs`). It logs
`worker_threads` start and exit times, and the status and time of each server-side fetch to
the stack. It does not change any app code.

- **RSS** is the whole `next start` process, sampled every 100 ms with `ps`, so it includes
  the HEIC worker threads.
- **Finalise latency** is measured from the client: request to response of the
  `finaliseUpload` Server Action.

Raw reports are in `tests/load/results/*.json`.

## Final set (host quiet at start)

Run with `sh tests/load/final-set.sh "$W" "$F" final`. Before each scenario the script waits
(using an until-loop) for the 1-minute load to drop below 8. All runs include the HEIC fix
(see "Defects found").

- "Load before" and "Load after" are `uptime`'s 1, 5 and 15-minute averages.
- "Max 1m" is the highest 1-minute load sampled each second during the run.
- In (b20) and both (a) runs, the load rose above 8 during the run itself, partly from the
  run's own Next, sharp and Docker work. They are flagged _mildly contended_.

| Scenario                 | Ready       | Finalise p50 / p95 / max (s)                                                    | Peak RSS (MiB, idle) | Next 5xx | Storage errors | Load before   | Load after     | Max 1m | Flag             |
| ------------------------ | ----------- | ------------------------------------------------------------------------------- | -------------------- | -------- | -------------- | ------------- | -------------- | ------ | ---------------- |
| (a) 10 × 10 mixed        | **100/100** | 0.41 / 7.9 / 8.5                                                                | **1289** (304)       | 0        | 0              | 8.9 11.4 19.2 | 11.2 11.9 19.2 | 11.8   | mildly contended |
| (a) by type              |             | HEIC 6.9 / 8.5 / 8.5; other images 0.38 / 1.05 / 1.28; video 0.10 / 0.24 / 0.59 |                      |          |                |               |                |        |                  |
| (a) 10 × 10 HEIC         | **100/100** | 8.6 / 9.0 / 9.1                                                                 | 734 (324)            | 0        | 0              | 7.6 10.4 17.8 | 8.7 10.2 17.0  | 10.0   | mildly contended |
| (b) 5 simultaneous HEIC  | 5/5         | 3.0 / 4.9 / 4.9                                                                 | 634 (321)            | 0        | 0              | 6.1 13.7 22.0 | 6.7 13.7 21.9  | 6.7    | quiet            |
| (b) 20 simultaneous HEIC | 20/20       | 10.3 / 20.0 / 21.0                                                              | 766 (311)            | 0        | 0              | 6.6 13.5 21.8 | 8.1 13.4 21.6  | 8.4    | mildly contended |
| (c) 199.5 MiB video      | 1/1         | 0.71                                                                            | 307, flat (307)      | 0        | 0              | 5.6 13.7 22.0 | 5.6 13.7 22.0  | 5.6    | quiet            |

What the quiet host changes:

- **(a) mixed.** With a quieter host there were **no Storage `544`s**, the success rate was
  100%, and the finalise p95 dropped from 21 to 27 s to **7.9 s**.
  - The remaining tail is the HEIC queue. 20 HEIC finalises took about 0.94 s each, back to
    back, so the last one waited about 7 s.
  - JPEG, PNG and WebP finalise p95 was 1.05 s, and video p95 was 0.24 s.
  - Server-side Storage Range p95 was 0.19 s and PostgREST p95 was 0.02 s.
  - **Peak RSS was 1.29 GiB, close to the contended 1.33 GiB.** Memory depends on concurrency,
    not on host load.
  - Transfers: p50 0.15 s, p95 0.8 s. Reserve p95 was 0.11 s.
- **(a) all-HEIC.** 100 decodes ran strictly one at a time, back to back, at about
  0.87 s p50 each (88 s wall).
  - Each tab's finalises queue behind one another. The wait for the other slot's Server
    Action was p95 8.7 s, so a 10-photo iPhone batch took about 17 to 18 s per file
    end to end.
- **(b) queue wait.** The wait is linear: 0.09, 0.96, 1.95, 2.94 and 3.88 s for 5 requests
  (solo finalise 1.06 s). With 20 requests it ran from 0.6 to 20.0 s, about 0.96 s per
  position.
  - Only the last few requests in the 20-burst waited past the 15 s per-attempt limit. The
    one 0.8 s idle gap in the worker log is a request re-queueing through finalise's
    busy-retry. All of them finished, the last at 21.0 s.
  - No `decode_timeout` occurred.
- **(c) video.** Finalise took 0.71 s: two Range GETs at about 0.34 s each. Memory stayed flat
  at 307 MiB.

## Exploratory results (contended host, kept for the before/after comparison)

All runs in this section are **contended**. The 1-minute load at the start and end of each run
was:

| Run                      | 1-min load (start, end) |
| ------------------------ | ----------------------- |
| (a) run 1                | 32.1, 28.1              |
| (a) run 2                | 29.6, 27.7              |
| (a) after the fix        | 22.1, 33.6              |
| (a) HEIC, before the fix | 26.8, 33.3              |
| (a) HEIC, after the fix  | 29.6, 15.9              |
| (b) 5, before the fix    | 27.3, 33.5              |
| (b) 5, after the fix     | 33.0, 31.2              |
| (b) 10, before the fix   | 30.6, 32.7              |
| (b) 20, before the fix   | 28.6, 34.6              |
| (b) 20, after the fix    | 30.9, 24.7              |
| (c) run 1                | 27.2, 31.2              |
| (c) run 2                | 14.3, 14.1              |

These runs recorded only the 1-minute value, at start and end.

### (a) 10 staff, each uploading a 10-file mixed batch, 2 transfers at once per tab

Each batch has 3× 12 MP JPEG, 1× 8 MP JPEG, 1× PNG, 1× WebP, 2× HEIC, the 19.5 MB MP4 and the
small MOV. That is 100 files per run: 60 JPEG/PNG/WebP, 20 HEIC and 20 videos.

| Run                    | Ready  | Finalise p50 / p95 / max (s) | HEIC finalise p50 / p95 (s) | Peak RSS (MiB, idle ~305) | Next 5xx | Failures                             |
| ---------------------- | ------ | ---------------------------- | --------------------------- | ------------------------- | -------- | ------------------------------------ |
| run 1 (before the fix) | 98/100 | 0.72 / 20.9 / 25.5           | 5.7 / 20.9                  | **1331**                  | 0        | 2× Storage PUT `544 DatabaseTimeout` |
| run 2 (before the fix) | 90/100 | 1.66 / 22.9 / 31.6           | 6.3 / 16.5                  | 1045                      | 0        | 8× reserve sign `544`, 2× PUT `544`  |
| after the HEIC fix     | 97/100 | 0.72 / 26.9 / 50.4           | 4.6 / 27.3                  | **1325**                  | 0        | 3× reserve sign `544`                |

- **Every failure in (a) came from local Storage's own Postgres pool.** Storage answered
  `544 DatabaseTimeout` in `testPermission` or `findBucketById`. NabaLens returned these to
  the client as values ("Could not prepare the upload. Try again."). Next itself returned no
  5xx in any mixed-batch run.
- **Slow finalises wait on Storage, not on CPU.** In the same runs, server-side Storage
  Range-read p95 was 3.9 to 4.4 s, with a maximum of 17 to 28 s. Storage POST p95 was 6 to
  8 s. PostgREST stayed under 0.6 s at p95. The slowest finalises in run 1 were the first
  wave: 7 finalises started within 0.4 s and took 15 to 25 s, including a 2 MP PNG.
- **Peak RSS was 1.33 GiB, twice.** At that moment up to 10 finalises (one per tab) were
  running at once. JPEG, PNG and WebP decode in-process with sharp: a 12 MP image is about
  46 MiB of raw RGBA before resizing. One HEIC worker (about 300 MiB) can run alongside them.
- **Per-tab serialisation costs time.** Because a tab sends one Server Action at a time, a
  slow finalise holds up the other transfer slot's reserve or finalise. The wait was p95
  2.8 to 8.6 s in the mixed batches and 9.6 s in the all-HEIC batch.

**All-HEIC batch** (`--batch heic`): 10 staff × 10 × 12 MP HEIC. This is the realistic worst
case for a team on iPhones.

| Run            | Ready       | HEIC finalise p50 / p95 / max (s) | Peak RSS (MiB) | Wall  | Notes                                                                                                                                                                 |
| -------------- | ----------- | --------------------------------- | -------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| before the fix | 69/100      | 23.4 / 62.8 / 72.0                | 699            | 280 s | 8× "server is busy", 5× Next 500 on `reserveUpload`, 4× "could not save", 6× "could not check". Postgres in the stack was starved (a checkpoint took 56 s of writes). |
| after the fix  | **100/100** | 9.1 / 12.6 / 17.5                 | 710            | 117 s | 100 decodes back to back, never more than one at a time.                                                                                                              |

The host was less loaded during the "after" run (load average 30 falling to 16), so this pair
is **not a clean A/B test**. Use the controlled burst in (b) for that.

### (b) Simultaneous 12 MP HEIC finalises (HEIC concurrency 1)

Each simulated staff member uploads one HEIC. Then all of them call `finaliseUpload` in the
same instant.

| Burst      | Ready     | Finalise p50 / p95 / max (s) | Decode per HEIC (worker start to exit) | Idle decoder gaps between jobs                | Peak RSS (MiB) |
| ---------- | --------- | ---------------------------- | -------------------------------------- | --------------------------------------------- | -------------- |
| 5, before  | 5/5       | 4.5 / 9.4 / 9.4              | 1.00 s p50                             | 0.04, 0.56, 1.14, 1.94 s                      | 618            |
| 5, after   | 5/5       | 3.1 / 4.9 / 4.9              | 0.93 s                                 | 0, 0, 0, 0 ms                                 | 533            |
| 10, before | 10/10     | 22.0 / 26.4 / 26.4           | 0.96 s                                 | up to 2.9 s                                   | 575            |
| 20, before | **9/20**  | 23.3 / 23.3 / 24.0           | 0.95 s                                 | 2.0, 0.3, 0.7, 1.2, 1.3, 2.1, 2.5, 3.0, 3.5 s | 785            |
| 20, after  | **20/20** | 9.4 / 17.7 / 18.6            | 0.89 s                                 | 0 to 1 ms, one gap of 0.4 s                   | 759            |

- **Queue wait.** With one worker, a request's queue wait is its finalise latency minus a
  solo finalise (1.0 to 1.4 s on an idle server; one outlier of 7.2 s). Waits grow by about one decode (~0.9 to
  1.0 s) per request ahead in the queue.
- **Before the fix,** the wait came from polling. Waits were 0.96, 1.7, 3.1, 4.8 and 8.1 s
  for 5 requests. With 20 requests, 11 failed after about 23 s with "The server is busy
  processing photos. Try again."
- **Timeouts.** No HEIC worker hit its 15 s `decode_timeout` in any run. The failures came
  from the polling retry budget, not from the decoder.

### (c) Finalise of a 200 MiB video

| Run   | Transfer (TUS, direct to Storage) | Finalise | RSS during finalise (MiB)      | Server-side reads                       |
| ----- | --------------------------------- | -------- | ------------------------------ | --------------------------------------- |
| run 1 | 23.5 s                            | 12.3 s   | 283 peak (idle 305), no growth | 1 HEAD + 2 Range GETs, 266 KiB in total |
| run 2 | 2.2 s                             | 0.9 s    | 302 to 303                     | 1 HEAD + 2 Range GETs (0.40 and 0.46 s) |

Video finalise memory does not depend on file size. `probeVideo` reads the 256 KiB head block
and the `moov` box at the end of the file. The 200 MiB of bytes never pass through Next: the
browser sends them straight to Storage over TUS.

The 12.3 s in run 1 was spent entirely in local Storage. A 256 KiB Range GET on the 200 MiB
object took 0.6 to 18 s, against 15 to 50 ms on a 2.8 MB object. Locally the file backend's
cost grows with object size. Hosted Storage is S3-backed and was not measured.

## Defects found

1. **Fixed: HEIC slot polling starved requests and left the decoder idle.**
   - _Cause._ `lib/media/heic.ts` threw `decoder_busy` immediately when the single slot was
     taken. `finaliseAsset` retried 8 times, sleeping 1.0 to 4.5 s (22 s in total), and every
     waiter used the same schedule. The decoder then sat idle between jobs, the request that
     won each slot was random, and late arrivals ran out of retries.
   - _Minimal repro._ Run `node tests/load/run.mjs --workdir "$W" --fixtures "$F" --scenario b --heic 20`.
     Before the fix, 9 of 20 were ready and 11 failed with "busy". Unit level: three
     concurrent `processImage(heic)` calls, where the 2nd and 3rd rejected at once.
   - _Fix_ (inside `lib/media` worker queueing only). Callers now wait for the slot in arrival
     order, for at most one decode deadline (`heicTimeoutMs`, 15 s), and then get
     `decoder_busy` as before. The queue holds only resolvers, because each caller already
     holds its own bytes. Concurrency stays at 1.
   - _Changed files._ `lib/media/heic.ts`. In `tests/media/review.test.ts`, the immediate-busy
     test was replaced by a FIFO-order test and a bounded-wait test. One paragraph in
     `docs/media-pipeline.md`.
   - _Result._ 20 of 20 were ready, and the HEIC batch went from 69/100 to 100/100.

2. **Open (slice owns `lib/server/media/finalise.ts`): the retry loop now multiplies the wait.**
   `BUSY_RETRIES = 8` was sized for an immediate `decoder_busy`. Each attempt can now wait up
   to 15 s. Under sustained overload, the worst case grows from about 40 s to about 170 s
   (9 × 15 s waits + a 15 s decode + 22 s of sleeps). This never happened in these runs: the
   maximum HEIC finalise after the fix was 27.7 s. Suggestion: lower `BUSY_RETRIES` to 1 or
   2 (worst case about 50 to 70 s), and set the page `maxDuration` below.

3. **Open (foundation `lib/auth/profile.ts` / slice actions): a failed profile read becomes
   an HTTP 500.**
   - When PostgREST returned 500 on the profile read (stack starved, all-HEIC "before" run),
     `loadProfile` threw. `reserveUpload` then answered HTTP 500 with a digest instead of a
     `{ ok: false, message }` value.
   - The browser's `createUploader` catches this as "Could not start the upload." and marks
     it retryable, so users are not stuck. It is still a 5xx in logs, and the cause is lost.
   - _Repro._ Make PostgREST fail the `profiles` select, for example by pausing the db
     container for longer than PostgREST's timeout, then call `reserveUpload`.

4. **Local stack only, not a NabaLens defect.**
   - Local Storage's Postgres pool returns `544 DatabaseTimeout` when about 20 sign/PUT
     requests arrive at once on this loaded host.
   - Range-read latency on the file backend grows with object size.
   - In one 20-HEIC run, all 20 whole-object Range GETs stalled for 30 s, until the
     `fetchRange` timeout ended them, and all 20 finalises returned "Could not check this
     file right now". `tests/load/storage-range-burst.mjs` did **not** reproduce this in
     isolation: 20 concurrent reads took 0.8 to 1.1 s.
   - **Check hosted Storage's connection pool for the chosen plan in staging.**

## Recommended staging settings (Vercel-style Node functions)

These are starting points chosen from these local numbers. Verify each one on the deployed
Linux function.

| Setting                                                           | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                                                           | Node.js. `lib/media` needs `worker_threads`, sharp and WASM.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Function memory                                                   | **2 GiB minimum.** Measured peak was 1.29 GiB on the quiet host and 1.33 GiB under contention, with 10 concurrent finalises in one process (idle about 300 MiB, HEIC-only bursts 0.53 to 0.79 GiB). That leaves about 1.5× headroom. If one instance will regularly handle more than about 10 concurrent image finalises, use about 3 to 4 GiB, or keep the per-instance request concurrency low. Linux glibc and sharp memory behaviour differs from macOS, so re-measure RSS there.   |
| `maxDuration` on `app/staff/page.tsx` (covers its Server Actions) | **300 s** while finalise keeps 8 busy-retries. Local finalise maximum was 21 s on the quiet host (the last of 20 simultaneous HEICs) and 50 s under contention (Storage-bound). The code-bounded worst case is about 170 s plus Storage reads (each `fetchRange` can take 30 s, with one retry on 5xx). If slice lowers `BUSY_RETRIES` to 1 or 2, use **120 s**. Never go below about 60 s: a killed finalise leaves the asset in `processing` until the 2-minute stale-claim takeover. |
| HEIC concurrency (`maxHeicConcurrency`)                           | **Keep at 1 per instance** at 2 GiB. Throughput is about 1.1 decodes per second per instance for 12 MP (0.87 to 0.94 s each on the quiet host) (M5 Pro; expect slower on a function vCPU). 100 iPhone photos therefore take about 100 s of decoding on one instance. Raise it to 2 only after measuring Linux RSS with 3 to 4 GiB.                                                                                                                                                      |
| Instance concurrency                                              | Memory scales with concurrent in-process sharp decodes of JPEG, PNG and WebP (about 46 MiB of raw RGBA per 12 MP image, plus the libvips working set). If the platform allows a per-instance concurrency cap, about 10 matches the measured 1.33 GiB at 2 GiB.                                                                                                                                                                                                                          |
| Request body                                                      | Not a limit here: originals go straight to Storage (signed PUT or TUS). Only Server Action payloads reach the function.                                                                                                                                                                                                                                                                                                                                                                 |

## How to run

```sh
W=$(node tests/load/prepare-stack.mjs)        # project nabalens-load, ports 615xx
supabase --workdir "$W" start -x imgproxy,postgres-meta,vector,logflare,supavisor
F=$(node tests/load/fixtures.mjs)              # synthetic fixtures in $TMPDIR (~260 MB)
node tests/load/stack-env.mjs "$W" pnpm build  # build against the load stack
node tests/load/run.mjs --workdir "$W" --fixtures "$F" --scenario all \
  --out tests/load/results/<name>.json
# options: --scenario a|b|c|a,b  --staff 10  --batch mixed|heic  --heic 5  --parallel-actions
node tests/load/storage-range-burst.mjs "$W" 20 sequence   # Storage-only repro
supabase --workdir "$W" stop
```

The runner starts and stops its own `next start` on port 3615 for each scenario. It warms the
server with one upload, then creates throwaway `load-*@nabalens.test` staff in the
`DEV FIXTURE Venue A` venue.
