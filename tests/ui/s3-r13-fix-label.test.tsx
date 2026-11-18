// @vitest-environment jsdom
// S3-R13: Fix label without a re-upload (spec §7 M2, AC15). X7: a decided
// staff label keeps Fix label (once corrected, it waits for that correction
// to be withdrawn). X8: one picker offers menu items, places and amenities,
// and a place or amenity photo can be moved. X1: Needs label links to the
// admin photo route for an admin. Server Functions are mocked; the database
// rules are in tests/security/s3-r13-fix-label.test.ts.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/manager/review/photo/x",
}))

const review = vi.hoisted(() => ({
  setAsidePhotoAction: vi.fn(),
  setDishLevelAction: vi.fn(),
  decidePlacePhotoAction: vi.fn(),
  decideAmenityPhotoAction: vi.fn(),
  decideBatchAction: vi.fn(),
  setSlotPrimaryAction: vi.fn(),
  fixSlotLabelAction: vi.fn(),
  loadFixLabelSlotsAction: vi.fn(),
}))
const manager = vi.hoisted(() => ({
  decideMenuPhotoAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
}))
vi.mock("@/app/manager/review/actions", () => review)
vi.mock("@/app/manager/actions", () => manager)

import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { NeedsLabelList } from "@/components/nabalens/manager/review/inbox-needs-label"
import { InboxPhotoDetail } from "@/components/nabalens/manager/review/inbox-photo-detail"
import { photoHref } from "@/components/nabalens/manager/review/links"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import type { DetailDish, PhotoDetail } from "@/lib/review/inbox"
import type { QueueCard } from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ASSET = id(0xa1)
const VENUE = id(0xe1)
const SOUP = id(0xc1)
const STEW = id(0xc2)
const LABEL = id(0xd1)
const BAR = id(0xd2)
const GARDEN = id(0xd3)
const PARKING = id(0xf1)

function dish(over: Partial<DetailDish> = {}): DetailDish {
  return {
    itemId: SOUP,
    variantId: null,
    itemName: "Soup",
    variantName: null,
    sectionName: "Mains",
    sectionKind: "food",
    onMenu: true,
    staffLabel: true,
    relinked: false,
    waiting: false,
    photoId: id(0xb1),
    state: "accepted",
    level: "public",
    basis: "staff_label",
    isPrimary: false,
    itemRevision: 4,
    presentationRevision: 1,
    presentationNote: null,
    neededBy: null,
    publicPhotos: [],
    ...over,
  }
}

function detail(over: Partial<PhotoDetail> = {}): PhotoDetail {
  return {
    assetId: ASSET,
    venueId: VENUE,
    mediaType: "image",
    width: 2400,
    height: 1800,
    sizeBytes: 1_000_000,
    durationSeconds: null,
    uploadedAt: "2026-11-10T09:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    hasThumbnail: true,
    hasPreview: true,
    contributor: { id: id(0x51), name: "Priya Shah", active: true },
    isSelf: false,
    selfBlocked: false,
    selfReviewAllowed: false,
    note: null,
    contentTypes: ["dish"],
    needsLabel: false,
    unlabelledReason: null,
    duplicateOfAssetId: null,
    possibleDuplicates: [],
    group: [],
    disposition: null,
    dishes: [dish()],
    places: [],
    amenities: [],
    history: [],
    ...over,
  } as PhotoDetail
}

const IMAGES = { main: { thumbnail: null, preview: null }, thumbs: {} }

const barPlace = {
  labelId: LABEL,
  subjectId: BAR,
  name: "Bar",
  state: "accepted" as const,
  level: "public" as const,
  decisionId: 7,
  isPrimary: false,
  publicPhotos: [],
}

const SLOTS = [
  { kind: "area", id: BAR, name: "Bar", groupName: "Bar" },
  { kind: "area", id: GARDEN, name: "Garden", groupName: "Garden" },
  { kind: "amenity", id: PARKING, name: "Parking", groupName: "Outside" },
]

const stew = {
  itemId: STEW,
  name: "Stew",
  description: null,
  section: { id: id(0x71), name: "Mains", kind: "food", position: 1 },
  entryPosition: 2,
  variants: [],
  status: "needs_photo",
  hasPendingReplacement: false,
  needsRecheck: false,
  ownWaiting: 0,
  othersWaiting: 0,
  acceptedCount: 0,
  candidateCount: 0,
  preferred: null,
  itemRevision: 9,
}

