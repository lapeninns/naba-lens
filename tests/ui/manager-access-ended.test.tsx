// @vitest-environment jsdom
// A manager whose access ends mid-session (grant revoked, venue moved or
// closed, account changed or deactivated): the workspace read earlier in the
// render can still say available, but every refused read after it goes to
// Overview's Venue access unavailable instead of the error boundary, and no
// page renders data from the refused read.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/manager",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

const auth = vi.hoisted(() => ({
  requireManagerVenue: vi.fn(),
  getManagerWorkspace: vi.fn(),
}))
vi.mock("@/lib/auth/manager", () => auth)

const photos = vi.hoisted(() => ({
  getManagerPhotoCtx: vi.fn(),
  getManagerOverview: vi.fn(),
  listContributors: vi.fn(),
  listReviewQueue: vi.fn(),
  getContributor: vi.fn(),
  getManagerItem: vi.fn(),
  listItemEvents: vi.fn(),
  listManagerMenuItems: vi.fn(),
  isQueueStatus: (s: unknown) => s === "pending" || s === "all",
}))
vi.mock("@/lib/server/menu-photos", () => photos)

vi.mock("@/app/manager/actions", () => ({
  decideMenuPhotoAction: vi.fn(),
  loadReviewPageAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))

import ManagerMenuItemPage from "@/app/manager/menu/[itemId]/page"
import ManagerMenuPage from "@/app/manager/menu/page"
import ManagerOverviewPage from "@/app/manager/page"
import {
  ContributorBody,
  ReviewBody,
} from "@/app/manager/review/_shared/review-page"
import ManagerContributorPage from "@/app/manager/review/contributors/[staffId]/page"
import ManagerReviewPage from "@/app/manager/review/page"

const VENUE = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "The Railway",
}
const ITEM = "00000000-0000-4000-8000-0000000000c1"
const STAFF = "00000000-0000-4000-8000-0000000000f1"
const ctx = {
  actor: { profile: { id: "00000000-0000-4000-8000-0000000000e1" } },
  venueId: VENUE.id,
  role: "manager",
}
const workspace = {
  status: "available",
  profile: { id: ctx.actor.profile.id, displayName: "Mina" },
  venue: VENUE,
  grant: { id: "g1", venueId: VENUE.id },
}
const refused = (code: string) => ({
  ok: false,
  code,
  status: code === "unauthenticated" ? 401 : 403,
  message: "Refused.",
})
const search = () => Promise.resolve({})

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  auth.requireManagerVenue.mockResolvedValue(workspace)
  auth.getManagerWorkspace.mockResolvedValue(workspace)
  photos.getManagerPhotoCtx.mockResolvedValue({ ok: true, ctx })
  photos.getManagerOverview.mockResolvedValue({
    ok: true,
    overview: { menuState: "ready", sections: [], ownWaitingPhotos: 0 },
  })
  photos.listContributors.mockResolvedValue({ ok: true, contributors: [] })
  photos.listReviewQueue.mockResolvedValue({
    ok: true,
    items: [],
    nextCursor: null,
  })
  photos.listItemEvents.mockResolvedValue({
    ok: true,
    items: [],
    nextCursor: null,
  })
})

const REFUSALS = ["not_permitted", "wrong_venue", "account_inactive"]

