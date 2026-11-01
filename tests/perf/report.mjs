// Renders the raw JSON under docs/perf/raw into the markdown tables of
// docs/perf/baseline.md. Prints to stdout (or --out <file>).
//
//   node tests/perf/report.mjs [--raw docs/perf/raw] [--out file.md]
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const RAW = resolve(arg("raw", "docs/perf/raw"))
const VOLS = ["current", "expected", "high"]
const read = (v, f) => {
  const p = join(RAW, v, f)
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
}
const out = []
const p = (s = "") => out.push(s)
const num = (n) => (n == null || Number.isNaN(n) ? "n/a" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: n >= 100 ? 0 : 1 }))
const table = (head, rows) => {
  p(`| ${head.join(" | ")} |`)
  p(`| ${head.map((h, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`)
  for (const r of rows) p(`| ${r.join(" | ")} |`)
  p()
}
const cell = (r) => (r ? (r.failures ? `**${num(r.wallMs.p50)} / ${num(r.wallMs.p95)}, ${r.failures}/${r.sampled ?? "?"} failed**` : `${num(r.wallMs.p50)} / ${num(r.wallMs.p95)}`) : "n/a")

// ---------------------------------------------------------------- volumes
p("### Data volumes as generated")
p()
const vol = Object.fromEntries(VOLS.map((v) => [v, read(v, "volume.json")]))
table(
  ["Row counts (PERF rows only)", ...VOLS],
  ["media_assets", "media_archive_receipts", "media_labels", "media_label_items", "media_label_events", "menu_item_suggestions", "menu_versions", "menu_sections", "menu_items", "menu_entries", "menu_entry_variants", "profiles", "venues"].map((t) => [t, ...VOLS.map((v) => num(vol[v]?.counts[t]))])
)
table(
  ["Shape", ...VOLS],
  [
    ["staff / venues", ...VOLS.map((v) => (vol[v] ? `${vol[v].perStaff.people} / ${vol[v].perVenue.length}` : "n/a"))],
    ["assets per person, min / median / max", ...VOLS.map((v) => (vol[v] ? `${num(vol[v].perStaff.min)} / ${num(vol[v].perStaff.median)} / ${num(vol[v].perStaff.max)}` : "n/a"))],
    ["largest venue, assets", ...VOLS.map((v) => num(Math.max(...(vol[v]?.perVenue.map((x) => x.media) ?? [NaN]))))],
    ["original bytes (sum)", ...VOLS.map((v) => (vol[v] ? `${(vol[v].originalBytes.total / 1e12).toFixed(2)} TB` : "n/a"))],
  ]
)
const sizeOf = (v, t) => vol[v]?.sizes.find((s) => s.table === t)?.pretty ?? "n/a"
table(
  ["Table + indexes on disk", ...VOLS],
  ["media_archive_receipts", "media_assets", "media_label_items", "media_labels", "media_label_events", "menu_entries"].map((t) => [t, ...VOLS.map((v) => sizeOf(v, t))])
)

// ---------------------------------------------------------------- db paths
const db = Object.fromEntries(VOLS.map((v) => [v, read(v, "db-paths.json")]))
const groups = [["admin-feed", "Admin library feed and filters"], ["staff", "Staff portfolio, labelling and `library_assets` as staff"], ["menus", "Menu admin reads"]]
for (const [group, title] of groups) {
  p(`### ${title}: p50 / p95 ms (wall time of the app function)`)
  p()
  const names = [...new Set(VOLS.flatMap((v) => db[v]?.results.filter((r) => r.group === group).map((r) => r.name) ?? []))]
  // Row labels that carry a volume-dependent number are matched by prefix.
  const key = (n) => n.replace(/\(offset \d+\)|\(\d[\d,]* assets\)|, \d+ assets/g, "").replace(/\s+/g, " ").trim()
  const byKey = new Map()
  for (const n of names) byKey.set(key(n), n)
  table(
    ["Path", ...VOLS, "requests (high)"],
    [...byKey].map(([k]) => {
      const find = (v) => db[v]?.results.find((r) => r.group === group && key(r.name) === k)
      const hi = find("high")
      return [k, ...VOLS.map((v) => cell(find(v))), hi ? String(hi.requestsP50) : "n/a"]
    })
  )
}
const errors = VOLS.flatMap((v) => (db[v]?.results ?? []).filter((r) => r.errors.length).map((r) => ({ v, name: r.name, errors: r.errors })))
if (errors.length) {
  p("### Errors seen by the app functions")
  p()
  table(["Volume", "Path", "Error (count)"], errors.flatMap((e) => e.errors.map((x) => [e.v, e.name, `${x.message.replace(/\|/g, "/")} (${x.count})`])))
}

