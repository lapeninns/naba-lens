// Prints the capacity tables used in docs/archive-capacity.md as Markdown.
//
//   pnpm exec tsx scripts/archive/capacity/report.ts [--section assumptions,growth,current,schedules,breakpoints,cost,all]
//
// No network, no database, no clock: the output is a pure function of model.ts.
import {
  AUDIT_PROPOSAL,
  RECOMMENDED,
  CPU_SECONDS_PER_GB,
  DAY,
  FUNCTION_MEMORY_GB,
  GB,
  HOUR,
  MISSED_RUN_SHARE,
  PHOTO_CLASSES,
  SCENARIOS,
  SPEEDS,
  VIDEO_CLASSES,
  analyticReceiptsPerInvocation,
  candidatePolicies,
  currentInvocation,
  cycleSeconds,
  maxReceipts,
  meanBytes,
  monthlyCost,
  monthsUntil,
  projectLibrary,
  throughput,
  type Policy,
  type Speed,
} from "./model"

const sections = (() => {
  const i = process.argv.indexOf("--section")
  return new Set((i > 0 ? process.argv[i + 1] : "all").split(","))
})()
const want = (name: string) => sections.has("all") || sections.has(name)

const nominal = SPEEDS.find((s) => s.id === "nominal")!
const slow = SPEEDS.find((s) => s.id === "slow")!

// --measured ttfb=<ms>,stream=<MB/s>,cap=<MB/s>,db=<ms> adds a profile built from
// real measurements (see staging-probe.ts); unset fields keep the nominal value.
const measured: Speed[] = (() => {
  const i = process.argv.indexOf("--measured")
  if (i < 0) return []
  const kv = Object.fromEntries(
    process.argv[i + 1]
      .split(",")
      .map((pair) => pair.split("=") as [string, string])
  )
  const num = (key: string, fallback: number) =>
    kv[key] === undefined ? fallback : Number(kv[key])
  return [
    {
      ...nominal,
      id: "measured",
      ttfbMs: num("ttfb", nominal.ttfbMs),
      streamMBps: num("stream", nominal.streamMBps),
      instanceCapMBps: num("cap", nominal.instanceCapMBps),
      dbCallMs: num("db", nominal.dbCallMs),
    },
  ]
})()
const profiles = [nominal, slow, ...measured]

const n = (value: number, digits = 0) =>
  value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
const hours = (seconds: number) =>
  Number.isFinite(seconds) ? n(seconds / HOUR, 1) + " h" : "never"
const bytesText = (bytes: number) =>
  bytes >= 1e12 ? n(bytes / 1e12, 2) + " TB" : n(bytes / GB, 0) + " GB"
const usd = (value: number) => "$" + n(value, value < 10 ? 2 : 0)

function table(head: string[], rows: string[][]) {
  console.log(`| ${head.join(" | ")} |`)
  console.log(`| ${head.map(() => "---").join(" | ")} |`)
  for (const row of rows) console.log(`| ${row.join(" | ")} |`)
  console.log()
}

const heading = (text: string) => console.log(`### ${text}\n`)

if (want("assumptions")) {
  heading("Size classes")
  table(
    ["Class", "Bytes", "Share within its type"],
    [...PHOTO_CLASSES, ...VIDEO_CLASSES].map((c) => [
      c.name,
      n(c.bytes / 1e6, 1) + " MB",
      n(c.share * 100) + "%",
    ])
  )
  heading("Speed profiles")
  table(
    [
      "Profile",
      "R2 TTFB",
      "Stream",
      "Instance cap",
      "DB call",
      "Fixed/invocation",
      "Source read",
      "R2 PUT",
    ],
    SPEEDS.map((s) => [
      s.id,
      s.ttfbMs + " ms",
      s.streamMBps + " MB/s",
      s.instanceCapMBps + " MB/s",
      s.dbCallMs + " ms",
      s.fixedSeconds + " s",
      s.sourceMBps + " MB/s",
      s.putMBps + " MB/s",
    ])
  )
  heading(
    "Mean receipt and per-receipt time by mix (nominal speed, one stream)"
  )
  table(
    ["Mix", "Mean receipt", "Blob GET", "Manifest GET + checkpoint share"],
    [
      ["photos only", 0],
      ["10% video", 0.1],
      ["20% video", 0.2],
    ].map(([label, video]) => {
      const mean = meanBytes(video as number)
      return [
        String(label),
        n(mean / 1e6, 1) + " MB",
        n(nominal.ttfbMs + (mean / (nominal.streamMBps * 1e6)) * 1000) + " ms",
        n(nominal.ttfbMs + nominal.dbCallMs) + " ms",
      ]
    })
  )
}

