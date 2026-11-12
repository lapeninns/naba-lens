// @vitest-environment jsdom
// Legacy /staff/manage keeps the same staff shell status as every other staff
// page, read alongside the page's own reads rather than after them.
import { cleanup, render } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/staff/manage",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
const appShell = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => {
    appShell.props = props
    return <div>{children}</div>
  },
}))
const PROFILE = { id: "me", displayName: "TEST Morgan" }
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => PROFILE),
  requireActiveAdmin: vi.fn(),
}))
vi.mock("@/lib/auth/manager", () => ({ requireManagerVenue: vi.fn() }))
vi.mock("@/lib/server/media/context", () => ({ getMediaActor: vi.fn() }))
const VENUE = { id: "v1", name: "TEST Inn" }
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(async () => ({ ok: true, actor: { profile: {} } })),
  getCoverageScope: vi.fn(),
  getVenueCoverage: vi.fn(),
}))
vi.mock("@/lib/server/coverage/context", () => coverage)
vi.mock("@/lib/server/coverage/venue", () => coverage)
const STATUS = {
  canManage: true,
  todoCount: 2,
  reviewCount: 9,
  avatarUrl: "/api/avatars/me",
}
const status = vi.hoisted(() => ({
  release: (() => {}) as (value: unknown) => void,
  currentStaffShell: vi.fn(),
}))
vi.mock("@/app/staff/_shell/shell-status", () => ({
  currentStaffShell: status.currentStaffShell,
}))

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { ManageFrame } from "@/app/staff/manage/_shared/frame"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function heldStatus() {
  status.currentStaffShell.mockImplementation(
    () =>
      new Promise((resolve) => {
        status.release = resolve
      })
  )
}

// Unmount between tests: vitest globals are off, so RTL does not clean up
// itself, and a tree left mounted can commit after jsdom has gone (hosted
// run 43072631782: "window is not defined" from React's scheduler).
afterEach(cleanup)
afterEach(() => {
  vi.clearAllMocks()
  appShell.props = null
})

const CTX = {
  mode: "manager" as const,
  actor: { profile: {} } as never,
  viewerId: "me",
  viewerName: "TEST Morgan",
  venue: VENUE,
  venueId: VENUE.id,
  basePath: "/staff/manage",
  coverage: null,
}

describe("legacy Manage shell", () => {
  it("starts the shell status before the access check finishes", async () => {
    heldStatus()
    let scoped!: (value: unknown) => void
    coverage.getCoverageScope.mockReturnValue(
      new Promise((resolve) => {
        scoped = resolve
      })
    )
    const access = managerAccess()
    await tick()
    expect(status.currentStaffShell).toHaveBeenCalled()
    scoped({ ok: true, scope: { managedVenue: VENUE } })
    expect(await access).toMatchObject({ ok: true })
  })

  it("reads the venue's count alongside the shell status and shows both", async () => {
    heldStatus()
    coverage.getVenueCoverage.mockResolvedValue({
      ok: true,
      coverage: { summary: { pendingReview: 4 } },
    })
    const frame = ManageFrame({
      ctx: CTX,
      section: "overview",
      title: "Overview",
      children: null,
    })
    await tick()
    expect(coverage.getVenueCoverage).toHaveBeenCalled()
    status.release(STATUS)
    render(await frame)
    // The frame's own count (just read for this venue) wins; the Home badge
    // and avatar come from the shared status.
    expect(appShell.props).toMatchObject({
      variant: "staff",
      active: "manage",
      canManage: true,
      reviewCount: 4,
      todoCount: 2,
      avatarUrl: "/api/avatars/me",
    })
  })
})
