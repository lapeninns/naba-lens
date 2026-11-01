// Menu import parse/validate/match/diff and draft create/save/activate at
// realistic and maximum menu sizes, through the app's own server code
// (lib/menus/import, lib/server/menus) as a signed-in PERF admin. Test venues are
// created with slug perf-venue-menutest-<size> so generate.mjs purges them.
//
//   source /tmp/nabalens-ws/spare6/env.sh
//   node --conditions=react-server --import tsx tests/perf/menu-bench.mjs \
//     --volume expected [--n 12] [--out docs/perf/raw]
import { mkdirSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { makeActor, signIn } from "./actors.mjs"
import { gitHead, query, psql, requireSpare6, summarise } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const N = Number(arg("n", 12))
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const env = requireSpare6()
const root = resolve(".")
const lib = (p) => import(pathToFileURL(join(root, p)).href)
const importer = await lib("lib/menus/import/index.ts")
const menus = await lib("lib/server/menus/index.ts")
const labels = await lib("lib/server/labels/index.ts")

const targets = pickTargets(env.dbUrl)
const admin = makeActor(env, await signIn(env, targets.admin.email), targets.admin)
const A = admin.actor
const staffSession = await signIn(env, targets.staffLight.email)

// ---------------------------------------------------------------- synthetic menu files
const STYLES = ["Classic", "Smoked", "Spiced", "Crispy", "House"]
const PROTEINS = ["Chicken", "Lamb", "Prawn", "Paneer", "Beef", "Cod", "Duck", "Mushroom", "Aubergine", "Salmon", "Lentil", "Chickpea", "Pork", "Squid", "Halloumi", "Cauliflower", "Tofu", "Turkey", "Venison", "Sea Bass"]
const DISHES = ["Tikka", "Karahi", "Masala", "Biryani", "Skewers", "Pie", "Curry", "Salad", "Burger", "Tacos", "Risotto", "Kebab", "Stew", "Wrap", "Roast", "Platter", "Bowl", "Pasta", "Fritters", "Soup", "Flatbread", "Dumplings", "Noodles", "Grill", "Bites"]
const VARIANTS = ["Regular", "Large", "Small", "Chicken", "Lamb", "Vegetable"]
const itemName = (i, prefix = "") =>
  `${prefix}${STYLES[i % 5]} ${PROTEINS[Math.floor(i / 5) % 20]} ${DISHES[Math.floor(i / 100) % 25]}`
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/** `edit`: fraction renamed, dropped and added relative to the base menu. */
function menuJson(size, { keyPrefix = "", edit = 0, title = "PERF generated menu" } = {}) {
  const sectionCount = Math.min(100, Math.max(6, Math.ceil(size / 25)))
  const sections = Array.from({ length: sectionCount }, (_, s) => ({
    key: `sec-${String(s + 1).padStart(3, "0")}`,
    name: `Section ${s + 1}`,
    kind: s % 7 === 6 ? "drinks" : "food",
    items: [],
  }))
  const total = size + Math.round(size * edit)
  for (let i = 0; i < total; i++) {
    const dropped = edit > 0 && i < size && i % Math.round(1 / edit) === 0 && i % 2 === 0
    if (dropped) continue
    const renamed = edit > 0 && i < size && i % Math.round(1 / edit) === 1
    const name = itemName(i) + (renamed ? " Special" : "")
    const sec = sections[(i * 7) % sectionCount]
    sec.items.push({
      key: `${keyPrefix}${sec.key}--${slug(itemName(i))}`,
      name,
      description: i % 2 === 0 ? "Made fresh daily with seasonal produce, house sauce and a side." : null,
      aliases: i % 10 < 3 ? [`${PROTEINS[Math.floor(i / 5) % 20].toLowerCase()} ${DISHES[Math.floor(i / 100) % 25].toLowerCase()}`] : [],
      variants: i % 4 === 0 ? VARIANTS.slice(0, 2 + (i % 3)) : [],
      meta: { price: `${6 + (i % 20)}.50`, labels: i % 5 === 0 ? ["vegan"] : [] },
    })
  }
  return JSON.stringify({
    format: "nabalens-menu@1",
    title,
    source: { label: "perf.json", revision: "perf", capturedAt: "2026-10-01T00:00:00Z", notes: "synthetic" },
    sections: sections.filter((s) => s.items.length),
  })
}

function menuCsv(size) {
  const rows = ["section,section_key,item,key,description,aliases,variants,price"]
  const sectionCount = Math.min(100, Math.max(6, Math.ceil(size / 25)))
  for (let i = 0; i < size; i++) {
    const s = (i * 7) % sectionCount
    const key = `sec-${String(s + 1).padStart(3, "0")}`
    rows.push(
      [`Section ${s + 1}`, key, itemName(i), `${key}--${slug(itemName(i))}`, i % 2 === 0 ? "Made fresh daily with seasonal produce and a house sauce." : "", i % 10 < 3 ? "alias one" : "", i % 4 === 0 ? VARIANTS.slice(0, 2 + (i % 3)).join("|") : "", `${6 + (i % 20)}.50`].join(",")
    )
  }
  return rows.join("\n")
}

// ---------------------------------------------------------------- timing helpers
const out = { parse: [], match: [], flows: [], other: [] }
const ms = async (fn) => {
  const t = performance.now()
  const r = await fn()
  return [performance.now() - t, r]
}
async function sample(fn, { warm = 2, n = N } = {}) {
  const v = []
  let last
  for (let i = 0; i < warm + n; i++) {
    const [t, r] = await ms(fn)
    last = r
    if (i >= warm) v.push(t)
  }
  return { stats: summarise(v), last }
}
const log = (...a) => console.error(...a)

const SIZES = [50, 150, 600, 2000]
for (const size of SIZES) {
  const json = menuJson(size)
  const csv = menuCsv(size)
  const bytes = { json: Buffer.byteLength(json), csv: Buffer.byteLength(csv) }
  const oversize = Math.max(bytes.json, bytes.csv) > 1024 * 1024

  // Pure parse + validate.
  for (const [format, text] of [["json", json], ["csv", csv]]) {
    const { stats, last } = await sample(() => importer.parseMenuFile({ fileName: `menu.${format}`, text }))
    out.parse.push({ size, format, bytes: bytes[format], ok: last.ok, issues: last.issues?.length ?? 0, ...stats })
    log(`parse ${format} ${size} items (${bytes[format]} B): p50 ${stats.p50} ms p95 ${stats.p95}`)
  }
  const base = importer.parseMenuFile({ fileName: "m.json", text: json }).document
  const edited = importer.parseMenuFile({ fileName: "m.json", text: menuJson(size, { edit: 0.1 }) }).document
  const rekeyed = importer.parseMenuFile({ fileName: "m.json", text: menuJson(size, { keyPrefix: "new-" }) }).document

  // Matching against an identical-key base (carries ids), an edited file, and
  // the worst case where every key changed but every name matches.
  const withIds = (doc) => {
    const copy = structuredClone(doc)
    let n = 0
    for (const s of copy.sections) for (const i of s.items) { i.itemId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; i.variants.forEach((v, k) => (v.variantId = `00000000-0000-4000-9000-${String(n * 12 + k).padStart(12, "0")}`)) }
    return copy
  }
  const baseWithIds = withIds(base)
  for (const [label, incoming] of [["same keys, edited 10%", edited], ["all keys changed (worst case)", rekeyed]]) {
    const m = await sample(() => importer.matchImportToBase(baseWithIds, incoming), { warm: 1, n: Math.min(N, 6) })
    const matched = importer.matchImportToBase(baseWithIds, incoming)
    const d = await sample(() => importer.diffMenuDocuments(baseWithIds, matched), { warm: 1, n: Math.min(N, 6) })
    out.match.push({ size, label, matchMs: m.stats, diffMs: d.stats, uncertain: d.last.uncertain.length, added: d.last.added.length, changed: d.last.changed.length, removed: d.last.removed.length })
    log(`match ${size} ${label}: match p50 ${m.stats.p50} ms, diff p50 ${d.stats.p50} ms, uncertain ${d.last.uncertain.length}`)
  }

  // Full flow on a dedicated venue through the real RPCs.
  psql(env.dbUrl, ["-c", `insert into public.venues (name, slug) values ('PERF Menu Test ${size}', 'perf-venue-menutest-${size}') on conflict do nothing`])
  const [venueId] = query(env.dbUrl, `select id from public.venues where slug = 'perf-venue-menutest-${size}'`)[0]
  const flow = { size, bytes, oversize, venueId: undefined }
  const rec = (name, t, extra = {}) => { flow[name] = Math.round(t * 10) / 10; Object.assign(flow, extra) }

  let preview
  admin.log.reset()
  let [t, r] = await ms(() => menus.previewMenuImport(A, { venueId, fileName: "menu.json", text: json }))
  preview = r
  rec("previewNoBaseMs", t, { previewNoBaseRequests: admin.log.snapshot().requests })
  if (!preview.ok) { flow.error = preview.message; out.flows.push(flow); log("flow failed at preview", size, preview.message); continue }
  const docBytes = Buffer.byteLength(JSON.stringify(preview.document))
  rec("documentBytes", docBytes)
  ;[t, r] = await ms(() => menus.createMenuDraft(A, { venueId, title: preview.document.title, source: preview.source, document: preview.document, basedOnVersionId: null }))
  rec("createDraftMs", t, { createDraftOk: r.ok, createDraftMessage: r.ok ? undefined : r.message })
  if (!r.ok) { out.flows.push(flow); log("create draft failed", size, r.message); continue }
  const versionId = r.versionId
  ;[t, r] = await ms(() => menus.saveMenuDraft(A, { versionId, expectedRevision: 1, document: preview.document }))
  rec("saveDraftMs", t, { saveDraftOk: r.ok, saveDraftMessage: r.ok ? undefined : r.message })
  const revision = r.ok ? r.revision : 1
  ;[t, r] = await ms(() => menus.activateMenuVersion(A, { versionId, expectedRevision: revision }))
  rec("activateFirstMs", t, { activateOk: r.ok, activateMessage: r.ok ? undefined : r.message })

  // Preview against the now-active menu (loads it, parses, matches, diffs).
  for (const [name, text] of [["previewSameFileMs", json], ["previewEdited10Ms", menuJson(size, { edit: 0.1 })], ["previewRekeyedMs", menuJson(size, { keyPrefix: "new-" })]]) {
    const s = await sample(async () => {
      admin.log.reset()
      const p = await menus.previewMenuImport(A, { venueId, fileName: "menu.json", text })
      return { ok: p.ok, requests: admin.log.snapshot().requests, uncertain: p.ok ? p.diff.uncertain.length : null }
    }, { warm: 1, n: Math.min(N, 8) })
    flow[name] = s.stats
    flow[`${name}Requests`] = s.last.requests
    if (name === "previewRekeyedMs") flow.rekeyedUncertain = s.last.uncertain
  }

  // Replace the active menu with an edited one: draft from preview, save, activate (retires the old).
  const cycle = []
  for (let k = 0; k < Math.min(N, 5); k++) {
    const p = await menus.previewMenuImport(A, { venueId, fileName: "menu.json", text: menuJson(size, { edit: k % 2 ? 0 : 0.1 }) })
    if (!p.ok) break
    const c0 = performance.now()
    const created = await menus.createMenuDraft(A, { venueId, title: p.document.title, source: p.source, document: p.document, basedOnVersionId: p.baseVersionId })
    const c1 = performance.now()
    if (!created.ok) { flow.cycleError = created.message; break }
    const act = await menus.activateMenuVersion(A, { versionId: created.versionId, expectedRevision: 1 })
    const c2 = performance.now()
    cycle.push({ create: c1 - c0, activate: c2 - c1, ok: act.ok, message: act.ok ? null : act.message, reviewPending: p.document.sections.some((s) => s.items.some((i) => i.review)) })
  }
  flow.replaceCycle = {
    n: cycle.length,
    createDraftMs: cycle.length ? summarise(cycle.map((c) => c.create)) : null,
    activateMs: cycle.length ? summarise(cycle.map((c) => c.activate)) : null,
    activationFailures: cycle.filter((c) => !c.ok).map((c) => c.message),
  }

  // Reads over the new menu.
  const active = query(env.dbUrl, `select id from public.menu_versions where venue_id = '${venueId}' and status = 'active'`)[0][0]
  const cat = await sample(() => labels.getLabellingCatalogue(A, venueId), { warm: 1, n: Math.min(N, 8) })
  flow.getLabellingCatalogueMs = cat.stats
  const ver = await sample(() => menus.getMenuVersion(A, active), { warm: 1, n: Math.min(N, 8) })
  flow.getMenuVersionMs = ver.stats
  // A staff member assigned to this venue reads the same catalogue under the
  // staff RLS policies (per-row helper calls on menu_entries).
  psql(env.dbUrl, ["-c", `begin; set local session_replication_role = replica; update public.profiles set venue_id = '${venueId}' where id = '${targets.staffLight.id}'; commit;`])
  const staff = makeActor(env, staffSession, { ...targets.staffLight, venueId })
  const staffCat = await sample(() => labels.getLabellingCatalogue(staff.actor, venueId), { warm: 1, n: Math.min(N, 8) })
  flow.getLabellingCatalogueStaffMs = staffCat.stats
  flow.staffCatalogueOk = staffCat.last.ok
  out.flows.push(flow)
  log(`flow ${size}: create ${flow.createDraftMs} save ${flow.saveDraftMs} activate ${flow.activateFirstMs} ms; replace cycle activate p50 ${flow.replaceCycle.activateMs?.p50}`)
}

// Activation on the largest real venue (labels attached): draft from active, save, activate.
{
  const venueId = targets.bigVenue.id
  const cycles = []
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now()
    const draft = await menus.createDraftFromActive(A, venueId)
    const t1 = performance.now()
    if (!draft.ok) { cycles.push({ error: draft.message }); break }
    const act = await menus.activateMenuVersion(A, { versionId: draft.versionId, expectedRevision: 1 })
    const t2 = performance.now()
    cycles.push({ draftFromActiveMs: t1 - t0, activateMs: t2 - t1, ok: act.ok, message: act.ok ? null : act.message })
  }
  out.other.push({ name: "largest venue with labels: draft from active + activate", venueMedia: targets.bigVenue.media, cycles })
  log("largest venue activation", JSON.stringify(cycles.map((c) => [Math.round(c.draftFromActiveMs), Math.round(c.activateMs), c.ok])))
}

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, "menu-bench.json"),
  JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), revision: gitHead(), loadAverage: loadavg(), repetitions: N, ...out }, null, 2)
)
log(`wrote ${join(OUT, "menu-bench.json")}`)
