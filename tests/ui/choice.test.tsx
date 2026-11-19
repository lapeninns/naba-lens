// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import { OptionRow } from "@/components/ui/option-row"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { SelectableTile } from "@/components/ui/selectable-tile"

afterEach(cleanup)

// Submits the form for real and returns what the browser would send.
function submitted(form: HTMLFormElement) {
  let entries: [string, FormDataEntryValue][] | null = null
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    entries = [...new FormData(form).entries()]
  })
  form.requestSubmit()
  return entries as [string, FormDataEntryValue][] | null
}

describe("Checkbox", () => {
  it("is a named checkbox that Space ticks and unticks", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <label>
        <Checkbox onCheckedChange={onCheckedChange} />
        Vegan
      </label>
    )
    const box = screen.getByRole("checkbox", { name: "Vegan" })
    expect(box.getAttribute("data-slot")).toBe("checkbox")
    expect(box.getAttribute("aria-checked")).toBe("false")
    expect(box.className).toContain("size-6")
    expect(box.className).toContain("after:-inset-2.5")
    expect(box.className).toContain("edge-strong")
    expect(box.className).toContain("focus-ring")

    await user.tab()
    expect(document.activeElement).toBe(box)
    await user.keyboard(" ")
    expect(box.getAttribute("aria-checked")).toBe("true")
    expect(box.hasAttribute("data-checked")).toBe(true)
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())
    expect(box.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")

    await user.keyboard(" ")
    expect(box.getAttribute("aria-checked")).toBe("false")
  })

  it("is ticked by a click on its label", async () => {
    const user = userEvent.setup()
    render(
      <label>
        <Checkbox />
        Gluten free
      </label>
    )
    await user.click(screen.getByText("Gluten free"))
    expect(
      screen.getByRole("checkbox", { name: "Gluten free" })
    ).toHaveProperty("ariaChecked", "true")
  })

  it("says mixed when indeterminate", () => {
    render(<Checkbox indeterminate aria-label="All photos" />)
    const box = screen.getByRole("checkbox", { name: "All photos" })
    expect(box.getAttribute("aria-checked")).toBe("mixed")
    expect(box.hasAttribute("data-indeterminate")).toBe(true)
    expect(box.querySelectorAll("svg")).toHaveLength(2)
  })

  it("disabled: out of the focus order and unchanged by a click", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Checkbox disabled aria-label="Vegan" onCheckedChange={onCheckedChange} />
    )
    const box = screen.getByRole("checkbox", { name: "Vegan" })
    expect(box.getAttribute("aria-disabled")).toBe("true")
    await user.click(box)
    await user.tab()
    expect(document.activeElement).not.toBe(box)
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(box.getAttribute("aria-checked")).toBe("false")
  })

  it("aria-disabled: stays focusable with its reason, and does not change", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <>
        <Checkbox
          aria-disabled
          aria-label="Vegan"
          aria-describedby="why"
          onCheckedChange={onCheckedChange}
        />
        <p id="why">Set by the menu import.</p>
      </>
    )
    const box = screen.getByRole("checkbox", { name: "Vegan" })
    expect(box.getAttribute("aria-disabled")).toBe("true")
    expect(box.getAttribute("aria-describedby")).toBe("why")
    await user.tab()
    expect(document.activeElement).toBe(box)
    await user.keyboard(" ")
    await user.click(box)
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(box.getAttribute("aria-checked")).toBe("false")
  })

  it("passes aria-invalid to the box and merges className last", () => {
    render(<Checkbox aria-invalid aria-label="Terms" className="mt-2" />)
    const box = screen.getByRole("checkbox", { name: "Terms" })
    expect(box.getAttribute("aria-invalid")).toBe("true")
    expect(box.className).toContain("aria-invalid:edge-invalid")
    expect(box.className.trim().endsWith("mt-2")).toBe(true)
  })

  it("leaves the focus ring to a parent when asked", () => {
    render(<Checkbox focus="parent" aria-label="Terms" />)
    expect(screen.getByRole("checkbox").className).not.toMatch(
      /(^|\s)focus-ring(\s|$)/
    )
  })

  it("submits name and value in a native form only when ticked", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <form>
        <Checkbox name="diet" value="vegan" defaultChecked aria-label="Vegan" />
        <Checkbox name="diet" value="halal" aria-label="Halal" />
        <Checkbox name="terms" aria-label="Terms" />
      </form>
    )
    const form = container.querySelector("form")!
    await user.click(screen.getByRole("checkbox", { name: "Terms" }))
    expect(submitted(form)).toEqual([
      ["diet", "vegan"],
      ["terms", "on"],
    ])
  })

  it("required: an empty box stops the form", () => {
    const { container } = render(
      <form>
        <Checkbox name="terms" required aria-label="Terms" />
      </form>
    )
    const form = container.querySelector("form")!
    expect(screen.getByRole("checkbox").getAttribute("aria-required")).toBe(
      "true"
    )
    expect(form.checkValidity()).toBe(false)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(form.checkValidity()).toBe(true)
  })
})

