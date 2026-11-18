// S3-R1 app logic: the batch carries the disposition the screen saw (V16),
// a single-reviewer manager may decide on their own photo (K6), the media
// type filter (K11), the unlabelled reasons (K1) and the admin spot-check
// list (K6).
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  availableActions,
  ownPhotoBlocked,
} from "@/components/nabalens/manager/review/card-model"
import {
  isNarrowed,
  narrowingOf,
  reviewHref,
  type ReviewView,
} from "@/components/nabalens/manager/review/links"
import { batchable, batchItemOf } from "@/lib/review/inbox"
import {
  parseReviewSettings,
  selfDecisionWords,
} from "@/lib/review/single-reviewer"
import { parseLabelHelpQueue } from "@/lib/server/label-help"
import type { QueueCard } from "@/lib/server/menu-photos/types"

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
const ITEM = "00000000-0000-4000-8000-0000000000a1"

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
      sectionId: B,
      sectionName: "Mains",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [
      {
        itemId: ITEM,
        variantId: null,
        itemName: "Soup",
        variantName: null,
        onMenu: true,
      },
    ],
    state: null,
    isPrimary: false,
    isEffectivePrimary: false,
    basis: "staff_label",
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

describe("V16: a batch is made against the disposition the screen saw", () => {
  it("carries the card's latest disposition, or null before any", () => {
    expect(batchItemOf(card({ dispositionId: 42 })).dispositionId).toBe(42)
    expect(batchItemOf(card()).dispositionId).toBeNull()
  })
})

describe("K6: the manager's own photo at a single-reviewer venue", () => {
  it("stays blocked by default", () => {
    const own = card({ isSelf: true })
    expect(ownPhotoBlocked(own)).toBe(true)
    expect(batchable(own, "public")).toBe(false)
    expect(availableActions({ ...own, settled: false })).toEqual([])
  })

  it("is decided like any other photo when the venue allows it", () => {
    const own = card({ isSelf: true, selfReviewAllowed: true })
    expect(ownPhotoBlocked(own)).toBe(false)
    expect(batchable(own, "public")).toBe(true)
    expect(batchable(own, "not_used")).toBe(true)
    expect(availableActions({ ...own, settled: false })).toContain("accept")
  })
})

describe("K11: photos or videos", () => {
  const view: ReviewView = {
    status: "pending",
    sectionId: null,
    contributorId: null,
    itemId: null,
  }

  it("narrows the read and keeps the filter in the URL", () => {
    expect(narrowingOf({ ...view, media: "video" })).toEqual({
      mediaType: "video",
    })
    expect(narrowingOf({ ...view, media: "photo" })).toEqual({
      mediaType: "image",
    })
    expect(isNarrowed({ ...view, media: "photo" })).toBe(true)
    expect(isNarrowed(view)).toBe(false)
    expect(reviewHref({ kind: "manager" }, { ...view, media: "video" })).toBe(
      "/manager/review?media=video&view=list"
    )
  })
})

describe("K1: why a photo needs a label", () => {
  it("reads each reason of the one rule from label_help_queue", () => {
    const queue = parseLabelHelpQueue({
      venueId: "v1",
      items: ["not_sure", "no_dish", "unmatched", "other"].map((reason, i) => ({
        assetId: `a${i}`,
        uploaderId: "u",
        createdAt: "t",
        reason,
      })),
    })
    expect(queue?.items.map((i) => i.reason)).toEqual([
      "not_sure",
      "no_dish",
      "unmatched",
      "unmatched",
    ])
  })
})

describe("K6: the admin's review settings", () => {
  it("reads the setting and the decisions to spot check", () => {
    const settings = parseReviewSettings({
      venueId: "v1",
      singleReviewer: true,
      revision: 4,
      selfDecisions: [
        {
          source: "dish",
          action: "accepted",
          level: "reference",
          subject: "Pie",
          assetId: A,
          by: "Sam",
          at: "2026-11-18T10:00:00Z",
        },
        {
          source: "place",
          action: "accepted",
          level: "public",
          subject: "Bar",
          assetId: B,
          by: "Sam",
          at: "2026-11-18T09:00:00Z",
        },
        { source: "nope", action: "accepted", assetId: A, at: "t" },
        null,
      ],
    })
    expect(settings).toMatchObject({ singleReviewer: true, revision: 4 })
    expect(settings!.selfDecisions.map(selfDecisionWords)).toEqual([
      "Dish · Kept as reference · Pie",
      "Place · Public use · Bar",
    ])
  })

  it("refuses another shape", () => {
    expect(parseReviewSettings(null)).toBeNull()
    expect(
      parseReviewSettings({ venueId: "v1", singleReviewer: "yes" })
    ).toBeNull()
  })
})
