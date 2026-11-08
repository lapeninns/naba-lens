import { describe, expect, it, vi } from "vitest"

import { listMyMenuPhotoDecisions } from "@/lib/server/coverage/menu-items"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))

type Result = { data: unknown; error: unknown }

/** A PostgREST query builder that records its filters and answers `result`. */
function query(table: string, result: Result, calls: string[][]) {
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "eq", "in", "is", "order", "limit", "not"])
    builder[method] = (...args: unknown[]) => {
      calls.push([table, method, JSON.stringify(args)])
      return builder
    }
  builder.maybeSingle = async () => result
  builder.then = (resolve: (r: Result) => unknown) => resolve(result)
  return builder
}

const ME = "00000000-0000-4000-8000-0000000000aa"
const VENUE = "00000000-0000-4000-8000-0000000000b1"

function state(
  id: string,
  itemId: string,
  variantId: string | null,
  state = "better_photo_requested"
) {
  return {
    id,
    asset_id: `asset-${id}`,
    item_id: itemId,
    item_name: itemId,
    variant_id: variantId,
    variant_name: variantId,
    state,
    is_primary: false,
    reason: state === "better_photo_requested" ? "Brighter" : null,
  }
}

function actor(
  tables: Record<string, Result>,
  calls: string[][],
  venueId: string | null = VENUE
) {
  return {
    profile: { id: ME, active: true, role: "staff", venueId },
    db: {
      from: vi.fn((table: string) =>
        query(table, tables[table] ?? { data: [], error: null }, calls)
      ),
    },
  } as unknown as MediaActor
}

const PHOTOS = [
  state("p1", "soup", null),
  state("p2", "momo", "veg"),
  state("p3", "momo", "chicken"),
  state("p4", "gone", null),
  state("p5", "pie", null, "accepted"),
]

describe("Me's better-photo requests and the current menu (B9)", () => {
  it("flags only requests whose dish and variant the current venue's active food or drinks menu offers", async () => {
    const calls: string[][] = []
    const result = await listMyMenuPhotoDecisions(
      actor(
        {
          menu_item_photos: { data: PHOTOS, error: null },
          menu_versions: { data: { id: "version-1" }, error: null },
          menu_entries: {
            data: [
              { item_id: "soup", menu_entry_variants: [] },
              { item_id: "momo", menu_entry_variants: [{ variant_id: "veg" }] },
            ],
            error: null,
          },
        },
        calls
      )
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.states.map((s) => [s.photoId, s.state, s.canRetake])).toEqual(
      [
        ["p1", "better_photo_requested", true],
        ["p2", "better_photo_requested", true],
        ["p3", "better_photo_requested", false],
        ["p4", "better_photo_requested", false],
        ["p5", "accepted", undefined],
      ]
    )
    // The caller's current venue, its active version, food or drinks
    // sections only, and items not archived.
    expect(calls).toEqual(
      expect.arrayContaining([
        ["menu_versions", "eq", JSON.stringify(["venue_id", VENUE])],
        ["menu_versions", "eq", JSON.stringify(["status", "active"])],
        ["menu_entries", "eq", JSON.stringify(["version_id", "version-1"])],
        [
          "menu_entries",
          "in",
          JSON.stringify(["item_id", ["soup", "momo", "gone"]]),
        ],
        [
          "menu_entries",
          "in",
          JSON.stringify(["menu_sections.kind", ["food", "drinks"]]),
        ],
        [
          "menu_entries",
          "is",
          JSON.stringify(["menu_items.archived_at", null]),
        ],
      ])
    )
  })

  it("can't retake anything without a venue or an active menu", async () => {
    for (const [venueId, version] of [
      [null, { id: "version-1" }],
      [VENUE, null],
    ] as const) {
      const result = await listMyMenuPhotoDecisions(
        actor(
          {
            menu_item_photos: { data: PHOTOS.slice(0, 1), error: null },
            menu_versions: { data: version, error: null },
          },
          [],
          venueId
        )
      )
      expect(result.ok && result.states[0].canRetake).toBe(false)
    }
  })

  it("leaves the flag unknown when the menu can't be read", async () => {
    const result = await listMyMenuPhotoDecisions(
      actor(
        {
          menu_item_photos: { data: PHOTOS.slice(0, 1), error: null },
          menu_versions: { data: null, error: { message: "down" } },
        },
        []
      )
    )
    expect(result.ok && result.states[0].canRetake).toBeUndefined()
  })
})
