// @vitest-environment jsdom
// B03 UI design §6.3, §7.1: the Triage card's B03 rows, kept apart.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TriageCard } from "@/components/nabalens/manager/overview/triage-card"
import { parseTriage } from "@/lib/work-client/parse"

afterEach(cleanup)

const hrefs = {
  menu_photos: "/manager/review",
  findings: "/manager/amenities#amenities-to-confirm",
  checklist: "/manager/review",
  rechecks: "/manager/amenities",
  suggestions: "/manager/amenities#amenities-to-confirm",
}

describe("Triage: rechecks and imports (B03-e, B03-f)", () => {
  it("reads the server's B03 rows beside the B02 queues, and drops what it can't read", () => {
    expect(
      parseTriage([
        {
          queue: "findings",
          available: true,
          waiting: 2,
          oldest_waiting_at: null,
        },
        {
          queue: "rechecks",
          available: true,
          waiting: 3,
          oldest_waiting_at: "2026-11-08T00:00:00.000Z",
        },
        { queue: "suggestions", available: false, waiting: null },
        { queue: "something_new", available: true, waiting: 9 },
      ])
    ).toEqual([
      {
        queue: "findings",
        available: true,
        waiting: 2,
        oldestWaitingAt: null,
        ownWaiting: 0,
      },
      {
        queue: "rechecks",
        available: true,
        waiting: 3,
        oldestWaitingAt: "2026-11-08T00:00:00.000Z",
        ownWaiting: 0,
      },
      { queue: "suggestions", available: false },
    ])
  })

  it("gives rechecks and imports their own rows, never summed, and hides one that isn't available", () => {
    const rows = parseTriage([
      { queue: "findings", available: true, waiting: 2 },
      {
        queue: "rechecks",
        available: true,
        waiting: 3,
        oldest_waiting_at: "2026-11-08T00:00:00.000Z",
      },
      {
        queue: "suggestions",
        available: true,
        waiting: 4,
        oldest_waiting_at: "2026-11-07T09:30:00.000Z",
      },
    ])!
    render(<TriageCard rows={rows} hrefs={hrefs} />)
    expect(screen.getByText("Findings to confirm: 2")).toBeTruthy()
    expect(
      screen.getByText("Rechecks due: 3, oldest due 8 Nov 2026")
    ).toBeTruthy()
    expect(screen.getByText(/^Imports to decide: 4, oldest/)).toBeTruthy()
    cleanup()
    render(
      <TriageCard
        rows={parseTriage([{ queue: "rechecks", available: false }])!}
        hrefs={hrefs}
      />
    )
    expect(screen.queryByText(/Rechecks due/)).toBeNull()
  })

  it("leaves a B03 row out where the page gives it nowhere to go", () => {
    const rows = parseTriage([
      { queue: "rechecks", available: true, waiting: 1 },
    ])!
    const { container } = render(
      <TriageCard
        rows={rows}
        hrefs={{ menu_photos: "/a", findings: "/b", checklist: "/c" }}
      />
    )
    expect(container.textContent).toBe("")
  })
})