describe("X7: Fix label on a decided dish label", () => {
  it("offers Fix label on an accepted staff label and relinks it", async () => {
    const user = userEvent.setup()
    manager.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [stew],
      nextCursor: null,
    })
    manager.decideMenuPhotoAction.mockResolvedValue({ ok: true, outcome: {} })
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    await user.click(screen.getByRole("button", { name: INBOX_COPY.fixLabel }))
    const dialog = screen.getByRole("dialog")
    await user.click(await within(dialog).findByRole("radio", { name: /Stew/ }))
    await user.type(
      within(dialog).getByRole("textbox", { name: /wrong/ }),
      "It is stew"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /Approve for Stew/ })
    )
    await waitFor(() =>
      expect(manager.decideMenuPhotoAction).toHaveBeenCalled()
    )
    expect(manager.decideMenuPhotoAction.mock.calls[0]![0]).toMatchObject({
      action: "relink",
      assetId: ASSET,
      itemId: STEW,
      expectedRevision: 9,
      correctsItemId: SOUP,
      reason: "It is stew",
    })
  })

  it("offers Fix label on a withdrawn staff label, not on a corrected one", () => {
    const { unmount } = render(
      <InboxPhotoDetail
        detail={detail({
          dishes: [dish({ state: null, photoId: null, level: null })],
        })}
        images={IMAGES}
      />
    )
    expect(
      screen.getByRole("button", { name: INBOX_COPY.fixLabel })
    ).toBeTruthy()
    unmount()
    render(
      <InboxPhotoDetail
        detail={detail({
          dishes: [
            dish({ state: null, photoId: null, level: null, relinked: true }),
          ],
        })}
        images={IMAGES}
      />
    )
    expect(
      screen.queryByRole("button", { name: INBOX_COPY.fixLabel })
    ).toBeNull()
  })
})

describe("X8: one picker for menu items, places and amenities", () => {
  it("moves a place photo to another place", async () => {
    const user = userEvent.setup()
    manager.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    review.loadFixLabelSlotsAction.mockResolvedValue({ ok: true, slots: SLOTS })
    review.fixSlotLabelAction.mockResolvedValue({ ok: true, toKind: "area" })
    render(
      <InboxPhotoDetail
        detail={detail({ dishes: [], places: [barPlace] })}
        images={IMAGES}
        venueId={VENUE}
      />
    )
    await user.click(screen.getByRole("button", { name: INBOX_COPY.fixLabel }))
    const dialog = screen.getByRole("dialog")
    await user.click(
      within(dialog).getByRole("radio", { name: REVIEW_COPY.pickerKindPlace })
    )
    expect(review.loadFixLabelSlotsAction).toHaveBeenCalledWith({
      venueId: VENUE,
    })
    // The place it is on now is refused.
    await user.click(await within(dialog).findByRole("radio", { name: "Bar" }))
    await user.type(
      within(dialog).getByRole("textbox", { name: INBOX_COPY.fixLabelReason }),
      "It is the garden"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /Approve for Bar/ })
    )
    expect(within(dialog).getByText(REVIEW_COPY.pickerSameSlot)).toBeTruthy()
    expect(review.fixSlotLabelAction).not.toHaveBeenCalled()
    // Amenities are not in the Place list.
    expect(within(dialog).queryByRole("radio", { name: "Parking" })).toBeNull()

    await user.click(within(dialog).getByRole("radio", { name: "Garden" }))
    await user.click(
      within(dialog).getByRole("button", { name: /Approve for Garden/ })
    )
    await waitFor(() => expect(review.fixSlotLabelAction).toHaveBeenCalled())
    expect(review.fixSlotLabelAction.mock.calls[0]![0]).toEqual({
      venueId: VENUE,
      assetId: ASSET,
      fromKind: "area",
      fromId: LABEL,
      toKind: "area",
      toId: GARDEN,
      reason: "It is the garden",
    })
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
  })

  it("moves a decided dish label to an amenity with its revision", async () => {
    const user = userEvent.setup()
    manager.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    review.loadFixLabelSlotsAction.mockResolvedValue({ ok: true, slots: SLOTS })
    review.fixSlotLabelAction.mockResolvedValue({ ok: true, toKind: "amenity" })
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    await user.click(screen.getByRole("button", { name: INBOX_COPY.fixLabel }))
    const dialog = screen.getByRole("dialog")
    await user.click(
      within(dialog).getByRole("radio", {
        name: REVIEW_COPY.pickerKindAmenity,
      })
    )
    await user.click(
      await within(dialog).findByRole("radio", { name: /Parking/ })
    )
    await user.type(
      within(dialog).getByRole("textbox", { name: /wrong/ }),
      "The car park"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /Approve for Parking/ })
    )
    await waitFor(() => expect(review.fixSlotLabelAction).toHaveBeenCalled())
    expect(review.fixSlotLabelAction.mock.calls[0]![0]).toEqual({
      assetId: ASSET,
      fromKind: "dish",
      fromId: SOUP,
      fromVariantId: null,
      expectedRevision: 4,
      toKind: "amenity",
      toId: PARKING,
      reason: "The car park",
    })
  })

  it("moves a place photo onto a dish in one step", async () => {
    const user = userEvent.setup()
    manager.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [stew],
      nextCursor: null,
    })
    review.fixSlotLabelAction.mockResolvedValue({ ok: true, toKind: "dish" })
    render(
      <InboxPhotoDetail
        detail={detail({ dishes: [], places: [barPlace] })}
        images={IMAGES}
      />
    )
    await user.click(screen.getByRole("button", { name: INBOX_COPY.fixLabel }))
    const dialog = screen.getByRole("dialog")
    await user.click(await within(dialog).findByRole("radio", { name: /Stew/ }))
    await user.type(
      within(dialog).getByRole("textbox", { name: INBOX_COPY.fixLabelReason }),
      "A bowl of stew"
    )
    await user.click(
      within(dialog).getByRole("button", { name: /Approve for Stew/ })
    )
    await waitFor(() => expect(review.fixSlotLabelAction).toHaveBeenCalled())
    expect(review.fixSlotLabelAction.mock.calls[0]![0]).toMatchObject({
      fromKind: "area",
      fromId: LABEL,
      toKind: "dish",
      toId: STEW,
      toVariantId: null,
      expectedRevision: 9,
    })
    expect(manager.decideMenuPhotoAction).not.toHaveBeenCalled()
  })
})

