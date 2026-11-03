// @vitest-environment jsdom
// A7's month section: one person's target at their venue, counted apart from
// the venue's checklist, and never complete while setup is missing.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { StaffMonth } from "@/app/admin/staff/[id]/staff-month"
import type { MonthlyProgress } from "@/lib/server/coverage/types"

afterEach(cleanup)

function month(extra: Partial<MonthlyProgress> = {}): MonthlyProgress {
  return {
    targetId: "8d2f0b65-4c3a-4e71-8f6d-2a9ebb513d33",
    period: {
      key: "2026-11",
      label: "November 2026",
      startsAt: "2026-11-01T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
      isCurrent: true,
      timeZone: "Europe/London",
    },
    venue: { id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11", name: "TEST Railway" },
    person: {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Priya Gurung",
      avatarUrl: null,
      department: "boh",
      jobTitle: null,
      active: true,
    },
    isCurrentMember: true,
    isManager: false,
    status: "set",
    setupMissing: [],
    targetCount: 5,
    source: "manager",
    revision: 1,
    accepted: 2,
    pending: 1,
    needsAnotherPhoto: 0,
    lateAcceptances: 0,
    evidenceRemoved: 0,
    complete: false,
    due: null,
    ...extra,
  } as MonthlyProgress
}

describe("staff member's month", () => {
  it("shows accepted, waiting and still to take at the venue", () => {
    render(<StaffMonth monthly={month()} firstName="Priya" inactive={false} />)
    expect(screen.getByRole("heading", { name: "Priya's month" })).toBeTruthy()
    expect(screen.getByText("November 2026")).toBeTruthy()
    expect(screen.getByText("of 5 accepted")).toBeTruthy()
    expect(screen.getByText("1 waiting for review")).toBeTruthy()
    expect(screen.getByText("2 to take")).toBeTruthy()
    expect(
      screen.getByText(
        "Counts only Priya's photos at TEST Railway this UK month. It's never added to the venue's checklist."
      )
    ).toBeTruthy()
  })

  it("says Needs setup instead of a target that isn't set", () => {
    render(
      <StaffMonth
        monthly={month({
          status: "needs_setup",
          setupMissing: ["target"],
          targetCount: null,
        })}
        firstName="Priya"
        inactive={false}
      />
    )
    expect(screen.getByText("Needs setup")).toBeTruthy()
    expect(screen.queryByText(/to take/)).toBeNull()
    expect(screen.queryByText(/of \d+ accepted/)).toBeNull()
  })

  it("names the month and venue for an inactive account", () => {
    render(<StaffMonth monthly={month()} firstName="Tom" inactive />)
    expect(
      screen.getByRole("heading", { name: "November 2026 at TEST Railway" })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Tom's open assignments closed on deactivation; those items show Needs reassignment."
      )
    ).toBeTruthy()
  })
})
