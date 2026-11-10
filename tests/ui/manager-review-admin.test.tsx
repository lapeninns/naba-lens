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
}))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/admin/coverage/v/menu-photos",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

const actions = vi.hoisted(() => ({
  decideMenuPhotoAction: vi.fn(),
  loadReviewPageAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))
// Contribution sets (B02-05) are off here: the cards show as before.
vi.mock("@/app/_media/actions", () => ({
  readPhotoSets: vi.fn(async () => ({ status: "missing" })),
}))
vi.mock("@/app/manager/actions", () => actions)

const server = vi.hoisted(() => ({
  adminVenueContext: vi.fn(),
  getManagerPhotoCtx: vi.fn(),
}))
vi.mock("@/app/staff/manage/_shared/context", () => ({
  adminVenueContext: server.adminVenueContext,
}))
vi.mock("@/app/staff/manage/_shared/frame", () => ({
  ManageFrame: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/lib/server/menu-photos", async () => {
  const validate = await import("@/lib/server/menu-photos/validate")
  return {
    getManagerPhotoCtx: server.getManagerPhotoCtx,
    isQueueStatus: validate.isQueueStatus,
    getManagerOverview: vi.fn(),
    listContributors: vi.fn(),
    listReviewQueue: vi.fn(),
    getContributor: vi.fn(),
  }
})

import AdminMenuPhotosPage from "@/app/admin/coverage/[venueId]/menu-photos/page"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewScreen } from "@/components/nabalens/manager/review/review-screen"
import type { ManagerMenuItem, QueueCard } from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

const VENUE = "00000000-0000-4000-8000-0000000000b1"
const STAFF = "00000000-0000-4000-8000-0000000000f1"
const SOUP = "00000000-0000-4000-8000-0000000000c1"
const PIE = "00000000-0000-4000-8000-0000000000c2"

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
      status: "left",
      canFollowUp: false,
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

const pie: ManagerMenuItem = {
  itemId: PIE,
  name: "Pie",
  description: null,
  section: {
    id: "00000000-0000-4000-8000-000000000006",
    name: "Mains",
    kind: "food",
    position: 2,
  },
  entryPosition: 1,
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

function renderAdmin() {
  // No ReviewCountProvider: the admin layout has no review badge.
  return render(
    <ReviewScreen
      scope={{ kind: "admin", venueId: VENUE }}
      view={{
        status: "pending",
        sectionId: null,
        contributorId: null,
        itemId: null,
      }}
      initial={{ items: [card()], nextCursor: "next" }}
      sections={[]}
      contributors={[{ id: STAFF, name: "TEST Sam Lee" }]}
      showMine={false}
      venueName="The Railway"
      now="2026-11-07T12:00:00.000Z"
    />
  )
}

const ok = (itemId = SOUP) => ({
  ok: true,
  outcome: {
    action: "accept",
    itemId,
    itemRevision: 4,
    replayed: false,
    itemCovered: true,
    preferredAssetId: null,
    cards: [],
  },
})

describe("admin Review page", () => {
  it("passes the venue to every action and renders without a badge provider", async () => {
    const user = userEvent.setup()
    actions.loadReviewPageAction.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    actions.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [pie],
      nextCursor: null,
    })
    actions.decideMenuPhotoAction.mockResolvedValue(ok(PIE))
    renderAdmin()

    // Contributor links stay on the admin pages; a leaver is shown (admins only).
    expect(
      screen.getByRole("link", { name: "TEST Sam Lee" }).getAttribute("href")
    ).toBe(`/admin/coverage/${VENUE}/menu-photos/contributors/${STAFF}`)
    expect(
      screen.getByRole("link", { name: "Soup" }).getAttribute("href")
    ).toBe(`/admin/coverage/${VENUE}/menu-photos?item=${SOUP}`)

    await user.click(screen.getByRole("button", { name: "Load more" }))
    expect(actions.loadReviewPageAction.mock.calls[0][0]).toMatchObject({
      venueId: VENUE,
    })

    await user.click(screen.getByRole("button", { name: REVIEW_COPY.relink }))
    const dialog = screen.getByRole("dialog")
    await user.click(await within(dialog).findByRole("radio", { name: /Pie/ }))
    expect(actions.loadMenuItemsPageAction.mock.calls[0][0]).toMatchObject({
      venueId: VENUE,
    })
    await user.type(
      within(dialog).getByLabelText(REVIEW_COPY.relinkLabel),
      "Wrong item"
    )
    await user.click(
      within(dialog).getByRole("button", {
        name: REVIEW_COPY.confirmFor("Pie"),
      })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    expect(actions.decideMenuPhotoAction.mock.calls[0][0]).toMatchObject({
      action: "relink",
      venueId: VENUE,
    })
    expect(await screen.findByText("Moved to Pie and accepted.")).toBeTruthy()
  })

  it("asks a leaver with the won't-see copy", async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(
      screen.getByRole("button", { name: REVIEW_COPY.askAnother })
    )
    expect(
      screen.getByText(REVIEW_COPY.followUp.left("TEST Sam Lee"))
    ).toBeTruthy()
  })

  it("filters replace the admin URL", async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole("button", { name: "Accepted" }))
    expect(nav.replace).toHaveBeenCalledWith(
      `/admin/coverage/${VENUE}/menu-photos?status=accepted`,
      { scroll: false }
    )
  })

  it("opens the manager photo context for the venue in the URL", async () => {
    server.adminVenueContext.mockResolvedValue({
      venueId: VENUE,
      venue: { id: VENUE, name: "The Railway" },
      coverage: null,
    })
    const ctx = { venueId: VENUE, role: "admin" }
    server.getManagerPhotoCtx.mockResolvedValue({ ok: true, ctx })
    const page = await AdminMenuPhotosPage({
      params: Promise.resolve({ venueId: VENUE }),
      searchParams: Promise.resolve({ status: "unlabelled" }),
    })
    expect(server.adminVenueContext).toHaveBeenCalledWith(VENUE)
    expect(server.getManagerPhotoCtx).toHaveBeenCalledWith(VENUE)
    const body = (page.props as { children: React.ReactElement }).children
    expect(body.props).toMatchObject({
      ctx,
      scope: { kind: "admin", venueId: VENUE },
      search: { status: "unlabelled" },
    })
  })
})
