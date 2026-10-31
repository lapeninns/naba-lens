// Capacity model for the archive verification cycle (docs/archive-capacity.md).
// Pure functions, no I/O. Every number here is an assumption or a published
// price, and each one is named so the report can print it.

export const MB = 1_000_000
export const MIB = 1024 * 1024
export const GB = 1_000_000_000
export const HOUR = 3600
export const DAY = 86_400
export const MONTH_DAYS = 30.4375

/** `ARCHIVE_MAX_AGE_MS` in lib/server/archive/audit.ts, and the contract target (§4.1). */
export const MAX_AGE_SECONDS = 26 * HOUR
export const TARGET_CYCLE_SECONDS = 24 * HOUR

export type SizeClass = { name: string; bytes: number; share: number }

// Photo classes follow tests/load/fixtures.mjs (8 MP 2.8 MB, 12 MP 5.5 MB) plus a
// 15 MB tail below the 20 MiB cap. Video classes: the 19.5 MB clip fixture, a
// mid-length clip, and the 200 MiB cap (`maxVideoBytes`).
export const PHOTO_CLASSES: SizeClass[] = [
  { name: "photo-8mp", bytes: 2.8 * MB, share: 0.35 },
  { name: "photo-12mp", bytes: 5.5 * MB, share: 0.55 },
  { name: "photo-large", bytes: 15 * MB, share: 0.1 },
]
export const VIDEO_CLASSES: SizeClass[] = [
  { name: "video-short", bytes: 19.5 * MB, share: 0.5 },
  { name: "video-mid", bytes: 80 * MB, share: 0.35 },
  { name: "video-cap", bytes: 200 * MIB, share: 0.15 },
]

export const MAX_RECEIPT_BYTES = 200 * MIB

export type Scenario = {
  id: string
  label: string
  initialAssets: number
  uploadsPerDay: number
  videoShare: number
  /** Share of receipts whose blob duplicates another receipt's blob. */
  duplicateShare: number
}

// The repo does not state the live library size and this work has no production
// access, so the starting library is an assumption. Per-day rates are anchored on
// "at most 100 staff across 10 venues" (docs/INFRASTRUCTURE.md,
// docs/spec/NabaLens-MVP-Execution-v0.2.md).
export const SCENARIOS: Scenario[] = [
  {
    id: "low",
    label: "Low (30 uploads/day, 5% video)",
    initialAssets: 2_000,
    uploadsPerDay: 30,
    videoShare: 0.05,
    duplicateShare: 0.02,
  },
  {
    id: "expected",
    label: "Expected (100 uploads/day, 10% video)",
    initialAssets: 2_000,
    uploadsPerDay: 100,
    videoShare: 0.1,
    duplicateShare: 0.02,
  },
  {
    id: "high",
    label: "High (300 uploads/day, 15% video)",
    initialAssets: 2_000,
    uploadsPerDay: 300,
    videoShare: 0.15,
    duplicateShare: 0.02,
  },
  {
    id: "stress",
    label: "Stress (1,500 uploads/day, 20% video, 20k bulk import)",
    initialAssets: 20_000,
    uploadsPerDay: 1_500,
    videoShare: 0.2,
    duplicateShare: 0.02,
  },
]

function mean(classes: SizeClass[]): number {
  return classes.reduce((sum, c) => sum + c.bytes * c.share, 0)
}

export const meanBytes = (video: number): number =>
  (1 - video) * mean(PHOTO_CLASSES) + video * mean(VIDEO_CLASSES)

export type Library = { month: number; receipts: number; bytes: number }

/** One receipt per upload. */
export function projectLibrary(s: Scenario, month: number): Library {
  const receipts = Math.round(
    s.initialAssets + s.uploadsPerDay * month * MONTH_DAYS
  )
  return { month, receipts, bytes: receipts * meanBytes(s.videoShare) }
}

