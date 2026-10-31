// Runs the verification loop against an in-process fake ArchiveStore and fake
// audit state, in real time, to measure what the model only assumes.
//
//   pnpm exec tsx scripts/archive/capacity/measure.ts [--section hash,overhead,checkpoint,validate,all] [--json]
//
// Nothing here touches the network, a database, or any credential. Timings are
// from this machine, not from Vercel: use them for relative costs and for
// checking the model, never as production throughput.
import { createHash } from "node:crypto"
import { arch, cpus, platform } from "node:os"

import {
  createFakeState,
  createFakeStore,
  makeReceipts,
  sleep,
  type FakeNetwork,
} from "./fake"
import { runLoop, type LoopMode, type LoopOptions } from "./loops"
import {
  rng,
  sampleBytes,
  simulateInvocation,
  type Policy,
  type Speed,
} from "./model"

const argv = process.argv.slice(2)
const sections = new Set(
  (argv.includes("--section")
    ? argv[argv.indexOf("--section") + 1]
    : "all"
  ).split(",")
)
const want = (name: string) => sections.has("all") || sections.has(name)
const asJson = argv.includes("--json")
const out: Record<string, unknown> = {
  host: {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    node: process.version,
  },
}

const n = (value: number, digits = 0) =>
  value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

function table(head: string[], rows: string[][]) {
  if (asJson) return
  console.log(`| ${head.join(" | ")} |`)
  console.log(`| ${head.map(() => "---").join(" | ")} |`)
  for (const row of rows) console.log(`| ${row.join(" | ")} |`)
  console.log()
}
const heading = (text: string) => {
  if (!asJson) console.log(`### ${text}\n`)
}

const instant: FakeNetwork = {
  ttfbMs: 0,
  streamMBps: Infinity,
  capMBps: Infinity,
}

if (want("hash")) {
  heading("SHA-256 throughput of this host (one thread)")
  const chunk = Buffer.alloc(256 * 1024, 0xa5)
  const bytes = 2 * 1024 ** 3
  const hash = createHash("sha256")
  const start = performance.now()
  for (let done = 0; done < bytes; done += chunk.length) hash.update(chunk)
  hash.digest("hex")
  const mbps = bytes / 1e6 / ((performance.now() - start) / 1000)
  out.hash = { mbps }
  table(["Data hashed", "MB/s"], [["2 GiB", n(mbps)]])
}

if (want("overhead")) {
  heading("Per-receipt software overhead with zero latency and 4 KiB blobs")
  const receipts = makeReceipts(Array.from({ length: 4000 }, () => 4096))
  const rows: string[][] = []
  const results: Record<string, unknown>[] = []
  for (const [label, mode, concurrency] of [
    ["sequential (current loop)", "sequential", 1],
    ["barrier c=4, batch 20", "barrier", 4],
    ["pipelined c=8, batch 20", "pipelined", 8],
  ] as [string, LoopMode, number][]) {
    const state = createFakeState(receipts, 0)
    const store = createFakeStore(instant)
    const options: LoopOptions = {
      mode,
      concurrency,
      batchSize: 20,
      softMs: 60_000,
      receiptCap: mode === "sequential" ? 50 : 4000,
    }
    let verified = 0
    const start = performance.now()
    do {
      verified += (await runLoop(store, state, options)).verified
    } while (mode === "sequential" && verified < 4000)
    const ms = performance.now() - start
    const per = (ms * 1000) / verified
    rows.push([
      label,
      n(verified),
      n(per, 1) + " µs",
      n(store.stats.gets / verified, 1),
      n(state.stats.checkpoints / verified, 3),
    ])
    results.push({ label, verified, microsecondsPerReceipt: per })
  }
  out.overhead = results
  table(
    [
      "Loop",
      "Receipts",
      "Time per receipt",
      "GETs per receipt",
      "Checkpoints per receipt",
    ],
    rows
  )
}

