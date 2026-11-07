// Our menu services (lib/server/coverage/menu-items.ts) against an owned local
// stack, as real signed-in identities through actorFor: every call goes
// through the caller's RLS and the item-photo RPCs exactly as the Server
// Functions make them. The service role only builds fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import {
  getMyMenuPhotoStates,
  listMyMenuPhotoDecisions,
  getOurMenu,
  listItemPhotoCandidates,
  listItemPhotoSelfReviews,
  listOurMenuItems,
  reviewItemPhoto,
  setPrimaryItemPhoto,
  signEvidence,
  withdrawItemPhoto,
} from "@/lib/server/coverage"
import { coverageRpcFailure } from "@/lib/server/coverage/errors"
import type { CoverageResult } from "@/lib/server/coverage/types"
import type { MediaActor } from "@/lib/server/media/types"

import { seedAsset } from "../library/seed"
import { grantManager } from "../security/coverage-fixtures"
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

const key = () => crypto.randomUUID()

function okOf<T extends object>(result: CoverageResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}

describe("Our menu services", () => {
  const service = serviceClient()
  let venueA: string
  let venueB: string
  let versionA: string
  let items: Record<string, CatalogueRow>
  let admin: TestIdentity
  let manager: TestIdentity
  let staff: TestIdentity
  let staff2: TestIdentity
  let otherManager: TestIdentity
  const actors = {} as Record<
    "admin" | "manager" | "staff" | "staff2" | "otherManager",
    MediaActor
  >

  /** A ready photo with real derivatives, labelled by its uploader. */
  async function labelledPhoto(
    who: TestIdentity,
    tuples: { itemId: string; variantId: string | null }[]
  ) {
    const asset = await seedAsset(service, {
      uploaderId: who.id,
      venueId: venueA,
      derivatives: true,
    })
    await saveOk(who, {
      asset: asset.id,
      revision: 0,
      items: tuples,
      catalogue: versionA,
    })
    return asset.id
  }

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      createVenue(service, "menu-svc-a"),
      createVenue(service, "menu-svc-b"),
    ])
    venueA = a.id
    venueB = b.id
    ;[admin, manager, staff, staff2, otherManager] = await Promise.all([
      createIdentity(service, { label: "menu-svc-admin", role: "admin" }),
      createIdentity(service, {
        label: "menu-svc-mgr",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "menu-svc-s1",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "menu-svc-s2",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "menu-svc-mgr-b",
        role: "staff",
        venueId: venueB,
      }),
    ])
    await grantManager(admin, manager.id, venueA)
    await grantManager(admin, otherManager.id, venueB)
    versionA = await publishMenu(
      admin,
      venueA,
      menu("TEST services menu", [
        section("curries", "Curries", [
          item("curries--korma", "Korma", {
            variants: ["Chicken", "Lamb"],
            aliases: ["Qorma"],
          }),
          item("curries--dal", "Dal makhani"),
        ]),
        section("bar", "Bar", [item("bar--lassi", "Mango lassi")], "drinks"),
      ])
    )
    items = (await readDocument(service, versionA)).byKey
    for (const [name, who] of Object.entries({
      admin,
      manager,
      staff,
      staff2,
      otherManager,
    }))
      actors[name as keyof typeof actors] = await actorFor(who)
  })

  it("shows staff their venue's totals and reviewers the waiting photos", async () => {
    const korma = items["curries--korma"]!
    await labelledPhoto(staff, [
      { itemId: korma.itemId, variantId: korma.variants[0]!.variantId },
    ])
    const mine = okOf(await getOurMenu(actors.staff, {})).menu
    expect(mine).toMatchObject({
      venue: { id: venueA },
      menuState: "ready",
      menuVersionId: versionA,
      totals: { eligible: 3, covered: 0, gaps: 3, needsRecheck: 0 },
      review: null,
      canReview: false,
    })
    expect(mine.venue.name).toContain("TEST Venue menu-svc-a")
    expect(mine.sections.map((s) => [s.name, s.kind, s.eligible])).toEqual([
      ["Curries", "food", 2],
      ["Bar", "drinks", 1],
    ])
    expect(mine.sections.every((s) => s.review === null)).toBe(true)

    const reviewer = okOf(await getOurMenu(actors.manager, undefined)).menu
    expect(reviewer.canReview).toBe(true)
    expect(reviewer.review).toMatchObject({ pendingCandidates: 1 })
    expect(reviewer.review!.oldestCandidateAt).toEqual(expect.any(String))

    expect(await getOurMenu(actors.staff, { venueId: venueB })).toMatchObject({
      ok: false,
      code: "wrong_venue",
    })
    expect(await getOurMenu(actors.admin, {})).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
    expect(
      okOf(await getOurMenu(actors.admin, { venueId: venueA })).menu
    ).toMatchObject({ canReview: true, totals: { eligible: 3 } })
    expect(await getOurMenu(actors.staff, "nope")).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
  })

  it("lists, searches and filters items, and pages with an opaque cursor", async () => {
    const all = okOf(await listOurMenuItems(actors.staff, {}))
    expect(all.items.map((i) => i.name)).toEqual([
      "Korma",
      "Dal makhani",
      "Mango lassi",
    ])
    expect(all.nextCursor).toBeNull()
    expect(all.items[0]).toMatchObject({
      sectionName: "Curries",
      sectionKind: "food",
      variants: [
        {
          variantId: items["curries--korma"]!.variants[0]!.variantId,
          name: "Chicken",
        },
        {
          variantId: items["curries--korma"]!.variants[1]!.variantId,
          name: "Lamb",
        },
      ],
      covered: false,
      primary: null,
      itemRevision: 1,
      review: null,
    })
    const byAlias = okOf(await listOurMenuItems(actors.staff, { query: "qor" }))
    expect(byAlias.items.map((i) => i.name)).toEqual(["Korma"])
    const wildcard = okOf(await listOurMenuItems(actors.staff, { query: "%" }))
    expect(wildcard.items).toEqual([])
    const bar = all.items[2]!.sectionId
    expect(
      okOf(await listOurMenuItems(actors.staff, { sectionId: bar })).items.map(
        (i) => i.name
      )
    ).toEqual(["Mango lassi"])
    const reviewer = okOf(await listOurMenuItems(actors.manager, {}))
    expect(reviewer.items[0]!.review).toMatchObject({ candidates: 1 })

    expect(
      await listOurMenuItems(actors.staff, { query: "x".repeat(81) })
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(
      await listOurMenuItems(actors.staff, { cursor: "not-a-cursor" })
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(
      await listOurMenuItems(actors.staff, { gapsOnly: "yes" })
    ).toMatchObject({ ok: false, code: "invalid_input" })

    // Paging: a venue with 55 eligible items.
    const big = (await createVenue(service, "menu-svc-big")).id
    const bigStaff = await createIdentity(service, {
      label: "menu-svc-big-s",
      role: "staff",
      venueId: big,
    })
    await publishMenu(
      admin,
      big,
      menu("TEST big", [
        section(
          "mains",
          "Mains",
          Array.from({ length: 55 }, (_, i) =>
            item(`mains--dish-${i}`, `Dish ${String(i).padStart(2, "0")}`)
          )
        ),
      ])
    )
    const bigActor = await actorFor(bigStaff)
    const first = okOf(await listOurMenuItems(bigActor, {}))
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = okOf(
      await listOurMenuItems(bigActor, { cursor: first.nextCursor })
    )
    expect(second.items.map((i) => i.name)).toEqual([
      "Dish 50",
      "Dish 51",
      "Dish 52",
      "Dish 53",
      "Dish 54",
    ])
    expect(second.nextCursor).toBeNull()
  })

  it("validates review input before calling the database", async () => {
    const korma = items["curries--korma"]!
    const base = {
      requestId: key(),
      assetId: crypto.randomUUID(),
      itemId: korma.itemId,
      decision: "accept",
      expectedRevision: 1,
    }
    expect(await reviewItemPhoto(actors.manager, null)).toMatchObject({
      code: "invalid_input",
    })
    expect(
      await reviewItemPhoto(actors.manager, { ...base, requestId: "short" })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { requestId: expect.any(String) },
    })
    expect(
      await reviewItemPhoto(actors.manager, { ...base, assetId: "x" })
    ).toMatchObject({ code: "not_found" })
    expect(
      await reviewItemPhoto(actors.manager, { ...base, variantId: "x" })
    ).toMatchObject({ code: "not_found" })
    expect(
      await reviewItemPhoto(actors.manager, { ...base, expectedRevision: 0 })
    ).toMatchObject({ code: "invalid_input" })
    expect(
      await reviewItemPhoto(actors.manager, { ...base, decision: "approve" })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { decision: expect.any(String) },
    })
    expect(
      await reviewItemPhoto(actors.manager, {
        ...base,
        decision: "better_photo",
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { reason: expect.any(String) },
    })
    expect(
      await reviewItemPhoto(actors.manager, {
        ...base,
        reason: "x".repeat(501),
      })
    ).toMatchObject({ code: "invalid_input" })
    expect(
      await reviewItemPhoto(actors.manager, { ...base, makePrimary: "yes" })
    ).toMatchObject({ code: "invalid_input" })
    // Unknown photo: the database answers not found.
    expect(await reviewItemPhoto(actors.manager, base)).toMatchObject({
      code: "not_found",
    })
    expect(
      await withdrawItemPhoto(actors.manager, {
        requestId: key(),
        photoId: crypto.randomUUID(),
        expectedRevision: 1,
        reason: "",
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { reason: expect.any(String) },
    })
    expect(
      await setPrimaryItemPhoto(actors.manager, {
        requestId: key(),
        photoId: crypto.randomUUID(),
        expectedRevision: 1,
      })
    ).toMatchObject({ code: "not_found" })
  })

  it("reviews, replays, conflicts, withdraws and sets a primary through the services", async () => {
    const dal = items["curries--dal"]!
    const tuple = { itemId: dal.itemId, variantId: null }
    const first = await labelledPhoto(staff, [tuple])
    const second = await labelledPhoto(staff2, [tuple])

    const candidates = okOf(
      await listItemPhotoCandidates(actors.manager, { itemId: dal.itemId })
    )
    expect(candidates.items.map((c) => c.asset.id).sort()).toEqual(
      [first, second].sort()
    )
    const c0 = candidates.items.find((c) => c.asset.id === first)!
    expect(c0).toMatchObject({
      item: { id: dal.itemId, name: "Dal makhani", sectionName: "Curries" },
      variant: null,
      variantRemoved: false,
      uploader: { id: staff.id, active: true },
      self: false,
      photo: null,
      itemRevision: 1,
      asset: {
        thumbnailUrl: `/api/menu-photos/${first}/thumb`,
        previewUrl: `/api/menu-photos/${first}/preview`,
        available: true,
      },
    })
    expect(await listItemPhotoCandidates(actors.staff, {})).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(
      await listItemPhotoCandidates(actors.otherManager, { venueId: venueA })
    ).toMatchObject({ ok: false, code: "wrong_venue" })

    const requestId = key()
    const accepted = okOf(
      await reviewItemPhoto(actors.manager, {
        requestId,
        assetId: first,
        itemId: dal.itemId,
        variantId: null,
        decision: "accept",
        expectedRevision: 1,
      })
    )
    expect(accepted).toMatchObject({
      photo: {
        state: "accepted",
        isPrimary: true,
        itemRevision: 2,
        selfReview: false,
      },
      replayed: false,
    })
    const replay = okOf(
      await reviewItemPhoto(actors.manager, {
        requestId,
        assetId: first,
        itemId: dal.itemId,
        decision: "accept",
        expectedRevision: 1,
      })
    )
    expect(replay).toMatchObject({
      photo: { photoId: accepted.photo.photoId },
      replayed: true,
    })
    const stale = await reviewItemPhoto(actors.admin, {
      requestId: key(),
      assetId: second,
      itemId: dal.itemId,
      decision: "accept",
      expectedRevision: 1,
    })
    expect(stale).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: 2,
    })
    expect(
      await reviewItemPhoto(actors.otherManager, {
        requestId: key(),
        assetId: second,
        itemId: dal.itemId,
        decision: "accept",
        expectedRevision: 2,
      })
    ).toMatchObject({ ok: false, code: "not_found" })
    const secondAccepted = okOf(
      await reviewItemPhoto(actors.admin, {
        requestId: key(),
        assetId: second,
        itemId: dal.itemId,
        decision: "accept",
        expectedRevision: 2,
        makePrimary: true,
      })
    )
    expect(secondAccepted.photo).toMatchObject({
      isPrimary: true,
      itemRevision: 3,
    })

    const dalRow = okOf(await listOurMenuItems(actors.staff, {})).items.find(
      (i) => i.itemId === dal.itemId
    )!
    expect(dalRow).toMatchObject({
      covered: true,
      acceptedCount: 2,
      primary: { photoId: secondAccepted.photo.photoId },
      itemRevision: 3,
    })
    expect(dalRow.primary!.asset.thumbnailUrl).toBe(
      `/api/menu-photos/${second}/thumb`
    )
    // The primary is previewable by staff at the venue, signed for 60 s.
    const signed = await signEvidence(
      actors.staff,
      second,
      "thumbnail",
      "menu_item_photo_asset"
    )
    expect(signed).toMatchObject({
      ok: true,
      url: expect.stringContaining("/storage/v1/object/sign/"),
    })
    expect(
      // staff2 did not upload `first`, and it is not the primary.
      await signEvidence(
        actors.staff2,
        first,
        "preview",
        "menu_item_photo_asset"
      )
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      await signEvidence(
        actors.otherManager,
        second,
        "preview",
        "menu_item_photo_asset"
      )
    ).toMatchObject({ ok: false, status: 404 })
    // Task evidence routes are unchanged: an item photo is not task evidence.
    expect(
      await signEvidence(actors.manager, second, "thumbnail")
    ).toMatchObject({ ok: false, status: 404 })

    const gaps = okOf(await listOurMenuItems(actors.staff, { gapsOnly: true }))
    expect(gaps.items.map((i) => i.itemId)).not.toContain(dal.itemId)

    const states = okOf(await getMyMenuPhotoStates(actors.staff, [first]))
    expect(states.states).toEqual([
      expect.objectContaining({
        assetId: first,
        itemId: dal.itemId,
        itemName: "Dal makhani",
        state: "accepted",
        isPrimary: false,
      }),
    ])
    expect(
      okOf(await getMyMenuPhotoStates(actors.staff2, { assetIds: [first] }))
        .states
    ).toEqual([])
    // Me's decision sections read every own decision, not only a page's ids.
    expect(okOf(await listMyMenuPhotoDecisions(actors.staff)).states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: first,
          state: "accepted",
          reason: null,
        }),
      ])
    )
    expect(
      okOf(await listMyMenuPhotoDecisions(actors.staff2)).states.map(
        (s) => s.assetId
      )
    ).not.toContain(first)
    expect(await getMyMenuPhotoStates(actors.staff, ["x"])).toMatchObject({
      ok: false,
      code: "invalid_input",
    })

    const primary = okOf(
      await setPrimaryItemPhoto(actors.manager, {
        requestId: key(),
        photoId: accepted.photo.photoId,
        expectedRevision: 3,
      })
    )
    expect(primary).toMatchObject({
      photo: { photoId: accepted.photo.photoId, itemRevision: 4 },
      replayed: false,
    })
    const withdrawn = okOf(
      await withdrawItemPhoto(actors.manager, {
        requestId: key(),
        photoId: accepted.photo.photoId,
        expectedRevision: 4,
        reason: "Not our plating",
      })
    )
    expect(withdrawn.photo).toMatchObject({
      state: "withdrawn",
      itemRevision: 5,
      newPrimaryPhotoId: secondAccepted.photo.photoId,
    })
    expect(
      okOf(await getMyMenuPhotoStates(actors.staff, [first])).states
    ).toEqual([])
  })

  it("lists item-photo self-reviews for admins only", async () => {
    const lassi = items["bar--lassi"]!
    const own = await labelledPhoto(manager, [
      { itemId: lassi.itemId, variantId: null },
    ])
    const reviewed = okOf(
      await reviewItemPhoto(actors.manager, {
        requestId: key(),
        assetId: own,
        itemId: lassi.itemId,
        decision: "accept",
        expectedRevision: 1,
      })
    )
    expect(reviewed.photo.selfReview).toBe(true)
    const page = okOf(
      await listItemPhotoSelfReviews(actors.admin, { venueId: venueA })
    )
    expect(page.items).toEqual([
      expect.objectContaining({
        photoId: reviewed.photo.photoId,
        venue: { id: venueA, name: expect.stringContaining("menu-svc-a") },
        author: { id: manager.id, displayName: expect.any(String) },
        item: { id: lassi.itemId, name: "Mango lassi", variantName: null },
        decision: "accept",
        asset: expect.objectContaining({
          id: own,
          thumbnailUrl: `/api/menu-photos/${own}/thumb`,
          available: true,
        }),
      }),
    ])
    expect(
      await listItemPhotoSelfReviews(actors.manager, { venueId: venueA })
    ).toMatchObject({ ok: false, code: "not_permitted" })
    expect(
      await listItemPhotoSelfReviews(actors.admin, { cursor: "bad" })
    ).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("maps the new database errors to plain-language failures", () => {
    expect(
      coverageRpcFailure(
        { message: "menu_item_not_labelled", code: "P0001" },
        "t"
      )
    ).toMatchObject({ code: "state_conflict", status: 409 })
    expect(
      coverageRpcFailure(
        { message: "menu_item_unavailable", code: "P0001" },
        "t"
      )
    ).toMatchObject({ code: "state_conflict" })
    expect(
      coverageRpcFailure(
        { message: "menu_item_photo_not_found", code: "P0002" },
        "t"
      )
    ).toMatchObject({
      code: "not_found",
      message: expect.stringContaining("menu photo"),
    })
  })

  it("reports a venue without a menu as no_menu", async () => {
    const bare = (await createVenue(service, "menu-svc-bare")).id
    const bareStaff = await actorFor(
      await createIdentity(service, {
        label: "menu-svc-bare-s",
        role: "staff",
        venueId: bare,
      })
    )
    expect(okOf(await getOurMenu(bareStaff, {})).menu).toMatchObject({
      menuState: "no_menu",
      menuVersionId: null,
      totals: { eligible: 0, covered: 0, gaps: 0, needsRecheck: 0 },
      sections: [],
    })
    expect(okOf(await listOurMenuItems(bareStaff, {})).items).toEqual([])
  })
})
