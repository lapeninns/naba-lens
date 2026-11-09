// @vitest-environment jsdom
// B01-06c: my latest finding on the question page (§4.6), and this month's
// findings outside the target on the monthly card (§4.7).
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { pendingLines } from "@/components/nabalens/knowledge/copy"
import { LatestFinding } from "@/components/nabalens/knowledge/latest-finding"
import { MonthlyProgressCard } from "@/components/nabalens/tasks/monthly-progress-card"
import type { FindingSummary } from "@/lib/knowledge-client/contract"

import { monthly } from "./tasks-fixtures"

afterEach(cleanup)

function finding(over: Partial<FindingSummary> = {}): FindingSummary {
  return {
    findingRef: { type: "contribution", id: "f1" },
    checkId: "c1",
    question: "Is there parking on site?",
    venue: { id: "v1", name: "The Old Crown" },
    answer: "no",
    kind: "finding",
    state: "awaiting_confirmation",
    noLongerUsed: null,
    stateReason: null,
    managerNote: null,
    detailRequestId: null,
    unknownPreset: null,
    answeredBy: null,
    sentAt: "2026-11-05T10:00:00.000Z",
    savedAt: null,
    decidedAt: null,
    recognition: { kind: "pending" },
    ...over,
  }
}

const FORM = (
  <form aria-label="Capture">
    <input aria-label="Finding" />
  </form>
)

describe("Your latest finding (§4.6)", () => {
  it("keeps the form behind Change my finding while the finding is undecided", async () => {
    render(
      <LatestFinding finding={finding()} inUse="yes">
        {FORM}
      </LatestFinding>
    )
    expect(
      screen.getByRole("region", { name: "Your latest finding" })
    ).toBeTruthy()
    expect(screen.getByText("Answer: No")).toBeTruthy()
    expect(screen.getByText("Sent 5 Nov 2026, 10:00")).toBeTruthy()
    expect(
      screen.getByText(
        "Sent. The recorded answer is marked as being checked until your manager decides."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("form", { name: "Capture" })).toBeNull()

    await userEvent.click(
      screen.getByRole("button", { name: "Change my finding" })
    )
    expect(screen.getByRole("form", { name: "Capture" })).toBeTruthy()
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Finding" })
    )
    expect(
      screen.queryByRole("button", { name: "Change my finding" })
    ).toBeNull()
  })

  it("shows the form straight away once the finding is decided or needs detail", () => {
    render(
      <LatestFinding
        finding={finding({
          state: "needs_attention",
          managerNote: "Which car park?",
        })}
        inUse={null}
      >
        {FORM}
      </LatestFinding>
    )
    expect(
      screen.getByText("Your manager asked for more detail: Which car park?")
    ).toBeTruthy()
    expect(screen.getByRole("form", { name: "Capture" })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Change my finding" })
    ).toBeNull()
  })
})

describe("Also this month (§4.7)", () => {
  it("says nothing at zero, and words one and many", () => {
    expect(pendingLines(null)).toEqual([])
    expect(
      pendingLines({ awaitingConfirmation: 0, unknownRecorded: 0 })
    ).toEqual([])
    expect(
      pendingLines({ awaitingConfirmation: 1, unknownRecorded: 1 })
    ).toEqual([
      "Also this month: 1 finding waiting for confirmation. It's not in this count.",
      "1 couldn't-establish finding recorded. It doesn't count toward targets.",
    ])
    expect(
      pendingLines({ awaitingConfirmation: 3, unknownRecorded: 2 })
    ).toEqual([
      "Also this month: 3 findings waiting for confirmation. They're not in this count.",
      "2 couldn't-establish findings recorded. These don't count toward targets.",
    ])
  })

  it("sits apart from the target number and leaves the progress bar's name alone", () => {
    render(
      <MonthlyProgressCard
        monthly={monthly()}
        periodLabel="November 2026"
        addHref={null}
        canSubmit
        alsoPending={{ awaitingConfirmation: 2, unknownRecorded: 0 }}
      />
    )
    expect(
      screen.getByText(
        "Also this month: 2 findings waiting for confirmation. They're not in this count."
      )
    ).toBeTruthy()
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      "3 of 5 photos accepted"
    )
    expect(screen.queryByText(/couldn't-establish/)).toBeNull()
  })
})
