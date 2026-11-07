import { beforeEach, describe, expect, it, vi } from "vitest"

const read = vi.hoisted(() => ({ listReviewQueue: vi.fn() }))
vi.mock("@/lib/server/menu-photos/read", () => read)

import type { ManagerPhotoCtx } from "@/lib/server/menu-photos/context"
import {
  DECIDED_SCAN_PAGES,
  decideMenuPhoto,
} from "@/lib/server/menu-photos/decide"
import type { QueueCard } from "@/lib/server/menu-photos/types"

// A decision re-reads the item's cards for the view. Its first page holds 24;
// the decided photo's own card may sit on a later one, so the server reads on
// until it finds it (or the pages end) and says whether the client can trust
// its absence.

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ITEM = id(0xc1)
const ASSET = id(0xa1)

function ctx(conflict = false) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "set_menu_item_primary_photo")
      return conflict
        ? { data: null, error: { code: "40001", message: "stale revision" } }
        : { data: [{ item_revision: 5, replayed: false }], error: null }
    if (name === "manager_menu_photo_item")
      return {
        data: [
          {
            covered: true,
            preferred_asset_id: ASSET,
            preferred_photo_id: id(0xd1),
            preferred_is_fallback: false,
          },
        ],
        error: null,
      }
    throw new Error(`unexpected rpc ${name}`)
  })
  return {
    actor: { db: { rpc } },
    venueId: id(0xe1),
    role: "manager",
  } as unknown as ManagerPhotoCtx
}

const input = {
  requestId: id(0xf9),
  action: "set_preferred",
  assetId: ASSET,
  itemId: ITEM,
  photoId: id(0xd1),
  expectedRevision: 4,
}

const cardOf = (n: number, over: Partial<QueueCard> = {}) =>
  ({
    key: id(0x1000 + n),
    asset: { assetId: id(0x2000 + n) },
    item: { itemId: ITEM, covered: true },
    ...over,
  }) as unknown as QueueCard
const pageOf = (
  from: number,
  cursor: string | null,
  extra: QueueCard[] = []
) => ({
  ok: true,
  items: [...Array.from({ length: 24 }, (_, n) => cardOf(from + n)), ...extra],
  nextCursor: cursor,
})
const decidedCard = cardOf(99, {
  asset: { assetId: ASSET } as QueueCard["asset"],
})

async function outcomeOf() {
  const result = await decideMenuPhoto(ctx(), input, { status: "accepted" })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("not ok")
  return result.outcome
}

beforeEach(() => read.listReviewQueue.mockReset())