export type Speed = {
  id: string
  /** R2 GetObject time to first byte from lhr1, ms. */
  ttfbMs: number
  /** One GET stream, MB/s. */
  streamMBps: number
  /** All streams of one function instance together (1 vCPU hashing, NIC), MB/s. */
  instanceCapMBps: number
  /** One PostgREST call on the audit tables from lhr1 to eu-west-2, ms. */
  dbCallMs: number
  /** Per invocation: cold start, lease, state read, candidate query, receipts page, missing count, release. */
  fixedSeconds: number
  /** Supabase Storage read during backfill, MB/s. */
  sourceMBps: number
  /** R2 PutObject, MB/s. */
  putMBps: number
}

export const SPEEDS: Speed[] = [
  {
    id: "slow",
    ttfbMs: 150,
    streamMBps: 20,
    instanceCapMBps: 60,
    dbCallMs: 30,
    fixedSeconds: 4,
    sourceMBps: 20,
    putMBps: 20,
  },
  {
    id: "nominal",
    ttfbMs: 60,
    streamMBps: 50,
    instanceCapMBps: 120,
    dbCallMs: 8,
    fixedSeconds: 2,
    sourceMBps: 50,
    putMBps: 40,
  },
  {
    id: "fast",
    ttfbMs: 30,
    streamMBps: 100,
    instanceCapMBps: 250,
    dbCallMs: 4,
    fixedSeconds: 1,
    sourceMBps: 100,
    putMBps: 80,
  },
]

export type Policy = {
  id: string
  /** Cron interval, seconds. */
  intervalSeconds: number
  /** Stop starting new batches after this long, from invocation start. */
  softSeconds: number
  /** Hard deadline: in-flight reads are aborted and the run is a failure. */
  hardSeconds: number
  /** Receipts verified in parallel inside a batch. */
  concurrency: number
  /** Receipts per batch; one checkpoint and lease renewal per batch. */
  batchSize: number
  /** Close a batch early once it holds this many bytes (at least one receipt). */
  batchBytes: number
  /** Ready originals without a receipt copied per invocation. */
  backfillLimit: number
  /** Receipts per invocation, at most. Infinity means bounded by the soft budget only. */
  receiptCap: number
  /**
   * Workers pull receipts continuously and the cursor follows the contiguous
   * watermark in the background, instead of every batch waiting for its slowest receipt.
   */
  pipelined: boolean
}

/** `app/api/internal/media-archive/route.ts` and audit.ts at ff829e9: 50 receipts, one at a time, checkpoint each. */
export const CURRENT_POLICY: Policy = {
  id: "current (hourly, 50 receipts, c=1)",
  intervalSeconds: HOUR,
  softSeconds: 80,
  hardSeconds: 80,
  concurrency: 1,
  batchSize: 1,
  batchBytes: Infinity,
  backfillLimit: 10,
  receiptCap: 50,
  pipelined: false,
}

/** Defaults proposed in docs/interfaces/audit.md (v0). */
export const AUDIT_PROPOSAL: Policy = {
  id: "audit v0 (10 min, 60 s soft, c=4, batch 20)",
  intervalSeconds: 600,
  softSeconds: 60,
  hardSeconds: 90,
  concurrency: 4,
  batchSize: 20,
  batchBytes: Infinity,
  backfillLimit: 5,
  receiptCap: Infinity,
  pipelined: false,
}

/** What docs/archive-capacity.md recommends. */
export const RECOMMENDED: Policy = {
  id: "recommended (10 min, 480 s soft, c=8, pipelined)",
  intervalSeconds: 600,
  softSeconds: 480,
  hardSeconds: 540,
  concurrency: 8,
  batchSize: 20,
  batchBytes: Infinity,
  backfillLimit: 5,
  receiptCap: Infinity,
  pipelined: true,
}

/** Share of scheduled cron invocations that never arrive or find the lease held. */
export const MISSED_RUN_SHARE = 0.1

/** Seconds one worker needs to back-fill an asset: source read, spool, R2 PUT, read-back, manifest. */
export function backfillSeconds(speed: Speed, bytes: number): number {
  return (
    bytes / (speed.sourceMBps * MB) +
    bytes / (speed.putMBps * MB) +
    bytes / (speed.streamMBps * MB) +
    6 * (speed.ttfbMs / 1000) +
    2 * (speed.dbCallMs / 1000)
  )
}

