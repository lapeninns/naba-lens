// Album AL-3: the pure half of Review in a thumb (DESIGN.md §6.5), which
// Review the bare page opens, and the server read behind it.
import { beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))
vi.mock("next/navigation", () => nav)

const photos = vi.hoisted(() => ({
  getManagerOverview: vi.fn(),
  listManagerMenuItems: vi.fn(),
  listReviewQueue: vi.fn(),
}))
vi.mock("@/lib/server/menu-photos", () => photos)
const areas = vi.hoisted(() => ({
  listAreaPhotoQueue: vi.fn(),
  AREA_QUEUE_LIMIT: 2,
}))
vi.mock("@/lib/server/area-photos", () => areas)
const album = vi.hoisted(() => ({
  getAlbumPlacements: vi.fn(),
  getAlbumBriefs: vi.fn(),
}))
vi.mock("@/lib/server/album", () => album)
vi.mock("@/app/manager/actions", () => ({}))
vi.mock("@/app/manager/area-actions", () => ({}))

import { AlbumReviewBody } from "@/app/manager/review/_shared/album-review"
import {
  REVIEW_LIST_HREF,
  reviewModeOf,
} from "@/app/manager/review/_shared/mode"
import {
  conflictRevision,
  decidable,
  fromAreaCard,
  fromMenuCard,
  menuDecision,
  otherReason,
  REASONS,
  retakeReasonCode,
  reviewLine,
  withRevision,
  type MenuSubject,
  type ReviewContext,
} from "@/components/nabalens/album/review/model"
import { reviewHref } from "@/components/nabalens/manager/review/links"
import type { AreaPhotoCard } from "@/lib/server/area-photos"
import type { QueueCard } from "@/lib/server/menu-photos/types"

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const SOUP = id(0xc1)
const STARTERS = id(0x5)

