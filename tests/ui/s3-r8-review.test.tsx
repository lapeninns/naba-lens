// @vitest-environment jsdom
// S3-R8: Review repairs, round 2.
//   W1  a Needs label video offers no dish pick (the write takes images only);
//       its card says to mark it Not used from its details.
//   W2  Needs label photos list with a line when the menu is not ready.
//   W4  Videos leaves out the photo-only place and amenity sections.
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/manager/review",
}))

vi.mock("server-only", () => ({}))
vi.mock("@/app/_media/actions", () => ({
  readPhotoSets: vi.fn(async () => ({ status: "missing" })),
}))
vi.mock("@/app/manager/actions", () => ({
  decideMenuPhotoAction: vi.fn(),
  loadReviewPageAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))
const reads = vi.hoisted(() => ({
  getContributor: vi.fn(),
  getManagerOverview: vi.fn(),
  listReviewQueue: vi.fn(),
  listContributors: vi.fn(),
}))
vi.mock("@/lib/server/menu-photos", async () => {
  const validate = await import("@/lib/server/menu-photos/validate")
  return { ...reads, isQueueStatus: validate.isQueueStatus }
})

import { showsPhotoOnlySections } from "@/app/manager/review/_shared/mode"
import { ReviewBody } from "@/app/manager/review/_shared/review-page"
import { availableActions } from "@/components/nabalens/manager/review/card-model"
import { NeedsLabelList } from "@/components/nabalens/manager/review/inbox-needs-label"
import { ReviewActions } from "@/components/nabalens/manager/review/review-actions"
import { ReviewCard } from "@/components/nabalens/manager/review/review-card"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import type { QueueCard } from "@/lib/server/menu-photos/types"

afterEach(cleanup)

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"

function unlabelled(over: Partial<QueueCard> = {}): QueueCard {
  return {
    key: A,
    kind: "unlabelled",
    labelId: null,
    photoId: null,
    asset: {
      assetId: A,
      thumbnailUrl: null,
      previewUrl: null,
      width: 2000,
      height: 1500,
    },
    uploadedAt: "2026-11-01T10:00:00Z",
    labelledAt: null,
    contributor: { id: B, name: "Priya", status: "here", canFollowUp: true },
    isSelf: false,
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
    itemRevision: 1,
    groupCount: 0,
    mediaType: "image",
    ...over,
  }
}

function renderCard(card: QueueCard) {
  return render(
    <ReviewCard
      card={card}
      scope={{ kind: "manager" }}
      now="2026-11-18T10:00:00Z"
      actions={
        <ReviewActions
          card={card}
          busy={false}
          pending={null}
          onAction={() => {}}
        />
      }
      onOpenPreview={() => {}}
      onRefresh={() => {}}
    />
  )
}

describe("W1: a Needs label video", () => {
  it("offers no dish pick; a photo still does", () => {
    expect(availableActions(unlabelled({ mediaType: "video" }))).toEqual([])
    expect(availableActions(unlabelled())).toEqual(["assign_unlabelled"])
  })

  it("says to mark it Not used from its details instead", () => {
    renderCard(unlabelled({ mediaType: "video" }))
    expect(
      screen.queryByRole("button", { name: REVIEW_COPY.chooseItem })
    ).toBeNull()
    expect(screen.getByText(REVIEW_COPY.videoNoDish)).toBeTruthy()
    expect(screen.getByRole("link", { name: /details/i })).toBeTruthy()
  })

  it("leaves a photo's card as it was", () => {
    renderCard(unlabelled())
    expect(screen.queryByText(REVIEW_COPY.videoNoDish)).toBeNull()
    expect(
      screen.getByRole("button", { name: REVIEW_COPY.chooseItem })
    ).toBeTruthy()
  })
})

describe("W2: Needs label while the menu is not ready", () => {
  it("lists the photos with the menu line under the heading", () => {
    render(
      <NeedsLabelList
        cards={[unlabelled(), unlabelled({ key: B, mediaType: "video" })]}
        note={REVIEW_COPY.needsLabelMenuNotReady}
      />
    )
    const list = screen.getByRole("region", { name: "2 photos need a label" })
    expect(
      within(list).getByText(REVIEW_COPY.needsLabelMenuNotReady)
    ).toBeTruthy()
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
  })

  it("shows nothing when none wait", () => {
    const { container } = render(
      <NeedsLabelList cards={[]} note={REVIEW_COPY.needsLabelMenuNotReady} />
    )
    expect(container.textContent).toBe("")
  })
})

describe("W4: the media filter and the photo-only sections", () => {
  it("leaves the place and amenity sections out for Videos only", () => {
    expect(showsPhotoOnlySections({ media: "video", view: "list" })).toBe(false)
    expect(showsPhotoOnlySections({ media: "photo", view: "list" })).toBe(true)
    expect(showsPhotoOnlySections({ view: "list" })).toBe(true)
  })
})

describe("W2: the list view while the menu is not ready", () => {
  const ctx = {
    actor: { profile: { id: B } },
    venueId: "00000000-0000-4000-8000-0000000000b1",
    role: "manager",
  } as never

  /** Renders a server element, awaiting async components on the way. */
  async function resolve(el: unknown): Promise<React.ReactElement> {
    let node = el as React.ReactElement<Record<string, unknown>>
    while (typeof node.type === "function") {
      const fn = node.type as (p: unknown) => unknown
      const out = await fn(node.props)
      node = out as React.ReactElement<Record<string, unknown>>
    }
    return node
  }

  function notReady(cards: QueueCard[]) {
    reads.getManagerOverview.mockResolvedValue({
      ok: true,
      overview: {
        menuState: "no_menu",
        venueName: "The Railway",
        sections: [],
        ownWaitingPhotos: 0,
      },
    })
    reads.listContributors.mockResolvedValue({ ok: true, contributors: [] })
    reads.listReviewQueue.mockResolvedValue({
      ok: true,
      items: cards,
      nextCursor: null,
    })
  }

  it("shows the menu state and, under it, the photos Overview counts", async () => {
    notReady([unlabelled()])
    const el = await resolve(
      await ReviewBody({
        ctx,
        scope: { kind: "manager" },
        search: { status: "unlabelled", media: "photo", contributor: B },
      })
    )
    expect(reads.listReviewQueue).toHaveBeenLastCalledWith(ctx, {
      status: "unlabelled",
      contributorId: B,
      mediaType: "image",
    })
    render(el)
    expect(screen.getByText(REVIEW_COPY.noMenuTitle)).toBeTruthy()
    const list = screen.getByRole("region", { name: "1 photo needs a label" })
    expect(
      within(list).getByText(REVIEW_COPY.needsLabelMenuNotReady)
    ).toBeTruthy()
  })

  // S3-R13 X1 (was: the menu state alone). The admin photo route exists
  // (S3-R11), so an admin gets the list too, linking to it.
  it("an admin gets the list too, linking to the admin photo route", async () => {
    notReady([unlabelled()])
    reads.listReviewQueue.mockClear()
    const venue = "00000000-0000-4000-8000-0000000000b1"
    const el = await resolve(
      await ReviewBody({
        ctx,
        scope: { kind: "admin", venueId: venue },
        search: {},
      })
    )
    render(el)
    expect(screen.getByText(REVIEW_COPY.noMenuTitle)).toBeTruthy()
    const list = screen.getByRole("region", { name: "1 photo needs a label" })
    const link = within(list).getByRole("link")
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`^/admin/coverage/${venue}/menu-photos/photo/`)
    )
    // The page's own queue read, then the Needs label one.
    expect(reads.listReviewQueue).toHaveBeenCalledTimes(2)
  })
})
