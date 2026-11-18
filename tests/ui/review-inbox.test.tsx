// @vitest-environment jsdom
// S2-REVIEW: the photo review detail, batch decisions and the Review card
// flags (spec §7 M2). Server Functions are mocked; the database's own rules
// are proven in tests/security/review-inbox.test.ts.
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
}))
const manager = vi.hoisted(() => ({
  decideMenuPhotoAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
}))
vi.mock("@/app/manager/review/actions", () => review)
vi.mock("@/app/manager/actions", () => manager)

import { InboxBatch } from "@/components/nabalens/manager/review/inbox-batch"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { CardFlags } from "@/components/nabalens/manager/review/inbox-flags"
import { InboxPhotoDetail } from "@/components/nabalens/manager/review/inbox-photo-detail"
import type { PhotoDetail } from "@/lib/review/inbox"
import type { QueueCard } from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ASSET = id(0xa1)
const SOUP = id(0xc1)
const LABEL = id(0xd1)

function detail(over: Partial<PhotoDetail> = {}): PhotoDetail {
  return {
    assetId: ASSET,
    venueId: id(0xe1),
    mediaType: "image",
    width: 1200,
    height: 900,
    sizeBytes: 1000,
    uploadedAt: "2026-11-10T10:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    contributor: { id: id(0xf1), name: "Priya Shah", active: true },
    isSelf: false,
    selfBlocked: false,
    note: "From the pass",
    contentTypes: ["dish"],
    needsLabel: false,
    duplicateOfAssetId: null,
    possibleDuplicates: [],
    group: [],
    disposition: null,
    dishes: [
      {
        itemId: SOUP,
        variantId: null,
        itemName: "Soup",
        variantName: null,
        sectionName: "Mains",
        sectionKind: "food",
        onMenu: true,
        staffLabel: true,
        waiting: true,
        photoId: null,
        state: null,
        level: null,
        basis: null,
        isPrimary: false,
        itemRevision: 4,
        presentationRevision: 2,
        presentationNote: "Now in a bowl",
        neededBy: null,
        publicPhotos: [{ assetId: id(0xb1), isPrimary: true }],
      },
    ],
    places: [],
    amenities: [],
    history: [],
    ...over,
  }
}

const IMAGES = { main: { thumbnail: null, preview: null }, thumbs: {} }

