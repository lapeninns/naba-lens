// getLabellingCatalogue, getMenuVersion and import preview on a venue with a
// 2,000-item active menu AND many archived items: 2,000 items of an earlier
// menu (no longer on it) plus 1,000 of the 2,000 current ones, so the archived
// read spans several PostgREST pages. Built through the app's own server code
// as a PERF admin; the venue slug starts with perf-venue- so generate.mjs
// purges it. Run from a worktree root:
//
//   source /tmp/nabalens-ws/<stack>/env.sh; export PERF_STACK=<stack>
//   node --conditions=react-server --import tsx tests/perf/menus-archived-bench.mjs \
//     --volume high [--n 12] [--out docs/perf/raw]
import { mkdirSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { makeActor, signIn } from "./actors.mjs"
import { gitHead, psql, query, requireWorkstreamStack, summarise } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const N = Number(arg("n", 12))
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const env = requireWorkstreamStack()
const root = resolve(".")
const lib = (p) => import(pathToFileURL(join(root, p)).href)
const menus = await lib("lib/server/menus/index.ts")
const labels = await lib("lib/server/labels/index.ts")

const targets = pickTargets(env.dbUrl)
const admin = makeActor(env, await signIn(env, targets.admin.email), targets.admin)
const A = admin.actor
const staffSession = await signIn(env, targets.staffLight.email)
const log = (...a) => console.error(...a)

const SIZE = 2000
const ARCHIVED_CURRENT = 1000
const itemJson = (prefix, size) =>
  JSON.stringify({
    format: "nabalens-menu@1",
    title: `PERF archived-heavy menu ${prefix}`,
    source: { label: "perf.json", revision: "perf", capturedAt: "2026-10-01T00:00:00Z", notes: "synthetic" },
    sections: Array.from({ length: 80 }, (_, s) => ({
      key: `sec-${s}`,
      name: `Section ${s}`,
      kind: "food",
      items: Array.from({ length: size / 80 }, (_, k) => ({
        key: `${prefix}-${s}-${k}`,
        name: `${prefix} dish ${s}-${k}`,
        description: "Made fresh daily with seasonal produce, house sauce and a side.",
        aliases: [],
        variants: k % 4 === 0 ? ["Regular", "Large"] : [],
        meta: { price: "9.50" },
      })),
    })),
  })

async function publish(venueId, text, basedOn) {
  const p = await menus.previewMenuImport(A, { venueId, fileName: "menu.json", text })
  if (!p.ok) throw new Error(`preview: ${p.message}`)
  // Every item is a new dish: no matches, nothing to review.
  for (const s of p.document.sections)
    for (const i of s.items) {
      i.itemId = null
      i.review = null
      i.variants.forEach((v) => (v.variantId = null))
    }
  const created = await menus.createMenuDraft(A, { venueId, title: p.document.title, source: p.source, document: p.document, basedOnVersionId: basedOn ? p.baseVersionId : null })
  if (!created.ok) throw new Error(`create: ${created.message}`)
  const act = await menus.activateMenuVersion(A, { versionId: created.versionId, expectedRevision: 1 })
  if (!act.ok) throw new Error(`activate: ${act.message}`)
  return created.versionId
}

const slug = "perf-venue-menutest-archived"
psql(env.dbUrl, ["-c", `insert into public.venues (name, slug) values ('PERF Menu Test archived', '${slug}') on conflict do nothing`])
const [[venueId]] = query(env.dbUrl, `select id from public.venues where slug = '${slug}'`)
const existing = query(env.dbUrl, `select count(*) from public.menu_versions where venue_id = '${venueId}'`)[0][0]
if (Number(existing) === 0) {
  await publish(venueId, itemJson("old", SIZE), false)
  await publish(venueId, itemJson("cur", SIZE), true)
  // Archive everything that is no longer on the menu, and half of what is.
  psql(env.dbUrl, ["-c", `begin; set local session_replication_role = replica;
    update public.menu_items set archived_at = now() where venue_id = '${venueId}' and id not in
      (select e.item_id from public.menu_entries e join public.menu_versions v on v.id = e.version_id where v.venue_id = '${venueId}' and v.status = 'active');
    update public.menu_items set archived_at = now() where id in
      (select e.item_id from public.menu_entries e join public.menu_versions v on v.id = e.version_id
        where v.venue_id = '${venueId}' and v.status = 'active' order by e.id limit ${ARCHIVED_CURRENT});
    commit;`])
}
const counts = query(env.dbUrl, `select count(*) filter (where archived_at is not null), count(*) from public.menu_items where venue_id = '${venueId}'`)[0]
const entries = query(env.dbUrl, `select count(*) from public.menu_entries e join public.menu_versions v on v.id = e.version_id where v.venue_id = '${venueId}' and v.status = 'active'`)[0][0]
log(`venue ${venueId}: ${counts[0]} archived of ${counts[1]} items, ${entries} active entries`)

psql(env.dbUrl, ["-c", `begin; set local session_replication_role = replica; update public.profiles set venue_id = '${venueId}' where id = '${targets.staffLight.id}'; commit;`])
const staff = makeActor(env, staffSession, { ...targets.staffLight, venueId })

async function sample(fn, who) {
  const v = []
  let last
  let requests = 0
  for (let i = 0; i < 2 + N; i++) {
    who.log.reset()
    const t = performance.now()
    last = await fn()
    const ms = performance.now() - t
    requests = who.log.snapshot().requests
    if (i >= 2) v.push(ms)
  }
  return { stats: summarise(v), requests, ok: last.ok, items: last.ok && last.catalogue?.sections ? last.catalogue.sections.reduce((n, s) => n + s.items.length, 0) : undefined }
}

const result = {
  venueId,
  archivedItems: Number(counts[0]),
  totalItems: Number(counts[1]),
  activeEntries: Number(entries),
  catalogueAdmin: await sample(() => labels.getLabellingCatalogue(A, venueId), admin),
  catalogueStaff: await sample(() => labels.getLabellingCatalogue(staff.actor, venueId), staff),
  getMenuVersion: await sample(
    async () => menus.getMenuVersion(A, query(env.dbUrl, `select id from public.menu_versions where venue_id = '${venueId}' and status = 'active'`)[0][0]),
    admin
  ),
  previewSameFile: await sample(() => menus.previewMenuImport(A, { venueId, fileName: "menu.json", text: itemJson("cur", SIZE) }), admin),
}
log(JSON.stringify(result, null, 1))
mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, "menus-archived-bench.json"),
  JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), revision: gitHead(), loadAverage: loadavg(), repetitions: N, ...result }, null, 2)
)
