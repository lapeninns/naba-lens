import { describe, expect, it, vi } from "vitest"

import type { ManagerPhotoCtx } from "@/lib/server/menu-photos/context"
import { listReviewQueue } from "@/lib/server/menu-photos/read"

// A staff label of a dish with variants saved without one is named
// "Momo (Not specified)" on the review card. Managers cannot read the menu
// tables, so the read goes through their own item list, once per page and
// only when a label needs it.

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const MOMO = id(0xc1)
const SOUP = id(0xc2)
const CHICKEN = id(0xd1)

const label = (itemId: string, itemName: string, variantId?: string) => ({
  itemId,
  itemName,
  variantId: variantId ?? null,
  variantName: variantId ? "Chicken" : null,
  onMenu: true,
})

function row(n: number, staffLabel: unknown[]) {
  return {
    sort_key: id(0x100 + n),
    kind: "labelled",
    asset_id: id(0x200 + n),
    has_thumbnail: false,
    has_preview: false,
    created_at: "2026-11-07T10:00:00.000Z",
    uploader_id: id(0x300),
    uploader_name: "TEST Sam",
    contributor_status: "here",
    can_follow_up: true,
    is_self: false,
    staff_label: staffLabel,
    is_primary: false,
    is_effective_primary: false,
    item_covered: false,
    group_count: 0,
  }
}

function ctx(queue: unknown[], items: unknown[] = []) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "manager_menu_photo_queue") return { data: queue, error: null }
    if (name === "manager_menu_photo_items") return { data: items, error: null }
    throw new Error(`unexpected rpc ${name}`)
  })
  return {
    rpc,
    ctx: {
      actor: { db: { rpc } },
      venueId: id(0xe1),
      role: "manager",
    } as unknown as ManagerPhotoCtx,
  }
}

const item = (itemId: string, variants: unknown[]) => ({
  item_id: itemId,
  section_position: 1,
  entry_position: 1,
  variants,
})

describe("review queue: labels of a dish with variants saved without one", () => {
  it("are marked unspecified; others and chosen variants are not", async () => {
    const { ctx: c, rpc } = ctx(
      [
        row(1, [label(MOMO, "Momo")]),
        row(2, [label(SOUP, "Soup")]),
        row(3, [label(MOMO, "Momo", CHICKEN)]),
      ],
      [item(MOMO, [{ variantId: CHICKEN, name: "Chicken" }]), item(SOUP, [])]
    )
    const result = await listReviewQueue(c, {})
    if (!result.ok) throw new Error("failed")
    expect(result.items.map((card) => card.staffLabels[0].unspecified)).toEqual(
      [true, undefined, undefined]
    )
    expect(
      rpc.mock.calls.filter(([name]) => name === "manager_menu_photo_items")
    ).toHaveLength(1)
  })

  it("reads no items when no label could need it", async () => {
    const { ctx: c, rpc } = ctx([row(1, [label(MOMO, "Momo", CHICKEN)])])
    const result = await listReviewQueue(c, {})
    expect(result.ok).toBe(true)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "manager_menu_photo_queue",
    ])
  })
})
