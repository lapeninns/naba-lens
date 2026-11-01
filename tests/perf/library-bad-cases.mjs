// Worst cases of public.library_page and the staff path, timed inside the
// database (no HTTP): each scenario runs in one transaction as the
// `authenticated` role with the person's JWT claims, so RLS applies as through
// the API, and is rolled back, so the scenarios that reshape the data (all
// labelled assets oldest, all unlabelled assets oldest) leave nothing behind.
//
//   export PERF_STACK=spare7; source /tmp/nabalens-ws/spare7/env.sh
//   node tests/perf/library-bad-cases.mjs --volume high [--out docs/perf/raw] [--n 20]
//
// Times are the call plus the sort and limit PostgREST adds; the app path adds
// the HTTP round trips measured by db-bench.mjs.
import { mkdirSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { query, requireWorkstreamStack } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "high")
const N = Number(arg("n", 20))
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const { dbUrl } = requireWorkstreamStack()
const t = pickTargets(dbUrl)
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const claims = (id) => `{"sub":"${id}","role":"authenticated","aud":"authenticated"}`

const page = (args) =>
  `select id from public.library_page(${Object.entries(args)
    .map(([k, v]) => `${k} := ${typeof v === "number" ? v : q(v)}`)
    .join(", ")}${Object.keys(args).length ? ", " : ""}p_limit := 25) order by created_at desc, id desc limit 25`

const reference = (args, extra = "") =>
  `select id from public.library_assets(${Object.entries(args)
    .map(([k, v]) => `${k} := ${q(v)}`)
    .join(", ")}) where deleted_at is null and upload_state = 'ready'${extra} order by created_at desc, id desc limit 25`

/** Cursor at `frac` of the rows a predicate matches, as the app encodes it. */
function cursorAt(where, frac) {
  const [n] = query(dbUrl, `select count(*) from public.media_assets a where a.upload_state = 'ready' and a.deleted_at is null and ${where}`)[0]
  const off = Math.max(0, Math.floor(Number(n) * frac) - 1)
  const [createdAt, id] = query(
    dbUrl,
    `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'), id from public.media_assets a
     where a.upload_state = 'ready' and a.deleted_at is null and ${where} order by created_at desc, id desc offset ${off} limit 1`
  )[0]
  return { p_after_created_at: createdAt, p_after_id: id, matches: Number(n) }
}

const inCategory = `exists (select 1 from public.media_label_items li where li.asset_id = a.id and li.section_slug = ${q(t.category)})`
const isLabelled = `exists (select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels)`
const catCursor = cursorAt(inCategory, 0.9)
const labCursor = cursorAt(isLabelled, 0.9)
const tikkaCursor = cursorAt(
  `exists (select 1 from public.media_label_items li where li.asset_id = a.id and li.item_name ilike '%tikka%')`,
  0.9
)

// Reshape: only the oldest K labelled assets keep has_labels (a dense filter
// whose matches are all at the far end of the feed), or every asset but the
// oldest K gets a label (an unlabelled filter that is sparse and old).
const OLDEST = 5000
const sparseLabelled = `
update public.media_labels set has_labels = false where has_labels and asset_id not in (
  select l.asset_id from public.media_labels l join public.media_assets a on a.id = l.asset_id
  where l.has_labels order by a.created_at asc, a.id asc limit ${OLDEST});
analyze public.media_labels;`
const fewLabelled = `
update public.media_labels set has_labels = false where has_labels and asset_id not in (
  select asset_id from public.media_labels where has_labels order by random() limit 200);
analyze public.media_labels;`
const sparseUnlabelled = `
set local session_replication_role = replica;
update public.media_labels l set has_labels = true where not has_labels;
insert into public.media_labels (asset_id, venue_id, has_labels)
select a.id, a.venue_id, true from public.media_assets a
where not exists (select 1 from public.media_labels l where l.asset_id = a.id)
  and a.id not in (select id from public.media_assets order by created_at asc, id asc limit ${OLDEST});
set local session_replication_role = origin;
analyze public.media_labels;`

