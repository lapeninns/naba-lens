// @vitest-environment jsdom
// G-8: /admin/coverage shows dishes without a photo and month progress, and
// no overdue list for menu work (v0.5 §4).
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  Tallies,
  VenueList,
  type VenueMenus,
} from "@/app/admin/coverage/coverage-sections"
import type { GroupOverviewRow } from "@/lib/server/coverage/types"

import { MANAGER_ID, VENUE } from "./coverage-fixtures"

afterEach(cleanup)

const OTHER = { id: "aaaaaaaa-0000-4000-8000-0000000000b2", name: "TEST Bell" }

function row(overrides: Partial<GroupOverviewRow> = {}): GroupOverviewRow {
  return {
    venue: VENUE,
    managers: [{ id: MANAGER_ID, displayName: "TEST Manager" }],
    coverage: {
      applicable: 10,
      satisfied: 4,
      needsSetup: 0,
      pendingReview: 0,
      overdue: 0,
      needsReassignment: 0,
      amenityUnknown: 0,
      menuState: "current",
      complete: false,
    },
    participation: {
      staff: 8,
      targetsSet: 8,
      targetsNeedingSetup: 0,
      staffWithoutTarget: 0,
      complete: 3,
      acceptedPhotos: 21,
    },
    selfReviews: 0,
    lastPreparation: null,
    ...overrides,
  }
}

const menus: VenueMenus = new Map([
  [VENUE.id, { eligible: 40, covered: 31, gaps: 9, needsRecheck: 0 }],
  [OTHER.id, null],
])

describe("admin coverage oversight", () => {
  it("tallies dishes without a photo beside month progress", () => {
    render(
      <Tallies
        rows={[row(), row({ venue: OTHER })]}
        periodLabel="November 2026"
        menus={menus}
      />
    )
    const tally = screen.getByText("Dishes without a photo").parentElement!
    expect(tally.textContent).toContain("9")
    expect(tally.textContent).toContain("of 40")
    expect(tally.textContent).toContain("On 1 menu")
    expect(screen.getByText("Met their target")).toBeTruthy()
    // Overdue counts other jobs only; menu work has no due date.
    expect(screen.queryByText("Overdue")).toBeNull()
    expect(screen.getByText("Other jobs overdue")).toBeTruthy()
  })

  it("shows each venue's dishes with a photo and its month progress", () => {
    render(
      <VenueList
        rows={[
          row({ coverage: { ...row().coverage, overdue: 2 } }),
          row({ venue: OTHER }),
        ]}
        menus={menus}
      />
    )
    const [first, second] = screen.getAllByRole("listitem")
    expect(within(first!).getByText("Our menu")).toBeTruthy()
    expect(within(first!).getByText("of 40 dishes have a photo")).toBeTruthy()
    expect(within(first!).getByText("Checklist items complete")).toBeTruthy()
    expect(within(first!).getByText("Staff met their target")).toBeTruthy()
    expect(within(first!).getByText("2 other jobs overdue")).toBeTruthy()
    expect(within(second!).getByText("No active menu")).toBeTruthy()
  })

  it("leaves Our menu out of a past month", () => {
    render(<VenueList rows={[row()]} />)
    expect(screen.queryByText("Our menu")).toBeNull()
    expect(screen.getByText("Staff met their target")).toBeTruthy()
  })
})
