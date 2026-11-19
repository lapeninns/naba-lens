// @vitest-environment jsdom
// The five-tab staff app (DESIGN.md §5b, §5c, §15; D17, D18) and the routes
// it retired: Me is a hub of rows, Today confirms a sent amenity finding,
// and every old staff URL redirects to its new home.
import { cleanup, render, screen } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/me",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/components/nabalens/album/unfinished-row", () => ({
  UnfinishedRow: () => null,
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({
    id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    displayName: "TEST Anil",
    jobTitle: "Bar supervisor",
    department: "foh",
    venueId: "v1",
    venue: { id: "v1", name: "TEST Railway" },
    work: null,
  })),
  uploadBlockReason: () => null,
}))
const ACTOR = { profile: { id: "me" } }
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({ ok: true, actor: ACTOR })),
}))
const shell = vi.hoisted(() => ({
  staffShellStatus: vi.fn(async () => ({
    canManage: false,
    reviewCount: null as number | null,
    avatarUrl: null,
  })),
  ownMonth: vi.fn(async () => null),
  myUnreadNotices: vi.fn(async () => 2),
  myOtherJobsCount: vi.fn(async () => 0 as number | null),
  myWorkingList: vi.fn(async () => ({ slots: [] }) as unknown),
}))
vi.mock("@/app/staff/_shell/shell-status", () => shell)
const amenities = vi.hoisted(() => ({ getCheck: vi.fn() }))
vi.mock("@/lib/server/amenities", () => amenities)

import { sentFinding } from "@/app/staff/_shell/finding-sent"
import StaffMePage from "@/app/staff/me/page"
import RetiredPlacePage from "@/app/staff/album/[placeId]/page"
import RetiredManagePage from "@/app/staff/manage/(overview)/page"
import RetiredMenuPage from "@/app/staff/menu/page"
import RetiredStaffRoot from "@/app/staff/page"
import RetiredTasksPage from "@/app/staff/tasks/page"
import type { MediaActor } from "@/lib/server/media/types"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const href = (name: string | RegExp) =>
  screen.getByRole("link", { name }).getAttribute("href")

describe("Me is a hub of rows (DESIGN.md §5b, D17)", () => {
  it("opens month, notices, venue, settings and help; photos are a tab", async () => {
    render(await StaffMePage())
    expect(href(/^Your month/)).toBe("/staff/tasks/month")
    expect(href(/^Notices/)).toBe("/staff/notifications")
    expect(screen.getByText("2 unread")).toBeTruthy()
    expect(href(/^Colleagues' photos/)).toBe("/staff/community")
    expect(href(/^People/)).toBe("/staff/people")
    expect(href(/^Settings/)).toBe("/staff/me/settings")
    expect(href(/^Help/)).toBe("/staff/me/help")
    // My photos is its own tab (D18): Me repeats none of it.
    expect(screen.queryByRole("link", { name: /^Your photos/ })).toBeNull()
    expect(screen.queryByText(/photos? needs? you/)).toBeNull()
    expect(screen.queryByRole("link", { name: /^Manage/ })).toBeNull()
  })

  it("sends a venue manager to /manager with the review count (D3)", async () => {
    shell.staffShellStatus.mockResolvedValueOnce({
      canManage: true,
      reviewCount: 3,
      avatarUrl: null,
    })
    render(await StaffMePage())
    expect(href(/^Manage TEST Railway/)).toBe("/manager")
    expect(screen.getByText("3 photos to review")).toBeTruthy()
  })

  it("keeps Other jobs while there are some, or when they couldn't be counted", async () => {
    render(await StaffMePage())
    expect(screen.queryByRole("link", { name: /^Other jobs/ })).toBeNull()
    cleanup()
    shell.myOtherJobsCount.mockResolvedValueOnce(null)
    render(await StaffMePage())
    expect(href(/^Other jobs/)).toBe("/staff/tasks/other")
  })
})

describe("Today confirms a sent amenity finding (§6.7)", () => {
  const actor = ACTOR as unknown as MediaActor
  const sentCheck = (overrides: Record<string, unknown> = {}) => ({
    ok: true,
    detail: {
      check: {
        id: "c1",
        progress: "complete",
        answeredBy: { id: "me", displayName: "TEST Sam" },
        entry: { question: "Is there step-free access?" },
        ...overrides,
      },
    },
  })

  it("names the check once it is complete and answered by me", async () => {
    amenities.getCheck.mockResolvedValue(sentCheck())
    expect(await sentFinding(actor, { finding_sent: "c1" })).toBe(
      "Is there step-free access?"
    )
    expect(amenities.getCheck).toHaveBeenCalledWith(actor, { checkId: "c1" })
  })

  it("says only Sent, never complete, when the working list can't be read", async () => {
    amenities.getCheck.mockResolvedValue(sentCheck())
    shell.myWorkingList.mockResolvedValueOnce(undefined)
    expect(await sentFinding(actor, { finding_sent: "c1" })).toMatchObject({
      question: "Is there step-free access?",
      copy: { title: "Sent" },
    })
  })

  it.each([
    ["answered by someone else", { answeredBy: { id: "x", displayName: "X" } }],
    ["reopened since", { progress: "needs_recheck" }],
  ])("says nothing when the check was %s", async (_, overrides) => {
    amenities.getCheck.mockResolvedValue(sentCheck(overrides))
    expect(await sentFinding(actor, { finding_sent: "c1" })).toBeNull()
  })

  it("never reads a check without the parameter, and survives a failed read", async () => {
    expect(await sentFinding(actor, {})).toBeNull()
    expect(amenities.getCheck).not.toHaveBeenCalled()
    amenities.getCheck.mockRejectedValue(new Error("down"))
    expect(await sentFinding(actor, { finding_sent: "c1" })).toBeNull()
  })
})

describe("Retired staff routes redirect (DESIGN.md §15, D3, D16, D17)", () => {
  const params = <T,>(value: T) => Promise.resolve(value)

  it("/staff goes to Today, or to Settings to edit the profile", async () => {
    await expect(
      RetiredStaffRoot({ searchParams: params({}) })
    ).rejects.toThrow("NEXT_REDIRECT /staff/home")
    await expect(
      RetiredStaffRoot({ searchParams: params({ edit: "profile" }) })
    ).rejects.toThrow("NEXT_REDIRECT /staff/me/settings")
  })

  it("/staff/tasks goes to Album, keeps a place, and brings a finding to Today", async () => {
    await expect(
      RetiredTasksPage({ searchParams: params({}) })
    ).rejects.toThrow("NEXT_REDIRECT /staff/album")
    await expect(
      RetiredTasksPage({ searchParams: params({ place: "bar-1" }) })
    ).rejects.toThrow("NEXT_REDIRECT /staff/album?place=bar-1")
    await expect(
      RetiredTasksPage({ searchParams: params({ finding_sent: "c1" }) })
    ).rejects.toThrow("NEXT_REDIRECT /staff/home?finding_sent=c1")
  })

  it("Our menu, a place and Manage go to their new homes", async () => {
    expect(() => RetiredMenuPage()).toThrow("NEXT_REDIRECT /staff/album/menu")
    await expect(
      RetiredPlacePage({ params: params({ placeId: "bar-1" }) })
    ).rejects.toThrow("NEXT_REDIRECT /staff/album?place=bar-1")
    expect(() => RetiredManagePage()).toThrow("NEXT_REDIRECT /manager")
  })
})
