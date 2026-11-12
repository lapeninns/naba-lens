// @vitest-environment jsdom
// B10-05a ScreenGuide: closed until asked for, approved lines only.
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ScreenGuide } from "@/components/nabalens/guide/screen-guide"
import {
  GUIDANCE_LINES,
  GUIDANCE_TITLE,
  shownGuidance,
} from "@/components/nabalens/guide/screen-guidance"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { GUIDE_SAFETY } from "@/lib/guide/dish-guide"

describe("ScreenGuide", () => {
  it("starts closed and opens on its summary", async () => {
    const { container } = render(<ScreenGuide screen="staff-home" />)
    const details = container.querySelector("details")!
    expect(details.open).toBe(false)
    await userEvent.click(screen.getByText(GUIDANCE_TITLE))
    expect(details.open).toBe(true)
    expect(screen.getByText(GUIDE_SAFETY)).toBeTruthy()
  })

  it("shows exactly the screen's approved lines, in order", () => {
    for (const s of [
      "staff-home",
      "staff-capture",
      "manager-review",
    ] as const) {
      const { container, unmount } = render(<ScreenGuide screen={s} />)
      expect(
        [...container.querySelectorAll("li")].map((li) => li.textContent)
      ).toEqual(shownGuidance(s).map((l) => l.text))
      unmount()
    }
  })

  it("never shows a line waiting for owner sign-off", () => {
    const { container } = render(
      <>
        <ScreenGuide screen="staff-home" />
        <ScreenGuide screen="staff-capture" />
      </>
    )
    const text = container.textContent ?? ""
    expect(text).not.toContain(ENTRY_COPY.photosAudience)
    expect(text).not.toContain(ENTRY_COPY.findingAudience)
    expect(text).not.toContain(ENTRY_COPY.evidenceAudience)
    expect(GUIDANCE_LINES.some((l) => l.wording === "awaiting_sign_off")).toBe(
      true
    )
  })
})
