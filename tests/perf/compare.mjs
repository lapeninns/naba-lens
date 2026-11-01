// Renders two raw result trees (the baseline and the after-run) side by side as
// markdown tables: p50 / p95 ms before and after, per path and volume.
//
//   node tests/perf/compare.mjs [--base docs/perf/raw] [--after docs/perf/after-raw]
//     [--vols current,expected,high] [--out file.md]
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const BASE = resolve(arg("base", "docs/perf/raw"))
const AFTER = resolve(arg("after", "docs/perf/after-raw"))
const VOLS = arg("vols", "current,expected,high").split(",")
const read = (root, v, f) => {
  const p = join(root, v, f)
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
}
const out = []
const p = (s = "") => out.push(s)
const num = (n) =>
  n == null || Number.isNaN(n) ? "n/a" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: n >= 100 ? 0 : 1 })
const table = (head, rows) => {
  p(`| ${head.join(" | ")} |`)
  p(`| ${head.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`)
  for (const r of rows) p(`| ${r.join(" | ")} |`)
  p()
}
const stat = (s) => (s ? `${num(s.p50)} / ${num(s.p95)}` : "n/a")
const fn = (r) =>
  r ? (r.failures ? `**${stat(r.wallMs)}, ${r.failures}/${r.sampled ?? "?"} failed**` : stat(r.wallMs)) : "n/a"
const ratio = (b, a) => (b?.p50 && a?.p50 ? `${Number((a.p50 / b.p50).toPrecision(2))}x` : "n/a")
// Row labels that carry a volume-dependent number match by prefix.
const key = (n) =>
  n.replace(/\(offset \d+\)|\(\d[\d,]* assets\)|, \d+ assets/g, "").replace(/\s+/g, " ").trim()

// ------------------------------------------------------------ app functions
const groups = [
  ["admin-feed", "Admin library feed and filters"],
  ["staff", "Staff portfolio and labelling"],
  ["menus", "Menu admin reads"],
]
for (const v of VOLS) {
  const b = read(BASE, v, "db-paths.json")
  const a = read(AFTER, v, "db-paths.json")
  if (!b || !a) continue
  p(`### App functions at ${v}: p50 / p95 ms (before = baseline)`)
  p()
  const load = (d) => (d.loadAverage?.start ?? d.loadAverage ?? []).map((x) => num(x)).join(" ")
  p(`Load average at start: before ${load(b)}, after ${load(a)}. Revisions: before ${b.revision?.sha?.slice(0, 7)}, after ${a.revision?.sha?.slice(0, 7)}.`)
  p()
  for (const [group, title] of groups) {
    const names = new Map()
    for (const r of [...b.results, ...a.results].filter((x) => x.group === group)) names.set(key(r.name), true)
    p(`#### ${title}`)
    p()
    table(
      ["Path", "before", "after", "p50 ratio", "requests before / after"],
      [...names.keys()].map((k) => {
        const f = (d) => d.results.find((r) => r.group === group && key(r.name) === k)
        const rb = f(b)
        const ra = f(a)
        return [k, fn(rb), fn(ra), ratio(rb?.wallMs, ra?.wallMs), `${rb?.requestsP50 ?? "n/a"} / ${ra?.requestsP50 ?? "n/a"}`]
      })
    )
  }
}

// ------------------------------------------------------------ refresh
p("### Admin gallery foreground refresh: k pages one after another, p50 / p95 ms")
p()
{
  const rows = []
  for (const v of VOLS) {
    const b = read(BASE, v, "refresh-bench.json")
    const a = read(AFTER, v, "refresh-bench.json")
    if (!b || !a) continue
    for (const r of a.refresh) {
      const x = b.refresh.find((y) => y.label === r.label && y.pages === r.pages)
      rows.push([v, r.label, String(r.pages), stat(x?.refreshMs), stat(r.refreshMs), `${x?.requests ?? "n/a"} / ${r.requests}`])
    }
  }
  table(["Volume", "Feed", "Pages", "before", "after", "requests"], rows)
  const crows = []
  for (const v of VOLS) {
    const b = read(BASE, v, "refresh-bench.json")
    const a = read(AFTER, v, "refresh-bench.json")
    if (!b || !a) continue
    for (const r of a.concurrent) {
      const x = b.concurrent.find((y) => y.label === r.label && y.concurrent === r.concurrent)
      crows.push([v, `${r.label} x${r.concurrent}`, x ? `${stat(x.wallMs)}${x.failures ? ` **${x.failures} failed**` : ""}` : "n/a", `${stat(r.wallMs)}${r.failures ? ` **${r.failures} failed**` : ""}`])
    }
  }
  p("### Several admins at once, per-request p50 / p95 ms")
  p()
  table(["Volume", "Path", "before", "after"], crows)
}

