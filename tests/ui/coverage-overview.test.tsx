// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { manageHrefs } from "@/components/nabalens/coverage"
import {
  OverviewBody,
  participationOf,
  type PreparationState,
} from "@/components/nabalens/coverage/overview-body"
import type { VenueCoverageSummary } from "@/lib/server/coverage/types"

import { PERIOD, VENUE, monthly, requirement } from "./coverage-fixtures"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

afterEach(cleanup)

const hrefs = manageHrefs("/staff/manage")

const summary = (
  o: Partial<VenueCoverageSummary> = {}
): VenueCoverageSummary => ({
  venue: { ...VENUE, active: true },
  applicable: 13,
  satisfied: 9,
  needsSetup: 2,
  notApplicable: 0,
  pendingReview: 3,
  overdue: 1,
  needsReassignment: 0,
  amenityUnknown: 1,
  menuState: "current",
  pendingReconciliation: 0,
  complete: false,
  ...o,
})

function body(
  o: {
    summary?: VenueCoverageSummary
    attention?: ReturnType<typeof requirement>[]
    preparation?: PreparationState
    menuChange?: { changedOn: string | null } | null
    roster?: ReturnType<typeof monthly>[]
  } = {}
) {
  return render(
    <OverviewBody
      venueName="The Railway"
      period={PERIOD}
      previousMonth="October"
      summary={o.summary ?? summary()}
      attention={o.attention ?? []}
      hrefs={hrefs}
      participation={participationOf(o.roster ?? [])}
      preparation={o.preparation ?? { kind: "ready" }}
      retry={<button type="button">Try again</button>}
      menuChange={o.menuChange ?? null}
    />
  )
}