if (want("growth")) {
  heading("Library growth")
  const rows: string[][] = []
  for (const s of SCENARIOS) {
    for (const month of [0, 12, 24]) {
      const lib = projectLibrary(s, month)
      rows.push([
        s.label,
        month === 0 ? "start" : `${month} months`,
        n(lib.receipts),
        bytesText(lib.bytes),
        n(meanBytes(s.videoShare) / 1e6, 1) + " MB",
        n(lib.bytes / DAY / 1e6, 1) + " MB/s",
      ])
    }
  }
  table(
    [
      "Scenario",
      "When",
      "Receipts",
      "Bytes",
      "Mean receipt",
      "Average read rate for a 24 h cycle",
    ],
    rows
  )
}

if (want("current")) {
  heading(
    "Current behaviour (hourly, 10 back-fills then 50 receipts, one at a time), 10% video"
  )
  table(
    [
      "Speed",
      "Back-fill 10",
      "Verify 50",
      "Whole run",
      "Runs over the 80 s deadline",
      "Receipts per day",
      "Library where a cycle reaches 24 h",
      "Library where a cycle reaches 26 h",
    ],
    SPEEDS.map((s) => {
      const c = currentInvocation(s, 0.1)
      return [
        s.id,
        n(c.backfill, 1) + " s",
        n(c.verify, 1) + " s",
        n(c.total, 1) + " s",
        n(c.overDeadline * 100) + "%",
        n(50 * 24),
        n(50 * 24) + " receipts",
        n(50 * 26) + " receipts",
      ]
    })
  )
}

function throughputRows(speed: Speed, policies: Policy[], video: number) {
  return policies.map((p) => {
    const t = throughput(speed, p, video)
    return [
      p.id,
      n(t.receiptsPerInvocation),
      n(analyticReceiptsPerInvocation(speed, p, video)),
      n(t.bytesPerInvocation / 1e6) + " MB",
      n(t.meanSeconds) + " s / " + n(t.worstSeconds) + " s",
      n(t.hardDeadlineShare * 100) + "%",
      n(t.barrierIdle * 100) + "%",
      n(maxReceipts(speed, p, video)),
    ]
  })
}

if (want("schedules")) {
  for (const speed of profiles) {
    heading(`Per-invocation throughput, ${speed.id} speed, 10% video`)
    table(
      [
        "Policy",
        "Receipts/run (simulated)",
        "Receipts/run (conservative closed form)",
        "Bytes/run",
        "Run time mean / worst",
        "Runs hitting hard deadline",
        "Worker idle at batch barriers",
        "Max library for a 24 h cycle",
      ],
      throughputRows(speed, candidatePolicies(), 0.1)
    )
  }
}

if (want("breakpoints")) {
  for (const speed of profiles) {
    heading(`When a policy stops meeting the 24 h target (${speed.id} speed)`)
    const rows: string[][] = []
    for (const p of candidatePolicies()) {
      rows.push([
        p.id,
        ...SCENARIOS.map((s) => {
          const limit = maxReceipts(speed, p, s.videoShare)
          const months = monthsUntil(s, limit)
          return `${n(limit)} (${months === null ? ">10 y" : months === 0 ? "already" : n(months, 1) + " mo"})`
        }),
      ])
    }
    table(["Policy", ...SCENARIOS.map((s) => s.id)], rows)
  }
}

