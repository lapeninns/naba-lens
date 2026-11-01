// Write cost of the library migration's trigram and GIN indexes, measured as an
// A/B on one stack in one run: label save, finalise and a 2,000-item menu
// replace with the indexes in place, with them dropped, and after they are
// re-created from the migration's own CREATE INDEX statements. The index list
// and definitions are compared before and after (pg_indexes); the run fails if
// they differ. The script re-creates anything it dropped even when it fails;
// `--restore-only` does just that after a crash.
//
//   export PERF_STACK=spare6; source /tmp/nabalens-ws/spare6/env.sh
//   node --conditions=react-server --import tsx tests/perf/index-cost.mjs \
//     --volume high [--saves 5] [--assets 8] [--finalise 6] [--cycles 4] [--out docs/perf/raw]
//
// Run it last at a volume: it adds a venue, assets and menu versions (PERF rows,
// removed by generate.mjs --purge).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

import { makeActor, signIn } from "./actors.mjs"
import { gitHead, psql, query, requireWorkstreamStack, summarise } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "high")
const SAVES = Number(arg("saves", 5))
const ASSETS = Number(arg("assets", 8))
const FINALISE = Number(arg("finalise", 6))
const CYCLES = Number(arg("cycles", 4))
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const env = requireWorkstreamStack()
const log = (...a) => console.error(...a)

const MIGRATION = "supabase/migrations/20261101100000_library_label_filters.sql"
const migration = readFileSync(resolve(MIGRATION), "utf8")
// Every plain CREATE INDEX of the migration, exactly as written.
const statements = new Map(
  [...migration.matchAll(/^create index (\w+)\s[\s\S]*?;/gm)].map((m) => [m[1], m[0]])
)
const DROPPED = [...statements].filter(([, sql]) => /using gin/i.test(sql)).map(([name]) => name)
const LIBRARY_INDEXES = [...statements.keys()]
const OTHER_INDEXES = ["media_label_items_venue_item_idx"]
if (DROPPED.length !== 8) throw new Error(`Expected 8 trigram/GIN indexes in the migration, found ${DROPPED.length}`)

const indexDefs = () =>
  query(env.dbUrl, `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`).map((r) => r.join(" | "))
const indexNames = () => new Set(query(env.dbUrl, `select indexname from pg_indexes where schemaname = 'public'`).map((r) => r[0]))

function restoreIndexes() {
  const present = indexNames()
  const rebuilt = []
  for (const name of DROPPED) {
    if (present.has(name)) continue
    const t = performance.now()
    psql(env.dbUrl, ["-c", statements.get(name)])
    rebuilt.push({ index: name, ms: Math.round(performance.now() - t) })
    log(`re-created ${name} in ${Math.round(performance.now() - t)} ms`)
  }
  return rebuilt
}

if (argv.includes("--restore-only")) {
  restoreIndexes()
  process.exit(0)
}

// ---------------------------------------------------------------- setup
const t = pickTargets(env.dbUrl)
const root = resolve(".")
const lib = (p) => import(pathToFileURL(join(root, p)).href)
const menus = await lib("lib/server/menus/index.ts")
const labels = await lib("lib/server/labels/index.ts")
const reserve = await lib("lib/server/media/reserve.ts")
const finalise = await lib("lib/server/media/finalise.ts")