describe("RadioGroup", () => {
  function Sizes(props: Partial<React.ComponentProps<typeof RadioGroup>>) {
    return (
      <RadioGroup aria-label="Portion" name="portion" {...props}>
        <label>
          <Radio value="small" />
          Small
        </label>
        <label>
          <Radio value="regular" />
          Regular
        </label>
        <label>
          <Radio value="large" />
          Large
        </label>
      </RadioGroup>
    )
  }

  it("is a named radiogroup, vertical unless told otherwise", () => {
    const { rerender } = render(<Sizes />)
    const group = screen.getByRole("radiogroup", { name: "Portion" })
    expect(group.getAttribute("data-slot")).toBe("radio-group")
    expect(group.getAttribute("data-orientation")).toBe("vertical")
    expect(group.getAttribute("aria-orientation")).toBe("vertical")
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(3)
    expect(radios[0].getAttribute("data-slot")).toBe("radio")
    expect(radios[0].className).toContain("rounded-round")
    expect(radios[0].className).toContain("size-6")
    expect(radios[0].className).toContain("after:-inset-2.5")

    rerender(<Sizes orientation="horizontal" className="gap-8" />)
    expect(group.getAttribute("data-orientation")).toBe("horizontal")
    expect(group.getAttribute("aria-orientation")).toBe("horizontal")
    expect(group.className.trim().endsWith("gap-8")).toBe(true)
  })

  it("chooses on click and shows the dot", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Sizes onValueChange={onValueChange} />)
    await user.click(screen.getByText("Regular"))
    const regular = screen.getByRole("radio", { name: "Regular" })
    expect(regular.getAttribute("aria-checked")).toBe("true")
    expect(regular.querySelector("svg")).not.toBeNull()
    expect(onValueChange).toHaveBeenLastCalledWith("regular", expect.anything())
    expect(
      screen.getByRole("radio", { name: "Small" }).querySelector("svg")
    ).toBeNull()
  })

  it("is one tab stop and the arrow keys move the choice", async () => {
    const user = userEvent.setup()
    render(
      <>
        <Sizes defaultValue="small" />
        <button type="button">After</button>
      </>
    )
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Small" })
    )
    await user.keyboard("{ArrowDown}")
    const regular = screen.getByRole("radio", { name: "Regular" })
    expect(document.activeElement).toBe(regular)
    expect(regular.getAttribute("aria-checked")).toBe("true")
    await user.keyboard("{ArrowRight}")
    expect(
      screen.getByRole("radio", { name: "Large" }).getAttribute("aria-checked")
    ).toBe("true")
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" })
    )
  })

  it("submits the chosen value under the group's name", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <form>
        <Sizes defaultValue="small" />
      </form>
    )
    const form = container.querySelector("form")!
    expect(submitted(form)).toEqual([["portion", "small"]])
    await user.click(screen.getByText("Large"))
    expect(submitted(form)).toEqual([["portion", "large"]])
  })

  it("required: no choice stops the form", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <form>
        <Sizes required />
      </form>
    )
    const form = container.querySelector("form")!
    expect(form.checkValidity()).toBe(false)
    await user.click(screen.getByText("Small"))
    expect(form.checkValidity()).toBe(true)
  })

  it("aria-disabled radio cannot be chosen by pointer", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <RadioGroup
        aria-label="Portion"
        defaultValue="small"
        onValueChange={onValueChange}
      >
        <label>
          <Radio value="small" />
          Small
        </label>
        <label>
          <Radio value="large" aria-disabled />
          Large
        </label>
      </RadioGroup>
    )
    const large = screen.getByRole("radio", { name: "Large" })
    expect(large.getAttribute("aria-disabled")).toBe("true")
    await user.click(large)
    await user.click(screen.getByText("Large"))
    expect(onValueChange).not.toHaveBeenCalled()
    expect(large.getAttribute("aria-checked")).toBe("false")
  })

  it("arrow keys and Tab skip an aria-disabled radio, so its reason is visible text", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <>
        <RadioGroup
          aria-label="Portion"
          defaultValue="small"
          onValueChange={onValueChange}
        >
          <OptionRow type="radio" value="small" label="Small" />
          <OptionRow
            type="radio"
            value="medium"
            label="Medium"
            aria-disabled
            reason="Sold out today"
          />
          <OptionRow type="radio" value="large" label="Large" />
        </RadioGroup>
        <button type="button">After</button>
      </>
    )
    const small = screen.getByRole("radio", { name: "Small" })
    const medium = screen.getByRole("radio", { name: "Medium" })
    const large = screen.getByRole("radio", { name: "Large" })
    await user.tab()
    expect(document.activeElement).toBe(small)
    await user.keyboard("{ArrowDown}")
    // Base UI's roving focus leaves out aria-disabled items.
    expect(document.activeElement).toBe(large)
    expect(onValueChange).toHaveBeenLastCalledWith("large", expect.anything())
    await user.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(small)
    expect(medium.getAttribute("aria-checked")).toBe("false")
    expect(medium.getAttribute("tabindex")).toBe("-1")
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" })
    )
    // Focus never lands on it, so the reason is on the page as text and is
    // still its description for a screen reader reading through the group.
    const reason = screen.getByText("Sold out today")
    expect(medium.getAttribute("aria-describedby")).toContain(reason.id)
    expect(medium.getAttribute("aria-disabled")).toBe("true")
  })

  it("a disabled group disables every radio", () => {
    render(<Sizes disabled />)
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true")
    }
  })
})

