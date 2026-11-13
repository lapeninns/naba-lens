// Differential test of public.asset_search (B05 perf fix,
// contracts/b05-perf-search-fix-scope.md) against the body it replaced, on a
// perf volume plus tests/perf/b05-world.sql and tests/perf/b05-diff-world.sql.
// Local workstream stacks only (PERF_STACK, default spare6).
//
// The reference (v1) is the base commit's public.asset_search (frozen in
// tests/security/fixtures/asset-search-v1.sql; --base <commit> reads it from
// git instead), created as
// pg_temp.asset_search_v1 inside a transaction that is always rolled back, so
// nothing persists. Every call runs as the caller (role authenticated, its JWT
// claims), and every page is compared as jsonb text, errors as
// {SQLSTATE, message, detail}.
//
// Where v1 is too slow to walk (its gate runs before the filters), a walk is
// compared against an oracle instead: v1's own text with its row query read in
// order without a limit and the gate applied per row in a plpgsql loop, i.e.
// the first n rows of the ordered set {filters and rights and admits} after
// the cursor (n = pages x limit + 1, passed as p_limit). Its pages and hasMore
// must equal the new body's. Mode per walk:
//   v1       every page against v1; after a v1 page slower than --slow ms the
//            rest of the walk is checked against the oracle;
//   oracle1  page 1 against v1, then the oracle;
//   oracle0  the oracle only (manager big + check: v1 needs about 50 s a page;
//            the same filters run against v1 at the small venue).
//
//   source /tmp/nabalens-ws/<stack>/env.sh
//   node tests/perf/b05-diff.mjs --part compare --caller managerBig [--slice 0:20]
//   node tests/perf/b05-diff.mjs --part errors --caller admin
//   node tests/perf/b05-diff.mjs --part invariants --caller managerSmall
//   node tests/perf/b05-diff.mjs --part rights
//   node tests/perf/b05-diff.mjs --part list --caller admin   (case names only)
// --only a|b keeps the cases whose name contains any of the parts.
// Options: --base <commit> (default: the frozen fixture), --cap <pages> (40), --slow <ms>
// (2000), --out <dir> (results appended as JSON lines to b05-diff.jsonl).
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"

import { gitHead, psql, query, requireWorkstreamStack } from "./lib.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const PART = arg("part", "compare")
const CALLER = arg("caller", "admin")
const BASE = arg("base", null)
const FIXTURE = "tests/security/fixtures/asset-search-v1.sql"
const CAP = Number(arg("cap", 40))
const SLOW = Number(arg("slow", 2000))
const SLICE = arg("slice", null)
const ONLY = arg("only", null)
const SAMPLE = arg("sample", null)
const OUT = resolve(arg("out", "docs/perf/raw"))
const MIGRATION =
  "supabase/migrations/20261113140200_media_b05m4_asset_search.sql"

