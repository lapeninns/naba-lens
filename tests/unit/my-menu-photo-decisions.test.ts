import { describe, expect, it, vi } from "vitest"

import { listMyMenuPhotoDecisions } from "@/lib/server/coverage/menu-items"
import type { MediaActor } from "@/lib/server/media/types"
import { isMenuUse } from "@/lib/staff/my-uploads"

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
  venueId: string | null = VENUE,
  catalogue: Result = { data: null, error: null }
) {
  return {
    profile: { id: ME, active: true, role: "staff", venueId },
    db: {
      from: vi.fn((table: string) =>
        query(table, tables[table] ?? { data: [], error: null }, calls)
      ),
      rpc: vi.fn(async (name: string, args: unknown) => {
        calls.push(["rpc", name, JSON.stringify(args)])
        return catalogue
      }),
    },
  } as unknown as MediaActor
}

type CatalogueItem = { itemId: string; variants?: string[] }

/** menu_label_catalogue's answer: the venue's current offerings by section. */
function catalogue(
  sections: { kind: string; slug: string; items: CatalogueItem[] }[]
): Result {
  return {
    error: null,
    data: {
      venueId: VENUE,
      venueName: "The Bell",
      status: "active",
      versionId: "version-1",
      versionTitle: "Autumn",
      activatedAt: null,
      sections: sections.map((section) => ({
        id: `section-${section.slug}`,
        slug: section.slug,
        name: section.slug,
        kind: section.kind,
        items: section.items.map((item) => ({
          itemId: item.itemId,
          name: item.itemId,
          description: null,
          aliases: [],
          variants: (item.variants ?? []).map((variantId) => ({
            variantId,
            name: variantId,
          })),
        })),
      })),
    },
  }
}

const PHOTOS = [
  state("p1", "soup", null),
  state("p2", "momo", "veg"),
  state("p3", "momo", "chicken"),
  state("p4", "gone", null),
  state("p5", "pie", null, "accepted"),
]

describe("Me's better-photo requests and the current menu (B9)", () => {
  it("flags only requests whose dish and variant the current venue's food or drinks offerings include", async () => {
    const calls: string[][] = []
    const result = await listMyMenuPhotoDecisions(
      actor(
        { menu_item_photos: { data: PHOTOS, error: null } },
        calls,
        VENUE,
        catalogue([
          {
            kind: "food",
            slug: "mains",
            items: [{ itemId: "soup" }, { itemId: "momo", variants: ["veg"] }],
          },
          // Not food or drinks: never a retake target.
          { kind: "other", slug: "extras", items: [{ itemId: "gone" }] },
        ])
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
    // The caller's current venue's catalogue (menu entries and running
    // specials, read under the caller's own permissions).
    expect(calls).toContainEqual([
      "rpc",
      "menu_label_catalogue",
      JSON.stringify({ p_venue_id: VENUE }),
    ])
  })

  it("can retake a running special, which has no variants", async () => {
    const result = await listMyMenuPhotoDecisions(
      actor(
        {
          menu_item_photos: {
            data: [state("s1", "lassi", null), state("s2", "lassi", "large")],
            error: null,
          },
        },
        [],
        VENUE,
        catalogue([
          {
            kind: "drinks",
            slug: "drinks-specials",
            items: [{ itemId: "lassi" }],
          },
        ])
      )
    )
    expect(result.ok && result.states.map((s) => s.canRetake)).toEqual([
      true,
      false,
    ])
  })

  it("can't retake anything without a venue or a current menu", async () => {
    for (const [venueId, answer] of [
      [
        null,
        catalogue([
          { kind: "food", slug: "mains", items: [{ itemId: "soup" }] },
        ]),
      ],
      [
        VENUE,
        {
          data: { venueId: VENUE, venueName: "The Bell", status: "none" },
          error: null,
        },
      ],
    ] as const) {
      const result = await listMyMenuPhotoDecisions(
        actor(
          { menu_item_photos: { data: PHOTOS.slice(0, 1), error: null } },
          [],
          venueId,
          answer
        )
      )
      expect(result.ok && result.states[0].canRetake).toBe(false)
    }
  })

  it("leaves the flag unknown when the menu can't be read", async () => {
    const result = await listMyMenuPhotoDecisions(
      actor(
        { menu_item_photos: { data: PHOTOS.slice(0, 1), error: null } },
        [],
        VENUE,
        { data: null, error: { message: "down" } }
      )
    )
    expect(result.ok && result.states[0].canRetake).toBeUndefined()
  })
})

describe("Me's accepted for menu use (X9)", () => {
  it("reads each accepted decision's review level, and only a public one is menu use", async () => {
    const calls: string[][] = []
    const result = await listMyMenuPhotoDecisions(
      actor(
        {
          menu_item_photos: {
            data: [
              {
                ...state("p1", "pie", null, "accepted"),
                review_level: "public",
              },
              {
                ...state("p2", "soup", null, "accepted"),
                review_level: "reference",
              },
            ],
            error: null,
          },
        },
        calls
      )
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls[0]?.[2]).toContain("review_level")
    expect(result.states.map((s) => [s.photoId, s.reviewLevel])).toEqual([
      ["p1", "public"],
      ["p2", "reference"],
    ])
    expect(result.states.map(isMenuUse)).toEqual([true, false])
  })
})