describe("OptionRow", () => {
  it("as a checkbox: the row is the label, the hint is the description", async () => {
    const user = userEvent.setup()
    render(
      <OptionRow
        type="checkbox"
        name="notify"
        label="Tell me when a photo is accepted"
        hint="One message a day at most"
        end="Email"
      />
    )
    const box = screen.getByRole("checkbox", {
      name: "Tell me when a photo is accepted",
      description: "One message a day at most",
    })
    const row = box.closest("[data-slot=option-row]")!
    expect(row.tagName).toBe("LABEL")
    expect(row.getAttribute("data-type")).toBe("checkbox")
    expect(row.getAttribute("data-size")).toBe("md")
    expect(row.className).toContain("min-h-12")
    expect(row.className).toContain("focus-ring-within")
    expect(row.className).toContain("has-data-checked:bg-accent-soft")
    expect(row.className).toContain("has-data-checked:edge-selected")
    // The row draws focus, so the mark inside does not.
    expect(box.className).not.toMatch(/(^|\s)focus-ring(\s|$)/)
    expect(row.querySelector("[data-slot=option-row-end]")?.textContent).toBe(
      "Email"
    )

    await user.click(screen.getByText("One message a day at most"))
    expect(box.getAttribute("aria-checked")).toBe("true")
  })

  it.each([
    ["sm", "min-h-11"],
    ["md", "min-h-12"],
    ["lg", "min-h-12"],
  ] as const)("size %s is %s", (size, height) => {
    render(<OptionRow type="checkbox" label="Vegan" size={size} />)
    const row = screen.getByRole("checkbox").closest("label")!
    expect(row.getAttribute("data-size")).toBe(size)
    expect(row.className).toContain(height)
  })

  it("as radios in a group: one choice, arrow keys, form value", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <form>
        <RadioGroup aria-label="Where is it served" name="area">
          <OptionRow type="radio" value="bar" label="Bar" />
          <OptionRow
            type="radio"
            value="garden"
            label="Garden"
            hint="Summer only"
          />
        </RadioGroup>
      </form>
    )
    const form = container.querySelector("form")!
    const bar = screen.getByRole("radio", { name: "Bar" })
    const garden = screen.getByRole("radio", {
      name: "Garden",
      description: "Summer only",
    })
    expect(bar.closest("label")?.getAttribute("data-type")).toBe("radio")

    await user.click(screen.getByText("Bar"))
    expect(bar.getAttribute("aria-checked")).toBe("true")
    await user.keyboard("{ArrowDown}")
    expect(garden.getAttribute("aria-checked")).toBe("true")
    expect(bar.getAttribute("aria-checked")).toBe("false")
    expect(submitted(form)).toEqual([["area", "garden"]])
  })

  it("aria-disabled: keeps the label, shows the reason and cannot be chosen", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <OptionRow
        type="checkbox"
        label="Show on the public menu"
        reason="A manager has to accept a photo first."
        aria-disabled
        onCheckedChange={onCheckedChange}
      />
    )
    const box = screen.getByRole("checkbox", {
      name: "Show on the public menu",
      description: "A manager has to accept a photo first.",
    })
    expect(box.getAttribute("aria-disabled")).toBe("true")
    await user.tab()
    expect(document.activeElement).toBe(box)
    await user.click(screen.getByText("Show on the public menu"))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it("hides the reason while the row can be chosen", () => {
    render(
      <OptionRow type="checkbox" label="Vegan" reason="Not for this dish." />
    )
    expect(screen.queryByText("Not for this dish.")).toBeNull()
    expect(screen.getByRole("checkbox").hasAttribute("aria-describedby")).toBe(
      false
    )
  })

  it("disabled: shows the reason and stays out of the form", () => {
    const { container } = render(
      <form>
        <OptionRow
          type="checkbox"
          name="vegan"
          defaultChecked
          disabled
          label="Vegan"
          reason="Set by the menu import."
        />
      </form>
    )
    expect(
      screen.getByRole("checkbox", {
        name: "Vegan",
        description: "Set by the menu import.",
      })
    ).toHaveProperty("ariaDisabled", "true")
    expect(submitted(container.querySelector("form")!)).toEqual([])
  })

  it("invalid: the mark says so and the row has the invalid edge rule", () => {
    render(<OptionRow type="checkbox" label="Terms" aria-invalid />)
    const box = screen.getByRole("checkbox", { name: "Terms" })
    expect(box.getAttribute("aria-invalid")).toBe("true")
    expect(box.closest("label")!.className).toContain(
      "has-aria-invalid:edge-invalid"
    )
  })
})

