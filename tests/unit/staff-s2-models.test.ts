// S2-STAFF pure rules: My uploads (spec §6 S4), Report a change (§6 S3),
// Album filters (§6 S3, FA-6), notice links (§17) and Your month (§6 S4).
import { describe, expect, it } from "vitest"

import { replacementsLine } from "@/components/nabalens/album/your-month-card"
import { placeFilterHref } from "@/components/nabalens/album/album-place"
import {
  buildAlbum,
  filterPlace,
  findSlot,
  needsUpdate,
  placeCategories,
  slotHref,
  slotMatchesShow,
  type AlbumInput,
  type AlbumSlot,
} from "@/lib/album/model"
import {
  datesLine,
  groupUploads,
  isoToLondonLocal,
  londonLocalToIso,
  OUTCOME_CHIP,
  OUTCOME_WORDS,
  parseMyUploads,
  parseVenueManagers,
  receiptWord,
  replacedIds,
  slotPageHref,
  uploadActions,
  uploadSection,
  type MyUpload,
} from "@/lib/staff/my-uploads"
import { noticeHref } from "@/lib/staff/notices"
import {
  parseSlotReport,
  parseSlotReports,
  PHOTO_REASONS,
  reasonsFor,
  reasonWords,
  reportProblem,
  SLOT_REASONS,
} from "@/lib/staff/slot-reports"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import type { AppNotification } from "@/lib/ops/notifications"

const A = "00000000-0000-4000-8000-0000000000a1"
const B = "00000000-0000-4000-8000-0000000000b2"
const C = "00000000-0000-4000-8000-0000000000c3"
const V = "00000000-0000-4000-8000-0000000000f1"
const ITEM = "00000000-0000-4000-8000-0000000000d1"

function upload(over: Partial<MyUpload> = {}): MyUpload {
  return {
    assetId: A,
    venueId: V,
    venueName: "The Bell",
    mediaType: "image",
    uploadState: "ready",
    uploadedAt: "2026-11-12T10:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    duplicate: false,
    labelRevision: 2,
    sharedKinds: [],
    slots: [
      {
        kind: "dish",
        slotId: ITEM,
        name: "Pie",
        outcome: "awaiting_review",
        reason: null,
        decidedAt: null,
        replacesAssetId: null,
      },
    ],
    removalRequested: false,
    removalRequestId: null,
    ...over,
  }
}

const slot = (over: Partial<MyUpload["slots"][number]>) => ({
  ...upload().slots[0]!,
  ...over,
})

describe("parseMyUploads", () => {
  it("reads rows and the cursor, and leaves out malformed rows", () => {
    const page = parseMyUploads({
      items: [
        {
          assetId: A,
          venueId: V,
          venueName: "The Bell",
          mediaType: "video",
          uploadState: "processing",
          uploadedAt: "2026-11-12T10:00:00Z",
          capturedAt: "2026-11-11T19:00:00Z",
          capturedAtSource: "metadata",
          duplicate: true,
          labelRevision: 3,
          sharedKinds: ["team", 4],
          slots: [
            { kind: "area", slotId: B, name: "Bar", outcome: "public" },
            { kind: "dish", slotId: C, name: "Pie", outcome: "approved" },
          ],
          removalRequested: true,
          removalRequestId: C,
        },
        { assetId: B, venueId: V, uploadState: "exploded" },
      ],
      next: { before: "2026-11-12T10:00:00Z", beforeId: A },
    })!
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      mediaType: "video",
      uploadState: "processing",
      capturedAtSource: "metadata",
      duplicate: true,
      labelRevision: 3,
      sharedKinds: ["team"],
      removalRequested: true,
    })
    expect(page.items[0]!.slots).toEqual([
      expect.objectContaining({ kind: "area", outcome: "public" }),
    ])
    expect(page.next).toEqual({
      before: "2026-11-12T10:00:00Z",
      beforeId: A,
    })
    expect(parseMyUploads(null)).toBeNull()
    expect(parseMyUploads({ items: [], next: null })).toEqual({
      items: [],
      next: null,
    })
  })

  it("reads managers", () => {
    expect(
      parseVenueManagers({
        items: [
          { id: A, displayName: "Sam", jobTitle: null, isYou: false },
          { id: B },
        ],
      })
    ).toEqual([{ id: A, displayName: "Sam", jobTitle: null, isYou: false }])
    expect(parseVenueManagers({})).toBeNull()
  })
})

