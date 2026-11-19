// FA-4: the managers' Needs label list, read defensively.
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { parseLabelHelpQueue } from "@/lib/server/label-help"

describe("parseLabelHelpQueue", () => {
  it("reads the queue and its items", () => {
    expect(
      parseLabelHelpQueue({
        venueId: "v1",
        unmatchedDays: 7,
        total: 2,
        notSure: 1,
        items: [
          {
            assetId: "a1",
            reason: "not_sure",
            note: "By the window",
            uploaderId: "u1",
            uploaderName: "Sam",
            mediaType: "image",
            createdAt: "2026-11-18T10:00:00Z",
            capturedAt: null,
            requestedAt: "2026-11-18T10:01:00Z",
            hasThumbnail: true,
          },
          {
            assetId: "a2",
            reason: "unmatched",
            note: null,
            uploaderId: "u2",
            uploaderName: "Alex",
            mediaType: "video",
            createdAt: "2026-11-01T10:00:00Z",
            capturedAt: "2026-10-31T19:00:00Z",
            requestedAt: null,
            hasThumbnail: false,
          },
        ],
      })
    ).toEqual({
      venueId: "v1",
      unmatchedDays: 7,
      total: 2,
      notSure: 1,
      items: [
        expect.objectContaining({
          assetId: "a1",
          reason: "not_sure",
          note: "By the window",
          hasThumbnail: true,
        }),
        expect.objectContaining({
          assetId: "a2",
          reason: "unmatched",
          mediaType: "video",
          capturedAt: "2026-10-31T19:00:00Z",
        }),
      ],
    })
  })

  it("drops broken items and fills missing counts", () => {
    const queue = parseLabelHelpQueue({
      venueId: "v1",
      items: [
        { assetId: "a1" },
        null,
        { assetId: "a3", uploaderId: "u", createdAt: "t", reason: "not_sure" },
      ],
    })
    expect(queue?.items.map((i) => i.assetId)).toEqual(["a3"])
    expect(queue).toMatchObject({ total: 1, notSure: 1, unmatchedDays: 7 })
  })

  it("refuses what is not a queue", () => {
    expect(parseLabelHelpQueue(null)).toBeNull()
    expect(parseLabelHelpQueue({ items: [] })).toBeNull()
    expect(parseLabelHelpQueue({ venueId: "v", items: "x" })).toBeNull()
  })
})
