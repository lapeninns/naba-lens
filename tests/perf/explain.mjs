// EXPLAIN (ANALYZE, BUFFERS) of the statements PostgREST sends for the catalogue
// and media paths, run as the `authenticated` role with the person's JWT claims so
// RLS applies exactly as through the API. Shapes follow the SQL captured from
// pg_stat_statements on the same stack. Plans are rolled back (read only).
//
//   source /tmp/nabalens-ws/<stack>/env.sh
//   node tests/perf/explain.mjs --volume expected [--out docs/perf/raw]
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { psql, requireWorkstreamStack } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const OUT = join(resolve(arg("out", "docs/perf/raw"), VOLUME), "explain")
const TIMEOUT = arg("timeout", "120s")
const { dbUrl } = requireWorkstreamStack()
const t = pickTargets(dbUrl)
const sq = (s) => s.replace(/'/g, "''")

const COLS =
  "a.id, a.uploader_id, a.media_type, a.upload_state, a.thumbnail_path, a.preview_path, a.validated_mime_type, a.original_filename, a.created_at, a.width, a.height, a.duration_seconds, a.size_bytes, row_to_json(v.*)::jsonb as venue, row_to_json(u.*)::jsonb as uploader"
const EMBED = `left join lateral (select venues_1.name from public.venues venues_1 where venues_1.id = a.venue_id limit 1) v on true
left join lateral (select profiles_1.display_name from public.profiles profiles_1 where profiles_1.id = a.uploader_id limit 1) u on true`

const table = (preds, cursor) =>
  `select ${COLS} from public.media_assets a ${EMBED}
 where ${cursor ? `(a.created_at < '${cursor.createdAt}' or (a.created_at = '${cursor.createdAt}' and a.id < '${cursor.id}')) and ` : ""}a.deleted_at is null${preds ? ` and ${preds}` : ""}
 order by a.created_at desc, a.id desc limit 25`

const rpc = (params, preds, cursor) => {
  const names = Object.keys(params)
  const record = names.map((n) => `"${n}" ${typeof params[n] === "string" ? (n === "p_item" || n === "p_variant" ? "uuid" : "text") : "text"}`).join(", ")
  const args = names.map((n) => `"${n}" := pgrst_body."${n}"`).join(", ")
  return `with pgrst_source as (select pgrst_call.* from (select '${sq(JSON.stringify(params))}'::json as json_data) pgrst_payload,
  lateral (select ${names.map((n) => `"${n}"`).join(", ")} from json_to_record(pgrst_payload.json_data) as _(${record}) limit 1) pgrst_body,
  lateral public.library_assets(${args}) pgrst_call)
select ${COLS} from pgrst_source a ${EMBED}
 where ${cursor ? `(a.created_at < '${cursor.createdAt}' or (a.created_at = '${cursor.createdAt}' and a.id < '${cursor.id}')) and ` : ""}a.deleted_at is null and a.upload_state = 'ready'${preds ? ` and ${preds}` : ""}
 order by a.created_at desc, a.id desc limit 25`
}

const asAdmin = t.admin.id
const heavy = t.staffHeavy
const ids24 = `(select array_agg(id) from (select id from public.media_assets where venue_id = '${t.bigVenue.id}' and upload_state = 'ready' and deleted_at is null order by created_at desc, id desc limit 24) x)`
const ready = "a.upload_state = 'ready'"

/** [name, role person id, sql] */
const S = [
  ["admin-feed-first", asAdmin, table(ready)],
  ...t.cursors.feed.map((c) => [`admin-feed-cursor-${c.frac * 100}pct`, asAdmin, table(ready, c)]),
  ["admin-venue-first", asAdmin, table(`${ready} and a.venue_id = '${t.bigVenue.id}'`)],
  ["admin-venue-cursor-90pct", asAdmin, table(`${ready} and a.venue_id = '${t.bigVenue.id}'`, t.cursors.bigVenue[1])],
  ["admin-staff-first", asAdmin, table(`${ready} and a.uploader_id = '${heavy.id}'`)],
  ["admin-staff-cursor-90pct", asAdmin, table(`${ready} and a.uploader_id = '${heavy.id}'`, t.cursors.heavyStaffAdmin[1])],
  ["admin-type-video", asAdmin, table(`${ready} and a.media_type = 'video'`)],
  ["admin-category-curries", asAdmin, rpc({ p_category: t.category })],
  ["admin-category-curries-cursor-50pct", asAdmin, rpc({ p_category: t.category }, null, t.cursors.category[0])],
  ["admin-labelled", asAdmin, rpc({ p_label_state: "labelled" })],
  ["admin-unlabelled", asAdmin, rpc({ p_label_state: "unlabelled" })],
  ["admin-content-dish", asAdmin, rpc({ p_content_type: "dish" })],
  ["admin-item-popular", asAdmin, rpc({ p_item: t.popularItem.id })],
  ["admin-item-rare", asAdmin, rpc({ p_item: t.rareItem.id })],
  ["admin-search-tikka", asAdmin, rpc({ p_query: "tikka" })],
  ["admin-search-nomatch", asAdmin, rpc({ p_query: "zzzqq" })],
  ["staff-heaviest-library-assets-category", heavy.id, rpc({ p_category: t.category })],
  ["staff-heaviest-library-assets-venue-category", heavy.id, rpc({ p_category: t.category }, `a.venue_id = '${heavy.venueId}'`)],
  ["staff-lightest-library-assets-content-dish", t.staffLight.id, rpc({ p_content_type: "dish" })],
  ["staff-median-library-assets-content-dish", t.staffMedian.id, rpc({ p_content_type: "dish" })],
  ["staff-lightest-library-assets-category", t.staffLight.id, rpc({ p_category: t.category })],
  ["staff-lightest-portfolio-first", t.staffLight.id, table(`a.uploader_id = '${t.staffLight.id}'`)],
  ["staff-heaviest-portfolio-first", heavy.id, table(`a.uploader_id = '${heavy.id}'`)],
  ["staff-heaviest-portfolio-cursor-90pct", heavy.id, table(`a.uploader_id = '${heavy.id}'`, t.cursors.staffHeavyOwn[1])],
  [
    "label-summaries-media-labels-24",
    asAdmin,
    `select asset_id, content_types, note, revision, has_labels, updated_at from public.media_labels where asset_id = any(${ids24}::uuid[])`,
  ],
  ["label-summaries-details-24", asAdmin, `select * from public.media_label_details(${ids24})`],
  [
    "label-summaries-details-24-staff",
    heavy.id,
    `select * from public.media_label_details((select array_agg(id) from (select id from public.media_assets where uploader_id = '${heavy.id}' and upload_state = 'ready' and deleted_at is null order by created_at desc, id desc limit 24) x))`,
  ],
  [
    "label-summaries-suggestions-24",
    asAdmin,
    `select asset_id, suggested_name, created_by, created_at from public.menu_item_suggestions where asset_id = any(${ids24}::uuid[]) and status = 'open'`,
  ],
  [
    "menu-version-label-items-page1",
    asAdmin,
    `select item_id from public.media_label_items where venue_id = '${t.bigVenue.id}' order by id limit 1000 offset 0`,
  ],
  [
    "menu-version-label-items-page30",
    asAdmin,
    `select item_id from public.media_label_items where venue_id = '${t.bigVenue.id}' order by id limit 1000 offset 30000`,
  ],
  [
    "menu-version-label-items-count",
    asAdmin,
    `select count(*) from public.media_label_items where venue_id = '${t.bigVenue.id}'`,
  ],
  [
    "filter-options-items-with-labels",
    asAdmin,
    `select mi.id, (select json_agg(l) from (select item_name, section_name, added_at from public.media_label_items li where li.item_id = mi.id order by added_at desc limit 1) l) labels
     from public.menu_items mi where mi.venue_id = '${t.bigVenue.id}'
       and exists (select 1 from public.media_label_items li where li.item_id = mi.id) order by mi.id limit 1000`,
  ],
  [
    "catalogue-entries-staff",
    heavy.id,
    `select e.section_id, e.item_id, e.name, e.description, e.aliases, e.position,
            (select row_to_json(i) from (select archived_at from public.menu_items i where i.id = e.item_id) i) item,
            (select json_agg(ev) from (select variant_id, name, position from public.menu_entry_variants ev where ev.entry_id = e.id) ev) variants
     from public.menu_entries e where e.version_id = '${t.activeVersion.id}' order by e.section_id, e.position, e.item_id limit 1000`,
  ],
  [
    "catalogue-entries-admin",
    asAdmin,
    `select e.section_id, e.item_id, e.name, e.description, e.aliases, e.position,
            (select row_to_json(i) from (select archived_at from public.menu_items i where i.id = e.item_id) i) item,
            (select json_agg(ev) from (select variant_id, name, position from public.menu_entry_variants ev where ev.entry_id = e.id) ev) variants
     from public.menu_entries e where e.version_id = '${t.activeVersion.id}' order by e.section_id, e.position, e.item_id limit 1000`,
  ],
]

mkdirSync(OUT, { recursive: true })
const summary = []
for (const [name, personId, sql] of S) {
  const script = `begin;
set local role authenticated;
set local statement_timeout = '${TIMEOUT}';
select set_config('request.jwt.claims', '{"sub":"${personId}","role":"authenticated","aud":"authenticated"}', true) \\gset
select set_config('request.jwt.claim.sub', '${personId}', true) \\gset
explain (analyze, buffers, settings, verbose false) ${sql};
rollback;
`
  let text
  let error = null
  try {
    text = psql(dbUrl, ["-At"], { input: script })
  } catch (e) {
    error = String(e.message)
    text = error
  }
  writeFileSync(join(OUT, `${name}.txt`), `-- ${name}\n-- role authenticated, sub ${personId === asAdmin ? "(admin)" : "(staff)"}\n-- statement:\n${sql}\n\n${text}\n`)
  const num = (re) => Number(re.exec(text ?? "")?.[1] ?? NaN)
  const seq = [...(text ?? "").matchAll(/(?:Parallel )?Seq Scan on (\w+)/g)].map((m) => m[1])
  const idx = [...(text ?? "").matchAll(/(?:Index Only Scan|Index Scan|Bitmap Heap Scan) (?:using \w+ )?on (\w+)/g)].map((m) => m[1])
  const rootBuf = /Buffers: ([^\n]*)/.exec(text ?? "")?.[1] ?? null
  const entry = {
    name,
    executionMs: num(/Execution Time: ([\d.]+) ms/),
    planningMs: num(/Planning Time: ([\d.]+) ms/),
    seqScans: [...new Set(seq)],
    indexScans: [...new Set(idx)],
    sort: /Sort Method: ([^\n]*)/.exec(text ?? "")?.[1] ?? null,
    rootBuffers: rootBuf,
    error,
  }
  summary.push(entry)
  console.error(
    `${name.padEnd(48)} exec ${String(entry.executionMs).padStart(9)} ms  plan ${entry.planningMs}  seq: ${entry.seqScans.join(",") || "-"}${error ? "  ERROR " + error.slice(0, 120) : ""}`
  )
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2))
