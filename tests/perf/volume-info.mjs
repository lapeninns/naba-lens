// Records what a measured volume looked like: PERF row counts, table and index
// sizes, per-person and per-venue spread, and the database settings in force.
//
//   source /tmp/nabalens-ws/spare6/env.sh
//   node tests/perf/volume-info.mjs --volume expected [--out docs/perf/raw]
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { counts, sizes } from "./generate.mjs"
import { gitHead, query, requireSpare6 } from "./lib.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const { dbUrl } = requireSpare6()
const PERF = "(select id from public.venues where slug like 'perf-venue-%')"

const settings = Object.fromEntries(
  ["shared_buffers", "effective_cache_size", "work_mem", "maintenance_work_mem", "max_parallel_workers_per_gather", "random_page_cost", "max_connections", "server_version"].map((k) => [
    k,
    query(dbUrl, `show ${k}`)[0][0],
  ])
)
const roleTimeouts = query(
  dbUrl,
  `select rolname, rolconfig::text from pg_roles where rolname in ('authenticator','authenticated','anon','service_role')`
).map(([role, config]) => ({ role, config }))

const perVenue = query(
  dbUrl,
  `select v.slug, count(distinct p.id) filter (where p.role='staff'), count(a.id)
   from public.venues v left join public.profiles p on p.venue_id = v.id
   left join public.media_assets a on a.venue_id = v.id and a.uploader_id = p.id
   where v.slug like 'perf-venue-%' group by 1 order by 1`
).map(([slug, staff, media]) => ({ slug, staff: Number(staff), media: Number(media) }))
const perStaff = query(
  dbUrl,
  `select min(c), percentile_cont(0.5) within group (order by c)::int, max(c), count(*) from (
     select uploader_id, count(*) c from public.media_assets where venue_id in ${PERF} group by 1) x`
)[0].map(Number)
const states = query(
  dbUrl,
  `select upload_state, media_type, count(*), count(deleted_at), count(thumbnail_path)
   from public.media_assets where venue_id in ${PERF} group by 1, 2 order by 1, 2`
).map(([state, type, n, deleted, thumbs]) => ({ state, type, n: Number(n), deleted: Number(deleted), thumbs: Number(thumbs) }))
const bytes = query(
  dbUrl,
  `select sum(size_bytes), avg(size_bytes)::bigint from public.media_assets where venue_id in ${PERF}`
)[0].map(Number)
const indexes = query(
  dbUrl,
  `select c.relname, i.relname, pg_relation_size(i.oid)
   from pg_index x join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('media_assets','media_labels','media_label_items','media_archive_receipts','menu_entries')
   order by pg_relation_size(i.oid) desc limit 24`
).map(([table, index, size]) => ({ table, index, bytes: Number(size) }))

mkdirSync(OUT, { recursive: true })
const doc = {
  volume: VOLUME,
  at: new Date().toISOString(),
  revision: gitHead(),
  counts: counts(dbUrl),
  sizes: sizes(dbUrl),
  perVenue,
  perStaff: { min: perStaff[0], median: perStaff[1], max: perStaff[2], people: perStaff[3] },
  states,
  originalBytes: { total: bytes[0], mean: bytes[1] },
  indexes,
  settings,
  roleTimeouts,
}
writeFileSync(join(OUT, "volume.json"), JSON.stringify(doc, null, 2))
console.error(`wrote ${join(OUT, "volume.json")}`)