if (want("cost")) {
  const recommended = [AUDIT_PROPOSAL, RECOMMENDED]
  for (const period of [0, 12 * HOUR]) {
    heading(
      `Monthly cost at 24 months, nominal speed, next cycle ${period === 0 ? "starts as soon as one completes" : "starts no sooner than 12 h after the last start"}`
    )
    const rows: string[][] = []
    for (const s of SCENARIOS.filter((x) => x.id !== "stress")) {
      const lib = projectLibrary(s, 24)
      for (const p of recommended) {
        const cycle = cycleSeconds(lib.receipts, nominal, p, s.videoShare)
        const c = monthlyCost(
          lib.receipts,
          nominal,
          p,
          s.videoShare,
          s.duplicateShare,
          period
        )
        rows.push([
          s.id,
          p.id,
          n(lib.receipts),
          hours(cycle),
          n(c.cyclesPerDay, 2),
          n(c.readGbPerDay) + " GB",
          n(c.r2ClassBPerMonth / 1e6, 1) + " M",
          usd(c.r2ClassBUsd),
          usd(c.vercelCpuUsd + c.vercelMemoryUsd + c.vercelInvocationUsd),
          usd(c.totalUsd),
        ])
      }
    }
    table(
      [
        "Scenario",
        "Policy",
        "Receipts",
        "Cycle",
        "Cycles/day",
        "Read/day",
        "Class B/month",
        "R2 ops",
        "Vercel",
        "Total/month",
      ],
      rows
    )
  }
  console.log(
    `Assumes ${FUNCTION_MEMORY_GB} GB function memory, ${CPU_SECONDS_PER_GB} CPU-s per GB read, ${MISSED_RUN_SHARE * 100}% of cron firings missed or locked. Audit v0 is ${AUDIT_PROPOSAL.id}.\n`
  )
}

if (want("sweep")) {
  heading(
    "Cron interval x soft budget, pipelined, 8 workers, 10% video: max library for a 24 h cycle"
  )
  const intervals = [300, 600, 900, 1800, 3600]
  const softs = [60, 120, 240, 480, 750]
  for (const speed of profiles) {
    const rows: string[][] = []
    for (const interval of intervals) {
      const row = [`${interval / 60} min`]
      for (const soft of softs) {
        if (soft + 30 > interval) {
          row.push("n/a")
          continue
        }
        const p: Policy = {
          id: "sweep",
          intervalSeconds: interval,
          softSeconds: soft,
          hardSeconds: soft + 30,
          concurrency: 8,
          batchSize: 20,
          batchBytes: Infinity,
          backfillLimit: 5,
          receiptCap: Infinity,
          pipelined: true,
        }
        row.push(n(maxReceipts(speed, p, 0.1)))
      }
      rows.push(row)
    }
    console.log(`${speed.id} speed\n`)
    table(["Cron interval", ...softs.map((x) => `${x} s soft`)], rows)
  }
}

if (want("crossing")) {
  heading(
    "When the cycle duration D reaches 14 h, 20 h and 24 h (recommended budget)"
  )
  const rows: string[][] = []
  for (const speed of profiles) {
    for (const s of SCENARIOS) {
      const row = [speed.id, s.id]
      for (const limitHours of [14, 20, 24]) {
        const receipts = maxReceipts(
          speed,
          RECOMMENDED,
          s.videoShare,
          limitHours * HOUR
        )
        const months = monthsUntil(s, receipts)
        row.push(
          `${n(receipts)} receipts, ${months === null ? ">10 y" : months === 0 ? "already" : "month " + n(months, 1)}`
        )
      }
      rows.push(row)
    }
  }
  table(
    [
      "Speed",
      "Scenario",
      "D = 14 h",
      "D = 20 h (cycle_slow)",
      "D = 24 h (target)",
    ],
    rows
  )
  heading("Cycle duration D at fixed months (recommended budget)")
  const rows2: string[][] = []
  for (const speed of profiles) {
    for (const s of SCENARIOS) {
      rows2.push([
        speed.id,
        s.id,
        ...[12, 24, 36].map((m) => {
          const lib = projectLibrary(s, m)
          return hours(
            cycleSeconds(lib.receipts, speed, RECOMMENDED, s.videoShare)
          )
        }),
      ])
    }
  }
  table(["Speed", "Scenario", "D at 12 mo", "D at 24 mo", "D at 36 mo"], rows2)
}
