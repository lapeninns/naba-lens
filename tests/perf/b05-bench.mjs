// B05 paths, measured through the app's own server code against the local
// workstream stack (PERF_STACK, default spare6), as signed-in PERF people, so
// PostgREST, RLS and the API statement timeout apply as in production (the
// same-call-shape rule of docs/perf/after.md: every function is called the way
// the app calls it, never with literals).
//
// Needs a generated volume plus tests/perf/b05-world.sql:
//   source /tmp/nabalens-ws/<stack>/env.sh
//   node tests/perf/generate.mjs --volume high
//   psql "$SUPABASE_DB_URL" -v seed=0.42 -f tests/perf/b05-world.sql
//   node --conditions=react-server --import tsx tests/perf/b05-bench.mjs \
//     --part ab|new --volume high [--n 20] [--warm 3] [--out docs/perf/raw]
//
// --part ab: paths B05 changed that exist before B05 too (feeds with the use
//   key, contribution_groups_for_assets, the group read, contribution_group_add
//   at 9 to 10, the thumbnail route's authorisation and signing, a manager's
//   portfolio). Runs on a pre-B05 tree as well: run this file by absolute path
//   with the pre-B05 worktree as the working directory, so the app code under
//   test is that tree's.
// --part new: B05-only paths (asset search, the 30-position group read,
//   contribution_group_add at 29 to 30, contribution_group_replace). With
//   tests/perf/b05-diff-world.sql loaded as well, also the check and
//   submission filters on real evidence and the constructed worst cases of
//   the B05 perf fix: a manager venue where nothing is visible (73,600
//   assets) and a staff grantee with 500 own unlabelled uploads and no
//   active check. With tests/perf/b05-postlaunch-world.sql loaded too, group
//   search-postlaunch: every rights value where grants settle most rows (a
//   consent drive, renewals, lapsed grants) for the admin and both managers,
//   and another venue's check, submission and group against unknown ids.
// --part explain: EXPLAIN (ANALYZE, BUFFERS) of the chunk statement
//   asset_search runs (cut from the migration, values substituted) and of
//   whole calls; --v1-inner adds the pre-fix row query (search-inner-*).
// Writes consume PERF fixture groups and fresh PERF uploads of
// perf-b05-creator (23 per case); nothing else is changed.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { makeActor, signIn, timeIt } from "./actors.mjs"
import {
  gitHead,
  psql,
  query,
  requireWorkstreamStack,
  summarise,
} from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const PART = arg("part", "ab")
if (!["ab", "new", "explain"].includes(PART))
  throw new Error("--part ab|new|explain")
const VOLUME = arg("volume", "high")
const N = Number(arg("n", 20))
const WARM = Number(arg("warm", 3))
const only = arg("only", null)
const TAG = arg("tag", null)
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const V1_INNER = argv.includes("--v1-inner")

const env = requireWorkstreamStack()
const lib = (p) => import(pathToFileURL(resolve(p)).href)
// reads.ts and groups.ts, not the index: the index re-exports the request
// context (next/navigation), which does not load outside Next.
const knowledge = {
  ...(await lib("lib/server/knowledge/reads.ts")),
  ...(await lib("lib/server/knowledge/groups.ts")),
}
const access = await lib("lib/server/media/access.ts")
const search =
  PART === "new" ? await lib("lib/server/media/search/search.ts") : null

const one = (sql) => query(env.dbUrl, sql)[0] ?? []
const onB05 =
  one(`select to_regclass('public.media_asset_links') is not null`)[0] === "t"
if (PART !== "ab" && !onB05)
  throw new Error(`--part ${PART} needs the B05 schema`)
if (
  one(`select count(*) from auth.users where email like 'perf-b05-%'`)[0] !==
  "4"
)
  throw new Error("Load tests/perf/b05-world.sql first.")

const loadStart = loadavg()
// Which public.asset_search is installed (the bench measures the database,
// not the tree): md5 of its source and of its whole definition (the SET
// clause included), and its settings.
const installed = !onB05
  ? { config: [] }
  : (() => {
      const [src, def, config] = one(
        `select md5(p.prosrc), md5(pg_get_functiondef(p.oid)), array_to_json(coalesce(p.proconfig, '{}'))
     from pg_proc p where p.oid = 'public.asset_search(jsonb,timestamptz,uuid,integer)'::regprocedure`
      )
      return {
        assetSearchProsrcMd5: src,
        assetSearchFunctiondefMd5: def,
        config: JSON.parse(config),
      }
    })()