describe("My uploads sections (spec §6 S4)", () => {
  it("puts each upload where the spec says", () => {
    expect(uploadSection(upload())).toBe("waiting")
    expect(uploadSection(upload({ uploadState: "processing" }))).toBe("sending")
    expect(uploadSection(upload({ uploadState: "uploading" }))).toBe("sending")
    expect(uploadSection(upload({ uploadState: "failed" }))).toBe("attention")
    expect(
      uploadSection(
        upload({ slots: [slot({ outcome: "retake_requested", reason: "x" })] })
      )
    ).toBe("attention")
    expect(uploadSection(upload({ slots: [] }))).toBe("attention")
    expect(uploadSection(upload({ slots: [], sharedKinds: ["team"] }))).toBe(
      "reviewed"
    )
    expect(
      uploadSection(upload({ slots: [slot({ outcome: "public" })] }))
    ).toBe("reviewed")
    expect(
      uploadSection(upload({ slots: [slot({ outcome: "reference" })] }))
    ).toBe("reviewed")
  })

  it("moves an answered retake out of Needs attention (AC17)", () => {
    const old = upload({
      assetId: A,
      slots: [slot({ outcome: "retake_requested", reason: "Too dark" })],
    })
    const next = upload({
      assetId: B,
      slots: [slot({ replacesAssetId: A })],
    })
    expect(replacedIds([old, next])).toEqual(new Set([A]))
    const { groups } = groupUploads([next, old])
    expect(groups.attention).toEqual([])
    expect(groups.waiting.map((u) => u.assetId)).toEqual([B])
    expect(groups.reviewed.map((u) => u.assetId)).toEqual([A])
  })
})

describe("My uploads actions by state", () => {
  it("offers Change slot and Withdraw only while nothing is decided", () => {
    expect(uploadActions(upload())).toMatchObject({
      withdraw: true,
      changeSlot: true,
      correction: false,
      removal: false,
      retake: null,
      fixDate: true,
    })
    const accepted = upload({ slots: [slot({ outcome: "public" })] })
    expect(uploadActions(accepted)).toMatchObject({
      withdraw: false,
      changeSlot: false,
      correction: true,
      removal: true,
    })
    expect(uploadActions({ ...accepted, removalRequested: true }).removal).toBe(
      false
    )
    const notUsed = upload({ slots: [slot({ outcome: "not_used" })] })
    expect(uploadActions(notUsed)).toMatchObject({
      withdraw: false,
      correction: true,
      removal: false,
    })
  })

  it("leaves Change slot out for videos, amenities and two slots", () => {
    expect(uploadActions(upload({ mediaType: "video" })).changeSlot).toBe(false)
    expect(
      uploadActions(upload({ slots: [slot({ kind: "amenity" })] })).changeSlot
    ).toBe(false)
    expect(
      uploadActions(upload({ slots: [slot({}), slot({ slotId: B })] }))
        .changeSlot
    ).toBe(false)
    expect(uploadActions(upload({ uploadState: "uploading" })).withdraw).toBe(
      false
    )
  })

  it("offers Retake with the slot it opens, until a newer photo answers it", () => {
    const old = upload({
      slots: [slot({ outcome: "retake_requested", reason: "Too dark" })],
    })
    expect(uploadActions(old).retake?.slotId).toBe(ITEM)
    expect(uploadActions(old, new Set([A])).retake).toBeNull()
    expect(slotPageHref({ kind: "dish", slotId: ITEM })).toBe(
      `/staff/album/slot/dish/${ITEM}`
    )
    expect(slotPageHref({ kind: "amenity", slotId: ITEM })).toBe(
      `/staff/tasks/amenities/${ITEM}`
    )
  })
})

describe("My uploads words", () => {
  it("uses Album's outcome words with a chip for each (FA-7)", () => {
    expect(OUTCOME_WORDS).toMatchObject({
      public: "In the album",
      reference: "Kept for reference",
      retake_requested: "Retake",
      label_corrected: "Label corrected",
      not_used: "Not used",
    })
    for (const key of Object.values(OUTCOME_CHIP))
      expect(Object.hasOwn(CHIP_STATES, key), key).toBe(true)
    for (const word of Object.values(OUTCOME_WORDS))
      expect(word).not.toMatch(/approv|due|task/i)
  })

  it("says the receipt words for an unfinished upload", () => {
    expect(receiptWord({ uploadState: "uploading" })).toBe("Sending")
    expect(receiptWord({ uploadState: "processing" })).toBe("Checking")
    expect(receiptWord({ uploadState: "failed" })).toBe("Couldn't finish")
    expect(receiptWord({ uploadState: "ready" })).toBeNull()
  })

  it("writes when it was sent and taken, Unknown when not known", () => {
    const now = new Date("2026-11-18T12:00:00Z")
    expect(datesLine(upload(), now)).toBe("Sent 12 Nov · date taken unknown")
    expect(datesLine(upload({ capturedAt: "2025-12-31T23:30:00Z" }), now)).toBe(
      "Sent 12 Nov · taken 31 Dec 2025"
    )
  })

  it("turns London wall time into an instant and back, across BST", () => {
    expect(londonLocalToIso("2026-11-12T19:30")).toBe(
      "2026-11-12T19:30:00.000Z"
    )
    expect(londonLocalToIso("2026-07-01T19:30")).toBe(
      "2026-07-01T18:30:00.000Z"
    )
    expect(londonLocalToIso("nonsense")).toBeNull()
    expect(isoToLondonLocal("2026-07-01T18:30:00.000Z")).toBe(
      "2026-07-01T19:30"
    )
    expect(isoToLondonLocal(null)).toBe("")
  })
})