describe("Review and the contributor page", () => {
  it.each(REFUSALS)(
    "a refused photo scope (%s) goes to Overview, not the error boundary",
    async (code) => {
      photos.getManagerPhotoCtx.mockResolvedValue(refused(code))
      await expect(
        ManagerReviewPage({ searchParams: search() })
      ).rejects.toThrow("NEXT_REDIRECT /manager")
      await expect(
        ManagerContributorPage({
          params: Promise.resolve({ staffId: STAFF }),
          searchParams: search(),
        })
      ).rejects.toThrow("NEXT_REDIRECT /manager")
      expect(photos.listReviewQueue).not.toHaveBeenCalled()
    }
  )

  it("an expired session goes to sign in", async () => {
    photos.getManagerPhotoCtx.mockResolvedValue(refused("unauthenticated"))
    await expect(ManagerReviewPage({ searchParams: search() })).rejects.toThrow(
      "NEXT_REDIRECT /login"
    )
  })

  it("a service failure is still the error boundary's", async () => {
    photos.getManagerPhotoCtx.mockResolvedValue(refused("unavailable"))
    await expect(ManagerReviewPage({ searchParams: search() })).rejects.toThrow(
      "Could not load Review: unavailable"
    )
  })

  it.each(REFUSALS)(
    "a queue read refused (%s) after the scope was granted goes to Overview",
    async (code) => {
      photos.listReviewQueue.mockResolvedValue(refused(code))
      await expect(
        ReviewBody({
          ctx: ctx as never,
          scope: { kind: "manager" },
          search: {},
        })
      ).rejects.toThrow("NEXT_REDIRECT /manager")
    }
  )

  it("a refused contributor read goes to Overview", async () => {
    photos.getContributor.mockResolvedValue(refused("not_permitted"))
    await expect(
      ContributorBody({
        ctx: ctx as never,
        scope: { kind: "manager" },
        staffId: STAFF,
        search: {},
      })
    ).rejects.toThrow("NEXT_REDIRECT /manager")
  })

  it("keeps the admin Review's not found and error boundary", async () => {
    const admin = { kind: "admin", venueId: VENUE.id } as const
    photos.listReviewQueue.mockResolvedValue(refused("wrong_venue"))
    await expect(
      ReviewBody({ ctx: ctx as never, scope: admin, search: {} })
    ).rejects.toThrow("NEXT_NOT_FOUND")
    photos.listReviewQueue.mockResolvedValue(refused("not_permitted"))
    await expect(
      ReviewBody({ ctx: ctx as never, scope: admin, search: {} })
    ).rejects.toThrow("Could not load menu photos: not_permitted")
  })
})

describe("Menu and a menu item", () => {
  it.each(REFUSALS)(
    "a refused Menu read (%s) goes to Overview",
    async (code) => {
      photos.getManagerOverview.mockResolvedValue(refused(code))
      await expect(
        ManagerMenuPage({ searchParams: Promise.resolve({}) })
      ).rejects.toThrow("NEXT_REDIRECT /manager")
      expect(photos.listManagerMenuItems).not.toHaveBeenCalled()
    }
  )

  it.each(REFUSALS)(
    "a refused item read (%s) goes to Overview",
    async (code) => {
      photos.getManagerItem.mockResolvedValue(refused(code))
      await expect(
        ManagerMenuItemPage({
          params: Promise.resolve({ itemId: ITEM }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow("NEXT_REDIRECT /manager")
    }
  )
})

describe("Overview", () => {
  it("shows Venue access unavailable when its own read is refused, and refreshes the shell once", async () => {
    photos.getManagerOverview.mockResolvedValue(refused("not_permitted"))
    render(await ManagerOverviewPage())
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Venue access unavailable",
      })
    ).toBeTruthy()
    expect(screen.getByText("Your venue access has ended.")).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })

  it("refreshes the shell once when the workspace itself is unavailable", async () => {
    auth.getManagerWorkspace.mockResolvedValue({
      status: "unavailable",
      profile: workspace.profile,
      reason: "venue_inactive",
    })
    const { rerender } = render(await ManagerOverviewPage())
    expect(screen.getByText("Your venue is not active.")).toBeTruthy()
    rerender(await ManagerOverviewPage())
    expect(nav.refresh).toHaveBeenCalledTimes(1)
    expect(photos.getManagerOverview).not.toHaveBeenCalled()
  })

  it("a service failure is still the error boundary's", async () => {
    photos.getManagerOverview.mockResolvedValue(refused("unavailable"))
    await expect(ManagerOverviewPage()).rejects.toThrow(
      "Could not load the overview: unavailable"
    )
  })
})
