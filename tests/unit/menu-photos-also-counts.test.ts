import { describe, expect, it, vi } from "vitest"

import type { ManagerPhotoCtx } from "@/lib/server/menu-photos/context"
import { listReviewQueue } from "@/lib/server/menu-photos/read"

// ORP-3b: "Also counts for" is read per label tuple. Two variants of one dish
// on the same photo can differ: only the variant the uploader labelled earns
// the month (menu_photo_also_counts returns the variant; the card is matched
// on asset, item and variant).

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ASSET = id(0xa1)
const KORMA = id(0xc1)
const CHICKEN = id(0xd1)
const LAMB = id(0xd2)
const SECTION = id(0xb1)

function row(n: number, variantId: string | null) {
  return {
    sort_key: id(0x100 + n),
    kind: "labelled",
    asset_id: ASSET,
    has_thumbnail: false,
    has_preview: false,
    created_at: "2026-11-07T10:00:00.000Z",
    uploader_id: id(0x300),
    uploader_name: "TEST Sam",
    contributor_status: "here",
    can_follow_up: true,
    is_self: false,
    staff_label: [],
    item_id: KORMA,
    item_name: "Korma",
    section_id: SECTION,
    section_name: "Mains",
    variant_id: variantId,
    variant_name: variantId === CHICKEN ? "Chicken" : variantId && "Lamb",
    is_primary: false,
    is_effective_primary: false,
    item_covered: false,
    group_count: 0,
  }
}

function ctx(queue: unknown[], also: unknown[]) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "manager_menu_photo_queue") return { data: queue, error: null }
    if (name === "menu_photo_also_counts") return { data: also, error: null }
    throw new Error(`unexpected rpc ${name}`)
  })
  return {
    actor: { db: { rpc } },
    venueId: id(0xe1),
    role: "manager",
  } as unknown as ManagerPhotoCtx
}

describe("review queue: also counts for", () => {
  it("matches each card's own variant", async () => {
    const result = await listReviewQueue(
      ctx(
        [row(1, CHICKEN), row(2, LAMB), row(3, null)],
        [
          {
            asset_id: ASSET,
            item_id: KORMA,
            variant_id: CHICKEN,
            task_titles: ["Mains"],
            credit_month: "2026-11-01",
          },
          {
            asset_id: ASSET,
            item_id: KORMA,
            variant_id: LAMB,
            task_titles: ["Mains"],
            credit_month: null,
          },
        ]
      ),
      {}
    )
    if (!result.ok) throw new Error("failed")
    expect(
      result.items.map((card) =>
        card.kind === "labelled" ? (card.alsoCounts ?? null) : null
      )
    ).toEqual([
      { tasks: ["Mains"], month: "2026-11-01" },
      { tasks: ["Mains"], month: null },
      // No tuple for the dish without a variant: no line.
      null,
    ])
  })
})