describe("Report a change", () => {
  it("offers the spec's five reasons on a slot, and three on a photo", () => {
    expect(SLOT_REASONS.map((r) => r.key)).toEqual([
      "no_longer_served",
      "appearance_changed",
      "space_unavailable",
      "wrong_label",
      "other",
    ])
    expect(reasonsFor("photo")).toBe(PHOTO_REASONS)
    expect(reasonsFor("area")).toBe(SLOT_REASONS)
    expect(reasonWords("wrong_date")).toBe("The date it was taken is wrong")
  })

  it("needs a reason from the kind's list, and a note for Something else", () => {
    expect(reportProblem("dish", null, "")).toMatch(/Choose/)
    expect(reportProblem("dish", "wrong_date", "")).toMatch(/Choose/)
    expect(reportProblem("dish", "other", "  ")).toBe("Say what has changed.")
    expect(reportProblem("dish", "other", "Now a starter")).toBeNull()
    expect(reportProblem("photo", "wrong_label", "")).toBeNull()
    expect(reportProblem("area", "other", "x".repeat(501))).toMatch(/500/)
  })

  it("parses reports and leaves out malformed ones", () => {
    const row = {
      id: A,
      venueId: V,
      reporterId: B,
      reporterName: "Jo",
      subjectKind: "dish",
      subjectId: ITEM,
      subjectName: "Pie",
      reason: "no_longer_served",
      note: null,
      state: "open",
      createdAt: "2026-11-18T10:00:00Z",
      decidedAt: null,
      decisionNote: null,
    }
    expect(parseSlotReport(row)).toMatchObject({ subjectName: "Pie" })
    expect(parseSlotReport({ ...row, reason: "boredom" })).toBeNull()
    expect(
      parseSlotReports({ items: [row, { ...row, state: "lost" }] })
    ).toHaveLength(1)
    expect(parseSlotReports(null)).toBeNull()
  })
})

// ---- Album filters (spec §6 S3; FA-6) ---------------------------------------

const BAR = "00000000-0000-4000-8000-00000000b001"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const D1 = "00000000-0000-4000-8000-0000000d0001"
const D2 = "00000000-0000-4000-8000-0000000d0002"
const D3 = "00000000-0000-4000-8000-0000000d0003"
const CHECK = "00000000-0000-4000-8000-0000000e0001"

const dish = (itemId: string, name: string, extra = {}) => ({
  itemId,
  name,
  sectionId: DRINKS,
  sectionName: "Drinks",
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
  ...extra,
})

const input: AlbumInput = {
  places: [{ subjectId: BAR, label: "The bar" }],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "amenity_category", key: "Games", subjectId: BAR },
  ],
  sections: [{ sectionId: DRINKS, slug: "drinks" }],
  dishes: [
    dish(D1, "Guinness", {
      coverage: "missing",
      coverageCategory: "drinks",
      pendingCount: 0,
    }),
    dish(D2, "Aperol", {
      coverage: "pending",
      coverageCategory: "drinks",
      pendingCount: 2,
    }),
    dish(D3, "Cider", {
      coverage: "replacement_needed",
      coverageCategory: "drinks",
    }),
  ],
  amenities: [
    {
      checkId: CHECK,
      key: "darts",
      question: "Darts board",
      category: "Games",
      progress: "complete",
      answer: "yes",
      myLatestState: null,
      coverage: "covered",
      coverageCategory: "facilities",
      pendingCount: 0,
    },
  ],
  areas: [
    {
      subjectId: BAR,
      label: "The bar",
      state: "check-due",
      coverage: "check_due",
      coverageCategory: "spaces",
      pendingCount: 1,
    },
  ],
  myRetakeItemIds: new Set(),
}