// ------------------------------------------------------------ pages
p("### Pages and API from `next start`: complete time p50 / p95 ms")
p()
{
  const rows = []
  for (const v of VOLS) {
    const b = read(BASE, v, "ttfb.json")
    const a = read(AFTER, v, "ttfb.json")
    if (!b || !a) continue
    for (const r of a.routes) {
      const x = b.routes.find((y) => y.name === r.name)
      rows.push([v, r.name, stat(x?.completeMs), stat(r.completeMs), `${num((x?.htmlBytes ?? 0) / 1024)} / ${num(r.htmlBytes / 1024)}`])
    }
  }
  table(["Volume", "Route", "before", "after", "HTML KiB before / after"], rows)
}

// ------------------------------------------------------------ menu bench
p("### Menu import and catalogue by menu size, p50 / p95 ms")
p()
{
  const steps = [
    ["preview, same file", "previewSameFileMs"],
    ["preview, edited 10%", "previewEdited10Ms"],
    ["preview, all keys changed", "previewRekeyedMs"],
    ["getLabellingCatalogue (admin)", "getLabellingCatalogueMs"],
    ["getLabellingCatalogue (staff)", "getLabellingCatalogueStaffMs"],
    ["getMenuVersion", "getMenuVersionMs"],
  ]
  const rows = []
  for (const v of VOLS) {
    const b = read(BASE, v, "menu-bench.json")
    const a = read(AFTER, v, "menu-bench.json")
    if (!b || !a) continue
    for (const size of [150, 2000]) {
      const fb = b.flows.find((x) => x.size === size)
      const fa = a.flows.find((x) => x.size === size)
      for (const [label, k] of steps) rows.push([v, String(size), label, stat(fb?.[k]), stat(fa?.[k])])
      for (const [label, k] of [["activate first (1 run)", "activateFirstMs"], ["create draft (1 run)", "createDraftMs"]]) {
        rows.push([v, String(size), label, num(fb?.[k]), num(fa?.[k])])
      }
    }
  }
  table(["Volume", "Items", "Step", "before", "after"], rows)
  const mrows = []
  for (const v of VOLS) {
    const b = read(BASE, v, "menu-bench.json")
    const a = read(AFTER, v, "menu-bench.json")
    if (!b || !a) continue
    for (const r of a.match) {
      const x = b.match.find((y) => y.size === r.size && y.label === r.label)
      mrows.push([v, String(r.size), r.label, `${num(x?.matchMs.p50)} / ${num(x?.diffMs.p50)}`, `${num(r.matchMs.p50)} / ${num(r.diffMs.p50)}`])
    }
  }
  p("#### Matching alone (pure CPU), p50 ms match / diff")
  p()
  table(["Volume", "Items", "Case", "before", "after"], mrows)
}

// ------------------------------------------------------------ explain
p("### EXPLAIN (ANALYZE, BUFFERS) execution time, ms")
p()
{
  const rows = []
  for (const v of VOLS) {
    const b = read(BASE, v, "explain/summary.json")
    const a = read(AFTER, v, "explain/summary.json")
    if (!b || !a) continue
    for (const r of a) {
      const x = b.find((y) => y.name === r.name)
      const seq = (d) => d?.seqScans?.filter((s) => !["venues", "profiles"].includes(s)).join(", ") || "-"
      rows.push([v, r.name, num(x?.executionMs), num(r.executionMs), seq(x), seq(r)])
    }
  }
  table(["Volume", "Statement", "before ms", "after ms", "seq scans before", "seq scans after"], rows)
}

// ------------------------------------------------------------ media
{
  const b = read(BASE, "media", "media-bench.json")
  const a = read(AFTER, "media", "media-bench.json")
  if (b && a) {
    p("### Media processing: sequential, one process per row")
    p()
    table(
      ["Input", "wall p50 before / after", "CPU ms per op before / after", "peak RSS MiB before / after"],
      a.results.filter((r) => r.wallMs).map((r) => {
        const x = b.results.find((y) => y.name === r.name)
        return [r.name, `${num(x?.wallMs?.p50)} / ${num(r.wallMs.p50)}`, `${num(x?.cpuMsPerOp)} / ${num(r.cpuMsPerOp)}`, `${x?.peakRssMiB ?? "n/a"} / ${r.peakRssMiB}`]
      })
    )
    p("### Media processing: concurrent callers in one process")
    p()
    const flat = (d) => d.results.filter((r) => r.batches).flatMap((r) => r.batches.map((x) => ({ input: r.name.replace(/, concurrent.*/, ""), ...x })))
    const fb = flat(b)
    table(
      ["Input", "concurrent", "per item ms before / after", "peak RSS MiB before / after", "failures after"],
      flat(a).map((x) => {
        const y = fb.find((z) => z.input === x.input && z.concurrency === x.concurrency)
        return [x.input, String(x.concurrency), `${num(y ? y.batchMs.p50 / y.concurrency : null)} / ${num(x.batchMs.p50 / x.concurrency)}`, `${y?.peakRssMiB ?? "n/a"} / ${x.peakRssMiB}`, String(x.failures)]
      })
    )
  }
}

const text = out.join("\n")
if (arg("out")) writeFileSync(resolve(arg("out")), text)
else console.log(text)
