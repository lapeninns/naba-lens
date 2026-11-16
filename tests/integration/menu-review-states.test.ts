// Still needed review state (goals-not-tasks G-1, decision 11):
// listOurMenuItems sets reviewState on every item from
// menu_item_review_states, so any colleague sees "Waiting for review" on a
// dish whose only photo waits for a decision. Flags only, never whose photo.
// Real signed-in identities through actorFor; the service role builds
// fixtures.
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

type Rpc = {
  rpc(
    fn: string,
    args: object
  ): PromiseLike<{
    data: unknown[] | null
    error: { message: string } | null
  }>
}

describe("Our menu: review state per dish", () => {
  const service = serviceClient()
  let venue: string
  let otherVenue: string
  let version: string
  let items: Record<string, CatalogueRow>
  let admin: TestIdentity
  let manager: TestIdentity
  let staff: TestIdentity
  let staff2: TestIdentity
  let outsider: TestIdentity
  const actors = {} as Record<
    "admin" | "manager" | "staff" | "staff2" | "outsider",
    MediaActor
  >

  async function labelledPhoto(who: TestIdentity, itemId: string) {
    const asset = await seedAsset(service, {
      uploaderId: who.id,
      venueId: venue,
      derivatives: true,
    })
    await saveOk(who, {
      asset: asset.id,
      revision: 0,
      items: [{ itemId, variantId: null }],
      catalogue: version,
    })
    return asset.id
  }

  async function states(who: MediaActor, args: object = {}) {
    const page = okOf(await listOurMenuItems(who, args))
    return Object.fromEntries(page.items.map((i) => [i.name, i.reviewState]))
  }

  beforeAll(async () => {
    venue = (await createVenue(service, "menu-states")).id
    otherVenue = (await createVenue(service, "menu-states-other")).id
    ;[admin, manager, staff, staff2, outsider] = await Promise.all([
      createIdentity(service, { label: "menu-states-admin", role: "admin" }),
      createIdentity(service, {
        label: "menu-states-mgr",
        role: "staff",
        venueId: venue,
      }),
      createIdentity(service, {
        label: "menu-states-s1",
        role: "staff",
        venueId: venue,
      }),
      createIdentity(service, {
        label: "menu-states-s2",
        role: "staff",
        venueId: venue,
      }),
      createIdentity(service, {
        label: "menu-states-out",
        role: "staff",
        venueId: otherVenue,
      }),
    ])
    await legacyStaffGrant(service, admin, manager.id, venue)
    version = await publishMenu(
      admin,
      venue,
      menu("TEST review states menu", [
        section("curries", "Curries", [
          item("curries--korma", "Korma"),
          item("curries--dal", "Dal makhani"),
        ]),
      ])
    )
    items = (await readDocument(service, version)).byKey
    for (const [name, who] of Object.entries({
      admin,
      manager,
      staff,
      staff2,
      outsider,
    }))
      actors[name as keyof typeof actors] = await actorFor(who)
  })

  it("shows a colleague's waiting photo to everyone at the venue until it is decided", async () => {
    const korma = items["curries--korma"]!
    expect(await states(actors.staff2)).toEqual({
      Korma: null,
      "Dal makhani": null,
    })

    const photo = await labelledPhoto(staff, korma.itemId)
    // Not only the uploader: any colleague, the reviewer and an admin.
    for (const who of [actors.staff, actors.staff2, actors.manager])
      expect(await states(who)).toEqual({
        Korma: "waiting",
        "Dal makhani": null,
      })
    expect(await states(actors.admin, { venueId: venue })).toEqual({
      Korma: "waiting",
      "Dal makhani": null,
    })
    // Still needed keeps the dish, with its state.
    const gaps = okOf(
      await listOurMenuItems(actors.staff2, { gapsOnly: true, limit: 4 })
    )
    expect(gaps.items.map((i) => [i.name, i.reviewState])).toEqual([
      ["Korma", "waiting"],
      ["Dal makhani", null],
    ])

    const decided = await reviewItemPhoto(actors.manager, {
      requestId: crypto.randomUUID(),
      assetId: photo,
      itemId: korma.itemId,
      decision: "accept",
      expectedRevision: 1,
    })
    expect(decided).toMatchObject({ ok: true })
    // Accepted: the dish is covered, so it is not still needed at all.
    expect(await states(actors.staff2)).toEqual({
      Korma: null,
      "Dal makhani": null,
    })
  })

  it("returns item ids and two flags only, for the caller's own venue", async () => {
    const dal = items["curries--dal"]!
    await labelledPhoto(staff2, dal.itemId)
    const own = await (staff.client as unknown as Rpc).rpc(
      "menu_item_review_states",
      { p_venue_id: venue, p_item_ids: [dal.itemId] }
    )
    expect(own.error).toBeNull()
    expect(own.data).toEqual([
      { item_id: dal.itemId, waiting: true, rechecking: false },
    ])

    const other = await (outsider.client as unknown as Rpc).rpc(
      "menu_item_review_states",
      { p_venue_id: venue, p_item_ids: [dal.itemId] }
    )
    expect(other.data).toBeNull()
    expect(other.error?.message).toBe("venue_not_found")
    expect(
      await listOurMenuItems(actors.outsider, { venueId: venue })
    ).toMatchObject({ ok: false, code: "wrong_venue" })

    const tooMany = await (staff.client as unknown as Rpc).rpc(
      "menu_item_review_states",
      {
        p_venue_id: venue,
        p_item_ids: Array.from({ length: 101 }, () => crypto.randomUUID()),
      }
    )
    expect(tooMany.error?.message).toBe("invalid_item_list")
  })
})
