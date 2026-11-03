// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/_media/actions", () => ({
  logout: vi.fn(),
  deleteMedia: vi.fn(),
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
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({
    id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    displayName: "Anil Thapa",
    jobTitle: "Bar supervisor",
    department: "foh",
    venue: { id: "v1", name: "The Railway" },
    avatarPath: null,
  })),
  uploadBlockReason: () => null,
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({ ok: true, actor: {} })),
}))
vi.mock("@/lib/server/media/library", () => ({
  listOwnMedia: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })),
  avatarUrl: () => null,
}))
const grant = vi.hoisted(() => ({
  canManageVenue: vi.fn(async () => false),
}))
vi.mock("@/app/staff/can-manage", () => grant)
const coverage = vi.hoisted(() => ({
  getManagerReviewCount: vi.fn(async () => ({ ok: true, count: 3 })),
}))
vi.mock("@/lib/server/coverage", () => coverage)

import StaffPage from "@/app/staff/page"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Me: the Manage row", () => {
  it("shows a venue manager the way into Manage with the review count", async () => {
    grant.canManageVenue.mockResolvedValueOnce(true)
    render(await StaffPage())
    const row = screen.getByRole("navigation", { name: "Manage" })
    const link = within(row).getByRole("link", {
      name: "Manage The Railway, 3 photos to review",
      description: "Review, checklist, menu and team",
    })
    expect(link.getAttribute("href")).toBe("/staff/manage")
  })

  it("keeps the row without a number when the count can't be read", async () => {
    grant.canManageVenue.mockResolvedValueOnce(true)
    coverage.getManagerReviewCount.mockResolvedValueOnce({
      ok: false,
    } as never)
    render(await StaffPage())
    expect(
      screen
        .getByRole("link", {
          name: "Manage The Railway",
        })
        .getAttribute("href")
    ).toBe("/staff/manage")
  })

  it("shows plain staff no Manage row and reads no review count", async () => {
    render(await StaffPage())
    expect(screen.queryByRole("link", { name: /^Manage/ })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Manage" })).toBeNull()
    expect(coverage.getManagerReviewCount).not.toHaveBeenCalled()
  })
})