describe("photo review detail", () => {
  it("shows provenance: who, when uploaded, capture time unknown, size and note", () => {
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    expect(screen.getByText("Priya Shah")).toBeTruthy()
    expect(screen.getByText("Taken: unknown")).toBeTruthy()
    expect(screen.getByText("1200 × 900 px")).toBeTruthy()
    expect(screen.getByText("From the pass")).toBeTruthy()
    // Below 1600 px: reference use only.
    expect(screen.getAllByText(INBOX_COPY.belowPublic).length).toBeGreaterThan(
      0
    )
    expect(screen.getByText(/Presentation 2: Now in a bowl/)).toBeTruthy()
  })

  it("approves for public use against the item's revision", async () => {
    const user = userEvent.setup()
    review.setDishLevelAction.mockResolvedValue({ ok: true, itemRevision: 5 })
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    await user.click(screen.getByRole("button", { name: INBOX_COPY.approve }))
    expect(review.setDishLevelAction.mock.calls[0]![0]).toMatchObject({
      assetId: ASSET,
      itemId: SOUP,
      level: "public",
      expectedRevision: 4,
    })
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    expect(screen.getByText(INBOX_COPY.done)).toBeTruthy()
  })

  it("shows the newer decision instead of overwriting it", async () => {
    const user = userEvent.setup()
    review.decidePlacePhotoAction.mockResolvedValue({
      ok: false,
      code: "stale_version",
      message: "Someone else decided this photo since you opened it.",
      latest: {
        action: "accepted",
        level: "reference",
        by: "Sam",
        at: "2026-11-11T09:00:00Z",
      },
    })
    render(
      <InboxPhotoDetail
        detail={detail({
          dishes: [],
          places: [
            {
              labelId: LABEL,
              subjectId: id(0xd2),
              name: "Bar",
              state: "pending",
              level: "public",
              decisionId: null,
              isPrimary: false,
              publicPhotos: [],
            },
          ],
        })}
        images={IMAGES}
      />
    )
    await user.click(
      screen.getByRole("button", { name: INBOX_COPY.keepReference })
    )
    expect(review.decidePlacePhotoAction.mock.calls[0]![0]).toMatchObject({
      labelId: LABEL,
      action: "accepted",
      level: "reference",
      expectedDecisionId: null,
    })
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText(INBOX_COPY.conflictTitle)).toBeTruthy()
    expect(
      within(alert).getByText(
        "Accepted: kept as reference by Sam on 11 Nov 2026"
      )
    ).toBeTruthy()
  })

  it("asks for another photo with the spec's reasons and a note", async () => {
    const user = userEvent.setup()
    manager.decideMenuPhotoAction.mockResolvedValue({ ok: true, outcome: {} })
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    await user.click(
      screen.getByRole("button", { name: INBOX_COPY.askAnother })
    )
    const dialog = screen.getByRole("dialog")
    // Dish photos are never asked to show a route.
    expect(
      within(dialog).queryByRole("button", { name: "Show the way in" })
    ).toBeNull()
    await user.click(within(dialog).getByRole("button", { name: "Too dark" }))
    await user.type(
      within(dialog).getByLabelText(INBOX_COPY.reasonNote),
      "Use the window"
    )
    await user.click(
      within(dialog).getByRole("button", { name: INBOX_COPY.askAnother })
    )
    expect(manager.decideMenuPhotoAction.mock.calls[0]![0]).toMatchObject({
      action: "ask_another",
      itemId: SOUP,
      expectedRevision: 4,
      reason: "Too dark. Use the window",
    })
  })

  it("sets a photo aside as Not used with a reason", async () => {
    const user = userEvent.setup()
    review.setAsidePhotoAction.mockResolvedValue({ ok: true, dispositionId: 9 })
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    await user.click(screen.getByRole("button", { name: INBOX_COPY.notUsed }))
    const dialog = screen.getByRole("dialog")
    await user.type(
      within(dialog).getByLabelText(INBOX_COPY.notUsedLabel),
      "Not one of ours"
    )
    await user.click(
      within(dialog).getByRole("button", { name: INBOX_COPY.notUsed })
    )
    expect(review.setAsidePhotoAction.mock.calls[0]![0]).toMatchObject({
      assetId: ASSET,
      action: "not_used",
      reason: "Not one of ours",
      expectedDispositionId: null,
    })
  })

  it("offers Use again on a photo set aside, and no other decision", async () => {
    render(
      <InboxPhotoDetail
        detail={detail({
          disposition: {
            id: 3,
            action: "duplicate",
            reasonCode: "duplicate",
            reason: null,
            duplicateOfAssetId: id(0xb1),
            by: "Sam",
            at: "2026-11-11T09:00:00Z",
          },
        })}
        images={IMAGES}
      />
    )
    expect(
      screen.getByText("Marked duplicate by Sam on 11 Nov 2026")
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: INBOX_COPY.restore })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: INBOX_COPY.approve })
    ).toBeNull()
  })

  it("never offers a manager decisions on their own photo", () => {
    render(
      <InboxPhotoDetail
        detail={detail({ isSelf: true, selfBlocked: true })}
        images={IMAGES}
      />
    )
    expect(screen.getByText(INBOX_COPY.ownPhoto)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: INBOX_COPY.approve })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: INBOX_COPY.notUsed })
    ).toBeNull()
  })

  it("marks a duplicate of an accepted photo", async () => {
    const user = userEvent.setup()
    review.setAsidePhotoAction.mockResolvedValue({ ok: true, dispositionId: 4 })
    render(<InboxPhotoDetail detail={detail()} images={IMAGES} />)
    await user.click(
      screen.getByRole("button", { name: INBOX_COPY.markDuplicate })
    )
    const dialog = screen.getByRole("dialog")
    await user.click(within(dialog).getByRole("radio"))
    await user.click(
      within(dialog).getByRole("button", { name: INBOX_COPY.markDuplicate })
    )
    expect(review.setAsidePhotoAction.mock.calls[0]![0]).toMatchObject({
      action: "duplicate",
      duplicateOf: id(0xb1),
    })
  })
})