function needsLabelCard(n: number): QueueCard {
  return {
    key: id(0x900 + n),
    kind: "unlabelled",
    labelId: null,
    photoId: null,
    asset: {
      assetId: id(0x900 + n),
      thumbnailUrl: null,
      previewUrl: null,
      width: 100,
      height: 100,
    },
    uploadedAt: "2026-11-10T09:00:00Z",
    labelledAt: null,
    contributor: {
      id: id(0x51),
      name: "Priya Shah",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    selfReviewAllowed: false,
    item: null,
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
    itemRevision: 0,
    groupCount: 0,
  } as QueueCard
}

describe("X1, X2: Needs label for admins, and past the first page", () => {
  it("photoHref is the admin photo route for an admin scope", () => {
    expect(photoHref({ kind: "admin", venueId: VENUE }, ASSET)).toBe(
      `/admin/coverage/${VENUE}/menu-photos/photo/${ASSET}`
    )
    expect(photoHref({ kind: "manager" }, ASSET)).toBe(
      `/manager/review/photo/${ASSET}`
    )
  })

  it("links an admin's Needs label photos to the admin detail", () => {
    render(
      <NeedsLabelList
        cards={[needsLabelCard(1)]}
        scope={{ kind: "admin", venueId: VENUE }}
      />
    )
    const link = screen.getByRole("link", { name: /Priya Shah/ })
    expect(link.getAttribute("href")).toBe(
      `/admin/coverage/${VENUE}/menu-photos/photo/${id(0x901)}`
    )
  })

  it("counts every photo it was given and says when more wait", () => {
    const cards = Array.from({ length: 40 }, (_, i) => needsLabelCard(i))
    const { unmount } = render(<NeedsLabelList cards={cards} />)
    expect(
      screen.getByRole("heading", { name: "40 photos need a label" })
    ).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(40)
    unmount()
    render(<NeedsLabelList cards={cards} more />)
    expect(
      screen.getByRole("heading", { name: "More than 40 photos need a label" })
    ).toBeTruthy()
    expect(screen.getByText(INBOX_COPY.needsLabelMore)).toBeTruthy()
  })
})