const t = pickTargets(env.dbUrl)
const person = (key) => {
  const [id, venueId, role, displayName] = one(
    `select p.id, p.venue_id, p.role, p.display_name from public.profiles p join auth.users u on u.id = p.id
     where u.email = 'perf-b05-${key}@perf.nabalens.test'`
  )
  return {
    id,
    venueId,
    role,
    displayName,
    email: `perf-b05-${key}@perf.nabalens.test`,
  }
}
// Fixed rows of tests/perf/b05-diff-world.sql: md5('perfb05d:<key>')::uuid.
const did = (k) => {
  const h = createHash("md5").update(`perfb05d:${k}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const diffWorld =
  one(
    `select count(*) from public.venues where id = '${did("venue-reject")}'`
  )[0] === "1"
// tests/perf/b05-postlaunch-world.sql (grant keys perfb05p*) loaded on top.
const postLaunch =
  diffWorld &&
  one(
    `select exists (select 1 from public.media_use_grants where request_key = 'perfb05p0000000001')`
  )[0] === "t"
// tests/perf/b05-coverage-world.sql (rows md5('perfb05c:<key>')::uuid) loaded
// on top: coverage evidence at a production-like volume at the big venue.
const cid = (k) => {
  const h = createHash("md5").update(`perfb05c:${k}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const coverageWorld =
  diffWorld &&
  one(
    `select exists (select 1 from public.coverage_submissions where id = '${cid("csub-0001")}')`
  )[0] === "t"
const personD = (key) => {
  const [id, venueId, role, displayName] = one(
    `select p.id, p.venue_id, p.role, p.display_name from public.profiles p join auth.users u on u.id = p.id
     where u.email = 'perf-b05d-${key}@perf.nabalens.test'`
  )
  return {
    id,
    venueId,
    role,
    displayName,
    email: `perf-b05d-${key}@perf.nabalens.test`,
  }
}
const P = {
  admin: t.admin,
  heavy: t.staffHeavy,
  median: t.staffMedian,
  managerBig: person("manager-big"),
  managerSmall: person("manager-small"),
  creator: person("creator"),
  colleague: person("colleague"),
  ...(diffWorld
    ? { grantee: personD("grantee"), rejectManager: personD("reject-manager") }
    : {}),
}
const sessions = {}
const actors = {}
async function actorFor(key) {
  const p = P[key]
  sessions[p.email] ??= await signIn(env, p.email)
  actors[key] ??= makeActor(env, sessions[p.email], p)
  return actors[key]
}

const results = []
function record(name, group, rows, extra = {}) {
  const failed = rows.filter((r) => r.result?.ok === false || r.result?.threw)
  const errs = new Map()
  for (const r of rows) {
    const k = r.result?.threw
      ? `threw ${r.result.threw}`
      : r.result?.ok === false
        ? `${r.result.status ?? ""} ${r.result.code ?? ""} ${r.result.message ?? ""}`
        : null
    if (k) errs.set(k.slice(0, 200), (errs.get(k.slice(0, 200)) ?? 0) + 1)
    for (const e of r.errors ?? []) {
      const m = `${e.status} ${e.path} ${e.body ?? ""}`.slice(0, 200)
      errs.set(m, (errs.get(m) ?? 0) + 1)
    }
  }
  const med = (f) => {
    const v = rows.map(f).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  const ok = rows.find((r) => r.result?.ok !== false && !r.result?.threw)
  const entry = {
    name,
    group,
    volume: VOLUME,
    wallMs: summarise(rows.map((r) => r.ms)),
    requestsP50: med((r) => r.requests ?? 0),
    requestMsP50: Math.round(med((r) => r.requestMs ?? 0) * 10) / 10,
    rows: ok?.result?.rows ?? null,
    failures: failed.length,
    errors: [...errs].map(([message, count]) => ({ message, count })),
    ...extra,
  }
  results.push(entry)
  console.error(
    `${group.padEnd(14)} ${name.padEnd(58)} p50 ${String(entry.wallMs.p50).padStart(8)} p95 ${String(entry.wallMs.p95).padStart(8)} ms  req ${entry.requestsP50}  rows ${entry.rows}  fail ${entry.failures}`
  )
}

async function measure(name, group, actor, fn, extra = {}, opts = {}) {
  if (only && !`${group}:${name}`.includes(only)) return
  const first = await timeIt(fn, { warm: 0, n: 1, log: actor.log })
  const slow = first[0].ms > 3000
  const rows = await timeIt(fn, {
    warm: opts.warm ?? (slow ? 1 : WARM),
    n: opts.n ?? (slow ? Math.min(N, 8) : N),
    log: actor.log,
  })
  record(name, group, rows, {
    sampled: rows.length,
    firstMs: Math.round(first[0].ms * 10) / 10,
    ...extra,
  })
}

/** Writes: no probe call, each iteration consumes one prepared input. */
async function measureWrites(name, group, actor, inputs, fn, extra = {}) {
  if (only && !`${group}:${name}`.includes(only)) return
  if (inputs.length < WARM + N) {
    console.error(
      `${group} ${name}: only ${inputs.length} fixtures left, skipped`
    )
    results.push({
      name,
      group,
      skipped: `only ${inputs.length} fixtures left`,
    })
    return
  }
  let i = 0
  const rows = await timeIt(() => fn(inputs[i++]), {
    warm: WARM,
    n: N,
    log: actor.log,
  })
  record(name, group, rows, { sampled: rows.length, ...extra })
}

const ids = (sql) => query(env.dbUrl, sql).map(([id]) => id)
const READY = "upload_state = 'ready' and deleted_at is null"
const groupId = (key) =>
  one(
    `select id from public.media_contribution_groups where client_group_key = '${key}'`
  )[0]

/** Fresh own uploads of the creator in no group, newest first. */
const freshAssets = () =>
  ids(`select a.id from public.media_assets a
       where a.uploader_id = '${P.creator.id}' and a.${READY}
         and a.original_filename like 'PERFB05_FRESH_%'
         and not exists (select 1 from public.media_contribution_group_members m where m.asset_id = a.id)
       order by a.created_at, a.id`)
/** Write fixtures still in their prepared state (member count unchanged). */
const writeGroups = (kind, members) =>
  query(
    env.dbUrl,
    `select g.id, (select m.asset_id from public.media_contribution_group_members m
                   join public.media_assets a on a.id = m.asset_id
                   where m.group_id = g.id and m.position = ${kind === "rep29" ? 20 : 9}) as failed
     from public.media_contribution_groups g
     where g.client_group_key like 'perfb05-${kind}-%'
       and (select count(*) from public.media_contribution_group_members m where m.group_id = g.id) = ${members}
     order by g.client_group_key`
  ).map(([id, failed]) => ({ groupId: id, failed }))

// Storage objects for the thumbnails the access cases sign (removed at the end).
const service = createClient(env.apiUrl, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const bucket = service.storage.from("media")
const uploaded = []
async function ensureThumb(assetId) {
  const [path] = one(
    `select thumbnail_path from public.media_assets where id = '${assetId}'`
  )
  if (!path) throw new Error(`no thumbnail path for ${assetId}`)
  const { error } = await bucket.upload(path, new Uint8Array(64), {
    contentType: "image/webp",
    upsert: true,
  })
  if (error) throw new Error(`upload ${error.message}`)
  uploaded.push(path)
}

const ok = (r, rows) => (r.ok ? { ok: true, rows } : r)
const facts = {}

try {
  if (PART === "ab") {
    // ---------------------------------------------------------- feeds (S6 use key)
    const feed = async (key, label, pages = 1) => {
      const a = await actorFor(key)
      let cursor = null
      for (let p = 1; p < pages; p++) {
        const r = await knowledge.listMyContributions(a.actor, { cursor })
        if (!r.ok || !r.page.nextCursor)
          throw new Error(
            `feed walk ${label}: ${JSON.stringify(r).slice(0, 200)}`
          )
        cursor = r.page.nextCursor
      }
      await measure(
        `my contributions, ${label}${pages > 1 ? `, page ${pages}` : ""}`,
        "feed",
        a,
        async () => {
          const r = await knowledge.listMyContributions(a.actor, { cursor })
          return ok(r, r.ok ? r.page.items.length : 0)
        }
      )
    }
    await feed("heavy", `staff heaviest (${t.staffHeavy.media} assets)`)
    await feed("heavy", "staff heaviest", 5)
    await feed("median", `staff median (${t.staffMedian.media} assets)`)
    await feed("managerBig", "manager (big venue)")
    await feed("creator", "group creator")

    // ---------------------------------------------------------- contribution_groups_for_assets
    const heavyFeedPhotos = ids(
      `select id from public.media_assets where uploader_id = '${t.staffHeavy.id}' and purpose = 'general' and deleted_at is null order by created_at desc, id desc limit 20`
    )
    const heavy100 = ids(
      `select id from public.media_assets where uploader_id = '${t.staffHeavy.id}' and ${READY} order by created_at desc, id desc limit 100`
    )
    const bigVenue100 = ids(
      `select id from public.media_assets where venue_id = '${P.managerBig.venueId}' and ${READY} order by created_at desc, id desc limit 100`
    )
    const groupsFor = (key, label, assetIds) => async () => {
      const a = await actorFor(key)
      await measure(
        `groups for assets, ${label} (${assetIds.length} ids)`,
        "groups-lookup",
        a,
        async () => {
          const r = await knowledge.listGroupsForAssets(a.actor, { assetIds })
          return ok(r, r.ok ? r.groups.length : 0)
        }
      )
    }
    await groupsFor(
      "heavy",
      "staff heaviest, feed page photos",
      heavyFeedPhotos
    )()
    await groupsFor("heavy", "staff heaviest, own", heavy100)()
    await groupsFor("managerBig", "manager, venue latest", bigVenue100)()
    await groupsFor("admin", "admin, big venue latest", bigVenue100)()

    // ---------------------------------------------------------- group read (S5)
    for (const key of ["perfb05-g3", "perfb05-g10"]) {
      const id = groupId(key)
      for (const who of ["creator", "managerBig", "colleague", "admin"]) {
        const a = await actorFor(who)
        await measure(
          `contribution_group ${key.slice(8)} as ${who}`,
          "group-read",
          a,
          async () => {
            const r = await knowledge.getContributionGroup(a.actor, {
              groupId: id,
            })
            return ok(r, r.ok ? r.group.members.length : 0)
          }
        )
      }
    }

    // ---------------------------------------------------------- access (thumbnail arm)
    const asset = (sql) => ids(sql)[0]
    const heavyOwn = asset(
      `select id from public.media_assets where uploader_id = '${t.staffHeavy.id}' and ${READY} and thumbnail_path is not null order by created_at desc limit 1`
    )
    // A manager-era upload: no colleague may read it
    // (community_readable_assets), so a staff caller gets 404.
    const otherVenue = asset(
      `select id from public.media_assets where uploader_id = '${P.managerBig.id}' and uploader_role = 'manager' and ${READY} and thumbnail_path is not null order by created_at asc limit 1`
    )
    const mgrOwnManagerEra = asset(
      `select id from public.media_assets where uploader_id = '${P.managerBig.id}' and uploader_role = 'manager' and ${READY} and thumbnail_path is not null order by created_at desc limit 1`
    )
    const mgrOwnStaffEra = asset(
      `select id from public.media_assets where uploader_id = '${P.managerBig.id}' and uploader_role is null and ${READY} and thumbnail_path is not null order by created_at desc limit 1`
    )
    const venueLabelled = asset(
      `select a.id from public.media_assets a where a.venue_id = '${P.managerBig.venueId}' and a.uploader_id <> '${P.managerBig.id}' and a.${READY} and a.thumbnail_path is not null and exists (select 1 from public.media_label_items li where li.asset_id = a.id) order by a.created_at desc limit 1`
    )
    const creatorG3 = asset(
      `select m.asset_id from public.media_contribution_group_members m join public.media_contribution_groups g on g.id = m.group_id where g.client_group_key = 'perfb05-g3' order by m.position limit 1`
    )
    for (const id of [
      heavyOwn,
      otherVenue,
      mgrOwnManagerEra,
      mgrOwnStaffEra,
      venueLabelled,
      creatorG3,
    ])
      await ensureThumb(id)
    const thumb = async (who, label, id) => {
      const a = await actorFor(who)
      await measure(
        `thumbnail, ${label}`,
        "access",
        a,
        async () => {
          const r = await access.signDerivative(a.actor, id, "thumbnail")
          return r.ok
            ? { ok: true, rows: 1 }
            : { ok: true, rows: 0, status: r.status }
        },
        { outcomeNote: "rows 1 = signed URL (302), rows 0 = refused (404)" }
      )
    }
    await thumb("admin", "admin, any asset", heavyOwn)
    await thumb("heavy", "staff owner", heavyOwn)
    await thumb("colleague", "staff colleague, group member photo", creatorG3)
    await thumb("heavy", "staff, a manager's upload (404 path)", otherVenue)
    await thumb(
      "managerBig",
      "manager, own manager-era upload",
      mgrOwnManagerEra
    )
    await thumb(
      "managerBig",
      "manager, own staff-era upload (vetoed)",
      mgrOwnStaffEra
    )
    await thumb(
      "managerBig",
      "manager, venue labelled asset (search arm on B05)",
      venueLabelled
    )
    facts.access = {
      heavyOwn,
      otherVenue,
      mgrOwnManagerEra,
      mgrOwnStaffEra,
      venueLabelled,
      creatorG3,
    }

    // ---------------------------------------------------------- contribution_group_add 9 -> 10
    {
      const a = await actorFor("creator")
      const groups = writeGroups("add9", 9)
      const fresh = freshAssets()
      const inputs = groups
        .map((g, i) => ({ groupId: g.groupId, assetIds: [fresh[i]] }))
        .filter((x) => x.assetIds[0])
      await measureWrites(
        "contribution_group_add, 9 -> 10 members",
        "group-write",
        a,
        inputs,
        async (input) => {
          const r = await knowledge.addToContributionGroup(a.actor, input)
          return ok(r, r.ok ? r.members : 0)
        }
      )
    }
  }

  if (PART === "new") {
    // ---------------------------------------------------------- asset search
    const run = (a, input) => async () => {
      const r = await search.searchAssets(a.actor, input)
      return r.ok
        ? { ok: true, rows: r.items.length, more: r.nextCursor !== null }
        : r
    }
    const days = (from, to) => ({ uploadedFrom: from, uploadedTo: to })
    const [d7, d90, today, m18, m12] = one(
      `select to_char(current_date - 7, 'YYYY-MM-DD'), to_char(current_date - 90, 'YYYY-MM-DD'),
              to_char(current_date, 'YYYY-MM-DD'), to_char(current_date - 548, 'YYYY-MM-DD'),
              to_char(current_date - 365, 'YYYY-MM-DD')`
    )
    const popularItem = (venueId) =>
      one(
        `select item_id from public.media_label_items where venue_id = '${venueId}' group by 1 order by count(*) desc, 1 limit 1`
      )[0]
    const variantOf = (venueId) =>
      one(
        `select variant_id from public.media_label_items where venue_id = '${venueId}' and variant_id is not null group by 1 order by count(*) desc, 1 limit 1`
      )[0]
    const rareWorld = one(
      `select li.item_id from public.media_label_items li join public.media_assets a on a.id = li.asset_id
       where a.uploader_id = '${P.managerBig.id}' and a.uploader_role is null group by 1 order by count(*) desc limit 1`
    )[0]
    // The venue's least-labelled variant (labels plus menu decisions; ties
    // by id): a variant filter that matches almost nothing.
    const rareVariant = (venueId) =>
      one(
        `select x.v from (
           select li.variant_id as v from public.media_label_items li where li.venue_id = '${venueId}' and li.variant_id is not null
           union all
           select mp.variant_id from public.menu_item_photos mp where mp.venue_id = '${venueId}' and mp.variant_id is not null) x
         group by 1 order by count(*), 1 limit 1`
      )[0]
    // The venue's least-labelled item (labels plus menu decisions; ties by
    // id), a menu item of the venue with neither (a new or never-photographed
    // dish; NOMATCH if every item has one), and a variant of another item, so
    // the pair with the popular item has no rows.
    const rareItem = (venueId) =>
      one(
        `select x.i from (
           select li.item_id as i from public.media_label_items li where li.venue_id = '${venueId}'
           union all
           select mp.item_id from public.menu_item_photos mp where mp.venue_id = '${venueId}') x
         group by 1 order by count(*), 1 limit 1`
      )[0]
    const bareItem = (venueId) =>
      one(
        `select i.id from public.menu_items i where i.venue_id = '${venueId}'
           and not exists (select 1 from public.media_label_items li where li.item_id = i.id)
           and not exists (select 1 from public.menu_item_photos mp where mp.item_id = i.id)
         order by i.id limit 1`
      )[0] ?? NOMATCH
    const foreignVariant = (venueId) =>
      one(
        `select variant_id from public.media_label_items where venue_id = '${venueId}'
           and variant_id is not null and item_id <> '${popularItem(venueId)}'
         group by 1 order by count(*) desc, 1 limit 1`
      )[0]
    const variantPair = (venueId) =>
      one(
        `select item_id, variant_id from public.media_label_items where venue_id = '${venueId}' and variant_id is not null group by 1, 2 order by count(*) desc, 1, 2 limit 1`
      )
    const acceptedItem = (venueId) =>
      one(
        `select item_id from public.menu_item_photos where venue_id = '${venueId}' and state = 'accepted' group by 1 order by count(*) desc, 1 limit 1`
      )[0]
    const NOMATCH = "b05b05b0-5b05-4b05-8b05-b05b05b05b05"
    const g10 = groupId("perfb05-g10")

    const cases = (venueId) => [
      ["no filters", {}],
      ["type = video", { mediaType: "video" }],
      ["date range, last 7 days", days(d7, today)],
      ["date range, last 90 days", days(d90, today)],
      ["date range, 18 to 12 months ago", days(m18, m12)],
      ["item, popular", { item: popularItem(venueId) }],
      ["item, rare (fewest labels)", { item: rareItem(venueId) }],
      ["item, no labels or decisions", { item: bareItem(venueId) }],
      [
        "item + variant, popular pair",
        (([i, v]) => ({ item: i, variant: v }))(variantPair(venueId)),
      ],
      [
        "item + variant, no rows",
        { item: popularItem(venueId), variant: foreignVariant(venueId) },
      ],
      ["variant, popular", { variant: variantOf(venueId) }],
      ["variant, rare (fewest labels)", { variant: rareVariant(venueId) }],
      ["check / task, no evidence anywhere", { check: NOMATCH }],
      [
        "submission (coverage), unknown id",
        { submission: { source: "coverage", id: NOMATCH } },
      ],
      ["group (10 members, big venue)", { group: g10 }],
      ["use = legacy_unknown", { rights: "legacy_unknown" }],
      ["use = not_granted", { rights: "not_granted" }],
      ["use = in_force", { rights: "in_force" }],
      [
        "use = in_force + destination",
        { rights: "in_force", destination: "perf_menu_web" },
      ],
      ["use = expired", { rights: "expired" }],
      ["use = withdrawn", { rights: "withdrawn" }],
      ["menu decision = accepted", { menuState: "accepted" }],
      [
        "menu decision = accepted + item",
        { menuState: "accepted", item: acceptedItem(venueId) },
      ],
      // Rare decision states (a few hundred, or none, in the estate).
      ...[
        "better_photo_requested",
        "needs_recheck",
        "withdrawn",
        "invalidated",
      ].map((st) => [`menu decision = ${st}`, { menuState: st }]),
      ...(diffWorld
        ? (() => {
            const k = venueId === P.managerSmall.venueId ? "small" : "big"
            return [
              [
                "check / amenity, real evidence",
                { check: did(`chk-${k}-out`) },
              ],
              [
                "check / knowledge, real evidence",
                { check: did(`chk-${k}-toil`) },
              ],
              [
                "check / coverage requirement, real evidence",
                { check: did(`req-${k}-vs`) },
              ],
              [
                "submission (coverage), real evidence",
                {
                  submission: {
                    source: "coverage",
                    id: did(`csub-${k}-vs`),
                  },
                },
              ],
              [
                "submission (amenity), real evidence",
                {
                  submission: {
                    source: "amenity",
                    id: did(`asub-${k}-out-1`),
                  },
                },
              ],
            ]
          })()
        : []),
    ]

    for (const [who, venueId] of [
      ["admin", null],
      ["managerBig", P.managerBig.venueId],
      ["managerSmall", P.managerSmall.venueId],
    ]) {
      const a = await actorFor(who)
      const v = venueId ?? P.managerBig.venueId
      for (const [label, filters] of cases(v)) {
        await measure(`${who}: ${label}`, "search", a, run(a, { filters }))
      }
      if (who === "admin") {
        await measure(
          "admin: venue = big",
          "search",
          a,
          run(a, { filters: { venue: P.managerBig.venueId } })
        )
        await measure(
          "admin: venue = small",
          "search",
          a,
          run(a, { filters: { venue: P.managerSmall.venueId } })
        )
        await measure(
          "admin: venue = big + use = withdrawn",
          "search",
          a,
          run(a, {
            filters: { venue: P.managerBig.venueId, rights: "withdrawn" },
          })
        )
      }
      // Deep page: the 10th page of the unfiltered search, by the cursor.
      let cursor = null
      for (let p = 1; p < 10; p++) {
        const r = await search.searchAssets(a.actor, { filters: {}, cursor })
        if (!r.ok || !r.nextCursor)
          throw new Error(
            `search walk ${who}: ${JSON.stringify(r).slice(0, 200)}`
          )
        cursor = r.nextCursor
      }
      await measure(
        `${who}: no filters, page 10 by cursor`,
        "search",
        a,
        run(a, { filters: {}, cursor })
      )
      await measure(
        `${who}: no filters, 48 a page`,
        "search",
        a,
        run(a, { filters: {}, limit: 48 })
      )
    }

    // Worst cases: matches the manager may not see, among many it may.
    {
      const a = await actorFor("managerBig")
      await measure(
        "manager big: rare item labelled on 2,000 own staff-era uploads",
        "search-worst",
        a,
        run(a, { filters: { item: rareWorld } })
      )
      await measure(
        "manager big: use = withdrawn (1,500 vetoed + 2 visible)",
        "search-worst",
        a,
        run(a, { filters: { rights: "withdrawn" } })
      )
      await measure(
        "manager big: use = withdrawn + type = video",
        "search-worst",
        a,
        run(a, { filters: { rights: "withdrawn", mediaType: "video" } })
      )
      await measure(
        "manager big: rare item + date range 18 to 12 months",
        "search-worst",
        a,
        run(a, { filters: { item: rareWorld, ...days(m18, m12) } })
      )
      if (diffWorld) {
        const worst = [
          ["no filters", { filters: {} }],
          ["no filters, 48 a page", { filters: {}, limit: 48 }],
          ["type = video", { filters: { mediaType: "video" } }],
          ["use = legacy_unknown", { filters: { rights: "legacy_unknown" } }],
          ["date range, last 90 days", { filters: days(d90, today) }],
        ]
        const r = await actorFor("rejectManager")
        for (const [label, input] of worst)
          await measure(
            `reject venue (73,600 assets, none visible): ${label}`,
            "search-worst",
            r,
            run(r, input)
          )
        const g = await actorFor("grantee")
        for (const [label, input] of worst)
          await measure(
            `staff grantee, 500 own unlabelled uploads, no active check: ${label}`,
            "search-worst",
            g,
            run(g, input)
          )
      }
      if (postLaunch) {
        const rights = [
          ["use = legacy_unknown", { rights: "legacy_unknown" }],
          ["use = not_granted", { rights: "not_granted" }],
          ["use = in_force", { rights: "in_force" }],
          [
            "use = in_force + destination",
            { rights: "in_force", destination: "perf_social" },
          ],
          ["use = expired", { rights: "expired" }],
          ["use = withdrawn", { rights: "withdrawn" }],
        ]
        for (const who of ["admin", "managerBig", "managerSmall"]) {
          const x = await actorFor(who)
          for (const [label, filters] of rights)
            await measure(
              `post-launch ${who}: ${label}`,
              "search-postlaunch",
              x,
              run(x, { filters })
            )
        }
        const x = await actorFor("admin")
        await measure(
          "post-launch admin: venue = big + use = not_granted",
          "search-postlaunch",
          x,
          run(x, {
            filters: { venue: P.managerBig.venueId, rights: "not_granted" },
          })
        )
        // Another venue's ids (with evidence there) against unknown ones.
        for (const [label, filters] of [
          [
            "check, other venue's (with evidence)",
            { check: did("chk-other-out") },
          ],
          ["check, unknown", { check: NOMATCH }],
          [
            "submission (coverage), other venue's",
            { submission: { source: "coverage", id: did("csub-other-vs") } },
          ],
          [
            "submission (coverage), unknown",
            { submission: { source: "coverage", id: NOMATCH } },
          ],
          ["group, other venue's", { group: did("group-other") }],
          ["group, unknown", { group: NOMATCH }],
        ])
          await measure(
            `post-launch managerBig: ${label}`,
            "search-postlaunch",
            a,
            run(a, { filters })
          )
      }
      if (coverageWorld) {
        // 30,000 coverage items at the big venue: the candidate statements
        // read the venue's items (manager) or the table (admin) once a call.
        const x = await actorFor("admin")
        for (const [who, actor, extra] of [
          ["managerBig", a, {}],
          ["admin", x, {}],
          ["admin, venue = big", x, { venue: P.managerBig.venueId }],
        ])
          for (const [label, filters] of [
            [
              "submission (coverage), 30 items of 30,000",
              { submission: { source: "coverage", id: cid("csub-0001") } },
            ],
            [
              "check / coverage requirement, 1,500 items",
              { check: cid("req-01") },
            ],
          ])
            await measure(
              `coverage world ${who}: ${label}`,
              "search-coverage",
              actor,
              run(actor, { filters: { ...extra, ...filters } })
            )
      }
      // Thumbnail gate's search arm alone (asset_search_can_open), visible and vetoed.
      const vis = ids(
        `select a.id from public.media_assets a where a.venue_id = '${P.managerBig.venueId}' and a.uploader_id <> '${P.managerBig.id}' and a.${READY} and exists (select 1 from public.media_label_items li where li.asset_id = a.id) order by a.created_at desc limit 1`
      )[0]
      const vetoed = ids(
        `select id from public.media_assets where uploader_id = '${P.managerBig.id}' and uploader_role is null and ${READY} order by created_at desc limit 1`
      )[0]
      for (const [label, id] of [
        ["visible", vis],
        ["vetoed staff-era", vetoed],
      ]) {
        await measure(
          `asset_search_can_open, manager big, ${label}`,
          "search-gate",
          a,
          async () => {
            const { data, error } = await a.actor.db.rpc(
              "asset_search_can_open",
              { p_asset_id: id }
            )
            return error
              ? { ok: false, message: error.message }
              : { ok: true, rows: data ? 1 : 0 }
          }
        )
      }
    }
    facts.search = { rareWorld, g10 }

    // ---------------------------------------------------------- group read, 30 positions
    const g30 = groupId("perfb05-g30")
    for (const key of ["perfb05-g3", "perfb05-g10", "perfb05-g30"]) {
      const id = key === "perfb05-g30" ? g30 : groupId(key)
      for (const who of ["creator", "managerBig", "colleague"]) {
        const a = await actorFor(who)
        await measure(
          `contribution_group ${key.slice(8)} as ${who}`,
          "group-read",
          a,
          async () => {
            const r = await knowledge.getContributionGroup(a.actor, {
              groupId: id,
            })
            return ok(r, r.ok ? r.group.members.length : 0)
          }
        )
      }
    }

    // ---------------------------------------------------------- writes
    const a = await actorFor("creator")
    const fresh = freshAssets()
    let f = 0
    const take = (groups) =>
      groups.map((g) => ({ ...g, fresh: fresh[f++] })).filter((x) => x.fresh)
    const add = (x) =>
      knowledge.addToContributionGroup(a.actor, {
        groupId: x.groupId,
        assetIds: [x.fresh],
      })
    const replace = (x) =>
      knowledge.replaceInContributionGroup(a.actor, {
        groupId: x.groupId,
        failedAssetId: x.failed,
        newAssetId: x.fresh,
      })
    await measureWrites(
      "contribution_group_add, position 29 -> 30",
      "group-write",
      a,
      take(writeGroups("add29", 29)),
      async (x) => {
        const r = await add(x)
        return ok(r, r.ok ? r.members : 0)
      }
    )
    await measureWrites(
      "contribution_group_replace, position 9 -> 10",
      "group-write",
      a,
      take(writeGroups("rep9", 9)),
      async (x) => {
        const r = await replace(x)
        return ok(r, r.ok ? r.replaced.position : 0)
      }
    )
    await measureWrites(
      "contribution_group_replace, position 29 -> 30",
      "group-write",
      a,
      take(writeGroups("rep29", 29)),
      async (x) => {
        const r = await replace(x)
        return ok(r, r.ok ? r.replaced.position : 0)
      }
    )
  }

  if (PART === "explain") {
    // EXPLAIN (ANALYZE, BUFFERS) of what the B05 functions run. asset_search is
    // plpgsql with plan_cache_mode = force_custom_plan, so its row query is
    // planned with the variables as constants: the statement below is that
    // query with the values substituted, run as the function owner (postgres,
    // as security definer) with the caller's JWT claims (auth.uid()). The whole
    // calls are also explained in PostgREST's json_to_record shape, as the
    // caller (authenticated), for their total time and buffers.
    const dir = join(OUT, "b05-explain")
    mkdirSync(dir, { recursive: true })
    const lit = (v, type) =>
      v === null || v === undefined ? `null::${type}` : `'${v}'::${type}`
    const searchSql = (c) => `select a.id, a.created_at
    from public.media_assets a
    where a.deleted_at is null
      and a.upload_state = 'ready'
      and (${lit(c.venue, "uuid")} is null or a.venue_id = ${lit(c.venue, "uuid")})
      and (${lit(c.type, "public.media_type")} is null or a.media_type = ${lit(c.type, "public.media_type")})
      and (${lit(c.from, "timestamptz")} is null or a.created_at >= ${lit(c.from, "timestamptz")})
      and (${lit(c.before, "timestamptz")} is null or a.created_at < ${lit(c.before, "timestamptz")})
      and (${lit(c.afterAt, "timestamptz")} is null or (a.created_at, a.id) < (${lit(c.afterAt, "timestamptz")}, ${lit(c.afterId, "uuid")}))
      and (${lit(c.group, "uuid")} is null or exists (
        select 1 from public.media_contribution_group_members gm
        where gm.asset_id = a.id and gm.group_id = ${lit(c.group, "uuid")}))
      and (${lit(c.menuState, "text")} is null or exists (
        select 1 from public.menu_item_photos mp
        where mp.asset_id = a.id and mp.state = ${lit(c.menuState, "text")}
          and (${lit(c.item, "uuid")} is null or mp.item_id = ${lit(c.item, "uuid")})
          and (${lit(c.variant, "uuid")} is null or mp.variant_id = ${lit(c.variant, "uuid")})))
      and (${lit(c.menuState, "text")} is not null
        or (${lit(c.item, "uuid")} is null and ${lit(c.variant, "uuid")} is null)
        or exists (
          select 1 from public.media_label_items li
          where li.asset_id = a.id
            and (${lit(c.item, "uuid")} is null or li.item_id = ${lit(c.item, "uuid")})
            and (${lit(c.variant, "uuid")} is null or li.variant_id = ${lit(c.variant, "uuid")}))
        or exists (
          select 1 from public.menu_item_photos mp
          where mp.asset_id = a.id
            and (${lit(c.item, "uuid")} is null or mp.item_id = ${lit(c.item, "uuid")})
            and (${lit(c.variant, "uuid")} is null or mp.variant_id = ${lit(c.variant, "uuid")})))
      and (${lit(c.check, "uuid")} is null
        or exists (
          select 1 from public.amenity_submission_assets sa
          join public.amenity_submissions s on s.id = sa.submission_id
          where sa.asset_id = a.id and s.check_id = ${lit(c.check, "uuid")})
        or exists (
          select 1 from public.knowledge_contribution_assets ka
          join public.knowledge_contributions kc on kc.id = ka.contribution_id
          where ka.asset_id = a.id and kc.check_id = ${lit(c.check, "uuid")})
        or exists (
          select 1 from public.coverage_submission_items ci
          where ci.asset_id = a.id and ci.requirement_id = ${lit(c.check, "uuid")}))
      and (${lit(c.rights, "text")} is null
        or (${lit(c.rights, "text")} in ('legacy_unknown', 'not_granted', 'withdrawn')
          and private.media_asset_use_state(a.id, now()) = ${lit(c.rights, "text")})
        or (${lit(c.rights, "text")} = 'in_force'
          and private.media_asset_use_state(a.id, now()) = 'granted')
        or (${lit(c.rights, "text")} = 'expired'
          and private.media_asset_use_state(a.id, now()) in ('legacy_unknown', 'not_granted')
          and exists (
            select 1 from public.media_use_grants g
            where g.asset_id = a.id and private.media_use_grant_state(g, now()) = 'expired')))
      and private.asset_search_admits(a, ${c.admin}, ${lit(c.managerVenue, "uuid")})
    order by a.created_at desc, a.id desc
    limit 25`
    const rpcCall = (fn, params) => {
      const names = Object.keys(params)
      const types = {
        p_filters: "jsonb",
        p_after_created_at: "timestamptz",
        p_after_id: "uuid",
        p_limit: "integer",
        p_cursor: "text",
      }
      return `select "public"."${fn}"(${names.map((n) => `"${n}" := pgrst_body."${n}"`).join(", ")}) "${fn}"
      from (select '${JSON.stringify(params).replace(/'/g, "''")}'::json as json_data) pgrst_payload,
      lateral (select ${names.map((n) => `"${n}"`).join(", ")} from json_to_record(pgrst_payload.json_data) as _(${names.map((n) => `"${n}" ${types[n]}`).join(", ")}) limit 1) pgrst_body`
    }
    const rareWorld = one(
      `select li.item_id from public.media_label_items li join public.media_assets a on a.id = li.asset_id
       where a.uploader_id = '${P.managerBig.id}' and a.uploader_role is null group by 1 order by count(*) desc limit 1`
    )[0]
    const NOMATCH = "b05b05b0-5b05-4b05-8b05-b05b05b05b05"
    const big = P.managerBig.venueId
    const mgr = { admin: false, managerVenue: big, venue: big }
    const adm = { admin: true, managerVenue: null, venue: null }
    const feedPhoto = ids(
      `select id from public.media_assets where uploader_id = '${t.staffHeavy.id}' and purpose = 'general' and deleted_at is null order by created_at desc, id desc limit 1`
    )[0]
    /** [name, person id, role (postgres = as the definer), sql] */
    const S0 = [
      [
        "search-inner-manager-rare-item",
        P.managerBig.id,
        "postgres",
        searchSql({ ...mgr, item: rareWorld }),
      ],
      [
        "search-inner-manager-use-withdrawn",
        P.managerBig.id,
        "postgres",
        searchSql({ ...mgr, rights: "withdrawn" }),
      ],
      [
        "search-inner-manager-use-not-granted",
        P.managerBig.id,
        "postgres",
        searchSql({ ...mgr, rights: "not_granted" }),
      ],
      [
        "search-inner-manager-check-nomatch",
        P.managerBig.id,
        "postgres",
        searchSql({ ...mgr, check: NOMATCH }),
      ],
      [
        "search-inner-manager-no-filter",
        P.managerBig.id,
        "postgres",
        searchSql(mgr),
      ],
      [
        "search-inner-manager-small-use-legacy",
        P.managerSmall.id,
        "postgres",
        searchSql({
          admin: false,
          managerVenue: P.managerSmall.venueId,
          venue: P.managerSmall.venueId,
          rights: "legacy_unknown",
        }),
      ],
      ["search-inner-admin-no-filter", t.admin.id, "postgres", searchSql(adm)],
      [
        "search-inner-admin-use-not-granted",
        t.admin.id,
        "postgres",
        searchSql({ ...adm, rights: "not_granted" }),
      ],
      [
        "search-inner-admin-use-withdrawn",
        t.admin.id,
        "postgres",
        searchSql({ ...adm, rights: "withdrawn" }),
      ],
      [
        "search-inner-admin-check-nomatch",
        t.admin.id,
        "postgres",
        searchSql({ ...adm, check: NOMATCH }),
      ],
      [
        "search-call-manager-rare-item",
        P.managerBig.id,
        "authenticated",
        rpcCall("asset_search", {
          p_filters: { item: rareWorld },
          p_after_created_at: null,
          p_after_id: null,
          p_limit: 24,
        }),
      ],
      [
        "search-call-manager-use-not-granted",
        P.managerBig.id,
        "authenticated",
        rpcCall("asset_search", {
          p_filters: { rights: "not_granted" },
          p_after_created_at: null,
          p_after_id: null,
          p_limit: 24,
        }),
      ],
      [
        "search-call-admin-use-not-granted",
        t.admin.id,
        "authenticated",
        rpcCall("asset_search", {
          p_filters: { rights: "not_granted" },
          p_after_created_at: null,
          p_after_id: null,
          p_limit: 24,
        }),
      ],
      [
        "search-call-admin-check-nomatch",
        t.admin.id,
        "authenticated",
        rpcCall("asset_search", {
          p_filters: { check: NOMATCH },
          p_after_created_at: null,
          p_after_id: null,
          p_limit: 24,
        }),
      ],
      [
        "feed-call-staff-heaviest",
        t.staffHeavy.id,
        "authenticated",
        rpcCall("my_contributions_feed", { p_cursor: null, p_limit: 20 }),
      ],
      [
        "feed-call-manager-big",
        P.managerBig.id,
        "authenticated",
        rpcCall("my_contributions_feed", { p_cursor: null, p_limit: 20 }),
      ],
      [
        "feed-photo-json-one",
        t.staffHeavy.id,
        "postgres",
        `select private.feed_photo_json('${feedPhoto}')`,
      ],
      [
        "feed-use-summary-one",
        t.staffHeavy.id,
        "postgres",
        `select private.media_asset_use_summary('${feedPhoto}', 'uploader')`,
      ],
      [
        "feed-use-summary-inner",
        t.staffHeavy.id,
        "postgres",
        `select distinct d.label from public.media_use_grants g join public.media_use_destinations d on d.key = g.destination_key where g.asset_id = '${feedPhoto}' and private.media_use_grant_state(g, now()) = 'in_force'`,
      ],
      [
        "use-state-inner",
        t.staffHeavy.id,
        "postgres",
        `select case when bool_or(st.state = 'in_force') then 'granted' when bool_or(st.state = 'withdrawn') then 'withdrawn' when a.use_baseline = 'legacy_unknown' then 'legacy_unknown' else 'not_granted' end from public.media_assets a left join lateral (select private.media_use_grant_state(g, now()) as state from public.media_use_grants g where g.asset_id = a.id) st on true where a.id = '${feedPhoto}' group by a.id, a.use_baseline`,
      ],
    ]
    // The chunk statement of the fixed public.asset_search, cut from the
    // migration, with its plpgsql variables as constants (force_custom_plan
    // plans it that way). Caller constants as asset_search computes them.
    const mig = readFileSync(
      "supabase/migrations/20261113140200_media_b05m4_asset_search.sql",
      "utf8"
    )
    const chunkFrom = mig.indexOf("      for v_row in\n")
    const chunkTo = mig.indexOf(
      "\n      loop\n        v_seen := v_seen + 1;",
      chunkFrom
    )
    if (chunkFrom < 0 || chunkTo < 0)
      throw new Error("no chunk statement in the migration")
    const chunkText = mig
      .slice(chunkFrom + "      for v_row in\n".length, chunkTo)
      .replace(/--[^\n]*/g, "")
    const arr = (v) =>
      v == null ? "null::uuid[]" : `'{${v.join(",")}}'::uuid[]`
    const bool = (b) => (b ? "true" : "false")
    const subst = (text, c) => {
      const vals = {
        v_admin: bool(c.admin),
        v_venue: lit(c.venue, "uuid"),
        v_type: lit(c.type, "public.media_type"),
        v_from: lit(c.from, "timestamptz"),
        v_before: lit(c.before, "timestamptz"),
        v_scan_at: lit(c.afterAt, "timestamptz"),
        v_scan_id: lit(c.afterId, "uuid"),
        v_check_ids: arr(c.checkIds),
        v_submission_ids: arr(c.submissionIds),
        v_group_ids: arr(c.groupIds),
        v_menu_ids: arr(c.menuIds),
        v_in_venue: bool(c.inVenue ?? true),
        v_more: bool(c.more ?? true),
        v_ids: arr(c.ids ?? []),
        v_group: lit(c.group, "uuid"),
        v_menu_state: lit(c.menuState, "text"),
        v_item: lit(c.item, "uuid"),
        v_variant: lit(c.variant, "uuid"),
        v_check: lit(c.check, "uuid"),
        v_submission_id: lit(c.submissionId, "uuid"),
        v_submission_source: lit(c.submissionSource, "text"),
        v_rights: lit(c.rights, "text"),
        v_destination: lit(c.destination, "text"),
        v_now: "now()",
        v_is_manager: bool(c.isManager),
        v_uid: lit(c.uid, "uuid"),
        v_has_active_check: bool(c.activeCheck),
        v_can_review: bool(c.canReview),
        v_chunk: String(c.chunk ?? 25),
      }
      return text.replace(/\bv_[a-z_]+\b/g, (m) => {
        if (!(m in vals)) throw new Error(`statement: unmapped ${m}`)
        return vals[m]
      })
    }
    const chunkSql = (c) => subst(chunkText, c)
    // The candidate statements (select coalesce(array_agg(..)) into v_x ...)
    // and the item block (return jsonb_build_object(..)), cut from the
    // migration the same way: they run under the same SET clause.
    const fnFrom = mig.indexOf("create function public.asset_search(")
    const fnTo = mig.indexOf("\n$$;", fnFrom)
    const fnText = mig.slice(fnFrom, fnTo)
    const candText = (target) => {
      const at = fnText.indexOf(` into ${target}\n`)
      const from = fnText.lastIndexOf("select coalesce(array_agg(", at)
      const to = fnText.indexOf(";\n", at)
      if (at < 0 || from < 0 || to < 0)
        throw new Error(`no candidate statement for ${target}`)
      return fnText
        .slice(from, to)
        .replace(` into ${target}`, "")
        .replace(/--[^\n]*/g, "")
    }
    const candSql = (target, c) => subst(candText(target), c)
    const candIds = (target, c) => ids(`select unnest((${candSql(target, c)}))`)
    const itemsText = (() => {
      const from = fnText.indexOf("  return jsonb_build_object(\n")
      if (from < 0) throw new Error("no item block")
      return fnText
        .slice(from + "  return ".length)
        .replace(/;\s*end;\s*$/, "")
        .replace(/--[^\n]*/g, "")
    })()
    const itemsSql = (c) => `select ${subst(itemsText, c)}`
    const callerConst = (p) => ({
      admin: false,
      venue: p.venueId,
      uid: p.id,
      isManager: p.role === "manager",
      canReview: p.role === "manager",
      activeCheck:
        one(
          `select exists (select 1 from public.venue_amenity_checks c where c.venue_id = '${p.venueId}' and c.status = 'active')`
        )[0] === "t",
    })
    const admC = { admin: true, venue: null }
    const checkIds = (check) =>
      ids(`select distinct x.asset_id from (
        select sa.asset_id from public.amenity_submission_assets sa
        join public.amenity_submissions s on s.id = sa.submission_id where s.check_id = '${check}'
        union all
        select ka.asset_id from public.knowledge_contribution_assets ka
        join public.knowledge_contributions kc on kc.id = ka.contribution_id where kc.check_id = '${check}'
        union all
        select ci.asset_id from public.coverage_submission_items ci where ci.requirement_id = '${check}') x`)
    const mB = callerConst(P.managerBig)
    const mS = callerConst(P.managerSmall)
    const call = (name, who, filters, limit = 24) => [
      name,
      who.id,
      "authenticated",
      rpcCall("asset_search", {
        p_filters: filters,
        p_after_created_at: null,
        p_after_id: null,
        p_limit: limit,
      }),
    ]
    const chunk = [
      [
        "chunk-manager-big-no-filter",
        P.managerBig.id,
        "postgres",
        chunkSql(mB),
      ],
      [
        "chunk-manager-big-no-filter-48",
        P.managerBig.id,
        "postgres",
        chunkSql({ ...mB, chunk: 49 }),
      ],
      [
        "chunk-manager-big-use-legacy",
        P.managerBig.id,
        "postgres",
        chunkSql({ ...mB, rights: "legacy_unknown" }),
      ],
      [
        "chunk-manager-big-use-not-granted",
        P.managerBig.id,
        "postgres",
        chunkSql({ ...mB, rights: "not_granted" }),
      ],
      [
        "chunk-manager-big-use-in-force",
        P.managerBig.id,
        "postgres",
        chunkSql({ ...mB, rights: "in_force" }),
      ],
      [
        "chunk-manager-big-use-expired",
        P.managerBig.id,
        "postgres",
        chunkSql({ ...mB, rights: "expired" }),
      ],
      [
        "chunk-manager-big-use-withdrawn",
        P.managerBig.id,
        "postgres",
        chunkSql({ ...mB, rights: "withdrawn" }),
      ],
      [
        "chunk-manager-big-rare-item",
        P.managerBig.id,
        "postgres",
        // Since repair round 4 an item filter reads a candidate list too.
        chunkSql({
          ...mB,
          item: rareWorld,
          menuIds: candIds("v_menu_ids", { ...mB, item: rareWorld }),
        }),
      ],
      [
        "chunk-manager-small-use-legacy",
        P.managerSmall.id,
        "postgres",
        chunkSql({ ...mS, rights: "legacy_unknown" }),
      ],
      [
        "chunk-manager-small-use-not-granted",
        P.managerSmall.id,
        "postgres",
        chunkSql({ ...mS, rights: "not_granted" }),
      ],
      [
        "chunk-manager-small-use-expired",
        P.managerSmall.id,
        "postgres",
        chunkSql({ ...mS, rights: "expired" }),
      ],
      [
        "chunk-manager-small-use-in-force",
        P.managerSmall.id,
        "postgres",
        chunkSql({ ...mS, rights: "in_force" }),
      ],
      ["chunk-admin-no-filter", t.admin.id, "postgres", chunkSql(admC)],
      [
        "chunk-admin-use-not-granted",
        t.admin.id,
        "postgres",
        chunkSql({ ...admC, rights: "not_granted" }),
      ],
      [
        "chunk-admin-use-expired",
        t.admin.id,
        "postgres",
        chunkSql({ ...admC, rights: "expired" }),
      ],
      [
        "chunk-admin-use-legacy",
        t.admin.id,
        "postgres",
        chunkSql({ ...admC, rights: "legacy_unknown" }),
      ],
      call("search-call-manager-no-filter", P.managerBig, {}),
      call("search-call-manager-check-nomatch", P.managerBig, {
        check: NOMATCH,
      }),
      call("search-call-manager-small-use-legacy", P.managerSmall, {
        rights: "legacy_unknown",
      }),
    ]
    if (diffWorld) {
      const chk = did("chk-big-out")
      const cids = checkIds(chk)
      chunk.push(
        [
          "chunk-manager-big-check-amenity",
          P.managerBig.id,
          "postgres",
          chunkSql({ ...mB, check: chk, checkIds: cids }),
        ],
        [
          "chunk-admin-check-amenity",
          t.admin.id,
          "postgres",
          chunkSql({ ...admC, check: chk, checkIds: cids }),
        ],
        [
          "chunk-reject-no-filter",
          P.rejectManager.id,
          "postgres",
          chunkSql(callerConst(P.rejectManager)),
        ],
        [
          "chunk-reject-use-legacy",
          P.rejectManager.id,
          "postgres",
          chunkSql({
            ...callerConst(P.rejectManager),
            rights: "legacy_unknown",
          }),
        ],
        [
          "chunk-grantee-no-filter",
          P.grantee.id,
          "postgres",
          chunkSql(callerConst(P.grantee)),
        ],
        call("search-call-manager-check-amenity", P.managerBig, { check: chk }),
        call("search-call-reject-no-filter", P.rejectManager, {}),
        call("search-call-grantee-no-filter", P.grantee, {})
      )
    }
    // Variant alone and rare decision states (finding 1 of the round 3
    // review), the candidate statements and the item block (finding 2).
    {
      const bigV = P.managerBig.venueId
      const rv = one(
        `select x.v from (
           select li.variant_id as v from public.media_label_items li where li.venue_id = '${bigV}' and li.variant_id is not null
           union all
           select mp.variant_id from public.menu_item_photos mp where mp.venue_id = '${bigV}' and mp.variant_id is not null) x
         group by 1 order by count(*), 1 limit 1`
      )[0]
      const pv = one(
        `select variant_id from public.media_label_items where venue_id = '${bigV}' and variant_id is not null group by 1 order by count(*) desc, 1 limit 1`
      )[0]
      const adminV = { ...admC, variant: rv }
      const mBV = { ...mB, variant: rv }
      chunk.push(
        [
          "cand-admin-variant-rare",
          t.admin.id,
          "postgres",
          candSql("v_menu_ids", adminV),
        ],
        [
          "cand-manager-big-variant-rare",
          P.managerBig.id,
          "postgres",
          candSql("v_menu_ids", mBV),
        ],
        [
          "cand-admin-variant-popular",
          t.admin.id,
          "postgres",
          candSql("v_menu_ids", { ...admC, variant: pv }),
        ],
        [
          "chunk-admin-variant-rare",
          t.admin.id,
          "postgres",
          chunkSql({ ...adminV, menuIds: candIds("v_menu_ids", adminV) }),
        ],
        [
          "chunk-manager-big-variant-rare",
          P.managerBig.id,
          "postgres",
          chunkSql({ ...mBV, menuIds: candIds("v_menu_ids", mBV) }),
        ],
        [
          "chunk-admin-variant-popular",
          t.admin.id,
          "postgres",
          chunkSql({
            ...admC,
            variant: pv,
            menuIds: candIds("v_menu_ids", { ...admC, variant: pv }),
          }),
        ],
        ...["needs_recheck", "withdrawn", "accepted"].flatMap((st) => {
          const tag = st.replace("_", "-")
          const ad = { ...admC, menuState: st }
          const mg = { ...mB, menuState: st }
          return [
            [
              `cand-admin-menu-state-${tag}`,
              t.admin.id,
              "postgres",
              candSql("v_menu_ids", ad),
            ],
            [
              `cand-manager-big-menu-state-${tag}`,
              P.managerBig.id,
              "postgres",
              candSql("v_menu_ids", mg),
            ],
            [
              `chunk-admin-menu-state-${tag}`,
              t.admin.id,
              "postgres",
              chunkSql({ ...ad, menuIds: candIds("v_menu_ids", ad) }),
            ],
            [
              `chunk-manager-big-menu-state-${tag}`,
              P.managerBig.id,
              "postgres",
              chunkSql({ ...mg, menuIds: candIds("v_menu_ids", mg) }),
            ],
          ]
        }),
        // Item alone and item + variant (finding 1 of the repair 3 review):
        // a menu item with no labels or decisions, the popular item, and the
        // popular item with another item's variant (no rows).
        ...(() => {
          const pi = one(
            `select item_id from public.media_label_items where venue_id = '${bigV}' group by 1 order by count(*) desc, 1 limit 1`
          )[0]
          const bare =
            one(
              `select i.id from public.menu_items i where i.venue_id = '${bigV}'
                 and not exists (select 1 from public.media_label_items li where li.item_id = i.id)
                 and not exists (select 1 from public.menu_item_photos mp where mp.item_id = i.id)
               order by i.id limit 1`
            )[0] ?? "b05b05b0-5b05-4b05-8b05-b05b05b05b05"
          const fv = one(
            `select variant_id from public.media_label_items where venue_id = '${bigV}'
               and variant_id is not null and item_id <> '${pi}'
             group by 1 order by count(*) desc, 1 limit 1`
          )[0]
          const shapes = [
            ["admin-item-bare", t.admin.id, { ...admC, item: bare }],
            ["admin-item-popular", t.admin.id, { ...admC, item: pi }],
            [
              "admin-item-variant-none",
              t.admin.id,
              { ...admC, item: pi, variant: fv },
            ],
            ["manager-big-item-bare", P.managerBig.id, { ...mB, item: bare }],
            ["manager-big-item-popular", P.managerBig.id, { ...mB, item: pi }],
          ]
          return shapes.flatMap(([tag, uid, c]) => [
            [`cand-${tag}`, uid, "postgres", candSql("v_menu_ids", c)],
            [
              `chunk-${tag}`,
              uid,
              "postgres",
              chunkSql({ ...c, menuIds: candIds("v_menu_ids", c) }),
            ],
          ])
        })(),
        call("search-call-admin-variant-rare", t.admin, { variant: rv }),
        call("search-call-admin-menu-state-withdrawn", t.admin, {
          menuState: "withdrawn",
        })
      )
      const page48 = ids(
        `select a.id from public.media_assets a where a.${READY} order by a.created_at desc, a.id desc limit 48`
      )
      chunk.push([
        "items-admin-48",
        t.admin.id,
        "postgres",
        itemsSql({ ...admC, ids: page48, more: true }),
      ])
      if (diffWorld) {
        const big = { ...mB, inVenue: true }
        chunk.push(
          [
            "cand-manager-big-check-amenity",
            P.managerBig.id,
            "postgres",
            candSql("v_check_ids", { ...big, check: did("chk-big-out") }),
          ],
          [
            "cand-manager-big-check-coverage",
            P.managerBig.id,
            "postgres",
            candSql("v_check_ids", { ...big, check: did("req-big-vs") }),
          ],
          [
            "cand-admin-check-coverage",
            t.admin.id,
            "postgres",
            candSql("v_check_ids", { ...admC, check: did("req-big-vs") }),
          ],
          [
            "cand-manager-big-submission-coverage",
            P.managerBig.id,
            "postgres",
            candSql("v_submission_ids", {
              ...big,
              submissionSource: "coverage",
              submissionId: did("csub-big-vs"),
            }),
          ],
          [
            "cand-admin-submission-coverage",
            t.admin.id,
            "postgres",
            candSql("v_submission_ids", {
              ...admC,
              submissionSource: "coverage",
              submissionId: did("csub-big-vs"),
            }),
          ],
          [
            "cand-manager-big-group",
            P.managerBig.id,
            "postgres",
            candSql("v_group_ids", { ...big, group: groupId("perfb05-g10") }),
          ]
        )
      }
      if (coverageWorld) {
        const big = { ...mB, inVenue: true }
        const sub = {
          submissionSource: "coverage",
          submissionId: cid("csub-0001"),
        }
        chunk.push(
          [
            "cand-cov-manager-big-submission",
            P.managerBig.id,
            "postgres",
            candSql("v_submission_ids", { ...big, ...sub }),
          ],
          [
            "cand-cov-admin-submission",
            t.admin.id,
            "postgres",
            candSql("v_submission_ids", { ...admC, ...sub }),
          ],
          [
            "cand-cov-manager-big-requirement",
            P.managerBig.id,
            "postgres",
            candSql("v_check_ids", { ...big, check: cid("req-01") }),
          ],
          [
            "cand-cov-admin-requirement",
            t.admin.id,
            "postgres",
            candSql("v_check_ids", { ...admC, check: cid("req-01") }),
          ],
          call("search-call-cov-manager-big-submission", P.managerBig, {
            submission: { source: "coverage", id: cid("csub-0001") },
          }),
          call("search-call-cov-admin-submission", t.admin, {
            submission: { source: "coverage", id: cid("csub-0001") },
          })
        )
      }
    }
    const S = [
      ...S0.filter(([n]) => V1_INNER || !n.startsWith("search-inner-")),
      ...chunk,
    ]
    const label = (sub) =>
      Object.entries(P).find(([, p]) => p.id === sub)?.[0] ?? sub
    // The chunk, candidate and item statements run inside
    // public.asset_search, under its SET clause: the same planner settings (not search_path; the statement is
    // schema-qualified) are set for their EXPLAIN.
    const fnSettings = installed.config
      .filter((c) => !c.startsWith("search_path="))
      .map((c) => {
        const i = c.indexOf("=")
        return `set local ${c.slice(0, i)} = '${c.slice(i + 1)}';`
      })
      .join("\n")
    const summary = []
    for (const [name, sub, role, sql] of S) {
      const script = `begin;
${role === "authenticated" ? "set local role authenticated;" : ""}
set local statement_timeout = '120s';
${/^(chunk|cand|items)-/.test(name) ? fnSettings : ""}
select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated","aud":"authenticated"}', true) \\gset
select set_config('request.jwt.claim.sub', '${sub}', true) \\gset
explain (analyze, buffers, settings, verbose false) ${sql};
rollback;
`
      let text
      let error = null
      try {
        text = psql(env.dbUrl, ["-At"], { input: script })
      } catch (e) {
        error = String(e.message)
        text = error
      }
      writeFileSync(
        join(dir, `${name}.txt`),
        `-- ${name}\n-- run as ${role}, jwt sub (${label(sub)})\n-- statement:\n${sql}\n\n${text}\n`
      )
      const seq = [
        ...(text ?? "").matchAll(/(?:Parallel )?Seq Scan on (\w+)/g),
      ].map((m) => m[1])
      const idx = [
        ...(text ?? "").matchAll(
          /(?:Index Only Scan|Index Scan|Bitmap Heap Scan) (?:Backward )?(?:using \w+ )?on (\w+)/g
        ),
      ].map((m) => m[1])
      const entry = {
        name,
        executionMs: Number(
          /Execution Time: ([\d.]+) ms/.exec(text ?? "")?.[1] ?? NaN
        ),
        planningMs: Number(
          /Planning Time: ([\d.]+) ms/.exec(text ?? "")?.[1] ?? NaN
        ),
        seqScans: [...new Set(seq)],
        indexScans: [...new Set(idx)],
        rootBuffers: /Buffers: ([^\n]*)/.exec(text ?? "")?.[1] ?? null,
        // Acceptance: no Bitmap Heap Scan + Sort in a chunk plan.
        bitmapHeapScan: /Bitmap Heap Scan/.test(text ?? ""),
        sort: /\bSort\b/.test(text ?? ""),
        error,
      }
      summary.push(entry)
      console.error(
        `${name.padEnd(42)} exec ${String(entry.executionMs).padStart(10)} ms  seq: ${entry.seqScans.join(",") || "-"}  idx: ${entry.indexScans.join(",") || "-"}${error ? "  ERROR " + error.slice(0, 160) : ""}`
      )
    }
    writeFileSync(
      join(dir, "summary.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          revision: gitHead(),
          installed,
          plans: summary,
        },
        null,
        2
      )
    )
  }
} finally {
  if (uploaded.length) await bucket.remove(uploaded)
}

mkdirSync(OUT, { recursive: true })
const doc = {
  part: PART,
  volume: VOLUME,
  at: new Date().toISOString(),
  cwd: resolve("."),
  revision: gitHead(),
  installed: onB05
    ? {
        assetSearchProsrcMd5: installed.assetSearchProsrcMd5,
        assetSearchFunctiondefMd5: installed.assetSearchFunctiondefMd5,
        assetSearchConfig: installed.config,
      }
    : null,
  schema: onB05 ? "b05" : "pre-b05",
  repetitions: { warm: WARM, n: N },
  loadAverage: { start: loadStart, end: loadavg() },
  people: Object.fromEntries(
    Object.entries(P).map(([k, p]) => [
      k,
      { role: p.role, media: p.media ?? null },
    ])
  ),
  facts,
  results,
}
const file = join(OUT, `b05-${PART}${TAG ? `-${TAG}` : ""}.json`)
writeFileSync(file, JSON.stringify(doc, null, 2))
console.error(`wrote ${file}`)
