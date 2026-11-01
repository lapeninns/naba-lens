// Catalogue and media data paths, measured through the app's own server code
// (lib/server/media/library.ts, lib/server/labels, lib/server/menus,
// lib/server/media/library-labels.ts) against the local spare6 stack, as signed-in
// PERF people so RLS and the API statement timeout apply as in production.
//
//   source /tmp/nabalens-ws/spare6/env.sh
//   node --conditions=react-server --import tsx tests/perf/db-bench.mjs \
//     --volume expected [--n 20] [--warm 3] [--out docs/perf/raw]
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadavg } from "node:os"
import { pathToFileURL } from "node:url"

import { makeActor, signIn, timeIt } from "./actors.mjs"
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
const only = arg("only", null)
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)

const env = requireSpare6()
const root = resolve(".")
const lib = (p) => import(pathToFileURL(join(root, p)).href)
const library = await lib("lib/server/media/library.ts")
const labels = await lib("lib/server/labels/index.ts")
const menus = await lib("lib/server/menus/index.ts")
const libraryLabels = await lib("lib/server/media/library-labels.ts")

const loadStart = loadavg()
const targets = pickTargets(env.dbUrl)
const sessions = {}
async function actorFor(person) {
  sessions[person.email] ??= await signIn(env, person.email)
  return makeActor(env, sessions[person.email], person)
}

