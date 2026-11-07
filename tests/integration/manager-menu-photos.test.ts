// Manager menu photo services (lib/server/menu-photos) against an owned local
// stack, as real signed-in identities through actorFor: every call goes
// through the caller's RLS and the manager_menu_photo_* functions exactly as
// the Server Functions make them. The service role only builds fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import {
  decideMenuPhoto,
  getManagerItem,
  getManagerOverview,
  listReviewQueue,
  managerPhotoCtxFor,
  type ManagerPhotoCtx,
  type MenuPhotoResult,
} from "@/lib/server/menu-photos"
import type { MediaActor } from "@/lib/server/media/types"

import { seedAsset } from "../library/seed"
import { makeManager } from "../security/coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  saveOk,
  section,
  type CatalogueRow,
} from "../security/menus-fixtures"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

const requestId = () => `it-${crypto.randomUUID()}`

function okOf<T extends object>(result: MenuPhotoResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}

describe("manager menu photo services", () => {
  const service = serviceClient()
  let venueA: string
  let venueB: string
  let versionA: string
  let versionB: string
  let items: Record<string, CatalogueRow>
  let itemsB: Record<string, CatalogueRow>
  let admin: TestIdentity
  let staff: TestIdentity
  let staff2: TestIdentity
  let mgr: TestIdentity
  let staffActor: MediaActor
  let mgrCtx: ManagerPhotoCtx
  let adminCtx: ManagerPhotoCtx

  /** A ready photo with real derivatives, labelled by its uploader. */
  async function labelledPhoto(who: TestIdentity, itemId: string) {
    const asset = await seedAsset(service, {
      uploaderId: who.id,
      venueId: venueA,
      derivatives: true,
    })
    await saveOk(who, {
      asset: asset.id,
      revision: 0,
      items: [{ itemId, variantId: null }],
      catalogue: versionA,
    })
    return asset.id
  }

  const revisionOf = async (itemId: string) => {
    const { data } = await service
      .from("menu_item_photo_heads")
      .select("revision")
      .eq("item_id", itemId)
      .maybeSingle()
    return data?.revision ?? 1
  }

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      createVenue(service, "mgr-photos-a"),
      createVenue(service, "mgr-photos-b"),
    ])
    venueA = a.id
    venueB = b.id
    ;[admin, staff, staff2, mgr] = await Promise.all([
      createIdentity(service, { label: "mgr-photos-admin", role: "admin" }),
      createIdentity(service, {
        label: "mgr-photos-s1",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "mgr-photos-s2",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "mgr-photos-mgr",
        role: "staff",
        venueId: venueA,
      }),
    ])
    await makeManager(admin, mgr, venueA)
    versionA = await publishMenu(
      admin,
      venueA,
      menu("TEST manager services menu", [
        section("mains", "Mains", [
          item("mains--korma", "Korma"),
          item("mains--dal", "Dal"),
          item("mains--tikka", "Tikka"),
        ]),
        section("bar", "Bar", [item("bar--lassi", "Lassi")], "drinks"),
      ])
    )
    items = (await readDocument(service, versionA)).byKey
    versionB = await publishMenu(
      admin,
      venueB,
      menu("TEST manager services menu B", [
        section("mains", "Mains", [item("mains--naan", "Naan")]),
      ])
    )
    itemsB = (await readDocument(service, versionB)).byKey
    staffActor = await actorFor(staff)
    mgrCtx = okOf(await managerPhotoCtxFor(await actorFor(mgr))).ctx
    adminCtx = okOf(await managerPhotoCtxFor(await actorFor(admin), venueA)).ctx
  })

  it("staff actor refused by getManagerPhotoCtx", async () => {
    expect(await managerPhotoCtxFor(staffActor)).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(mgrCtx).toMatchObject({ venueId: venueA, role: "manager" })
    expect(await managerPhotoCtxFor(mgrCtx.actor, venueB)).toMatchObject({
      ok: false,
      code: "wrong_venue",
    })
  })

  it("decideMenuPhoto accept returns fresh cards", async () => {
    const korma = items["mains--korma"]!.itemId
    const [first, second] = [
      await labelledPhoto(staff, korma),
      await labelledPhoto(staff2, korma),
    ]
    const before = okOf(await getManagerOverview(mgrCtx)).overview
    expect(before).toMatchObject({ menuState: "ready", eligible: 4 })

    const queue = okOf(
      await listReviewQueue(mgrCtx, { status: "pending", itemId: korma })
    )
    expect(queue.items.map((c) => c.asset.assetId).sort()).toEqual(
      [first, second].sort()
    )
    const card = queue.items.find((c) => c.asset.assetId === first)!
    expect(card).toMatchObject({
      kind: "labelled",
      item: { itemId: korma, covered: false },
      contributor: { id: staff.id, status: "here", canFollowUp: true },
      isSelf: false,
      groupCount: 1,
    })
    expect(card.asset.thumbnailUrl).toBe(`/api/menu-photos/${first}/thumb`)

    const decided = okOf(
      await decideMenuPhoto(
        mgrCtx,
        {
          requestId: requestId(),
          action: "accept",
          assetId: first,
          itemId: korma,
          expectedRevision: card.itemRevision,
        },
        { status: "pending" }
      )
    ).outcome
    expect(decided).toMatchObject({
      action: "accept",
      itemId: korma,
      replayed: false,
      itemCovered: true,
      preferredAssetId: first,
    })
    expect(decided.itemRevision).toBeGreaterThan(card.itemRevision)
    // The accepted photo left `pending`; the other one is still waiting, now
    // on a covered item.
    expect(decided.cards.map((c) => c.asset.assetId)).toEqual([second])
    expect(decided.cards[0]!.item!.covered).toBe(true)

    const after = okOf(await getManagerOverview(mgrCtx)).overview
    expect(after.covered).toBe(before.covered + 1)
    expect(after.pendingPhotos).toBe(before.pendingPhotos - 1)
  })

  it("conflict returns current cards", async () => {
    const dal = items["mains--dal"]!.itemId
    const [a, b] = [
      await labelledPhoto(staff, dal),
      await labelledPhoto(staff2, dal),
    ]
    const stale = await revisionOf(dal)
    okOf(
      await decideMenuPhoto(
        adminCtx,
        {
          requestId: requestId(),
          action: "accept",
          assetId: a,
          itemId: dal,
          expectedRevision: stale,
          venueId: venueA,
        },
        { status: "pending" }
      )
    )
    const conflict = await decideMenuPhoto(
      mgrCtx,
      {
        requestId: requestId(),
        action: "accept_preferred",
        assetId: b,
        itemId: dal,
        expectedRevision: stale,
      },
      { status: "pending" }
    )
    expect(conflict).toMatchObject({ ok: false, code: "revision_conflict" })
    if (conflict.ok) throw new Error("expected a conflict")
    expect(conflict.current?.map((c) => c.asset.assetId)).toEqual([b])
    expect(conflict.current?.[0]?.itemRevision).toBe(await revisionOf(dal))
    expect(conflict.current?.[0]?.item?.covered).toBe(true)
  })

  it("network retry replays (call twice with the same requestId)", async () => {
    const tikka = items["mains--tikka"]!.itemId
    const asset = await labelledPhoto(staff, tikka)
    const input = {
      requestId: requestId(),
      action: "ask_another",
      assetId: asset,
      itemId: tikka,
      expectedRevision: await revisionOf(tikka),
      reason: "Show the whole plate",
    }
    const first = okOf(
      await decideMenuPhoto(mgrCtx, input, { status: "pending" })
    ).outcome
    const again = okOf(
      await decideMenuPhoto(mgrCtx, input, { status: "pending" })
    ).outcome
    expect(first.replayed).toBe(false)
    expect(again).toMatchObject({
      replayed: true,
      itemId: tikka,
      itemRevision: first.itemRevision,
      itemCovered: false,
    })
    const { count } = await service
      .from("menu_item_photo_events")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", asset)
    expect(count).toBe(1)
    // The same key for a different change is refused.
    expect(
      await decideMenuPhoto(
        mgrCtx,
        { ...input, action: "accept", reason: undefined },
        { status: "pending" }
      )
    ).toMatchObject({ ok: false, code: "invalid_input" })
    // The request now shows under "Asked for another".
    const asked = okOf(
      await listReviewQueue(mgrCtx, {
        status: "needs_another_photo",
        itemId: tikka,
      })
    )
    expect(asked.items).toEqual([
      expect.objectContaining({
        kind: "decided",
        state: "better_photo_requested",
        reason: "Show the whole plate",
      }),
    ])
  })

  it("admin with venueId works", async () => {
    const lassi = items["bar--lassi"]!.itemId
    const asset = await labelledPhoto(staff2, lassi)
    const overview = okOf(await getManagerOverview(adminCtx)).overview
    expect(overview.venueId).toBe(venueA)
    const card = okOf(
      await listReviewQueue(adminCtx, { itemId: lassi })
    ).items.find((c) => c.asset.assetId === asset)!
    const outcome = okOf(
      await decideMenuPhoto(
        adminCtx,
        {
          requestId: requestId(),
          action: "accept_preferred",
          assetId: asset,
          itemId: lassi,
          expectedRevision: card.itemRevision,
          venueId: venueA,
        },
        { status: "all" }
      )
    ).outcome
    expect(outcome).toMatchObject({
      itemCovered: true,
      preferredAssetId: asset,
    })
    // `all` keeps the accepted card, now the menu photo.
    expect(outcome.cards).toEqual([
      expect.objectContaining({
        kind: "decided",
        state: "accepted",
        isPrimary: true,
        isEffectivePrimary: true,
      }),
    ])
  })

  it("relink moves a wrongly labelled photo to the picked item", async () => {
    const tikka = items["mains--tikka"]!.itemId
    const dal = items["mains--dal"]!.itemId
    const asset = await labelledPhoto(staff2, tikka)
    const input = {
      requestId: requestId(),
      action: "relink",
      assetId: asset,
      itemId: dal,
      correctsItemId: tikka,
      expectedRevision: await revisionOf(dal),
      reason: "This is the dal, not the tikka",
    }
    // A relink without a reason never reaches the database.
    expect(
      await decideMenuPhoto(mgrCtx, { ...input, reason: " " }, {})
    ).toMatchObject({ ok: false, code: "invalid_input" })
    const outcome = okOf(
      await decideMenuPhoto(mgrCtx, input, { status: "accepted" })
    ).outcome
    expect(outcome).toMatchObject({ itemId: dal, itemCovered: true })
    expect(outcome.cards).toContainEqual(
      expect.objectContaining({
        kind: "decided",
        basis: "reviewer",
        correctsItemId: tikka,
        correctsItemName: "Tikka",
        staffLabels: [expect.objectContaining({ itemId: tikka })],
      })
    )
    // The Tikka label left the waiting set.
    const waiting = okOf(
      await listReviewQueue(mgrCtx, { status: "pending", itemId: tikka })
    )
    expect(waiting.items.map((c) => c.asset.assetId)).not.toContain(asset)
  })

  it("getManagerItem returns null for item on another venue", async () => {
    const naan = itemsB["mains--naan"]!.itemId
    expect(okOf(await getManagerItem(mgrCtx, naan)).detail).toBeNull()
    expect(okOf(await getManagerItem(mgrCtx, "not-a-uuid")).detail).toBeNull()
    expect(
      okOf(await getManagerItem(mgrCtx, crypto.randomUUID())).detail
    ).toBeNull()
  })

  it("getManagerItem fallback preferred", async () => {
    const korma = items["mains--korma"]!.itemId
    const detail = okOf(await getManagerItem(mgrCtx, korma)).detail!
    expect(detail.item).toMatchObject({
      itemId: korma,
      name: "Korma",
      status: "covered",
      section: { name: "Mains", kind: "food" },
      acceptedCount: 1,
      candidateCount: 1,
    })
    expect(detail.preferred).toMatchObject({
      isPrimary: true,
      fallback: false,
      basis: "staff_label",
      author: { id: staff.id, status: "here" },
    })
    expect(detail.waiting.items).toHaveLength(1)

    // The flag is lost (as after a primary is cleared): the earliest accepted
    // photo shows, marked as a fallback.
    const { data: primary, error: readError } = await service
      .from("menu_item_photos")
      .select("id, revision")
      .eq("id", detail.preferred!.photoId)
      .single()
    if (readError) throw readError
    const { error } = await service
      .from("menu_item_photos")
      .update({ is_primary: false, revision: primary.revision + 1 })
      .eq("id", primary.id)
    if (error) throw error
    const fallback = okOf(await getManagerItem(mgrCtx, korma)).detail!
    expect(fallback.preferred).toMatchObject({
      photoId: detail.preferred!.photoId,
      isPrimary: false,
      isEffective: true,
      fallback: true,
    })
    expect(fallback.alternatives).toEqual([])
  })
})