const env = requireWorkstreamStack()
const one = (sql) => query(env.dbUrl, sql)[0] ?? []
const did = (k) => {
  const h = createHash("md5").update(`perfb05d:${k}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
if (
  one(
    `select count(*) from public.venues where id = '${did("venue-reject")}'`
  )[0] !== "1"
)
  throw new Error("Load tests/perf/b05-diff-world.sql first.")

// ---------------------------------------------------------------- sources
const base =
  BASE || !existsSync(FIXTURE)
    ? execFileSync("git", ["show", `${BASE ?? "7d2a783c"}:${MIGRATION}`], {
        encoding: "utf8",
      })
    : readFileSync(FIXTURE, "utf8")
const head = readFileSync(MIGRATION, "utf8")
const fnBody = (src) => {
  const h = "create function public.asset_search("
  const s = src.indexOf(h)
  const e = src.indexOf("\n$$;", s)
  if (s < 0 || e < 0) throw new Error("no asset_search body")
  return src.slice(s + h.length, e + 4)
}
const cut = (src, from, to, label) => {
  const s = src.indexOf(from)
  const e = src.indexOf(to, s + from.length)
  if (s < 0 || e < 0) throw new Error(`source marker missing: ${label}`)
  return src.slice(s, e)
}
const replaceOnce = (src, from, to, label) => {
  const i = src.indexOf(from)
  if (i < 0 || src.indexOf(from, i + 1) >= 0)
    throw new Error(`source marker not unique: ${label}`)
  return src.slice(0, i) + to + src.slice(i + from.length)
}
const v1Body = fnBody(base)
const REFERENCE = `create function pg_temp.asset_search_v1(${v1Body}`
// The oracle: v1 with its row query read in order, unlimited, and the gate
// applied per row until p_limit rows are admitted; it returns that ordered id
// list after the cursor.
let oracle = replaceOnce(
  v1Body,
  `  select array_agg(x.id order by x.created_at desc, x.id desc) into v_ids
  from (
    select a.id, a.created_at`,
  `  v_ids := '{}';
  for v_row in
    select a.id, a.created_at`,
  "v1 select"
)
oracle = replaceOnce(
  oracle,
  `      and private.asset_search_admits(a, v_admin, v_manager_venue)
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ) x;`,
  `    order by a.created_at desc, a.id desc
  loop
    if private.asset_search_admits(
        (select r from public.media_assets r where r.id = v_row.id), v_admin, v_manager_venue) then
      v_ids := v_ids || v_row.id;
      exit when cardinality(v_ids) >= p_limit;
    end if;
  end loop;`,
  "v1 gate"
)
oracle = replaceOnce(
  oracle,
  "\ndeclare\n",
  "\ndeclare\n  v_row record;\n",
  "v1 declare"
)
oracle = replaceOnce(
  oracle,
  cut(oracle, "  v_ids := coalesce(v_ids, '{}');", "\nend;\n$$;", "v1 tail"),
  "  return to_jsonb(coalesce(v_ids, '{}'));",
  "v1 tail"
)
const ORACLE = `create function pg_temp.asset_search_oracle(${oracle}`

// Expressions of the shipped body, for the invariants.
const newBody = fnBody(head)
const P_EXPR = cut(
  newBody,
  "(v_admin or (",
  "\n        order by a.created_at desc, a.id desc\n        limit v_chunk",
  "P"
)
const RSQL = cut(
  newBody,
  "(v_rights is null\n            or (v_rights = 'legacy_unknown'",
  "\n          -- Gate prefilter P",
  "Rsql"
)
const RLOOP = cut(
  newBody,
  "(v_rights is null\n            or (v_rights in",
  "\n           and private.asset_search_admits(v_row",
  "Rloop"
)
const RV1 = cut(
  v1Body,
  "(v_rights is null\n        or (v_rights in",
  "\n      and private.asset_search_admits(a, v_admin",
  "R v1"
)

// ---------------------------------------------------------------- people and fixtures
const person = (email) => {
  const [id, venueId, role, active] = one(
    `select p.id, p.venue_id, p.role, p.active from public.profiles p join auth.users u on u.id = p.id where u.email = '${email}'`
  )
  if (!id) throw new Error(`no person ${email}`)
  return { id, venueId, role, active: active === "t", email }
}
const big = person("perf-b05-manager-big@perf.nabalens.test").venueId
const small = person("perf-b05-manager-small@perf.nabalens.test").venueId
const reject = did("venue-reject")
const [other] = one(
  `select v.id from public.venues v where v.slug like 'perf-venue-%' and v.id not in ('${big}', '${small}') order by v.slug limit 1`
)
const CALLERS = {
  admin: { email: "perf-admin-1@perf.nabalens.test", venue: null },
  managerBig: { email: "perf-b05-manager-big@perf.nabalens.test", venue: big },
  managerSmall: {
    email: "perf-b05-manager-small@perf.nabalens.test",
    venue: small,
  },
  granteeOn: {
    email: "perf-b05d-grantee@perf.nabalens.test",
    venue: small,
    setup: `set local session_replication_role = replica;
update public.venue_amenity_checks set status = 'active' where id = '${did("chk-small-toil")}';
set local session_replication_role = origin;`,
  },
  granteeOff: { email: "perf-b05d-grantee@perf.nabalens.test", venue: small },
  reject: {
    email: "perf-b05d-reject-manager@perf.nabalens.test",
    venue: reject,
  },
  plain: { email: "perf-b05d-plain@perf.nabalens.test", venue: big },
  inactive: { email: "perf-b05d-inactive@perf.nabalens.test", venue: small },
  revoked: { email: "perf-b05d-revoked@perf.nabalens.test", venue: small },
}
const C = CALLERS[CALLER]
if (!C && PART !== "rights") throw new Error(`unknown caller ${CALLER}`)
const who = C ? person(C.email) : null

const NOMATCH = "b05b05b0-5b05-4b05-8b05-b05b05b05b05"
const popular = (v) =>
  one(
    `select item_id from public.media_label_items where venue_id = '${v}' group by 1 order by count(*) desc, 1 limit 1`
  )[0]
const variantPair = (v) =>
  one(
    `select item_id, variant_id from public.media_label_items where venue_id = '${v}' and variant_id is not null group by 1, 2 order by count(*) desc, 1, 2 limit 1`
  )
// The venue's least-labelled variant (labels plus menu decisions).
const rareVariant = (v) =>
  one(
    `select x.v from (
       select li.variant_id as v from public.media_label_items li where li.venue_id = '${v}' and li.variant_id is not null
       union all
       select mp.variant_id from public.menu_item_photos mp where mp.venue_id = '${v}' and mp.variant_id is not null) x
     group by 1 order by count(*), 1 limit 1`
  )[0]
// The venue's least-labelled item (labels plus decisions), a menu item of the
// venue with neither (a new or never-photographed dish), an item with
// decisions and no label anywhere, and a variant of another item than pop.
const rareItem = (v) =>
  one(
    `select x.i from (
       select li.item_id as i from public.media_label_items li where li.venue_id = '${v}'
       union all
       select mp.item_id from public.menu_item_photos mp where mp.venue_id = '${v}') x
     group by 1 order by count(*), 1 limit 1`
  )[0]
const bareItem = (v) =>
  one(
    `select i.id from public.menu_items i where i.venue_id = '${v}'
       and not exists (select 1 from public.media_label_items li where li.item_id = i.id)
       and not exists (select 1 from public.menu_item_photos mp where mp.item_id = i.id)
     order by i.id limit 1`
  )[0]
const decisionOnlyItem = (v) =>
  one(
    `select mp.item_id from public.menu_item_photos mp where mp.venue_id = '${v}'
       and not exists (select 1 from public.media_label_items li where li.item_id = mp.item_id)
     group by 1 order by count(*) desc, 1 limit 1`
  )[0]
const foreignVariant = (v, item) =>
  one(
    `select variant_id from public.media_label_items where venue_id = '${v}'
       and variant_id is not null and item_id <> '${item}'
     group by 1 order by count(*) desc, 1 limit 1`
  )[0]
const accepted = (v) =>
  one(
    `select item_id from public.menu_item_photos where venue_id = '${v}' and state = 'accepted' group by 1 order by count(*) desc, 1 limit 1`
  )[0]
const rareWorld = one(
  `select li.item_id from public.media_label_items li join public.media_assets a on a.id = li.asset_id
   join public.profiles p on p.id = a.uploader_id join auth.users u on u.id = p.id
   where u.email = 'perf-b05-manager-big@perf.nabalens.test' and a.uploader_role is null group by 1 order by count(*) desc limit 1`
)[0]
const groupKey = (k) =>
  one(
    `select id from public.media_contribution_groups where client_group_key = '${k}'`
  )[0]
const [d7, d90, now0, m18, m12] = one(
  `select to_char((current_date - 7)::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          to_char((current_date - 90)::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          to_char((current_date + 1)::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          to_char((current_date - 548)::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          to_char((current_date - 365)::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
)
// A tie block's shared instant (exact, microseconds) and a row in its middle.
const tie = (venue, tag) => {
  const [at] = one(
    `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.media_assets
     where venue_id = '${venue}' group by created_at having count(*) >= 60
     order by created_at ${tag === "newest" ? "desc" : "asc"} limit 1`
  )
  const [mid] = one(
    `select id from public.media_assets where venue_id = '${venue}' and created_at = '${at}'::timestamptz order by id desc offset 30 limit 1`
  )
  return { at, mid }
}

/** Fixtures the filter matrix uses, by the venue the caller works in. */
const FIX = {
  [big]: {
    chkAmenity: did("chk-big-out"),
    chkKnowledge: did("chk-big-toil"),
    reqCoverage: did("req-big-vs"),
    reqAmenityCoverage: did("req-big-out"),
    subCoverage: did("csub-big-out"),
    subAmenity: did("asub-big-out-1"),
    subKnowledge: did("kc-big"),
    group: groupKey("perfb05-g10"),
  },
  [small]: {
    chkAmenity: did("chk-small-out"),
    chkKnowledge: did("chk-small-toil"),
    reqCoverage: did("req-small-vs"),
    reqAmenityCoverage: did("req-small-vs"),
    subCoverage: did("csub-small-grantee"),
    subAmenity: did("asub-small-out-1"),
    subKnowledge: did("kc-small"),
    group: did("group-small"),
  },
}
FIX[reject] = FIX[small]

function matrix(venue) {
  const v = venue ?? big
  const f = FIX[v]
  const pop = popular(v)
  const [vItem, vVar] = variantPair(v) ?? []
  const acc = accepted(v) ?? pop
  const oth = v === big ? small : big
  const T = tie(v, "newest")
  const T2 = tie(v, "oldest")
  const cases = [
    ["{}", {}],
    ["venue own", { venue: v }],
    ["venue other", { venue: oth }],
    ["venue third (other)", { venue: other }],
    ["venue unknown", { venue: NOMATCH }],
    ["type image", { mediaType: "image" }],
    ["type video", { mediaType: "video" }],
    ["date last 7 days", { uploadedFrom: d7, uploadedBefore: now0 }],
    ["date last 90 days", { uploadedFrom: d90 }],
    ["date 18 to 12 months", { uploadedFrom: m18, uploadedBefore: m12 }],
    ["date empty window", { uploadedFrom: d7, uploadedBefore: d90 }],
    ["date from = tie instant (inclusive)", { uploadedFrom: T2.at }],
    ["date before = tie instant (exclusive)", { uploadedBefore: T2.at }],
    ["item popular", { item: pop }],
    ["item rare (big staff-era)", { item: rareWorld }],
    ["item rare (fewest labels)", { item: rareItem(v) ?? NOMATCH }],
    ["item no labels or decisions", { item: bareItem(v) ?? NOMATCH }],
    ["item unknown", { item: NOMATCH }],
    ["item decision only", { item: decisionOnlyItem(v) ?? NOMATCH }],
    [
      "item + variant, no rows",
      { item: pop, variant: foreignVariant(v, pop) ?? NOMATCH },
    ],
    ["variant popular", { variant: vVar ?? NOMATCH }],
    ["variant rare", { variant: rareVariant(v) ?? NOMATCH }],
    ["variant unknown", { variant: NOMATCH }],
    ["item + variant", { item: vItem ?? pop, variant: vVar ?? NOMATCH }],
    ["item popular + accepted", { item: pop, menuState: "accepted" }],
    ["item accepted + accepted", { item: acc, menuState: "accepted" }],
    [
      "item + variant + accepted",
      { item: vItem ?? pop, variant: vVar ?? NOMATCH, menuState: "accepted" },
    ],
    ...[
      "accepted",
      "better_photo_requested",
      "needs_recheck",
      "withdrawn",
      "invalidated",
    ].map((s) => [`menuState ${s}`, { menuState: s }]),
    ["check amenity", { check: f.chkAmenity }],
    ["check knowledge", { check: f.chkKnowledge }],
    ["check coverage requirement", { check: f.reqCoverage }],
    ["check coverage amenity requirement", { check: f.reqAmenityCoverage }],
    ["check other venue", { check: did("chk-other-out") }],
    ["check unknown", { check: NOMATCH }],
    [
      "submission coverage",
      { submission: { source: "coverage", id: f.subCoverage } },
    ],
    [
      "submission amenity",
      { submission: { source: "amenity", id: f.subAmenity } },
    ],
    [
      "submission knowledge",
      { submission: { source: "knowledge", id: f.subKnowledge } },
    ],
    [
      "submission coverage, other venue",
      { submission: { source: "coverage", id: did("csub-other-vs") } },
    ],
    [
      "submission amenity, other venue",
      { submission: { source: "amenity", id: did("asub-other-out-1") } },
    ],
    [
      "submission knowledge, other venue",
      { submission: { source: "knowledge", id: did("kc-other") } },
    ],
    [
      "submission wrong source",
      { submission: { source: "amenity", id: f.subCoverage } },
    ],
    [
      "submission unknown",
      { submission: { source: "knowledge", id: NOMATCH } },
    ],
    ["group g3", { group: groupKey("perfb05-g3") }],
    ["group g10", { group: groupKey("perfb05-g10") }],
    ["group g30", { group: groupKey("perfb05-g30") }],
    ["group small", { group: did("group-small") }],
    ["group other venue", { group: did("group-other") }],
    ["group unknown", { group: NOMATCH }],
    ...[
      "legacy_unknown",
      "not_granted",
      "in_force",
      "expired",
      "withdrawn",
    ].map((r) => [`rights ${r}`, { rights: r }]),
    [
      "rights in_force + perf_menu_web",
      { rights: "in_force", destination: "perf_menu_web" },
    ],
    [
      "rights in_force + perf_social",
      { rights: "in_force", destination: "perf_social" },
    ],
    [
      "rights in_force + unknown destination",
      { rights: "in_force", destination: "perf_nowhere" },
    ],
    ["check + in_force", { check: f.chkAmenity, rights: "in_force" }],
    [
      "check + submission",
      {
        check: f.chkAmenity,
        submission: { source: "amenity", id: f.subAmenity },
      },
    ],
    ["group + item", { group: f.group, item: pop }],
    [
      "video + 90 days + legacy_unknown",
      { mediaType: "video", uploadedFrom: d90, rights: "legacy_unknown" },
    ],
    [
      "accepted item + accepted + in_force",
      { item: acc, menuState: "accepted", rights: "in_force" },
    ],
    ["not_granted + 7 days", { rights: "not_granted", uploadedFrom: d7 }],
    ["withdrawn + video", { rights: "withdrawn", mediaType: "video" }],
  ].map(([name, filters]) => ({ name, filters }))
  // Cursors: inside the newest tie block, on a deleted row, on a row the
  // caller may not see, past the end.
  const [delAt, delId] = one(
    `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), id from public.media_assets
     where venue_id = '${v}' and deleted_at is not null order by created_at desc, id desc offset 3 limit 1`
  )
  const [rejAt, rejId] = one(
    `select to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), a.id from public.media_assets a
     where a.venue_id = '${v}' and a.upload_state = 'ready' and a.deleted_at is null
       and not exists (select 1 from public.media_label_items li where li.asset_id = a.id)
       and not exists (select 1 from public.menu_item_photos mp where mp.asset_id = a.id)
       and not exists (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id)
     order by a.created_at desc, a.id desc offset 5 limit 1`
  )
  for (const [label, at, id] of [
    ["cursor mid tie block", T.at, T.mid],
    ["cursor on a deleted row", delAt, delId],
    ["cursor on a rejected row", rejAt, rejId],
    [
      "cursor past the end",
      "2000-01-01T00:00:00.000000Z",
      "00000000-0000-0000-0000-000000000000",
    ],
  ]) {
    if (!at) continue
    cases.push({ name: `${label}, {}`, filters: {}, at, id })
    cases.push({
      name: `${label}, legacy_unknown`,
      filters: { rights: "legacy_unknown" },
      at,
      id,
    })
    cases.push({
      name: `${label}, in_force`,
      filters: { rights: "in_force" },
      at,
      id,
    })
  }
  // p_limit edges (clamped), one page each.
  for (const limit of [0, -3, 49, 1000, null])
    cases.push({
      name: `limit ${limit}`,
      filters: {},
      limits: [limit],
      max: 2,
    })
  if (venue === null) {
    cases.push({ name: "venue big (admin)", filters: { venue: big } })
    cases.push({ name: "venue small (admin)", filters: { venue: small } })
    cases.push({ name: "venue reject (admin)", filters: { venue: reject } })
    cases.push({
      name: "venue big + withdrawn (admin)",
      filters: { venue: big, rights: "withdrawn" },
    })
  }
  return cases
}

/** The reject venue: v1 reads every row through the gate (about 85 s for
 * the whole venue), so only a few cases. */
const rejectCases = () => [
  { name: "{}", filters: {}, limits: [24] },
  { name: "type video", filters: { mediaType: "video" } },
  { name: "date last 90 days", filters: { uploadedFrom: d90 }, limits: [24] },
  { name: "check unknown", filters: { check: NOMATCH }, mode: "oracle0" },
  { name: "rights in_force", filters: { rights: "in_force" }, limits: [24] },
]

/** Deep starts for walks that hit the cap: rows at 25/50/75% of the
 * caller's raw feed (ready, undeleted, every uploader). */
function deepCursors(venue) {
  const scope = `deleted_at is null and upload_state = 'ready'${venue ? ` and venue_id = '${venue}'` : ""}`
  const n = Number(
    one(`select count(*) from public.media_assets where ${scope}`)[0]
  )
  return [0.25, 0.5, 0.75].map((q) => {
    const [at, id] = one(
      `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), id from public.media_assets where ${scope}
       order by created_at desc, id desc offset ${Math.floor(n * q)} limit 1`
    )
    return { at, id }
  })
}

// ---------------------------------------------------------------- SQL harness
const HARNESS = `
create function pg_temp.d_call(p_which text, p_filters jsonb, p_at timestamptz, p_id uuid, p_limit integer)
returns jsonb language plpgsql as $f$
declare
  v_state text; v_message text; v_detail text;
begin
  if p_which = 'new' then
    return public.asset_search(p_filters, p_at, p_id, p_limit);
  elsif p_which = 'v1' then
    return pg_temp.asset_search_v1(p_filters, p_at, p_id, p_limit);
  end if;
  return pg_temp.asset_search_oracle(p_filters, p_at, p_id, p_limit);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('error', jsonb_build_object('code', v_state, 'message', v_message, 'detail', v_detail));
end $f$;

-- One walk from (p_at, p_id): pages of the new body until hasMore is false or
-- p_max pages, each checked against v1 or the oracle (see the file header).
create function pg_temp.d_walk(p_filters jsonb, p_limit integer, p_max integer, p_at timestamptz,
  p_id uuid, p_mode text, p_slow numeric)
returns jsonb language plpgsql as $f$
declare
  v_at timestamptz := p_at; v_id uuid := p_id;
  v_mode text := p_mode; v_eff integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_new jsonb; v_old jsonb; v_or jsonb; v_want jsonb; v_got jsonb;
  v_t timestamptz; v_ms numeric;
  v_pages integer := 0; v_rows integer := 0; v_pos integer := 0; v_v1_pages integer := 0; v_or_pages integer := 0;
  v_new_ms numeric := 0; v_v1_ms numeric := 0; v_v1_first numeric; v_or_ms numeric := 0;
  v_bad jsonb; v_err jsonb; v_capped boolean := false; v_switched boolean := false;
begin
  loop
    v_t := clock_timestamp();
    v_new := pg_temp.d_call('new', p_filters, v_at, v_id, p_limit);
    v_new_ms := v_new_ms + extract(epoch from clock_timestamp() - v_t) * 1000;
    v_pages := v_pages + 1;
    if v_mode = 'v1' or (v_mode = 'oracle1' and v_pages = 1) then
      v_t := clock_timestamp();
      v_old := pg_temp.d_call('v1', p_filters, v_at, v_id, p_limit);
      v_ms := extract(epoch from clock_timestamp() - v_t) * 1000;
      v_v1_ms := v_v1_ms + v_ms; v_v1_pages := v_v1_pages + 1;
      v_v1_first := coalesce(v_v1_first, v_ms);
      if v_new::text is distinct from v_old::text then
        v_bad := jsonb_build_object('against', 'v1', 'page', v_pages, 'at', v_at, 'id', v_id,
          'new', left(v_new::text, 1500), 'old', left(v_old::text, 1500));
        exit;
      end if;
      if v_mode = 'oracle1' or v_ms > p_slow then
        v_switched := v_mode = 'v1';
        v_mode := 'oracle';
      end if;
    else
      if v_or is null then
        v_t := clock_timestamp();
        v_or := pg_temp.d_call('oracle', p_filters, p_at, p_id, p_max * v_eff + 1);
        v_or_ms := extract(epoch from clock_timestamp() - v_t) * 1000;
      end if;
      if v_or ? 'error' or v_new ? 'error' then
        v_bad := jsonb_build_object('against', 'oracle', 'page', v_pages, 'at', v_at, 'id', v_id,
          'new', left(v_new::text, 1500), 'oracle', left(v_or::text, 1500));
        exit;
      end if;
      v_want := (select coalesce(jsonb_agg(e order by o), '[]') from jsonb_array_elements(v_or) with ordinality t(e, o)
                 where o > v_pos and o <= v_pos + v_eff);
      v_got := (select coalesce(jsonb_agg(x -> 'id' order by o), '[]') from jsonb_array_elements(v_new -> 'items') with ordinality t(x, o));
      if v_got is distinct from v_want
         or (v_new ->> 'hasMore')::boolean is distinct from (jsonb_array_length(v_or) > v_pos + v_eff) then
        v_bad := jsonb_build_object('against', 'oracle', 'page', v_pages, 'at', v_at, 'id', v_id,
          'got', v_got, 'want', v_want, 'hasMore', v_new -> 'hasMore', 'oracleRows', jsonb_array_length(v_or));
        exit;
      end if;
      v_or_pages := v_or_pages + 1;
    end if;
    if v_new ? 'error' then
      v_err := v_new -> 'error';
      exit;
    end if;
    v_rows := v_rows + jsonb_array_length(v_new -> 'items');
    v_pos := v_pos + jsonb_array_length(v_new -> 'items');
    exit when not (v_new ->> 'hasMore')::boolean;
    if v_pages >= p_max then
      v_capped := true;
      exit;
    end if;
    v_at := (v_new -> 'items' -> -1 ->> 'uploadedAt')::timestamptz;
    v_id := (v_new -> 'items' -> -1 ->> 'id')::uuid;
  end loop;
  return jsonb_strip_nulls(jsonb_build_object('pages', v_pages, 'rows', v_rows, 'v1Pages', v_v1_pages,
    'oraclePages', v_or_pages, 'capped', v_capped, 'switched', v_switched, 'error', v_err,
    'newMs', round(v_new_ms, 1), 'v1Ms', round(v_v1_ms, 1), 'v1FirstMs', round(v_v1_first, 1),
    'oracleMs', round(v_or_ms, 1), 'bad', v_bad));
end $f$;

-- One case at one limit, plus 2 pages from each deep cursor when the walk
-- hit the cap.
create function pg_temp.d_case(c jsonb, p_deep jsonb, p_slow numeric)
returns jsonb language plpgsql as $f$
declare
  v_main jsonb; v_deep jsonb := '[]'; v_d jsonb; v_r jsonb;
  v_f jsonb := nullif(c -> 'filters', 'null'::jsonb);
begin
  v_main := pg_temp.d_walk(v_f, (c ->> 'limit')::integer, (c ->> 'max')::integer,
    (c ->> 'at')::timestamptz, (c ->> 'id')::uuid, c ->> 'mode', p_slow);
  if (v_main ->> 'capped')::boolean and v_main -> 'bad' is null then
    for v_d in select * from jsonb_array_elements(p_deep) loop
      v_r := pg_temp.d_walk(v_f, (c ->> 'limit')::integer, 2,
        (v_d ->> 'at')::timestamptz, (v_d ->> 'id')::uuid, c ->> 'mode', p_slow);
      v_deep := v_deep || jsonb_build_array(v_r);
    end loop;
  end if;
  return jsonb_build_object('name', c ->> 'name', 'limit', c -> 'limit', 'mode', c ->> 'mode',
    'main', v_main, 'deep', v_deep);
end $f$;
grant execute on all functions in schema pg_temp to authenticated;
`

const claims = (id) =>
  `select set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated","aud":"authenticated"}', true) is null;`

function runScript(body) {
  const out = psql(env.dbUrl, ["-At"], {
    input: `begin;
set local statement_timeout = 0;
${REFERENCE};
${ORACLE};
${HARNESS}
${body}
rollback;
`,
  })
  return out
    .split("\n")
    .filter((l) => l.startsWith("R|"))
    .map((l) => JSON.parse(l.slice(2)))
}

// Provenance of every record: the installed public.asset_search (md5 of its
// source and of its whole definition, SET clause included) and the sha256 of
// the reference text created as pg_temp.asset_search_v1.
const [installedSrc, installedDef, installedConfig] = one(
  `select md5(p.prosrc), md5(pg_get_functiondef(p.oid)), array_to_string(p.proconfig, ',')
   from pg_proc p where p.oid = 'public.asset_search(jsonb,timestamptz,uuid,integer)'::regprocedure`
)
const doc = {
  part: PART,
  caller: CALLER,
  at: new Date().toISOString(),
  revision: gitHead(),
  installed: {
    assetSearchProsrcMd5: installedSrc,
    assetSearchFunctiondefMd5: installedDef,
    assetSearchConfig: installedConfig,
  },
  reference: {
    sha256: createHash("sha256").update(REFERENCE).digest("hex"),
  },
  base: BASE ?? `fixture ${FIXTURE}`,
  loadAverage: { start: loadavg() },
}
const t0 = Date.now()
const write = (extra) => {
  mkdirSync(OUT, { recursive: true })
  doc.loadAverage.end = loadavg()
  doc.seconds = Math.round((Date.now() - t0) / 100) / 10
  appendFileSync(
    join(OUT, "b05-diff.jsonl"),
    JSON.stringify({ ...doc, ...extra }) + "\n"
  )
}

// ---------------------------------------------------------------- parts
if (PART === "list" || PART === "compare") {
  const raw = CALLER === "reject" ? rejectCases() : matrix(C.venue)
  const expanded = raw
    .flatMap((c) =>
      (c.limits ?? [1, 24, 48]).map((limit) => ({
        name: c.name,
        filters: c.filters,
        limit,
        max: c.max ?? CAP,
        at: c.at ?? null,
        id: c.id ?? null,
        mode:
          c.mode ??
          (CALLER === "managerBig" && c.filters.check ? "oracle0" : "v1"),
      }))
    )
    .filter((c) => !ONLY || ONLY.split("|").some((o) => c.name.includes(o)))
  const [a, b] = SLICE ? SLICE.split(":").map(Number) : [0, expanded.length]
  const cases = expanded.slice(a, b)
  if (PART === "list") {
    expanded.forEach((c, i) =>
      console.log(`${i} ${c.name} limit ${c.limit} ${c.mode}`)
    )
    process.exit(0)
  }
  const deep = deepCursors(C.venue)
  const results = []
  // Batches of 12 walks, one rolled-back transaction each.
  for (let i = 0; i < cases.length; i += 12) {
    const batch = cases.slice(i, i + 12)
    const r = runScript(`${C.setup ?? ""}
${claims(who.id)}
set local role authenticated;
select 'R|' || pg_temp.d_case(c, $deep$${JSON.stringify(deep)}$deep$::jsonb, ${SLOW})::text
from jsonb_array_elements($cases$${JSON.stringify(batch)}$cases$::jsonb) c;`)
    for (const x of r) {
      results.push(x)
      const bad = [x.main, ...x.deep].filter((w) => w.bad)
      console.error(
        `${CALLER} ${x.name.padEnd(42)} l=${String(x.limit).padEnd(4)} ${x.mode.padEnd(7)} pages ${x.main.pages}${x.deep.length ? `+${x.deep.length}x2` : ""} rows ${x.main.rows}${x.main.error ? ` err ${x.main.error.code}` : ""} v1 ${x.main.v1Pages} or ${x.main.oraclePages} new ${x.main.newMs}ms v1first ${x.main.v1FirstMs ?? "-"}ms${bad.length ? "  MISMATCH" : ""}`
      )
    }
  }
  const walks = results.flatMap((x) => [x.main, ...x.deep])
  const mismatches = results.flatMap((x) =>
    [x.main, ...x.deep]
      .filter((w) => w.bad)
      .map((w) => ({ name: x.name, limit: x.limit, mode: x.mode, bad: w.bad }))
  )
  const summary = {
    slice: SLICE,
    only: ONLY,
    cases: results.length,
    walks: walks.length,
    pages: walks.reduce((s, w) => s + w.pages, 0),
    rows: walks.reduce((s, w) => s + w.rows, 0),
    v1Pages: walks.reduce((s, w) => s + w.v1Pages, 0),
    oraclePages: walks.reduce((s, w) => s + w.oraclePages, 0),
    errorWalks: walks.filter((w) => w.error).length,
    capped: walks.filter((w) => w.capped).length,
    switchedToOracle: walks.filter((w) => w.switched).length,
    mismatches: mismatches.length,
  }
  console.error(JSON.stringify(summary))
  write({ summary, mismatches, results })
  if (mismatches.length) {
    console.error(JSON.stringify(mismatches, null, 2).slice(0, 4000))
    process.exit(3)
  }
}

if (PART === "errors") {
  const v = C.venue ?? big
  const oth = v === big ? small : big
  const at = "2026-01-01T00:00:00Z"
  const E = [
    ["unknown key + half cursor", { bogus: 1 }, at, null],
    ["filters an array + half cursor", [], null, NOMATCH],
    ["filters a string", "x", null, null],
    ["filters null", null, null, null],
    [
      "bad venue uuid + bad rights",
      { venue: "nope", rights: "nope" },
      null,
      null,
    ],
    [
      "other venue + bad destination",
      { venue: oth, rights: "in_force", destination: "BAD DEST" },
      null,
      null,
    ],
    [
      "unknown venue + bad media type",
      { venue: NOMATCH, mediaType: "gif" },
      null,
      null,
    ],
    ["unknown venue alone", { venue: NOMATCH }, null, null],
    [
      "destination without in_force",
      { destination: "perf_menu_web" },
      null,
      null,
    ],
    [
      "destination with withdrawn",
      { rights: "withdrawn", destination: "perf_menu_web" },
      null,
      null,
    ],
    [
      "destination not a string",
      { rights: "in_force", destination: 5 },
      null,
      null,
    ],
    ["submission not an object", { submission: "x" }, null, null],
    [
      "submission missing id",
      { submission: { source: "coverage" } },
      null,
      null,
    ],
    [
      "submission extra key",
      { submission: { source: "coverage", id: NOMATCH, x: 1 } },
      null,
      null,
    ],
    [
      "submission bad source + bad id",
      { submission: { source: "bogus", id: "bad" } },
      null,
      null,
    ],
    [
      "bad instant + other venue",
      { uploadedFrom: "2026-13-45T00:00:00Z", venue: oth },
      null,
      null,
    ],
    [
      "instant without zone",
      { uploadedBefore: "2026-01-01T00:00:00" },
      null,
      null,
    ],
    [
      "impossible instant",
      { uploadedFrom: "2026-02-30T00:00:00Z" },
      null,
      null,
    ],
    [
      "unknown check + bad media type",
      { check: NOMATCH, mediaType: "gif" },
      null,
      null,
    ],
    ["unknown check + half cursor", { check: NOMATCH }, null, NOMATCH],
    ["unknown group + other venue", { group: NOMATCH, venue: oth }, null, null],
    [
      "bad menuState + bad item",
      { menuState: "bogus", item: "bad" },
      null,
      null,
    ],
    ["item a number", { item: 5 }, null, null],
    [
      "unknown submission + bad rights",
      { submission: { source: "coverage", id: NOMATCH }, rights: "all" },
      null,
      null,
    ],
  ]
  const cases = E.map(([name, filters, a, id]) => ({
    name,
    filters,
    at: a,
    id,
    limit: 24,
    max: 1,
    mode: "v1",
  }))
  let body = `${C.setup ?? ""}
${claims(who.id)}
set local role authenticated;
select 'R|' || pg_temp.d_case(c, '[]'::jsonb, 1e9)::text from jsonb_array_elements($cases$${JSON.stringify(cases)}$cases$::jsonb) c;`
  // A grant revoked mid-session: the same calls after the grant row ends.
  if (CALLER === "granteeOff") {
    body += `
reset role;
set local session_replication_role = replica;
update public.venue_manager_grants set revoked_at = now(), revoked_by = '${person("perf-admin-1@perf.nabalens.test").id}',
  revoke_kind = 'revoked', revoke_reason = 'PERF: revoked mid-session' where staff_id = '${who.id}' and revoked_at is null;
set local session_replication_role = origin;
set local role authenticated;
select 'R|' || pg_temp.d_case(jsonb_set(c, '{name}', to_jsonb('after revoke: ' || (c ->> 'name'))), '[]'::jsonb, 1e9)::text
from jsonb_array_elements($cases$${JSON.stringify([...cases.slice(0, 4), { name: "{}", filters: {}, at: null, id: null, limit: 24, max: 1, mode: "v1" }, { name: "check unknown", filters: { check: NOMATCH }, at: null, id: null, limit: 24, max: 1, mode: "v1" }])}$cases$::jsonb) c;`
  }
  const r = runScript(body)
  const rows = r.map((x) => ({
    name: x.name,
    error: x.main.error ?? null,
    rows: x.main.rows,
    bad: x.main.bad ?? null,
  }))
  for (const x of rows)
    console.error(
      `${CALLER} ${x.name.padEnd(40)} ${x.error ? `${x.error.code} ${x.error.message} ${x.error.detail ?? ""}` : `ok rows ${x.rows}`}${x.bad ? "  MISMATCH" : ""}`
    )
  const mismatches = rows.filter((x) => x.bad)
  const summary = {
    cases: rows.length,
    errored: rows.filter((x) => x.error).length,
    mismatches: mismatches.length,
  }
  console.error(JSON.stringify(summary))
  write({ summary, mismatches, results: rows })
  if (mismatches.length) process.exit(3)
}

if (PART === "invariants") {
  if (!C.venue && CALLER !== "admin") throw new Error("no venue")
  const subst = (s) =>
    s
      .replaceAll("v_admin", "false")
      .replaceAll("v_is_manager", "k.is_manager")
      .replaceAll("v_uid", "k.uid")
      .replaceAll("v_has_active_check", "k.active_check")
      .replaceAll("v_can_review", "k.can_review")
  const out = {}
  if (CALLER !== "admin" && ONLY !== "e2") {
    // E1: admits(a, false, M) implies P(a), P as shipped (cut from the migration).
    const [e1] = runScript(`${C.setup ?? ""}
${claims(who.id)}
select 'R|' || jsonb_build_object(
    'assets', count(*), 'admitted', count(*) filter (where admitted),
    'p', count(*) filter (where p), 'violations', count(*) filter (where admitted and not p),
    'pNotAdmitted', count(*) filter (where p and not admitted),
    'admittedVia', jsonb_build_object(
      'ownManagerEra', count(*) filter (where admitted and own_mgr),
      'ownWithActiveCheck', count(*) filter (where admitted and own_check),
      'labelItems', count(*) filter (where admitted and t_label),
      'menuItemPhotos', count(*) filter (where admitted and t_mip),
      'foodUnlabelled', count(*) filter (where admitted and t_food and not t_label and not t_mip),
      'coverageItems', count(*) filter (where admitted and t_cov),
      'factMedia', count(*) filter (where admitted and t_fact),
      'amenitySubmissions', count(*) filter (where admitted and t_amen),
      'knowledge', count(*) filter (where admitted and t_know),
      'onlyEvidence', count(*) filter (where admitted and not t_label and not t_mip and not t_food and not own_mgr and not own_check)),
    'vetoedWithEvidenceOrLabel', count(*) filter (where vetoed and (t_label or t_cov or t_amen)),
    'constants', (array_agg(kj))[1])::text
from (
  with k as (
    select (select auth.uid()) as uid, private.is_active_manager() as is_manager,
      private.menu_photo_can_review_unlabelled() as can_review,
      exists (select 1 from public.venue_amenity_checks c
        where c.venue_id = '${C.venue}' and c.status = 'active') as active_check)
  select to_jsonb(k) as kj, private.asset_search_admits(a, false, '${C.venue}') as admitted,
    coalesce(${subst(P_EXPR)}, false) as p,
    (k.is_manager and a.uploader_id = k.uid and a.uploader_role is distinct from 'manager') as vetoed,
    (a.uploader_id = k.uid and a.uploader_role = 'manager') as own_mgr,
    (a.uploader_id = k.uid and a.uploader_role is distinct from 'manager' and k.active_check) as own_check,
    exists (select 1 from public.media_label_items li where li.asset_id = a.id) as t_label,
    exists (select 1 from public.menu_item_photos mp where mp.asset_id = a.id) as t_mip,
    (k.can_review and a.media_type = 'image' and exists (select 1 from public.media_labels ml where ml.asset_id = a.id
       and ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[])) as t_food,
    exists (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id) as t_cov,
    exists (select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id) as t_fact,
    exists (select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id) as t_amen,
    exists (select 1 from public.knowledge_contribution_assets ka where ka.asset_id = a.id) as t_know
  from public.media_assets a, k
  where a.venue_id = '${C.venue}'
) x;`)
    out.admitsImpliesP = e1
    console.error(`${CALLER} E1 ${JSON.stringify(e1)}`)
  }
  // E2: can_open equals membership in the union of unfiltered search pages
  // (as the caller), over every asset in scope.
  // The admin's unfiltered walk is 6,000+ pages; it is checked on the small
  // venue (venue filter) instead.
  const scopeVenue = C.venue ?? small
  const scope = `a.venue_id = '${scopeVenue}'`
  const walkFilters = C.venue ? "{}" : `{"venue":"${small}"}`
  const [e2] =
    ONLY === "e1"
      ? []
      : runScript(`${C.setup ?? ""}
${claims(who.id)}
create function pg_temp.d_all() returns uuid[] language plpgsql as $f$
declare v_page jsonb; v_ids uuid[] := '{}'; v_at timestamptz; v_id uuid;
begin
  loop
    v_page := public.asset_search('${walkFilters}', v_at, v_id, 48);
    v_ids := v_ids || array(select (x ->> 'id')::uuid from jsonb_array_elements(v_page -> 'items') x);
    exit when not (v_page ->> 'hasMore')::boolean;
    v_at := (v_page -> 'items' -> -1 ->> 'uploadedAt')::timestamptz;
    v_id := (v_page -> 'items' -> -1 ->> 'id')::uuid;
  end loop;
  return v_ids;
end $f$;
grant execute on function pg_temp.d_all() to authenticated;
create temp table d_listed on commit drop as select unnest(pg_temp.d_all()) as id;
create temp table d_scope on commit drop as (select a.id from public.media_assets a where ${scope}
  ${SAMPLE ? `order by hashtextextended(a.id::text, 1) limit ${SAMPLE}` : ""})
  union select id from d_listed;
grant select on d_listed, d_scope to authenticated;
set local role authenticated;
select 'R|' || jsonb_build_object(
  'scope', (select count(*) from d_scope),
  'listed', (select count(*) from d_listed),
  'listedDistinct', (select count(distinct id) from d_listed),
  'canOpen', count(*) filter (where o),
  'onlySearch', count(*) filter (where l and not o),
  'onlyCanOpen', count(*) filter (where o and not l))::text
from (select s.id, public.asset_search_can_open(s.id) as o,
        exists (select 1 from d_listed d where d.id = s.id) as l from d_scope s) x;`)
  out.canOpen = e2
  console.error(`${CALLER} E2 ${JSON.stringify(e2)}`)
  // Pins: the gate, the caller rule, can_open and the mirrored helpers equal
  // the base (values pinned in tests/security/asset-search.test.ts).
  const test = readFileSync("tests/security/asset-search.test.ts", "utf8")
  const pins = [
    ...test.matchAll(
      /"((?:public|private)\.[a-z_]+\([^"]*\))":\s*"([0-9a-f]{32})"/g
    ),
  ].map((m) => [m[1], m[2]])
  out.pins = pins.map(([fn, want]) => {
    const got = one(`select md5(pg_get_functiondef('${fn}'::regprocedure))`)[0]
    return { fn, want, got, equal: got === want }
  })
  console.error(
    `${CALLER} pins ${out.pins.filter((p) => p.equal).length}/${out.pins.length} equal`
  )
  const bad =
    (out.admitsImpliesP?.violations ?? 0) +
    (out.canOpen?.onlySearch ?? 0) +
    (out.canOpen?.onlyCanOpen ?? 0) +
    out.pins.filter((p) => !p.equal).length
  write({ summary: { violations: bad }, ...out })
  if (bad) process.exit(3)
}

if (PART === "rights") {
  // E3: v1's rights expression equals the new split (SQL part and per-row
  // part) for every asset, rights value and destination; and the SQL part
  // alone is already exact (sqlOnlyDiffer), so no row a grant settles is
  // left to the per-row check.
  const subst = (s) =>
    s
      .replaceAll("v_rights", "rv.rights")
      .replaceAll("v_destination", "rv.dest")
      .replaceAll("v_now", "k.now")
      .replaceAll("v_row.id", "a.id")
  const [r] = runScript(`
select 'R|' || jsonb_agg(jsonb_build_object('rights', rights, 'destination', dest, 'v1', v1, 'split', split, 'differ', differ,
    'sqlOnly', sql_only, 'sqlOnlyDiffer', sql_only_differ)
  order by rights, dest)::text
from (
  select rv.rights, rv.dest, count(*) filter (where r1) as v1, count(*) filter (where rs and rl) as split,
    count(*) filter (where r1 is distinct from (rs and rl)) as differ,
    count(*) filter (where rs) as sql_only,
    count(*) filter (where r1 is distinct from rs) as sql_only_differ
  from public.media_assets a
  cross join (values ('legacy_unknown', null), ('not_granted', null), ('in_force', null),
    ('in_force', 'perf_menu_web'), ('in_force', 'perf_social'), ('in_force', 'perf_nowhere'),
    ('expired', null), ('withdrawn', null)) rv(rights, dest)
  cross join (select now() as now) k
  cross join lateral (select ${subst(RV1)} as r1, ${subst(RSQL)} as rs, ${subst(RLOOP)} as rl) e
  group by 1, 2
) x;`)
  for (const x of r) console.error(`rights ${JSON.stringify(x)}`)
  const differ = r.reduce((s, x) => s + Number(x.differ), 0)
  const sqlOnlyDiffer = r.reduce((s, x) => s + Number(x.sqlOnlyDiffer), 0)
  write({ summary: { differ, sqlOnlyDiffer }, results: r })
  if (differ || sqlOnlyDiffer) process.exit(3)
}
