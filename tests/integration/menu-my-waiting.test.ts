// Our menu own waiting photos (B02 addition for UI UP-25): listOurMenuItems
// sets myWaiting on every item from my_menu_waiting_items, the caller's own
// photos of that item waiting for a decision. Own photos only (D3). Real
// signed-in identities through actorFor; the service role builds fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import { listOurMenuItems, reviewItemPhoto } from "@/lib/server/coverage"
import type { CoverageResult } from "@/lib/server/coverage/types"
import type { MediaActor } from "@/lib/server/media/types"

import { seedAsset } from "../library/seed"
import { legacyStaffGrant } from "../security/coverage-fixtures"
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

function okOf<T extends object>(result: CoverageResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}

describe("Our menu: my waiting photos per item", () => {
  const service = serviceClient()
  let venue: string
  let version: string
  let items: Record<string, CatalogueRow>
  let admin: TestIdentity
  let manager: TestIdentity
  let staff: TestIdentity
  let staff2: TestIdentity
  const actors = {} as Record<
    "admin" | "manager" | "staff" | "staff2",
    MediaActor
  >

  async function labelledPhoto(
    who: TestIdentity,
    tuples: { itemId: string; variantId: string | null }[]
  ) {
    const asset = await seedAsset(service, {
      uploaderId: who.id,
      venueId: venue,
      derivatives: true,
    })
    await saveOk(who, {
      asset: asset.id,
      revision: 0,
      items: tuples,
      catalogue: version,
    })
    return asset.id
  }

  async function waiting(who: MediaActor, args: object = {}) {
    const page = okOf(await listOurMenuItems(who, args))
    return Object.fromEntries(page.items.map((i) => [i.name, i.myWaiting]))
  }

  beforeAll(async () => {
    venue = (await createVenue(service, "menu-mine")).id
    ;[admin, manager, staff, staff2] = await Promise.all([
      createIdentity(service, { label: "menu-mine-admin", role: "admin" }),
      createIdentity(service, {
        label: "menu-mine-mgr",
        role: "staff",
        venueId: venue,
      }),
      createIdentity(service, {
        label: "menu-mine-s1",
        role: "staff",
        venueId: venue,
      }),
      createIdentity(service, {
        label: "menu-mine-s2",
        role: "staff",
        venueId: venue,
      }),
    ])
    await legacyStaffGrant(service, admin, manager.id, venue)
    version = await publishMenu(
      admin,
      venue,
      menu("TEST my waiting menu", [
        section("curries", "Curries", [
          item("curries--korma", "Korma", { variants: ["Chicken", "Lamb"] }),
          item("curries--dal", "Dal makhani"),
        ]),
      ])
    )
    items = (await readDocument(service, version)).byKey
    for (const [name, who] of Object.entries({ admin, manager, staff, staff2 }))
      actors[name as keyof typeof actors] = await actorFor(who)
  })

  it("counts only the caller's own waiting photos, once per photo", async () => {
    const korma = items["curries--korma"]!
    const dal = items["curries--dal"]!
    expect(await waiting(actors.staff)).toEqual({ Korma: 0, "Dal makhani": 0 })

    // One photo labelled with both variants of Korma counts once.
    await labelledPhoto(staff, [
      { itemId: korma.itemId, variantId: korma.variants[0]!.variantId },
      { itemId: korma.itemId, variantId: korma.variants[1]!.variantId },
    ])
    const plain = await labelledPhoto(staff, [
      { itemId: korma.itemId, variantId: null },
    ])
    await labelledPhoto(staff2, [{ itemId: dal.itemId, variantId: null }])

    expect(await waiting(actors.staff)).toEqual({ Korma: 2, "Dal makhani": 0 })
    expect(await waiting(actors.staff2)).toEqual({
      Korma: 0,
      "Dal makhani": 1,
    })
    // A reviewer sees the venue's candidates in review, but myWaiting stays
    // their own (none here).
    const reviewer = okOf(await listOurMenuItems(actors.manager, {}))
    expect(reviewer.items[0]).toMatchObject({
      name: "Korma",
      myWaiting: 0,
      review: { candidates: expect.any(Number) },
    })
    expect(await waiting(actors.admin, { venueId: venue })).toEqual({
      Korma: 0,
      "Dal makhani": 0,
    })

    // A decision ends the wait for that photo; the other one still waits.
    const decided = await reviewItemPhoto(actors.manager, {
      requestId: crypto.randomUUID(),
      assetId: plain,
      itemId: korma.itemId,
      decision: "accept",
      expectedRevision: 1,
    })
    expect(decided).toMatchObject({ ok: true })
    expect(await waiting(actors.staff)).toEqual({ Korma: 1, "Dal makhani": 0 })
  })

  it("never reports another person's photos through the RPC", async () => {
    const dal = items["curries--dal"]!
    const { data, error } = await (
      staff.client as unknown as {
        rpc(
          fn: string,
          args: object
        ): PromiseLike<{
          data: { item_id: string; waiting: number }[] | null
          error: { message: string } | null
        }>
      }
    ).rpc("my_menu_waiting_items", {
      p_venue_id: venue,
      p_item_ids: [dal.itemId],
    })
    expect(error).toBeNull()
    expect(data).toEqual([])
    const tooMany = await (
      staff.client as unknown as {
        rpc(
          fn: string,
          args: object
        ): PromiseLike<{ error: { message: string } | null }>
      }
    ).rpc("my_menu_waiting_items", {
      p_venue_id: venue,
      p_item_ids: Array.from({ length: 101 }, () => crypto.randomUUID()),
    })
    expect(tooMany.error?.message).toBe("invalid_item_list")
  })
})