// ---------------------------------------------------------------- refresh
const rf = Object.fromEntries(VOLS.map((v) => [v, read(v, "refresh-bench.json")]))
if (VOLS.some((v) => rf[v])) {
  const r0 = rf[VOLS.find((v) => rf[v])]
  p("### Admin gallery foreground refresh: k cursor pages read one after another, p50 / p95 ms")
  p()
  table(
    ["Feed, pages loaded", ...VOLS],
    r0.refresh.map((r) => [`${r.label}, ${r.pages} page${r.pages > 1 ? "s" : ""}`, ...VOLS.map((v) => { const f = rf[v]?.refresh.find((x) => x.label === r.label && x.pages === r.pages); return f ? `${num(f.refreshMs.p50)} / ${num(f.refreshMs.p95)}` : "n/a" })])
  )
  p("### Several admins at once, per-request p50 / p95 ms")
  p()
  table(
    ["Path, concurrent admins", ...VOLS],
    r0.concurrent.map((r) => [`${r.label} x${r.concurrent}`, ...VOLS.map((v) => { const f = rf[v]?.concurrent.find((x) => x.label === r.label && x.concurrent === r.concurrent); return f ? `${num(f.wallMs.p50)} / ${num(f.wallMs.p95)}${f.failures ? ` **${f.failures}/${f.of} failed**` : ""}` : "n/a" })])
  )
}

// ---------------------------------------------------------------- explain
p("### EXPLAIN (ANALYZE, BUFFERS) execution time, ms (single run, warm cache)")
p()
const ex = Object.fromEntries(VOLS.map((v) => [v, read(v, "explain/summary.json")]))
const exNames = [...new Set(VOLS.flatMap((v) => ex[v]?.map((r) => r.name) ?? []))]
table(
  ["Statement", ...VOLS, "seq scans (high)"],
  exNames.map((n) => {
    const f = (v) => ex[v]?.find((r) => r.name === n)
    return [n, ...VOLS.map((v) => (f(v)?.error ? "error" : num(f(v)?.executionMs))), f("high")?.seqScans.filter((s) => !["venues", "profiles"].includes(s)).join(", ") || "-"]
  })
)