function card(over: Partial<QueueCard> = {}): QueueCard {
  return {
    key: id(0x11),
    kind: "labelled",
    labelId: id(0x11),
    photoId: null,
    asset: {
      assetId: id(0xa1),
      thumbnailUrl: "/thumb",
      previewUrl: "/preview",
      width: 320,
      height: 240,
    },
    uploadedAt: "2026-11-04T12:00:00.000Z",
    labelledAt: "2026-11-04T12:05:00.000Z",
    contributor: {
      id: id(0xf1),
      name: "TEST Sam Lee",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: SOUP,
      name: "Soup",
      sectionId: STARTERS,
      sectionName: "Starters",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [
      {
        itemId: SOUP,
        variantId: null,
        itemName: "Soup",
        variantName: null,
        onMenu: true,
      },
    ],
    state: null,
    isPrimary: false,
    isEffectivePrimary: false,
    basis: null,
    reason: null,
    recheckKind: null,
    correctsItemId: null,
    correctsVariantId: null,
    correctsItemName: null,
    itemRevision: 3,
    groupCount: 0,
    ...over,
  }
}

function area(over: Partial<AreaPhotoCard> = {}): AreaPhotoCard {
  return {
    labelId: id(0x71),
    assetId: id(0xb1),
    authorName: "TEST Ana Park",
    area: "Beer garden",
    uploadedAt: "2026-11-04T09:00:00.000Z",
    labelledAt: "2026-11-04T09:01:00.000Z",
    creditMonth: "2026-11-01",
    state: "pending",
    reason: null,
    decidedAt: null,
    canDecide: true,
    thumbnailUrl: "/a-thumb",
    previewUrl: null,
    ...over,
  }
}

const CONTEXT: ReviewContext = {
  sectionPlace: new Map([[STARTERS, "Kitchen pass"]]),
  sectionBrief: new Map([[STARTERS, "Each starter on its own plate"]]),
  itemBrief: new Map([[SOUP, "  The bowl from above,\n steam showing "]]),
}

describe("stage photos from the queues", () => {
  it("a waiting dish photo: its slot name, brief, place and the accept it offers", () => {
    const photo = fromMenuCard(card(), CONTEXT)!
    expect(photo).toMatchObject({
      key: `dish:${id(0x11)}`,
      name: "Soup",
      brief: "The bowl from above, steam showing",
      author: "TEST Sam Lee",
      addedAt: "2026-11-04T12:05:00.000Z",
      place: "Kitchen pass",
      imageUrl: "/preview",
      own: false,
      subject: { kind: "dish", accept: "accept", askAgain: true },
    })
  })

  it("a dish without its own brief takes its section's; with neither, none", () => {
    const sectionOnly: ReviewContext = { ...CONTEXT, itemBrief: new Map() }
    expect(fromMenuCard(card(), sectionOnly)!.brief).toBe(
      "Each starter on its own plate"
    )
    const none: ReviewContext = {
      ...CONTEXT,
      itemBrief: new Map(),
      sectionBrief: new Map(),
    }
    expect(fromMenuCard(card(), none)!.brief).toBeNull()
  })

  it("names a variant, and a dish with variants none was chosen for", () => {
    expect(
      fromMenuCard(
        card({
          item: { ...card().item!, variantId: id(0x9), variantName: "Large" },
        })
      )!.name
    ).toBe("Soup (Large)")
    expect(
      fromMenuCard(
        card({
          staffLabels: [{ ...card().staffLabels[0]!, unspecified: true }],
        })
      )!.name
    ).toBe("Soup (Not specified)")
  })

  it("a photo to recheck accepts again; a reviewer's match can't be asked again", () => {
    const recheck = fromMenuCard(
      card({ state: "needs_recheck", basis: "reviewer", photoId: id(0x99) })
    )!
    expect(recheck.subject).toMatchObject({
      accept: "reaccept",
      askAgain: false,
    })
  })

  it("no brief, no place: null rather than empty words", () => {
    const photo = fromMenuCard(card())!
    expect(photo.brief).toBeNull()
    expect(photo.place).toBeNull()
  })

  it("an area photo is its own place and has no brief; one the caller can't decide is theirs", () => {
    expect(fromAreaCard(area())).toMatchObject({
      key: `area:${id(0x71)}`,
      name: "Beer garden",
      place: "Beer garden",
      brief: null,
      imageUrl: "/a-thumb",
      own: false,
    })
    expect(fromAreaCard(area({ canDecide: false })).own).toBe(true)
  })

  it("own photos and cards only the list can decide never reach the stage", () => {
    const mine = fromMenuCard(card({ isSelf: true }))!
    const stale = fromMenuCard(card({ kind: "stale", key: id(0x12) }))!
    expect(decidable(mine)).toBe(false)
    expect(decidable(stale)).toBe(false)
    expect(fromMenuCard(card({ item: null, kind: "unlabelled" }))).toBeNull()
    expect(reviewLine([mine, stale])).toEqual([])
  })

  it("the line is longest waiting first across both queues, each photo once", () => {
    const soup = fromMenuCard(card())!
    const garden = fromAreaCard(area())
    expect(reviewLine([soup, garden, soup]).map((p) => p.key)).toEqual([
      garden.key,
      soup.key,
    ])
  })
})

describe("decisions", () => {
  const subject = fromMenuCard(card())!.subject as MenuSubject

  it("Accept and Ask again build the inputs the Review list sends", () => {
    expect(menuDecision(subject, { kind: "accept" })).toEqual({
      action: "accept",
      assetId: id(0xa1),
      itemId: SOUP,
      variantId: null,
      expectedRevision: 3,
    })
    expect(menuDecision(subject, { kind: "ask", reason: "Too dark" })).toEqual({
      action: "ask_another",
      assetId: id(0xa1),
      itemId: SOUP,
      variantId: null,
      expectedRevision: 3,
      reason: "Too dark",
    })
  })

  it("accepting a reviewer's match again names the item it corrects", () => {
    const recheck = fromMenuCard(
      card({
        state: "needs_recheck",
        basis: "reviewer",
        photoId: id(0x99),
        correctsItemId: id(0xc9),
        correctsVariantId: null,
      })
    )!.subject as MenuSubject
    expect(menuDecision(recheck, { kind: "accept" })).toMatchObject({
      action: "reaccept",
      basis: "reviewer",
      correctsItemId: id(0xc9),
      correctsVariantId: null,
    })
    expect(menuDecision(recheck, { kind: "ask", reason: "x" })).toBeNull()
  })

  it("a dish's other photos take its new revision; a conflict gives the fresh one", () => {
    const soup = fromMenuCard(card())!
    const garden = fromAreaCard(area())
    const [a, b] = withRevision([soup, garden], SOUP, 7)
    expect((a!.subject as MenuSubject).itemRevision).toBe(7)
    expect(b).toBe(garden)
    expect(conflictRevision(subject, [card({ itemRevision: 9 })])).toBe(9)
    expect(
      conflictRevision(subject, [
        card({ asset: { ...card().asset, assetId: id(0xa2) } }),
      ])
    ).toBeNull()
    expect(conflictRevision(subject, undefined)).toBeNull()
  })

  it("the reason chips, and Other's words trimmed and capped", () => {
    expect(REASONS).toEqual([
      "Show all of it",
      "Too dark",
      "Out of focus",
      "Not how it's served now",
      "Show the way in",
      "Messy background",
      "People or personal details in shot",
    ])
    // Each chip carries the spec's code (§7 M2); a written reason has none.
    expect(retakeReasonCode("Too dark")).toBe("insufficient_light")
    expect(retakeReasonCode("Not how it's served now")).toBe(
      "wrong_presentation"
    )
    expect(retakeReasonCode("Wrong item")).toBeNull()
    expect(otherReason("   ")).toBeNull()
    expect(otherReason("  more   light ")).toBe("more light")
    expect(otherReason("x".repeat(600))).toHaveLength(500)
  })
})

describe("which Review the page opens", () => {
  it("the bare page is Review in a thumb; any list filter opens the list", () => {
    expect(reviewModeOf({})).toBe("thumb")
    expect(reviewModeOf({ status: "pending" })).toBe("thumb")
    expect(reviewModeOf({ view: "list" })).toBe("list")
    expect(reviewModeOf({ status: "accepted" })).toBe("list")
    expect(reviewModeOf({ section: id(1) })).toBe("list")
    expect(reviewModeOf({ contributor: id(1) })).toBe("list")
    expect(reviewModeOf({ item: id(1) })).toBe("list")
    expect(REVIEW_LIST_HREF).toBe("/manager/review?view=list")
  })

  it("a list filter's link keeps the full list, even with every filter cleared", () => {
    const cleared = {
      status: "pending" as const,
      sectionId: null,
      contributorId: null,
      itemId: null,
    }
    const modeOf = (href: string) =>
      reviewModeOf(
        Object.fromEntries(new URL(href, "http://x").searchParams) as never
      )
    expect(reviewHref({ kind: "manager" }, cleared)).toBe(
      "/manager/review?view=list"
    )
    expect(modeOf(reviewHref({ kind: "manager" }, cleared))).toBe("list")
    expect(
      modeOf(reviewHref({ kind: "manager" }, { ...cleared, sectionId: id(1) }))
    ).toBe("list")
    // The admin page has no Review in a thumb; its links stay bare.
    expect(reviewHref({ kind: "admin", venueId: id(2) }, cleared)).toBe(
      `/admin/coverage/${id(2)}/menu-photos`
    )
  })
})

describe("AlbumReviewBody (server read)", () => {
  const ctx = {
    actor: { profile: { id: id(0xe1) } },
    venueId: id(0xa0),
    role: "manager",
  }
  const overview = (over: Record<string, unknown> = {}) => ({
    ok: true,
    overview: {
      venueName: "The Railway",
      menuState: "ready",
      pendingPhotos: 30,
      ...over,
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    photos.getManagerOverview.mockResolvedValue(overview())
    photos.listReviewQueue.mockResolvedValue({
      ok: true,
      items: [card(), card({ key: id(0x12), isSelf: true })],
      nextCursor: null,
    })
    // The guest-facing menu description is never the brief (§2 principle 4).
    photos.listManagerMenuItems.mockResolvedValue({
      ok: true,
      items: [{ itemId: SOUP, description: "Menu description" }],
      nextCursor: null,
    })
    album.getAlbumBriefs.mockResolvedValue({
      ok: true,
      briefs: {
        sections: new Map([
          ["starters", "Each starter on its own plate"],
          ["mains", "Not placed"],
        ]),
        items: new Map([[SOUP, "Steam showing"]]),
        amenities: new Map(),
      },
    })
    areas.listAreaPhotoQueue.mockResolvedValue({
      ok: true,
      cards: [area(), area({ labelId: id(0x72), canDecide: false })],
    })
    album.getAlbumPlacements.mockResolvedValue({
      ok: true,
      places: [{ subjectId: id(0xd1), kind: "room", label: "Kitchen pass" }],
      placements: [
        { source: "menu_section", key: "starters", subjectId: id(0xd1) },
      ],
      sections: [{ sectionId: STARTERS, slug: "starters", name: "Starters" }],
    })
  })

  const props = async () => {
    const el = (await AlbumReviewBody({
      ctx: ctx as never,
      venueName: "Fallback",
    })) as { props: Record<string, unknown> }
    return el.props
  }

  it("reads the waiting queues with places and briefs, and counts what the caller can decide", async () => {
    const p = await props()
    expect(photos.listReviewQueue).toHaveBeenCalledWith(ctx, {
      status: "pending",
    })
    expect(areas.listAreaPhotoQueue).toHaveBeenCalledWith(ctx, "pending")
    expect(album.getAlbumPlacements).toHaveBeenCalledWith(
      ctx.actor,
      ctx.venueId
    )
    expect(p.venueName).toBe("The Railway")
    expect(album.getAlbumBriefs).toHaveBeenCalledWith(ctx.actor, ctx.venueId)
    expect(photos.listManagerMenuItems).not.toHaveBeenCalled()
    expect(p.context).toEqual({
      sectionPlace: { [STARTERS]: "Kitchen pass" },
      sectionBrief: { [STARTERS]: "Each starter on its own plate" },
      itemBrief: { [SOUP]: "Steam showing" },
    })
    // One dish and one area photo; the two own photos are not counted.
    expect(p.total).toBe(2)
    expect(p.listHref).toBe(REVIEW_LIST_HREF)
  })

  it("with more menu pages, the overview's count stands in for the unread ones", async () => {
    photos.listReviewQueue.mockResolvedValue({
      ok: true,
      items: [card()],
      nextCursor: "c",
    })
    const p = await props()
    expect(p.menuCursor).toBe("c")
    expect(p.total).toBe(31)
  })

  it("places, briefs and area photos are extras: their failures leave the menu photos", async () => {
    album.getAlbumPlacements.mockRejectedValue(new Error("down"))
    album.getAlbumBriefs.mockResolvedValue({ ok: false, code: "x" })
    areas.listAreaPhotoQueue.mockResolvedValue({ ok: false, code: "x" })
    const p = await props()
    expect(p.context).toEqual({
      sectionPlace: {},
      sectionBrief: {},
      itemBrief: {},
    })
    expect(p.areaCards).toEqual([])
    expect(p.total).toBe(1)
  })

  it("says more area photos may wait when the area read was a full page", async () => {
    expect((await props()).areaMore).toBe(true)
    areas.listAreaPhotoQueue.mockResolvedValue({ ok: true, cards: [area()] })
    expect((await props()).areaMore).toBe(false)
  })

  it("a menu that is not ready has no dish photos to decide", async () => {
    photos.getManagerOverview.mockResolvedValue(
      overview({ menuState: "no_menu" })
    )
    photos.listReviewQueue.mockResolvedValue({ ok: false, code: "unavailable" })
    const p = await props()
    expect(p.menuCards).toEqual([])
    expect(p.total).toBe(1)
  })

  it("a refused read goes to Overview, as the list does", async () => {
    photos.listReviewQueue.mockResolvedValue({
      ok: false,
      code: "not_permitted",
    })
    await expect(props()).rejects.toThrow("NEXT_REDIRECT /manager")
  })
})
