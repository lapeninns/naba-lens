// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { monthly } from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/_media/actions", () => ({
  deleteMedia: vi.fn(),
  readDeleteEvidence: vi.fn(async () => ({ status: "missing" })),
}))
vi.mock("@/app/staff/actions", () => ({ loadMyMedia: vi.fn() }))
vi.mock("@/app/_media/media-gallery", () => ({
  MediaGallery: ({ label }: { label: string }) => (
    <section aria-label={label} />
  ),
}))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => ({}),
}))
vi.mock("@/app/_labels/label-editor-host", () => ({
  LabelEditorHost: () => null,
}))
const shell = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => {
    shell.props = props
    return <div>{children}</div>
  },
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({
    id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    displayName: "Anil Thapa",
    jobTitle: "Bar supervisor",
    department: "foh",
    venueId: "v1",
    venue: { id: "v1", name: "The Railway" },
    avatarPath: null,
  })),
  uploadBlockReason: () => blocked.reason,
}))
const blocked = vi.hoisted(() => ({
  reason: null as null | "not_staff" | "no_venue" | "venue_inactive",
}))
const amenities = vi.hoisted(() => ({
  getMyAmenityTasks: vi.fn(async () => ({ ok: true, tasks: [] as unknown[] })),
}))
vi.mock("@/lib/server/amenities", () => amenities)
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: {
    getWorkingList: async () => ({ ok: true, view: null }),
    listMyRechecks: async () => ({ ok: true, tasks: [] }),
    listMyFindings: async () => ({ ok: false }),
  },
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({
    ok: true,
    actor: { profile: { id: "7c2e1a90", venueId: "v1" } },
  })),
}))
vi.mock("@/lib/server/media/library", () => ({
  listOwnMedia: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })),
  avatarUrl: () => null,
}))
vi.mock("@/app/staff/can-manage", () => ({
  canManageVenue: vi.fn(async () => false),
}))
const coverage = vi.hoisted(() => ({
  getMyTasks: vi.fn(),
  getManagerReviewCount: vi.fn(async () => ({ ok: true, count: 0 })),
}))
vi.mock("@/lib/server/coverage", () => coverage)

import StaffPage from "@/app/staff/page"

beforeEach(() => {
  blocked.reason = null
  coverage.getMyTasks.mockResolvedValue({
    ok: true,
    tasks: { monthly: monthly(), assignments: [] },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  shell.props = null
})

describe("Me on the Album layout (proposal §7.6)", () => {
  it("shows the person's own month, privately", async () => {
    render(await StaffPage())
    const month = screen
      .getByRole("heading", { name: "Your month" })
      .closest("section")!
    expect(
      within(month).getByText("Only you, your manager and admins see this.")
    ).toBeTruthy()
    expect(
      within(month).getByRole("progressbar", { name: "3 of 5 photos accepted" })
    ).toBeTruthy()
    // A 48px target (DESIGN.md §8, revb should-fix 8).
    expect(
      within(month).getByRole("link", { name: "See your month" }).className
    ).toContain("min-h-12")
  })

  it("keeps the month card when the month can't be read", async () => {
    coverage.getMyTasks.mockRejectedValueOnce(new Error("down"))
    render(await StaffPage())
    expect(screen.getByRole("heading", { name: "Your month" })).toBeTruthy()
    expect(
      screen.getByText("There's no photo target for you this month.")
    ).toBeTruthy()
  })

  it("lists Photos and People, which left the tab bar", async () => {
    render(await StaffPage())
    const rows = within(screen.getByRole("navigation", { name: "Your work" }))
    expect(
      rows.getByRole("link", { name: /^Photos/ }).getAttribute("href")
    ).toBe("/staff/community")
    expect(
      rows.getByRole("link", { name: /^People/ }).getAttribute("href")
    ).toBe("/staff/people")
    // Album's three tabs are the only staff shell: no prop chooses them.
    expect(shell.props).not.toHaveProperty("album")
  })

  it("lists Other jobs when jobs wait on the person (revb B2)", async () => {
    amenities.getMyAmenityTasks.mockResolvedValueOnce({
      ok: true,
      tasks: [{ id: "c1" }, { id: "c2" }],
    })
    render(await StaffPage())
    const rows = within(screen.getByRole("navigation", { name: "Your work" }))
    const link = rows.getByRole("link", { name: /^Other jobs/ })
    expect(link.getAttribute("href")).toBe("/staff/tasks/other")
    expect(link.textContent).toContain("2 jobs")
  })

  it("leaves Other jobs out when there are none, and keeps it when unread", async () => {
    render(await StaffPage())
    expect(screen.queryByRole("link", { name: /^Other jobs/ })).toBeNull()
    cleanup()
    amenities.getMyAmenityTasks.mockResolvedValueOnce({ ok: false } as never)
    render(await StaffPage())
    expect(
      screen.getByRole("link", { name: /^Other jobs/ }).textContent
    ).toContain("We couldn't count them")
  })

  it.each(["not_staff", "no_venue", "venue_inactive"] as const)(
    "says why adding is paused in Album's words, never upload (%s)",
    async (reason) => {
      blocked.reason = reason
      render(await StaffPage())
      const { ADD_BLOCKED } = await import("@/app/staff/add-blocked")
      expect(screen.getAllByText(ADD_BLOCKED[reason]).length).toBeGreaterThan(0)
      expect(ADD_BLOCKED[reason]).toMatch(/add (any|photos)/)
      expect(document.body.textContent).not.toMatch(/upload/i)
    }
  )

  it("is titled Me", async () => {
    const { metadata } = await import("@/app/staff/page")
    expect(metadata.title).toBe("Me")
  })

  it("ranks nobody on Me", async () => {
    render(await StaffPage())
    expect(document.body.textContent).not.toMatch(
      /rank|leaderboard|top contributor|than your colleagues/i
    )
  })
})
