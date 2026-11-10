// @vitest-environment jsdom
// B03 UI design §3.2: the facility detail fields.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  emptyFacility,
  type FacilityDraft,
} from "@/components/nabalens/knowledge/facility-detail"
import { FacilityDetailFields } from "@/components/nabalens/knowledge/facility-detail-fields"
import type { Place } from "@/lib/knowledge-client/contract"

afterEach(cleanup)

const BAR: Place = {
  subjectId: "5a000000-0000-4000-8000-000000000001",
  kind: "area",
  label: "⟨Back bar⟩",
  active: true,
}

function Harness({
  places = [BAR],
  errors = {},
  onValue,
}: {
  places?: Place[]
  errors?: Parameters<typeof FacilityDetailFields>[0]["errors"]
  onValue?: (v: FacilityDraft) => void
}) {
  const [value, setValue] = React.useState(emptyFacility())
  return (
    <FacilityDetailFields
      id="f"
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
      places={places}
      venueName="⟨Venue⟩"
      errors={errors}
    />
  )
}

describe("FacilityDetailFields", () => {
  it("chooses listed places and names others, removable", async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const where = screen.getByRole("group", { name: "Where is it?" })
    await user.click(
      within(where).getByRole("checkbox", { name: "⟨Back bar⟩" })
    )
    await user.type(within(where).getByLabelText("Somewhere else"), "⟨Patio⟩")
    await user.click(
      within(where).getByRole("button", { name: "Add this place" })
    )
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        locations: [{ subjectId: BAR.subjectId }, { label: "⟨Patio⟩" }],
      })
    )
    await user.click(screen.getByRole("button", { name: "Remove ⟨Patio⟩" }))
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ locations: [{ subjectId: BAR.subjectId }] })
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(where).getByLabelText("Somewhere else")
      )
    )
  })

  it("asks for a name when the venue lists no places", () => {
    render(<Harness places={[]} />)
    expect(
      screen.getByText("No places are listed for ⟨Venue⟩ yet. Name the place.")
    ).toBeTruthy()
    expect(screen.getByLabelText("Name the place")).toBeTruthy()
  })

  it("offers temporarily unavailable with its day back and note, and fees default to not recorded", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText("Availability", { selector: "summary" }))
    expect(
      screen.getAllByRole("radio", {
        name: /Available|On request|Seasonal|Temporarily unavailable/,
      })
    ).toHaveLength(4)
    expect(screen.queryByLabelText("Back on (optional)")).toBeNull()
    await user.click(
      screen.getByRole("radio", { name: "Temporarily unavailable" })
    )
    expect(screen.getByLabelText("Back on (optional)")).toBeTruthy()
    expect(screen.getByLabelText("What's happening (internal)")).toBeTruthy()
    await user.click(screen.getByText("Fees", { selector: "summary" }))
    expect(
      (screen.getByRole("radio", { name: "Not recorded" }) as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(screen.queryByLabelText("Amount (£)")).toBeNull()
    await user.click(screen.getByRole("radio", { name: "Charged" }))
    expect(screen.getByLabelText("Amount (£)")).toBeTruthy()
  })

  it("opens a section with an error and ties the message to it", () => {
    render(<Harness errors={{ fees: "This is out of range." }} />)
    const fees = screen.getByRole("group", { name: "Fees" })
    expect(fees.closest("details")?.open).toBe(true)
    expect(fees.getAttribute("aria-describedby")).toContain("f-fees-error")
    expect(screen.getByText("This is out of range.")).toBeTruthy()
  })
})
