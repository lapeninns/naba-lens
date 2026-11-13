// B05 perf repair 2: public.asset_search with the gate prefilter's tables
// freshly packed at one or two pages (the state of a database just after
// launch), against the same calls on the loaded world, for one or more
// bodies of public.asset_search, all in the same world load.
//
// Inside one transaction per body and table size, always rolled back:
// every table a probe of the chunk query reads (labels, label items, menu
// decisions, coverage items, fact media, amenity and knowledge evidence) is
// truncated and refilled with --rows of its own rows (cascade: their event
// tables), then analyzed, so each is one or two pages. The body is installed
// (create or replace, rolled back too), and each case is called --n times as
// its caller (role authenticated, JWT claims), after one warm-up call. Per
// case: wall ms per call (clock_timestamp inside the transaction) and the
// sequential and index scans each probed table took during the timed calls
// (pg_stat_xact_user_tables), which shows whether a probe scanned the table
// once per row read.
//
// Needs generate.mjs, b05-world.sql and b05-diff-world.sql (the reject
// venue). Local workstream stacks only.
//
//   source /tmp/nabalens-ws/<stack>/env.sh
//   node tests/perf/b05-tiny-tables.mjs --bodies de343859,WORKTREE \
//     --rows 0,100,250 [--n 10] [--out <dir>]
// --rows 0 means the tables as loaded (no truncation).
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"

import { gitHead, psql, query, requireWorkstreamStack } from "./lib.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const BODIES = arg("bodies", "WORKTREE").split(",")
const ROWS = arg("rows", "0,100,250").split(",").map(Number)
const N = Number(arg("n", 10))
const OUT = resolve(arg("out", "docs/perf/raw"))
const MIGRATION =
  "supabase/migrations/20261113140200_media_b05m4_asset_search.sql"
const TABLES = [
  "media_labels",
  "media_label_items",
  "menu_item_photos",
  "coverage_submission_items",
  "venue_amenity_fact_media",
  "amenity_submission_assets",
  "knowledge_contribution_assets",
]

const env = requireWorkstreamStack()
const one = (sql) => query(env.dbUrl, sql)[0] ?? []
const personId = (name) => {
  const id = one(
    `select p.id from public.profiles p where p.display_name = '${name}'`
  )[0]
  if (!id) throw new Error(`no ${name}: load tests/perf/b05-diff-world.sql`)
  return id
}
const reject = personId("PERF Reject Manager")
const big =
  one(`select p.id from public.profiles p join auth.users u on u.id = p.id
  where u.email = 'perf-b05-manager-big@perf.nabalens.test'`)[0]
const CASES = [
  ["reject venue: no filters", reject, {}, 24],
  [
    "reject venue: use = legacy_unknown",
    reject,
    { rights: "legacy_unknown" },
    24,
  ],
  ["managerBig: no filters", big, {}, 24],
  ["managerBig: use = not_granted", big, { rights: "not_granted" }, 24],
]

const definition = (body) => {
  const src =
    body === "WORKTREE"
      ? readFileSync(MIGRATION, "utf8")
      : execFileSync("git", ["show", `${body}:${MIGRATION}`], {
          encoding: "utf8",
        })
  const h = "create function public.asset_search("
  const s = src.indexOf(h)
  const e = src.indexOf("\n$$;", s)
  if (s < 0 || e < 0) throw new Error(`no asset_search in ${body}`)
  return `create or replace function public.asset_search(${src.slice(s + h.length, e + 4)}`
}

const shrink = (rows) =>
  rows === 0
    ? ""
    : `set local session_replication_role = replica;
${TABLES.map((t) => `create temp table keep_${t} on commit drop as select * from public.${t} limit ${rows};`).join("\n")}
truncate ${TABLES.map((t) => `public.${t}`).join(", ")} cascade;
${TABLES.map((t) => `insert into public.${t} select * from keep_${t};`).join("\n")}
${TABLES.map((t) => `analyze public.${t};`).join("\n")}
set local session_replication_role = origin;`

