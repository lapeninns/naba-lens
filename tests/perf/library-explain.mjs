// EXPLAIN (ANALYZE, BUFFERS) of the statements public.library_page runs, as the
// `authenticated` role with the person's JWT claims (RLS as through the API).
// library_page builds its query as dynamic SQL, which EXPLAIN cannot see from
// outside, so each case runs a copy of the function (rolled back) whose RETURN
// QUERY is wrapped in EXPLAIN. The candidate lookup that precedes the page
// query (private.library_candidate_ids) is a separate set of statements; its
// text-search and category plans are written as well.
//
//   export PERF_STACK=spare7; source /tmp/nabalens-ws/spare7/env.sh
//   node tests/perf/library-explain.mjs --volume high [--out docs/perf/raw]
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { psql, requireWorkstreamStack } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "high")
const OUT = join(
  resolve(arg("out", "docs/perf/raw"), VOLUME),
  "explain-library-page"
)
const { dbUrl } = requireWorkstreamStack()
const t = pickTargets(dbUrl)
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const claims = (id) =>
  `{"sub":"${id}","role":"authenticated","aud":"authenticated"}`

const SIGNATURE =
  "public.library_page(uuid,uuid,public.media_type,timestamptz,timestamptz,uuid,uuid,text,text,text,text,timestamptz,uuid,integer,integer)"
const def = psql(dbUrl, [
  "-Atq",
  "-c",
  `select pg_get_functiondef('${SIGNATURE}'::regprocedure)`,
])
  .replace(
    "FUNCTION public.library_page(",
    "FUNCTION public.library_page_explain("
  )
  .replace(/RETURNS SETOF (public\.)?media_assets/, "RETURNS SETOF text")
  .replace(" STABLE", " VOLATILE")
  .replace(
    "return query execute v_sql",
    "return query execute 'explain (analyze, buffers) ' || v_sql"
  )

const args = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k} := ${typeof v === "number" ? v : q(v)}`)
    .concat("p_limit := 25")
    .join(", ")
const cursor = t.cursors.category[0]
const CASES = [
  ["admin-category-curries", t.admin.id, { p_category: t.category }],
  [
    "admin-category-curries-cursor-50pct",
    t.admin.id,
    {
      p_category: t.category,
      p_after_created_at: cursor.createdAt,
      p_after_id: cursor.id,
    },
  ],
  [
    "admin-venue-category",
    t.admin.id,
    { p_category: t.category, p_venue: t.bigVenue.id },
  ],
  ["admin-labelled", t.admin.id, { p_label_state: "labelled" }],
  ["admin-unlabelled", t.admin.id, { p_label_state: "unlabelled" }],
  ["admin-item-rare", t.admin.id, { p_item: t.rareItem.id }],
  ["admin-item-popular", t.admin.id, { p_item: t.popularItem.id }],
  ["admin-content-dish", t.admin.id, { p_content_type: "dish" }],
  ["admin-search-tikka", t.admin.id, { p_query: "tikka" }],
  ["admin-search-chicken", t.admin.id, { p_query: "chicken" }],
  ["admin-search-nomatch", t.admin.id, { p_query: "zzzqq" }],
  [
    "admin-feed-cursor-90pct",
    t.admin.id,
    {
      p_after_created_at: t.cursors.feed[2].createdAt,
      p_after_id: t.cursors.feed[2].id,
    },
  ],
  ["staff-heaviest-category", t.staffHeavy.id, { p_category: t.category }],
  ["staff-heaviest-search-tikka", t.staffHeavy.id, { p_query: "tikka" }],
]

mkdirSync(OUT, { recursive: true })
for (const [name, person, a] of CASES) {
  const script = `begin;
