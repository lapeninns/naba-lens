// @vitest-environment jsdom
// Home's sent notice: the open-recheck line on its own line, before the
// recognition line, and nothing extra without it.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { FindingSentNotice } from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { RECHECK_COPY } from "@/components/nabalens/knowledge/copy"

afterEach(cleanup)

const COPY = {
  title: "Finding sent",
  body: "It agrees with the recorded answer; your manager confirms it.",
  extra: "TEST recognition line",
}

describe("FindingSentNotice and an open recheck", () => {
  it("says the recheck stays open, then the recognition line", () => {
    render(
      <FindingSentNotice
        question="Is there a hand dryer?"
        returnFocusId="x"
        copy={{ ...COPY, recheck: RECHECK_COPY.sentOpen }}
      />
    )
    const status = screen.getByRole("status")
    expect(status.textContent).toContain(COPY.body)
    const text = status.textContent ?? ""
    expect(text.indexOf(RECHECK_COPY.sentOpen)).toBeGreaterThan(-1)
    expect(text.indexOf(RECHECK_COPY.sentOpen)).toBeLessThan(
      text.indexOf(COPY.extra)
    )
  })

  it("adds no recheck line without one", () => {
    render(
      <FindingSentNotice
        question="Is there a hand dryer?"
        returnFocusId="x"
        copy={COPY}
      />
    )
    expect(screen.getByRole("status").textContent).not.toContain("Recheck")
  })
})
