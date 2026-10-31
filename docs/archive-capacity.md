# Archive audit capacity

Measured and modelled on 31 October 2026 on a Mac (Apple silicon, Node 24.16),
with no production access. **Throughput and latency of real R2 and of a Vercel
function were not measured.** They are assumptions, listed in
[Assumptions](#assumptions), and the model shows what happens if they are wrong.
[Measure on staging](#measure-on-staging) gives the procedure that replaces them
with real numbers.

The question: does the archive audit verify every retained original often
enough, as the library grows? The contract target
(`docs/workstreams/contracts.md` §4.1) is a full verification cycle in at most
**24 hours** of wall time, under the unchanged **26-hour** `ARCHIVE_MAX_AGE_MS`.

## Summary

| Question                                      | Answer                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the loop at `ff829e9` scale?             | No. It verifies 50 receipts an hour, 1,200 a day. A cycle reaches 24 h at **1,200 receipts** and 26 h at 1,300. On slow R2 a run needs about 80 s, so 55% of runs hit the 80 s abort and record a failure.                                                 |
| Did the first proposed defaults meet 24 h?    | No. Cron every 10 min, 60 s soft budget, 4 workers and batches with a barrier give about 350 receipts a run (about 130 slow). Max library for a 24 h cycle: 45,000 receipts (16,600 slow). The expected library passes that at month 14 (month 5 slow).    |
| Recommended budget                            | Cron every 10 min, soft budget 480 s, hard deadline 540 s, `maxDuration` 600, lease TTL 600 s, 8 workers, pipelined, checkpoint every 20 receipts, back-fill 5 a run, new cycle no sooner than 12 h after the last started. (Adopted into contracts §4.3.) |
| Does it meet 24 h with headroom at 24 months? | Expected library (75,000 receipts, 0.89 TB): D = 3.0 h nominal, 6.1 h slow. Yes, 8× and 4× headroom. High library (221,000 receipts, 3.3 TB): D = 10.9 h nominal (2.2× headroom), 22.4 h slow (**1.07×, no real headroom**).                               |
| When does it stop being enough?               | D crosses the 14 h freshness limit at month **31** (High, nominal), month **15** (High, slow), month **116** (Expected, nominal) and month **56** (Expected, slow). See [When D crosses 14 h](#when-d-crosses-14-h-20-h-and-24-h).                         |
| Cost                                          | About **$12 a month** (Expected) to **$49 a month** (High) at 24 months with the 12 h throttle; $55 to $57 without it. R2 egress is free.                                                                                                                  |
| Database                                      | `media_archive_missing_count()` and `media_archive_backfill_candidates()` are O(N): about 0.2 s at 221,000 receipts, 1.2 s at 1.1 million (local). No index needed through the High 24-month library.                                                      |

Sampling is not used in any recommendation. If full verification becomes
unaffordable or too slow, replacing it with sampling or a longer maximum age is a
**decision for the owner**, not a tuning choice (see [Past the growth point](#past-the-growth-point)).

## What was measured and what was modelled

| Item                                              | How                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-receipt software overhead                     | **Measured.** The verification loop runs against an in-process fake `ArchiveStore` with real SHA-256 work (`scripts/archive/capacity/measure.ts`).                    |
| Checkpoint and lease cost                         | **Measured** in the same harness with injected database latency, and **measured** server side on the `ws2` local Postgres for the real table shapes (`db-timing.sh`). |
| Model against real loops                          | **Checked.** The in-process loops run in real time and are compared with the model's simulation at the same parameters.                                               |
| R2 latency and throughput, Vercel instance limits | **Assumed**, with a slow, nominal and fast profile.                                                                                                                   |
| Library growth, size mix, upload rates            | **Assumed**, in four scenarios anchored on repo documents.                                                                                                            |
| Prices                                            | **Published**, cited below with the date read.                                                                                                                        |

## Assumptions

Every number below is an input to `scripts/archive/capacity/model.ts`. Change it
there and rerun the report.

### Library

- **Current size is unknown.** The repo does not state it and this work must not
  read production. The model starts every scenario at **2,000 assets**. If the
  live library already holds more than about 1,300 receipts, today's loop
  cannot keep the 26 h age.
- **One receipt per upload.** A receipt is one row of `media_archive_receipts`, and
  the cycle verifies one blob GET and one manifest GET per receipt (§4.1).
- **Scale anchors.** At most 100 staff across 10 venues
  (`docs/INFRASTRUCTURE.md`, `docs/spec/NabaLens-MVP-Execution-v0.2.md`). The
  cost document sizes 50 GB, 250 GB and 1 TB of media. The Expected scenario
  reaches 0.89 TB at 24 months, close to the 1 TB case.
- **File sizes.** Photos: 2.8 MB (35%), 5.5 MB (55%), 15 MB (10%). The first two are
  the 8 MP and 12 MP fixtures in `docs/runtime-sizing.md`, and the 15 MB tail sits
  under the 20 MiB photo cap. Videos: 19.5 MB (50%), 80 MB (35%), 209.7 MB
  (15%, the 200 MiB cap `maxVideoBytes`). Mean photo 5.5 MB, mean video 69.2 MB.
- **Duplicate blobs.** 2% of receipts share a blob with another receipt.
  Originals are content-addressed, so identical files share one blob and keep
  separate manifests.

| Scenario | Start                | Uploads a day | Video share | Receipts at 12 / 24 months | Bytes at 24 months |
| -------- | -------------------- | ------------- | ----------- | -------------------------- | ------------------ |
| Low      | 2,000                | 30            | 5%          | 12,958 / 23,915            | 208 GB             |
| Expected | 2,000                | 100           | 10%         | 38,525 / 75,050            | 891 GB             |
| High     | 2,000                | 300           | 15%         | 111,575 / 221,150          | 3.33 TB            |
| Stress   | 20,000 (bulk import) | 1,500         | 20%         | 567,875 / 1,115,750        | 20.4 TB            |

The **representative library** for the contract target is **Expected at 24
months: 75,050 receipts, 0.89 TB.** High is the design headroom case.

### Speed profiles

| Profile | R2 first byte (lhr1) | One stream | One instance, all streams | DB call (lhr1 to eu-west-2) | Fixed per run | Source read | R2 PUT  |
| ------- | -------------------- | ---------- | ------------------------- | --------------------------- | ------------- | ----------- | ------- |
| slow    | 150 ms               | 20 MB/s    | 60 MB/s                   | 30 ms                       | 4 s           | 20 MB/s     | 20 MB/s |
| nominal | 60 ms                | 50 MB/s    | 120 MB/s                  | 8 ms                        | 2 s           | 50 MB/s     | 40 MB/s |
| fast    | 30 ms                | 100 MB/s   | 250 MB/s                  | 4 ms                        | 1 s           | 100 MB/s    | 80 MB/s |

- "Fixed per run" covers cold start, lease, state read, candidate query, receipts
  page, missing count and release.
- The instance limit stands for one vCPU (Vercel's default is 2 GB and 1 vCPU,
  [limits](https://vercel.com/docs/functions/limitations)) hashing and decrypting
  every stream. The hash alone runs at 2.7 GB/s on the test Mac, so the
  limit is a network and shared-CPU guess, not a hashing limit.
- Function-side R2 throughput from Vercel `lhr1` is not published. It is the
  assumption that most needs a real measurement.

### Run shape and schedule

- **10% of scheduled runs are lost.** Vercel cron delivery is best effort: runs can
  be missed or repeated and are not retried
  ([cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), read
  31 Oct 2026). A repeated run finds the lease held and returns `locked`.
- **Cycle duration `D`** is the number of runs needed to cover the library,
  divided by 90% and multiplied by the cron interval. It includes the final
  partial run.
- Verification order is the receipt id order. A run starts no new receipt after
  its soft budget and lets in-flight reads finish.
- Every run is modelled with five back-fills, which is pessimistic: steady state
  has almost none.

### Cost inputs

- Function memory 2 GB. CPU 3 s per GB read (SHA-256 at about 500 MB/s per vCPU
  plus TLS and stream handling). This is the largest cost input and is a guess.
- R2 reads are two Class B operations a receipt (blob and manifest), counted per
  receipt even when blobs are shared, which slightly overstates operations.
- Vercel does not bill the audit's outbound-to-R2 reads as CDN data transfer, to
  the best of this research. The pages read state billing for Active CPU,
  Provisioned Memory and invocations only. **Confirm on the first invoice.**

## Current behaviour

Source: `lib/server/archive/audit.ts` at `ff829e9` and `vercel.json`.

- Cron at minute 43 of every hour.
- Per run: up to 10 back-fills, then up to 50 receipts, one at a time. Each receipt
  does a blob GET (full body hashed), a manifest GET and a database checkpoint.
- One shared 80 s abort covers back-fill and verification. When it fires, the run
  records `last_error` and the route answers 500.

| Speed   | Back-fill 10 | Verify 50 | Whole run | Runs over 80 s | Receipts a day | Library where a cycle reaches 24 h | Library where it reaches 26 h |
| ------- | ------------ | --------- | --------- | -------------- | -------------- | ---------------------------------- | ----------------------------- |
| slow    | 27.4 s       | 48.7 s    | 80.2 s    | **55%**        | 1,200          | 1,200 receipts                     | 1,300 receipts                |
| nominal | 11.5 s       | 19.3 s    | 32.8 s    | 0%             | 1,200          | 1,200 receipts                     | 1,300 receipts                |
| fast    | 5.7 s        | 9.6 s     | 16.4 s    | 0%             | 1,200          | 1,200 receipts                     | 1,300 receipts                |

The 1,200 and 1,300 limits come from the 50-receipt cap and are independent of the
speed profile. They are 12 days of Expected uploads from an empty library. With
the 10% lost runs they fall to 1,050.

## Candidate schedules

Receipts verified per run and the largest library whose cycle fits 24 hours, with
10% video. "Barrier" means each batch waits for its slowest receipt before the
next batch starts. "Pipelined" means workers pull receipts continuously and the
checkpoint follows the contiguous verified watermark.

### Nominal speed

| Policy                                              | Receipts per run | Run time mean / worst | Worker idle at barriers | Max library for a 24 h cycle |
| --------------------------------------------------- | ---------------- | --------------------- | ----------------------- | ---------------------------- |
| current (hourly, 50 receipts, c=1)                  | 50               | 35 s / 41 s           | 0%                      | 1,050                        |
| first proposal (10 min, 60 s soft, c=4, batch 20)   | 349              | 61 s / 62 s           | 30%                     | 44,965                       |
| 60 min, 750 s soft, c=4, barrier                    | 4,960            | 752 s / 753 s         | 30%                     | 104,160                      |
| 15 min, 600 s soft, c=4, barrier                    | 3,940            | 601 s / 603 s         | 30%                     | 338,803                      |
| 10 min, 480 s soft, c=4, barrier                    | 3,138            | 482 s / 484 s         | 30%                     | 404,746                      |
| 10 min, 480 s soft, c=8, barrier                    | 3,295            | 482 s / 483 s         | 50%                     | 425,018                      |
| 10 min, 480 s soft, c=4, pipelined                  | 4,303            | 481 s / 483 s         | 0%                      | 555,105                      |
| **recommended: 10 min, 480 s soft, c=8, pipelined** | **4,742**        | 483 s / 485 s         | 0%                      | **611,754**                  |
| 10 min, 240 s soft, c=8, pipelined                  | 2,319            | 244 s / 246 s         | 0%                      | 299,095                      |
| 5 min, 240 s soft, c=8, pipelined                   | 2,319            | 244 s / 246 s         | 0%                      | 600,510                      |

### Slow speed

| Policy                                              | Receipts per run | Run time mean / worst  | Max library for a 24 h cycle |
| --------------------------------------------------- | ---------------- | ---------------------- | ---------------------------- |
| current (hourly, 50 receipts, c=1)                  | 45               | 79 s / 80 s (57% over) | 939                          |
| first proposal (10 min, 60 s soft, c=4, batch 20)   | 129              | 65 s / 68 s            | 16,585                       |
| 15 min, 600 s soft, c=4, barrier                    | 1,637            | 605 s / 612 s          | 140,794                      |
| 10 min, 480 s soft, c=4, barrier                    | 1,273            | 486 s / 491 s          | 164,253                      |
| 10 min, 480 s soft, c=4, pipelined                  | 1,913            | 482 s / 486 s          | 246,758                      |
| **recommended: 10 min, 480 s soft, c=8, pipelined** | **2,313**        | 488 s / 492 s          | **298,340**                  |
| 10 min, 240 s soft, c=8, pipelined                  | 1,089            | 248 s / 253 s          | 140,462                      |
| 5 min, 240 s soft, c=8, pipelined                   | 1,089            | 248 s / 253 s          | 282,014                      |

Three effects drive the table:

1. **Run length matters more than frequency.** Each run pays a fixed start-up
   cost, the back-fills and a tail reserve for the last 200 MiB video. Longer
   runs spend a larger share of their time verifying.
2. **Batch barriers waste 30% to 50% of the worker time.** In a batch of 20
   receipts, three or four workers wait for one 200 MiB video. Pipelining removes
   the wait. The real barrier loop in the harness verified 20% fewer receipts than
   the model predicts for it (153 against 191), so the first proposal is worse than
   the table shows.
3. **Concurrency helps until the instance limit.** Latency, not bytes, dominates
   photos: a 5.5 MB photo needs 170 ms of body and 120 ms of first-byte waits
   (two GETs) at nominal speed. Eight workers hide that wait.

### Cron interval and soft budget (pipelined, 8 workers, 10% video)

Max library for a 24 h cycle. `n/a`: the soft budget plus 30 s does not fit the interval.

| Cron interval   | 60 s soft | 120 s soft | 240 s soft | 480 s soft | 750 s soft |
| --------------- | --------- | ---------- | ---------- | ---------- | ---------- |
| nominal, 5 min  | 135,124   | 284,456    | 600,510    | n/a        | n/a        |
| nominal, 10 min | 67,301    | 141,678    | 299,095    | 611,754    | n/a        |
| nominal, 15 min | 44,867    | 94,452     | 199,397    | 407,836    | 640,061    |
| nominal, 60 min | 10,955    | 23,064     | 48,690     | 99,588     | 156,294    |
| slow, 5 min     | 58,682    | 132,571    | 282,014    | n/a        | n/a        |
| slow, 10 min    | 29,227    | 66,029     | 140,462    | 298,340    | n/a        |
| slow, 15 min    | 19,485    | 44,019     | 93,641     | 198,893    | 316,553    |
| slow, 60 min    | 4,758     | 10,749     | 22,866     | 48,567     | 77,298     |

An hourly cron reaches the Expected 24-month library on slow R2 only with a 750 s
run (77,298 against 75,050, 3% headroom) and fails at 480 s (48,567). Pro allows up
to 800 s ([duration limits](https://vercel.com/docs/functions/configuring-functions/duration),
read 31 Oct 2026).

## Recommended budget

Adopted in contracts §4.3 and implemented by Audit.

| Constant            | Value                                          | Why                                                                                                                                       |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cron                | `*/10 * * * *` (600 s)                         | Ten-minute runs recover a lost run quickly. `not_running` fires at 3 intervals (30 min).                                                  |
| Soft budget         | 480 s                                          | 80% of the interval: no new receipt after it. The next cron firing finds the lease free.                                                  |
| Hard deadline       | 540 s                                          | At least 30 s over the soft budget: in-flight 200 MiB reads need about 10 s on slow R2.                                                   |
| Route `maxDuration` | 600 s                                          | At least 60 s over the hard deadline. Pro allows 800 s.                                                                                   |
| Lease TTL           | 600 s                                          | Longer than the hard deadline (§4.3). The audit renews it at each checkpoint.                                                             |
| Concurrency         | 8                                              | Hides first-byte latency. 8 streams use 8 of the 1,024 shared file descriptors ([limits](https://vercel.com/docs/functions/limitations)). |
| Checkpoint          | every 20 receipts, at the contiguous watermark | One database call per 20 receipts instead of one per receipt. A crash re-verifies at most one window.                                     |
| Back-fill           | 5 a run                                        | Steady state has none. Raising it only starves verification.                                                                              |
| Cycle throttle      | next cycle 12 h after the last started         | Cuts read cost 20× (Low) and 4.8× (Expected) at 24 months, and 1.1× (High, where cycles are already long). See [Cost](#cost).             |

### Headroom

Library sizes at 24 months against the largest library that completes a cycle in
24 h (`maxReceipts`, which uses each scenario's own video share).

| Scenario | Receipts at 24 mo | Nominal: D at 24 mo, headroom | Slow: D at 24 mo, headroom |
| -------- | ----------------- | ----------------------------- | -------------------------- |
| Low      | 23,915            | 0.7 h, 35×                    | 1.5 h, 17×                 |
| Expected | 75,050            | 3.0 h, 8.2×                   | 6.1 h, 4.0×                |
| High     | 221,150           | 10.9 h, 2.2×                  | **22.4 h, 1.07×**          |
| Stress   | 1,115,750         | 67 h (fails)                  | 138 h (fails)              |

Headroom is the 24 h library limit divided by the library size. High on slow R2
meets 24 h by 7% only, and then not for the freshness limit below.

### When D crosses 14 h, 20 h and 24 h

Contracts §4.3 (the age rule): with the 12 h cycle throttle, the age of
`last_complete_at` stays under 26 h only while the cycle duration `D` stays under
about **14 h**. In the worst case the age is about
`max(12 h, D_prev) + (D_new − D_prev)`. `cycle_slow` (a non-paging warning at
`lastCycleDurationSeconds` above 20 h) is the early sign, and `stale` fires at
26 h. Library size and month where the recommended budget reaches each point:

| Speed   | Scenario | D = 14 h                      | D = 20 h (`cycle_slow`) | D = 24 h (target)    |
| ------- | -------- | ----------------------------- | ----------------------- | -------------------- |
| nominal | Low      | 483,675 receipts, beyond 10 y | 696,492, beyond 10 y    | 831,921, beyond 10 y |
| nominal | Expected | 355,671, **month 116**        | 512,166, beyond 10 y    | 611,754, beyond 10 y |
| nominal | High     | 281,453, **month 31**         | 405,293, month 44       | 484,100, month 53    |
| nominal | Stress   | 232,007, **month 4.6**        | 334,090, month 6.9      | 399,052, month 8.3   |
| slow    | Low      | 235,157, beyond 10 y          | 338,626, beyond 10 y    | 404,470, beyond 10 y |
| slow    | Expected | 173,453, **month 56**         | 249,773, month 81       | 298,340, month 97    |
| slow    | High     | 137,303, **month 14.8**       | 197,717, month 21.4     | 236,162, month 25.6  |
| slow    | Stress   | 112,167, **month 2.0**        | 161,521, month 3.1      | 192,928, month 3.8   |

| Speed   | Scenario | D at 12 months | D at 24 months | D at 36 months |
| ------- | -------- | -------------- | -------------- | -------------- |
| nominal | Expected | 1.7 h          | 3.0 h          | 4.4 h          |
| nominal | High     | 5.6 h          | 10.9 h         | 16.5 h         |
| slow    | Expected | 3.1 h          | 6.1 h          | 9.1 h          |
| slow    | High     | 11.3 h         | 22.4 h         | 33.5 h         |

Reading it: **the representative (Expected) library keeps D under 14 h for more
than four years even on slow R2.** The High case on slow R2 reaches 14 h at about
month 15 and `cycle_slow` at month 21. That is why the real throughput must be
measured before month about 12.

The freshness rule also depends on how fast D grows: a bulk import can push D past
14 h at once. Check the library after an import against the 14 h column above
(about 356,000 receipts nominal or 173,000 slow at 10% video) before the next
cycle starts.

### Past the growth point

The recommended settings stop being enough when `cycle_slow` fires, or when a
re-measured throughput moves a crossing month inside the next year. Options, in
order of preference:

1. **Measure first.** If real throughput beats the slow profile, nothing changes.
2. **More throughput per run, no contract change.** Raise concurrency to 12 or 16
   if the instance limit measured above is higher than the model's 120 MB/s. Set
   a 4 GB / 2 vCPU function for this route (Vercel allows 4 GB on Pro) and
   hash on worker threads. Raise the soft budget to 750 s with `maxDuration` 800
   (Pro allows 800 s), which lifts the nominal limit by 1.6×.
3. **Shard by receipt id.** Two or more leases and two cron entries, each cycle
   covering an id range, multiply throughput. This changes contracts §4.2 and
   §4.3 and needs Audit, Monitoring and Verification to agree.
4. **Decision for the owner (not recommended):** verifying a sample, or verifying
   each receipt less often, with a maximum age above 26 h. Both weaken the
   current guarantee ("every retained original read back within 26 h"). This is
   not a tuning step and no agent should make it.

## Cost

Prices read on 31 October 2026. Cost covers verification only, not storage of the
originals.

| Item                              | Price                                                                        | Source                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R2 Class B (GET, HEAD), Standard  | $0.36 per million, 10 million a month free                                   | <https://developers.cloudflare.com/r2/pricing/> (page dated 30 Oct 2026)    |
| R2 egress, any class              | Free                                                                         | same page                                                                   |
| R2 Infrequent Access retrieval    | $0.01 per GB, Class B $0.90 per million                                      | same page                                                                   |
| Vercel Active CPU, London `lhr1`  | $0.177 per CPU-hour (billing pauses while waiting on I/O)                    | <https://vercel.com/docs/functions/usage-and-pricing> (updated 16 Jun 2026) |
| Vercel Provisioned Memory, `lhr1` | $0.0146 per GB-hour, billed while a request is in flight                     | same page                                                                   |
| Vercel invocations                | $0.60 per million                                                            | same page                                                                   |
| Cron                              | No separate charge; same function pricing. Pro: once a minute at the fastest | <https://vercel.com/docs/cron-jobs/usage-and-pricing> (updated 15 Jul 2026) |

Pro includes $20 of usage credit a month (`docs/INFRASTRUCTURE.md`), shared with
the rest of the app.

Monthly cost at 24 months, nominal speed, recommended budget:

| Scenario | Next cycle starts as soon as one completes | Next cycle starts 12 h after the last started (recommended) |
| -------- | ------------------------------------------ | ----------------------------------------------------------- |
| Low      | $57 (32 cycles a day, 6.6 TB read a day)   | **$2.77** (2 cycles a day, 407 GB a day)                    |
| Expected | $57 (8 cycles a day, 7.1 TB a day)         | **$12** (2 cycles a day, 1.7 TB a day)                      |
| High     | $55 (2.2 cycles a day, 7.2 TB a day)       | **$49** (2 cycles a day, 6.5 TB a day)                      |

Where the $49 goes: R2 operations $6 (26.7 million Class B, 16.7 million over the
free tier), Vercel CPU and memory about $43. The CPU figure rests on the guess of
3 CPU-seconds per GB; measure it (see below).

Without the throttle, the cursor reset starts a new cycle as soon as one
completes, so a small library is re-read many times a day for nothing. The
throttle is why cost tracks need.

Other cost notes:

- **Identical blobs.** A duplicate blob is read once per cycle at best. At 2%
  duplicates this saves about 2% of bytes. The audit keeps per-receipt
  verification; sharing reads across receipts needs a per-cycle set of verified
  blob keys and is not worth the complexity at this rate.
- **Keep the archive bucket in Standard storage.** Infrequent Access charges
  $0.01 per GB read. Reading 6.5 TB a day for 30 days is about **$2,000 a month**
  at the High 24-month size, against $49 in Standard.
- **Storage dominates in the end.** 3.33 TB in Standard storage costs about $50 a
  month (at $0.015 per GB-month), the same order as verifying it.
- Supabase egress is not part of verification: reads come from R2. Back-fill reads
  from Supabase Storage, but only for stragglers.

## Database

On the `ws2` local stack, in a throwaway schema (`capacity_scratch`) built from
`LIKE public.media_assets` and `LIKE public.media_archive_receipts INCLUDING
ALL`, with synthetic rows (3 ready assets without receipts). Server-side medians
over 15 runs, no network round trip. Production runs on a smaller shared
instance, so multiply by about three for a margin.

| Call                                        | 75,050 receipts | 221,150 receipts | 1,115,750 receipts |
| ------------------------------------------- | --------------- | ---------------- | ------------------ |
| `media_archive_missing_count()`             | 52 ms           | 214 ms           | 1,227 ms           |
| `media_archive_backfill_candidates(10)`     | 56 ms           | 228 ms           | 982 ms             |
| `count(*) where id <= target` (cycle start) | 40 ms           | 132 ms           | 300 ms             |
| Receipts page (20 or 51 rows by id)         | 0.03 ms         | 0.02 ms          | 0.03 ms            |
| `max(id)`                                   | 0.03 ms         | 0.01 ms          | 0.02 ms            |
| Checkpoint `UPDATE` of the state row        | 0.02 ms         | 0.01 ms          | 0.01 ms            |

Both RPCs run a parallel hash anti join over every ready asset on every call, even
when only a few are missing. The receipts page and the checkpoint are index reads
and a single-row update.

**Verdict: no index or query change is needed for 24 months at Expected or High.**
At 221,150 receipts one run spends about 0.2 s on each RPC, against a 480 s
window. Rules that keep it that way:

- Call `media_archive_missing_count()` once per run, at the end, never per batch.
- Call `media_archive_backfill_candidates()` once per run, before verification.
- Run the `count(*) where id <= target` once, at cycle start.
- The status endpoint calls `missing_count` on every monitor poll. At 221,000
  receipts that is 0.2 s a poll; poll no more often than every few minutes.

Past about one million receipts, replace the anti joins with a flag and a partial
index. Measured on the same data, `count(*)` over unarchived ready assets took
**0.06 ms** and the candidates query **0.02 ms**. This is a separate migration,
not part of this change:

```sql
alter table public.media_assets add column archived boolean not null default false;
update public.media_assets a set archived = true
  where exists (select 1 from public.media_archive_receipts r where r.asset_id = a.id);
create index media_assets_unarchived_idx on public.media_assets (created_at, id)
  where upload_state = 'ready' and not archived;
-- plus an AFTER INSERT trigger on media_archive_receipts that sets archived = true
-- for new.asset_id, and both RPCs filtered with `and not archived`.
```

`archived` means "has a receipt", the same meaning as the current `NOT EXISTS`,
because the receipt guard accepts assets in `processing` and `ready`.

## Harness results

Run on one Apple-silicon Mac (shared with other agents), Node 24.16. These are
relative costs, not Vercel numbers.

| Measurement                                                             | Result                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| SHA-256, one thread                                                     | 2,746 MB/s                                          |
| Loop software time per receipt (4 KiB blobs, zero latency, no I/O wait) | sequential 4.6 µs, barrier 5.3 µs, pipelined 3.6 µs |
| GETs per receipt                                                        | 2.0 (blob and manifest)                             |
| Checkpoints per receipt                                                 | sequential 1.000, batch loops 0.050                 |

Software overhead is a few microseconds a receipt, so the loop's cost is its I/O
waits, not its code.

Checkpoint cost with injected database latency (photos only, network instant):

| DB call | Loop                        | Checkpoints per 50 receipts | DB time per receipt | Wall per receipt |
| ------- | --------------------------- | --------------------------- | ------------------- | ---------------- |
| 4 ms    | sequential, checkpoint each | 50                          | 4.71 ms             | 6.71 ms          |
| 4 ms    | pipelined c=8, every 20     | 3                           | 1.59 ms             | 2.57 ms          |
| 8 ms    | sequential, checkpoint each | 50                          | 9.27 ms             | 11.42 ms         |
| 8 ms    | pipelined c=8, every 20     | 3                           | 2.33 ms             | 3.32 ms          |
| 30 ms   | sequential, checkpoint each | 50                          | 32.10 ms            | 34.23 ms         |
| 30 ms   | pipelined c=8, every 20     | 3                           | 5.33 ms             | 6.29 ms          |

A per-receipt checkpoint costs one database round trip per receipt. For a 5.5 MB
photo at 50 MB/s (about 170 ms) that is 5% at 8 ms and 18% at 30 ms. In the
pipelined loop the checkpoint runs in the background and no worker waits for it.
(Timer jitter adds about 0.5 ms to each figure.)

Model check at the harness's own parameters (first byte 20 ms, stream 100 MB/s,
instance 300 MB/s, DB call 5 ms, 10% video, 12 s soft budget; three real runs
against seven simulated):

| Loop                    | Receipts (real) | Receipts (model) | Run time (real) | Run time (model) |
| ----------------------- | --------------- | ---------------- | --------------- | ---------------- |
| sequential, 50 receipts | 50              | 50               | 11.3 s          | 9.8 s            |
| barrier c=4, batch 20   | 153             | 191              | 12.2 s          | 12.6 s           |
| pipelined c=8, batch 20 | 314             | 313              | 13.8 s          | 13.5 s           |

The model matches the pipelined loop and over-predicts the barrier loop by about
20%, which makes the case against barriers stronger. Real runs end up to 1.8 s
after the soft budget because in-flight reads finish; the hard deadline must
leave room for that.

## Reproduce

Everything below runs without network access except the database timing, which
needs the Harness-owned `ws2` stack.

```sh
pnpm install --frozen-lockfile
# Model tables (this document's tables). Sections: assumptions growth current
# schedules breakpoints sweep cost crossing, or all.
pnpm exec tsx scripts/archive/capacity/report.ts --section all
# Add a profile built from real measurements:
pnpm exec tsx scripts/archive/capacity/report.ts --section crossing \
  --measured ttfb=100,stream=30,cap=80,db=15
# In-process loops against a fake ArchiveStore (about 2.5 minutes):
pnpm exec tsx scripts/archive/capacity/measure.ts [--section hash,overhead,checkpoint,validate] [--json]
# Unit tests of the model and loops:
pnpm exec vitest run --project unit tests/unit/archive-capacity-model.test.ts
# Database timing, on the Harness ws2 stack only (refuses any other port):
node "$HARNESS/scripts/ci/stack.mjs" env ws2 --write
scripts/archive/capacity/db-timing.sh [N ...]   # default 75050 221150 1115750; about 6 minutes
```

`db-timing.sh` creates only the `capacity_scratch` schema and drops it on exit. It
never reads or writes `public` rows or `media_archive_audit_state`.

Files: `scripts/archive/capacity/model.ts` (inputs, growth, simulation, cost),
`report.ts` (tables), `fake.ts` (fake store and state), `loops.ts` (the three
loop shapes), `measure.ts` (harness), `db-timing.sql` and `db-timing.sh`,
`staging-probe.ts` (human-run, see below).

## Measure on staging

Run this before month 12, and again whenever `cycle_slow` fires. It replaces the
speed profile with real numbers. Use a staging project and a separate probe
bucket. Do not point it at production.

**A. Probe R2 from the real runtime (about 30 minutes).**

1. In Cloudflare, create a new private bucket whose name contains `probe`,
   `staging` or `capacity` (for example `nabalens-capacity-probe`), in the same
   location as the production archive bucket, and a token scoped to that bucket
   with Object Read & Write. Never reuse the archive token.
2. On the machine you will run from, set:
   `CAPACITY_PROBE_R2_ACCOUNT_ID`, `CAPACITY_PROBE_BUCKET`,
   `CAPACITY_PROBE_R2_ACCESS_KEY_ID`, `CAPACITY_PROBE_R2_SECRET_ACCESS_KEY`.
   The script rejects a bucket name without `probe`, `staging` or `capacity`, and
   rejects the value of `MEDIA_ARCHIVE_R2_BUCKET`.
3. Seed once (16 objects, about 0.4 GB, a few Class A operations):
   `pnpm exec tsx scripts/archive/capacity/staging-probe.ts seed`
4. Read at three concurrencies for 30 s each:
   `pnpm exec tsx scripts/archive/capacity/staging-probe.ts read --seconds 30 --concurrency 1,4,8`
5. Prefer to run step 4 from a Vercel `lhr1` function (a throwaway route in a
   staging preview deployment) rather than a laptop: the model's instance limit is
   a function limit. A laptop run bounds only latency and per-stream speed.
6. Delete the bucket and token afterwards.

The script prints first-byte p50 and p95, aggregate MB/s per concurrency and the
per-stream rate on the 80 MB and 200 MiB objects. Feed them back:

```sh
pnpm exec tsx scripts/archive/capacity/report.ts --section crossing,schedules \
  --measured ttfb=<p50 ms>,stream=<c=1 MB/s>,cap=<c=8 aggregate MB/s>,db=<ms>
```

Replace `db` with a timed PostgREST `UPDATE` from the same region if you have
one; the nominal 8 ms is a guess.

**B. Read real throughput from the audit's own run table (read-only, any time
after launch).** `media_archive_audit_runs` stores one row per invocation with
`started_at`, `finished_at`, `outcome`, `checked` and `bytes_verified`
(contracts §4.2). On the production or staging database, as an operator:

```sql
select date_trunc('day', started_at) as day,
       sum(checked) as receipts,
       round(sum(bytes_verified) / 1e9, 1) as gb,
       round(sum(bytes_verified) / nullif(sum(extract(epoch from finished_at - started_at)), 0) / 1e6, 1) as mb_per_second,
       round(sum(checked) / nullif(sum(extract(epoch from finished_at - started_at)), 0), 1) as receipts_per_second
from public.media_archive_audit_runs
where outcome in ('partial', 'completed_cycle', 'timeout')
  and started_at > now() - interval '14 days'
group by 1 order by 1;
```

Compare `mb_per_second` and `receipts_per_second` with the model. At the Expected
mix the simulated recommended budget verifies about 4,700 receipts (56 GB, about
117 MB/s) in a 480 s run at nominal speed and about 2,300 (28 GB, about 58 MB/s)
at slow speed. If the observed rate is under the slow profile, treat it as the new
slow profile and run the model again.

**C. Also check, once.** On the first Vercel invoice after launch, confirm that
provisioned memory and Active CPU are in line with the cost table, and that no
data-transfer line appears for the audit's reads. Check that the function
configuration is 2 GB and 1 vCPU, as assumed.

## Limits of this analysis

- No real R2 or Vercel measurement. The three speed profiles bracket what seems
  plausible; the truth could sit outside them.
- The library, upload rates and mixes are assumptions. The live library size is
  unknown to this work.
- Simulation uses mean behaviour per receipt class and fair sharing of one instance's
  bandwidth. It does not model R2 rate limiting, connection resets, retries, cold
  starts that exceed 4 s, or other work on the same function instance.
- Receipts that failed verification are not modelled. Verification failures cost
  the same read again and raise `consecutive_failures` (contracts §4.4).
- The freshness rule used here is contracts §4.3 as agreed. A cycle that finishes
  covers receipts verified as early as its start, so the oldest verification a
  complete cycle covers is older than `last_complete_at`; the rule bounds the
  age of `last_complete_at`, which is what the monitor reads.
- Cost excludes storage, Supabase usage and the rest of the app.
