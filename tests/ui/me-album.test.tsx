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
  uploadBlockReason: () => null,
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
  coverage.getMyTasks.mockResolvedValue({
    ok: true,
    tasks: { monthly: monthly() },
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
    vi.stubEnv("NABALENS_HOME_LAYOUT", "album")
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
    expect(
      within(month).getByRole("link", { name: "See your month" })
    ).toBeTruthy()
  })

  it("keeps the month card when the month can't be read", async () => {
    vi.stubEnv("NABALENS_HOME_LAYOUT", "album")
    coverage.getMyTasks.mockRejectedValueOnce(new Error("down"))
    render(await StaffPage())
    expect(screen.getByRole("heading", { name: "Your month" })).toBeTruthy()
    expect(
      screen.getByText("There's no photo target for you this month.")
    ).toBeTruthy()
  })

  it("lists Photos and People, which left the tab bar", async () => {
    vi.stubEnv("NABALENS_HOME_LAYOUT", "album")
    render(await StaffPage())
    const rows = within(screen.getByRole("navigation", { name: "Your work" }))
    expect(
      rows.getByRole("link", { name: /^Photos/ }).getAttribute("href")
    ).toBe("/staff/community")
    expect(
      rows.getByRole("link", { name: /^People/ }).getAttribute("href")
    ).toBe("/staff/people")
    expect(shell.props?.album).toBe(true)
  })

  it("ranks nobody on Me", async () => {
    vi.stubEnv("NABALENS_HOME_LAYOUT", "album")
    render(await StaffPage())
    expect(document.body.textContent).not.toMatch(
      /rank|leaderboard|top contributor|than your colleagues/i
    )
  })
})
