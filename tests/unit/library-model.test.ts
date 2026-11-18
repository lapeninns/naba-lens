// S2-LIBRARY (spec §8 A4): the Library's A4 filter params, the asset detail
// parser and the Select primary rule. Database rules are in
// tests/security/library.test.ts.
import { describe, expect, it } from "vitest"

import {
  canSelectPrimary,
  extraFiltersToParams,
  NO_EXTRA_FILTERS,
  orientationOf,
  parseAssetDetail,
  parseCollections,
  parseExtraFilters,
  parseFilterLists,
  parseTags,
} from "@/lib/library/model"
import {
  ADMIN_LIBRARY_PARAMS,
  parseAdminLibraryFilters,
  parseLibraryFilters,
} from "@/lib/server/media/library"

const A = "00000000-0000-4000-8000-0000000000a1"
const V = "00000000-0000-4000-8000-0000000000b1"
const U = "00000000-0000-4000-8000-0000000000c1"
const S = "00000000-0000-4000-8000-0000000000d1"
const P = "00000000-0000-4000-8000-0000000000e1"

describe("A4 filter params", () => {
  it("parses every filter and ignores invalid values", () => {
    expect(
      parseExtraFilters({
        use: "withdrawn",
        review: "public",
        shot_from: "2026-06-30",
        shot_to: "2026-06-01",
        orientation: "portrait",
        request: S,
        collection: [S, "x"],
        destination: "not-a-uuid",
        tag: S,
      })
    ).toEqual({
      withdrawn: "withdrawn",
      review: "public",
      // Swapped into order.
      capturedFrom: "2026-06-01",
      capturedTo: "2026-06-30",
      orientation: "portrait",
      requestId: S,
      collectionId: S,
      destinationId: null,
      tagId: S,
    })
    expect(
      parseExtraFilters({
        use: "deleted",
        review: "approved",
        shot_from: "2026-02-30",
        orientation: "round",
      })
    ).toEqual(NO_EXTRA_FILTERS)
  })

  it("round-trips through URL params, leaving out what is off", () => {
    const f = parseExtraFilters({ use: "all", tag: S, shot_from: "2026-01-02" })
    const params = extraFiltersToParams(f)
    expect(params).toEqual({ use: "all", shot_from: "2026-01-02", tag: S })
    expect(parseExtraFilters(params)).toEqual(f)
    expect(extraFiltersToParams(NO_EXTRA_FILTERS)).toEqual({})
  })

  it("adds the A4 params to the admin library without changing the old parser", () => {
    expect(ADMIN_LIBRARY_PARAMS).toEqual(
      expect.arrayContaining(["venue", "q", "use", "review", "tag"])
    )
    const both = parseAdminLibraryFilters({ venue: V, review: "reference" })
    expect(both.venueId).toBe(V)
    expect(both.review).toBe("reference")
    expect(both.withdrawn).toBe("active")
    // The v0.3 parser keeps its exact shape.
    expect(parseLibraryFilters({ venue: V })).not.toHaveProperty("review")
  })
})

describe("orientation", () => {
  it("reads width and height", () => {
    expect(orientationOf(1600, 1200)).toBe("landscape")
    expect(orientationOf(900, 1600)).toBe("portrait")
    expect(orientationOf(1000, 1000)).toBe("square")
    expect(orientationOf(null, 1000)).toBeNull()
  })
})