describe("OverviewBody", () => {
  it("keeps venue coverage and staff participation separate", () => {
    body({
      roster: [
        monthly({ complete: true, accepted: 5 }),
        monthly({ complete: false, accepted: 2 }),
        monthly({
          status: "needs_setup",
          setupMissing: ["team"],
          accepted: 0,
          targetCount: null,
        }),
      ],
    })
    const coverage = screen.getByRole("region", { name: "Venue coverage" })
    expect(within(coverage).getByText("Checklist complete")).toBeTruthy()
    expect(within(coverage).getByText("9")).toBeTruthy()
    expect(within(coverage).getByText("of 13")).toBeTruthy()
    expect(
      within(coverage).getByText("1 amenity needs verification")
    ).toBeTruthy()

    const staff = screen.getByRole("region", { name: "Staff participation" })
    expect(within(staff).getByText("November 2026")).toBeTruthy()
    expect(within(staff).getByText("Met their target")).toBeTruthy()
    expect(within(staff).getByText("of 3")).toBeTruthy()
    expect(within(staff).getByText("7")).toBeTruthy()
    expect(within(staff).getByText("No team assigned")).toBeTruthy()
    // Nobody's month leaks into the checklist figures.
    expect(within(coverage).queryByText("of 3")).toBeNull()
    expect(within(coverage).queryByText("7")).toBeNull()
  })

  it("lists attention rows with chips, issues, due date and progress", () => {
    body({
      attention: [
        requirement({
          title: "Accessible toilet",
          setupIssues: ["fact_unknown", "no_assignees"],
        }),
        requirement({
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          title: "Dog facilities",
          status: "active",
          setupIssues: [],
          due: {
            dueOn: "2026-10-31",
            dueAt: "2026-11-01T00:00:00.000Z",
            label: "Due 31 Oct 2026",
            overdue: true,
          },
          progress: {
            target: 2,
            accepted: 0,
            pending: 1,
            needsAnotherPhoto: 0,
            evidenceRemoved: 0,
            satisfied: false,
            overdue: true,
          },
        }),
      ],
    })
    const list = screen.getByRole("list", { name: "Needs your attention" })
    const rows = within(list).getAllByRole("link")
    expect(within(rows[0]).getByText("Needs setup")).toBeTruthy()
    expect(
      within(rows[0]).getByText(
        "Needs verification: record whether it is present"
      )
    ).toBeTruthy()
    expect(within(rows[0]).getByText("No one is assigned")).toBeTruthy()
    expect(within(rows[1]).getByText("Overdue")).toBeTruthy()
    expect(within(rows[1]).getByText("Due 31 Oct 2026")).toBeTruthy()
    expect(
      within(rows[1]).getAllByText(/of 2 accepted/).length
    ).toBeGreaterThan(0)
  })

  it("explains an unprepared month", () => {
    body({
      preparation: { kind: "unprepared" },
      roster: [
        monthly({ status: "needs_setup", targetCount: null }),
        monthly({ status: "needs_setup", targetCount: null }),
      ],
    })
    expect(screen.getByText("November isn’t prepared yet")).toBeTruthy()
    expect(
      screen.getByText(/Preparing copies October’s targets at The Railway/)
    ).toBeTruthy()
    const staff = screen.getByRole("region", { name: "Staff participation" })
    expect(
      within(staff).getByText("2 November targets not set yet")
    ).toBeTruthy()
  })

  it("reports a failed preparation with a retry", () => {
    body({
      preparation: { kind: "failed", copied: 9, total: 11 },
    })
    expect(screen.getByText("Preparing November didn’t finish")).toBeTruthy()
    expect(
      screen.getByText(
        "Targets were copied for 9 of 11 people. 2 need you to set them on Team."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("announces a changed menu, with the date when known", () => {
    body({ menuChange: { changedOn: "1 Nov 2026" } })
    expect(screen.getByText("Menu changed — review coverage")).toBeTruthy()
    expect(
      screen.getByText(/food menu changed on 1 Nov 2026\. Nothing carries over/)
    ).toBeTruthy()
  })

  it("says everything is complete and drops the attention list", () => {
    body({
      summary: summary({
        complete: true,
        satisfied: 13,
        needsSetup: 0,
        pendingReview: 0,
        overdue: 0,
        amenityUnknown: 0,
      }),
    })
    expect(
      screen.getByText(
        "Everything at The Railway is complete for November. New photos still appear in Review as they’re sent."
      )
    ).toBeTruthy()
    expect(screen.queryByText("Needs your attention")).toBeNull()
    expect(screen.getByText("Complete")).toBeTruthy()
  })

  it("lists staff who need setup under Needs your attention, never 'nothing needs setup'", () => {
    body({
      roster: [
        monthly({
          status: "needs_setup",
          setupMissing: ["target"],
          targetCount: null,
        }),
        monthly({
          status: "needs_setup",
          setupMissing: ["target"],
          targetCount: null,
        }),
      ],
      preparation: { kind: "unprepared" },
    })
    const staff = screen.getByRole("region", { name: "Staff participation" })
    expect(
      within(staff).getByText("2 November targets not set yet")
    ).toBeTruthy()
    const attention = screen.getByRole("region", {
      name: "Needs your attention",
    })
    expect(
      within(attention).queryByText(
        "Nothing needs setup, reassignment or follow-up."
      )
    ).toBeNull()
    const row = within(attention).getByRole("link", {
      name: /2 people need setup/,
    })
    expect(row.getAttribute("href")).toBe(hrefs.team)
    expect(within(row).getByText("2 November targets not set yet")).toBeTruthy()
  })

  it("isn't 'everything complete' while someone still needs setup", () => {
    body({
      summary: summary({
        complete: true,
        satisfied: 13,
        needsSetup: 0,
        pendingReview: 0,
        overdue: 0,
        amenityUnknown: 0,
      }),
      roster: [
        monthly({ complete: true, accepted: 5 }),
        monthly({
          status: "needs_setup",
          setupMissing: ["team"],
          targetCount: null,
        }),
      ],
    })
    expect(
      screen.queryByText(/Everything at The Railway is complete/)
    ).toBeNull()
    const attention = screen.getByRole("region", {
      name: "Needs your attention",
    })
    expect(
      within(attention).getByRole("link", { name: /1 person needs setup/ })
    ).toBeTruthy()
    expect(within(attention).getByText("No team assigned")).toBeTruthy()
  })

  it("says nothing needs setup only when no item or person does", () => {
    body({ roster: [monthly({ complete: false, accepted: 1 })] })
    const attention = screen.getByRole("region", {
      name: "Needs your attention",
    })
    expect(
      within(attention).getByText(
        "Nothing needs setup, reassignment or follow-up."
      )
    ).toBeTruthy()
  })

  it("links to the full checklist when more than six need attention", () => {
    body({
      attention: Array.from({ length: 8 }, (_, i) =>
        requirement({
          id: `bbbbbbbb-0000-4000-8000-00000000010${i}`,
          title: `Item ${i}`,
        })
      ),
    })
    expect(
      screen.getByRole("link", { name: "See all 8 on the checklist" })
    ).toBeTruthy()
    expect(screen.queryByText("Item 7")).toBeNull()
  })
})
