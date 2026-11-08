// @vitest-environment jsdom
// "Sent for {month}" never presents the newest 100 photos as the whole month.
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { submission, tasksView } from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock("@/app/staff/tasks/task-submit", () => ({ TaskSubmit: () => null }))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({ id: "me", avatarPath: null })),
}))
vi.mock("@/lib/server/media/library", () => ({ avatarUrl: () => null }))
vi.mock("@/lib/server/amenities", () => ({
  getMyAmenityTasks: vi.fn(async () => ({ ok: true, tasks: [] })),
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(async () => ({ ok: true, actor: {} })),
  getCoverageScope: vi.fn(async () => ({ ok: false })),
  getManagerReviewCount: vi.fn(),
  getMyTasks: vi.fn(),
  getMyMonth: vi.fn(),
  listMySubmittablePhotos: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)

import MonthPage from "@/app/staff/tasks/month/page"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function pastMonth(sent: number, more: boolean) {
  coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
  coverage.getMyMonth.mockResolvedValue({
    ok: true,
    more,
    month: {
      period: tasksView().period,
      monthly: [],
      submissions: Array.from({ length: sent }, (_, i) =>
        submission({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        })
      ),
    },
  })
  render(
    await MonthPage({ searchParams: Promise.resolve({ period: "2026-01" }) })
  )
  return screen.getByRole("region", { name: /^Sent for January/ })
}

describe("Monthly photos: sent total", () => {
  it("says 100+ and points to every photo on Me when more were sent", async () => {
    const sent = await pastMonth(100, true)
    expect(within(sent).getByText("100+ photos")).toBeTruthy()
    expect(
      within(sent).getByRole("link", { name: "Me" }).getAttribute("href")
    ).toBe("/staff")
  })

  it("gives the exact count when everything sent is shown", async () => {
    const sent = await pastMonth(100, false)
    expect(within(sent).getByText("100 photos")).toBeTruthy()
    expect(within(sent).queryByRole("link", { name: "Me" })).toBeNull()
  })
})