const raw = {
  asset: {
    id: A,
    venueId: V,
    venueName: "The Bell",
    uploaderId: U,
    uploaderName: "Sam",
    uploaderActive: false,
    mediaType: "image",
    originalFilename: "IMG_1.jpg",
    sizeBytes: 2048,
    width: 1600,
    height: 1200,
    uploadState: "ready",
    createdAt: "2026-11-01T10:00:00+00:00",
    capturedAt: null,
    capturedAtSource: "unknown",
    contentSha256: "ab".repeat(32),
    duplicateOfAssetId: null,
    deletedAt: null,
    timezone: "Europe/London",
  },
  review: "public",
  useState: "not_granted",
  exportEligible: true,
  withdrawal: null,
  renditions: [
    {
      kind: "preview",
      objectKey: "v/a/preview.webp",
      mimeType: "image/webp",
      width: 1600,
      height: 1200,
      pipelineVersion: "2",
      createdAt: "2026-11-01T10:00:01+00:00",
      approval: "public",
    },
  ],
  labels: { note: null, contentTypes: [], items: [], places: [] },
  labelHistory: [],
  decisions: [
    {
      kind: "area",
      slotName: "Garden",
      action: "accepted",
      to: "public",
      at: "2026-11-02T10:00:00+00:00",
      byName: "Manager",
    },
  ],
  slots: [
    {
      kind: "dish",
      slotId: S,
      name: "Momo",
      state: "public",
      isPrimary: false,
      photoId: P,
      itemRevision: 4,
    },
    { kind: "area", slotId: S, name: "Garden", state: "reference" },
    { kind: "weird", slotId: S },
  ],
  evidence: [],
  exports: { publication: null, packages: [{ packageId: P, mode: "public" }] },
  tags: [{ id: S, name: "Christmas", active: true }],
  collections: [],
  duplicates: [{ assetId: P, relation: "something" }],
  history: [],
  removalRequests: [],
  corrections: [],
}

describe("parseAssetDetail", () => {
  it("parses the database's detail and drops malformed rows", () => {
    const d = parseAssetDetail(raw)!
    expect(d.asset.venueName).toBe("The Bell")
    expect(d.asset.uploaderActive).toBe(false)
    expect(d.review).toBe("public")
    expect(d.renditions[0]?.approval).toBe("public")
    expect(d.slots.map((s) => s.kind)).toEqual(["dish", "area"])
    expect(d.exports?.packages).toHaveLength(1)
    expect(d.duplicates[0]?.relation).toBe("same_file")
    expect(d.decisions[0]?.selfReview).toBe(false)
  })

  it("refuses a detail without an asset", () => {
    expect(parseAssetDetail(null)).toBeNull()
    expect(parseAssetDetail({ asset: { id: "x" } })).toBeNull()
  })
})

describe("Select primary", () => {
  const d = parseAssetDetail(raw)!
  it("is offered on a public slot that is not already primary", () => {
    expect(canSelectPrimary(d, d.slots[0]!)).toBe(true)
    // Reference level: never a primary.
    expect(canSelectPrimary(d, d.slots[1]!)).toBe(false)
    expect(canSelectPrimary(d, { ...d.slots[0]!, isPrimary: true })).toBe(false)
  })

  it("is not offered for a withdrawn asset or a dish without its revision", () => {
    expect(
      canSelectPrimary(
        { ...d, withdrawal: { withdrawnAt: "x", reason: "r", byName: null } },
        d.slots[0]!
      )
    ).toBe(false)
    expect(canSelectPrimary(d, { ...d.slots[0]!, itemRevision: null })).toBe(
      false
    )
  })
})

describe("lists", () => {
  it("parses tags, collections and filter lists", () => {
    expect(
      parseTags([{ id: S, name: "Garden", active: true, assetCount: 3 }, {}])
    ).toEqual([
      { id: S, name: "Garden", active: true, revision: 1, assetCount: 3 },
    ])
    expect(
      parseCollections([
        {
          id: S,
          name: "Winter",
          assetCount: 2,
          venues: [{ venueId: V, venueName: "The Bell", count: 2 }],
        },
      ])?.[0]?.venues
    ).toEqual([{ venueId: V, venueName: "The Bell", count: 2 }])
    expect(
      parseFilterLists({
        requests: [{ id: S, name: "Roast", venueName: "The Bell" }],
        destinations: "x",
      })
    ).toEqual({
      requests: [{ id: S, name: "Roast", venueName: "The Bell" }],
      destinations: [],
    })
    expect(parseTags("x")).toBeNull()
  })
})
