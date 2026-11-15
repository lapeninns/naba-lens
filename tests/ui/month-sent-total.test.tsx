// @vitest-environment jsdom
// "Photos in {month}" never presents the newest 100 photos as the whole
// month. The list is my_month_photos (G-2): every state the month counts.
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MonthPhotoView } from "@/lib/server/coverage/types"

import { tasksView } from "./tasks-fixtures"

function photo(i: number, extra: Partial<MonthPhotoView> = {}): MonthPhotoView {
  const assetId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
  return {
    assetId,
    venueId: "00000000-0000-4000-8000-0000000000a1",
    state: "waiting",
    uploadedAt: "2026-01-10T10:00:00.000Z",
    itemNames: [],
    sent: { requirementTitle: null },
    submissionId: null,
    reason: null,
    decision: null,
    asset: {
      id: assetId,
      thumbnailUrl: null,
      previewUrl: null,
      width: null,
      height: null,
      available: true,
    },
    ...extra,
  }
}

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

async function pastMonth(
  count: number,
  more: boolean,
  photos: MonthPhotoView[] = Array.from({ length: count }, (_, i) => photo(i))
) {
  coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
  coverage.getMyMonth.mockResolvedValue({
    ok: true,
    more,
    month: {
      period: tasksView().period,
      monthly: [],
      photos,
    },
  })
  render(
    await MonthPage({ searchParams: Promise.resolve({ period: "2026-01" }) })
  )
  return screen.getByRole("region", { name: /^Photos in January/ })
}

describe("Monthly photos: the month list", () => {
  it("says 100+ and points to every photo on Me when more were sent", async () => {
    const sent = await pastMonth(100, true)
    expect(within(sent).getByText("100+ photos")).toBeTruthy()
    expect(
      within(sent).getByRole("link", { name: "Me" }).getAttribute("href")
    ).toBe("/staff")
  })

  it("gives the exact count when everything is shown", async () => {
    const sent = await pastMonth(100, false)
    expect(within(sent).getByText("100 photos")).toBeTruthy()
    expect(within(sent).queryByRole("link", { name: "Me" })).toBeNull()
  })

  it("lists labelled and sent photos with their state words", async () => {
    const list = await pastMonth(3, false, [
      photo(1, {
        state: "accepted",
        itemNames: ["Dal"],
        sent: null,
        decision: {
          decidedAt: "2026-01-12T10:00:00.000Z",
          decidedBy: { id: "m", displayName: "Sam" },
        },
      }),
      photo(2, {
        state: "needs_another_photo",
        itemNames: ["Lassi"],
        reason: "Too dark",
      }),
      photo(3, { state: "waiting", sent: { requirementTitle: "Garden" } }),
    ])
    const rows = within(list).getAllByRole("listitem")
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText("Dal")).toBeTruthy()
    expect(within(rows[0]!).getByText("Accepted")).toBeTruthy()
    expect(within(rows[0]!).getByText(/Accepted by Sam on/)).toBeTruthy()
    expect(within(rows[1]!).getByText("Needs another photo")).toBeTruthy()
    expect(within(rows[1]!).getByText("Too dark")).toBeTruthy()
    expect(within(rows[2]!).getByText("Garden")).toBeTruthy()
    expect(within(rows[2]!).getByText("Waiting for review")).toBeTruthy()
  })
})
