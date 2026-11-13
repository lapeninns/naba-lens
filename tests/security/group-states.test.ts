// B05-m5 group states (contracts/b05-design.md §1, B05-01a to d; build scope
// contracts/b05-01-grouping-scope.md, slice A, OD-B5-01-1 to 9). Real
// signed-in identities through PostgREST; the service role and psql only
// build fixtures and read state back. Covers §1.9's SQL cases, §1.10 items
// 1 to 10 and each OD-B5-01 default.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { markReady, type TestIdentity } from "../support/identities"
import { insertAsset, makeManager, ok, psql } from "./coverage-fixtures"
import {
  call,
  count,
  json,
  refused,
  service,
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
  type CatalogueRow,
} from "./menus-fixtures"

type Who = World["staffA"]

type Member = {
  assetId: string
  position: number
  mediaType: string
  uploadState: string
  mine: boolean
  replacesAssetId: string | null
  technical?: string
  labels?: string
  review?: { target: string; id: string | null; state: string }[]
  use?: Record<string, unknown> | null
  derivative?: string | null
  stopped?: boolean
  stoppedAt?: string | null
}
type Summary = {
  live: number
  ready: number
  inProgress: number
  failed: number
  removed: number
  replaced: number
  finished: boolean
}
type GroupView = {
  groupId: string
  venueId: string
  createdAt: string
  mine: boolean
  subject: { kind: string; id: string | null; name: string | null }
  members: Member[]
  summary?: Summary
  creatorFirstName?: string | null
}
type Replaced = {
  groupId: string
  assetId: string
  replacesAssetId: string
  position: number
}

const BASE_MEMBER_KEYS = [
  "assetId",
  "mediaType",
  "mine",
  "position",
  "replacesAssetId",
  "uploadState",
]
const STATE_KEYS = [
  "derivative",
  "labels",
  "review",
  "stopped",
  "stoppedAt",
  "technical",
  "use",
]
const DIMENSION_KEYS = [...STATE_KEYS, "summary"]

const key = () => `TEST-${randomUUID()}`

const start = (who: Who, k = key()) =>
  json<string>(who, "contribution_group_start", {
    p_key: k,
    p_subject_kind: "none",
    p_subject_id: null,
  })

const add = (who: Who, group: string, assets: string[]) =>
  json<number>(who, "contribution_group_add", {
    p_group_id: group,
    p_asset_ids: assets,
  })

const view = (who: Who, group: string) =>
  json<GroupView>(who, "contribution_group", { p_group_id: group })

const replaceArgs = (group: string, failed: string, fresh: string) => ({
  p_group_id: group,
  p_failed_asset_id: failed,
  p_new_asset_id: fresh,
})
const replace = (who: Who, group: string, failed: string, fresh: string) =>
  json<Replaced>(
    who,
    "contribution_group_replace",
    replaceArgs(group, failed, fresh)
  )

type State = "ready" | "uploading" | "processing" | "failed" | "stopped"

async function setState(id: string, state: State) {
  if (state === "ready") return markReady(service, id, "image/jpeg")
  if (state === "uploading") return
  if (state === "stopped") return backdate(id, 120)
  await ok(
    service.from("media_assets").update({ upload_state: state }).eq("id", id)
  )
}

/** A staff-path upload (uploader_role null: staff-era for a manager account). */
async function asset(uploader: string, venue: string, state: State = "ready") {
  const id = (await insertAsset(service, { uploader, venue, ready: false })).id
  await setState(id, state)
  return id
}

/** A reservation through the real RPC, so a manager account's is manager-era. */
async function reserved(who: Who, state: State = "ready") {
  const rows = await json<{ id: string }[]>(who, "reserve_media_asset", {
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST group state.jpg",
    p_size_bytes: 4,
    p_client_upload_key: randomUUID(),
    p_purpose: "general",
  })
  const id = rows[0]!.id
  await setState(id, state)
  return id
}

/** Backdates updated_at past the trigger (as upload-path.regression does). */
function backdate(id: string, minutes: number) {
  psql(
    `set session_replication_role = replica; update public.media_assets set updated_at = now() - interval '${minutes} minutes' where id = '${id}'`
  )
}

const many = (n: number, uploader: string, venue: string, state: State) =>
  Promise.all(Array.from({ length: n }, () => asset(uploader, venue, state)))

/** The fields B05-m5 must never write. */
const fingerprint = (ids: string[]) =>
  psql(
    `select string_agg(a.id || ':' || a.updated_at || ':' || a.upload_state || ':' || coalesce(a.deleted_at::text, ''), ',' order by a.id)
     from public.media_assets a where a.id in ('${ids.join("','")}')`
  )

const members = (group: string) =>
  count(
    `select count(*) from public.media_contribution_group_members where group_id = '${group}'`
  )
const links = (group: string) =>
  count(
    `select count(*) from public.media_asset_links where group_id = '${group}'`
  )

const helper = (sql: string) => JSON.parse(psql(`select (${sql})::text`))

const byId = (v: GroupView) =>
  Object.fromEntries(v.members.map((m) => [m.assetId, m]))

async function eligible(
  who: Who,
  fn: string,
  args: object,
  reason: string,
  assetId: string
) {
  const e = await refused(who, fn, args, "evidence_not_eligible", "P0001")
  expect(JSON.parse(e.details!)).toEqual({ assetId, reason })
}

// Menu photo fixtures, as in knowledge-b02-feed.test.ts.
type Tuple = { itemId: string; variantId: string | null }
const tuple = (row: CatalogueRow): Tuple => ({
  itemId: row.itemId,
  variantId: null,
})