const results = []
function record(name, group, rows, extra = {}) {
  const ok = rows.filter((r) => r.result?.ok !== false && !r.result?.threw)
  const failed = rows.filter((r) => r.result?.ok === false || r.result?.threw)
  const errs = new Map()
  for (const r of rows) {
    for (const e of r.errors ?? []) {
      const k = `${e.status} ${e.body ?? ""}`.slice(0, 160)
      errs.set(k, (errs.get(k) ?? 0) + 1)
    }
    if (r.result?.threw) errs.set(`threw ${r.result.threw}`.slice(0, 160), (errs.get(`threw ${r.result.threw}`.slice(0, 160)) ?? 0) + 1)
  }
  const wall = summarise(rows.map((r) => r.ms))
  const med = (f) => {
    const v = rows.map(f).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  const entry = {
    name,
    group,
    volume: VOLUME,
    wallMs: wall,
    requestsP50: med((r) => r.requests ?? 0),
    requestMsP50: Math.round(med((r) => r.requestMs ?? 0) * 10) / 10,
    rows: ok[0]?.result?.rows ?? null,
    failures: failed.length,
    errors: [...errs].map(([message, count]) => ({ message, count })),
    ...extra,
  }
  results.push(entry)
  console.error(
    `${group.padEnd(10)} ${name.padEnd(46)} p50 ${String(wall.p50).padStart(8)} ms  p95 ${String(wall.p95).padStart(8)} ms  req ${entry.requestsP50}  rows ${entry.rows}  fail ${entry.failures}`
  )
}

async function measure(name, group, { log }, fn, extra) {
  if (only && !`${group}:${name}`.includes(only)) return
  // Probe once: a path that already takes seconds is sampled fewer times.
  const first = await timeIt(fn, { warm: 0, n: 1, log })
  const slow = first[0].ms > 3000
  const rows = await timeIt(fn, {
    warm: slow ? 1 : WARM,
    n: slow ? Math.min(N, 8) : N,
    log,
  })
  record(name, group, rows, { sampled: rows.length, ...extra })
}

const rowsOf = (page) => ({ ...page, rows: page.ok ? page.items.length : 0 })
const cursorOf = (c) => library.encodeCursor(c.createdAt, c.id)
const f = (o = {}) => ({
  venueId: null, staffId: null, type: null, itemId: null, variantId: null,
  category: null, contentType: null, labelState: null, query: null, from: null, to: null, ...o,
})

// ---------------------------------------------------------------- admin library
const admin = await actorFor(targets.admin)
const A = admin.actor
const ctxA = { log: admin.log }
const lib_ = (filters, cursor) => async () => rowsOf(await library.listLibrary(A, f(filters), cursor))

await measure("first page, no filter", "admin-feed", ctxA, lib_({}))
for (const c of targets.cursors.feed)
  await measure(`cursor page at ${c.frac * 100}% depth (offset ${c.offset})`, "admin-feed", ctxA, lib_({}, cursorOf(c)))
await measure("venue filter (largest)", "admin-feed", ctxA, lib_({ venueId: targets.bigVenue.id }))
for (const c of targets.cursors.bigVenue)
  await measure(`venue (largest), cursor at ${c.frac * 100}% (offset ${c.offset})`, "admin-feed", ctxA, lib_({ venueId: targets.bigVenue.id }, cursorOf(c)))
await measure("venue filter (smallest)", "admin-feed", ctxA, lib_({ venueId: targets.smallVenue.id }))
await measure("staff filter (heaviest uploader)", "admin-feed", ctxA, lib_({ staffId: targets.staffHeavy.id }))
for (const c of targets.cursors.heavyStaffAdmin)
  await measure(`staff (heaviest), cursor at ${c.frac * 100}%`, "admin-feed", ctxA, lib_({ staffId: targets.staffHeavy.id }, cursorOf(c)))
await measure("staff filter (lightest)", "admin-feed", ctxA, lib_({ staffId: targets.staffLight.id }))
await measure("type = video", "admin-feed", ctxA, lib_({ type: "video" }))
await measure("type = image", "admin-feed", ctxA, lib_({ type: "image" }))
await measure("venue + staff + type", "admin-feed", ctxA, lib_({ venueId: targets.staffHeavy.venueId, staffId: targets.staffHeavy.id, type: "image" }))
await measure("date range, last 7 days", "admin-feed", ctxA, lib_({ from: targets.dayRanges[0], to: targets.dayRanges[2] }))
await measure("date range, last 90 days", "admin-feed", ctxA, lib_({ from: targets.dayRanges[1], to: targets.dayRanges[2] }))
await measure("category = curries (library_assets)", "admin-feed", ctxA, lib_({ category: targets.category }))
for (const c of targets.cursors.category)
  await measure(`category = curries, cursor at ${c.frac * 100}%`, "admin-feed", ctxA, lib_({ category: targets.category }, cursorOf(c)))
await measure("venue (largest) + category", "admin-feed", ctxA, lib_({ venueId: targets.bigVenue.id, category: targets.category }))
await measure("item filter, popular item", "admin-feed", ctxA, lib_({ itemId: targets.popularItem.id }), { labelsMatching: targets.popularItem.labels })
await measure("item filter, rare item", "admin-feed", ctxA, lib_({ itemId: targets.rareItem.id }), { labelsMatching: targets.rareItem.labels })
await measure("item + variant filter", "admin-feed", ctxA, lib_({ itemId: null, variantId: targets.popularVariant.id }))
await measure("content type = dish", "admin-feed", ctxA, lib_({ contentType: "dish" }))
await measure("labels = labelled", "admin-feed", ctxA, lib_({ labelState: "labelled" }))
await measure("labels = unlabelled", "admin-feed", ctxA, lib_({ labelState: "unlabelled" }))
await measure("search q=tikka", "admin-feed", ctxA, lib_({ query: "tikka" }))
await measure("search q=chicken (very common)", "admin-feed", ctxA, lib_({ query: "chicken" }))
await measure("search q=sunday (notes)", "admin-feed", ctxA, lib_({ query: "sunday" }))
await measure("search q=zzzqq (no match)", "admin-feed", ctxA, lib_({ query: "zzzqq" }))
await measure("search q=tikka + venue (largest)", "admin-feed", ctxA, lib_({ query: "tikka", venueId: targets.bigVenue.id }))
await measure("filter options, venue (largest)", "admin-feed", ctxA, async () => {
  const o = await libraryLabels.libraryLabelFilterOptions(A, targets.bigVenue.id)
  return { ok: true, rows: o.items.length }
})
await measure("filter options, venue (smallest)", "admin-feed", ctxA, async () => {
  const o = await libraryLabels.libraryLabelFilterOptions(A, targets.smallVenue.id)
  return { ok: true, rows: o.items.length }
})
await measure("filter options (venues + staff)", "admin-feed", ctxA, async () => {
  const o = await library.libraryFilterOptions(A)
  return { ok: true, rows: o.venues.length + o.staff.length }
})

// ---------------------------------------------------------------- staff
for (const [label, person] of [
  ["heaviest", targets.staffHeavy],
  ["median", targets.staffMedian],
  ["lightest", targets.staffLight],
]) {
  const s = await actorFor(person)
  const ctx = { log: s.log }
  const own = (cursor) => async () => rowsOf(await library.listOwnMedia(s.actor, cursor))
  await measure(`portfolio first page (${label}, ${person.media} assets)`, "staff", ctx, own())
  const cur =
    label === "heaviest" ? targets.cursors.staffHeavyOwn : label === "median" ? targets.cursors.staffMedianOwn : []
  for (const c of cur)
    await measure(`portfolio cursor ${c.frac * 100}% (${label})`, "staff", ctx, own(cursorOf(c)))
}
{
  const s = await actorFor(targets.staffHeavy)
  const ctx = { log: s.log }
  const venue = targets.staffHeavy.venueId
  await measure("getLabellingCatalogue (staff, own venue)", "staff", ctx, async () => {
    const r = await labels.getLabellingCatalogue(s.actor, venue)
    return r.ok ? { ok: true, rows: r.catalogue.status === "active" ? r.catalogue.sections.reduce((a, x) => a + x.items.length, 0) : 0 } : r
  })
  await measure("getAssetLabelContext (10 assets, staff)", "staff", ctx, async () => {
    const r = await labels.getAssetLabelContext(s.actor, targets.heavyAssets)
    return r.ok ? { ok: true, rows: r.assets.length } : r
  })
  await measure("library_assets as staff, category (RLS plan)", "staff", ctx, async () => {
    const { data, error } = await s.actor.db
      .rpc("library_assets", { p_category: targets.category })
      .select("id, created_at, venue:venues(name)")
      .is("deleted_at", null)
      .eq("upload_state", "ready")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(25)
    return error ? { ok: false, message: error.message } : { ok: true, rows: data.length }
  })
  await measure("library_assets as staff, venue + category", "staff", ctx, async () => {
    const { data, error } = await s.actor.db
      .rpc("library_assets", { p_category: targets.category })
      .select("id, created_at, venue:venues(name)")
      .is("deleted_at", null)
      .eq("upload_state", "ready")
      .eq("venue_id", venue)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(25)
    return error ? { ok: false, message: error.message } : { ok: true, rows: data.length }
  })
}

// ---------------------------------------------------------------- menu admin
await measure("getLabellingCatalogue (admin, largest menu)", "menus", ctxA, async () => {
  const r = await labels.getLabellingCatalogue(A, targets.bigVenue.id)
  return r.ok ? { ok: true, rows: r.catalogue.status === "active" ? r.catalogue.sections.reduce((a, x) => a + x.items.length, 0) : 0 } : r
})
await measure("getLabellingCatalogue (admin, smallest venue)", "menus", ctxA, async () => {
  const r = await labels.getLabellingCatalogue(A, targets.smallVenue.id)
  return r.ok ? { ok: true, rows: r.catalogue.status === "active" ? r.catalogue.sections.reduce((a, x) => a + x.items.length, 0) : 0 } : r
})
await measure("listMenuVenues", "menus", ctxA, async () => {
  const r = await menus.listMenuVenues(A)
  return r.ok ? { ok: true, rows: r.venues.length } : r
})
await measure("getVenueMenuOverview (largest venue)", "menus", ctxA, async () => {
  const r = await menus.getVenueMenuOverview(A, targets.bigVenue.id)
  return r.ok ? { ok: true, rows: r.history.length + r.drafts.length + (r.active ? 1 : 0) } : r
})
const version = (id) => async () => {
  const r = await menus.getMenuVersion(A, id)
  return r.ok ? { ok: true, rows: r.version.document.sections.reduce((a, s) => a + s.items.length, 0) } : r
}
await measure("getMenuVersion, active (largest venue)", "menus", ctxA, version(targets.activeVersion.id), { labelItemsInVenue: null })
await measure("getMenuVersion, retired (largest venue)", "menus", ctxA, version(targets.retiredVersion.id))
await measure("getMenuVersion, active (smallest venue)", "menus", ctxA, version(targets.smallActiveVersion))

mkdirSync(OUT, { recursive: true })
const doc = {
  volume: VOLUME,
  at: new Date().toISOString(),
  revision: gitHead(),
  repetitions: { warm: WARM, n: N },
  loadAverage: { start: loadStart, end: loadavg() },
  targets: {
    ...targets,
    admin: { email: targets.admin.email },
    staffHeavy: { media: targets.staffHeavy.media },
    staffMedian: { media: targets.staffMedian.media },
    staffLight: { media: targets.staffLight.media },
  },
  results,
}
const file = join(OUT, "db-paths.json")
writeFileSync(file, JSON.stringify(doc, null, 2))
console.error(`wrote ${file}`)