/** Deterministic xorshift32 in [0, 1). */
export function rng(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 2 ** 32
  }
}

export function sampleBytes(video: number, next: () => number): number {
  const classes = next() < video ? VIDEO_CLASSES : PHOTO_CLASSES
  let u = next()
  for (const c of classes) {
    if (u < c.share) return c.bytes
    u -= c.share
  }
  return classes[classes.length - 1].bytes
}

export type SimResult = {
  verified: number
  bytes: number
  /** Whole invocation: fixed cost, back-fill, verification, last batch. */
  seconds: number
  /** Verification only, including the batch that crossed the soft budget. */
  verifySeconds: number
  batches: number
  /** Time workers sat idle at a batch barrier, as a share of worker-seconds. */
  barrierIdle: number
  hardDeadlineHit: boolean
}

/**
 * Time-stepped simulation of one invocation with a full backlog. Each receipt
 * is a blob GET (latency, then a body sharing the instance bandwidth) and a
 * manifest GET (latency). A batch ends when every receipt in it is done, then
 * costs one lease renewal and one checkpoint. No new batch starts after the
 * soft budget; an invocation that runs past the hard deadline is a failure.
 */
export function simulateInvocation(
  speed: Speed,
  policy: Policy,
  video: number,
  seed = 1,
  dt = 0.01
): SimResult {
  const next = rng(seed)
  const lat = speed.ttfbMs / 1000
  const call = speed.dbCallMs / 1000
  const mean = meanBytes(video)
  const startup =
    speed.fixedSeconds + policy.backfillLimit * backfillSeconds(speed, mean)
  let t = 0
  let verified = 0
  let bytes = 0
  let batches = 0
  let idleSeconds = 0
  let workerSeconds = 0
  const stopAt = policy.softSeconds - startup
  const hardAt = policy.hardSeconds - startup
  if (policy.pipelined) {
    return simulatePipelined(speed, policy, video, next, startup, stopAt, dt)
  }
  type Worker = { phase: "wait" | "stream" | "post" | "idle"; left: number }
  while (t < stopAt && t < hardAt && verified < policy.receiptCap) {
    // Assemble the batch from the receipt table: a page read, then sizes.
    t += call
    const queue: number[] = []
    let batchBytes = 0
    while (
      queue.length < Math.min(policy.batchSize, policy.receiptCap - verified) &&
      (queue.length === 0 || batchBytes < policy.batchBytes)
    ) {
      const size = sampleBytes(video, next)
      queue.push(size)
      batchBytes += size
    }
    const workers: Worker[] = []
    const sizes = new Map<Worker, number>()
    const take = (w: Worker) => {
      const size = queue.shift()
      if (size === undefined) {
        w.phase = "idle"
        return
      }
      sizes.set(w, size)
      w.phase = "wait"
      w.left = lat
    }
    for (let i = 0; i < policy.concurrency; i++) {
      const w: Worker = { phase: "idle", left: 0 }
      workers.push(w)
      take(w)
    }
    let completed = 0
    const total =
      queue.length + workers.filter((w) => w.phase !== "idle").length
    while (completed < total && t < hardAt) {
      const streaming = workers.filter((w) => w.phase === "stream").length
      idleSeconds += workers.filter((w) => w.phase === "idle").length * dt
      workerSeconds += workers.length * dt
      const share = Math.min(
        speed.streamMBps,
        speed.instanceCapMBps / Math.max(1, streaming)
      )
      for (const w of workers) {
        if (w.phase === "idle") continue
        if (w.phase === "stream") w.left -= share * MB * dt
        else w.left -= dt
        if (w.left > 0) continue
        if (w.phase === "wait") {
          w.phase = "stream"
          w.left = sizes.get(w)!
        } else if (w.phase === "stream") {
          w.phase = "post"
          w.left = lat
        } else {
          completed++
          bytes += sizes.get(w)!
          take(w)
        }
      }
      t += dt
    }
    if (completed < total) break
    verified += completed
    batches++
    t += 2 * call // lease renewal + checkpoint
  }
  return {
    verified,
    bytes,
    seconds: startup + t,
    verifySeconds: t,
    batches,
    barrierIdle: workerSeconds > 0 ? idleSeconds / workerSeconds : 0,
    hardDeadlineHit: startup + t > policy.hardSeconds,
  }
}