// ---------------------------------------------------------------- menu bench
const mb = Object.fromEntries(VOLS.map((v) => [v, read(v, "menu-bench.json")]))
if (VOLS.some((v) => mb[v])) {
  p("### Menu import: parse and validate, p50 / p95 ms (pure CPU, one core)")
  p()
  const m0 = mb[VOLS.find((v) => mb[v])]
  table(
    ["Items / format", "file size", "p50 / p95 ms"],
    m0.parse.map((r) => [`${r.size} / ${r.format}`, `${num(r.bytes / 1024)} KiB`, `${num(r.p50)} / ${num(r.p95)}${r.ok ? "" : " (rejected)"}`])
  )
  p("### Menu import: match and diff against the active menu, p50 ms (pure CPU)")
  p()
  table(
    ["Items", "Case", "match", "diff", "uncertain", "added", "changed", "removed"],
    m0.match.map((r) => [String(r.size), r.label, num(r.matchMs.p50), num(r.diffMs.p50), String(r.uncertain), String(r.added), String(r.changed), String(r.removed)])
  )
  p("### Menu draft and activation through the real RPCs, p50 / p95 ms (per volume)")
  p()
  table(
    ["Items", "Step", ...VOLS],
    [50, 150, 600, 2000].flatMap((size) => {
      const f = (v) => mb[v]?.flows.find((x) => x.size === size)
      const st = (x) => (x ? `${num(x.p50)} / ${num(x.p95)}` : "n/a")
      const one = (x) => (x == null ? "n/a" : num(x))
      return [
        [String(size), "file / document bytes", ...VOLS.map((v) => (f(v) ? `${num(f(v).bytes.json / 1024)} KiB / ${num((f(v).documentBytes ?? 0) / 1024)} KiB` : "n/a"))],
        ["", "create draft (1 run)", ...VOLS.map((v) => one(f(v)?.createDraftMs))],
        ["", "save draft (1 run)", ...VOLS.map((v) => one(f(v)?.saveDraftMs))],
        ["", "activate first (1 run)", ...VOLS.map((v) => one(f(v)?.activateFirstMs))],
        ["", "preview against active (same file)", ...VOLS.map((v) => st(f(v)?.previewSameFileMs))],
        ["", "preview, edited 10%", ...VOLS.map((v) => st(f(v)?.previewEdited10Ms))],
        ["", "preview, all keys changed", ...VOLS.map((v) => st(f(v)?.previewRekeyedMs))],
        ["", "replace cycle: create draft", ...VOLS.map((v) => st(f(v)?.replaceCycle?.createDraftMs))],
        ["", "replace cycle: activate (retires old)", ...VOLS.map((v) => st(f(v)?.replaceCycle?.activateMs))],
        ["", "getLabellingCatalogue (admin)", ...VOLS.map((v) => st(f(v)?.getLabellingCatalogueMs))],
        ["", "getLabellingCatalogue (staff)", ...VOLS.map((v) => st(f(v)?.getLabellingCatalogueStaffMs))],
        ["", "getMenuVersion", ...VOLS.map((v) => st(f(v)?.getMenuVersionMs))],
      ]
    })
  )
  p("### Activation on the largest real venue (labels attached)")
  p()
  table(
    ["Volume", "venue assets", "draft from active ms", "activate ms"],
    VOLS.filter((v) => mb[v]?.other?.[0]).map((v) => {
      const o = mb[v].other[0]
      return [v, num(o.venueMedia), o.cycles.map((c) => num(c.draftFromActiveMs)).join(", "), o.cycles.map((c) => (c.ok ? num(c.activateMs) : `failed: ${c.message}`)).join(", ")]
    })
  )
}

// ---------------------------------------------------------------- media
const mdb = read("media", "media-bench.json")
if (mdb) {
  p("### Media processing: sequential, one process per row")
  p()
  table(
    ["Input", "size", "wall p50 / p95 ms", "CPU ms per op", "peak RSS MiB (idle)"],
    mdb.results.filter((r) => r.wallMs).map((r) => [r.name, `${num(r.inputBytes / 1048576)} MiB`, `${num(r.wallMs.p50)} / ${num(r.wallMs.p95)}`, num(r.cpuMsPerOp), `${r.peakRssMiB} (${r.baselineRssMiB})`])
  )
  p("### Media processing: concurrent callers in one process")
  p()
  table(
    ["Input", "concurrent", "batch p50 / p95 ms", "per item ms", "peak RSS MiB", "failures"],
    mdb.results.filter((r) => r.batches).flatMap((r) => r.batches.map((b) => [r.name.replace(/, concurrent.*|, concurrent.*/, ""), String(b.concurrency), `${num(b.batchMs.p50)} / ${num(b.batchMs.p95)}`, num(b.batchMs.p50 / b.concurrency), String(b.peakRssMiB), String(b.failures)]))
  )
}

