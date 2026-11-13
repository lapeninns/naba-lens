// B05-m4 asset search (contracts/b05-design.md §6, build scope
// contracts/b05-m4-build-scope.md item 10). Real signed-in identities through
// PostgREST; the service role and psql only build fixtures (a manager-era
// upload, a group, registry rows a migration would write) and read state back.
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { beforeAll, describe, expect, it } from "vitest"

import { searchAssets } from "../../lib/server/media/search"
import { actorFor } from "../slice/media-actor"
import { markReady } from "../support/identities"
import {
  createRequirement,
  insertAsset,
  insertSubmittedItem,
  ok,
  psql,
} from "./coverage-fixtures"
import {
  call,
  json,
  photo,
  refused,
  service,
  submit,
  video,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

type Row = {
  id: string
  mediaType: string
  hasThumbnail: boolean
  venueName: string
  uploaderFirstName: string | null
  uploadedAt: string
  groupId: string | null
  subjects: {
    menuItems: { itemId: string; itemName: string }[]
    checks: { checkId: string; questionKey: string; source: string }[]
    tasks: { requirementId: string | null; submissionId: string }[]
    group: { kind: string; id: string | null } | null
  }
  use: {
    state: string
    inForce: number
    withdrawn: number
    destinations: { destinationKey: string; state: string }[]
  }
  menuDecisions: {
    itemId: string
    variantId: string | null
    state: string
  }[]
}
type Page = { hasMore: boolean; items: Row[] }
type Who = World["staffA"]

const run = randomUUID().slice(0, 8)
const DEST = `test_srch_${run}`
const DEST_OTHER = `test_srco_${run}`
const VERSION = `test-srch-${run}`
const CLEAR = { a_ok: true }

const search = (who: Who, args: Record<string, unknown> = {}) =>
  json<Page>(who, "asset_search", { p_filters: {}, p_limit: 48, ...args })

/** Every page for the caller, following the row-value cursor. */
async function searchAll(
  who: Who,
  filters: Record<string, unknown>,
  limit = 48
): Promise<Row[]> {
  const rows: Row[] = []
  let after: Row | undefined
  for (let i = 0; i < 50; i++) {
    const page = await search(who, {
      p_filters: filters,
      p_limit: limit,
      p_after_created_at: after?.uploadedAt ?? null,
      p_after_id: after?.id ?? null,
    })
    rows.push(...page.items)
    if (!page.hasMore) return rows
    after = page.items[page.items.length - 1]
  }
  throw new Error("too many pages")
}

const ids = (rows: Row[]) => rows.map((r) => r.id)

/** A ready asset with a stored uploader role (a manager-era or staff-era upload). */
async function asset(
  uploader: string,
  venue: string,
  role: "manager" | "staff",
  createdAt?: string
) {
  const id = randomUUID()
  const { error } = await service.from("media_assets").insert({
    id,
    uploader_id: uploader,
    venue_id: venue,
    original_path: `${uploader}/${id}/original.jpg`,
    original_filename: "TEST search.jpg",
    media_type: "image",
    size_bytes: 4,
    client_upload_key: randomUUID(),
    uploader_role: role,
    ...(createdAt ? { created_at: createdAt } : {}),
    // uploader_role is not in the generated types yet.
  } as never)
  if (error) throw error
  await markReady(service, id)
  return id
}

/** Coverage evidence: the task gate shows it to the venue's manager. */
async function evidence(
  uploader: string,
  venue: string,
  createdAt?: string,
  requirement?: string
) {
  const a = await insertAsset(service, { uploader, venue, createdAt })
  const itemId = await insertSubmittedItem(service, {
    asset: a,
    venue,
    author: uploader,
    submittedAt: new Date().toISOString(),
    requirement,
  })
  const submission = psql(
    `select submission_id from public.coverage_submission_items where id = '${itemId}'`
  )
  return { id: a.id, submission }
}

/** As the signed-in user, inside one transaction (psql as the owner). */
function asUser(user: string, sql: string): string {
  const out = psql(`begin;
    select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true) is null;
    ${sql};
    commit;`)
  return out.split("\n").at(-1)!.trim()
}

describe("asset search (B05-06)", () => {
  let w: World
  let other: World
  const a: Record<string, string> = {}
  let submissionId: string
  let groupId: string
  let pieItem: string

  beforeAll(async () => {
    w = await world("b05-srch")
    other = await world("b05-srch-o")
    psql(`insert into public.media_use_destinations
        (key, label, audience, venue_id, owner_workstream, requires_derivative, active) values
      ('${DEST}', 'TEST search ${run}', 'internal', '${w.venue}', 'WS5', false, true),
      ('${DEST_OTHER}', 'TEST search other ${run}', 'internal', '${w.venue}', 'WS5', false, true);
      insert into private.media_use_clearance_versions (version, keys, active)
      values ('${VERSION}', array['a_ok'], true)`)

    a.managerOwn = await asset(w.manager.id, w.venue, "manager")
    // Staff-era upload of a manager account, even as coverage evidence.
    a.managerStaffEra = await asset(w.manager.id, w.venue, "staff")
    await insertSubmittedItem(service, {
      asset: (
        await service
          .from("media_assets")
          .select("id, created_at")
          .eq("id", a.managerStaffEra)
          .single()
      ).data!,
      venue: w.venue,
      author: w.manager.id,
      submittedAt: new Date().toISOString(),
    })
    a.communityOnly = await photo(w.staffA.id, w.venue)
    a.legacyOwn = await photo(w.staffManager.id, w.venue)
    const ev = await evidence(w.staffA.id, w.venue)
    a.evidence = ev.id
    submissionId = ev.submission
    a.otherVenue = (await evidence(other.staffA.id, other.venue)).id
    a.otherCommunity = await photo(other.staffA.id, other.venue)

    // A labelled dish photo (menu gate) at w.
    const version = await publishMenu(
      w.admin,
      w.venue,
      menu("TEST search", [
        section("mains", "Mains", [item(`mains--pie-${run}`, "TEST Pie")]),
      ])
    )
    pieItem = (await readDocument(service, version)).byKey[`mains--pie-${run}`]!
      .itemId
    const dish = await reserveReady(service, w.staffB)
    await saveOk(w.staffB, {
      asset: dish.id,
      revision: 0,
      items: [{ itemId: pieItem, variantId: null }],
      catalogue: version,
    })
    a.dish = dish.id

    // A group with one member (rows as knowledge_b02b would write them).
    groupId = randomUUID()
    psql(`insert into public.media_contribution_groups (id, venue_id, created_by, subject_kind, subject_id, client_group_key)
        values ('${groupId}', '${w.venue}', '${w.staffA.id}', 'none', null, 'TESTgrp${run}');
      insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
        values ('${groupId}', '${w.venue}', '${a.evidence}', 1)`)
  })

  it("refuses staff with a fixed error and leaves can_open false for them", async () => {
    for (const who of [w.staffA, w.staffB, other.staffA]) {
      await refused(
        who,
        "asset_search",
        { p_filters: {} },
        "not_venue_manager",
        "42501"
      )
      const { data, error } = await call(who, "asset_search_can_open", {
        p_asset_id: a.evidence,
      })
      expect(error).toBeNull()
      expect(data).toBe(false)
    }
  })

  it("shows a manager its venue's gated assets only", async () => {
    const rows = await searchAll(w.manager, {})
    const found = ids(rows)
    expect(found).toEqual(
      expect.arrayContaining([a.managerOwn, a.evidence, a.dish])
    )
    for (const hidden of [
      a.managerStaffEra,
      a.communityOnly,
      a.legacyOwn,
      a.otherVenue,
      a.otherCommunity,
    ])
      expect(found).not.toContain(hidden)
    expect(new Set(rows.map((r) => r.venueName))).toEqual(
      new Set([w.venueName])
    )
  })

  it("never shows a manager what viewer_sees_asset would not", async () => {
    for (const who of [w.manager, w.staffManager, other.manager]) {
      const found = ids(await searchAll(who, {}))
      expect(found.length).toBeGreaterThan(0)
      const list = found.map((id) => `'${id}'`).join(",")
      expect(
        asUser(
          who.id,
          `select bool_and(private.viewer_sees_asset(x)) from unnest(array[${list}]::uuid[]) x`
        )
      ).toBe("t")
    }
  })

  it("refuses another venue for a manager and lets an admin pick any venue", async () => {
    await refused(
      w.manager,
      "asset_search",
      { p_filters: { venue: other.venue } },
      "wrong_venue",
      "42501"
    )
    expect(
      ids((await search(w.manager, { p_filters: { venue: w.venue } })).items)
    ).toContain(a.evidence)
    await refused(
      w.admin,
      "asset_search",
      { p_filters: { venue: randomUUID() } },
      "venue_not_found",
      "P0002"
    )
    const mine = ids(await searchAll(w.admin, { venue: w.venue }))
    expect(mine).toEqual(
      expect.arrayContaining([
        a.managerOwn,
        a.managerStaffEra,
        a.communityOnly,
        a.legacyOwn,
        a.evidence,
        a.dish,
      ])
    )
    expect(mine).not.toContain(a.otherVenue)
  })

  it("lets an admin search every venue", async () => {
    const wanted = new Set([a.dish, a.otherCommunity])
    let after: Row | undefined
    for (let i = 0; i < 20 && wanted.size > 0; i++) {
      const page = await search(w.admin, {
        p_after_created_at: after?.uploadedAt ?? null,
        p_after_id: after?.id ?? null,
      })
      for (const r of page.items) wanted.delete(r.id)
      if (!page.hasMore) break
      after = page.items[page.items.length - 1]
    }
    expect([...wanted]).toEqual([])
  })

  it("lets a legacy staff grant holder search its venue through the gates", async () => {
    const found = ids(await searchAll(w.staffManager, {}))
    expect(found).toEqual(expect.arrayContaining([a.evidence, a.dish]))
    // Its own staff upload shows only through a gate (here the amenity gate,
    // which admits a contributor's own uploads at an Amenities venue).
    for (const hidden of [a.communityOnly, a.otherVenue])
      expect(found).not.toContain(hidden)
  })

  it("answers can_open with the search predicate", async () => {
    const open = async (who: Who, id: string) =>
      (await call(who, "asset_search_can_open", { p_asset_id: id })).data
    for (const id of [a.managerOwn, a.evidence, a.dish])
      expect(await open(w.manager, id)).toBe(true)
    for (const id of [
      a.managerStaffEra,
      a.communityOnly,
      a.otherVenue,
      randomUUID(),
    ])
      expect(await open(w.manager, id)).toBe(false)
    expect(await open(w.admin, a.otherCommunity)).toBe(true)
    psql(
      `update public.media_assets set deleted_at = now() where id = '${a.otherCommunity}'`
    )
    expect(await open(w.admin, a.otherCommunity)).toBe(false)
  })

  it("answers can_open for a legacy staff grant holder as its search does", async () => {
    // The thumbnail gate asks can_open for every active non-admin after a 404;
    // a grant holder gets true exactly for what its search lists.
    const open = async (id: string) =>
      (await call(w.staffManager, "asset_search_can_open", { p_asset_id: id }))
        .data
    expect(ids(await searchAll(w.staffManager, {}))).toContain(a.evidence)
    expect(await open(a.evidence)).toBe(true)
    expect(await open(a.otherVenue)).toBe(false)
    expect(await open(a.communityOnly)).toBe(false)
  })

  it("filters by subject, group and submission and reports them", async () => {
    const byItem = await search(w.manager, { p_filters: { item: pieItem } })
    expect(ids(byItem.items)).toEqual([a.dish])
    expect(byItem.items[0]!.subjects.menuItems).toEqual([
      expect.objectContaining({ itemId: pieItem, itemName: "TEST Pie" }),
    ])
    const byGroup = await search(w.manager, { p_filters: { group: groupId } })
    expect(ids(byGroup.items)).toEqual([a.evidence])
    expect(byGroup.items[0]).toMatchObject({
      groupId,
      subjects: { group: { kind: "none", id: null } },
      uploaderFirstName: expect.any(String),
    })
    const bySubmission = await search(w.manager, {
      p_filters: { submission: { source: "coverage", id: submissionId } },
    })
    expect(ids(bySubmission.items)).toEqual([a.evidence])
    expect(bySubmission.items[0]!.subjects.tasks).toEqual([
      { requirementId: null, submissionId },
    ])
    expect(
      (
        await search(w.manager, {
          p_filters: { submission: { source: "amenity", id: submissionId } },
        })
      ).items
    ).toEqual([])
    // Uploader first name only, never the full name.
    for (const r of byGroup.items)
      expect(r.uploaderFirstName ?? "").not.toContain(" ")
  })

  it("filters by asset-level rights and destination", async () => {
    const legacy = (
      await insertAsset(service, {
        uploader: w.staffA.id,
        venue: w.venue,
        createdAt: "2020-01-15T12:00:00Z",
      })
    ).id
    const inForce = await photo(w.staffA.id, w.venue)
    const expired = await photo(w.staffA.id, w.venue)
    const withdrawn = await photo(w.staffA.id, w.venue)
    const none = await photo(w.staffA.id, w.venue)
    const grant = (asset: string, until: string | null = null) =>
      json<{ grantId: string }>(w.admin, "media_use_grant_create", {
        p_request_key: `TEST-${randomUUID()}`,
        p_asset_id: asset,
        p_destination_key: DEST,
        p_purpose: "general_gallery",
        p_subject_kind: "none",
        p_subject_id: null,
        p_profile_key: null,
        p_effective_from: until
          ? new Date(Date.now() - 60_000).toISOString()
          : null,
        p_effective_until: until,
        p_clearance_version: VERSION,
        p_clearance: CLEAR,
        p_note: null,
      })
    await grant(inForce)
    await grant(expired, new Date(Date.now() + 1000).toISOString())
    const g = await grant(withdrawn)
    await json(w.admin, "media_use_grant_withdraw", {
      p_request_key: `TEST-${randomUUID()}`,
      p_grant_id: g.grantId,
      p_reason_code: "granter_withdrawn",
      p_note: null,
    })
    await new Promise((r) => setTimeout(r, 3500))

    const mine = [legacy, inForce, expired, withdrawn, none]
    const rights = async (filters: Record<string, unknown>) =>
      ids(await searchAll(w.admin, { venue: w.venue, ...filters })).filter(
        (id) => mine.includes(id)
      )
    expect(await rights({ rights: "legacy_unknown" })).toEqual([legacy])
    // Asset level: an expired grant leaves the asset not granted.
    expect((await rights({ rights: "not_granted" })).sort()).toEqual(
      [expired, none].sort()
    )
    expect(await rights({ rights: "in_force" })).toEqual([inForce])
    expect(await rights({ rights: "expired" })).toEqual([expired])
    expect(await rights({ rights: "withdrawn" })).toEqual([withdrawn])
    expect(await rights({ rights: "in_force", destination: DEST })).toEqual([
      inForce,
    ])
    expect(
      await rights({ rights: "in_force", destination: DEST_OTHER })
    ).toEqual([])
    const row = (
      await searchAll(w.admin, { venue: w.venue, rights: "in_force" })
    ).find((r) => r.id === inForce)!
    expect(row.use).toMatchObject({
      state: "granted",
      inForce: 1,
      destinations: [{ destinationKey: DEST, state: "in_force" }],
    })
    expect(JSON.stringify(row)).not.toMatch(/granter|clearance|note/i)
  })

  it("refuses unknown filter keys, bad values and half cursors", async () => {
    for (const filters of [
      { freshness: "current" },
      { derivative: "ready" },
      { venue: "nope" },
      { rights: "granted" },
      { destination: DEST },
      { submission: { source: "coverage" } },
      { uploadedFrom: "2026-11-11" },
    ])
      await refused(
        w.admin,
        "asset_search",
        { p_filters: filters },
        "invalid_search_filter",
        "22023"
      )
    await refused(
      w.admin,
      "asset_search",
      { p_filters: {}, p_after_id: randomUUID() },
      "invalid_search_cursor",
      "22023"
    )
  })

  it("keeps keyset pages stable across equal upload times", async () => {
    const k = await world("b05-srch-k")
    const at = new Date(Date.now() - 3_600_000).toISOString()
    const visible: string[] = []
    for (let i = 0; i < 9; i++)
      visible.push((await evidence(k.staffA.id, k.venue, at)).id)
    for (let i = 0; i < 3; i++)
      visible.push(
        (
          await evidence(
            k.staffB.id,
            k.venue,
            new Date(Date.now() - 7_200_000 - i * 1000).toISOString()
          )
        ).id
      )
    await photo(k.staffA.id, k.venue) // portfolio only: never listed
    const reference = psql(
      `select string_agg(id::text, ',' order by created_at desc, id desc)
       from public.media_assets where id = any (array[${visible
         .map((id) => `'${id}'`)
         .join(",")}]::uuid[])`
    ).split(",")
    const paged = ids(await searchAll(k.manager, {}, 5))
    expect(paged).toEqual(reference)
    // The same through the app's service and its opaque cursor.
    const actor = await actorFor(k.manager)
    const viaService: string[] = []
    let cursor: string | null = null
    do {
      const page = await searchAssets(actor, { limit: 5, cursor })
      if (!page.ok) throw new Error(page.message)
      viaService.push(...page.items.map((i) => i.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(viaService).toEqual(reference)
  })

  it("keeps functions and helpers locked down and read only", () => {
    const fns = [
      "public.asset_search(jsonb,timestamptz,uuid,integer)",
      "public.asset_search_can_open(uuid)",
    ]
    for (const fn of fns) {
      expect(
        psql(
          `select concat_ws('|', p.provolatile, p.prosecdef) from pg_proc p where p.oid = '${fn}'::regprocedure`
        )
      ).toBe("s|t")
      expect(
        psql(
          `select concat_ws('|', has_function_privilege('authenticated', '${fn}', 'execute'),
             has_function_privilege('anon', '${fn}', 'execute'),
             has_function_privilege('service_role', '${fn}', 'execute'))`
        )
      ).toBe("t|f|f")
    }
    expect(
      psql(`select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname like 'asset\\_search\\_%'
          and (has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('service_role', p.oid, 'execute')
            or has_function_privilege('public', p.oid, 'execute'))`)
    ).toBe("0")
    expect(
      psql(`select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname like 'asset\\_search\\_%'`)
    ).toBe("5")
    // B05 perf repair 2: the planner settings hold for every call (without
    // them freshly packed evidence tables are read by a seq scan per row).
    expect(
      psql(
        `select array_to_string(p.proconfig, '|') from pg_proc p
          where p.oid = 'public.asset_search(jsonb,timestamptz,uuid,integer)'::regprocedure`
      )
    ).toBe(
      'search_path=""|plan_cache_mode=force_custom_plan|enable_seqscan=off|enable_bitmapscan=off'
    )
    expect(psql(`select count(*) from public.media_use_granters`)).toBe("0")
  })

  it("leaves the credit function byte-identical", () => {
    expect(
      psql(
        `select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`
      )
    ).toBe("595b567b933705e692d2f801d750b3fb")
  })
})

// Filter arms and outputs at the database (review R3, R4). Every assertion is
// scoped to assets this block created: other files leave rows in the shared
// world (L-B05-Q1).
describe("asset search filters at the database (B05-06b)", () => {
  let f: World
  const mine: Record<string, string> = {}
  let outdoorCheck: string
  let requirement: string
  let reqSubmission: string
  let pie: { itemId: string }
  let tart: { itemId: string }
  let korma: { itemId: string; variants: { variantId: string }[] }
  const T0 = "2021-06-01T10:00:00.000Z"
  const T1 = "2021-06-01T10:00:01.000Z"
  const TM = "2021-06-01T09:59:59.000Z"

  const own = (rows: Row[]) =>
    ids(rows).filter((id) => Object.values(mine).includes(id))
  const adminFind = async (filters: Record<string, unknown>) =>
    own(await searchAll(f.admin, { venue: f.venue, ...filters }))
  const adminRow = async (id: string, filters: Record<string, unknown> = {}) =>
    (await searchAll(f.admin, { venue: f.venue, ...filters })).find(
      (r) => r.id === id
    )!

  async function revisionOf(checkId: string): Promise<number> {
    const { data, error } = await service
      .from("venue_amenity_checks")
      .select("revision")
      .eq("id", checkId)
      .single()
    if (error) throw error
    return data!.revision
  }

  async function itemHead(itemId: string) {
    const { data, error } = await service
      .from("menu_item_photo_heads")
      .select("revision")
      .eq("item_id", itemId)
      .maybeSingle()
    if (error) throw error
    return data?.revision ?? 1
  }

  async function decide(
    asset: string,
    itemId: string,
    variantId: string | null,
    decision: "accepted" | "better_photo_requested"
  ) {
    await ok(
      f.staffManager.client.rpc("review_menu_item_photo", {
        p_asset_id: asset,
        p_item_id: itemId,
        p_variant_id: variantId as string,
        p_decision: decision,
        p_expected_revision: await itemHead(itemId),
        ...(decision === "better_photo_requested"
          ? { p_reason: "TEST too dark" }
          : {}),
        p_make_primary: false,
      })
    )
  }

  beforeAll(async () => {
    f = await world("b05-srch-f", { extra: ["outdoor_seating"] })
    outdoorCheck = f.checks.outdoor_seating!

    // Amenity arm only: a legacy finding on a check off the working list.
    await ok(
      f.manager.client.rpc("amenity_assign_check", {
        p_check_id: outdoorCheck,
        p_assignee_id: f.staffA.id,
        p_revision: await revisionOf(outdoorCheck),
      })
    )
    mine.amenity = await photo(f.staffA.id, f.venue)
    await ok(
      f.staffA.client.rpc("amenity_submit_finding", {
        p_check_id: outdoorCheck,
        p_revision: await revisionOf(outdoorCheck),
        p_idempotency_key: randomUUID(),
        p_answer: "yes",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: null as unknown as string,
        p_asset_ids: [mine.amenity],
        p_internal_metadata: null as never,
        p_redaction_confirmed: false,
      })
    )

    // Knowledge arm only: a proposal awaiting confirmation is never adopted
    // into an amenity submission.
    await submit(f.staffA, f, "guest_toilets", { answer: "no" })
    mine.knowledge = await photo(f.staffB.id, f.venue)
    const proposal = await submit(f.staffB, f, "guest_toilets", {
      kind: "change_report",
      answer: "yes",
      assets: [mine.knowledge],
    })
    expect(proposal.outcome).toBe("awaiting_confirmation")

    // Coverage arm: a submission item for a requirement.
    requirement = await createRequirement(f.admin, f.venue, {
      title: "TEST search requirement",
    })
    const covered = await insertAsset(service, {
      uploader: f.staffA.id,
      venue: f.venue,
    })
    mine.coverage = covered.id
    const itemId = await insertSubmittedItem(service, {
      asset: covered,
      venue: f.venue,
      author: f.staffA.id,
      submittedAt: new Date().toISOString(),
      requirement,
    })
    reqSubmission = psql(
      `select submission_id from public.coverage_submission_items where id = '${itemId}'`
    )

    // Menu decisions: two items on one asset, decided differently.
    const version = await publishMenu(
      f.admin,
      f.venue,
      menu("TEST search filters", [
        section("mains", "Mains", [
          item(`mains--pie-${run}`, "TEST Pie"),
          item(`mains--tart-${run}`, "TEST Tart"),
          item(`mains--korma-${run}`, "TEST Korma", {
            variants: ["Chicken", "Lamb"],
          }),
        ]),
      ])
    )
    const doc = (await readDocument(service, version)).byKey
    pie = doc[`mains--pie-${run}`]!
    tart = doc[`mains--tart-${run}`]!
    korma = doc[`mains--korma-${run}`]!
    const two = await reserveReady(service, f.staffB)
    await saveOk(f.staffB, {
      asset: two.id,
      revision: 0,
      items: [
        { itemId: pie.itemId, variantId: null },
        { itemId: tart.itemId, variantId: null },
      ],
      catalogue: version,
    })
    mine.twoDecisions = two.id
    await decide(two.id, pie.itemId, null, "accepted")
    await decide(two.id, tart.itemId, null, "better_photo_requested")
    // Labelled with Tart, never decided.
    const labelOnly = await reserveReady(service, f.staffB)
    await saveOk(f.staffB, {
      asset: labelOnly.id,
      revision: 0,
      items: [{ itemId: tart.itemId, variantId: null }],
      catalogue: version,
    })
    mine.labelOnly = labelOnly.id
    // Accepted for Korma/Chicken, then relabelled to Lamb: the Chicken
    // decision (now invalidated) is the only Chicken link left.
    const chicken = korma.variants[0]!.variantId
    const lamb = korma.variants[1]!.variantId
    const relabelled = await reserveReady(service, f.staffB)
    const saved = await saveOk(f.staffB, {
      asset: relabelled.id,
      revision: 0,
      items: [{ itemId: korma.itemId, variantId: chicken }],
      catalogue: version,
    })
    await decide(relabelled.id, korma.itemId, chicken, "accepted")
    await saveOk(f.staffB, {
      asset: relabelled.id,
      revision: saved!.revision,
      items: [{ itemId: korma.itemId, variantId: lamb }],
      catalogue: version,
    })
    mine.relabelled = relabelled.id

    // Media type and upload bounds.
    mine.video = await video(f.staffA.id, f.venue)
    for (const [key, at] of [
      ["atT0", T0],
      ["atT1", T1],
      ["beforeT0", TM],
    ] as const)
      mine[key] = (
        await insertAsset(service, {
          uploader: f.staffA.id,
          venue: f.venue,
          createdAt: at,
        })
      ).id
  })

  it("matches each arm of the check filter and reports checks and tasks", async () => {
    expect(await adminFind({ check: outdoorCheck })).toEqual([mine.amenity])
    expect(await adminFind({ check: f.checks.guest_toilets })).toEqual([
      mine.knowledge,
    ])
    expect(await adminFind({ check: requirement })).toEqual([mine.coverage])
    expect((await adminRow(mine.amenity)).subjects.checks).toEqual([
      {
        checkId: outdoorCheck,
        questionKey: "outdoor_seating",
        source: "amenity",
      },
    ])
    expect((await adminRow(mine.knowledge)).subjects.checks).toEqual([
      {
        checkId: f.checks.guest_toilets,
        questionKey: "guest_toilets",
        source: "knowledge",
      },
    ])
    const covered = await adminRow(mine.coverage)
    expect(covered.subjects.tasks).toEqual([
      { requirementId: requirement, submissionId: reqSubmission },
    ])
    expect(covered.subjects.checks).toEqual([])
  })

  it("shows a manager amenity and knowledge evidence through the amenity gate", async () => {
    // Neither asset is a manager-era upload, a menu photo or task evidence:
    // only the amenity_evidence_asset arm of the predicate admits them.
    for (const who of [f.manager, f.staffManager]) {
      const found = own(await searchAll(who, {}))
      expect(found).toEqual(
        expect.arrayContaining([mine.amenity, mine.knowledge])
      )
      for (const id of [mine.amenity, mine.knowledge])
        expect(
          (await call(who, "asset_search_can_open", { p_asset_id: id })).data
        ).toBe(true)
    }
    expect(
      (
        await call(f.manager, "asset_search_can_open", {
          p_asset_id: mine.atT0,
        })
      ).data
    ).toBe(false)
  })

  it("matches item and variant through menu decisions as well as labels", async () => {
    const chicken = korma.variants[0]!.variantId
    const lamb = korma.variants[1]!.variantId
    expect(await adminFind({ item: korma.itemId, variant: chicken })).toEqual([
      mine.relabelled,
    ])
    expect(await adminFind({ variant: lamb })).toEqual([mine.relabelled])
    expect((await adminFind({ item: tart.itemId })).sort()).toEqual(
      [mine.twoDecisions, mine.labelOnly].sort()
    )
    const row = await adminRow(mine.relabelled)
    expect(row.menuDecisions).toEqual([
      expect.objectContaining({
        itemId: korma.itemId,
        variantId: chicken,
        state: "invalidated",
      }),
    ])
  })

  it("needs one decision row for menuState together with item or variant", async () => {
    expect(
      await adminFind({ item: tart.itemId, menuState: "accepted" })
    ).toEqual([])
    expect(
      await adminFind({ item: pie.itemId, menuState: "accepted" })
    ).toEqual([mine.twoDecisions])
    expect(
      await adminFind({
        item: tart.itemId,
        menuState: "better_photo_requested",
      })
    ).toEqual([mine.twoDecisions])
    expect(
      await adminFind({ item: pie.itemId, menuState: "better_photo_requested" })
    ).toEqual([])
    // Labels never satisfy a menuState request.
    expect(
      await adminFind({
        variant: korma.variants[1]!.variantId,
        menuState: "invalidated",
      })
    ).toEqual([])
    expect(
      await adminFind({
        variant: korma.variants[0]!.variantId,
        menuState: "invalidated",
      })
    ).toEqual([mine.relabelled])
    expect((await adminFind({ menuState: "accepted" })).sort()).toEqual(
      [mine.twoDecisions].sort()
    )
    const row = await adminRow(mine.twoDecisions)
    expect(
      row.menuDecisions
        .map((d) => [d.itemId, d.variantId, d.state].join("|"))
        .sort()
    ).toEqual(
      [
        `${pie.itemId}||accepted`,
        `${tart.itemId}||better_photo_requested`,
      ].sort()
    )
  })

  it("filters by media type and by inclusive and exclusive upload bounds", async () => {
    expect(await adminFind({ mediaType: "video" })).toEqual([mine.video])
    expect(await adminFind({ mediaType: "image" })).not.toContain(mine.video)
    expect(await adminFind({ uploadedFrom: T0, uploadedBefore: T1 })).toEqual([
      mine.atT0,
    ])
    expect((await adminFind({ uploadedBefore: T1 })).sort()).toEqual(
      [mine.atT0, mine.beforeT0].sort()
    )
    expect(
      await adminFind({
        uploadedFrom: T1,
        uploadedBefore: "2021-06-02T00:00:00Z",
      })
    ).toEqual([mine.atT1])
  })
})

// ---------------------------------------------------------------------------
// B05 perf fix (contracts/b05-perf-search-fix-scope.md): the chunked search
// with the gate prefilter P against the body it replaced. The reference is the
// base commit's public.asset_search (frozen in fixtures/asset-search-v1.sql),
// created as pg_temp.asset_search_v1 inside a transaction that is always
// rolled back, so nothing persists (the private asset_search_% count stays 5).
// ---------------------------------------------------------------------------

const BASE_COMMIT = "7d2a783c"
const SEARCH_MIGRATION =
  "supabase/migrations/20261113140200_media_b05m4_asset_search.sql"
const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
// The base body, frozen: the base commit is not on main after a squash merge.
const REFERENCE_FIXTURE = fileURLToPath(
  new URL("./fixtures/asset-search-v1.sql", import.meta.url)
)
const REFERENCE_SHA256 =
  "6e1dc93758b42cf835a010934cc58e97cf7b82e5892851d13110050ab0538f59"

/** The function text `create function public.asset_search(` .. `$$;`. */
function searchFunction(src: string, where: string): string {
  const head = "create function public.asset_search("
  const start = src.indexOf(head)
  const end = src.indexOf("\n$$;", start)
  if (start < 0 || end < 0) throw new Error(`no asset_search in ${where}`)
  return src.slice(start, end + 4)
}

/** The base body of public.asset_search, renamed into pg_temp. Read from the
 * committed fixture (sha256 pinned); git only when the fixture is absent. */
function referenceDefinition(): string {
  let src: string
  if (existsSync(REFERENCE_FIXTURE)) {
    src = readFileSync(REFERENCE_FIXTURE, "utf8")
    const sha = createHash("sha256").update(src).digest("hex")
    if (sha !== REFERENCE_SHA256)
      throw new Error(`fixtures/asset-search-v1.sql changed (sha256 ${sha})`)
  } else {
    src = execFileSync(
      "git",
      ["-C", repoRoot, "show", `${BASE_COMMIT}:${SEARCH_MIGRATION}`],
      { encoding: "utf8" }
    )
  }
  return searchFunction(src, "the base").replace(
    "create function public.asset_search(",
    "create function pg_temp.asset_search_v1("
  )
}

// One call of either body; an error becomes {error: {code, message, detail}}.
// walk() pages both bodies from the same cursor, following the new body's
// last row, and records the first page where the jsonb text differs.
const HARNESS = `
create function pg_temp.search_call(p_new boolean, p_filters jsonb, p_at timestamptz, p_id uuid, p_limit integer)
returns jsonb language plpgsql as $f$
declare
  v_state text; v_message text; v_detail text;
begin
  if p_new then
    return public.asset_search(p_filters, p_at, p_id, p_limit);
  end if;
  return pg_temp.asset_search_v1(p_filters, p_at, p_id, p_limit);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('error', jsonb_build_object('code', v_state, 'message', v_message, 'detail', v_detail));
end $f$;
create function pg_temp.search_walk(p_filters jsonb, p_limit integer, p_max integer, p_at timestamptz, p_id uuid)
returns table (pages integer, rows integer, errors integer, bad jsonb) language plpgsql as $f$
declare
  v_new jsonb; v_old jsonb; v_last jsonb;
  v_pages integer := 0; v_rows integer := 0; v_errors integer := 0; v_bad jsonb;
begin
  loop
    v_new := pg_temp.search_call(true, p_filters, p_at, p_id, p_limit);
    v_old := pg_temp.search_call(false, p_filters, p_at, p_id, p_limit);
    v_pages := v_pages + 1;
    if v_new::text is distinct from v_old::text then
      v_bad := jsonb_build_object('filters', p_filters, 'limit', p_limit, 'page', v_pages,
        'at', p_at, 'id', p_id, 'new', left(v_new::text, 600), 'old', left(v_old::text, 600));
      exit;
    end if;
    if v_new ? 'error' then
      v_errors := v_errors + 1;
      exit;
    end if;
    v_rows := v_rows + jsonb_array_length(v_new -> 'items');
    exit when not (v_new ->> 'hasMore')::boolean or v_pages >= p_max;
    v_last := v_new -> 'items' -> -1;
    p_at := (v_last ->> 'uploadedAt')::timestamptz;
    p_id := (v_last ->> 'id')::uuid;
  end loop;
  return query select v_pages, v_rows, v_errors, v_bad;
end $f$;
create function pg_temp.search_ids(p_filters jsonb)
returns uuid[] language plpgsql as $f$
declare
  v_page jsonb; v_ids uuid[] := '{}'; v_at timestamptz; v_id uuid;
begin
  loop
    v_page := public.asset_search(p_filters, v_at, v_id, 48);
    v_ids := v_ids || array(select (x ->> 'id')::uuid from jsonb_array_elements(v_page -> 'items') x);
    exit when not (v_page ->> 'hasMore')::boolean;
    v_at := (v_page -> 'items' -> -1 ->> 'uploadedAt')::timestamptz;
    v_id := (v_page -> 'items' -> -1 ->> 'id')::uuid;
  end loop;
  return v_ids;
end $f$;
grant execute on all functions in schema pg_temp to authenticated;
`

type Case = {
  filters: unknown
  limits?: number[]
  max?: number
  at?: string | null
  id?: string | null
}
type Diff = { pages: number; rows: number; errors: number; bad: unknown[] }

/** As `user` (role authenticated, its JWT claims), in one rolled-back
 * transaction: every case at every limit through both bodies. `setup` runs
 * first as the owner (also rolled back). */
function compareBodies(user: string, cases: Case[], setup = ""): Diff {
  const rows = cases.flatMap((c) =>
    (c.limits ?? [1, 24, 48]).map((limit) => ({
      filters: c.filters,
      limit,
      max: c.max ?? (limit === 1 ? 30 : 40),
      at: c.at ?? null,
      id: c.id ?? null,
    }))
  )
  const out = psql(`begin;
    set local statement_timeout = 0;
    ${referenceDefinition()};
    ${HARNESS}
    ${setup}
    select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true) is null;
    set local role authenticated;
    select json_build_object(
        'pages', coalesce(sum(w.pages), 0), 'rows', coalesce(sum(w.rows), 0),
        'errors', coalesce(sum(w.errors), 0),
        'bad', coalesce(json_agg(w.bad) filter (where w.bad is not null), '[]'))
    from jsonb_array_elements($cases$${JSON.stringify(rows)}$cases$::jsonb) c,
      lateral pg_temp.search_walk(c -> 'filters', (c ->> 'limit')::int, (c ->> 'max')::int,
        (c ->> 'at')::timestamptz, (c ->> 'id')::uuid) w;
    rollback;`)
  return JSON.parse(out.split("\n").at(-1)!) as Diff
}

// The gate prefilter P as shipped: cut from public.asset_search in the
// migration (from "(v_admin or (" to the chunk's order by), with the caller
// constants substituted as asset_search computes them. A change to P in the
// migration is what this test evaluates.
const shippedP = (() => {
  const body = searchFunction(
    readFileSync(join(repoRoot, SEARCH_MIGRATION), "utf8"),
    "the migration"
  )
  const from = "(v_admin or ("
  const to =
    "\n        order by a.created_at desc, a.id desc\n        limit v_chunk"
  const s = body.indexOf(from)
  const e = body.indexOf(to, s)
  if (s < 0 || e < 0 || body.indexOf(from, s + 1) >= 0)
    throw new Error("prefilter P not found once in public.asset_search")
  return body
    .slice(s, e)
    .replaceAll("v_admin", "false")
    .replaceAll("v_is_manager", "k.is_manager")
    .replaceAll("v_uid", "k.uid")
    .replaceAll("v_has_active_check", "k.active_check")
    .replaceAll("v_can_review", "k.can_review")
})()

// P for one caller (constants as asset_search computes them; the claims are
// set by the caller of this SQL).
const prefilter = (venue: string) => `
  with k as (
    select (select auth.uid()) as uid, private.is_active_manager() as is_manager,
      private.menu_photo_can_review_unlabelled() as can_review,
      exists (select 1 from public.venue_amenity_checks c
        where c.venue_id = '${venue}' and c.status = 'active') as active_check)
  select a.id, private.asset_search_admits(a, false, '${venue}') as admitted,
    coalesce(${shippedP}, false) as p
  from public.media_assets a, k
  where a.venue_id = '${venue}'`

describe("asset search chunked evaluation equals the base body (B05 perf)", () => {
  let e: World
  let o: World
  let c: World
  const fx: Record<string, string> = {}
  let pie: { itemId: string }
  let korma: { itemId: string; variants: { variantId: string }[] }
  let requirement: string
  let reqSubmission: string
  let amenitySubmission: string
  let knowledgeContribution: string
  let otherSubmission: string
  // A coverage requirement at o that o's evidence answers, so the cross-venue
  // cost test passes a real requirement id to the check filter.
  let otherRequirement: string
  // An amenity submission and a knowledge contribution with evidence at o,
  // so the cross-venue cost test passes real ids for those sources.
  let otherAmenitySubmission: string
  let otherKnowledgeContribution: string
  let groupId: string
  let otherGroup: string
  let outdoorCheck: string
  let rejectedCursor: { at: string; id: string }
  // Chunk-world rows of the scheduled-grant fixtures (manager's).
  const chunkFx: Record<string, string[]> = {}
  let deletedCursor: { at: string; id: string }
  const T0 = "2021-07-01T10:00:00.000Z"
  const T1 = "2021-07-01T10:00:01.000Z"
  const DEST_C = `test_srcc_${run}`
  // A second chunk-world destination: grants scheduled there beside one in
  // force at DEST_C must not pass destination = DEST_C2.
  const DEST_C2 = `test_srcd_${run}`

  beforeAll(async () => {
    e = await world("b05-srch-e", { extra: ["outdoor_seating"] })
    o = await world("b05-srch-eo", { extra: ["outdoor_seating"] })
    outdoorCheck = e.checks.outdoor_seating!
    const revisionOf = (id: string) =>
      Number(
        psql(
          `select revision from public.venue_amenity_checks where id = '${id}'`
        )
      )

    // Own uploads: manager era, staff era (vetoed), and no stored role.
    fx.managerOwn = await asset(e.manager.id, e.venue, "manager")
    fx.managerStaffEra = await asset(e.manager.id, e.venue, "staff")
    fx.managerNoRole = await photo(e.manager.id, e.venue)
    fx.grantHolderOwn = await photo(e.staffManager.id, e.venue)
    fx.staffOnly = await photo(e.staffA.id, e.venue) // portfolio only

    // Menu: a labelled dish, a decided photo whose label went (decision row
    // only), food-tagged unlabelled image and video, kitchen-only and empty
    // labels.
    const version = await publishMenu(
      e.admin,
      e.venue,
      menu("TEST search e", [
        section("mains", "Mains", [
          item(`mains--pie-${run}`, "TEST Pie"),
          item(`mains--korma-${run}`, "TEST Korma", {
            variants: ["Chicken", "Lamb"],
          }),
        ]),
      ])
    )
    const doc = (await readDocument(service, version)).byKey
    pie = doc[`mains--pie-${run}`]!
    korma = doc[`mains--korma-${run}`]!
    const dish = await reserveReady(service, e.staffB)
    await saveOk(e.staffB, {
      asset: dish.id,
      revision: 0,
      items: [{ itemId: pie.itemId, variantId: null }],
      catalogue: version,
    })
    fx.labelled = dish.id
    const decided = await reserveReady(service, e.staffB)
    const saved = await saveOk(e.staffB, {
      asset: decided.id,
      revision: 0,
      items: [
        { itemId: korma.itemId, variantId: korma.variants[0]!.variantId },
      ],
      catalogue: version,
    })
    await ok(
      e.staffManager.client.rpc("review_menu_item_photo", {
        p_asset_id: decided.id,
        p_item_id: korma.itemId,
        p_variant_id: korma.variants[0]!.variantId,
        p_decision: "accepted",
        p_expected_revision: 1,
        p_make_primary: false,
      })
    )
    await saveOk(e.staffB, {
      asset: decided.id,
      revision: saved!.revision,
      types: ["kitchen"],
      items: [],
      catalogue: version,
    })
    fx.decisionOnly = decided.id
    // A variant on a label only (Lamb; Chicken is on a decision only), so the
    // variant filter's label and decision sides each have a row of their own.
    const lamb = await reserveReady(service, e.staffB)
    await saveOk(e.staffB, {
      asset: lamb.id,
      revision: 0,
      items: [
        { itemId: korma.itemId, variantId: korma.variants[1]!.variantId },
      ],
      catalogue: version,
    })
    fx.variantLabelOnly = lamb.id
    for (const [key, type, types] of [
      ["foodImage", "image", ["dish"]],
      ["foodVideo", "video", ["drinks"]],
      ["kitchenOnly", "image", ["kitchen"]],
      ["emptyLabel", "image", []],
    ] as const) {
      const r = await reserveReady(service, e.staffB, type)
      await saveOk(e.staffB, { asset: r.id, revision: 0, types: [...types] })
      fx[key] = r.id
    }

    // Task evidence: a coverage item for a requirement, and fact media.
    requirement = await createRequirement(e.admin, e.venue, {
      title: "TEST search e requirement",
    })
    const covered = await insertAsset(service, {
      uploader: e.staffA.id,
      venue: e.venue,
    })
    fx.coverage = covered.id
    const coverageItem = await insertSubmittedItem(service, {
      asset: covered,
      venue: e.venue,
      author: e.staffA.id,
      submittedAt: new Date().toISOString(),
      requirement,
    })
    reqSubmission = psql(
      `select submission_id from public.coverage_submission_items where id = '${coverageItem}'`
    )
    fx.factMedia = await photo(e.staffA.id, e.venue)
    const fact =
      psql(`insert into public.venue_amenity_facts (venue_id, amenity_key)
      values ('${e.venue}', 'outdoor_seating') returning id`)
    psql(`insert into public.venue_amenity_fact_media (fact_id, venue_id, asset_id)
      values ('${fact}', '${e.venue}', '${fx.factMedia}')`)

    // Amenity finding and knowledge contribution evidence.
    await ok(
      e.manager.client.rpc("amenity_assign_check", {
        p_check_id: outdoorCheck,
        p_assignee_id: e.staffA.id,
        p_revision: revisionOf(outdoorCheck),
      })
    )
    fx.amenity = await photo(e.staffA.id, e.venue)
    await ok(
      e.staffA.client.rpc("amenity_submit_finding", {
        p_check_id: outdoorCheck,
        p_revision: revisionOf(outdoorCheck),
        p_idempotency_key: randomUUID(),
        p_answer: "yes",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: null as unknown as string,
        p_asset_ids: [fx.amenity],
        p_internal_metadata: null as never,
        p_redaction_confirmed: false,
      })
    )
    amenitySubmission = psql(
      `select submission_id from public.amenity_submission_assets where asset_id = '${fx.amenity}'`
    )
    await submit(e.staffA, e, "guest_toilets", { answer: "no" })
    fx.knowledge = await photo(e.staffB.id, e.venue)
    await submit(e.staffB, e, "guest_toilets", {
      kind: "change_report",
      answer: "yes",
      assets: [fx.knowledge],
    })
    knowledgeContribution = psql(
      `select contribution_id from public.knowledge_contribution_assets where asset_id = '${fx.knowledge}'`
    )

    // Another venue's evidence and group (cross-venue filters).
    otherRequirement = await createRequirement(o.admin, o.venue, {
      title: "TEST search o requirement",
    })
    const otherEvidence = await evidence(
      o.staffA.id,
      o.venue,
      undefined,
      otherRequirement
    )
    fx.otherEvidence = otherEvidence.id
    otherSubmission = otherEvidence.submission
    const otherOutdoor = o.checks.outdoor_seating!
    await ok(
      o.manager.client.rpc("amenity_assign_check", {
        p_check_id: otherOutdoor,
        p_assignee_id: o.staffA.id,
        p_revision: revisionOf(otherOutdoor),
      })
    )
    fx.otherAmenity = await photo(o.staffA.id, o.venue)
    await ok(
      o.staffA.client.rpc("amenity_submit_finding", {
        p_check_id: otherOutdoor,
        p_revision: revisionOf(otherOutdoor),
        p_idempotency_key: randomUUID(),
        p_answer: "yes",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: null as unknown as string,
        p_asset_ids: [fx.otherAmenity],
        p_internal_metadata: null as never,
        p_redaction_confirmed: false,
      })
    )
    otherAmenitySubmission = psql(
      `select submission_id from public.amenity_submission_assets where asset_id = '${fx.otherAmenity}'`
    )
    await submit(o.staffA, o, "guest_toilets", { answer: "no" })
    fx.otherKnowledge = await photo(o.staffB.id, o.venue)
    await submit(o.staffB, o, "guest_toilets", {
      kind: "change_report",
      answer: "yes",
      assets: [fx.otherKnowledge],
    })
    otherKnowledgeContribution = psql(
      `select contribution_id from public.knowledge_contribution_assets where asset_id = '${fx.otherKnowledge}'`
    )

    // Groups: one at e with the coverage asset and a removed-from-gate member.
    groupId = randomUUID()
    otherGroup = randomUUID()
    psql(`insert into public.media_contribution_groups (id, venue_id, created_by, subject_kind, subject_id, client_group_key)
        values ('${groupId}', '${e.venue}', '${e.staffA.id}', 'none', null, 'TESTgre${run}'),
          ('${otherGroup}', '${o.venue}', '${o.staffA.id}', 'none', null, 'TESTgro${run}');
      insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
        values ('${groupId}', '${e.venue}', '${fx.coverage}', 1),
          ('${groupId}', '${e.venue}', '${fx.staffOnly}', 2),
          ('${otherGroup}', '${o.venue}', '${fx.otherEvidence}', 1)`)

    // Upload bounds, deleted and not-ready rows.
    fx.atT0 = (
      await insertAsset(service, {
        uploader: e.staffA.id,
        venue: e.venue,
        createdAt: T0,
      })
    ).id
    await insertSubmittedItem(service, {
      asset: { id: fx.atT0, created_at: T0 },
      venue: e.venue,
      author: e.staffA.id,
      submittedAt: new Date().toISOString(),
    })
    fx.notReady = (
      await insertAsset(service, {
        uploader: e.manager.id,
        venue: e.venue,
        ready: false,
      })
    ).id
    fx.deleted = await asset(e.manager.id, e.venue, "manager")
    psql(
      `update public.media_assets set deleted_at = now() where id = '${fx.deleted}'`
    )

    // Chunk world: 560 manager-era uploads in blocks of 60 equal times, 534
    // of them with a grant in force, so rights=not_granted reads past the
    // 25, 125 and 525 row chunk edges (ties straddle each). Staff-era
    // uploads (vetoed), not-ready and deleted rows are interleaved. The
    // staff grant holder's own 600 uploads share those instants (its own
    // upload arm, a check being active) with the same grant pattern by its
    // own rank, so its walks cross the same edges while the manager's rows
    // are ones P drops for it, and the other way round. Scheduled grants
    // (effective_from tomorrow) settle nothing: alone on not_granted ranks at
    // the edges, beside expired grants and beside one in force, and on
    // legacy rows (created before the use cutover, 8 a caller), so the exact
    // rights SQL's "settled" and expired probes depend on effective_from.
    c = await world("b05-srch-c")
    psql(`insert into public.media_use_destinations
        (key, label, audience, venue_id, owner_workstream, requires_derivative, active) values
      ('${DEST_C}', 'TEST search chunks ${run}', 'internal', '${c.venue}', 'WS5', false, true),
      ('${DEST_C2}', 'TEST search chunks two ${run}', 'internal', '${c.venue}', 'WS5', false, true)`)
    psql(`
      create temp table chunk_rows as
        select gen_random_uuid() as id, n,
          now() - (((n % 600) / 60) * interval '1 second') as created_at,
          case when n >= 600 then '${c.staffManager.id}' else '${c.manager.id}' end::uuid as uploader,
          case when n >= 600 or n % 37 = 5 then 'staff' else 'manager' end as role
        from generate_series(0, 1199) n;
      insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename,
          media_type, size_bytes, client_upload_key, uploader_role, created_at)
        select r.id, r.uploader, '${c.venue}',
          r.uploader || '/' || r.id || '/original.jpg', 'TEST chunk.jpg', 'image', 4,
          gen_random_uuid(), r.role::public.app_role, r.created_at
        from chunk_rows r;
      update public.media_assets set upload_state = 'processing'
        where id in (select id from chunk_rows where n % 53 <> 7);
      update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg',
          size_bytes = 4, width = 1, height = 1
        where id in (select id from chunk_rows where n % 53 <> 7);
      update public.media_assets set deleted_at = now()
        where id in (select id from chunk_rows where n % 41 = 3);
      -- Ranks in feed order among the rows the manager can see, and among
      -- the grant holder's own.
      create temp table chunk_ranked as
        select a.id, (row_number() over (partition by a.uploader_id
            order by a.created_at desc, a.id desc) - 1)::int as rank
        from public.media_assets a
        where a.venue_id = '${c.venue}' and a.deleted_at is null and a.upload_state = 'ready'
          and a.original_filename = 'TEST chunk.jpg'
          and ((a.uploader_id = '${c.manager.id}' and a.uploader_role = 'manager')
            or a.uploader_id = '${c.staffManager.id}');
      insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
          subject_kind, effective_from, effective_until, authorised_by, authority_basis,
          clearance_version, clearance, request_key)
        select r.id, '${c.venue}', '${DEST_C}', 'internal', 'general_gallery', 'none',
          now() - interval '2 hours', null, '${c.admin.id}', 'admin', '${VERSION}', '{"a_ok": true}',
          'TESTchunk' || replace(r.id::text, '-', '')
        from chunk_ranked r
        where r.rank not in (24, 25, 26, 124, 125, 126, 524, 525) and r.rank < 530;
      -- withdrawn: a withdrawn grant beside one in force (still granted), and alone.
      -- A second grant of an asset gets its own created_at: "destinations"
      -- orders by label and created_at only, so equal pairs have no fixed
      -- order (it follows the plan) and could not be compared.
      insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
          subject_kind, effective_from, effective_until, authorised_by, authority_basis,
          clearance_version, clearance, request_key, created_at)
        select r.id, '${c.venue}', '${DEST_C}', 'internal', 'general_gallery', 'none',
          now() - interval '2 hours',
          case when r.rank between 200 and 205 or r.rank >= 534 then now() - interval '1 hour' end,
          '${c.admin.id}', 'admin', '${VERSION}', '{"a_ok": true}',
          'TESTchunkw' || replace(r.id::text, '-', ''), now() - interval '1 minute'
        from chunk_ranked r
        where r.rank between 100 and 110 or r.rank between 530 and 533
          or r.rank between 200 and 205 or r.rank between 534 and 537;
      insert into public.media_use_grant_withdrawals (grant_id, withdrawn_by, reason_code)
        select g.id, '${c.admin.id}', 'granter_withdrawn'
        from public.media_use_grants g join chunk_ranked r on r.id = g.asset_id
        where g.request_key like 'TESTchunkw%'
          and (r.rank between 100 and 110 or r.rank between 530 and 533);
      -- scheduled: alone (not_granted at the edges), beside an expired grant
      -- (536, 537: expired), beside one in force (10: granted).
      insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
          subject_kind, effective_from, effective_until, authorised_by, authority_basis,
          clearance_version, clearance, request_key, created_at)
        select r.id, '${c.venue}', '${DEST_C}', 'internal', 'general_gallery', 'none',
          now() + interval '1 day', null, '${c.admin.id}', 'admin', '${VERSION}', '{"a_ok": true}',
          'TESTchunks' || replace(r.id::text, '-', ''), now() - interval '2 minutes'
        from chunk_ranked r
        where r.rank in (10, 25, 125, 525, 536, 537, 540, 541);
      -- scheduled beside a withdrawn grant (531, 532: still withdrawn, the
      -- scheduled one is not in force), and at DEST_C2 beside one in force at
      -- DEST_C (23, 27, 123, 127, 523: in force, but not at DEST_C2); 300
      -- and 301 also hold one in force at DEST_C2.
      insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
          subject_kind, effective_from, effective_until, authorised_by, authority_basis,
          clearance_version, clearance, request_key, created_at)
        select r.id, '${c.venue}',
          case when r.rank in (531, 532) then '${DEST_C}' else '${DEST_C2}' end,
          'internal', 'general_gallery', 'none',
          case when r.rank in (300, 301) then now() - interval '2 hours' else now() + interval '1 day' end,
          null, '${c.admin.id}', 'admin', '${VERSION}', '{"a_ok": true}',
          'TESTchunkd' || replace(r.id::text, '-', ''), now() - interval '4 minutes'
        from chunk_ranked r
        where r.rank in (23, 27, 123, 127, 300, 301, 523, 531, 532);
      -- Legacy rows: n % 8 = 0-1 no grant, 2-3 scheduled only, 4-5 scheduled
      -- and expired, 6-7 in force; 0-7 the manager's, 8-15 the grant holder's.
      create temp table chunk_legacy as
        select gen_random_uuid() as id, n,
          (select s.cutover_at from private.media_use_settings s)
            - interval '1 day' - ((n % 4) * interval '1 second') as created_at,
          case when n >= 8 then '${c.staffManager.id}' else '${c.manager.id}' end::uuid as uploader,
          case when n >= 8 then 'staff' else 'manager' end as role
        from generate_series(0, 15) n;
      insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename,
          media_type, size_bytes, client_upload_key, uploader_role, created_at)
        select r.id, r.uploader, '${c.venue}',
          r.uploader || '/' || r.id || '/original.jpg', 'TEST chunk legacy.jpg', 'image', 4,
          gen_random_uuid(), r.role::public.app_role, r.created_at
        from chunk_legacy r;
      update public.media_assets set upload_state = 'processing'
        where id in (select id from chunk_legacy);
      update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg',
          size_bytes = 4, width = 1, height = 1
        where id in (select id from chunk_legacy);
      insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
          subject_kind, effective_from, effective_until, authorised_by, authority_basis,
          clearance_version, clearance, request_key, created_at)
        select r.id, '${c.venue}'::uuid, '${DEST_C}'::text, 'internal'::text,
          'general_gallery'::text, 'none'::text,
          case when r.n % 8 between 2 and 5 then now() + interval '1 day'
            when r.n % 8 >= 6 then now() - interval '2 hours' end,
          null::timestamptz, '${c.admin.id}'::uuid, 'admin'::text, '${VERSION}'::text,
          '{"a_ok": true}'::jsonb,
          'TESTchunkl' || replace(r.id::text, '-', ''), now()
        from chunk_legacy r where r.n % 8 >= 2
        union all
        select r.id, '${c.venue}', '${DEST_C}', 'internal', 'general_gallery', 'none',
          now() - interval '2 hours', now() - interval '1 hour', '${c.admin.id}', 'admin',
          '${VERSION}', '{"a_ok": true}', 'TESTchunkx' || replace(r.id::text, '-', ''),
          now() - interval '3 minutes'
        from chunk_legacy r where r.n % 8 between 4 and 5;
      select 1`)
    for (const [key, sql] of [
      [
        "scheduledNone",
        `select string_agg(g.asset_id::text, ',' order by g.asset_id) from public.media_use_grants g
          join public.media_assets a on a.id = g.asset_id
          where g.request_key like 'TESTchunks%' and a.uploader_id = '${c.manager.id}'
            and not exists (select 1 from public.media_use_grants o where o.asset_id = g.asset_id and o.id <> g.id)`,
      ],
      [
        "scheduledExpired",
        `select string_agg(g.asset_id::text, ',' order by g.asset_id) from public.media_use_grants g
          join public.media_assets a on a.id = g.asset_id
          where g.request_key like 'TESTchunks%' and a.uploader_id = '${c.manager.id}'
            and exists (select 1 from public.media_use_grants o where o.asset_id = g.asset_id
              and o.effective_until is not null and o.effective_until <= now())`,
      ],
      [
        "withdrawnScheduled",
        `select string_agg(g.asset_id::text, ',' order by g.asset_id) from public.media_use_grants g
          join public.media_assets a on a.id = g.asset_id
          where g.request_key like 'TESTchunkd%' and a.uploader_id = '${c.manager.id}'
            and g.effective_from > now()
            and exists (select 1 from public.media_use_grants o
              join public.media_use_grant_withdrawals w on w.grant_id = o.id where o.asset_id = g.asset_id)`,
      ],
      [
        "scheduledElsewhere",
        `select string_agg(g.asset_id::text, ',' order by g.asset_id) from public.media_use_grants g
          join public.media_assets a on a.id = g.asset_id
          where g.request_key like 'TESTchunkd%' and a.uploader_id = '${c.manager.id}'
            and g.destination_key = '${DEST_C2}' and g.effective_from > now()`,
      ],
      [
        "inForceC2",
        `select string_agg(g.asset_id::text, ',' order by g.asset_id) from public.media_use_grants g
          join public.media_assets a on a.id = g.asset_id
          where g.request_key like 'TESTchunkd%' and a.uploader_id = '${c.manager.id}'
            and g.destination_key = '${DEST_C2}' and g.effective_from <= now()`,
      ],
      [
        "legacyOpen",
        `select string_agg(a.id::text, ',' order by a.id) from public.media_assets a
          where a.original_filename = 'TEST chunk legacy.jpg' and a.uploader_id = '${c.manager.id}'
            and a.use_baseline = 'legacy_unknown'
            and not exists (select 1 from public.media_use_grants g where g.asset_id = a.id)`,
      ],
      [
        "legacyScheduled",
        `select string_agg(a.id::text, ',' order by a.id) from public.media_assets a
          where a.original_filename = 'TEST chunk legacy.jpg' and a.uploader_id = '${c.manager.id}'
            and a.use_baseline = 'legacy_unknown'
            and exists (select 1 from public.media_use_grants g where g.asset_id = a.id
              and g.effective_from > now())`,
      ],
      [
        "legacyScheduledExpired",
        `select string_agg(a.id::text, ',' order by a.id) from public.media_assets a
          where a.original_filename = 'TEST chunk legacy.jpg' and a.uploader_id = '${c.manager.id}'
            and a.use_baseline = 'legacy_unknown'
            and exists (select 1 from public.media_use_grants g where g.asset_id = a.id
              and g.effective_from > now())
            and exists (select 1 from public.media_use_grants g where g.asset_id = a.id
              and g.effective_until <= now())`,
      ],
    ] as const)
      chunkFx[key] = (psql(sql) || "").split(",").filter(Boolean)
    const pick = (rank: number) =>
      psql(`select a.id || '|' || (to_json(a.created_at) #>> '{}')
        from public.media_assets a
        where a.venue_id = '${c.venue}' and a.deleted_at is null and a.upload_state = 'ready'
          and a.uploader_role = 'manager' and a.original_filename = 'TEST chunk.jpg'
        order by a.created_at desc, a.id desc offset ${rank} limit 1`).split(
        "|"
      )
    const [rid, rat] = pick(60)
    rejectedCursor = { id: rid!, at: rat! }
    const del = psql(`select a.id || '|' || (to_json(a.created_at) #>> '{}')
      from public.media_assets a
      where a.venue_id = '${c.venue}' and a.deleted_at is not null
      order by a.created_at desc, a.id desc offset 2 limit 1`).split("|")
    deletedCursor = { id: del[0]!, at: del[1]! }
  }, 300_000)

  const matrix = (): Case[] => {
    const chicken = korma.variants[0]!.variantId
    return [
      { filters: {}, limits: [1, 2, 24, 48] },
      { filters: { venue: e.venue } },
      { filters: { venue: o.venue } },
      { filters: { venue: randomUUID() } },
      { filters: { mediaType: "image" } },
      { filters: { mediaType: "video" } },
      { filters: { uploadedFrom: T0, uploadedBefore: T1 } },
      { filters: { uploadedFrom: T0, uploadedBefore: T0 } },
      { filters: { uploadedBefore: T1 } },
      { filters: { uploadedFrom: T1 } },
      { filters: { item: pie.itemId } },
      { filters: { item: korma.itemId } },
      { filters: { variant: chicken } },
      { filters: { variant: korma.variants[1]!.variantId } },
      { filters: { variant: randomUUID() } },
      { filters: { item: korma.itemId, variant: chicken } },
      // Item candidate list: label side only (Lamb), no rows for the pair,
      // and an unknown item.
      {
        filters: { item: korma.itemId, variant: korma.variants[1]!.variantId },
      },
      { filters: { item: pie.itemId, variant: chicken } },
      { filters: { item: randomUUID() } },
      { filters: { item: korma.itemId, menuState: "accepted" } },
      { filters: { item: korma.itemId, menuState: "invalidated" } },
      ...[
        "accepted",
        "better_photo_requested",
        "needs_recheck",
        "withdrawn",
        "invalidated",
      ].map((s) => ({ filters: { menuState: s } })),
      { filters: { check: outdoorCheck } },
      { filters: { check: e.checks.guest_toilets } },
      { filters: { check: requirement } },
      { filters: { check: o.checks.guest_toilets } },
      { filters: { check: randomUUID() } },
      { filters: { submission: { source: "coverage", id: reqSubmission } } },
      { filters: { submission: { source: "amenity", id: amenitySubmission } } },
      {
        filters: {
          submission: { source: "knowledge", id: knowledgeContribution },
        },
      },
      { filters: { submission: { source: "amenity", id: reqSubmission } } },
      { filters: { submission: { source: "coverage", id: otherSubmission } } },
      { filters: { submission: { source: "knowledge", id: randomUUID() } } },
      { filters: { group: groupId } },
      { filters: { group: otherGroup } },
      { filters: { group: randomUUID() } },
      ...[
        "legacy_unknown",
        "not_granted",
        "in_force",
        "expired",
        "withdrawn",
      ].map((r) => ({ filters: { rights: r } })),
      { filters: { rights: "in_force", destination: DEST } },
      { filters: { rights: "in_force", destination: DEST_C } },
      { filters: { check: requirement, rights: "not_granted" } },
      { filters: { group: groupId, item: pie.itemId } },
      {
        filters: {
          mediaType: "image",
          uploadedFrom: T0,
          rights: "legacy_unknown",
        },
      },
      {
        filters: {
          check: requirement,
          submission: { source: "coverage", id: reqSubmission },
        },
      },
      {
        filters: {
          item: korma.itemId,
          menuState: "accepted",
          rights: "not_granted",
        },
      },
      // Cursors: past the end, on a rejected row, on a deleted row.
      { filters: {}, at: "2000-01-01T00:00:00Z", id: randomUUID() },
      { filters: {}, at: rejectedCursor.at, id: rejectedCursor.id },
      { filters: {}, at: deletedCursor.at, id: deletedCursor.id },
    ]
  }

  // Several faults at once: which error wins must not change.
  const faults = (): Case[] =>
    [
      { filters: { freshness: "x" }, at: "2026-01-01T00:00:00Z" },
      { filters: [] },
      { filters: "x" },
      { filters: { venue: "nope", rights: "granted" } },
      { filters: { venue: o.venue, destination: "Bad dest!" } },
      {
        filters: { venue: randomUUID(), rights: "in_force", destination: DEST },
      },
      { filters: { destination: DEST } },
      { filters: { submission: "x", rights: "nope" } },
      { filters: { submission: { source: "coverage" } } },
      { filters: { submission: { source: "bad", id: "nope" } } },
      { filters: { submission: { source: "coverage", id: "x", more: 1 } } },
      { filters: { uploadedFrom: "2026-11-11", venue: o.venue } },
      { filters: { uploadedFrom: "2026-02-30T00:00:00Z" } },
      { filters: { mediaType: "gif", item: "bad" } },
      { filters: { check: randomUUID(), venue: "nope" } },
      { filters: { check: randomUUID(), rights: "granted" } },
      { filters: { group: randomUUID(), uploadedBefore: 5 } },
      { filters: { check: randomUUID() }, id: randomUUID() },
    ].map((c) => ({ ...c, limits: [24] }))

  // rows: whether the walks must return rows at all (refused callers and
  // fault cases return none).
  const expectSame = (d: Diff, rows = true) => {
    expect(d.bad).toEqual([])
    expect(d.pages).toBeGreaterThan(0)
    if (rows) expect(d.rows).toBeGreaterThan(0)
  }

  it("returns what the base body returns for every caller, filter and page", () => {
    const callers = [e.admin, e.manager, e.staffManager, o.manager]
    let rows = 0
    for (const who of callers) {
      const d = compareBodies(who.id, matrix())
      expectSame(d)
      rows += d.rows
    }
    // The admin again, scoped to the fixture venue.
    const scoped = matrix().map((m) => ({
      ...m,
      filters: { venue: e.venue, ...(m.filters as object) },
    }))
    const d = compareBodies(e.admin.id, scoped)
    expectSame(d)
    expect(rows + d.rows).toBeGreaterThan(100)
  }, 600_000)

  it("matches the base body for refused callers and a grant revoked mid-session", () => {
    const cases = [...matrix().slice(0, 6), ...faults()]
    for (const [who, setup] of [
      [e.staffA.id, ""],
      [
        e.staffB.id,
        `update public.profiles set active = false where id = '${e.staffB.id}';`,
      ],
      [
        e.staffManager.id,
        `update public.venue_manager_grants
           set revoked_at = now(), revoke_kind = 'revoked', revoked_by = '${e.admin.id}',
             revoke_reason = 'TEST mid-session'
           where staff_id = '${e.staffManager.id}' and revoked_at is null;`,
      ],
    ] as const) {
      const d = compareBodies(who, cases, setup)
      expectSame(d, false)
      expect(d.errors).toBe(d.pages)
    }
  }, 300_000)

  it("keeps error precedence and lets validation win over an empty candidate list", () => {
    for (const who of [e.admin, e.manager, e.staffManager]) {
      const d = compareBodies(who.id, faults())
      expectSame(d, false)
      expect(d.errors).toBe(faults().length)
    }
  }, 300_000)

  it("short-circuits an empty candidate list to an empty page", async () => {
    for (const who of [e.admin, e.manager, e.staffManager]) {
      for (const filters of [
        { check: randomUUID() },
        { group: randomUUID() },
        { submission: { source: "amenity", id: randomUUID() } },
        { check: randomUUID(), rights: "in_force" },
      ])
        expect(await search(who, { p_filters: filters })).toEqual({
          hasMore: false,
          items: [],
        })
    }
    await refused(
      e.manager,
      "asset_search",
      { p_filters: { check: randomUUID(), venue: "nope" } },
      "invalid_search_filter",
      "22023"
    )
    await refused(
      e.manager,
      "asset_search",
      { p_filters: { group: randomUUID(), venue: o.venue } },
      "wrong_venue",
      "42501"
    )
  })

  // Another venue's check, submission or group must cost what an unknown id
  // costs: its candidate list reads no evidence or group rows (only the key
  // lookup that finds it is not at the searched venue). Measured with this
  // transaction's own table counters.
  it("reads no evidence or group rows for another venue's check, submission or group", () => {
    const tables = [
      "amenity_submission_assets",
      "knowledge_contribution_assets",
      "coverage_submission_items",
      "media_contribution_group_members",
      "amenity_submissions",
      "knowledge_contributions",
    ]
    const reads = (who: Who, filters: unknown) =>
      JSON.parse(
        asUser(
          who.id,
          `select public.asset_search('${JSON.stringify(filters)}'::jsonb, null, null, 24) is not null;
          select json_object_agg(t.relname, coalesce(t.seq_scan, 0) + coalesce(t.idx_scan, 0)
              order by t.relname)
            from pg_stat_xact_user_tables t
            where t.schemaname = 'public' and t.relname in (${tables.map((x) => `'${x}'`).join(", ")})`
        ) || "{}"
      ) as Record<string, number>
    const touched = (r: Record<string, number>, names: string[]) =>
      names.filter((n) => (r[n] ?? 0) > 0)
    const foreign: [string, unknown, unknown][] = [
      ["check", { check: o.checks.guest_toilets }, { check: randomUUID() }],
      [
        "coverage submission",
        { submission: { source: "coverage", id: otherSubmission } },
        { submission: { source: "coverage", id: randomUUID() } },
      ],
      [
        "amenity submission",
        { submission: { source: "amenity", id: otherAmenitySubmission } },
        { submission: { source: "amenity", id: randomUUID() } },
      ],
      [
        "knowledge submission",
        { submission: { source: "knowledge", id: otherKnowledgeContribution } },
        { submission: { source: "knowledge", id: randomUUID() } },
      ],
      [
        "amenity check",
        { check: o.checks.outdoor_seating },
        { check: randomUUID() },
      ],
      ["group", { group: otherGroup }, { group: randomUUID() }],
      [
        "coverage requirement",
        { check: otherRequirement },
        { check: randomUUID() },
      ],
    ]
    // The other venue really holds evidence for each of these ids (none of
    // them may become an unknown-id case).
    expect(
      psql(`select concat_ws(',',
          (select count(*) from public.coverage_submission_items where submission_id = '${otherSubmission}' and venue_id = '${o.venue}'),
          (select count(*) from public.amenity_submission_assets where submission_id = '${otherAmenitySubmission}' and venue_id = '${o.venue}'),
          (select count(*) from public.knowledge_contribution_assets where contribution_id = '${otherKnowledgeContribution}' and venue_id = '${o.venue}'),
          (select count(*) from public.amenity_submission_assets sa join public.amenity_submissions s on s.id = sa.submission_id
            where s.check_id = '${o.checks.outdoor_seating}' and sa.venue_id = '${o.venue}'),
          (select count(*) from public.knowledge_contribution_assets ka join public.knowledge_contributions kc on kc.id = ka.contribution_id
            where kc.check_id = '${o.checks.guest_toilets}' and ka.venue_id = '${o.venue}'),
          (select count(*) from public.media_contribution_group_members where group_id = '${otherGroup}'),
          (select count(*) from public.coverage_submission_items ci join public.coverage_requirements r on r.id = ci.requirement_id
            where ci.requirement_id = '${otherRequirement}' and ci.venue_id = '${o.venue}' and r.venue_id = '${o.venue}'))`)
        .split(",")
        .map((n) => Number(n) > 0)
    ).toEqual([true, true, true, true, true, true, true])
    expect(foreign).toHaveLength(7)
    const links = tables.slice(0, 4)
    for (const who of [e.manager, e.staffManager]) {
      for (const [label, theirs, unknown] of foreign) {
        const r = reads(who, theirs)
        expect(touched(r, links), `${label} (link tables)`).toEqual([])
        expect(r, label).toEqual(reads(who, unknown))
      }
      // Sanity: the counters see the reads of an id at the caller's venue.
      expect(
        touched(reads(who, { check: requirement }), links).length
      ).toBeGreaterThan(0)
      expect(
        touched(
          reads(who, {
            submission: { source: "amenity", id: amenitySubmission },
          }),
          links
        )
      ).toContain("amenity_submission_assets")
      expect(
        touched(
          reads(who, {
            submission: { source: "knowledge", id: knowledgeContribution },
          }),
          links
        )
      ).toContain("knowledge_contribution_assets")
    }
  })

  // The chunk-edge walks run one caller per test: each compares every page
  // with the slow base body, and together they outran one 600 s limit on the
  // hosted runner. Cases and coverage are unchanged.
  const chunkEdgeCases = (): Case[] =>
    [
      { filters: {} },
      ...[
        "not_granted",
        "in_force",
        "legacy_unknown",
        "withdrawn",
        "expired",
      ].map((r) => ({ filters: { rights: r } })),
      { filters: { rights: "in_force", destination: DEST_C } },
      { filters: { rights: "in_force", destination: DEST_C2 } },
      { filters: { rights: "not_granted", mediaType: "image" } },
      {
        filters: { rights: "not_granted" },
        at: rejectedCursor.at,
        id: rejectedCursor.id,
      },
      {
        filters: { rights: "withdrawn" },
        at: rejectedCursor.at,
        id: rejectedCursor.id,
      },
      { filters: {}, at: deletedCursor.at, id: deletedCursor.id },
      {
        filters: { rights: "not_granted" },
        at: deletedCursor.at,
        id: deletedCursor.id,
      },
    ].map((x) => ({ ...x, limits: [1, 2, 24, 48], max: 40 }))

  // Each caller's walks return rows across the edges (the grant holder's
  // through its own uploads, the manager's through its manager-era ones).
  // The grant holder walks at 24 and 48 a page (22 pages of 24 pass the
  // 525 edge); limit 1 and 2 are the manager's and the admin's.
  // The manager's and the admin's walks run in two tests each, one per pair
  // of page sizes: all four sizes in one test outran 600 s on the hosted
  // firefox runner. Together they cover the same cases and limits.
  const pageSizes = [
    { name: "1 and 2 a page", limits: [1, 2] },
    { name: "24 and 48 a page", limits: [24, 48] },
  ]

  it.each(pageSizes)(
    "crosses chunk edges with equal times and cursors on rejected or deleted rows: manager account, $name",
    ({ limits }) => {
      const d = compareBodies(
        c.manager.id,
        chunkEdgeCases().map((x) => ({ ...x, limits }))
      )
      expectSame(d)
      expect(d.rows, c.manager.id).toBeGreaterThan(limits[0] === 1 ? 0 : 500)
    },
    600_000
  )

  it("crosses chunk edges with equal times and cursors on rejected or deleted rows: legacy grant holder", () => {
    const d = compareBodies(
      c.staffManager.id,
      chunkEdgeCases().map((x) => ({ ...x, limits: [24, 48], max: 25 }))
    )
    expectSame(d)
    expect(d.rows, c.staffManager.id).toBeGreaterThan(500)
  }, 600_000)

  it.each(pageSizes)(
    "crosses chunk edges with equal times and cursors on rejected or deleted rows: admin, $name",
    ({ limits }) => {
      expectSame(
        compareBodies(
          c.admin.id,
          chunkEdgeCases().map((x) => ({
            ...x,
            limits,
            filters: { venue: c.venue, ...(x.filters as object) },
          }))
        )
      )
    },
    600_000
  )

  it("pages not_granted across the granted ranks and keeps scheduled grants unsettled", () => {
    // The not_granted pages hold the rows at ranks 24-26, 124-126, 524-525,
    // then 538 on (the SQL rights terms skip the granted ranks between), for
    // the manager and for the grant holder alike.
    for (const who of [c.manager, c.staffManager]) {
      const page = (after: { at: string; id: string } | null, limit: number) =>
        JSON.parse(
          asUser(
            who.id,
            `select public.asset_search('{"rights":"not_granted"}', ${
              after ? `'${after.at}'` : "null"
            }, ${after ? `'${after.id}'` : "null"}, ${limit})`
          )
        ) as Page
      const first = page(null, 3)
      expect(first.items).toHaveLength(3)
      const second = page(
        {
          at: first.items[2]!.uploadedAt,
          id: first.items[2]!.id,
        },
        5
      )
      expect(second.items).toHaveLength(5)
      expect(second.hasMore).toBe(true)
    }
    // A scheduled grant settles nothing: rows whose only grants are
    // scheduled stay not_granted or legacy_unknown, and one beside an
    // expired grant stays expired (the walks above compare those filters
    // with the base body; these check the fixtures really are in them).
    const walk = (filters: unknown) => {
      const out: string[] = []
      let after: { at: string; id: string } | null = null
      for (let i = 0; i < 20; i++) {
        const p = JSON.parse(
          asUser(
            c.manager.id,
            `select public.asset_search('${JSON.stringify(filters)}', ${
              after ? `'${after.at}'` : "null"
            }, ${after ? `'${after.id}'` : "null"}, 48)`
          )
        ) as Page
        out.push(...p.items.map((x) => x.id))
        if (!p.hasMore) return out
        const last = p.items.at(-1)!
        after = { at: last.uploadedAt, id: last.id }
      }
      throw new Error("walk did not end in 20 pages")
    }
    expect(chunkFx.scheduledNone).toHaveLength(5)
    expect(chunkFx.scheduledExpired).toHaveLength(2)
    expect(chunkFx.legacyOpen).toHaveLength(2)
    expect(chunkFx.legacyScheduled).toHaveLength(4)
    expect(chunkFx.legacyScheduledExpired).toHaveLength(2)
    expect(chunkFx.withdrawnScheduled).toHaveLength(2)
    expect(chunkFx.scheduledElsewhere).toHaveLength(5)
    expect(chunkFx.inForceC2).toHaveLength(2)
    const notGranted = walk({ rights: "not_granted" })
    expect(notGranted).toEqual(expect.arrayContaining(chunkFx.scheduledNone!))
    const legacy = walk({ rights: "legacy_unknown" })
    expect([...legacy].sort()).toEqual(
      [...chunkFx.legacyOpen!, ...chunkFx.legacyScheduled!].sort()
    )
    // A scheduled grant is not in force: beside a withdrawn grant the row
    // stays withdrawn, and one scheduled at DEST_C2 beside one in force at
    // DEST_C does not pass destination = DEST_C2.
    const withdrawn = walk({ rights: "withdrawn" })
    expect(withdrawn).toEqual(
      expect.arrayContaining(chunkFx.withdrawnScheduled!)
    )
    expect(
      [...walk({ rights: "in_force", destination: DEST_C2 })].sort()
    ).toEqual([...chunkFx.inForceC2!].sort())
    expect(walk({ rights: "in_force" })).toEqual(
      expect.arrayContaining(chunkFx.scheduledElsewhere!)
    )
    const expired = walk({ rights: "expired" })
    expect(expired).toEqual(
      expect.arrayContaining([
        ...chunkFx.scheduledExpired!,
        ...chunkFx.legacyScheduledExpired!,
      ])
    )
  }, 600_000)

  // With the shipped helpers the gate refuses no row P keeps (P is the gate
  // for these callers), so every page ends inside its first chunk. A
  // stricter gate, installed as the owner in the rolled-back transaction,
  // refuses three rows in four by id hash; both bodies call it, so the
  // comparison stays exact while refused rows straddle every chunk edge:
  // the x4 growth, the resume after the last row read and the exit on a
  // short chunk all run.
  const STRICT_GATE = `
    set local track_functions = 'all';
    alter function private.asset_search_admits(public.media_assets, boolean, uuid)
      rename to asset_search_admits_shipped;
    create function private.asset_search_admits(
      p_asset public.media_assets, p_admin boolean, p_venue_id uuid)
    returns boolean language sql stable security definer set search_path = '' cost 10000
    as $g$
      select private.asset_search_admits_shipped(p_asset, p_admin, p_venue_id)
        and abs(hashtext(p_asset.id::text)::bigint) % 4 = 0
    $g$;`

  // The shipped public.asset_search with one line added at the start of each
  // chunk: the chunk size, appended to b05.chunks. Installed as the owner in
  // a rolled-back transaction, so a page's chunk sizes can be read back. The
  // rest of the body is the migration's text, its growth line included.
  const CHUNK_MARK = "      v_seen := 0;\n"
  const COUNTED_SEARCH = (() => {
    const fn = searchFunction(
      readFileSync(join(repoRoot, SEARCH_MIGRATION), "utf8"),
      "the migration"
    )
    const at = fn.indexOf(CHUNK_MARK)
    if (at < 0 || fn.indexOf(CHUNK_MARK, at + 1) >= 0)
      throw new Error("chunk start not found once in public.asset_search")
    return `${fn
      .slice(0, at + CHUNK_MARK.length)
      .replace(
        "create function public.asset_search(",
        "create or replace function public.asset_search("
      )}      perform set_config('b05.chunks',
        coalesce(current_setting('b05.chunks', true), '') || v_chunk || ',', true);
${fn.slice(at + CHUNK_MARK.length)};`
  })()
  // Chunk sizes by the scope (OD-B5-PERF-6): limit + 1, then x4, at most
  // 4000; written out here, not read from the migration.
  const chunkSizes = (limit: number, n: number) => {
    const out: number[] = []
    for (let c = limit + 1; out.length < n; c = Math.min(c * 4, 4000))
      out.push(c)
    return out
  }
  // A page that read r rows issued chunks c1..ck: the sizes are the scope's
  // sequence and the rows read reach into the last chunk (or the last one
  // came back short, when the one before ended exactly at the last row).
  const expectChunks = (limit: number, chunks: number[], reads: number) => {
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks).toEqual(chunkSizes(limit, chunks.length))
    const before = chunks.slice(0, -1).reduce((x, y) => x + y, 0)
    expect(reads).toBeGreaterThanOrEqual(before)
    expect(reads).toBeLessThanOrEqual(before + chunks.at(-1)!)
  }
  /** As the manager, in one rolled-back transaction after `setup` (as the
   * owner) and the counted body: per page, the rows read (gate calls) and the
   * chunk sizes issued. */
  const pageReads = (
    setup: string,
    filters: unknown,
    limit: number,
    pages: number
  ) =>
    JSON.parse(
      psql(`begin;
        set local statement_timeout = 0;
        set local track_functions = 'all';
        ${setup}
        ${COUNTED_SEARCH}
        create function pg_temp.reads(p_filters jsonb, p_limit integer, p_pages integer)
        returns jsonb language plpgsql as $f$
        declare
          v_page jsonb; v_at timestamptz; v_id uuid; v_out jsonb := '[]'; v_n bigint; v_m bigint;
        begin
          for i in 1 .. p_pages loop
            perform set_config('b05.chunks', '', true);
            select coalesce(sum(calls), 0) into v_n from pg_stat_xact_user_functions
              where schemaname = 'private' and funcname = 'asset_search_admits';
            v_page := public.asset_search(p_filters, v_at, v_id, p_limit);
            select coalesce(sum(calls), 0) into v_m from pg_stat_xact_user_functions
              where schemaname = 'private' and funcname = 'asset_search_admits';
            v_out := v_out || jsonb_build_object('reads', v_m - v_n,
              'items', jsonb_array_length(v_page -> 'items'),
              'chunks', to_jsonb(string_to_array(rtrim(current_setting('b05.chunks'), ','), ',')::int[]));
            exit when not (v_page ->> 'hasMore')::boolean;
            v_at := (v_page -> 'items' -> -1 ->> 'uploadedAt')::timestamptz;
            v_id := (v_page -> 'items' -> -1 ->> 'id')::uuid;
          end loop;
          return v_out;
        end $f$;
        grant execute on function pg_temp.reads(jsonb, integer, integer) to authenticated;
        select set_config('request.jwt.claims', '{"sub":"${c.manager.id}","role":"authenticated"}', true) is null;
        set local role authenticated;
        select pg_temp.reads('${JSON.stringify(filters)}', ${limit}, ${pages});
        rollback;`)
        .split("\n")
        .at(-1)!
    ) as { reads: number; items: number; chunks: number[] }[]

  it("crosses chunk edges where the gate refuses rows P keeps", () => {
    const cases: Case[] = [
      { filters: {} },
      ...["not_granted", "in_force", "legacy_unknown", "expired"].map((r) => ({
        filters: { rights: r },
      })),
      {
        filters: { rights: "not_granted" },
        at: rejectedCursor.at,
        id: rejectedCursor.id,
      },
      { filters: {}, at: deletedCursor.at, id: deletedCursor.id },
    ].map((x) => ({ ...x, limits: [1, 2, 24, 48], max: 40 }))
    for (const [who, list] of [
      [c.manager, cases],
      [c.staffManager, cases.map((x) => ({ ...x, limits: [24, 48], max: 25 }))],
    ] as const) {
      const d = compareBodies(who.id, list, STRICT_GATE)
      expectSame(d)
      expect(d.rows, who.id).toBeGreaterThan(100)
    }
    expectSame(
      compareBodies(
        c.admin.id,
        cases.map((x) => ({
          ...x,
          filters: { venue: c.venue, ...(x.filters as object) },
        })),
        STRICT_GATE
      )
    )
    // Rows each call read (one gate call per row read) and the chunk sizes
    // it issued, page by page: a page of 24 reads past its first chunk of 25;
    // walks at 1 a page (chunks of 2, 8, 32, ...) read past the second chunk
    // (more than 10 rows) at least once. Each page's chunks are the scope's
    // sizes (limit + 1, x4), and its reads reach into the last one.
    const of24 = pageReads(STRICT_GATE, {}, 24, 3)
    expect(of24.length).toBe(3)
    for (const p of of24) {
      expect(p.items).toBe(24)
      expect(p.reads).toBeGreaterThan(25)
      expectChunks(24, p.chunks, p.reads)
    }
    const of1 = pageReads(STRICT_GATE, {}, 1, 60)
    expect(of1.length).toBe(60)
    expect(Math.max(...of1.map((p) => p.reads))).toBeGreaterThan(10)
    expect(Math.max(...of1.map((p) => p.chunks.length))).toBeGreaterThan(2)
    for (const p of of1) expectChunks(1, p.chunks, p.reads)
  }, 600_000)

  // A gate that refuses every row, and 5,000 more manager-era uploads at the
  // chunk venue (rolled back): one call reads every row P keeps, more than
  // the 2,730 (limit 1), 2,125 (24) and 4,165 (48) rows before the chunk the
  // x4 growth caps at 4000, so every limit reaches the cap.
  it("grows chunks x4 up to 4000 rows", () => {
    const REFUSE_ALL = `
      alter function private.asset_search_admits(public.media_assets, boolean, uuid)
        rename to asset_search_admits_shipped;
      create function private.asset_search_admits(
        p_asset public.media_assets, p_admin boolean, p_venue_id uuid)
      returns boolean language sql stable security definer set search_path = '' cost 10000
      as $g$ select false $g$;
      create temp table chunk_more as
        select gen_random_uuid() as id, n from generate_series(1, 5000) n;
      insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename,
          media_type, size_bytes, client_upload_key, uploader_role, created_at)
        select r.id, '${c.manager.id}', '${c.venue}',
          '${c.manager.id}/' || r.id || '/original.jpg', 'TEST chunk more.jpg', 'image', 4,
          gen_random_uuid(), 'manager', now() - interval '1 day' - r.n * interval '1 second'
        from chunk_more r;
      update public.media_assets set upload_state = 'processing'
        where id in (select id from chunk_more);
      update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg',
          size_bytes = 4, width = 1, height = 1
        where id in (select id from chunk_more);`
    for (const limit of [1, 24, 48]) {
      const [p, ...more] = pageReads(REFUSE_ALL, {}, limit, 1)
      expect(more).toEqual([])
      expect(p!.items).toBe(0)
      expect(p!.reads).toBeGreaterThan(5000)
      expect(p!.chunks).toContain(4000)
      expectChunks(limit, p!.chunks, p!.reads)
    }
  }, 600_000)

  it("admits a row only where the prefilter holds, with a fixture for every gate arm", () => {
    // P is the migration's own text (shippedP), with every probe present.
    for (const probe of [
      "k.is_manager",
      "k.active_check",
      "k.can_review",
      "media_label_items",
      "menu_item_photos",
      "media_labels",
      "coverage_submission_items",
      "venue_amenity_fact_media",
      "amenity_submission_assets",
      "knowledge_contribution_assets",
    ])
      expect(shippedP).toContain(probe)
    const check = (who: Who, venue: string, setup = "") => {
      const out = psql(`begin;
        ${setup}
        select set_config('request.jwt.claims', '{"sub":"${who.id}","role":"authenticated"}', true) is null;
        select json_build_object(
          'violations', count(*) filter (where x.admitted and not x.p),
          'admitted', coalesce(json_agg(x.id) filter (where x.admitted), '[]'),
          'p', coalesce(json_agg(x.id) filter (where x.p), '[]'))
        from (${prefilter(venue)}) x;
        rollback;`)
      return JSON.parse(out.split("\n").at(-1)!) as {
        violations: number
        admitted: string[]
        p: string[]
      }
    }
    // Manager account: own manager-era upload, labels, decision rows, the
    // unlabelled food image, coverage, fact media, amenity and knowledge.
    const m = check(e.manager, e.venue)
    expect(m.violations).toBe(0)
    for (const id of [
      fx.managerOwn,
      fx.labelled,
      fx.decisionOnly,
      fx.variantLabelOnly,
      fx.foodImage,
      fx.coverage,
      fx.factMedia,
      fx.amenity,
      fx.knowledge,
      fx.atT0,
    ])
      expect(m.admitted, id).toContain(id)
    for (const id of [
      fx.managerStaffEra,
      fx.managerNoRole,
      fx.foodVideo,
      fx.kitchenOnly,
      fx.emptyLabel,
      fx.staffOnly,
      fx.grantHolderOwn,
    ]) {
      expect(m.admitted, id).not.toContain(id)
      expect(m.p, id).not.toContain(id)
    }
    // Deleted and not-ready rows: the scan's own conditions drop them.
    for (const id of [fx.notReady, fx.deleted])
      expect(m.admitted, id).not.toContain(id)
    // The decision-only fixture has a decision row and no label item.
    expect(
      psql(`select (select count(*) from public.media_label_items where asset_id = '${fx.decisionOnly}')
        || '|' || (select count(*) from public.menu_item_photos where asset_id = '${fx.decisionOnly}')`)
    ).toMatch(/^0\|[1-9]/)
    // Staff grant holder: no unlabelled review, no veto, its own upload
    // through the amenity gate while a check is active.
    const s = check(e.staffManager, e.venue)
    expect(s.violations).toBe(0)
    for (const id of [
      fx.grantHolderOwn,
      fx.labelled,
      fx.decisionOnly,
      fx.coverage,
      fx.factMedia,
      fx.amenity,
      fx.knowledge,
    ])
      expect(s.admitted, id).toContain(id)
    for (const id of [fx.foodImage, fx.managerOwn, fx.staffOnly]) {
      expect(s.admitted, id).not.toContain(id)
      expect(s.p, id).not.toContain(id)
    }
    // With every check archived its own upload leaves both.
    const archived = check(
      e.staffManager,
      e.venue,
      `update public.venue_amenity_checks set status = 'archived' where venue_id = '${e.venue}';`
    )
    expect(archived.violations).toBe(0)
    expect(archived.admitted).not.toContain(fx.grantHolderOwn)
    expect(archived.p).not.toContain(fx.grantHolderOwn)
    // The chunk world and the other venue.
    for (const [who, venue] of [
      [c.manager, c.venue],
      [c.staffManager, c.venue],
      [o.manager, o.venue],
    ] as const)
      expect(check(who, venue).violations).toBe(0)
  }, 300_000)

  it("answers can_open exactly for the rows unfiltered search lists", () => {
    for (const who of [
      e.manager,
      e.staffManager,
      o.manager,
      c.manager,
      c.staffManager,
    ]) {
      const out = asUser(
        who.id,
        `${HARNESS.replace(/grant execute[^;]*;/, "")}
        with l as materialized (select pg_temp.search_ids('{}') as ids)
        select json_build_object(
          'onlySearch', (select count(*) from l, unnest(l.ids) s(id)
            where not public.asset_search_can_open(s.id)),
          'onlyOpen', (select count(*) from public.media_assets a, l
            where public.asset_search_can_open(a.id)
              and a.id <> all (l.ids)),
          'listed', (select cardinality(l.ids) from l))`
      )
      const r = JSON.parse(out) as {
        onlySearch: number
        onlyOpen: number
        listed: number
      }
      expect(r).toMatchObject({ onlySearch: 0, onlyOpen: 0 })
      expect(r.listed).toBeGreaterThan(0)
    }
  }, 300_000)

  // P and the rights split mirror these bodies. A change to any of them
  // needs P (the gate prefilter in public.asset_search) and the rights
  // conditions re-checked, then these pins updated. admits, caller and
  // can_open must stay as they were at the base commit.
  it("pins the helpers the prefilter and the rights split mirror", () => {
    const pins: Record<string, string> = {
      "public.menu_item_photo_asset(uuid)": "cd08be25d426976c1e0aeda12f65e28d",
      "public.task_evidence_asset(uuid)": "7f8c6a96ff4c0a9a899168f481ab42b2",
      "public.amenity_evidence_asset(uuid)": "4f82066506491c9b9b77b1dacca0a6e5",
      "private.menu_photo_unlabelled_eligible(uuid,uuid)":
        "eab90064fdf1e0a7cce3551ec5571c43",
      "private.menu_photo_can_review_unlabelled()":
        "3357d2ad4db64b0b8bd1b4f124e7bdfd",
      "private.amenity_is_legacy_media(public.venue_amenity_checks,uuid)":
        "fda2901c91b3e1dee3649c08696aac5b",
      "private.media_asset_use_state(uuid,timestamptz)":
        "5826c1f9547465085c87503c346c21c2",
      "private.media_use_grant_state(public.media_use_grants,timestamptz)":
        "3a61487c1964f07490843c3e98e39838",
      "private.asset_search_admits(public.media_assets,boolean,uuid)":
        "e00756052b8eda1397879a33457a643b",
      "private.asset_search_caller()": "c451e0d07758f46fb6a3208f6ddb21af",
      "public.asset_search_can_open(uuid)": "e8485e16a45a104e01bce0e51b81be6e",
    }
    for (const [fn, md5] of Object.entries(pins))
      expect(
        psql(`select md5(pg_get_functiondef('${fn}'::regprocedure))`),
        fn
      ).toBe(md5)
  })
})