function simulatePipelined(
  speed: Speed,
  policy: Policy,
  video: number,
  next: () => number,
  startup: number,
  stopAt: number,
  dt: number
): SimResult {
  const lat = speed.ttfbMs / 1000
  const hardAt = Math.max(0, policy.hardSeconds - startup)
  const checkpointSeconds = 2 * (speed.dbCallMs / 1000)
  type Entry = { size: number; done: boolean }
  type Worker = {
    phase: "wait" | "stream" | "post"
    left: number
    entry: Entry
  }
  const workers: Worker[] = []
  const issued: Entry[] = []
  let t = 0
  let watermark = 0
  let verified = 0
  let bytes = 0
  let batches = 0
  let checkpoint: { through: number; finishedAt: number } | null = null
  const start = (w: Worker): boolean => {
    if (t >= stopAt || t >= hardAt || issued.length >= policy.receiptCap)
      return false
    w.entry = { size: sampleBytes(video, next), done: false }
    issued.push(w.entry)
    w.phase = "wait"
    w.left = lat
    return true
  }
  for (let i = 0; i < policy.concurrency; i++) {
    const w: Worker = {
      phase: "wait",
      left: 0,
      entry: { size: 0, done: false },
    }
    if (start(w)) workers.push(w)
  }
  const finishCheckpoint = () => {
    if (!checkpoint || checkpoint.finishedAt > t) return
    for (let i = verified; i < checkpoint.through; i++) bytes += issued[i].size
    verified = checkpoint.through
    batches++
    checkpoint = null
  }
  while ((workers.length > 0 || checkpoint) && t < hardAt) {
    // The final tick stops at the deadline; nothing can complete beyond it.
    const step = Math.min(dt, hardAt - t)
    const streaming = workers.filter((w) => w.phase === "stream").length
    const share = Math.min(
      speed.streamMBps,
      speed.instanceCapMBps / Math.max(1, streaming)
    )
    t += step
    if (t >= hardAt) break
    for (let i = workers.length - 1; i >= 0; i--) {
      const w = workers[i]
      if (w.phase === "stream") w.left -= share * MB * step
      else w.left -= step
      if (w.left > 0) continue
      if (w.phase === "wait") {
        w.phase = "stream"
        w.left = w.entry.size
      } else if (w.phase === "stream") {
        w.phase = "post"
        w.left = lat
      } else {
        w.entry.done = true
        if (!start(w)) workers.splice(i, 1)
      }
    }
    // Later receipts cannot move the durable cursor past an unfinished one.
    while (watermark < issued.length && issued[watermark].done) watermark++
    finishCheckpoint()
    if (
      !checkpoint &&
      watermark > verified &&
      (watermark - verified >= policy.batchSize || workers.length === 0)
    ) {
      checkpoint = { through: watermark, finishedAt: t + checkpointSeconds }
      finishCheckpoint()
    }
  }
  return {
    verified,
    bytes,
    seconds: Math.min(policy.hardSeconds, startup + t),
    verifySeconds: t,
    batches,
    barrierIdle: 0,
    hardDeadlineHit:
      startup >= policy.hardSeconds || workers.length > 0 || !!checkpoint,
  }
}

export type Throughput = {
  /** Every size class in the requested mix can fit in a fresh invocation. */
  canCompleteCycle: boolean
  receiptsPerInvocation: number
  bytesPerInvocation: number
  /** Mean / worst whole-invocation wall time across seeds, seconds. */
  meanSeconds: number
  worstSeconds: number
  /** Share of seeds whose invocation passed the hard deadline. */
  hardDeadlineShare: number
  /** Worker idle time at batch barriers, share of worker-seconds. */
  barrierIdle: number
  /** Verification speed inside the window, receipts per second. */
  receiptsPerSecond: number
}

