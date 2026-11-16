// @vitest-environment jsdom
// G-2, decision 13: the month roll draws four frame states with
// Progress mode="segments": Accepted, Waiting for review, Needs another photo
// and Still to take, with words for each beside it.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { MonthCard } from "@/components/nabalens/tasks"
import { PhotoSegments } from "@/components/nabalens/tasks/month-card"

import { monthly } from "./tasks-fixtures"

afterEach(cleanup)

const states = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('[data-slot="progress-segment"]')].map(
    (s) => s.dataset.state
  )

describe("Your month roll of frames", () => {
  it("draws accepted, waiting, needs another and still to take, in that order", () => {
    const { container } = render(
      <MonthCard
        monthly={monthly({
          accepted: 2,
          pending: 1,
          needsAnotherPhoto: 1,
          targetCount: 6,
        })}
        periodLabel="November 2026"
      />
    )
    expect(states(container)).toEqual([
      "accepted",
      "accepted",
      "submitted",
      "needsAnother",
      "needed",
      "needed",
    ])
    const bar = screen.getByRole("progressbar", {
      name: "2 of 6 photos accepted",
    })
    expect(bar.getAttribute("aria-valuetext")).toBe(
      "2 of 6 photos accepted, 1 waiting for review, 1 needs another photo, 2 to take"
    )
    // The key names every state that is drawn.
    expect(screen.getByText("2 accepted")).toBeTruthy()
    expect(screen.getByText("1 waiting for review")).toBeTruthy()
    expect(screen.getByText("1 needs another photo")).toBeTruthy()
    expect(screen.getByText("2 to take")).toBeTruthy()
  })

  it("leaves out states with no photo", () => {
    const { container } = render(
      <MonthCard
        monthly={monthly({
          accepted: 1,
          pending: 0,
          needsAnotherPhoto: 0,
          targetCount: 3,
        })}
        periodLabel="November 2026"
      />
    )
    expect(states(container)).toEqual(["accepted", "needed", "needed"])
    expect(screen.queryByText(/waiting for review/)).toBeNull()
    expect(screen.queryByText(/another photo/)).toBeNull()
  })

  it("merges above 12 frames and keeps the needs another part", () => {
    const { container } = render(
      <MonthCard
        monthly={monthly({
          accepted: 3,
          pending: 2,
          needsAnotherPhoto: 2,
          targetCount: 20,
        })}
        periodLabel="November 2026"
      />
    )
    expect(states(container)).toEqual(["accepted", "submitted", "needsAnother"])
    expect(screen.getByText("2 need another photo")).toBeTruthy()
    expect(screen.getByText("13 to take")).toBeTruthy()
  })

  it("keeps PhotoSegments as a decorative copy of the same drawing", () => {
    const { container } = render(
      <PhotoSegments accepted={1} pending={1} target={3} />
    )
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe(
      "true"
    )
    expect(states(container)).toEqual(["accepted", "submitted", "needed"])
  })
})