const REVIEW_MENU = () =>
  menu("TEST group review", [
    section("mains", "Mains", [
      item("mains--tikka", "Tikka"),
      item("mains--bhaji", "Bhaji"),
    ]),
  ])

/** A ready upload with a saved label for these menu items. */
async function labelled(who: TestIdentity, version: string, tuples: Tuple[]) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: tuples,
    catalogue: version,
  })
  return asset.id
}

async function head(itemId: string) {
  const { data, error } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  if (error) throw error
  return data?.revision ?? 1
}

async function reviewPhoto(who: TestIdentity, asset: string, t: Tuple) {
  const [row] = await ok(
    who.client.rpc("review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: t.itemId,
      p_variant_id: t.variantId as string,
      p_decision: "accepted",
      p_expected_revision: await head(t.itemId),
      p_make_primary: false,
    })
  )
  return row! as { photo_id: string }
}

describe("group states, replacement and the live cap (B05-m5)", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    w = await world("b05m5-groups")
    other = await world("b05m5-groups-other")
  })

  it("widens the position check to 30 and keeps the unique position constraint (S1)", () => {
    expect(
      psql(`select pg_get_constraintdef(c.oid) from pg_constraint c
        where c.conname = 'media_contribution_group_members_position_check'
          and c.conrelid = 'public.media_contribution_group_members'::regclass`)
    ).toMatch(/"?position"? >= 1\).*"?position"? <= 30\)/)
    expect(
      psql(`select c.contype::text || ':' || pg_get_constraintdef(c.oid) from pg_constraint c
        where c.conname = 'media_contribution_group_members_position'
          and c.conrelid = 'public.media_contribution_group_members'::regclass`)
    ).toBe('u:UNIQUE (group_id, "position")')
    expect(psql(`select private.group_stopped_upload_window()::text`)).toBe(
      "01:00:00"
    )
  })

  it("G-1: a full set takes the replacement of its failed member, then refuses an 11th live member (§1.10.1)", async () => {
    const g = await start(w.staffA)
    const ready = await many(9, w.staffA.id, w.venue, "ready")
    const failed = await asset(w.staffA.id, w.venue, "failed")
    expect(await add(w.staffA, g, [...ready, failed])).toBe(10)

    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    const before = fingerprint([failed, fresh])
    expect(await replace(w.staffA, g, failed, fresh)).toEqual({
      groupId: g,
      assetId: fresh,
      replacesAssetId: failed,
      position: 11,
    })
    // One transaction: the member and the link; no asset row changed and no
    // use grant written.
    expect(members(g)).toBe(11)
    expect(links(g)).toBe(1)
    expect(fingerprint([failed, fresh])).toBe(before)
    expect(
      count(
        `select count(*) from public.media_use_grants where asset_id in ('${failed}', '${fresh}')`
      )
    ).toBe(0)

    // Live: 9 ready + the replacement = 10, so an 11th live member is refused.
    await refused(
      w.staffA,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [await asset(w.staffA.id, w.venue)] },
      "contribution_group_full",
      "P0001"
    )
    expect(members(g)).toBe(11)
    // The failed member stays a member.
    expect((await view(w.staffA, g)).members.map((m) => m.assetId)).toContain(
      failed
    )
  })

  it("checks the live cap after the swap (OD-B5-01-1 revised)", async () => {
    // A photo added into the failed member's freed slot: the swap would make
    // 11 live members, so it is refused and nothing is written.
    const g = await start(w.staffA)
    const failed = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [
      failed,
      ...(await many(9, w.staffA.id, w.venue, "ready")),
    ])
    expect(await add(w.staffA, g, [await asset(w.staffA.id, w.venue)])).toBe(11)
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    const before = fingerprint([failed, fresh])
    await refused(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, failed, fresh),
      "contribution_group_full",
      "P0001"
    )
    expect(members(g)).toBe(11)
    expect(links(g)).toBe(0)
    expect(fingerprint([failed, fresh])).toBe(before)
    expect((await view(w.staffA, g)).summary).toMatchObject({
      live: 11,
      failed: 1,
      replaced: 0,
    })

    // A stopped member is live: at live 10 its swap is net zero, accepted.
    const h = await start(w.staffA)
    const stopped = await asset(w.staffA.id, w.venue, "stopped")
    await add(w.staffA, h, [
      stopped,
      ...(await many(9, w.staffA.id, w.venue, "ready")),
    ])
    const swap = await asset(w.staffA.id, w.venue, "uploading")
    expect((await replace(w.staffA, h, stopped, swap)).position).toBe(11)
    expect((await view(w.staffA, h)).summary).toMatchObject({
      live: 10,
      replaced: 1,
    })
    await refused(
      w.staffA,
      "contribution_group_add",
      { p_group_id: h, p_asset_ids: [await asset(w.staffA.id, w.venue)] },
      "contribution_group_full"
    )

    // Delete-k, add-k, replace-k never passes 10 live.
    const k = await start(w.staffA)
    const gone = await many(3, w.staffA.id, w.venue, "ready")
    await add(w.staffA, k, [
      ...gone,
      ...(await many(7, w.staffA.id, w.venue, "ready")),
    ])
    for (const id of gone)
      await ok(call(w.staffA, "delete_media_asset", { p_asset_id: id }))
    await add(w.staffA, k, await many(3, w.staffA.id, w.venue, "ready"))
    await refused(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(k, gone[0]!, await asset(w.staffA.id, w.venue, "uploading")),
      "contribution_group_full"
    )
    expect((await view(w.staffA, k)).summary).toMatchObject({
      live: 10,
      removed: 3,
      replaced: 0,
    })
  })

  it("accepts a net-zero stopped swap above 10 live, and refuses one that adds a live member (R9)", async () => {
    const g = await start(w.staffA)
    const retried = await asset(w.staffA.id, w.venue, "failed")
    const stopped = await asset(w.staffA.id, w.venue, "uploading")
    const failed = await asset(w.staffA.id, w.venue, "failed")
    // Live 9: the stopped upload and 8 ready; neither failed one counts.
    // At most 10 per call (invalid_asset_list).
    await add(w.staffA, g, [retried, stopped, failed])
    await add(w.staffA, g, await many(8, w.staffA.id, w.venue, "ready"))
    expect(await add(w.staffA, g, [await asset(w.staffA.id, w.venue)])).toBe(12)
    // Live 10, then 11 once a failed member is retried to ready (S2 allows).
    await markReady(service, retried, "image/jpeg")
    backdate(stopped, 120)
    expect((await view(w.staffA, g)).summary).toMatchObject({
      live: 12,
      ready: 10,
      inProgress: 1,
      failed: 1,
    })
    // The stopped member's swap is net zero: accepted at live 11.
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    expect((await replace(w.staffA, g, stopped, fresh)).position).toBe(13)
    // The failed member's would make 12: refused, nothing written.
    const more = await asset(w.staffA.id, w.venue, "uploading")
    await refused(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, failed, more),
      "contribution_group_full",
      "P0001"
    )
    expect(members(g)).toBe(13)
    expect(links(g)).toBe(1)
  })

  it("rule (c): a replaced member stays out of the cap and the summary after it finishes (R5)", async () => {
    const g = await start(w.staffA)
    const old = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [
      ...(await many(8, w.staffA.id, w.venue, "ready")),
      old,
    ])
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    await replace(w.staffA, g, old, fresh)
    // The old upload finishes after it was replaced.
    await markReady(service, old, "image/jpeg")
    // Live 8 + fresh = 9, so one more fits; counting the old member (11)
    // would refuse it.
    expect(await add(w.staffA, g, [await asset(w.staffA.id, w.venue)])).toBe(11)
    const v = await view(w.staffA, g)
    expect(byId(v)[old]!.technical).toBe("ready")
    expect(v.summary).toEqual({
      live: 10,
      ready: 9,
      inProgress: 1,
      failed: 0,
      removed: 0,
      replaced: 1,
      finished: false,
    })
    await refused(
      w.staffA,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [await asset(w.staffA.id, w.venue)] },
      "contribution_group_full"
    )
  })

  it("replaces a member that was ready and then deleted (S4 ii)", async () => {
    const g = await start(w.staffA)
    const [kept, deleted] = await many(2, w.staffA.id, w.venue, "ready")
    await add(w.staffA, g, [kept!, deleted!])
    await eligible(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, deleted!, await asset(w.staffA.id, w.venue, "uploading")),
      "not_replaceable",
      deleted!
    )
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: deleted }))
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    expect(await replace(w.staffA, g, deleted!, fresh)).toEqual({
      groupId: g,
      assetId: fresh,
      replacesAssetId: deleted,
      position: 3,
    })
    const v = await view(w.staffA, g)
    expect(byId(v)[deleted!]!.technical).toBe("removed")
    expect(v.summary).toMatchObject({
      live: 2,
      ready: 1,
      inProgress: 1,
      removed: 0,
      replaced: 1,
    })
  })

  it("stops positions at 30, for adds and replacements alike", async () => {
    const g = await start(w.staffA)
    // Failed members are not live, so only positions limit them.
    const failed = await many(30, w.staffA.id, w.venue, "failed")
    for (let i = 0; i < 30; i += 10)
      await add(w.staffA, g, failed.slice(i, i + 10))
    expect(members(g)).toBe(30)
    await refused(
      w.staffA,
      "contribution_group_add",
      {
        p_group_id: g,
        p_asset_ids: [await asset(w.staffA.id, w.venue, "failed")],
      },
      "contribution_group_full",
      "P0001"
    )
    await refused(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(
        g,
        failed[0]!,
        await asset(w.staffA.id, w.venue, "uploading")
      ),
      "contribution_group_full",
      "P0001"
    )
    expect(members(g)).toBe(30)
    expect(links(g)).toBe(0)
    // The table check backs the function: a real ungrouped asset of the
    // venue, so only the position check can refuse it.
    const loose = await asset(w.staffA.id, w.venue, "failed")
    expect(() =>
      psql(
        `insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
         values ('${g}', '${w.venue}', '${loose}', 31)`
      )
    ).toThrow(/media_contribution_group_members_position_check/)
  })

  it("marks a member stopped only past the window, and only to privileged viewers (S5)", async () => {
    const g = await start(w.staffA)
    const [ready, fresh, old, failed] = [
      await asset(w.staffA.id, w.venue, "ready"),
      await asset(w.staffA.id, w.venue, "uploading"),
      await asset(w.staffA.id, w.venue, "uploading"),
      await asset(w.staffA.id, w.venue, "failed"),
    ]
    await add(w.staffA, g, [ready, fresh, old, failed])
    backdate(fresh, 59)
    backdate(old, 61)
    const stopped = (v: GroupView) =>
      Object.fromEntries(v.members.map((m) => [m.assetId, m.stopped]))
    const expected = {
      [ready]: false,
      [fresh]: false,
      [old]: true,
      [failed]: false,
    }
    expect(stopped(await view(w.staffA, g))).toEqual(expected)
    // Admin sees every member (not deleted), with the same flag.
    expect(stopped(await view(w.admin, g))).toEqual(expected)
    // stoppedAt: when an uploading member becomes stopped (S15), else null.
    const at = (id: string) =>
      Date.parse(
        psql(
          `select to_json(updated_at + private.group_stopped_upload_window())#>>'{}' from public.media_assets where id = '${id}'`
        )
      )
    for (const who of [w.staffA, w.admin]) {
      const byAsset = byId(await view(who, g))
      expect(Date.parse(byAsset[fresh]!.stoppedAt!)).toBe(at(fresh))
      expect(Date.parse(byAsset[old]!.stoppedAt!)).toBe(at(old))
      expect(Date.parse(byAsset[fresh]!.stoppedAt!)).toBeGreaterThan(Date.now())
      expect(Date.parse(byAsset[old]!.stoppedAt!)).toBeLessThan(Date.now())
      expect(byAsset[ready]!.stoppedAt).toBeNull()
      expect(byAsset[failed]!.stoppedAt).toBeNull()
    }
    // The flag is what S4 accepts: the stopped one swaps, the fresh one not.
    await replace(
      w.staffA,
      g,
      old,
      await asset(w.staffA.id, w.venue, "uploading")
    )
    await eligible(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, fresh, await asset(w.staffA.id, w.venue, "uploading")),
      "not_replaceable",
      fresh
    )
    // A colleague's members carry no such key.
    for (const m of (await view(w.staffB, g)).members) {
      expect(m).not.toHaveProperty("stopped")
      expect(m).not.toHaveProperty("stoppedAt")
    }
    // Removed: not stopped, and never will be.
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: fresh }))
    expect(stopped(await view(w.staffA, g))[fresh]).toBe(false)
    expect(byId(await view(w.staffA, g))[fresh]!.stoppedAt).toBeNull()
  })

  it("stopped-upload case (M1): a failed or stopped member is replaced, stops counting at once and never counts again (§1.10.9)", async () => {
    for (const oldState of ["failed", "stopped"] as const) {
      const g = await start(w.staffA)
      const old = await asset(w.staffA.id, w.venue, "uploading")
      await add(w.staffA, g, [
        old,
        ...(await many(9, w.staffA.id, w.venue, "ready")),
      ])
      await setState(old, oldState)
      const fresh = await asset(w.staffA.id, w.venue, "uploading")
      await replace(w.staffA, g, old, fresh)
      expect((await view(w.staffA, g)).summary).toMatchObject({
        live: 10,
        replaced: 1,
      })

      // The old upload finishes later: it still never counts.
      await markReady(service, old, "image/jpeg")
      const after = await view(w.staffA, g)
      expect(byId(after)[old]!.technical).toBe("ready")
      expect(after.summary).toMatchObject({
        live: 10,
        ready: 9,
        inProgress: 1,
        replaced: 1,
      })
      await refused(
        w.staffA,
        "contribution_group_add",
        { p_group_id: g, p_asset_ids: [await asset(w.staffA.id, w.venue)] },
        "contribution_group_full"
      )
    }
  })

  it("counts a failed member again once it is retried to ready without a replacement (§1.10.8)", async () => {
    const g = await start(w.staffA)
    const retried = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [
      retried,
      ...(await many(9, w.staffA.id, w.venue, "ready")),
    ])
    expect(await add(w.staffA, g, [await asset(w.staffA.id, w.venue)])).toBe(11)
    await markReady(service, retried, "image/jpeg")
    // Live 11 now, so nothing more is added; positions never pass 30.
    expect((await view(w.staffA, g)).summary).toMatchObject({
      live: 11,
      ready: 11,
      finished: true,
    })
    await refused(
      w.staffA,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [await asset(w.staffA.id, w.venue)] },
      "contribution_group_full"
    )
    expect(
      count(
        `select max(position) from public.media_contribution_group_members where group_id = '${g}'`
      )
    ).toBe(11)
  })

  it("refuses a replacement that is not one-for-one or not the creator's (§1.9, OD-B5-01-4)", async () => {
    const g = await start(w.staffA)
    const [ready, processing, uploading, failed] = [
      await asset(w.staffA.id, w.venue, "ready"),
      await asset(w.staffA.id, w.venue, "processing"),
      await asset(w.staffA.id, w.venue, "uploading"),
      await asset(w.staffA.id, w.venue, "failed"),
    ]
    await add(w.staffA, g, [ready, processing, uploading, failed])
    const fresh = await asset(w.staffA.id, w.venue, "uploading")

    // A ready, processing or still-uploading member is not replaceable.
    for (const old of [ready, processing, uploading])
      await eligible(
        w.staffA,
        "contribution_group_replace",
        replaceArgs(g, old, fresh),
        "not_replaceable",
        old
      )
    // Not yet stopped: 59 minutes is inside the window.
    backdate(uploading, 59)
    await eligible(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, uploading, fresh),
      "not_replaceable",
      uploading
    )

    // Someone else's, another venue's, a deleted and an already-grouped asset.
    const theirs = await asset(w.staffB.id, w.venue, "uploading")
    const elsewhere = await asset(other.staffA.id, other.venue, "uploading")
    const gone = await asset(w.staffA.id, w.venue, "uploading")
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: gone }))
    for (const [newAsset, reason] of [
      [theirs, "not_own"],
      [elsewhere, "not_found"],
      [gone, "deleted"],
      [ready, "in_group"],
    ] as const)
      await eligible(
        w.staffA,
        "contribution_group_replace",
        replaceArgs(g, failed, newAsset),
        reason,
        newAsset
      )
    const second = await start(w.staffA)
    const grouped = await asset(w.staffA.id, w.venue, "uploading")
    await add(w.staffA, second, [grouped])
    const e = await refused(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, failed, grouped),
      "asset_in_other_group",
      "P0001"
    )
    expect(JSON.parse(e.details!)).toEqual({ assetId: grouped })

    // A member of another group, an unknown asset, another person's call.
    for (const args of [
      replaceArgs(g, grouped, fresh),
      replaceArgs(g, randomUUID(), fresh),
      replaceArgs(randomUUID(), failed, fresh),
    ])
      await refused(
        w.staffA,
        "contribution_group_replace",
        args,
        "contribution_group_not_found",
        "P0002"
      )
    for (const who of [w.staffB, w.staffManager, w.admin, other.staffA])
      await refused(
        who,
        "contribution_group_replace",
        replaceArgs(g, failed, fresh),
        "contribution_group_not_found",
        "P0002"
      )
    expect(links(g)).toBe(0)
    expect(members(g)).toBe(4)
  })

  it("replays the same pair before any state check, and refuses a different one (§1.10.2)", async () => {
    const g = await start(w.staffA)
    const failed = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [failed])
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    const first = await replace(w.staffA, g, failed, fresh)
    expect(first).toEqual({
      groupId: g,
      assetId: fresh,
      replacesAssetId: failed,
      position: 2,
    })
    // Both assets change state; the replay still answers the same.
    await markReady(service, fresh, "image/jpeg")
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: failed }))
    expect(await replace(w.staffA, g, failed, fresh)).toEqual(first)
    await refused(
      w.staffA,
      "contribution_group_replace",
      replaceArgs(g, failed, await asset(w.staffA.id, w.venue, "uploading")),
      "idempotency_key_reused",
      "P0001"
    )
    expect(members(g)).toBe(2)
    expect(links(g)).toBe(1)
  })

  it("applies the manager-era rule (c1f96273) to the new asset (§1.10.10)", async () => {
    const g = await start(w.manager)
    const failed = await reserved(w.manager, "failed")
    await add(w.manager, g, [failed])
    // A staff-era upload of the manager account's own is refused as not_own.
    const staffEra = await asset(w.manager.id, w.venue, "uploading")
    await eligible(
      w.manager,
      "contribution_group_replace",
      replaceArgs(g, failed, staffEra),
      "not_own",
      staffEra
    )
    const managerEra = await reserved(w.manager, "uploading")
    expect((await replace(w.manager, g, failed, managerEra)).assetId).toBe(
      managerEra
    )
  })

  it("derives the summary per OD-B5-01-2; finished only when every live member is ready (§1.10.4)", async () => {
    // The tandoor set: three photos, one failing.
    const g = await start(w.staffA)
    const [a, b, bad] = [
      await asset(w.staffA.id, w.venue, "ready"),
      await asset(w.staffA.id, w.venue, "ready"),
      await asset(w.staffA.id, w.venue, "failed"),
    ]
    await add(w.staffA, g, [a, b, bad])
    expect((await view(w.staffA, g)).summary).toEqual({
      live: 3,
      ready: 2,
      inProgress: 0,
      failed: 1,
      removed: 0,
      replaced: 0,
      finished: false,
    })
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    await replace(w.staffA, g, bad, fresh)
    expect((await view(w.staffA, g)).summary).toEqual({
      live: 3,
      ready: 2,
      inProgress: 1,
      failed: 0,
      removed: 0,
      replaced: 1,
      finished: false,
    })
    await ok(
      service
        .from("media_assets")
        .update({ upload_state: "processing" })
        .eq("id", fresh)
    )
    expect((await view(w.staffA, g)).summary!.finished).toBe(false)
    await markReady(service, fresh, "image/jpeg")
    expect((await view(w.staffA, g)).summary).toEqual({
      live: 3,
      ready: 3,
      inProgress: 0,
      failed: 0,
      removed: 0,
      replaced: 1,
      finished: true,
    })

    // A removed member leaves the denominator; a stopped one is in progress.
    const h = await start(w.staffA)
    const [kept, dropped, stopped] = [
      await asset(w.staffA.id, w.venue, "ready"),
      await asset(w.staffA.id, w.venue, "failed"),
      await asset(w.staffA.id, w.venue, "uploading"),
    ]
    await add(w.staffA, h, [kept, dropped, stopped])
    backdate(stopped, 120)
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: dropped }))
    expect((await view(w.staffA, h)).summary).toEqual({
      live: 2,
      ready: 1,
      inProgress: 1,
      failed: 0,
      removed: 1,
      replaced: 0,
      finished: false,
    })
    // An empty group is never finished.
    expect((await view(w.staffA, await start(w.staffA))).summary).toEqual({
      live: 0,
      ready: 0,
      inProgress: 0,
      failed: 0,
      removed: 0,
      replaced: 0,
      finished: false,
    })
  })

  it("gives privileged viewers each member's states and a colleague none (§1.10.3, OD-B5-01-5 to 8)", async () => {
    const g = await start(w.staffA)
    const ready = await asset(w.staffA.id, w.venue, "ready")
    const uploading = await asset(w.staffA.id, w.venue, "uploading")
    const attention = await asset(w.staffA.id, w.venue, "uploading")
    const failed = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [ready, uploading, attention, failed])
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    await replace(w.staffA, g, failed, fresh)
    await markReady(service, fresh, "image/jpeg")
    await ok(
      service.from("media_pending_labels").insert([
        {
          asset_id: uploading,
          uploader_id: w.staffA.id,
          venue_id: w.venue,
          input: {},
          // A batch insert sends every key for every row: an absent one is
          // null, not the column default.
          status: "pending",
        },
        {
          asset_id: attention,
          uploader_id: w.staffA.id,
          venue_id: w.venue,
          input: {},
          status: "needs_attention",
          code: "conflict",
        },
      ])
    )

    // The creator: every member, every dimension, the uploader's use view.
    const mine = await view(w.staffA, g)
    expect(mine.members.map((m) => m.assetId)).toEqual([
      ready,
      uploading,
      attention,
      failed,
      fresh,
    ])
    expect(Object.keys(mine)).not.toContain("creatorFirstName")
    for (const m of mine.members) {
      expect(Object.keys(m).sort()).toEqual(
        [...BASE_MEMBER_KEYS, ...STATE_KEYS].sort()
      )
      expect(m.derivative).toBeNull()
      expect(m.review).toEqual([])
      expect(m.use).toEqual(
        helper(`private.media_asset_use_summary('${m.assetId}', 'uploader')`)
      )
      expect(Object.keys(m.use!).sort()).toEqual(["destinations", "state"])
    }
    const states = byId(mine)
    expect(states[ready]).toMatchObject({
      technical: "ready",
      labels: "needs_attention",
    })
    expect(states[uploading]).toMatchObject({
      technical: "uploading",
      labels: "labelled",
    })
    expect(states[attention]).toMatchObject({
      technical: "uploading",
      labels: "needs_attention",
    })
    expect(states[failed]).toMatchObject({
      technical: "failed",
      labels: "none",
    })
    expect(states[fresh]).toMatchObject({
      technical: "ready",
      replacesAssetId: failed,
    })
    expect(mine.summary).toEqual({
      live: 4,
      ready: 2,
      inProgress: 2,
      failed: 0,
      removed: 0,
      replaced: 1,
      finished: false,
    })

    // The venue's effective manager (a staff account holding a grant) and an
    // admin: the full use view; members through the gates (ready only for
    // the manager), the summary over every member.
    for (const who of [w.staffManager, w.admin]) {
      const v = await view(who, g)
      for (const m of v.members) {
        expect(Object.keys(m).sort()).toEqual(
          [...BASE_MEMBER_KEYS, ...STATE_KEYS].sort()
        )
        expect(m.use).toEqual(
          helper(`private.media_asset_use_summary('${m.assetId}', 'full')`)
        )
        expect(m.use).toHaveProperty("inForce")
      }
      expect(v.summary).toEqual(mine.summary)
    }
    expect(
      (await view(w.staffManager, g)).members.map((m) => m.assetId)
    ).toEqual([ready, fresh])
    // A manager or admin who is not the creator always gets the id, even of
    // a replaced member it is not shown (OD-B5-01-8 is for colleagues).
    expect(byId(await view(w.staffManager, g))[fresh]!.replacesAssetId).toBe(
      failed
    )
    expect(byId(await view(w.admin, g))[fresh]!.replacesAssetId).toBe(failed)
    expect(
      (await view(w.admin, g)).members.map((m) => m.assetId).sort()
    ).toEqual([ready, uploading, attention, failed, fresh].sort())

    // Colleagues, here and at another venue: gated members, the creator's
    // first name, no states, no summary, and no id of a hidden asset.
    const firstName = psql(
      `select nullif(split_part(btrim(display_name), ' ', 1), '') from public.profiles where id = '${w.staffA.id}'`
    )
    for (const who of [w.staffB, other.staffA]) {
      const v = await view(who, g)
      expect(Object.keys(v).sort()).toEqual([
        "createdAt",
        "creatorFirstName",
        "groupId",
        "members",
        "mine",
        "subject",
        "venueId",
      ])
      expect(v.creatorFirstName).toBe(firstName)
      expect(v.members.map((m) => m.assetId)).toEqual([ready, fresh])
      for (const m of v.members) {
        expect(Object.keys(m).sort()).toEqual(BASE_MEMBER_KEYS)
        for (const k of DIMENSION_KEYS) expect(m).not.toHaveProperty(k)
      }
      expect(byId(v)[fresh]!.replacesAssetId).toBeNull()
      for (const k of DIMENSION_KEYS) expect(v).not.toHaveProperty(k)
    }

    // A replaced member that later becomes visible shows its id to them.
    await markReady(service, failed, "image/jpeg")
    expect(byId(await view(w.staffB, g))[fresh]!.replacesAssetId).toBe(failed)

    // A manager account at another venue sees nothing.
    await refused(
      other.manager,
      "contribution_group",
      { p_group_id: g },
      "contribution_group_not_found",
      "P0002"
    )
  })

  it("shows the creator removed members, except a manager account's staff-era uploads (OD-B5-01-7)", async () => {
    const g = await start(w.staffA)
    const kept = await asset(w.staffA.id, w.venue, "ready")
    const gone = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [kept, gone])
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: gone }))
    const v = await view(w.staffA, g)
    expect(v.members.map((m) => [m.assetId, m.technical])).toEqual([
      [kept, "ready"],
      [gone, "removed"],
    ])
    expect(v.summary).toMatchObject({ live: 1, removed: 1, finished: true })
    // Others never see a removed member.
    expect((await view(w.admin, g)).members.map((m) => m.assetId)).toEqual([
      kept,
    ])
    expect((await view(w.staffB, g)).members.map((m) => m.assetId)).toEqual([
      kept,
    ])

    // A manager account's own staff-era member stays hidden from it.
    const mg = await start(w.manager)
    const managerEra = await reserved(w.manager, "ready")
    await add(w.manager, mg, [managerEra])
    const staffEra = await asset(w.manager.id, w.venue, "failed")
    psql(
      `insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
       values ('${mg}', '${w.venue}', '${staffEra}', 2)`
    )
    expect((await view(w.manager, mg)).members.map((m) => m.assetId)).toEqual([
      managerEra,
    ])
    // It cannot replace it either: the read never shows it that member.
    await refused(
      w.manager,
      "contribution_group_replace",
      replaceArgs(mg, staffEra, await reserved(w.manager, "uploading")),
      "contribution_group_not_found",
      "P0002"
    )
  })

  it("returns use and derivative through the helpers, null derivative while B05-m2 is absent (§1.10.5, §1.10.7)", async () => {
    const shot = await asset(w.staffA.id, w.venue, "ready")
    const g = await start(w.staffA)
    await add(w.staffA, g, [shot])

    // The feed's use is the uploader view, with no granter, period or note.
    const feed = await json<{ items: Record<string, unknown>[] }>(
      w.staffA,
      "my_contributions_feed",
      { p_cursor: null, p_limit: 50 }
    )
    const row = feed.items.find((i) => i.key === `p:${shot}`)!
    expect(row.use).toEqual(
      helper(`private.media_asset_use_summary('${shot}', 'uploader')`)
    )
    expect(Object.keys(row.use as object).sort()).toEqual([
      "destinations",
      "state",
    ])
    expect(row).not.toHaveProperty("derivative")
    expect(row.menuUseAccepted).toBe(false)

    expect(
      count(
        `select count(*) from pg_proc where proname = 'media_asset_derivative_summary'`
      )
    ).toBe(0)
    expect((await view(w.staffA, g)).members[0]!.derivative).toBeNull()

    // Once a helper exists, its value appears with no change to B05-m5.
    psql(`create function private.media_asset_derivative_summary(p_asset_id uuid)
      returns text language sql stable set search_path = '' as $$ select 'pending'::text $$`)
    try {
      expect((await view(w.staffA, g)).members[0]!.derivative).toBe("pending")
    } finally {
      psql(`drop function private.media_asset_derivative_summary(uuid)`)
    }
    expect((await view(w.staffA, g)).members[0]!.derivative).toBeNull()
  })

  it("keeps media_asset_links closed to clients and append-only (S3)", async () => {
    const g = await start(w.staffA)
    const failed = await asset(w.staffA.id, w.venue, "failed")
    await add(w.staffA, g, [failed])
    const fresh = await asset(w.staffA.id, w.venue, "uploading")
    await replace(w.staffA, g, failed, fresh)
    const { data, error } = await (
      w.staffA.client as unknown as {
        from(t: string): {
          select(
            c: string
          ): PromiseLike<{ data: unknown[] | null; error: unknown }>
        }
      }
    )
      .from("media_asset_links")
      .select("*")
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    const where = `group_id = '${g}'`
    expect(() =>
      psql(`delete from public.media_asset_links where ${where}`)
    ).toThrow()
    expect(() =>
      psql(
        `update public.media_asset_links set venue_id = venue_id where ${where}`
      )
    ).toThrow()
    expect(() => psql(`truncate public.media_asset_links`)).toThrow()
    // One link per replaced member, a group for every replacement, never self.
    const another = await asset(w.staffA.id, w.venue, "uploading")
    expect(() =>
      psql(
        `insert into public.media_asset_links (asset_id, venue_id, related_asset_id, kind, group_id, created_by)
         values ('${another}', '${w.venue}', '${failed}', 'replaces_failed_member', '${g}', '${w.staffA.id}')`
      )
    ).toThrow(/media_asset_links_related_once/)
    expect(() =>
      psql(
        `insert into public.media_asset_links (asset_id, venue_id, related_asset_id, kind, group_id, created_by)
         values ('${another}', '${w.venue}', '${fresh}', 'replaces_failed_member', null, '${w.staffA.id}')`
      )
    ).toThrow(/media_asset_links_group/)
    expect(() =>
      psql(
        `insert into public.media_asset_links (asset_id, venue_id, related_asset_id, kind, group_id, created_by)
         values ('${another}', '${w.venue}', '${another}', 'replaces_failed_member', '${g}', '${w.staffA.id}')`
      )
    ).toThrow(/media_asset_links_distinct/)
    expect(
      psql(`select string_agg(c.conname, ',' order by c.conname) from pg_constraint c
        where c.conrelid = 'public.media_asset_links'::regclass and c.contype in ('c', 'u', 'f')`)
    ).toBe(
      "media_asset_links_asset_fkey,media_asset_links_created_by_fkey,media_asset_links_distinct,media_asset_links_group,media_asset_links_group_fkey,media_asset_links_kind_check,media_asset_links_related_fkey,media_asset_links_related_once"
    )
    expect(
      psql(
        `select relrowsecurity from pg_class where oid = 'public.media_asset_links'::regclass`
      )
    ).toBe("t")
    expect(
      count(
        `select count(*) from pg_policy where polrelid = 'public.media_asset_links'::regclass`
      )
    ).toBe(0)
    expect(links(g)).toBe(1)
  })

  it("counts the creator's summary over the members it is shown, a converted account included (OD-B5-01-7)", async () => {
    // A staff creator who later becomes a manager account: its staff-era
    // members are hidden from it, so its summary leaves them out; an admin's
    // summary still counts every member.
    const cv = await world("b05m5-convert")
    const g = await start(cv.staffA)
    const staffReady = await asset(cv.staffA.id, cv.venue, "ready")
    const staffFailed = await asset(cv.staffA.id, cv.venue, "failed")
    await add(cv.staffA, g, [staffReady, staffFailed])
    await makeManager(cv.admin, cv.staffA, cv.venue)
    const managerEra = await reserved(cv.staffA, "ready")
    await add(cv.staffA, g, [managerEra])

    const mine = await view(cv.staffA, g)
    expect(mine.members.map((m) => m.assetId)).toEqual([managerEra])
    expect(mine.summary).toEqual({
      live: 1,
      ready: 1,
      inProgress: 0,
      failed: 0,
      removed: 0,
      replaced: 0,
      finished: true,
    })
    expect(JSON.stringify(mine)).not.toContain(staffReady)
    expect(JSON.stringify(mine)).not.toContain(staffFailed)
    const theirs = await view(cv.admin, g)
    expect(theirs.members.map((m) => m.assetId)).toEqual([
      staffReady,
      staffFailed,
      managerEra,
    ])
    expect(theirs.summary).toEqual({
      live: 3,
      ready: 2,
      inProgress: 0,
      failed: 1,
      removed: 0,
      replaced: 0,
      finished: false,
    })
  })

  it("lists real review rows and labels, without withdrawn decisions (R6, R8)", async () => {
    const mw = await world("b05m5-review")
    const version = await publishMenu(mw.admin, mw.venue, REVIEW_MENU())
    const items = (await readDocument(service, version)).byKey
    const tikka = tuple(items["mains--tikka"]!)
    const bhaji = tuple(items["mains--bhaji"]!)
    const accepted = await labelled(mw.staffA, version, [tikka])
    const withdrawn = await labelled(mw.staffA, version, [bhaji])
    await reviewPhoto(mw.manager, accepted, tikka)
    const gone = await reviewPhoto(mw.manager, withdrawn, bhaji)
    await ok(
      mw.manager.client.rpc("withdraw_menu_item_photo", {
        p_photo_id: gone.photo_id,
        p_expected_revision: await head(bhaji.itemId),
        p_reason: "TEST blurry",
      })
    )
    const processing = await asset(mw.staffA.id, mw.venue, "processing")
    const g = await start(mw.staffA)
    await add(mw.staffA, g, [accepted, withdrawn, processing])

    const states = byId(await view(mw.staffA, g))
    expect(states[accepted]).toMatchObject({
      technical: "ready",
      // A saved label (media_labels.has_labels), not a pending one.
      labels: "labelled",
      review: [{ target: "menu_item", id: tikka.itemId, state: "accepted" }],
    })
    expect(
      count(
        `select count(*) from public.media_labels where asset_id = '${accepted}' and has_labels`
      )
    ).toBe(1)
    // The withdrawn decision is history.
    expect(
      count(
        `select count(*) from public.menu_item_photos where asset_id = '${withdrawn}' and state = 'withdrawn'`
      )
    ).toBe(1)
    expect(states[withdrawn]).toMatchObject({ labels: "labelled", review: [] })
    expect(states[processing]).toMatchObject({
      technical: "processing",
      uploadState: "processing",
      labels: "none",
      review: [],
    })
    // An admin reads the same review rows.
    expect(byId(await view(mw.admin, g))[accepted]!.review).toEqual([
      { target: "menu_item", id: tikka.itemId, state: "accepted" },
    ])
  })

  it("keeps credit unchanged: the hash, and no credit or completion function reads the group tables (§1.10.6)", () => {
    expect(
      psql(`select md5(pg_get_functiondef(
        'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`)
    ).toBe("595b567b933705e692d2f801d750b3fb")
    const scope = `n.nspname in ('public', 'private') and (
        p.proname in ('track_completion_staff_venue_membership', 'venue_monthly_completion_target',
          'coverage_completion_target_periods', 'monthly_venue_completion_counts',
          'coverage_staff_progress_v2', 'coverage_group_overview', 'coverage_preparation_status')
        or p.proname ~* '(credit|completion)')`
    expect(
      count(
        `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${scope}`
      )
    ).toBeGreaterThanOrEqual(7)
    expect(
      psql(`select coalesce(string_agg(p.proname, ','), '') from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where ${scope} and p.prosrc ~* '(media_contribution_group|media_asset_links)'`)
    ).toBe("")
    // Only the group functions read or write the links.
    expect(
      psql(`select string_agg(p.proname, ',' order by p.proname) from pg_proc p
        where p.prosrc ~* 'media_asset_links'`)
    ).toBe(
      "contribution_group,contribution_group_add,contribution_group_replace"
    )
  })

  it("keeps the new functions where clients can and cannot reach them", () => {
    const can = (role: string, fn: string) =>
      psql(
        `select has_function_privilege('${role}', '${fn}'::regprocedure, 'execute')`
      )
    for (const role of ["anon", "service_role"])
      expect(
        can(role, "public.contribution_group_replace(uuid,uuid,uuid)")
      ).toBe("f")
    expect(
      can("authenticated", "public.contribution_group_replace(uuid,uuid,uuid)")
    ).toBe("t")
    for (const fn of [
      "private.media_asset_review_list(uuid)",
      "private.group_stopped_upload_window()",
    ])
      for (const role of ["anon", "authenticated", "service_role"])
        expect(can(role, fn), `${role} ${fn}`).toBe("f")
    expect(
      psql(`select provolatile::text || prosecdef::text from pg_proc
        where oid = 'public.contribution_group_replace(uuid,uuid,uuid)'::regprocedure`)
    ).toBe("vtrue")
  })
})