const cache = new Map<string, Throughput>()

/** Mean over `seeds` simulated invocations (memoised). */
export function throughput(
  speed: Speed,
  policy: Policy,
  video: number,
  seeds = 7
): Throughput {
  const key = JSON.stringify([speed, policy, video, seeds])
  const hit = cache.get(key)
  if (hit) return hit
  const runs = Array.from({ length: seeds }, (_, i) =>
    simulateInvocation(speed, policy, video, i + 1)
  )
  const avg = (f: (r: SimResult) => number) =>
    runs.reduce((sum, r) => sum + f(r), 0) / runs.length
  // A random prefix can make progress even when a later large receipt would
  // block every subsequent invocation. Do not turn that prefix into a finite
  // full-cycle estimate. Use the same shared-bandwidth assumption as the
  // conservative analytic cross-check below.
  const largest = Math.max(
    ...(video < 1 ? PHOTO_CLASSES.map((c) => c.bytes) : []),
    ...(video > 0 ? VIDEO_CLASSES.map((c) => c.bytes) : [])
  )
  const startup =
    speed.fixedSeconds +
    policy.backfillLimit * backfillSeconds(speed, meanBytes(video))
  const rate =
    Math.min(speed.streamMBps, speed.instanceCapMBps / policy.concurrency) * MB
  const largestSeconds =
    2 * (speed.ttfbMs / 1000) + largest / rate + 2 * (speed.dbCallMs / 1000)
  const result: Throughput = {
    canCompleteCycle: startup + largestSeconds < policy.hardSeconds,
    receiptsPerInvocation: avg((r) => r.verified),
    bytesPerInvocation: avg((r) => r.bytes),
    meanSeconds: avg((r) => r.seconds),
    worstSeconds: Math.max(...runs.map((r) => r.seconds)),
    hardDeadlineShare: avg((r) => (r.hardDeadlineHit ? 1 : 0)),
    barrierIdle: avg((r) => r.barrierIdle),
    receiptsPerSecond: avg((r) => r.verified / Math.max(1e-9, r.verifySeconds)),
  }
  cache.set(key, result)
  return result
}

/** Conservative closed form for the same invocation: every worker is assumed to share the instance bandwidth all the time, and no batch barrier. Cross-checks the simulation. */
export function analyticReceiptsPerInvocation(
  speed: Speed,
  policy: Policy,
  video: number
): number {
  const mean = meanBytes(video)
  const startup =
    speed.fixedSeconds + policy.backfillLimit * backfillSeconds(speed, mean)
  const window = Math.max(0, policy.softSeconds - startup)
  const rate =
    Math.min(speed.streamMBps, speed.instanceCapMBps / policy.concurrency) * MB
  const perReceipt = 2 * (speed.ttfbMs / 1000) + mean / rate
  const rps = Math.min(
    policy.concurrency / perReceipt,
    (speed.instanceCapMBps * MB) / mean
  )
  return Math.min(policy.receiptCap, rps * window)
}

/** Wall time of one invocation of the current loop at full backlog, 10 sequential back-fills then 50 receipts. */
export function currentInvocation(
  speed: Speed,
  video: number,
  seeds = 20
): { backfill: number; verify: number; total: number; overDeadline: number } {
  const backfill =
    CURRENT_POLICY.backfillLimit * backfillSeconds(speed, meanBytes(video))
  let sum = 0
  let over = 0
  for (let seed = 1; seed <= seeds; seed++) {
    // 50 receipts, one batch of one each, c=1
    const next = rng(seed)
    let t = 0
    for (let i = 0; i < 50; i++) {
      const size = sampleBytes(video, next)
      t +=
        2 * (speed.ttfbMs / 1000) +
        size / (speed.streamMBps * MB) +
        speed.dbCallMs / 1000
    }
    sum += t
    if (speed.fixedSeconds + backfill + t > CURRENT_POLICY.softSeconds) over++
  }
  const verify = sum / seeds
  return {
    backfill,
    verify,
    total: speed.fixedSeconds + backfill + verify,
    overDeadline: over / seeds,
  }
}