describe("Album filters", () => {
  const album = buildAlbum(input)
  const bar = album.places[0]!
  const names = (place = bar) =>
    place.groups.flatMap((g) => g.slots.map((s) => s.name))

  it("carries category, waiting count and Needs updating from coverage", () => {
    const aperol = findSlot(album, `dish:${D2}`)!.slot
    expect(aperol).toMatchObject({
      category: "drinks",
      pendingCount: 2,
      state: "waiting",
      needsUpdate: false,
    })
    // Another person's retake: Needed for me, but it needs updating.
    const cider = findSlot(album, `dish:${D3}`)!.slot
    expect(cider).toMatchObject({ state: "needed", needsUpdate: true })
    expect(findSlot(album, `area:${BAR}`)!.slot).toMatchObject({
      category: "spaces",
      needsUpdate: true,
    })
    expect(findSlot(album, "dish:nope")).toBeNull()
  })

  it("filters by state in Album's words", () => {
    expect(names(filterPlace(bar, { show: "needed", category: null }))).toEqual(
      ["Cider", "Guinness"]
    )
    expect(
      names(filterPlace(bar, { show: "waiting", category: null }))
    ).toEqual(["Aperol"])
    expect(
      names(filterPlace(bar, { show: "in-album", category: null }))
    ).toEqual(["Darts board"])
    expect(
      names(filterPlace(bar, { show: "updating", category: null }))
    ).toEqual(["Cider", "The bar"])
    expect(
      names(filterPlace(bar, { show: "all", category: null }))
    ).toHaveLength(5)
  })

  it("filters by the spec's categories and keeps the place's counts", () => {
    const filtered = filterPlace(bar, { show: "all", category: "facilities" })
    expect(names(filtered)).toEqual(["Darts board"])
    expect(filtered.empty).toBe(bar.empty)
    expect(filtered.total).toBe(bar.total)
    expect(placeCategories(bar)).toEqual(["drinks", "spaces", "facilities"])
  })

  it("builds clean filter URLs and slot links", () => {
    expect(placeFilterHref(BAR, { show: "all", category: null })).toBe(
      `/staff/album/${BAR}`
    )
    expect(
      placeFilterHref("unplaced", { show: "needed", category: "food" })
    ).toBe("/staff/album/unplaced?show=needed&cat=food")
    const s = (target: AlbumSlot["target"]) => slotHref({ target })
    expect(s({ kind: "dish", itemId: D1, itemName: "x" })).toBe(
      `/staff/album/slot/dish/${D1}`
    )
    expect(s({ kind: "area", subjectId: BAR })).toBe(
      `/staff/album/slot/area/${BAR}`
    )
    expect(s({ kind: "amenity", checkId: CHECK })).toBe(
      `/staff/tasks/amenities/${CHECK}`
    )
  })

  it("matches each state to one filter at most, besides All", () => {
    for (const state of [
      "needed",
      "retake",
      "waiting",
      "sending",
      "accepted",
    ] as const) {
      const one = { ...findSlot(album, `dish:${D1}`)!.slot, state }
      const hits = (["needed", "waiting", "in-album"] as const).filter((show) =>
        slotMatchesShow(one, show)
      )
      expect(hits.length, state).toBe(1)
    }
    expect(needsUpdate(undefined, "retake")).toBe(true)
    expect(needsUpdate("covered", "accepted")).toBe(false)
  })
})

describe("notice links and Your month", () => {
  const n = (over: Partial<AppNotification>): AppNotification => ({
    id: 1,
    kind: "retake_requested",
    subjectType: "menu_item",
    subjectId: null,
    venueId: V,
    venueName: "The Bell",
    payload: {},
    createdAt: "2026-11-18T10:00:00Z",
    state: "unread",
    ...over,
  })

  it("opens the slot of a retake, the check given, else Me", () => {
    expect(
      noticeHref(n({ payload: { source: "menu_photo", itemId: ITEM } }))
    ).toBe(`/staff/album/slot/dish/${ITEM}`)
    expect(noticeHref(n({ payload: { source: "area", subjectId: BAR } }))).toBe(
      `/staff/album/slot/area/${BAR}`
    )
    expect(noticeHref(n({ payload: { source: "checklist" } }))).toBe("/staff")
    expect(
      noticeHref(n({ kind: "assigned", payload: { checkId: CHECK } }))
    ).toBe(`/staff/tasks/amenities/${CHECK}`)
    expect(noticeHref(n({ kind: "upload_problem" }))).toBe("/staff")
  })

  it("says the month's two figures without ranking", () => {
    expect(replacementsLine({ covered: 0, replaced: 0 })).toBe(
      "0 slots in the album from your photos"
    )
    expect(replacementsLine({ covered: 3, replaced: 1 })).toBe(
      "3 slots in the album from your photos · 1 outdated photo replaced"
    )
  })
})
