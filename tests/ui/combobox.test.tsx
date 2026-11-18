// @vitest-environment jsdom
import * as React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Combobox,
  type ComboboxOption,
  type ComboboxOptionGroup,
} from "@/components/ui/combobox"

afterEach(cleanup)

const DISHES: ComboboxOption[] = [
  { value: "soup", label: "Soup of the day", description: "Starters" },
  { value: "brulee", label: "Crème brûlée", description: "Puddings" },
  { value: "pie", label: "Steak and ale pie", keywords: ["beef"] },
  { value: "off", label: "Fish special", disabled: true },
]

const GROUPS: ComboboxOptionGroup[] = [
  { label: "Starters", items: [DISHES[0]] },
  { label: "Puddings", items: [DISHES[1]] },
]

const field = () => screen.getByRole("combobox", { name: "Menu item" })
const optionNames = () =>
  screen.getAllByRole("option").map((o) => o.textContent)

describe("Combobox", () => {
  it("is a labelled combobox with the field look at md", () => {
    render(
      <>
        <label htmlFor="dish">Menu item</label>
        <Combobox id="dish" items={DISHES} placeholder="Any menu item" />
      </>
    )
    const input = field()
    expect(input.tagName).toBe("INPUT")
    expect(input.getAttribute("aria-expanded")).toBe("false")
    expect(input.getAttribute("placeholder")).toBe("Any menu item")
    expect(input.getAttribute("data-slot")).toBe("combobox-input")
    const classes = input.className.split(" ")
    for (const name of [
      "h-14",
      "bg-surface",
      "edge-strong",
      "rounded-control",
      "text-field",
      "focus-ring",
      "aria-invalid:edge-invalid",
    ]) {
      expect(classes).toContain(name)
    }
    const root = input.closest('[data-slot="combobox"]')
    expect(root?.getAttribute("data-size")).toBe("md")
    expect(root?.hasAttribute("data-invalid")).toBe(false)
  })

  it.each([
    ["sm", "h-11"],
    ["md", "h-14"],
    ["lg", "h-15"],
  ] as const)("size %s is %s tall", (size, height) => {
    render(<Combobox aria-label="Menu item" items={DISHES} size={size} />)
    expect(field().className.split(" ")).toContain(height)
    expect(
      field().closest('[data-slot="combobox"]')?.getAttribute("data-size")
    ).toBe(size)
  })

  it("merges a layout class onto the wrapper last", () => {
    render(
      <Combobox aria-label="Menu item" items={DISHES} className="w-auto" />
    )
    const root = field().closest('[data-slot="combobox"]')!
    expect(root.className.split(" ")).toContain("w-auto")
    expect(root.className.split(" ")).not.toContain("w-full")
  })

  it("opens a listbox on click, with options at least 44px tall", async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Menu item" items={DISHES} />)
    await user.click(field())
    expect(field().getAttribute("aria-expanded")).toBe("true")
    const list = screen.getByRole("listbox")
    expect(field().getAttribute("aria-controls")).toBe(list.id)
    const options = within(list).getAllByRole("option")
    expect(options).toHaveLength(4)
    for (const option of options) {
      expect(option.className.split(" ")).toContain("min-h-11")
      expect(option.getAttribute("data-slot")).toBe("combobox-item")
    }
    expect(options[3].getAttribute("aria-disabled")).toBe("true")
  })

  it("narrows as you type, ignoring accents and matching keywords", async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Menu item" items={DISHES} />)
    await user.type(field(), "creme")
    expect(optionNames()).toEqual(["Crème brûléePuddings"])
    await user.clear(field())
    await user.type(field(), "beef")
    expect(optionNames()).toEqual(["Steak and ale pie"])
    await user.clear(field())
    await user.type(field(), "day soup")
    expect(optionNames()).toEqual(["Soup of the dayStarters"])
  })

  it("says so when nothing matches", async () => {
    const user = userEvent.setup()
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        emptyMessage="No menu items match."
      />
    )
    await user.type(field(), "zzz")
    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(screen.getByText("No menu items match.")).toBeTruthy()
  })

  it("chooses with the keyboard, fills the field and ticks the option", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        onValueChange={onValueChange}
      />
    )
    await user.click(field())
    await user.keyboard("{ArrowDown}")
    const first = screen.getAllByRole("option")[0]
    expect(first.hasAttribute("data-highlighted")).toBe(true)
    expect(field().getAttribute("aria-activedescendant")).toBe(first.id)
    // The keyboard highlight is an outline, not a tint alone.
    expect(first.className).toContain("data-highlighted:outline-3")
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onValueChange).toHaveBeenCalledWith(DISHES[1])
    expect((field() as HTMLInputElement).value).toBe("Crème brûlée")
    expect(field().getAttribute("aria-expanded")).toBe("false")

    await user.click(field())
    const chosen = screen.getByRole("option", { selected: true })
    expect(chosen.textContent).toContain("Crème brûlée")
    expect(
      chosen.querySelector('[data-slot="combobox-item-indicator"] svg')
    ).toBeTruthy()
  })

  it("Escape closes the list and keeps focus in the field", async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Menu item" items={DISHES} />)
    await user.click(field())
    await user.keyboard("{Escape}")
    expect(field().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(field())
  })

  it("does not choose a disabled option", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        onValueChange={onValueChange}
      />
    )
    await user.click(field())
    await user.click(screen.getByRole("option", { name: /Fish special/ }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("shows groups with their labels", async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Menu item" items={GROUPS} />)
    await user.click(field())
    const groups = screen.getAllByRole("group")
    expect(groups).toHaveLength(2)
    expect(within(groups[0]).getByText("Starters", { selector: "div" }))
    expect(groups[0].getAttribute("aria-labelledby")).toBeTruthy()
    expect(within(groups[1]).getAllByRole("option")).toHaveLength(1)
  })

  it("renders options through children when given", async () => {
    const user = userEvent.setup()
    render(
      <Combobox aria-label="Menu item" items={DISHES}>
        {(item) => <em>{item.label.toUpperCase()}</em>}
      </Combobox>
    )
    await user.click(field())
    expect(screen.getByText("SOUP OF THE DAY").tagName).toBe("EM")
  })

  it("clears the choice with a named button", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        defaultValue={DISHES[0]}
        onValueChange={onValueChange}
        clearable
        clearLabel="Clear menu item"
      />
    )
    expect((field() as HTMLInputElement).value).toBe("Soup of the day")
    expect(field().className.split(" ")).toContain("pr-24")
    await user.click(screen.getByRole("button", { name: "Clear menu item" }))
    expect(onValueChange).toHaveBeenCalledWith(null)
    expect((field() as HTMLInputElement).value).toBe("")
  })

  it("emptying the field with the keyboard removes the choice", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        defaultValue={DISHES[0]}
        onValueChange={onValueChange}
      />
    )
    await user.clear(field())
    expect(onValueChange).toHaveBeenLastCalledWith(null)
  })

  it("has no clear button unless asked, and none with nothing chosen", () => {
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        defaultValue={DISHES[0]}
      />
    )
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
    cleanup()
    render(<Combobox aria-label="Menu item" items={DISHES} clearable />)
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
  })

  it("opens from the caret button", async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Menu item" items={DISHES} />)
    const caret = screen.getByRole("button", { name: "Show options" })
    // The field is the tab stop; the caret is for the pointer.
    expect(caret.getAttribute("tabindex")).toBe("-1")
    await user.click(caret)
    // Base UI opens a frame after the press.
    expect(await screen.findByRole("listbox")).toBeTruthy()
  })

  it("submits the chosen value under its name", () => {
    const { container } = render(
      <form>
        <Combobox
          aria-label="Menu item"
          items={DISHES}
          name="dish"
          defaultValue={DISHES[2]}
        />
      </form>
    )
    const form = container.querySelector("form")!
    expect(new FormData(form).get("dish")).toBe("pie")
  })

  it("disabled: the field and its buttons do not answer", async () => {
    const user = userEvent.setup()
    render(
      <Combobox
        aria-label="Menu item"
        items={DISHES}
        disabled
        placeholder="Choose a venue first"
      />
    )
    expect((field() as HTMLInputElement).disabled).toBe(true)
    expect(
      field().closest('[data-slot="combobox"]')?.hasAttribute("data-disabled")
    ).toBe(true)
    await user.click(field())
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("invalid: sets aria-invalid and points at the error", () => {
    render(
      <>
        <Combobox
          aria-label="Menu item"
          items={DISHES}
          invalid
          aria-describedby="err"
        />
        <p id="err">Error: choose a menu item.</p>
      </>
    )
    expect(field().getAttribute("aria-invalid")).toBe("true")
    expect(field().getAttribute("aria-describedby")).toContain("err")
    expect(
      field().closest('[data-slot="combobox"]')?.hasAttribute("data-invalid")
    ).toBe(true)
  })

  it("loading: the popup is busy and says so, not that nothing matches", async () => {
    const user = userEvent.setup()
    render(
      <Combobox
        aria-label="Menu item"
        items={[]}
        filter={null}
        loading
        loadingMessage="Loading menu items"
      />
    )
    await user.click(field())
    const popup = document.querySelector('[data-slot="combobox-popup"]')!
    expect(popup.getAttribute("aria-busy")).toBe("true")
    // Base UI marks a live region's first text for a moment so it is read.
    expect(await screen.findByText("Loading menu items")).toBeTruthy()
    expect(popup.querySelector('[data-slot="spinner"]')).toBeTruthy()
    expect(screen.queryByText("No matches.")).toBeNull()
  })

  it("async: reports typing and shows the items it is given unfiltered", async () => {
    const user = userEvent.setup()
    function Search() {
      const [text, setText] = React.useState("")
      // A stand-in for a server search: the result does not contain the query.
      const items = text ? [DISHES[2]] : []
      return (
        <>
          <Combobox
            aria-label="Menu item"
            items={items}
            filter={null}
            inputValue={text}
            onInputValueChange={setText}
          />
          <p data-testid="typed">{text}</p>
        </>
      )
    }
    render(<Search />)
    await user.type(field(), "xy")
    expect(screen.getByTestId("typed").textContent).toBe("xy")
    expect(optionNames()).toEqual(["Steak and ale pie"])
  })

  it("limit caps how many options are shown", async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Menu item" items={DISHES} limit={2} />)
    await user.click(field())
    expect(screen.getAllByRole("option")).toHaveLength(2)
  })
})