/**
 * Wall time of one full cycle over `receipts`, counting a share of scheduled
 * runs as missed or locked, and one interval of start/finish granularity.
 */
export function cycleSeconds(
  receipts: number,
  speed: Speed,
  policy: Policy,
  video: number,
  missedShare = MISSED_RUN_SHARE
): number {
  const { receiptsPerInvocation, canCompleteCycle } = throughput(
    speed,
    policy,
    video
  )
  if (!canCompleteCycle || receiptsPerInvocation <= 0) return Infinity
  const invocations = Math.ceil(receipts / receiptsPerInvocation)
  return (invocations / (1 - missedShare)) * policy.intervalSeconds
}

/** Largest library (receipts) whose cycle fits in `targetSeconds`. */
export function maxReceipts(
  speed: Speed,
  policy: Policy,
  video: number,
  targetSeconds = TARGET_CYCLE_SECONDS,
  missedShare = MISSED_RUN_SHARE
): number {
  const { receiptsPerInvocation, canCompleteCycle } = throughput(
    speed,
    policy,
    video
  )
  if (!canCompleteCycle) return 0
  const invocations = Math.floor(
    (targetSeconds / policy.intervalSeconds) * (1 - missedShare)
  )
  return Math.floor(Math.max(0, invocations) * receiptsPerInvocation)
}

/** Month (fractional) at which the library outgrows `limit`; 0 if already, null if beyond `horizon`. */
export function monthsUntil(
  s: Scenario,
  limit: number,
  horizon = 120
): number | null {
  if (s.initialAssets > limit) return 0
  if (s.uploadsPerDay <= 0) return null
  const months = (limit - s.initialAssets) / (s.uploadsPerDay * MONTH_DAYS)
  return months > horizon ? null : months
}

// Published prices. Sources and retrieval dates are in docs/archive-capacity.md.
export const PRICES = {
  // https://developers.cloudflare.com/r2/pricing/ (page dated 30 Oct 2026, read 31 Oct 2026)
  r2ClassBPerMillion: 0.36,
  r2ClassBFreePerMonth: 10_000_000,
  r2StoragePerGbMonth: 0.015,
  r2InfrequentRetrievalPerGb: 0.01,
  // https://vercel.com/docs/functions/usage-and-pricing (updated 16 Jun 2026, read 31 Oct 2026), London lhr1
  vercelActiveCpuPerHour: 0.177,
  vercelMemoryPerGbHour: 0.0146,
  vercelInvocationsPerMillion: 0.6,
}

/** Provisioned function memory, GB. 2 GB / 1 vCPU is Vercel's default (docs/functions/limitations). */
export const FUNCTION_MEMORY_GB = 2
/** CPU seconds per GB read: SHA-256 (about 500 MB/s per vCPU) plus TLS and stream handling. Assumption. */
export const CPU_SECONDS_PER_GB = 3

export type Cost = {
  readGbPerDay: number
  cyclesPerDay: number
  busyHoursPerDay: number
  r2ClassBPerMonth: number
  r2ClassBUsd: number
  vercelCpuUsd: number
  vercelMemoryUsd: number
  vercelInvocationUsd: number
  totalUsd: number
}

/**
 * Monthly cost of verifying a library of `receipts` under `policy`.
 * `cyclePeriodSeconds` is the minimum time between cycle starts; with 0 the
 * audit starts the next cycle as soon as one completes (what the contract and
 * the current cursor reset do).
 */