describe("decideMenuPhoto: the decided photo's row past the first page", () => {
  it("one complete page: no further reads; absence is known", async () => {
    read.listReviewQueue.mockResolvedValueOnce({
      ok: true,
      items: [cardOf(0)],
      nextCursor: null,
    })
    const outcome = await outcomeOf()
    expect(read.listReviewQueue).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({
      status: "accepted",
      cardsComplete: true,
      decidedKnown: true,
    })
  })

  it("on the first page: found, no further reads", async () => {
    read.listReviewQueue.mockResolvedValueOnce(pageOf(0, "c1", [decidedCard]))
    const outcome = await outcomeOf()
    expect(read.listReviewQueue).toHaveBeenCalledTimes(1)
    expect(outcome.cardsComplete).toBe(false)
    expect(outcome.decidedKnown).toBe(true)
  })

  it("on a later page: its card comes back with the first page", async () => {
    read.listReviewQueue
      .mockResolvedValueOnce(pageOf(0, "c1"))
      .mockResolvedValueOnce(pageOf(24, "c2"))
      .mockResolvedValueOnce(pageOf(48, "c3", [decidedCard]))
    const outcome = await outcomeOf()
    expect(read.listReviewQueue).toHaveBeenCalledTimes(3)
    expect(read.listReviewQueue.mock.calls[1][1]).toMatchObject({
      status: "accepted",
      itemId: ITEM,
      cursor: "c1",
    })
    expect(read.listReviewQueue.mock.calls[2][1]).toMatchObject({
      cursor: "c2",
    })
    // The first page, then only the decided photo's card from later pages.
    expect(outcome.cards).toHaveLength(25)
    expect(outcome.cards[24]).toBe(decidedCard)
    expect(outcome.cardsComplete).toBe(false)
    expect(outcome.decidedKnown).toBe(true)
  })

  it("every page read without it: it left the view (known)", async () => {
    read.listReviewQueue
      .mockResolvedValueOnce(pageOf(0, "c1"))
      .mockResolvedValueOnce(pageOf(24, null))
    const outcome = await outcomeOf()
    expect(outcome.cards).toHaveLength(24)
    expect(outcome.decidedKnown).toBe(true)
  })

  it("a later page fails: unknown, not gone", async () => {
    read.listReviewQueue
      .mockResolvedValueOnce(pageOf(0, "c1"))
      .mockResolvedValueOnce({ ok: false, code: "unavailable", message: "x" })
    const outcome = await outcomeOf()
    expect(outcome.cards).toHaveLength(24)
    expect(outcome.decidedKnown).toBe(false)
  })

  it("stops after a bounded number of pages: unknown", async () => {
    let n = 0
    read.listReviewQueue.mockImplementation(async () =>
      pageOf(24 * n++, `c${n}`)
    )
    const outcome = await outcomeOf()
    expect(read.listReviewQueue).toHaveBeenCalledTimes(1 + DECIDED_SCAN_PAGES)
    expect(outcome.decidedKnown).toBe(false)
  })

  it("the first read fails: nothing back, unknown", async () => {
    read.listReviewQueue.mockResolvedValueOnce({
      ok: false,
      code: "unavailable",
      message: "x",
    })
    const outcome = await outcomeOf()
    expect(outcome.cards).toEqual([])
    expect(outcome.cardsComplete).toBe(false)
    expect(outcome.decidedKnown).toBe(false)
  })

  it("stale and unlabelled views: only the asset's own cards, found on any page", async () => {
    const stale = cardOf(98, {
      asset: { assetId: ASSET } as QueueCard["asset"],
      item: null,
    })
    const other = (n: number) => cardOf(n, { item: null })
    read.listReviewQueue
      .mockResolvedValueOnce({
        ok: true,
        items: Array.from({ length: 24 }, (_, n) => other(n)),
        nextCursor: "c1",
      })
      .mockResolvedValueOnce({ ok: true, items: [stale], nextCursor: null })
    // A conflict: nothing was decided, so the card may still be in the view
    // and its row is searched for on later pages. (A decision on these views
    // always settles the card, so it needs no search.)
    const result = await decideMenuPhoto(
      ctx(true),
      { ...input, action: "set_preferred" },
      { status: "stale_label" }
    )
    if (result.ok) throw new Error("expected a conflict")
    expect(result.current).toEqual([stale])
    expect(result.currentDecidedKnown).toBe(true)
  })

  it("another variant's card of the same photo on page 1 is not the decided card", async () => {
    // One photo, two variants of the item: V1's card on page 1, V2's (the
    // decided one) on page 2.
    const V1 = id(0xb1)
    const V2 = id(0xb2)
    const variantCard = (n: number, variantId: string) =>
      cardOf(n, {
        asset: { assetId: ASSET } as QueueCard["asset"],
        item: { itemId: ITEM, variantId, covered: true } as QueueCard["item"],
      })
    const v1 = variantCard(90, V1)
    const v2 = variantCard(91, V2)
    read.listReviewQueue
      .mockResolvedValueOnce(pageOf(0, "c1", [v1]))
      .mockResolvedValueOnce(pageOf(25, null, [v2]))
    const result = await decideMenuPhoto(
      ctx(),
      { ...input, variantId: V2 },
      { status: "accepted" }
    )
    if (!result.ok) throw new Error("not ok")
    expect(read.listReviewQueue).toHaveBeenCalledTimes(2)
    expect(result.outcome.cards).toContain(v2)
    expect(result.outcome.decidedKnown).toBe(true)
  })

  it("a revision conflict reads past the page too", async () => {
    read.listReviewQueue
      .mockResolvedValueOnce(pageOf(0, "c1"))
      .mockResolvedValueOnce(pageOf(24, null, [decidedCard]))
    const result = await decideMenuPhoto(ctx(true), input, {
      status: "accepted",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("revision_conflict")
    expect(result.current).toHaveLength(25)
    expect(result.currentComplete).toBe(false)
    expect(result.currentDecidedKnown).toBe(true)
  })
})

describe("decideMenuPhoto: no search when the photo has left the view", () => {
  it("reads only the first page when the action takes the card out of the view", async () => {
    // Accepting (set as menu photo) on the "another photo asked for" view: the
    // photo is accepted now, so it is no longer in that view.
    read.listReviewQueue.mockResolvedValueOnce(pageOf(0, "c1"))
    const result = await decideMenuPhoto(ctx(), input, {
      status: "needs_another_photo",
    })
    expect(result.ok).toBe(true)
    expect(read.listReviewQueue).toHaveBeenCalledTimes(1)
  })

  it("still searches on a conflict, where nothing was decided", async () => {
    read.listReviewQueue
      .mockResolvedValueOnce(pageOf(0, "c1"))
      .mockResolvedValueOnce(pageOf(24, null, [decidedCard]))
    const result = await decideMenuPhoto(ctx(true), input, {
      status: "needs_another_photo",
    })
    expect(result.ok).toBe(false)
    expect(read.listReviewQueue).toHaveBeenCalledTimes(2)
  })
})
