// @vitest-environment jsdom
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
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/manager/review/contributors/x",
  notFound: nav.notFound,
}))

const actions = vi.hoisted(() => ({
  decideMenuPhotoAction: vi.fn(),
  loadReviewPageAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))
vi.mock("@/app/manager/actions", () => actions)

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

import { ContributorBody } from "@/app/manager/review/_shared/review-page"
import { ContributorHeader } from "@/components/nabalens/manager/review/contributor-header"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewScreen } from "@/components/nabalens/manager/review/review-screen"
import type {
  Contributor,
  ContributorStatus,
  QueueCard,
} from "@/lib/server/menu-photos/types"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

afterEach(cleanup)
beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

const STAFF = "00000000-0000-4000-8000-0000000000f1"
const OTHER = "00000000-0000-4000-8000-0000000000f2"
const ME = "00000000-0000-4000-8000-0000000000f9"
const SOUP = "00000000-0000-4000-8000-0000000000c1"

function contributor(over: Partial<Contributor> = {}): Contributor {
  return {
    id: STAFF,
    name: "TEST Sam Lee",
    status: "here",
    labelledPhotos: 4,
    acceptedItems: 1,
    openFollowUps: 1,
    lastUploadAt: null,
    ...over,
  }
}

function card(over: Partial<QueueCard> = {}): QueueCard {
  return {
    key: "00000000-0000-4000-8000-000000000011",
    kind: "labelled",
    labelId: "00000000-0000-4000-8000-000000000011",
    photoId: null,
    asset: {
      assetId: "00000000-0000-4000-8000-0000000000a1",
      thumbnailUrl: null,
      previewUrl: null,
      width: null,
      height: null,
    },
    uploadedAt: "2026-11-04T12:00:00.000Z",
    labelledAt: null,
    contributor: {
      id: STAFF,
      name: "TEST Sam Lee",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: SOUP,
      name: "Soup",
      sectionId: "00000000-0000-4000-8000-000000000005",
      sectionName: "Starters",
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

describe("ContributorHeader", () => {
  it.each([
    ["here", "At this venue"],
    ["moved", "Moved venue"],
    ["left", "Left"],
    ["manager", "Manager account"],
  ] as [ContributorStatus, string][])("shows the %s chip", (status, word) => {
    render(
      <ContributorHeader
        contributor={contributor({ status })}
        venueName="The Railway"
      />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "TEST Sam Lee" })
    ).toBeTruthy()
    expect(screen.getByText("Contributions at The Railway")).toBeTruthy()
    expect(screen.getByText(word)).toBeTruthy()
    expect(
      screen.getByText("4 labelled photos · 1 item accepted · 1 open request")
    ).toBeTruthy()
  })

  it("is a section heading under an admin page frame", () => {
    render(
      <ContributorHeader
        contributor={contributor()}
        venueName="The Railway"
        level="section"
      />
    )
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull()
    expect(
      screen.getByRole("heading", { level: 2, name: "TEST Sam Lee" })
    ).toBeTruthy()
  })
})

describe("contributor list", () => {
  const view = {
    status: "all" as const,
    sectionId: null,
    contributorId: STAFF,
    itemId: null,
  }

  function renderFixed() {
    return render(
      <ReviewScreen
        scope={{ kind: "manager" }}
        view={view}
        initial={{ items: [card()], nextCursor: "next" }}
        sections={[]}
        contributors={[{ id: OTHER, name: "TEST Ana Diaz" }]}
        showMine={false}
        venueName="The Railway"
        now="2026-11-07T12:00:00.000Z"
        fixedContributorId={STAFF}
        defaultStatus="all"
      />
    )
  }

  it("is fixed to the contributor: no contributor filter, status in their URL", async () => {
    const user = userEvent.setup()
    renderFixed()
    expect(
      screen.queryByRole("combobox", { name: REVIEW_COPY.contributorLabel })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "All", pressed: true })
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Waiting" }))
    expect(nav.replace).toHaveBeenCalledWith(
      `/manager/review/contributors/${STAFF}?status=pending`,
      { scroll: false }
    )
  })

  it("loads more of the contributor's photos only, and keeps other contributors' fresh cards out", async () => {
    const user = userEvent.setup()
    actions.loadReviewPageAction.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    renderFixed()
    await user.click(screen.getByRole("button", { name: "Load more" }))
    expect(actions.loadReviewPageAction.mock.calls[0][0]).toMatchObject({
      status: "all",
      contributorId: STAFF,
    })
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      outcome: {
        action: "accept",
        itemId: SOUP,
        itemRevision: 4,
        replayed: false,
        itemCovered: true,
        preferredAssetId: null,
        cards: [
          card({
            key: "00000000-0000-4000-8000-000000000099",
            contributor: { ...card().contributor, id: OTHER, name: "TEST Ana" },
          }),
        ],
      },
    })
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await screen.findByText("Accepted for Soup. Soup now has a photo.")
    const list = screen.getByRole("list", { name: REVIEW_COPY.listLabel })
    expect(within(list).queryByText("TEST Ana")).toBeNull()
  })
})

describe("ContributorBody", () => {
  const ctx = {
    actor: { profile: { id: ME } },
    venueId: "00000000-0000-4000-8000-0000000000b1",
    role: "manager",
  } as unknown as ManagerPhotoCtx

  it("is not found for the caller's own id or a non-uuid", async () => {
    await expect(
      ContributorBody({
        ctx,
        scope: { kind: "manager" },
        staffId: ME,
        search: {},
      })
    ).rejects.toThrow("NEXT_NOT_FOUND")
    await expect(
      ContributorBody({
        ctx,
        scope: { kind: "manager" },
        staffId: "nope",
        search: {},
      })
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(reads.getContributor).not.toHaveBeenCalled()
  })

  it("is not found when the contributor read returns null", async () => {
    reads.getContributor.mockResolvedValue({ ok: true, contributor: null })
    reads.getManagerOverview.mockResolvedValue({
      ok: true,
      overview: { menuState: "ready", venueName: "The Railway", sections: [] },
    })
    reads.listReviewQueue.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    await expect(
      ContributorBody({
        ctx,
        scope: { kind: "manager" },
        staffId: STAFF,
        search: {},
      })
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("reads the queue fixed to the contributor, status All by default", async () => {
    reads.getContributor.mockResolvedValue({
      ok: true,
      contributor: contributor({ status: "moved" }),
    })
    reads.getManagerOverview.mockResolvedValue({
      ok: true,
      overview: { menuState: "ready", venueName: "The Railway", sections: [] },
    })
    reads.listReviewQueue.mockResolvedValue({
      ok: true,
      items: [card()],
      nextCursor: null,
    })
    const el = await ContributorBody({
      ctx,
      scope: { kind: "manager" },
      staffId: STAFF,
      search: { contributor: OTHER, status: "bogus" },
    })
    expect(reads.listReviewQueue).toHaveBeenCalledWith(ctx, {
      status: "all",
      sectionId: undefined,
      contributorId: STAFF,
      itemId: undefined,
    })
    render(el)
    expect(screen.getByText("Moved venue")).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: REVIEW_COPY.accept })
      ).toBeTruthy()
    )
  })
})
