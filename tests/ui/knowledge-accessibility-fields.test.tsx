// @vitest-environment jsdom
// B03 UI design §3.2, §3.3: the accessibility detail fields.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  emptyAccess,
  type AccessDraft,
} from "@/components/nabalens/knowledge/accessibility-detail"
import { AccessDetailFields } from "@/components/nabalens/knowledge/accessibility-detail-fields"
import type { Place, QuestionFeature } from "@/lib/knowledge-client/contract"

afterEach(cleanup)

const MAIN: Place = {
  subjectId: "5a000000-0000-4000-8000-000000000001",
  kind: "entrance",
  label: "⟨Main entrance⟩",
  active: true,
}
const LIFT: Place = {
  subjectId: "5a000000-0000-4000-8000-000000000003",
  kind: "facility_point",
  label: "⟨Lift⟩",
  active: true,
}

function Harness(
  props: Partial<React.ComponentProps<typeof AccessDetailFields>> & {
    onValue?: (v: AccessDraft) => void
  }
) {
  const [value, setValue] = React.useState(emptyAccess())
  return (
    <AccessDetailFields
      id="a"
      value={value}
      onChange={(next) => {
        setValue(next)
        props.onValue?.(next)
      }}
      answer="yes"
      stepFree={false}
      places={[MAIN, LIFT]}
      features={[]}
      venueName="⟨Venue⟩"
      canManagePlaces={false}
      errors={{}}
      today="2026-11-10"
      {...props}
    />
  )
}

describe("AccessDetailFields", () => {
  it("step-free lists only Places entrances, each with its result, and says what Yes means", async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness stepFree onValue={onValue} />)
    const group = screen.getByRole("group", {
      name: "Which entrances did you check?",
    })
    expect(within(group).queryByText("⟨Lift⟩")).toBeNull()
    expect(within(group).queryByText("Somewhere else")).toBeNull()
    const main = within(group).getByRole("group", { name: "⟨Main entrance⟩" })
    expect(
      (
        within(main).getByRole("radio", {
          name: "Not checked",
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    await user.click(within(main).getByRole("radio", { name: "Step-free" }))
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ entrances: { [MAIN.subjectId]: "yes" } })
    )
    expect(
      screen.getByText(
        "Yes says ⟨Main entrance⟩ is step-free. It says nothing about the others."
      )
    ).toBeTruthy()
  })

  it("says to add entrances under Places when none are listed, by role", () => {
    const { unmount } = render(<Harness stepFree places={[LIFT]} />)
    expect(
      screen.getByText(
        "No entrances are listed for ⟨Venue⟩ yet. Ask your manager to add entrances under Places."
      )
    ).toBeTruthy()
    unmount()
    render(<Harness stepFree places={[]} canManagePlaces />)
    expect(
      screen.getByText(
        "No entrances are listed for ⟨Venue⟩ yet. Add entrances under Places."
      )
    ).toBeTruthy()
  })

  it("asks what was checked, with the covers-only line, for other questions", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const group = screen.getByRole("group", { name: /What did you check\?/ })
    await user.click(within(group).getByRole("radio", { name: "⟨Lift⟩" }))
    expect(
      screen.getByText(
        "This covers ⟨Lift⟩ only. It says nothing about other entrances, routes inside, toilets or seating."
      )
    ).toBeTruthy()
    await user.click(
      within(group).getByRole("radio", { name: "Somewhere else" })
    )
    await user.type(screen.getByLabelText("Name the place"), "⟨Ramp⟩")
    expect(screen.getByText(/This covers ⟨Ramp⟩ only/)).toBeTruthy()
  })

  it("shows no features or measurements when the version lists none", () => {
    render(<Harness />)
    expect(screen.queryByText("Features")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Add a measurement" })
    ).toBeNull()
  })

  it("asks about each version feature and measures only measurable ones", async () => {
    const user = userEvent.setup()
    const features: QuestionFeature[] = [
      { key: "ramp", label: "⟨Ramp⟩", measurable: true },
      { key: "handrail", label: "⟨Handrail⟩", measurable: false },
    ]
    render(<Harness features={features} />)
    expect(screen.getByRole("group", { name: "⟨Ramp⟩" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "⟨Handrail⟩" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Add a measurement" }))
    const m = screen.getByRole("group", { name: "Measurement 1" })
    const feature = within(m).getByLabelText("Feature") as HTMLSelectElement
    expect(feature.value).toBe("ramp")
    expect(Array.from(feature.options).map((o) => o.textContent)).toEqual([
      "Choose…",
      "⟨Ramp⟩",
    ])
    await user.click(
      within(m).getByRole("button", { name: "Remove measurement 1" })
    )
    expect(screen.queryByRole("group", { name: "Measurement 1" })).toBeNull()
  })
})
