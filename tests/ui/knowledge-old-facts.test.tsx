// @vitest-environment jsdom
// B03 UI design §7.2: old facts as history on a check page.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { OldFactsSection } from "@/components/nabalens/knowledge/old-facts"

afterEach(cleanup)

describe("From the old facts list", () => {
  it("shows each old fact as history, never a confirmation", () => {
    render(
      <OldFactsSection
        items={[
          {
            legacyKey: "parking",
            label: "⟨Parking⟩",
            presence: "present",
            facts: "⟨Old facts text⟩",
            policy: null,
            savedAsConfirmedAt: "2025-06-02T10:00:00.000Z",
            updatedAt: "2025-06-02T10:00:00.000Z",
          },
          {
            legacyKey: "dogs",
            label: "",
            presence: "unknown",
            facts: null,
            policy: "⟨Old policy text⟩",
            savedAsConfirmedAt: null,
            updatedAt: "2025-06-02T10:00:00.000Z",
          },
        ]}
      />
    )
    expect(screen.getByText("From the old facts list (2)")).toBeTruthy()
    expect(
      screen.getByText(
        "Kept as history. This isn't a confirmed answer for this question."
      )
    ).toBeTruthy()
    expect(screen.getByText("⟨Parking⟩: Present")).toBeTruthy()
    expect(screen.getByText("dogs: Not checked")).toBeTruthy()
    expect(
      screen.getByText("Saved as confirmed in Coverage on 2 Jun 2025")
    ).toBeTruthy()
  })

  it("says so when the list can't be read, and is absent when there's nothing", () => {
    const { container, rerender } = render(<OldFactsSection items={[]} />)
    expect(container.textContent).toBe("")
    rerender(<OldFactsSection items={null} />)
    expect(
      screen.getByText("The old facts list couldn't be read.")
    ).toBeTruthy()
  })
})
