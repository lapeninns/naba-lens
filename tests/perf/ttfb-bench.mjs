// Server response time for the admin library, staff portfolio and menu pages from
// `next build` + `next start` against spare6, and the first-load client JS of
// those routes. TTFB is time to response headers; "complete" is the full body.
// Pages here stream (loading.tsx suspense), so TTFB can precede the data: the
// complete time is the one that includes the queries.
//
//   source /tmp/nabalens-ws/spare6/env.sh
//   # app: pnpm build && pnpm exec next start -p 3646 (see docs/perf/baseline.md)
//   node tests/perf/ttfb-bench.mjs --volume expected [--n 20] [--warm 3] [--out docs/perf/raw]
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"

import { signIn } from "./actors.mjs"
import { gitHead, requireSpare6, summarise } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const N = Number(arg("n", 20))
const WARM = Number(arg("warm", 3))
const BASE = arg("base", "http://127.0.0.1:3646")
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const env = requireSpare6()
if (!/^http:\/\/127\.0\.0\.1:3646$/.test(BASE)) throw new Error("Refusing a base URL other than the spare6 app port")
const t = pickTargets(env.dbUrl)

const adminSession = await signIn(env, t.admin.email)
const heavySession = await signIn(env, t.staffHeavy.email)
const medianSession = await signIn(env, t.staffMedian.email)

const rssOfServer = () => {
  try {
    const pid = execFileSync("lsof", ["-ti", "tcp:3646", "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]
    const tree = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number))
    const kids = new Set([Number(pid)])
    for (let changed = true; changed; ) {
      changed = false
      for (const [p, pp] of tree) if (kids.has(pp) && !kids.has(p)) { kids.add(p); changed = true }
    }
    return Math.round(tree.filter(([p]) => kids.has(p)).reduce((a, [, , r]) => a + r, 0) / 1024)
  } catch {
    return null
  }
}

async function hit(path, cookie, { method = "GET", headers = {} } = {}) {
  const t0 = performance.now()
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { cookie, ...headers } })
  const ttfb = performance.now() - t0
  const body = Buffer.from(await res.arrayBuffer())
  return { status: res.status, ttfb, total: performance.now() - t0, bytes: body.length, body, headers: res.headers }
}

const routes = [
  ["admin library /admin", "/admin", adminSession],
  ["admin library, largest venue", `/admin?venue=${t.bigVenue.id}`, adminSession],
  ["admin library, category filter", `/admin?category=${t.category}`, adminSession],
  ["admin library, venue + category filter", `/admin?venue=${t.bigVenue.id}&category=${t.category}`, adminSession],
  ["admin library, search q=tikka", "/admin?q=tikka", adminSession],
  ["admin menus list", "/admin/menus", adminSession],
  ["admin menus, largest venue", `/admin/menus/${t.bigVenue.id}`, adminSession],
  ["admin menu version (largest venue, active)", `/admin/menus/versions/${t.activeVersion.id}`, adminSession],
  ["admin menu version (smallest venue, active)", `/admin/menus/versions/${t.smallActiveVersion}`, adminSession],
  ["admin staff list", "/admin/staff", adminSession],
  ["admin staff member (heaviest)", `/admin/staff/${t.staffHeavy.id}`, adminSession],
  ["staff portfolio (heaviest)", "/staff", heavySession],
  ["staff portfolio (median)", "/staff", medianSession],
  ["JSON /api/library", "/api/library", adminSession],
  ["JSON /api/library?category=curries", `/api/library?category=${t.category}`, adminSession],
  ["JSON /api/portfolio (heaviest)", "/api/portfolio", heavySession],
]

const rows = []
const rssBefore = rssOfServer()
for (const [name, path, session] of routes) {
  const ttfb = [], total = []
  let last
  let warm = WARM
  let n = N
  for (let i = 0; i < warm + n; i++) {
    last = await hit(path, session.cookie, path.startsWith("/api/") ? { headers: { "sec-fetch-site": "same-origin", origin: BASE } } : {})
    // A route that already takes seconds is sampled fewer times.
    if (i === 0 && last.total > 3000) { warm = 1; n = Math.min(N, 8) }
    if (i >= warm) { ttfb.push(last.ttfb); total.push(last.total) }
  }
  rows.push({
    name, path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>"), status: last.status, htmlBytes: last.bytes,
    ttfbMs: summarise(ttfb), completeMs: summarise(total),
    cacheControl: last.headers.get("cache-control"),
  })
  console.error(`${name.padEnd(46)} ${last.status}  ttfb p50 ${rows.at(-1).ttfbMs.p50}  complete p50 ${rows.at(-1).completeMs.p50} p95 ${rows.at(-1).completeMs.p95} ms  ${last.bytes} B`)
}
const rssAfter = rssOfServer()

// ---------------------------------------------------------------- client JS
const bundles = []
const chunkCache = new Map()
async function chunk(url) {
  if (!chunkCache.has(url)) {
    const res = await fetch(BASE + url)
    const buf = Buffer.from(await res.arrayBuffer())
    chunkCache.set(url, { raw: buf.length, gzip: gzipSync(buf).length, brotli: brotliCompressSync(buf).length })
  }
  return chunkCache.get(url)
}
const bundleRoutes = [
  ["login", "/login", null],
  ["admin library", "/admin", adminSession],
  ["admin menus list", "/admin/menus", adminSession],
  ["admin menus, venue", `/admin/menus/${t.bigVenue.id}`, adminSession],
  ["admin menu version", `/admin/menus/versions/${t.activeVersion.id}`, adminSession],
  ["admin staff list", "/admin/staff", adminSession],
  ["staff portfolio", "/staff", heavySession],
]
for (const [name, path, session] of bundleRoutes) {
  const r = await hit(path, session?.cookie ?? "")
  const html = r.body.toString("utf8")
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))/g)].map((m) => m[1]))]
  let js = { raw: 0, gzip: 0, brotli: 0, files: 0 }, css = { raw: 0, gzip: 0, brotli: 0, files: 0 }
  for (const u of urls) {
    const c = await chunk(u)
    const o = u.endsWith(".css") ? css : js
    o.raw += c.raw; o.gzip += c.gzip; o.brotli += c.brotli; o.files++
  }
  bundles.push({ name, path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>"), status: r.status, htmlBytes: r.bytes, js, css })
  console.error(`bundle ${name.padEnd(24)} ${r.status}  JS ${js.files} files ${(js.raw / 1024).toFixed(0)} KiB raw, ${(js.gzip / 1024).toFixed(0)} KiB gzip, ${(js.brotli / 1024).toFixed(0)} KiB brotli; CSS ${(css.raw / 1024).toFixed(0)} KiB`)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, "ttfb.json"),
  JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), revision: gitHead(), repetitions: { warm: WARM, n: N }, loadAverage: loadavg(), serverRssMiB: { before: rssBefore, after: rssAfter }, routes: rows, bundles }, null, 2)
)
console.error(`wrote ${join(OUT, "ttfb.json")}`)
