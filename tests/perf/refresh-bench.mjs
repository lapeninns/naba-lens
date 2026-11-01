// Cost of the admin library's foreground refresh (app/_media/media-gallery.tsx
// re-reads every loaded page, one cursor page at a time, every 15 s while the tab is
// visible) and of several admins hitting the same slow path at once.
//
//   source /tmp/nabalens-ws/spare6/env.sh
//   node --conditions=react-server --import tsx tests/perf/refresh-bench.mjs --volume expected
import { mkdirSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { makeActor, signIn } from "./actors.mjs"
import { gitHead, requireSpare6, summarise } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const env = requireSpare6()
const library = await import(pathToFileURL(resolve("lib/server/media/library.ts")).href)
const t = pickTargets(env.dbUrl)
const session = await signIn(env, t.admin.email)
const filters = (o = {}) => ({ venueId: null, staffId: null, type: null, itemId: null, variantId: null, category: null, contentType: null, labelState: null, query: null, from: null, to: null, ...o })

const out = { refresh: [], concurrent: [] }

// Walk k pages from the top, as a refresh of a gallery that loaded k pages does.
for (const [label, f] of [["unfiltered feed", {}], ["largest venue", { venueId: t.bigVenue.id }]]) {
  for (const k of [1, 5, 20, 50]) {
    const { actor, log } = makeActor(env, session, t.admin)
    const walls = [], perPage = []
    let requests = 0
    for (let rep = 0; rep < 6; rep++) {
      log.reset()
      let cursor = null
      const t0 = performance.now()
      let pages = 0
      for (; pages < k; pages++) {
        const t1 = performance.now()
        const r = await library.listLibrary(actor, filters(f), cursor)
        if (rep > 0) perPage.push(performance.now() - t1)
        if (!r.ok || !r.nextCursor) break
        cursor = r.nextCursor
      }
      if (rep > 0) { walls.push(performance.now() - t0); requests = log.snapshot().requests }
    }
    out.refresh.push({ label, pages: k, refreshMs: summarise(walls), lastPageMsP50: summarise(perPage).p50, requests })
    console.error(`refresh ${label} k=${k}: p50 ${summarise(walls).p50} ms (${requests} requests)`)
  }
}

// Several admins at once on the first page, a category filter and a labelled filter.
const paths = [
  ["first page", {}],
  ["category = curries", { category: t.category }],
  ["labels = labelled", { labelState: "labelled" }],
]
for (const [label, f] of paths) {
  for (const c of [1, 4, 8]) {
    const actors = Array.from({ length: c }, () => makeActor(env, session, t.admin))
    const walls = [], failures = []
    const reps = label === "first page" ? 10 : 4
    for (let rep = 0; rep < reps; rep++) {
      const results = await Promise.all(actors.map(async ({ actor }) => {
        const t0 = performance.now()
        const r = await library.listLibrary(actor, filters(f), null)
        return { ms: performance.now() - t0, ok: r.ok, message: r.ok ? null : r.message }
      }))
      if (rep > 0) for (const r of results) { walls.push(r.ms); if (!r.ok) failures.push(r.message) }
    }
    out.concurrent.push({ label, concurrent: c, wallMs: summarise(walls), failures: failures.length, of: walls.length })
    console.error(`concurrent ${label} x${c}: p50 ${summarise(walls).p50} p95 ${summarise(walls).p95} ms, failed ${failures.length}/${walls.length}`)
  }
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "refresh-bench.json"), JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), revision: gitHead(), loadAverage: loadavg(), ...out }, null, 2))
console.error(`wrote ${join(OUT, "refresh-bench.json")}`)
