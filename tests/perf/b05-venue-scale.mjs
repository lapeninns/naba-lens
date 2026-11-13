// B05 perf repair 2: how use = legacy_unknown scales with the size of a
// manager's venue once every legacy row there is settled by a grant (the
// steady state after launch: the search returns nothing and reads the whole
// venue). On the post-launch world (generate.mjs, b05-world.sql,
// b05-diff-world.sql, b05-postlaunch-world.sql).
//
// Inside one transaction per body and factor, always rolled back: every
// ready legacy_unknown asset at perf-b05-manager-big's venue with no grant
// in force or withdrawn gets a grant in force; then a share (--factors, 0.5
// = half) of the venue's ready, undeleted assets is copied (new ids and
// paths, created_at 1 ms earlier, so copies interleave in feed order) with
// their grants (new ids and request keys), and the copies of rows with no
// settled grant get one in force; media_assets and the grant tables are
// analyzed. The body (--bodies, a commit or WORKTREE) is installed, and
// use = legacy_unknown is called --n times as the manager after one warm-up
// call: wall ms per call (clock_timestamp inside the transaction), the
// venue's ready rows and the rows returned. After each rolled-back run,
// media_assets and the grant tables are vacuumed and analyzed (outside any
// transaction): the aborted copies and their index entries would otherwise
// sit in front of the next run's walk, and ANALYZE's estimates outlive the
// rollback.
//
// --commit (repair 3; changes the load, reset the stack afterwards): the
// settled and grown state is committed and vacuumed before timing, so the
// timed calls read committed, all-visible rows as in a steady state. Per
// factor: settle and grow (copy ids md5('perfb05s:' || source id)) in one
// committed transaction, vacuum (analyze), time every body (installed in a
// rolled-back transaction), then delete the copies and their grants and
// vacuum again. The settling grants on the original rows stay.
//
//   source /tmp/nabalens-ws/<stack>/env.sh
//   node tests/perf/b05-venue-scale.mjs --bodies WORKTREE --factors 0,0.5,1 \
//     [--n 10] [--commit] [--out <dir>]
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
const FACTORS = arg("factors", "0,0.5,1").split(",").map(Number)
const N = Number(arg("n", 10))
const COMMIT = argv.includes("--commit")
const OUT = resolve(arg("out", "docs/perf/raw"))
const MIGRATION =
  "supabase/migrations/20261113140200_media_b05m4_asset_search.sql"

const env = requireWorkstreamStack()
const one = (sql) => query(env.dbUrl, sql)[0] ?? []
const [manager, venue] = one(`select p.id, p.venue_id from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = 'perf-b05-manager-big@perf.nabalens.test'`)
if (!manager) throw new Error("Load tests/perf/b05-world.sql first.")
if (
  one(
    `select exists (select 1 from public.media_use_grants where request_key = 'perfb05p0000000001')`
  )[0] !== "t"
)
  throw new Error("Load tests/perf/b05-postlaunch-world.sql first.")
const admin = one(`select p.id from public.profiles p
  where p.role = 'admin' and p.active order by p.created_at limit 1`)[0]

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

// A grant in force for every ready asset of the venue (in temp table
// unsettled) that has none in force or withdrawn.
const settled = `exists (select 1 from public.media_use_grants g where g.asset_id = a.id
    and (exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
      or (g.effective_from <= now() and (g.effective_until is null or g.effective_until > now()))))`
const settle = (tag) => `
insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
    subject_kind, effective_from, effective_until, authorised_by, authority_basis,
    clearance_version, clearance, request_key)
  select a.id, a.venue_id, d.key, 'internal', 'general_gallery', 'none',
    now() - interval '1 day', null, '${admin}', 'admin', g0.clearance_version, '{"perf": true}',
    'perfb05s${tag}' || replace(a.id::text, '-', '')
  from public.media_assets a
  cross join (select key from public.media_use_destinations where audience = 'internal' and active
    order by key limit 1) d
  cross join (select clearance_version from public.media_use_grants limit 1) g0
  where a.venue_id = '${venue}' and a.deleted_at is null and a.upload_state = 'ready'
    and a.use_baseline = 'legacy_unknown' and not ${settled};`