function card(n: number, over: Partial<QueueCard> = {}): QueueCard {
  return {
    key: id(n),
    kind: "labelled",
    labelId: id(n),
    photoId: null,
    asset: {
      assetId: id(n),
      thumbnailUrl: `/t/${n}`,
      previewUrl: null,
      width: 2000,
      height: 1500,
    },
    uploadedAt: "2026-11-10T10:00:00Z",
    labelledAt: null,
    contributor: {
      id: id(0xf1),
      name: "Priya",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: SOUP,
      name: "Soup",
      sectionId: id(0xc9),
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
    itemRevision: 2,
    groupCount: 1,
    ...over,
  }
}

describe("batch decisions", () => {
  it("confirms exactly the chosen photos, then reports each one", async () => {
    const user = userEvent.setup()
    review.decideBatchAction.mockResolvedValue({
      ok: true,
      outcomes: [
        { key: id(1), assetId: id(1), ok: true },
        {
          key: id(2),
          assetId: id(2),
          ok: false,
          error: "Someone else decided this photo since you opened it.",
          conflict: true,
        },
      ],
    })
    render(
      <InboxBatch
        cards={[card(1), card(2), card(3), card(4, { isSelf: true })]}
      />
    )
    await user.click(
      screen.getByRole("button", { name: INBOX_COPY.batch.start })
    )
    // The caller's own photo cannot be chosen.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3)
    const boxes = screen.getAllByRole("checkbox")
    await user.click(boxes[0]!)
    await user.click(boxes[1]!)
    await user.click(
      screen.getByRole("button", { name: `${INBOX_COPY.approve} (2)` })
    )
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2)
    await user.click(
      within(dialog).getByRole("button", { name: `${INBOX_COPY.approve} (2)` })
    )
    expect(review.decideBatchAction.mock.calls[0]![0]).toMatchObject({
      action: "public",
      items: [
        { key: id(1), assetId: id(1), itemId: SOUP, itemRevision: 2 },
        { key: id(2), assetId: id(2), itemId: SOUP, itemRevision: 2 },
      ],
    })
    expect(await screen.findByText(INBOX_COPY.batch.result(1, 1))).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalled()
  })

  it("needs a reason before setting photos aside as Not used", async () => {
    const user = userEvent.setup()
    render(<InboxBatch cards={[card(1)]} />)
    await user.click(
      screen.getByRole("button", { name: INBOX_COPY.batch.start })
    )
    await user.click(screen.getAllByRole("checkbox")[0]!)
    await user.click(
      screen.getByRole("button", { name: `${INBOX_COPY.notUsed} (1)` })
    )
    const dialog = screen.getByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: `${INBOX_COPY.notUsed} (1)` })
    )
    expect(review.decideBatchAction).not.toHaveBeenCalled()
    expect(within(dialog).getByRole("alert")).toBeTruthy()
  })
})

describe("Review card flags", () => {
  it("flags Needs label, a possible duplicate and a small photo, with the capture date", () => {
    render(
      <CardFlags
        card={card(1, {
          kind: "unlabelled",
          item: null,
          asset: { ...card(1).asset, width: 800, height: 600 },
          provenance: {
            capturedAt: "2026-11-09T12:00:00Z",
            capturedAtSource: "metadata",
            possibleDuplicate: true,
            note: "Special tonight",
            sectionKind: null,
          },
        })}
      />
    )
    expect(screen.getByText(INBOX_COPY.needsLabel)).toBeTruthy()
    expect(screen.getByText(INBOX_COPY.possibleDuplicate)).toBeTruthy()
    expect(screen.getByText(INBOX_COPY.belowPublic)).toBeTruthy()
    expect(screen.getByText("Taken 9 Nov 2026")).toBeTruthy()
    expect(screen.getByText("Special tonight")).toBeTruthy()
  })
})