${def};
set local role authenticated;
set local statement_timeout = '60s';
select set_config('request.jwt.claims', ${q(claims(person))}, true) \\gset
select * from public.library_page_explain(${args(a)});
rollback;
`
  const run = spawnSync(
    "psql",
    [dbUrl, "-X", "-Aqt", "-v", "ON_ERROR_STOP=1"],
    { input: script, encoding: "utf8", maxBuffer: 1 << 26 }
  )
  const text = run.status === 0 ? run.stdout : `ERROR\n${run.stderr}`
  writeFileSync(
    join(OUT, `${name}.txt`),
    `-- ${name} (library_page ${args(a)})\n\n${text}`
  )
  const ms = /Execution Time: ([\d.]+) ms/.exec(text)?.[1]
  const seq = [
    ...new Set([...text.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1])),
  ]
  console.error(
    `${name.padEnd(40)} exec ${String(ms).padStart(9)} ms  seq: ${seq.join(",") || "-"}`
  )
}

// Candidate lookups of the text-search and category kinds, as the helper runs
// them for an admin (the helper is SECURITY DEFINER, so no row level security).
const candidateSql = {
  "candidates-search-nomatch": `select l.asset_id from public.media_labels l where l.note ilike '%zzzqq%' limit 3001;
select li.asset_id from public.media_label_items li where li.item_name ilike '%zzzqq%' or li.variant_name ilike '%zzzqq%' or li.section_name ilike '%zzzqq%' limit 3001`,
  "candidates-category": `select li.asset_id from public.media_label_items li where li.section_slug = ${q(t.category)} limit 3001`,
}
for (const [name, sql] of Object.entries(candidateSql)) {
  const text = sql
    .split(";\n")
    .map((s) =>
      psql(dbUrl, ["-Aqt"], {
        input: `set statement_timeout='60s'; explain (analyze, buffers) ${s}`,
      })
    )
    .join("\n")
  writeFileSync(join(OUT, `${name}.txt`), `-- ${name}\n\n${text}`)
}

// The label-state page (private.library_label_state_page) as it plans the
// statement for an admin, in the natural data and in two shapes built inside a
// rolled-back transaction: every asset labelled, and only the oldest 5,000
// assets unlabelled.
const stateSql = (neg) =>
  `select a.id from public.media_assets a where a.deleted_at is null and a.upload_state = 'ready' and ${neg ? "not " : ""}exists (select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels) order by a.created_at desc, a.id desc limit 25`
const allLabelled = `set local session_replication_role = replica;
update public.media_labels set has_labels = true where not has_labels;
insert into public.media_labels (asset_id, venue_id, has_labels) select a.id, a.venue_id, true from public.media_assets a where not exists (select 1 from public.media_labels l where l.asset_id = a.id);
set local session_replication_role = origin;
analyze public.media_labels;`
const oldestUnlabelled = `set local session_replication_role = replica;
update public.media_labels set has_labels = true where not has_labels;
insert into public.media_labels (asset_id, venue_id, has_labels) select a.id, a.venue_id, true from public.media_assets a where not exists (select 1 from public.media_labels l where l.asset_id = a.id) and a.id not in (select id from public.media_assets order by created_at asc, id asc limit 5000);
set local session_replication_role = origin;
analyze public.media_labels;`
for (const [name, setup, sql] of [
  ["state-unlabelled-natural", "", stateSql(true)],
  ["state-labelled-natural", "", stateSql(false)],
  ["state-unlabelled-none-unlabelled", allLabelled, stateSql(true)],
  ["state-unlabelled-oldest-5000", oldestUnlabelled, stateSql(true)],
]) {
  const run = spawnSync(
    "psql",
    [dbUrl, "-X", "-Aqt", "-v", "ON_ERROR_STOP=1"],
    {
      input: `begin;\n${setup}\nset local statement_timeout = '60s';\nexplain (analyze, buffers) ${sql};\nrollback;\n`,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    }
  )
  const text = run.status === 0 ? run.stdout : `ERROR\n${run.stderr}`
  writeFileSync(
    join(OUT, `${name}.txt`),
    `-- ${name} (statement of private.library_label_state_page)\n\n${text}`
  )
  console.error(
    `${name.padEnd(40)} exec ${/Execution Time: ([\d.]+) ms/.exec(text)?.[1]} ms`
  )
}