const grow = (factor) =>
  factor === 0
    ? ""
    : `
create temp table scale_src on commit drop as
  select a.id as src, md5('perfb05s:' || a.id::text)::uuid as id
  from public.media_assets a
  where a.venue_id = '${venue}' and a.deleted_at is null and a.upload_state = 'ready'
    and abs(hashtext(a.id::text || 'scale')::bigint) % 1000 < ${Math.round(factor * 1000)};
insert into public.media_assets (id, uploader_id, venue_id, original_path, preview_path,
    thumbnail_path, original_filename, media_type, validated_mime_type, size_bytes, width,
    height, duration_seconds, upload_state, created_at, updated_at, deleted_at,
    client_upload_key, purpose, uploader_role, use_baseline)
  select s.id, a.uploader_id, a.venue_id, a.uploader_id || '/' || s.id || '/original.jpg', null,
    null, a.original_filename, a.media_type, a.validated_mime_type, a.size_bytes, a.width,
    a.height, a.duration_seconds, a.upload_state, a.created_at - interval '1 millisecond',
    a.updated_at, a.deleted_at, null, a.purpose, a.uploader_role, a.use_baseline
  from scale_src s join public.media_assets a on a.id = s.src;
insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
    subject_kind, subject_id, subject_key, derivative_profile_key, effective_from,
    effective_until, authorised_by, authority_basis, clearance_version, clearance,
    internal_note, request_key, created_at)
  select s.id, g.venue_id, g.destination_key, g.audience, g.purpose, g.subject_kind,
    g.subject_id, g.subject_key, g.derivative_profile_key, g.effective_from, g.effective_until,
    g.authorised_by, g.authority_basis, g.clearance_version, g.clearance, g.internal_note,
    'perfb05c' || replace(gen_random_uuid()::text, '-', ''), g.created_at
  from scale_src s join public.media_use_grants g on g.asset_id = s.src;`

const HARNESS = `
create function pg_temp.scale_run(p_n integer)
returns jsonb language plpgsql as $f$
declare
  v_t timestamptz; v_ms float8[] := '{}'; v_page jsonb;
begin
  v_page := public.asset_search('{"rights":"legacy_unknown"}', null, null, 24);
  for i in 1 .. p_n loop
    v_t := clock_timestamp();
    v_page := public.asset_search('{"rights":"legacy_unknown"}', null, null, 24);
    v_ms := v_ms || (extract(epoch from clock_timestamp() - v_t) * 1000)::float8;
  end loop;
  return jsonb_build_object('ms', to_jsonb(v_ms), 'rows', jsonb_array_length(v_page -> 'items'),
    'hasMore', v_page -> 'hasMore');
end $f$;
grant execute on function pg_temp.scale_run(integer) to authenticated;
`

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return (
    Math.round(
      s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10
    ) / 10
  )
}

const VACUUM = `vacuum (analyze) public.media_assets, public.media_use_grants,
  public.media_use_grant_withdrawals;`
const vacuum = () =>
  psql(env.dbUrl, ["-At", "-v", "ON_ERROR_STOP=1"], { input: VACUUM })
// Copies (ids md5('perfb05s:' || source id)) and their grants, committed.
const DROP_COPIES = `begin;
set local statement_timeout = 0;
set local session_replication_role = replica;
create temp table scale_copies on commit drop as
  select c.id from public.media_assets s
  join public.media_assets c on c.id = md5('perfb05s:' || s.id::text)::uuid
  where s.venue_id = '${venue}';
delete from public.media_use_grant_withdrawals w using public.media_use_grants g
  where w.grant_id = g.id and g.asset_id in (select id from scale_copies);
delete from public.media_use_grants g where g.asset_id in (select id from scale_copies);
delete from public.media_assets a where a.id in (select id from scale_copies);
commit;`

const loadStart = loadavg()
const results = []
const runs = COMMIT
  ? FACTORS.flatMap((factor) => BODIES.map((body) => ({ body, factor })))
  : BODIES.flatMap((body) => FACTORS.map((factor) => ({ body, factor })))