describe("SelectableTile", () => {
  it("is a checkbox named Select, then Selected, with the photo's label", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <SelectableTile label="Bar, photo 2" onCheckedChange={onCheckedChange}>
        <div data-testid="photo" />
      </SelectableTile>
    )
    const box = screen.getByRole("checkbox", { name: "Select Bar, photo 2" })
    const tile = box.closest("[data-slot=selectable-tile]")!
    expect(tile.tagName).toBe("LABEL")
    expect(tile.className).toContain("focus-ring-within")
    expect(tile.hasAttribute("data-checked")).toBe(false)
    expect(
      tile.querySelector("[data-slot=selectable-tile-plate]")?.className
    ).toContain("size-11")

    // The whole tile is the target.
    await user.click(screen.getByTestId("photo"))
    expect(
      screen.getByRole("checkbox", { name: "Selected Bar, photo 2" })
    ).toBe(box)
    expect(box.getAttribute("aria-checked")).toBe("true")
    expect(tile.hasAttribute("data-checked")).toBe(true)
    expect(
      tile.querySelector("[data-slot=selectable-tile-ring]")?.className
    ).toContain("group-data-checked/tile:ring-selected")
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())

    await user.keyboard(" ")
    expect(box.getAttribute("aria-checked")).toBe("false")
  })

  it("follows a controlled value", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <SelectableTile label="Photo 1" checked onCheckedChange={onCheckedChange}>
        <div />
      </SelectableTile>
    )
    const box = screen.getByRole("checkbox", { name: "Selected Photo 1" })
    await user.click(box)
    expect(onCheckedChange).toHaveBeenLastCalledWith(false, expect.anything())
    expect(box.getAttribute("aria-checked")).toBe("true")
  })

  it("submits its name and value when picked", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <form>
        <SelectableTile label="Photo 1" name="photo" value="p1">
          <div />
        </SelectableTile>
        <SelectableTile label="Photo 2" name="photo" value="p2" defaultChecked>
          <div />
        </SelectableTile>
      </form>
    )
    const form = container.querySelector("form")!
    expect(submitted(form)).toEqual([["photo", "p2"]])
    await user.click(screen.getByRole("checkbox", { name: "Select Photo 1" }))
    expect(submitted(form)).toEqual([
      ["photo", "p1"],
      ["photo", "p2"],
    ])
  })

  it("ineligible: the reason stands in for the control", async () => {
    const user = userEvent.setup()
    render(
      <>
        <SelectableTile label="Photo 3" ineligible="Too dark to use">
          <div />
        </SelectableTile>
        <button type="button">After</button>
      </>
    )
    expect(screen.queryByRole("checkbox")).toBeNull()
    const tile = document.querySelector("[data-slot=selectable-tile]")!
    expect(tile.tagName).toBe("DIV")
    expect(tile.hasAttribute("data-ineligible")).toBe(true)
    expect(tile.textContent).toContain("Photo 3: Too dark to use")
    expect(tile.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" })
    )
  })

  it("aria-disabled: reachable, described, and not picked", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <>
        <SelectableTile
          label="Photo 4"
          aria-disabled
          aria-describedby="limit"
          onCheckedChange={onCheckedChange}
        >
          <div data-testid="photo" />
        </SelectableTile>
        <p id="limit">You can pick up to three photos.</p>
      </>
    )
    const box = screen.getByRole("checkbox", {
      name: "Select Photo 4",
      description: "You can pick up to three photos.",
    })
    expect(box.closest("label")!.hasAttribute("data-disabled")).toBe(true)
    await user.tab()
    expect(document.activeElement).toBe(box)
    await user.click(screen.getByTestId("photo"))
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(box.getAttribute("aria-checked")).toBe("false")
  })
})
