import { describe, expect, it } from "vitest"

import {
  dayLabel,
  groupByDay,
  matchesShow,
  MY_PHOTOS_COPY,
  needsYou,
  photoMark,
  photoSummary,
} from "@/lib/staff/my-photos"
import type { MyUpload, UploadSlot } from "@/lib/staff/my-uploads"

const slot = (over: Partial<UploadSlot> = {}): UploadSlot => ({
  kind: "dish",
  slotId: "s1",
  name: "Garlic Naan",
  outcome: "awaiting_review",
  reason: null,
  decidedAt: null,
  replacesAssetId: null,
  retakeAnswered: false,
  ...over,
})

const photo = (id: string, over: Partial<MyUpload> = {}): MyUpload =>
  ({
    assetId: id,
    venueId: "v1",
    venueName: "The Bell",
    mediaType: "image",
    uploadState: "ready",
    uploadedAt: "2026-11-19T10:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    duplicate: false,
    labelRevision: 1,
    sharedKinds: [],
    slots: [slot()],
    labelHelp: false,
    removalRequested: false,
    removalRequestId: null,
    ...over,
  }) as MyUpload

const NOW = new Date("2026-11-19T15:00:00Z")

describe("needsYou and photoMark (DESIGN.md §5e)", () => {
  it("puts a retake, a missing slot and a failed send in Needs you", () => {
    const retake = photo("r", {
      slots: [slot({ outcome: "retake_requested", reason: "Too dark" })],
    })
    expect(needsYou(retake)).toMatchObject({ kind: "retake" })
    expect(needsYou(photo("n", { slots: [] }))).toEqual({ kind: "no-slot" })
    expect(needsYou(photo("f", { uploadState: "failed" }))).toEqual({
      kind: "failed",
    })
    expect(photoMark(retake)).toBe("needs-you")
  })

  it("leaves 'I'm not sure' and answered retakes to others", () => {
    const helped = photo("h", { slots: [], labelHelp: true })
    expect(needsYou(helped)).toBeNull()
    expect(photoMark(helped)).toBe("waiting")
    const answered = photo("a", {
      slots: [slot({ outcome: "retake_requested", retakeAnswered: true })],
    })
    expect(needsYou(answered)).toBeNull()
  })

  it("marks waiting, in the album and set aside", () => {
    expect(photoMark(photo("w"))).toBe("waiting")
    expect(photoMark(photo("u", { uploadState: "uploading" }))).toBe("waiting")
    expect(
      photoMark(photo("p", { slots: [slot({ outcome: "public" })] }))
    ).toBe("in-album")
    expect(
      photoMark(photo("x", { slots: [slot({ outcome: "not_used" })] }))
    ).toBe("none")
  })

  it("filters by mark; All shows everything", () => {
    const p = photo("p", { slots: [slot({ outcome: "public" })] })
    expect(matchesShow(p, "in-album")).toBe(true)
    expect(matchesShow(p, "waiting")).toBe(false)
    expect(matchesShow(photo("r", { uploadState: "failed" }), "all")).toBe(true)
  })
})

describe("groupByDay and dayLabel", () => {
  it("groups newest first by the London day", () => {
    const groups = groupByDay(
      [
        photo("old", { uploadedAt: "2026-11-17T09:00:00Z" }),
        photo("today", { uploadedAt: "2026-11-19T09:00:00Z" }),
        photo("late", { uploadedAt: "2026-11-18T23:30:00Z" }),
      ],
      NOW
    )
    expect(groups.map((g) => [g.label, g.items.map((i) => i.assetId)])).toEqual(
      [
        ["Today", ["today"]],
        ["Yesterday", ["late"]],
        ["Tue 17 Nov", ["old"]],
      ]
    )
  })

  it("adds the year for an older year", () => {
    expect(dayLabel("2025-12-24", NOW)).toBe("Wed 24 Dec 2025")
  })
})

describe("photoSummary", () => {
  it("counts by mark and leaves zero parts out", () => {
    const s = photoSummary([
      photo("a"),
      photo("b", { slots: [slot({ outcome: "public" })] }),
      photo("c", { uploadState: "failed" }),
    ])
    expect(s).toEqual({ sent: 3, inAlbum: 1, waiting: 1, needsYou: 1 })
    expect(MY_PHOTOS_COPY.summary(s, true)).toBe(
      "3+ sent · 1 in the album · 1 waiting"
    )
    expect(
      MY_PHOTOS_COPY.summary(
        { sent: 2, inAlbum: 0, waiting: 0, needsYou: 2 },
        false
      )
    ).toBe("2 sent")
  })
})