// ---------------------------------------------------------------- delivery
const dl = Object.fromEntries(VOLS.map((v) => [v, read(v, "delivery.json")]))
if (VOLS.some((v) => dl[v])) {
  p("### Delivery: route time to the 302 and signed Storage GET, p50 / p95 ms")
  p()
  const d0 = dl[VOLS.find((v) => dl[v])]
  table(
    ["Route", ...VOLS.flatMap((v) => [`${v} route`, `${v} storage GET`])],
    d0.routes.map((r) => [r.name, ...VOLS.flatMap((v) => {
      const f = dl[v]?.routes.find((x) => x.name === r.name)
      return f ? [`${num(f.routeMs.p50)} / ${num(f.routeMs.p95)}`, `${num(f.signedStorageMs.p50)} / ${num(f.signedStorageMs.p95)}`] : ["n/a", "n/a"]
    })])
  )
  table(
    ["Path", ...VOLS],
    [
      ...d0.concurrency.map((c) => [c.name + " (wall ms)", ...VOLS.map((v) => { const f = dl[v]?.concurrency.find((x) => x.name === c.name); return f ? `${num(f.wallMs.p50)} / ${num(f.wallMs.p95)}` : "n/a" })]),
      ["authorisation only (signDerivative, in process)", ...VOLS.map((v) => (dl[v]?.inProcess ? `${num(dl[v].inProcess.signDerivativeMs.p50)} / ${num(dl[v].inProcess.signDerivativeMs.p95)}` : "n/a"))],
      ["  of which asset read", ...VOLS.map((v) => (dl[v]?.inProcess ? num(dl[v].inProcess.assetReadMs.p50) : "n/a"))],
      ["  of which sign call", ...VOLS.map((v) => (dl[v]?.inProcess ? num(dl[v].inProcess.signCallMs.p50) : "n/a"))],
    ]
  )
  const h = d0.routes[0].headers
  p(`Derivative sizes: thumbnail ${num(d0.derivative.thumbBytes / 1024)} KiB, preview ${num(d0.derivative.previewBytes / 1024)} KiB (from the smooth synthetic 12 MP image).`)
  p()
  p("Route response headers: `" + JSON.stringify(h.route) + "`. Signed Storage response: `" + JSON.stringify(h.storage) + "`.")
  p()
  if (d0.stream) {
    table(
      ["Video stream, 20 MiB original", ...VOLS.map((v) => v)],
      d0.stream.ranges.map((r) => [`${r.label} (TTFB p50 / p95 ms)`, ...VOLS.map((v) => { const f = dl[v]?.stream?.ranges.find((x) => x.range === r.range); return f ? `${num(f.ttfbMs.p50)} / ${num(f.ttfbMs.p95)}` : "n/a" })])
    )
    p("Stream response headers: `" + JSON.stringify(d0.stream.ranges[0].response) + "`.")
    p()
  }
}

// ---------------------------------------------------------------- ttfb
const tt = Object.fromEntries(VOLS.map((v) => [v, read(v, "ttfb.json")]))
if (VOLS.some((v) => tt[v])) {
  p("### Page and API response time from `next start`: complete / TTFB p50, complete p95 (ms)")
  p()
  const t0 = tt[VOLS.find((v) => tt[v])]
  table(
    ["Route", ...VOLS, "HTML bytes (high)"],
    t0.routes.map((r) => [r.name, ...VOLS.map((v) => { const f = tt[v]?.routes.find((x) => x.name === r.name); return f ? `${num(f.completeMs.p50)} / ${num(f.ttfbMs.p50)}, p95 ${num(f.completeMs.p95)}${f.status >= 400 ? ` (HTTP ${f.status})` : ""}` : "n/a" }), num(tt.high?.routes.find((x) => x.name === r.name)?.htmlBytes)])
  )
  p("### First-load client assets per route (same build at every volume)")
  p()
  table(
    ["Route", "JS files", "JS raw KiB", "JS gzip KiB", "JS brotli KiB", "CSS raw KiB", "HTML KiB (largest volume)"],
    t0.bundles.map((b) => [b.name, String(b.js.files), num(b.js.raw / 1024), num(b.js.gzip / 1024), num(b.js.brotli / 1024), num(b.css.raw / 1024), num((tt.high ?? t0).bundles.find((x) => x.name === b.name).htmlBytes / 1024)])
  )
}

const text = out.join("\n")
if (arg("out")) writeFileSync(resolve(arg("out")), text)
else console.log(text)