if (want("checkpoint")) {
  heading(
    "Checkpoint cost with injected DB latency (photos only, 5.5 MB, instant network)"
  )
  const receipts = makeReceipts(Array.from({ length: 400 }, () => 5_500_000))
  const rows: string[][] = []
  const results: Record<string, unknown>[] = []
  for (const dbCallMs of [4, 8, 30]) {
    for (const [label, mode, concurrency] of [
      ["sequential, checkpoint each", "sequential", 1],
      ["pipelined c=8, checkpoint every 20", "pipelined", 8],
    ] as [string, LoopMode, number][]) {
      const state = createFakeState(receipts, dbCallMs)
      const store = createFakeStore(instant)
      const result = await runLoop(store, state, {
        mode,
        concurrency,
        batchSize: 20,
        softMs: 60_000,
        receiptCap: 50,
      })
      const perReceiptDb = state.stats.dbMs / result.verified
      rows.push([
        dbCallMs + " ms",
        label,
        n(state.stats.checkpoints) + " / " + n(result.verified),
        n(perReceiptDb, 2) + " ms",
        n(result.ms / result.verified, 2) + " ms",
      ])
      results.push({
        dbCallMs,
        label,
        perReceiptDbMs: perReceiptDb,
        perReceiptMs: result.ms / result.verified,
      })
    }
  }
  out.checkpoint = results
  table(
    [
      "DB call",
      "Loop",
      "Checkpoints / receipts",
      "DB time per receipt",
      "Wall per receipt",
    ],
    rows
  )
}

if (want("validate")) {
  heading("Model check: real-time loop vs simulateInvocation, same parameters")
  const net: FakeNetwork = { ttfbMs: 20, streamMBps: 100, capMBps: 300 }
  const dbCallMs = 5
  const speed: Speed = {
    id: "harness",
    ttfbMs: net.ttfbMs,
    streamMBps: net.streamMBps,
    instanceCapMBps: net.capMBps,
    dbCallMs,
    fixedSeconds: 0,
    sourceMBps: 1,
    putMBps: 1,
  }
  const softMs = 12_000
  const video = 0.1
  const rows: string[][] = []
  const results: Record<string, unknown>[] = []
  const cases: [string, LoopMode, number, number, number][] = [
    ["sequential, 50 receipts", "sequential", 1, 1, 50],
    ["barrier c=4, batch 20", "barrier", 4, 20, Infinity],
    ["pipelined c=8, batch 20", "pipelined", 8, 20, Infinity],
  ]
  for (const [label, mode, concurrency, batchSize, cap] of cases) {
    const realRuns: number[] = []
    const realMb: number[] = []
    for (const seed of [1, 2, 3]) {
      const next = rng(seed)
      const sizes = Array.from({ length: 2_500 }, () =>
        sampleBytes(video, next)
      )
      const receipts = makeReceipts(sizes)
      const store = createFakeStore(net)
      const state = createFakeState(receipts, dbCallMs)
      const result = await runLoop(store, state, {
        mode,
        concurrency,
        batchSize,
        softMs,
        receiptCap: cap,
      })
      realRuns.push(result.ms)
      realMb.push(result.verified)
      await sleep(50)
      void realMb
    }
    const policy: Policy = {
      id: label,
      intervalSeconds: 600,
      softSeconds: softMs / 1000,
      hardSeconds: 1e6,
      concurrency,
      batchSize,
      batchBytes: Infinity,
      backfillLimit: 0,
      receiptCap: cap,
      pipelined: mode === "pipelined",
    }
    const simRuns = [1, 2, 3, 4, 5, 6, 7].map((seed) =>
      simulateInvocation(
        speed,
        mode === "sequential" ? { ...policy, softSeconds: 1e6 } : policy,
        video,
        seed
      )
    )
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    rows.push([
      label,
      n(avg(realMb)),
      n(avg(simRuns.map((r) => r.verified))),
      n(avg(realRuns) / 1000, 1) + " s",
      n(avg(simRuns.map((r) => r.seconds)), 1) + " s",
    ])
    results.push({
      label,
      realReceipts: avg(realMb),
      simReceipts: avg(simRuns.map((r) => r.verified)),
    })
  }
  out.validate = results
  table(
    [
      "Loop",
      "Receipts (real)",
      "Receipts (model)",
      "Run time (real)",
      "Run time (model)",
    ],
    rows
  )
}

if (asJson) console.log(JSON.stringify(out, null, 2))
