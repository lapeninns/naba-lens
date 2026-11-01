// The old public.library_assets against the new public.library_page in the
// reshaped data sets of library-bad-cases.mjs, in the same transaction and the
// same minute, both as the signed-in admin (RLS applies).
//
// The old function is called the way PostgREST calls it (arguments come from a
// json_to_record row, so they are not planner constants); this is the
// statement db-bench's app path sends. Called with literal arguments it
// plans differently and is not what the app ran.
//
// Each scenario is one transaction that reshapes the data, times old, new, old,
// new (3 warm-ups and 10 timed runs each), and rolls back.
//
//   export PERF_STACK=spare6; source /tmp/nabalens-ws/spare6/env.sh
//   node tests/perf/old-new-shapes.mjs --volume high [--out docs/perf/raw] [--warm 3] [--n 10]
import { mkdirSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { requireWorkstreamStack } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "high")
const WARM = Number(arg("warm", 3))
const N = Number(arg("n", 10))
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const { dbUrl } = requireWorkstreamStack()
const t = pickTargets(dbUrl)
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const claims = `{"sub":"${t.admin.id}","role":"authenticated","aud":"authenticated"}`

const oldSql = (args) => {
  const names = Object.keys(args)
  const record = names.map((n) => `"${n}" text`).join(", ")
  const call = names.map((n) => `"${n}" := pgrst_body."${n}"`).join(", ")
  return `with pgrst_source as (select pgrst_call.* from (select ${q(JSON.stringify(args))}::json as json_data) pgrst_payload,
  lateral (select ${names.map((n) => `"${n}"`).join(", ")} from json_to_record(pgrst_payload.json_data) as _(${record}) limit 1) pgrst_body,
  lateral public.library_assets(${call}) pgrst_call)
select a.id from pgrst_source a where a.deleted_at is null and a.upload_state = 'ready' order by a.created_at desc, a.id desc limit 25`
}
const newSql = (args) =>
  `select id from public.library_page(${Object.entries(args)
    .map(([k, v]) => `${k} := ${q(v)}`)
    .join(", ")}, p_limit := 25) order by created_at desc, id desc limit 25`

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
const zeroUnlabelled = `
set local session_replication_role = replica;
update public.media_labels l set has_labels = true where not has_labels;
insert into public.media_labels (asset_id, venue_id, has_labels)
select a.id, a.venue_id, true from public.media_assets a
where not exists (select 1 from public.media_labels l where l.asset_id = a.id);
set local session_replication_role = origin;
analyze public.media_labels;`
const zeroLabelled = `
update public.media_labels set has_labels = false where has_labels;
analyze public.media_labels;`

const S = [
  ["control: labelled (natural)", "", { p_label_state: "labelled" }],
  ["control: unlabelled (natural)", "", { p_label_state: "unlabelled" }],
  ["control: search 'tikka'", "", { p_query: "tikka" }],
  ["control: category", "", { p_category: t.category }],
  ["unlabelled, none unlabelled", zeroUnlabelled, { p_label_state: "unlabelled" }],
  [`unlabelled, only the oldest ${OLDEST} unlabelled`, sparseUnlabelled, { p_label_state: "unlabelled" }],
  [`labelled, only the oldest ${OLDEST} labelled`, sparseLabelled, { p_label_state: "labelled" }],
  ["labelled, none labelled", zeroLabelled, { p_label_state: "labelled" }],
  ["labelled, only 200 labelled", fewLabelled, { p_label_state: "labelled" }],
]

const timer = (sql) => `do $do$
declare
  ts numeric[] := '{}'; t0 timestamptz; i int := 0; c int; r numeric; sorted numeric[];
begin
  while i < ${WARM + N} loop
    i := i + 1;
    t0 := clock_timestamp();
    select count(*) into c from (${sql}) s;
    r := extract(epoch from clock_timestamp() - t0) * 1000;
    if i > ${WARM} then ts := ts || r; end if;
  end loop;
  select array_agg(x order by x) into sorted from unnest(ts) x;
  raise notice 'RESULT %', json_build_object('rows', c, 'n', cardinality(ts),
    'p50', round(sorted[ceil(cardinality(sorted) * 0.5)::int], 1),
    'p95', round(sorted[ceil(cardinality(sorted) * 0.95)::int], 1),
    'max', round(sorted[cardinality(sorted)], 1));
end $do$;
`

const results = []
for (const [name, setup, args] of S) {
  const script = `begin;
${setup}
set local role authenticated;
set local statement_timeout = '120s';
select set_config('request.jwt.claims', ${q(claims)}, true) \\gset
${timer(oldSql(args))}${timer(newSql(args))}${timer(oldSql(args))}${timer(newSql(args))}rollback;
`
  const run = spawnSync("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: script, encoding: "utf8", maxBuffer: 1 << 26 })
  const text = `${run.stdout}\n${run.stderr}`
  const found = [...text.matchAll(/RESULT (\{.*\})/g)].map((m) => JSON.parse(m[1]))
  if (found.length !== 4) {
    results.push({ name, error: text.trim().split("\n").slice(-2).join(" ").slice(0, 200) })
    console.error(`${name}: ERROR ${results.at(-1).error}`)
    continue
  }
  const [o1, n1, o2, n2] = found
  results.push({ name, load: loadavg()[0], old: [o1, o2], new: [n1, n2] })
  console.error(
    `${name.padEnd(46)} old ${o1.p50}/${o1.p95} ${o2.p50}/${o2.p95}   new ${n1.p50}/${n1.p95} ${n2.p50}/${n2.p95}  rows ${o1.rows}/${n1.rows}`
  )
}
mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, "old-new-shapes.json"),
  JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), warm: WARM, n: N, loadAverage: loadavg(), results }, null, 2)
)