const HARNESS = `
create function pg_temp.tiny_run(p_filters jsonb, p_limit integer, p_n integer)
returns jsonb language plpgsql as $f$
declare
  v_t timestamptz; v_ms float8[] := '{}'; v_page jsonb;
  v_before jsonb; v_after jsonb;
begin
  v_page := public.asset_search(p_filters, null, null, p_limit);
  select jsonb_object_agg(relname, jsonb_build_array(coalesce(seq_scan, 0), coalesce(idx_scan, 0)))
    into v_before from pg_stat_xact_user_tables
    where schemaname = 'public' and relname = any (${`array[${TABLES.map((t) => `'${t}'`).join(", ")}]`});
  for i in 1 .. p_n loop
    v_t := clock_timestamp();
    v_page := public.asset_search(p_filters, null, null, p_limit);
    v_ms := v_ms || (extract(epoch from clock_timestamp() - v_t) * 1000)::float8;
  end loop;
  select jsonb_object_agg(relname, jsonb_build_array(coalesce(seq_scan, 0), coalesce(idx_scan, 0)))
    into v_after from pg_stat_xact_user_tables
    where schemaname = 'public' and relname = any (${`array[${TABLES.map((t) => `'${t}'`).join(", ")}]`});
  return jsonb_build_object('ms', to_jsonb(v_ms), 'rows', jsonb_array_length(v_page -> 'items'),
    'before', v_before, 'after', v_after);
end $f$;
grant execute on function pg_temp.tiny_run(jsonb, integer, integer) to authenticated;
`

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return (
    Math.round(
      s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10
    ) / 10
  )
}

const loadStart = loadavg()
const results = []
for (const body of BODIES) {
  for (const rows of ROWS) {
    const calls = CASES.map(
      ([name, who, filters, limit]) => `
select set_config('request.jwt.claims', '{"sub":"${who}","role":"authenticated","aud":"authenticated"}', true) is null;
set local role authenticated;
select 'R|' || jsonb_build_object('name', '${name}', 'r', pg_temp.tiny_run('${JSON.stringify(filters)}'::jsonb, ${limit}, ${N}))::text;
reset role;`
    ).join("\n")
    const out = psql(env.dbUrl, ["-At", "-v", "ON_ERROR_STOP=1"], {
      input: `begin;
set local statement_timeout = 0;
${shrink(rows)}
${definition(body)};
select 'B|' || md5(prosrc) || '|' || md5(pg_get_functiondef(oid)) || '|' || array_to_string(proconfig, ',')
  from pg_proc where oid = 'public.asset_search(jsonb,timestamptz,uuid,integer)'::regprocedure;
select 'T|' || json_object_agg(relname, json_build_array(relpages, reltuples::bigint, pg_relation_size(oid) / 8192))::text
  from pg_class where relnamespace = 'public'::regnamespace and relname = any (array[${TABLES.map((t) => `'${t}'`).join(", ")}]);
${HARNESS}
${calls}
rollback;
`,
    })
    const lines = out.split("\n")
    const [, src, def, config] = lines
      .find((l) => l.startsWith("B|"))
      .split("|")
    const tables = JSON.parse(lines.find((l) => l.startsWith("T|")).slice(2))
    for (const l of lines.filter((x) => x.startsWith("R|"))) {
      const { name, r } = JSON.parse(l.slice(2))
      const scans = Object.fromEntries(
        TABLES.map((t) => [
          t,
          {
            seq: (r.after?.[t]?.[0] ?? 0) - (r.before?.[t]?.[0] ?? 0),
            idx: (r.after?.[t]?.[1] ?? 0) - (r.before?.[t]?.[1] ?? 0),
          },
        ])
      )
      const entry = {
        body,
        installed: {
          assetSearchProsrcMd5: src,
          assetSearchFunctiondefMd5: def,
          config,
        },
        rowsKept: rows,
        tables,
        name,
        rows: r.rows,
        n: N,
        p50: pct(r.ms, 50),
        p95: pct(r.ms, 95),
        ms: r.ms.map((x) => Math.round(x * 100) / 100),
        scansPerCall: Object.fromEntries(
          Object.entries(scans).map(([t, v]) => [
            t,
            { seq: Math.round(v.seq / N), idx: Math.round(v.idx / N) },
          ])
        ),
      }
      results.push(entry)
      const seqTables = Object.entries(entry.scansPerCall)
        .filter(([, v]) => v.seq > 0)
        .map(([t, v]) => `${t}:${v.seq}`)
      console.error(
        `${body.padEnd(9)} rows ${String(rows).padStart(3)}  ${name.padEnd(36)} p50 ${String(entry.p50).padStart(7)}  p95 ${String(entry.p95).padStart(7)}  seq/call: ${seqTables.join(" ") || "-"}`
      )
    }
  }
}
mkdirSync(OUT, { recursive: true })
const file = join(OUT, "b05-tiny-tables.json")
writeFileSync(
  file,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      revision: gitHead(),
      loadAverage: { start: loadStart, end: loadavg() },
      bodies: BODIES,
      rowsKept: ROWS,
      n: N,
      results,
    },
    null,
    2
  )
)
console.error(`wrote ${file}`)
