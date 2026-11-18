// S2-REVIEW: the review inbox's pure rules (lib/review/inbox.ts) and words
// (components/nabalens/manager/review/inbox-copy.ts).
import { describe, expect, it } from "vitest"

import {
  historyWords,
  takenWords,
} from "@/components/nabalens/manager/review/inbox-copy"
import {
  batchable,
  batchItemOf,
  batchSummary,
  duplicateTargets,
  hasLiveDecision,
  isSetAside,
  parsePhotoDetail,
  RevisionChain,
} from "@/lib/review/inbox"
import type { QueueCard } from "@/lib/server/menu-photos/types"

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
const C = "00000000-0000-4000-8000-000000000003"
const ITEM = "00000000-0000-4000-8000-0000000000a1"
const VENUE = "00000000-0000-4000-8000-0000000000f1"

function card(over: Partial<QueueCard> = {}): QueueCard {
  return {
    key: A,
    kind: "labelled",
    labelId: A,
    photoId: null,
    asset: {
      assetId: A,
      thumbnailUrl: null,
      previewUrl: null,
      width: 2000,
      height: 1500,
    },
    uploadedAt: "2026-11-10T10:00:00Z",
    labelledAt: null,
    contributor: { id: B, name: "Priya", status: "here", canFollowUp: true },
    isSelf: false,
    item: {
      itemId: ITEM,
      name: "Soup",
      sectionId: C,
      sectionName: "Mains",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [],
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

const RAW = {
  assetId: A,
  venueId: VENUE,
  mediaType: "image",
  width: 1200,
  height: 900,
  uploadedAt: "2026-11-10T10:00:00Z",
  capturedAt: null,
  capturedAtSource: "unknown",
  contributor: { id: B, name: "Priya", active: true },
  isSelf: false,
  selfBlocked: false,
  note: "  From the pass ",
  contentTypes: ["dish"],
  needsLabel: false,
  duplicateOfAssetId: null,
  possibleDuplicates: [{ assetId: C, accepted: true }],
  group: [],
  disposition: null,
  dishes: [
    {
      itemId: ITEM,
      variantId: null,
      itemName: "Soup",
      onMenu: true,
      staffLabel: true,
      waiting: true,
      state: null,
      itemRevision: 4,
      presentationRevision: 2,
      presentationNote: "Now in a bowl",
      publicPhotos: [{ assetId: B, isPrimary: true }],
    },
  ],
  places: [
    {
      labelId: C,
      subjectId: B,
      name: "Bar",
      state: "accepted",
      level: "reference",
      decisionId: 7,
      isPrimary: false,
      publicPhotos: [],
    },
  ],
  amenities: [{ checkId: C, question: "Parking?", state: "weird" }],
  history: [
    {
      source: "place",
      action: "accepted",
      level: "reference",
      at: "2026-11-11T00:00:00Z",
      by: "Sam",
    },
    { action: "x" },
  ],
}

describe("parsePhotoDetail", () => {
  it("reads the database shape", () => {
    const d = parsePhotoDetail(RAW)!
    expect(d.note).toBe("From the pass")
    expect(d.capturedAtSource).toBe("unknown")
    expect(d.dishes[0]).toMatchObject({
      itemRevision: 4,
      presentationRevision: 2,
      presentationNote: "Now in a bowl",
      waiting: true,
      level: null,
    })
    expect(d.places[0]).toMatchObject({ level: "reference", decisionId: 7 })
    // Unknown states read as waiting; malformed history rows are dropped.
    expect(d.amenities[0]!.state).toBe("pending")
    expect(d.history).toHaveLength(1)
  })

  it("refuses another shape", () => {
    expect(parsePhotoDetail(null)).toBeNull()
    expect(parsePhotoDetail({ assetId: A })).toBeNull()
    expect(parsePhotoDetail({ ...RAW, contributor: null })).toBeNull()
  })

  it("knows a photo set aside, a live decision and the duplicate targets", () => {
    const d = parsePhotoDetail(RAW)!
    expect(isSetAside(d)).toBe(false)
    expect(
      isSetAside({
        disposition: {
          id: 1,
          action: "not_used",
          reasonCode: null,
          reason: "x",
          duplicateOfAssetId: null,
          by: null,
          at: "2026-11-11T00:00:00Z",
        },
      })
    ).toBe(true)
    // The place is accepted: withdraw first.
    expect(hasLiveDecision(d)).toBe(true)
    expect(hasLiveDecision({ ...d, places: [] })).toBe(false)
    // An accepted same-file photo, then the dish's public photo.
    expect(duplicateTargets(d).map((t) => t.assetId)).toEqual([C, B])
  })
})

describe("batch decisions", () => {
  it("offers only waiting photos the caller may decide", () => {
    expect(batchable(card(), "public")).toBe(true)
    expect(batchable(card(), "not_used")).toBe(true)
    expect(batchable(card({ isSelf: true }), "public")).toBe(false)
    expect(batchable(card({ state: "accepted" }), "reference")).toBe(false)
    const needsLabel = card({ kind: "unlabelled", item: null })
    expect(batchable(needsLabel, "public")).toBe(false)
    expect(batchable(needsLabel, "not_used")).toBe(true)
    expect(
      batchable(card({ kind: "decided", state: "accepted" }), "not_used")
    ).toBe(false)
  })

  it("decides photos of one dish in turn, but never past someone else's change", () => {
    const chain = new RevisionChain()
    const first = batchItemOf(card())
    const second = batchItemOf(
      card({ key: B, asset: { ...card().asset, assetId: B } })
    )
    expect(chain.expected(first)).toBe(3)
    chain.record(first, 4)
    expect(chain.expected(second)).toBe(4)
    chain.record(second, 5)
    // A card read at another revision keeps its own: the database decides.
    const stale = batchItemOf(card({ key: C, itemRevision: 2 }))
    expect(chain.expected(stale)).toBe(2)
    expect(chain.expected(batchItemOf(card({ key: C })))).toBe(5)
  })

  it("sums the outcomes", () => {
    expect(
      batchSummary([
        { key: A, assetId: A, ok: true },
        { key: B, assetId: B, ok: false, error: "x", conflict: true },
      ])
    ).toEqual({ done: 1, failed: 1 })
  })
})

describe("inbox words", () => {
  it("says when a photo was taken, or that it is unknown", () => {
    expect(takenWords(null, "unknown")).toBe("Taken: unknown")
    expect(takenWords("2026-11-12T10:00:00Z", "metadata")).toBe(
      "Taken 12 Nov 2026"
    )
    expect(takenWords("2026-11-12T10:00:00Z", "supplied")).toBe(
      "Taken 12 Nov 2026 (corrected)"
    )
  })

  it("names the level of an acceptance in the history", () => {
    expect(historyWords("accepted", "reference")).toBe(
      "Accepted: kept as reference"
    )
    expect(historyWords("level_set", "public")).toBe(
      "Level changed: approved for public use"
    )
    expect(historyWords("duplicate", null)).toBe("Marked duplicate")
    expect(historyWords("something_new", null)).toBe("something new")
  })
})
