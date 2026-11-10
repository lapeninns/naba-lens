// @vitest-environment jsdom
// B03 UI design §3.2: the "When did you check?" field.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CheckedOnField } from "@/components/nabalens/knowledge/checked-on-field"

afterEach(cleanup)

describe("CheckedOnField", () => {
  it("offers today back to 30 days, and makes any change chosen", () => {
    const onChange = vi.fn()
    render(
      <CheckedOnField
        id="checked"
        today="2026-11-10"
        value={{ date: "2026-11-10", source: "form_default" }}
        onChange={onChange}
      />
    )
    const input = screen.getByLabelText(
      "When did you check?"
    ) as HTMLInputElement
    expect(input.type).toBe("date")
    expect(input.min).toBe("2026-10-11")
    expect(input.max).toBe("2026-11-10")
    expect(input.getAttribute("aria-required")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe("checked-help")
    fireEvent.change(input, { target: { value: "2026-11-08" } })
    expect(onChange).toHaveBeenCalledWith({
      date: "2026-11-08",
      source: "chosen",
    })
  })

  it("explains a cleared date and ties the notice and error to the field", () => {
    render(
      <CheckedOnField
        id="checked"
        today="2026-11-10"
        value={{ date: null, source: null }}
        onChange={vi.fn()}
        notice="This draft was started on 7 Nov 2026. Choose the day you checked."
        error="Choose the day you checked."
      />
    )
    const input = screen.getByLabelText(
      "When did you check?"
    ) as HTMLInputElement
    expect(input.value).toBe("")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe(
      "checked-help checked-notice checked-error"
    )
    expect(
      screen.getByText(
        "This draft was started on 7 Nov 2026. Choose the day you checked."
      )
    ).toBeTruthy()
    expect(screen.getByText("Choose the day you checked.")).toBeTruthy()
  })
})