let grown = null
for (const [i, { body, factor }] of runs.entries()) {
  if (COMMIT && grown !== factor) {
    if (grown !== null) {
      psql(env.dbUrl, ["-At", "-v", "ON_ERROR_STOP=1"], { input: DROP_COPIES })
      vacuum()
    }
    psql(env.dbUrl, ["-At", "-v", "ON_ERROR_STOP=1"], {
      input: `begin;
set local statement_timeout = 0;
set local session_replication_role = replica;
${settle("a")}
${grow(factor)}
${settle("b")}
commit;`,
    })
    vacuum()
    grown = factor
  }
  {
    const out = psql(env.dbUrl, ["-At", "-v", "ON_ERROR_STOP=1"], {
      input: `begin;
set local statement_timeout = 0;
${
  COMMIT
    ? ""
    : `set local session_replication_role = replica;
${settle("a")}
${grow(factor)}
${settle("b")}
set local session_replication_role = origin;
analyze public.media_assets;
analyze public.media_use_grants;`
}
${definition(body)};
select 'B|' || md5(prosrc) || '|' || md5(pg_get_functiondef(oid)) || '|' || array_to_string(proconfig, ',')
  from pg_proc where oid = 'public.asset_search(jsonb,timestamptz,uuid,integer)'::regprocedure;
select 'V|' || json_build_object(
    'ready', (select count(*) from public.media_assets a where a.venue_id = '${venue}'
      and a.deleted_at is null and a.upload_state = 'ready'),
    'legacy', (select count(*) from public.media_assets a where a.venue_id = '${venue}'
      and a.deleted_at is null and a.upload_state = 'ready' and a.use_baseline = 'legacy_unknown'),
    'legacyUnsettled', (select count(*) from public.media_assets a where a.venue_id = '${venue}'
      and a.deleted_at is null and a.upload_state = 'ready' and a.use_baseline = 'legacy_unknown'
      and not ${settled}))::text;
${HARNESS}
select set_config('request.jwt.claims', '{"sub":"${manager}","role":"authenticated","aud":"authenticated"}', true) is null;
set local role authenticated;
select 'R|' || pg_temp.scale_run(${N})::text;
rollback;
`,
    })
    const lines = out.split("\n")
    const [, src, def, config] = lines
      .find((l) => l.startsWith("B|"))
      .split("|")
    const v = JSON.parse(lines.find((l) => l.startsWith("V|")).slice(2))
    const r = JSON.parse(lines.find((l) => l.startsWith("R|")).slice(2))
    const entry = {
      order: i + 1,
      committed: COMMIT,
      loadAverage1m: loadavg()[0],
      body,
      installed: {
        assetSearchProsrcMd5: src,
        assetSearchFunctiondefMd5: def,
        config,
      },
      factor,
      venue: v,
      rows: r.rows,
      hasMore: r.hasMore,
      n: N,
      p50: pct(r.ms, 50),
      p95: pct(r.ms, 95),
      ms: r.ms.map((x) => Math.round(x * 100) / 100),
    }
    results.push(entry)
    console.error(
      `${String(i + 1).padStart(2)} ${body.padEnd(9)} factor ${factor}  ready ${v.ready}  legacy ${v.legacy} (unsettled ${v.legacyUnsettled})  rows ${r.rows}  p50 ${entry.p50}  p95 ${entry.p95}  load ${entry.loadAverage1m.toFixed(2)}`
    )
  }
  // The rolled-back run leaves dead copies and analyze's estimates behind.
  if (!COMMIT) vacuum()
}
if (COMMIT && grown !== null) {
  psql(env.dbUrl, ["-At", "-v", "ON_ERROR_STOP=1"], { input: DROP_COPIES })
  vacuum()
}
mkdirSync(OUT, { recursive: true })
const file = join(OUT, "b05-venue-scale.json")
writeFileSync(
  file,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      revision: gitHead(),
      loadAverage: { start: loadStart, end: loadavg() },
      bodies: BODIES,
      factors: FACTORS,
      committed: COMMIT,
      n: N,
      results,
    },
    null,
    2
  )
)
console.error(`wrote ${file}`)
