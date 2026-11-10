// @vitest-environment jsdom
// B03 UI design §6.1, §6.3: Check dates and open rechecks on a check page.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { CheckDatesSection } from "@/components/nabalens/knowledge/check-dates"
import type { FreshnessEntry } from "@/lib/knowledge-client/contract"

afterEach(cleanup)

const unrated: FreshnessEntry[] = [
  {
    use: "internal",
    state: "unrated",
    nextCheckDue: null,
    basis: null,
    basisDate: null,
  },
  {
    use: "public",
    state: "unrated",
    nextCheckDue: null,
    basis: null,
    basisDate: null,
  },
]
const expired: FreshnessEntry[] = [
  {
    use: "internal",
    state: "expired",
    nextCheckDue: "2026-11-08",
    basis: "observed_on",
    basisDate: "2026-08-10",
  },
  {
    use: "public",
    state: "expired",
    nextCheckDue: "2026-10-01",
    basis: "observed_on",
    basisDate: "2026-08-10",
  },
]

describe("Check dates", () => {
  it("says there's no rule when every use is unrated", () => {
    render(
      <CheckDatesSection
        freshness={unrated}
        rechecks={{ count: 0, tasks: [] }}
        assignee={null}
        findingWaiting={false}
      />
    )
    expect(
      screen.getByText("This question has no check-date rule.")
    ).toBeTruthy()
  })

  it("shows the internal line only, and that a recheck opens within the hour", () => {
    render(
      <CheckDatesSection
        freshness={expired}
        rechecks={{ count: 0, tasks: [] }}
        assignee={null}
        findingWaiting={false}
      />
    )
    expect(
      screen.getByText(
        "For staff and internal tools: past its check date since 8 Nov 2026. Not in use for this until it's checked again."
      )
    ).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    expect(
      screen.getByText("Past its check date. A recheck opens within the hour.")
    ).toBeTruthy()
  })

  it("lists an open recheck with its cause and assignee, and a waiting finding", () => {
    render(
      <CheckDatesSection
        freshness={expired}
        rechecks={{
          count: 1,
          tasks: [
            {
              taskId: "t1",
              checkId: "c1",
              venueId: "v1",
              questionKey: "onsite_parking",
              question: "⟨Question⟩",
              cause: "expired",
              use: "internal",
              dueAt: "2026-11-08T00:00:00.000Z",
            },
          ],
        }}
        assignee="⟨Name⟩"
        findingWaiting
      />
    )
    expect(
      screen.getByText(
        "Recheck open: Past its check date since 8 Nov 2026. Assigned to ⟨Name⟩."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "A finding is waiting for you to confirm; the recheck closes once it's confirmed."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/within the hour/)).toBeNull()
  })

  it("gives staff who aren't assigned the count only", () => {
    render(
      <CheckDatesSection
        freshness={expired}
        rechecks={{ count: 2, tasks: [] }}
        assignee={null}
        findingWaiting={false}
      />
    )
    expect(screen.getByText("2 rechecks are open.")).toBeTruthy()
  })
})
