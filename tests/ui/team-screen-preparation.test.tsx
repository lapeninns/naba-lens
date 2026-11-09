// @vitest-environment jsdom
// The Team page's "isn't prepared yet" notice, its Prepare action and the
// roster's hint follow the month's preparation status, as the overview does.
// Missing targets don't decide it: a manager can set every target before
// preparing, and a new starter can lack one after it.
import { cleanup, render, screen } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { periodKeyOf, periodView } from "@/lib/server/coverage/time"

import { monthly } from "./coverage-fixtures"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/staff/manage/team",
  useSearchParams: () => new URLSearchParams(),
}))

const coverage = vi.hoisted(() => ({
  getVenueRoster: vi.fn(),
  getStaffMonth: vi.fn(),
  getPreparationStatus: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
vi.mock("@/app/staff/manage/_shared/context", () => ({ unexpected: vi.fn() }))
vi.mock("@/app/staff/manage/_shared/frame", () => ({
  ManageFrame: ({
    actions,
    children,
  }: {
    actions?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  RefusedPage: () => null,
  isRefusal: () => false,
}))
vi.mock("@/app/staff/manage/_shared/controls", () => ({
  PrepareMonthControl: ({ available }: { available: boolean }) =>
    available ? <button type="button">Prepare this month</button> : null,
  TeamRosterControl: ({ unprepared }: { unprepared?: boolean }) => (
    <p data-testid="roster">{`roster unprepared: ${String(unprepared)}`}</p>
  ),
  ReviewQueueControl: () => null,
}))

import { TeamScreen } from "@/app/staff/manage/_shared/screens/team"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const current = periodKeyOf(new Date())
const ctx = {
  mode: "manager",
  venueId: "v-1",
  venue: { id: "v-1", name: "TEST Venue" },
  basePath: "/staff/manage",
  actor: {},
  coverage: null,
} as unknown as Parameters<typeof TeamScreen>[0]["ctx"]

const withTarget = monthly()
const noTarget = monthly({
  targetId: null,
  revision: null,
  status: "needs_setup",
  setupMissing: ["target"],
  targetCount: null,
  source: null,
  due: null,
})

async function team(
  rows: ReturnType<typeof monthly>[],
  status:
    | { ok: true; status: { lastSuccessAt: string | null } | null }
    | {
        ok: false
        code: "unavailable"
        status: 503
        message: string
      }
) {
  coverage.getVenueRoster.mockResolvedValue({
    ok: true,
    period: periodView(current),
    roster: rows,
  })
  coverage.getPreparationStatus.mockResolvedValue(status)
  render(await TeamScreen({ ctx, search: {} }))
}

describe("Team page preparation state", () => {
  it("every target set but the month not prepared: notice and Prepare stay", async () => {
    await team([withTarget], { ok: true, status: { lastSuccessAt: null } })
    expect(screen.getByText(/isn't prepared yet/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Prepare this month" })
    ).toBeTruthy()
    expect(screen.getByTestId("roster").textContent).toBe(
      "roster unprepared: true"
    )
  })

  it("shows combined targets without a legacy photo preparation prompt", async () => {
    await team(
      [
        monthly({
          targetId: null,
          targetCount: 5,
          completionProgress: { total: 0, menuItems: 0, amenityChecks: 0 },
        }),
      ],
      { ok: true, status: { lastSuccessAt: null } }
    )
    expect(screen.queryByText(/targets haven't been copied yet/)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Prepare this month" })
    ).toBeNull()
    expect(screen.getByTestId("roster").textContent).toBe(
      "roster unprepared: false"
    )
  })

  it("prepared, with a new starter lacking a target: no notice, no Prepare", async () => {
    await team([withTarget, noTarget], {
      ok: true,
      status: { lastSuccessAt: "2026-11-01T06:00:00.000Z" },
    })
    expect(screen.queryByText(/isn't prepared yet/)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Prepare this month" })
    ).toBeNull()
    expect(screen.getByTestId("roster").textContent).toBe(
      "roster unprepared: false"
    )
  })

  it("falls back to missing targets when the status can't be read", async () => {
    await team([noTarget], {
      ok: false,
      code: "unavailable",
      status: 503,
      message: "Try again shortly.",
    })
    expect(screen.getByText(/isn't prepared yet/)).toBeTruthy()
    expect(coverage.getPreparationStatus).toHaveBeenCalledTimes(1)
  })
})
