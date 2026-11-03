// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChecklistBody, manageHrefs } from "@/components/nabalens/coverage"
import type {
  RequirementView,
  VenueCoverageSummary,
} from "@/lib/server/coverage/types"

import { VENUE, requirement } from "./coverage-fixtures"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

afterEach(cleanup)

const summary = (
  o: Partial<VenueCoverageSummary> = {}
): VenueCoverageSummary => ({
  venue: { ...VENUE, active: true },
  applicable: 3,
  satisfied: 1,
  needsSetup: 1,
  notApplicable: 1,
  pendingReview: 0,
  overdue: 1,
  needsReassignment: 0,
  amenityUnknown: 1,
  menuState: "current",
  pendingReconciliation: 0,
  complete: false,
  ...o,
})

const progress = (o: Partial<RequirementView["progress"]> = {}) => ({
  target: 2,
  accepted: 0,
  pending: 0,
  needsAnotherPhoto: 0,
  evidenceRemoved: 0,
  satisfied: false,
  overdue: false,
  ...o,
})

function body(requirements: RequirementView[], s = summary()) {
  return render(
    <ChecklistBody
      venueName="The Railway"
      month="November"
      summary={s}
      requirements={requirements}
      hrefs={manageHrefs("/staff/manage")}
      addItem={<button type="button">Add a venue-specific item</button>}
      menuChange={null}
    />
  )
}

describe("ChecklistBody", () => {
  it("lists items needing setup first and keeps not-applicable items, uncounted", () => {
    body([
      requirement({
        id: "a1",
        kind: "amenity",
        title: "Parking",
        status: "active",
        setupIssues: [],
        amenity: { presence: "present", confirmed: true },
        progress: progress({ accepted: 2, satisfied: true }),
      }),
      requirement({
        id: "a2",
        kind: "amenity",
        title: "Children's play area",
        status: "not_applicable",
        statusReason: "No play area at The Railway",
        setupIssues: [],
      }),
      requirement({
        id: "a3",
        kind: "amenity",
        title: "Accessible toilet",
        setupIssues: ["fact_unknown", "no_assignees"],
      }),
      requirement({
        id: "a4",
        kind: "amenity",
        title: "Dog facilities",
        status: "active",
        setupIssues: [],
        due: {
          dueOn: "2026-10-31",
          dueAt: "2026-11-01T00:00:00Z",
          label: "Due 31 Oct 2026",
          overdue: true,
        },
        progress: progress({ overdue: true }),
      }),
    ])
    const list = screen.getByRole("list", { name: "Amenities" })
    const rows = within(list)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "")
    expect(rows[0]).toMatch(/^Accessible toilet/)
    expect(rows[1]).toMatch(/^Dog facilities/)
    expect(rows[3]).toMatch(/^Children's play area/)
    expect(
      screen.getByText("No play area at The Railway. Not counted.")
    ).toBeTruthy()
    expect(
      screen.getByText("1 of 3 complete · 1 needs setup · 1 not applicable")
    ).toBeTruthy()
    expect(
      screen.getByText("Due 31 Oct 2026 · photos can still be sent")
    ).toBeTruthy()
    expect(
      screen.getByText("Needs verification: record whether it is present")
    ).toBeTruthy()
  })

  it("shows the empty state with the add action", () => {
    body([], summary({ applicable: 0, satisfied: 0, needsSetup: 0 }))
    expect(screen.getByText("No checklist items yet")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Add a venue-specific item" })
    ).toBeTruthy()
  })

  it("says when every counted item is complete", () => {
    body(
      [
        requirement({
          status: "active",
          setupIssues: [],
          progress: progress({ accepted: 2, satisfied: true }),
        }),
      ],
      summary({ applicable: 1, satisfied: 1, needsSetup: 0, overdue: 0 })
    )
    expect(
      screen.getByText(/Every counted item at The Railway is complete/)
    ).toBeTruthy()
    expect(screen.getByText("Complete")).toBeTruthy()
  })
})