const admin = t.admin.id
const staff = t.staffHeavy
const S = [
  // [name, person, setup, sql, note]
  ["admin category (natural)", admin, "", page({ p_category: t.category })],
  ["admin category, cursor 90% of matches", admin, "", page({ p_category: t.category, p_after_created_at: catCursor.p_after_created_at, p_after_id: catCursor.p_after_id })],
  ["admin labelled (natural, 56% labelled)", admin, "", page({ p_label_state: "labelled" })],
  ["admin labelled, cursor 90% of matches", admin, "", page({ p_label_state: "labelled", p_after_created_at: labCursor.p_after_created_at, p_after_id: labCursor.p_after_id })],
  ["admin labelled, only 200 assets labelled", admin, fewLabelled, page({ p_label_state: "labelled" })],
  [`admin labelled, only the oldest ${OLDEST} labelled`, admin, sparseLabelled, page({ p_label_state: "labelled" })],
  ["admin unlabelled (natural)", admin, "", page({ p_label_state: "unlabelled" })],
  [`admin unlabelled, only the oldest ${OLDEST} unlabelled`, admin, sparseUnlabelled, page({ p_label_state: "unlabelled" })],
  ["admin search 'a' (1 char, matches nearly all)", admin, "", page({ p_query: "a" })],
  ["admin search 'q' (1 char)", admin, "", page({ p_query: "q" })],
  ["admin search 'ch' (2 chars, common)", admin, "", page({ p_query: "ch" })],
  ["admin search 'qz' (2 chars, no match)", admin, "", page({ p_query: "qz" })],
  ["admin search 'zzzqq' (no match)", admin, "", page({ p_query: "zzzqq" })],
  ["admin search 'tikka', cursor 90% of matches", admin, "", page({ p_query: "tikka", p_after_created_at: tikkaCursor.p_after_created_at, p_after_id: tikkaCursor.p_after_id })],
  ["admin search 'tikka' in the largest venue", admin, "", page({ p_query: "tikka", p_venue: t.bigVenue.id })],
  ["admin 'qz' (2 chars) in the largest venue", admin, "", page({ p_query: "qz", p_venue: t.bigVenue.id })],
  ["staff category (library_page)", staff.id, "", page({ p_category: t.category })],
  ["staff category (library_assets, reference)", staff.id, "", reference({ p_category: t.category })],
  ["staff search 'tikka' (library_page)", staff.id, "", page({ p_query: "tikka" })],
  ["staff search 'tikka' (library_assets, reference)", staff.id, "", reference({ p_query: "tikka" })],
  ["staff search 'zzzqq' no match (library_page)", staff.id, "", page({ p_query: "zzzqq" })],
  ["staff search 'zzzqq' no match (library_assets, reference)", staff.id, "", reference({ p_query: "zzzqq" })],
  ["staff 'qz' 2 chars (library_page)", staff.id, "", page({ p_query: "qz" })],
  ["staff content dish (library_page)", staff.id, "", page({ p_content_type: "dish" })],
  ["staff labelled (library_page)", staff.id, "", page({ p_label_state: "labelled" })],
  ["staff unlabelled (library_page)", staff.id, "", page({ p_label_state: "unlabelled" })],
  ["staff, lightest, search 'zzzqq' (library_page)", t.staffLight.id, "", page({ p_query: "zzzqq" })],
]

const results = []
for (const [name, person, setup, sql] of S) {
  const script = `begin;
${setup}
set local role authenticated;
set local statement_timeout = '60s';
select set_config('request.jwt.claims', ${q(claims(person))}, true) \\gset
do $do$
declare
  ts numeric[] := '{}'; t0 timestamptz; i int := 0; warm int := 2; runs int := ${N};
  c int; r numeric; sorted numeric[];
begin
  while i < warm + runs loop
    i := i + 1;
    t0 := clock_timestamp();
    select count(*) into c from (${sql}) s;
    r := extract(epoch from clock_timestamp() - t0) * 1000;
    if i > warm then ts := ts || r; end if;
    if i = 1 and r > 2000 then warm := 1; runs := 4; end if;
  end loop;
  select array_agg(x order by x) into sorted from unnest(ts) x;
  raise notice 'RESULT %', json_build_object('rows', c, 'n', cardinality(ts),
    'p50', round(sorted[ceil(cardinality(sorted) * 0.5)::int], 1),
    'p95', round(sorted[ceil(cardinality(sorted) * 0.95)::int], 1),
    'max', round(sorted[cardinality(sorted)], 1));
end $do$;
rollback;
`
  const run = spawnSync("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: script, encoding: "utf8", maxBuffer: 1 << 26 })
  const text = `${run.stdout}\n${run.stderr}`
  const m = /RESULT (\{.*\})/.exec(text)
  const row = m ? JSON.parse(m[1]) : { error: text.trim().split("\n").slice(-2).join(" ").slice(0, 160) }
  results.push({ name, ...row })
  console.error(
    `${name.padEnd(62)} ${m ? `p50 ${String(row.p50).padStart(9)}  p95 ${String(row.p95).padStart(9)}  max ${String(row.max).padStart(9)} ms  rows ${row.rows} n ${row.n}` : `ERROR ${row.error}`}`
  )
}
mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, "library-bad-cases.json"),
  JSON.stringify({ volume: VOLUME, loadAverage: loadavg().map((x) => Math.round(x * 100) / 100), cursors: { catCursor, labCursor, tikkaCursor }, results }, null, 2)
)
