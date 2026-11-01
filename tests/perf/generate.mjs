// Synthetic large-library generator (WS3 baseline). Writes to the local workstream
// stack (PERF_STACK, default spare6) only, as postgres, and replaces any earlier
// PERF data so the three volumes can be measured one after another on the same
// database.
//
//   source /tmp/nabalens-ws/<stack>/env.sh
//   node tests/perf/generate.mjs --volume current|expected|high [--seed 0.42]
//   node tests/perf/generate.mjs --purge
//
// Volumes come from docs/archive-capacity.md (Expected and High scenarios at 24
// months: 75,050 and 221,150 receipts) and the scale anchors in
// docs/INFRASTRUCTURE.md (at most 100 staff across 10 venues).
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { psql, query, requireWorkstreamStack } from "./lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))

export const VOLUMES = {
  current: {
    venues: 2,
    staff: 6,
    admins: 2,
    media: 50,
    months: 3,
    video_share: 0.2,
    retired: 1,
  },
  expected: {
    venues: 8,
    staff: 60,
    admins: 2,
    media: 75050,
    months: 24,
    video_share: 0.1,
    retired: 11,
  },
  high: {
    venues: 10,
    staff: 100,
    admins: 2,
    media: 221150,
    months: 24,
    video_share: 0.15,
    retired: 11,
  },
  // 500,000 media: the volume Library generated for its own measurements.
  xl500k: {
    venues: 10,
    staff: 100,
    admins: 2,
    media: 500000,
    months: 24,
    video_share: 0.15,
    retired: 11,
  },
}

const TABLES = [
  "media_assets",
  "media_archive_receipts",
  "media_labels",
  "media_label_items",
  "media_label_events",
  "menu_item_suggestions",
  "menu_versions",
  "menu_sections",
  "menu_items",
  "menu_variants",
  "menu_entries",
  "menu_entry_variants",
  "menu_events",
  "profiles",
  "venues",
]

const PERF_VENUES = "(select id from public.venues where slug like 'perf-venue-%')"
const PERF_FILTER = {
  media_archive_receipts: `asset_id in (select id from public.media_assets where venue_id in ${PERF_VENUES})`,
  menu_entry_variants: `entry_id in (select id from public.menu_entries where venue_id in ${PERF_VENUES})`,
  profiles: "id in (select id from auth.users where email like '%@perf.nabalens.test')",
  venues: "slug like 'perf-venue-%'",
}

/** Row counts of the PERF rows only (the fixture and seed worlds are excluded). */
export function counts(dbUrl) {
  const out = {}
  for (const t of TABLES) {
    const where = PERF_FILTER[t] ?? `venue_id in ${PERF_VENUES}`
    out[t] = Number(query(dbUrl, `select count(*) from public.${t} where ${where}`)[0][0])
  }
  return out
}

export function sizes(dbUrl) {
  return query(
    dbUrl,
    `select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)), pg_total_relation_size(c.oid)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(array[${TABLES.map((t) => `'${t}'`).join(",")}])
     order by pg_total_relation_size(c.oid) desc`
  ).map(([table, pretty, bytes]) => ({ table, pretty, bytes: Number(bytes) }))
}

/**
 * Deletes the PERF rows, then rewrites the tables: without this the next volume
 * would load into files still sized for the previous one, and every seq scan
 * would read that dead space.
 */
export function purge(dbUrl) {
  psql(dbUrl, ["-f", join(here, "purge.sql")])
  psql(dbUrl, ["-c", `vacuum full ${TABLES.map((t) => "public." + t).join(", ")}`])
}

export function generate(dbUrl, name, seed = 0.42) {
  const v = VOLUMES[name]
  if (!v) throw new Error(`Unknown volume ${name}`)
  purge(dbUrl)
  // psql has no variable expansion inside quoted strings, so pass -v and let the
  // script use :name in plain SQL positions.
  const vars = Object.entries({ ...v, seed }).flatMap(([k, val]) => ["-v", `${k}=${val}`])
  const started = Date.now()
  psql(dbUrl, [...vars, "-f", join(here, "generate.sql")])
  const loadMs = Date.now() - started
  // Autovacuum would do this on a live database; the planner needs fresh
  // statistics and the visibility map for index-only scans.
  const t2 = Date.now()
  psql(dbUrl, [
    "-c",
    `vacuum (analyze) ${TABLES.map((t) => "public." + t).join(", ")}`,
  ])
  return { volume: name, params: v, seed, loadMs, vacuumMs: Date.now() - t2 }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const arg = (k) => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const { dbUrl } = requireWorkstreamStack()
  if (argv.includes("--purge")) {
    purge(dbUrl)
    console.log(JSON.stringify({ purged: true, counts: counts(dbUrl) }, null, 2))
  } else {
    const volume = arg("volume")
    if (!volume) {
      console.error("usage: generate.mjs --volume current|expected|high [--seed 0.42] | --purge")
      process.exit(2)
    }
    const result = generate(dbUrl, volume, Number(arg("seed") ?? 0.42))
    console.log(
      JSON.stringify({ ...result, counts: counts(dbUrl), sizes: sizes(dbUrl) }, null, 2)
    )
  }
}