const admin = makeActor(env, await signIn(env, t.admin.email), t.admin)
const staffSession = await signIn(env, t.staffLight.email)
const [staffVenueId] = query(env.dbUrl, `select venue_id from public.profiles where id = '${t.staffLight.id}'`)[0]
const staff = makeActor(env, staffSession, { ...t.staffLight, venueId: staffVenueId })
const service = createClient(env.apiUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = service.storage.from("media")

const labelVenue = t.bigVenue.id
const [activeVersion] = query(env.dbUrl, `select id from public.menu_versions where venue_id = '${labelVenue}' and status = 'active'`)[0]
const itemIds = query(env.dbUrl, `select distinct item_id from public.menu_entries where version_id = '${activeVersion}' limit 12`).map((r) => r[0])
const assetIds = query(
  env.dbUrl,
  `select id from public.media_assets where venue_id = '${labelVenue}' and upload_state = 'ready' and deleted_at is null
   order by created_at desc, id desc offset 500 limit ${ASSETS}`
).map((r) => r[0])
if (assetIds.length < ASSETS || itemIds.length < 4) throw new Error("Not enough assets or menu items to label; generate the volume first")

psql(env.dbUrl, ["-c", `insert into public.venues (name, slug) values ('PERF Index Cost', 'perf-venue-idxcost') on conflict do nothing`])
const [menuVenueId] = query(env.dbUrl, `select id from public.venues where slug = 'perf-venue-idxcost'`)[0]

const STYLES = ["Classic", "Smoked", "Spiced", "Crispy", "House"]
const PROTEINS = ["Chicken", "Lamb", "Prawn", "Paneer", "Beef", "Cod", "Duck", "Mushroom", "Aubergine", "Salmon"]
const DISHES = ["Tikka", "Karahi", "Masala", "Biryani", "Skewers", "Pie", "Curry", "Salad", "Burger", "Tacos"]
const menuJson = (size, rename) => {
  const sections = Array.from({ length: 80 }, (_, s) => ({ key: `sec-${s + 1}`, name: `Section ${s + 1}`, kind: "food", items: [] }))
  for (let i = 0; i < size; i++) {
    const base = `${STYLES[i % 5]} ${PROTEINS[Math.floor(i / 5) % 10]} ${DISHES[Math.floor(i / 50) % 10]} ${i}`
    const sec = sections[(i * 7) % 80]
    sec.items.push({
      key: `${sec.key}--item-${i}`,
      name: rename && i % 10 === 1 ? `${base} Special ${rename}` : base,
      description: i % 2 === 0 ? "Made fresh daily with seasonal produce, house sauce and a side." : null,
      aliases: i % 10 < 3 ? [`alias ${i}`] : [],
      variants: i % 4 === 0 ? ["Regular", "Large"] : [],
      meta: {},
    })
  }
  return JSON.stringify({ format: "nabalens-menu@1", title: "PERF index cost menu", source: { label: "perf.json", revision: "perf", capturedAt: "2026-10-01T00:00:00Z", notes: "synthetic" }, sections })
}

const jpeg = await sharp(Buffer.alloc(1600 * 1200 * 3).map((_, i) => (i * 7) % 251), { raw: { width: 1600, height: 1200, channels: 3 } })
  .jpeg({ quality: 82 })
  .toBuffer()

const createdAssets = []
const ms = async (fn) => {
  const t0 = performance.now()
  const r = await fn()
  return [performance.now() - t0, r]
}

// ---------------------------------------------------------------- one phase
async function phase(name) {
  log(`--- phase ${name}`)
  const out = { phase: name, load: loadavg(), saves: [], saveFailures: [], finalise: [], finaliseFailures: [], menuCreate: [], menuActivate: [], menuFailures: [] }

  // Label save: the app's write path (save_media_labels as admin), real writes
  // every time (the note and the item set change on each save).
  for (let round = 0; round < SAVES; round++) {
    for (const [a, assetId] of assetIds.entries()) {
      const [rev] = query(env.dbUrl, `select coalesce((select revision from public.media_labels where asset_id = '${assetId}'), 0)`)[0]
      const pick = [itemIds[(a + round) % itemIds.length], itemIds[(a + round + 3) % itemIds.length]]
      const [dt, res] = await ms(() =>
        labels.saveAssetLabels(admin.actor, {
          assetId,
          expectedRevision: Number(rev),
          catalogueVersionId: activeVersion,
          contentTypes: ["dish"],
          note: `perf ${name} note ${round} for tikka curry plate ${a}`,
          items: pick.map((itemId) => ({ itemId, variantId: null })),
          missingItem: null,
        })
      )
      if (res.ok) out.saves.push(dt)
      else out.saveFailures.push(res.code)
    }
  }

  // Finalise: reserve, upload, validate, derivatives, mark ready (staff).
  for (let i = 0; i < FINALISE; i++) {
    const key = `perfidx${name}${i}${Math.random().toString(36).slice(2, 10)}`
    const r = await reserve.reserveAsset(staff.actor, { idempotencyKey: key, filename: `perf-idx-${name}-${i}.jpg`, sizeBytes: jpeg.length, contentType: "image/jpeg", mediaType: "image", preferResumable: false })
    if (!r.ok) { out.finaliseFailures.push(r.message); continue }
    createdAssets.push(r.assetId)
    const up = await bucket.upload(r.objectKey, jpeg, { contentType: "image/jpeg", upsert: true })
    if (up.error) { out.finaliseFailures.push(`upload ${up.error.message}`); continue }
    const [dt, f] = await ms(() => finalise.finaliseAsset(staff.actor, { assetId: r.assetId, idempotencyKey: key }))
    if (f.ok && f.state === "ready") out.finalise.push(dt)
    else out.finaliseFailures.push(f.ok ? f.error : f.message)
  }

  // Menu replace at 2,000 items: draft from a preview against the active menu,
  // then activate (which retires the old version).
  for (let k = 0; k < CYCLES; k++) {
    const text = menuJson(2000, `${name}${k}`)
    const p = await menus.previewMenuImport(admin.actor, { venueId: menuVenueId, fileName: "menu.json", text })
    if (!p.ok) { out.menuFailures.push(p.message); continue }
    const [d1, created] = await ms(() => menus.createMenuDraft(admin.actor, { venueId: menuVenueId, title: p.document.title, source: p.source, document: p.document, basedOnVersionId: p.baseVersionId ?? null }))
    if (!created.ok) { out.menuFailures.push(created.message); continue }
    const [d2, act] = await ms(() => menus.activateMenuVersion(admin.actor, { versionId: created.versionId, expectedRevision: 1 }))
    if (!act.ok) { out.menuFailures.push(act.message); continue }
    out.menuCreate.push(d1)
    out.menuActivate.push(d2)
  }
  const sum = (v) => (v.length ? summarise(v) : null)
  const res = { phase: name, load: out.load, labelSave: sum(out.saves), finalise: sum(out.finalise), menuCreateDraft2000: sum(out.menuCreate), menuActivate2000: sum(out.menuActivate), failures: { labelSave: out.saveFailures, finalise: out.finaliseFailures, menu: out.menuFailures } }
  log(JSON.stringify(res))
  return res
}

// ---------------------------------------------------------------- run
const before = indexDefs()
const sizes = (names) =>
  Object.fromEntries(query(env.dbUrl, `select indexrelname, pg_relation_size(indexrelid) from pg_stat_user_indexes where indexrelname in (${names.map((n) => `'${n}'`).join(",")}) order by 1`).map(([n, b]) => [n, Number(b)]))
const indexSizes = sizes([...LIBRARY_INDEXES, ...OTHER_INDEXES])
const phases = []
let rebuilt = []
let restoredOk = false
try {
  phases.push(await phase("with"))
  for (const name of DROPPED) psql(env.dbUrl, ["-c", `drop index public.${name}`])
  log(`dropped ${DROPPED.length} indexes`)
  phases.push(await phase("without"))
} finally {
  rebuilt = restoreIndexes()
}
const after = indexDefs()
restoredOk = JSON.stringify(before) === JSON.stringify(after)
if (!restoredOk) {
  log("INDEX DEFINITIONS DIFFER AFTER RESTORE")
  log(JSON.stringify({ missing: before.filter((x) => !after.includes(x)), extra: after.filter((x) => !before.includes(x)) }, null, 2))
}
phases.push(await phase("restored"))

// Remove the files uploaded for the finalise runs; the rows go with generate.mjs --purge.
const paths = createdAssets.length
  ? query(env.dbUrl, `select unnest(array[original_path, preview_path, thumbnail_path]) from public.media_assets where id in (${createdAssets.map((i) => `'${i}'`).join(",")})`).map((r) => r[0]).filter((p) => p && p !== "")
  : []
if (paths.length) await bucket.remove(paths)

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, "index-cost.json"),
  JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), revision: gitHead(), droppedIndexes: DROPPED, indexSizesBytes: indexSizes, rebuild: rebuilt, indexDefinitionsRestored: restoredOk, phases, params: { SAVES, ASSETS, FINALISE, CYCLES } }, null, 2)
)
log(`wrote ${join(OUT, "index-cost.json")}; index definitions ${restoredOk ? "identical" : "DIFFER"} before and after`)
if (!restoredOk) process.exit(1)