export function monthlyCost(
  receipts: number,
  speed: Speed,
  policy: Policy,
  video: number,
  duplicateShare: number,
  cyclePeriodSeconds = 0
): Cost {
  const t = throughput(speed, policy, video)
  const cycle = cycleSeconds(receipts, speed, policy, video)
  const cyclesPerDay = DAY / Math.max(cycle, cyclePeriodSeconds)
  // Verifying a duplicate blob once per cycle (not once per receipt) saves its read.
  const blobReads = receipts * (1 - duplicateShare)
  const readGbPerDay = (blobReads * meanBytes(video) * cyclesPerDay) / GB
  const classB = (blobReads + receipts) * cyclesPerDay * MONTH_DAYS
  // Billed provisioned memory: the part of each invocation that was working.
  const invocationsPerCycle = receipts / Math.max(1, t.receiptsPerInvocation)
  const busySecondsPerCycle = invocationsPerCycle * t.meanSeconds
  const busyHoursPerDay = (busySecondsPerCycle * cyclesPerDay) / HOUR
  const idleInvocations = Math.max(
    0,
    (DAY / policy.intervalSeconds) * (1 - MISSED_RUN_SHARE) -
      invocationsPerCycle * cyclesPerDay
  )
  const idleHoursPerDay = (idleInvocations * 2) / HOUR
  const invocationsPerMonth = (DAY / policy.intervalSeconds) * MONTH_DAYS
  const r2ClassBUsd =
    (Math.max(0, classB - PRICES.r2ClassBFreePerMonth) / 1e6) *
    PRICES.r2ClassBPerMillion
  const vercelCpuUsd =
    ((readGbPerDay * CPU_SECONDS_PER_GB * MONTH_DAYS) / HOUR) *
    PRICES.vercelActiveCpuPerHour
  const vercelMemoryUsd =
    (busyHoursPerDay + idleHoursPerDay) *
    MONTH_DAYS *
    FUNCTION_MEMORY_GB *
    PRICES.vercelMemoryPerGbHour
  const vercelInvocationUsd =
    (invocationsPerMonth / 1e6) * PRICES.vercelInvocationsPerMillion
  return {
    readGbPerDay,
    cyclesPerDay,
    busyHoursPerDay: busyHoursPerDay + idleHoursPerDay,
    r2ClassBPerMonth: classB,
    r2ClassBUsd,
    vercelCpuUsd,
    vercelMemoryUsd,
    vercelInvocationUsd,
    totalUsd:
      r2ClassBUsd + vercelCpuUsd + vercelMemoryUsd + vercelInvocationUsd,
  }
}

const policy = (
  id: string,
  intervalSeconds: number,
  softSeconds: number,
  hardSeconds: number,
  concurrency: number,
  batchSize: number,
  batchBytes: number,
  backfillLimit: number,
  pipelined = false
): Policy => ({
  id,
  intervalSeconds,
  softSeconds,
  hardSeconds,
  concurrency,
  batchSize,
  batchBytes,
  backfillLimit,
  receiptCap: Infinity,
  pipelined,
})

/** Candidate schedules, each leaving a margin between soft and hard deadline for the last batch. */
export function candidatePolicies(): Policy[] {
  return [
    CURRENT_POLICY,
    AUDIT_PROPOSAL,
    policy("60 min, 750 s soft, c=4", 3600, 750, 780, 4, 20, 512 * MB, 5),
    policy("15 min, 600 s soft, c=4", 900, 600, 660, 4, 20, 512 * MB, 5),
    policy("10 min, 480 s soft, c=4", 600, 480, 540, 4, 20, 512 * MB, 5),
    policy("5 min, 240 s soft, c=4", 300, 240, 270, 4, 20, 512 * MB, 5),
    policy("10 min, 480 s soft, c=8", 600, 480, 540, 8, 20, 512 * MB, 5),
    policy("10 min, 240 s soft, c=4", 600, 240, 300, 4, 20, 512 * MB, 5),
    policy(
      "10 min, 480 s soft, c=4, pipelined",
      600,
      480,
      540,
      4,
      20,
      Infinity,
      5,
      true
    ),
    RECOMMENDED,
    policy(
      "10 min, 240 s soft, c=8, pipelined",
      600,
      240,
      300,
      8,
      20,
      Infinity,
      5,
      true
    ),
    policy(
      "5 min, 240 s soft, c=8, pipelined",
      300,
      240,
      270,
      8,
      20,
      Infinity,
      5,
      true
    ),
  ]
}
