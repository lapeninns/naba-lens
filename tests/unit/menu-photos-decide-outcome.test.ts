import { beforeEach, describe, expect, it, vi } from "vitest"

const read = vi.hoisted(() => ({ listReviewQueue: vi.fn() }))
vi.mock("@/lib/server/menu-photos/read", () => read)

import type { ManagerPhotoCtx } from "@/lib/server/menu-photos/context"
import { decideMenuPhoto } from "@/lib/server/menu-photos/decide"

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ITEM = id(0xc1)
const PHOTO = id(0xd1)
const FALLBACK = id(0xd2)

function ctxWith(itemRead: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "set_menu_item_primary_photo")
      return { data: [{ item_revision: 5, replayed: false }], error: null }
    if (name === "manager_menu_photo_item") return itemRead
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
  assetId: id(0xa1),
  itemId: ITEM,
  photoId: PHOTO,
  expectedRevision: 4,
}

beforeEach(() => {
  read.listReviewQueue.mockResolvedValue({
    ok: true,
    items: [],
    nextCursor: null,
  })
})

describe("decideMenuPhoto: the item's menu photo in the outcome", () => {
  it("carries the effective menu photo and whether it is the fallback", async () => {
    const ctx = ctxWith({
      data: [
        {
          covered: true,
          preferred_asset_id: id(0xa2),
          preferred_photo_id: FALLBACK,
          preferred_is_fallback: true,
        },
      ],
      error: null,
    })
    const result = await decideMenuPhoto(ctx, input, { status: "accepted" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome).toMatchObject({
      itemCovered: true,
      preferredAssetId: id(0xa2),
      preferredPhotoId: FALLBACK,
      preferredIsFallback: true,
    })
  })

  it("a failed item read leaves the menu photo unknown, not none", async () => {
    const ctx = ctxWith({ data: null, error: { message: "boom" } })
    read.listReviewQueue.mockResolvedValue({
      ok: true,
      items: [
        {
          key: "k",
          asset: { assetId: id(0xa1) },
          item: { itemId: ITEM, covered: true },
        },
      ],
      nextCursor: null,
    })
    const result = await decideMenuPhoto(ctx, input, { status: "accepted" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect("preferredPhotoId" in result.outcome).toBe(false)
    // Coverage still comes from the fresh cards.
    expect(result.outcome.itemCovered).toBe(true)
  })
})
