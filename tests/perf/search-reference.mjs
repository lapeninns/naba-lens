// The old public.library_assets (called the way the app called it) and the new public.library_page on the same
// data, same stack and same minute: admin text search, timed inside the database
// as the signed-in admin (RLS applies). The old function still exists, so this
// is a same-stack before/after for the search shapes without redeploying code.
// Old and new alternate in each round so a change in host load hits both.
//
//   export PERF_STACK=spare6; source /tmp/nabalens-ws/spare6/env.sh
//   node tests/perf/search-reference.mjs --volume high [--rounds 3] [--n 20] [--out docs/perf/raw]
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
const ROUNDS = Number(arg("rounds", 3))
const N = Number(arg("n", 20))
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const { dbUrl } = requireWorkstreamStack()
const t = pickTargets(dbUrl)
const claims = `{"sub":"${t.admin.id}","role":"authenticated","aud":"authenticated"}`

const cases = []
for (const text of ["tikka", "chicken", "sunday", "zzzqq"]) {
  cases.push([`search '${text}'`, text, null])
  cases.push([`search '${text}' in the largest venue`, text, t.bigVenue.id])
}
// library_assets has no venue argument: the app filtered its result by venue.
// The arguments go in the way PostgREST passes them (a json_to_record row, so
// they are not planner constants). With literal arguments the planner picks a
// different plan, seconds slower than what the app ever ran.
const oldSql = (text, venue) =>
  `with pgrst_source as (select pgrst_call.* from (select '{"p_query":"${text}"}'::json as json_data) pgrst_payload,
  lateral (select "p_query" from json_to_record(pgrst_payload.json_data) as _("p_query" text) limit 1) pgrst_body,
  lateral public.library_assets("p_query" := pgrst_body."p_query") pgrst_call)
select id from pgrst_source where deleted_at is null and upload_state = 'ready'${venue ? ` and venue_id = '${venue}'` : ""} order by created_at desc, id desc limit 25`
const newSql = (text, venue) =>
  `select id from public.library_page(p_query := '${text}'${venue ? `, p_venue := '${venue}'` : ""}, p_limit := 25) order by created_at desc, id desc limit 25`

function time(sql) {
  const script = `begin;
set local role authenticated;
set local statement_timeout = '60s';
select set_config('request.jwt.claims', '${claims}', true) \\gset
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
    'p95', round(sorted[ceil(cardinality(sorted) * 0.95)::int], 1));
end $do$;
rollback;
`
  const run = spawnSync("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: script, encoding: "utf8", maxBuffer: 1 << 26 })
  const m = /RESULT (\{.*\})/.exec(`${run.stdout}\n${run.stderr}`)
  return m ? JSON.parse(m[1]) : { error: `${run.stderr}`.trim().split("\n").slice(-2).join(" ").slice(0, 160) }
}

const results = []
for (let round = 1; round <= ROUNDS; round++) {
  for (const [name, text, venue] of cases) {
    const before = time(oldSql(text, venue))
    const after = time(newSql(text, venue))
    results.push({ round, name, load: loadavg()[0], old: before, new: after })
    console.error(`r${round} ${name.padEnd(40)} old ${String(before.p50).padStart(8)} / ${String(before.p95).padStart(8)}   new ${String(after.p50).padStart(8)} / ${String(after.p95).padStart(8)}  rows ${before.rows}/${after.rows}`)
  }
}
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "search-reference.json"), JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), rounds: ROUNDS, n: N, results }, null, 2))
