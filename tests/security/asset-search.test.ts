// B05-m4 asset search (contracts/b05-design.md §6, build scope
// contracts/b05-m4-build-scope.md item 10). Real signed-in identities through
// PostgREST; the service role and psql only build fixtures (a manager-era
// upload, a group, registry rows a migration would write) and read state back.
import { randomUUID } from "node:crypto"

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
async function evidence(uploader: string, venue: string, createdAt?: string) {
  const a = await insertAsset(service, { uploader, venue, createdAt })
  const itemId = await insertSubmittedItem(service, {
    asset: a,
    venue,
    author: uploader,
    submittedAt: new Date().toISOString(),
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
    expect(psql(`select count(*) from public.media_use_granters`)).toBe("0")
  })

  it("leaves the credit function byte-identical", () => {
    expect(
      psql(
        `select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`
      )
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
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
