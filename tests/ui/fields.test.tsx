// @vitest-environment jsdom
// The field family (common-room.md §4 Field): Input, Textarea and the Select
// trigger share one recipe, FormField links label, hint and error, and
// SearchField clears and announces its result count.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Combobox } from "@/components/ui/combobox"
import { Field, FieldError, FieldLabel, FormField } from "@/components/ui/field"
import { fieldControlVariants } from "@/components/ui/field-control"
import { Input } from "@/components/ui/input"
import { OPTION_ITEM_FOCUS } from "@/components/ui/option-item"
import { OptionRow } from "@/components/ui/option-row"
import { RadioGroup } from "@/components/ui/radio-group"
import { SearchField } from "@/components/ui/search-field"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

afterEach(cleanup)

const classes = (element: Element) => element.className.split(/\s+/)

// What makes a field a field, whatever element draws it.
const RECIPE = [
  "w-full",
  "rounded-control",
  "bg-surface-2",
  "edge-strong",
  "focus-ring",
  "hover:bg-raised",
  "aria-invalid:edge-invalid",
  "placeholder:text-ink-muted",
  "disabled:text-ink-muted",
  "aria-disabled:text-ink-muted",
  "forced-colors:border",
]

const VENUES = [
  { value: "crown", label: "The Crown" },
  { value: "anchor", label: "The Anchor" },
]

function VenueSelect(props: {
  id?: string
  size?: "sm" | "md"
  defaultOpen?: boolean
  defaultValue?: string
  disabled?: boolean
  "aria-invalid"?: true
  "aria-describedby"?: string
}) {
  const { defaultOpen, defaultValue, disabled, ...trigger } = props
  return (
    <Select
      items={VENUES}
      defaultOpen={defaultOpen}
      defaultValue={defaultValue ?? null}
      disabled={disabled}
    >
      <SelectTrigger {...trigger}>
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {VENUES.map((venue) => (
          <SelectItem key={venue.value} value={venue.value}>
            {venue.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

describe("the shared field recipe", () => {
  it("gives Input, Textarea and the Select trigger the same look", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Reason" />
        <VenueSelect aria-describedby="x" />
      </>
    )
    const input = screen.getByRole("textbox", { name: "Name" })
    const textarea = screen.getByRole("textbox", { name: "Reason" })
    const trigger = screen.getByRole("combobox")
    for (const control of [input, textarea, trigger])
      for (const cls of RECIPE)
        expect(classes(control), `${control.tagName} ${cls}`).toContain(cls)
  })

  it("uses the same word for the same height on Input and Select", () => {
    render(
      <>
        <Input aria-label="md input" />
        <Input aria-label="sm input" size="sm" />
        <VenueSelect id="md-select" />
        <VenueSelect id="sm-select" size="sm" />
      </>
    )
    const md = [
      screen.getByRole("textbox", { name: "md input" }),
      document.getElementById("md-select")!,
    ]
    const sm = [
      screen.getByRole("textbox", { name: "sm input" }),
      document.getElementById("sm-select")!,
    ]
    for (const control of md) {
      expect(control.getAttribute("data-size")).toBe("md")
      expect(classes(control)).toContain("min-h-14")
      expect(classes(control)).toContain("text-field")
    }
    for (const control of sm) {
      expect(control.getAttribute("data-size")).toBe("sm")
      expect(classes(control)).toContain("min-h-11")
      expect(classes(control)).not.toContain("min-h-14")
    }
  })

  it("sets a minimum height, never a fixed one", () => {
    for (const size of ["sm", "md"] as const)
      expect(fieldControlVariants({ size })).not.toMatch(/(^|\s)h-\d/)
  })
})

describe("Input", () => {
  it("names its slot and lets a caller's class win", () => {
    render(<Input aria-label="Name" className="min-h-20" />)
    const input = screen.getByRole("textbox")
    expect(input.getAttribute("data-slot")).toBe("input")
    expect(classes(input)).toContain("min-h-20")
    expect(classes(input)).not.toContain("min-h-14")
  })

  it("stays focusable but cannot be typed in when aria-disabled", async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Code" defaultValue="A1" aria-disabled="true" />)
    const input = screen.getByRole("textbox") as HTMLInputElement
    await user.tab()
    expect(document.activeElement).toBe(input)
    await user.keyboard("zz")
    expect(input.value).toBe("A1")
    expect(input.readOnly).toBe(true)
    expect(input.getAttribute("aria-disabled")).toBe("true")
  })

  it("leaves the focus order when disabled", async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Code" disabled />)
    await user.tab()
    expect(document.activeElement).toBe(document.body)
  })
})

describe("Textarea", () => {
  it("is at least three rows and 120px, resized downwards only", () => {
    render(<Textarea aria-label="Reason" />)
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea.getAttribute("data-slot")).toBe("textarea")
    expect(textarea.rows).toBe(3)
    expect(classes(textarea)).toContain("min-h-30")
    expect(classes(textarea)).not.toContain("min-h-14")
    expect(classes(textarea)).toContain("resize-y")
  })

  it("is read-only when aria-disabled and takes more rows when asked", async () => {
    const user = userEvent.setup()
    render(
      <Textarea
        aria-label="Reason"
        rows={6}
        defaultValue="Sent"
        aria-disabled
      />
    )
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.rows).toBe(6)
    await user.click(textarea)
    await user.keyboard("zz")
    expect(textarea.value).toBe("Sent")
  })
})

describe("Select", () => {
  it("draws the menu's keyboard focus outline on every option", async () => {
    render(<VenueSelect defaultOpen defaultValue="anchor" />)
    const options = await screen.findAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual([
      "The Crown",
      "The Anchor",
    ])
    expect(OPTION_ITEM_FOCUS).toBe("focus-ring-inset")
    for (const option of options) {
      expect(classes(option)).toContain(OPTION_ITEM_FOCUS)
      expect(option.getAttribute("data-slot")).toBe("select-item")
    }
  })

  it("marks the chosen option with more than colour", async () => {
    render(<VenueSelect defaultOpen defaultValue="anchor" />)
    const chosen = await screen.findByRole("option", { name: "The Anchor" })
    expect(chosen.getAttribute("aria-selected")).toBe("true")
    expect(chosen.querySelector("svg")).not.toBeNull()
    const other = screen.getByRole("option", { name: "The Crown" })
    expect(other.querySelector("svg")).toBeNull()
  })

  it("opens from the keyboard and chooses with Enter", async () => {
    const user = userEvent.setup()
    render(<VenueSelect />)
    const trigger = screen.getByRole("combobox")
    expect(trigger.textContent).toContain("Choose…")
    trigger.focus()
    await user.keyboard("{Enter}")
    await screen.findAllByRole("option")
    await user.keyboard("{ArrowDown}{Enter}")
    expect(trigger.textContent).toMatch(/The (Crown|Anchor)/)
  })

  it("uses the motion token on the popup, not a number", async () => {
    render(<VenueSelect defaultOpen />)
    await screen.findAllByRole("option")
    const popup = document.querySelector('[data-slot="select-content"]')!
    expect(classes(popup)).toContain("duration-quick")
    expect(popup.className).not.toMatch(/duration-\d/)
  })
})

describe("FieldLabel and FieldError", () => {
  it("adds the optional suffix one way", () => {
    render(<FieldLabel optional>Phone number</FieldLabel>)
    const label = screen.getByText("Phone number")
    expect(label.textContent).toBe("Phone number (optional)")
    const suffix = label.querySelector('[data-slot="field-optional"]')!
    expect(classes(suffix)).toContain("text-ink-muted")
  })

  it("has no suffix unless asked", () => {
    render(<FieldLabel>Phone number</FieldLabel>)
    expect(screen.getByText("Phone number").textContent).toBe("Phone number")
  })

  it("is an alert with an icon and words by default", () => {
    render(<FieldError>Enter a name.</FieldError>)
    const error = screen.getByRole("alert")
    expect(error.textContent).toBe("Enter a name.")
    expect(error.querySelector("svg[aria-hidden]")).not.toBeNull()
    expect(error.getAttribute("data-slot")).toBe("field-error")
  })

  it("can be polite, for a form that has its own assertive notice", () => {
    render(<FieldError announce="polite">Enter a name.</FieldError>)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toBe("Enter a name.")
  })

  it("renders nothing without a message, and lists several", () => {
    const { container, rerender } = render(<FieldError errors={[]} />)
    expect(container.innerHTML).toBe("")
    rerender(
      <FieldError
        errors={[{ message: "One" }, { message: "Two" }, { message: "One" }]}
      />
    )
    expect(
      within(screen.getByRole("alert"))
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(["One", "Two"])
  })

  it("keeps Field a group for existing callers", () => {
    render(<Field aria-label="Address" />)
    expect(screen.getByRole("group", { name: "Address" })).toBeTruthy()
  })
})

// The element form of FormField must wire every control built beside it,
// not only the native ones (review A11Y-2 and R4).
describe("FormField with the composite controls", () => {
  const DISHES = [
    { value: "soup", label: "Soup" },
    { value: "pie", label: "Pie" },
  ]

  it("Combobox: label, error, aria-invalid and required reach the input", () => {
    const { container } = render(
      <FormField label="Dish" error="Pick a dish.">
        <Combobox items={DISHES} />
      </FormField>
    )
    const input = screen.getByRole("combobox", { name: "Dish" })
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-required")).toBe("true")
    const error = screen.getByText("Pick a dish.").closest("[id]")!
    expect(input.getAttribute("aria-describedby")).toContain(error.id)
    expect(
      container.querySelector('[data-slot="combobox"][data-invalid]')
    ).not.toBeNull()
  })

  it("Combobox: no error leaves it valid, and optional leaves it not required", () => {
    render(
      <FormField label="Dish" optional>
        <Combobox items={DISHES} />
      </FormField>
    )
    const input = screen.getByRole("combobox", { name: /^Dish/ })
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.hasAttribute("aria-required")).toBe(false)
  })

  it("Select: the trigger takes the label, the error and aria-invalid", () => {
    render(
      <FormField
        label="Venue"
        error="Choose a venue."
        description="Where you work"
      >
        <Select name="venue">
          <SelectTrigger>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">The Railway</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
    )
    const trigger = screen.getByRole("combobox", { name: "Venue" })
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger")
    expect(trigger.getAttribute("aria-invalid")).toBe("true")
    const described = trigger.getAttribute("aria-describedby") ?? ""
    expect(described).toContain(
      screen.getByText("Choose a venue.").closest("[id]")!.id
    )
    expect(described).toContain(screen.getByText("Where you work").id)
  })

  it("Select: the trigger's own wiring wins over the field's", () => {
    render(
      <FormField label="Venue" error="Choose a venue.">
        <Select name="venue">
          <SelectTrigger aria-invalid={false} aria-describedby="mine">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
        </Select>
      </FormField>
    )
    const trigger = screen.getByRole("combobox", { name: "Venue" })
    expect(trigger.getAttribute("aria-invalid")).toBe("false")
    expect(trigger.getAttribute("aria-describedby")).toBe("mine")
  })

  it("SegmentedControl: the group is named by the field's label", () => {
    render(
      <FormField label="Media" error="Choose one.">
        <SegmentedControl
          options={[
            { value: "photo", label: "Photos" },
            { value: "video", label: "Videos" },
          ]}
        />
      </FormField>
    )
    const group = screen.getByRole("radiogroup", { name: "Media" })
    expect(group.getAttribute("aria-invalid")).toBe("true")
    expect(group.getAttribute("aria-describedby")).toContain(
      screen.getByText("Choose one.").closest("[id]")!.id
    )
  })

  it("RadioGroup: the group is named by the field's label", () => {
    render(
      <FormField label="Portion" optional description="You can change it later">
        <RadioGroup>
          <OptionRow type="radio" value="small" label="Small" />
          <OptionRow type="radio" value="large" label="Large" />
        </RadioGroup>
      </FormField>
    )
    const group = screen.getByRole("radiogroup", { name: /^Portion/ })
    expect(group.getAttribute("aria-describedby")).toBe(
      screen.getByText("You can change it later").id
    )
    expect(group.hasAttribute("aria-invalid")).toBe(false)
  })

  it("a control's own aria-label or aria-labelledby is kept", () => {
    render(
      <>
        <span id="mine">Mine</span>
        <FormField label="Name">
          <Input aria-label="Own name" />
        </FormField>
        <FormField label="Other">
          <Input aria-labelledby="mine" />
        </FormField>
      </>
    )
    expect(screen.getByRole("textbox", { name: "Own name" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Mine" })).toBeTruthy()
  })
})

describe("FormField", () => {
  it("links the label to its control and marks it required", () => {
    render(
      <FormField label="Full name">
        <Input name="name" />
      </FormField>
    )
    const input = screen.getByLabelText("Full name") as HTMLInputElement
    expect(input.id).not.toBe("")
    expect(input.required).toBe(true)
    expect(input.hasAttribute("aria-describedby")).toBe(false)
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    const field = input.closest('[data-slot="field"]')!
    expect(field.hasAttribute("role")).toBe(false)
  })

  it("describes the control by its error, then its hint, and marks it invalid", () => {
    render(
      <FormField
        label="Work email"
        description="We send your sign-in link here."
        error="Enter an email address."
      >
        <Input name="email" />
      </FormField>
    )
    const input = screen.getByRole("textbox", { name: "Work email" })
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const ids = input.getAttribute("aria-describedby")!.split(" ")
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[0])!.textContent).toBe(
      "Enter an email address."
    )
    expect(document.getElementById(ids[1])!.textContent).toBe(
      "We send your sign-in link here."
    )
    expect(
      screen.getByRole("textbox", {
        description: "Enter an email address. We send your sign-in link here.",
      })
    ).toBe(input)
    expect(
      input.closest('[data-slot="field"]')!.getAttribute("data-invalid")
    ).toBe("true")
    // Error before hint on screen, as in the spec.
    const error = document.getElementById(ids[0])!
    const hint = document.getElementById(ids[1])!
    expect(
      error.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("drops the links when the error goes", () => {
    const { rerender } = render(
      <FormField label="Name" error="Enter a name.">
        <Input />
      </FormField>
    )
    expect(screen.getByRole("alert")).toBeTruthy()
    rerender(
      <FormField label="Name" error={null}>
        <Input />
      </FormField>
    )
    const input = screen.getByRole("textbox")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.hasAttribute("aria-describedby")).toBe(false)
  })

  it("says optional in the label and does not require the control", () => {
    render(
      <FormField label="Phone number" optional>
        <Input type="tel" />
      </FormField>
    )
    const input = screen.getByLabelText(
      "Phone number (optional)"
    ) as HTMLInputElement
    expect(input.required).toBe(false)
  })

  it("keeps what the control sets itself", () => {
    render(
      <FormField label="Name" description="Hint">
        <Input id="own-id" aria-describedby="elsewhere" required={false} />
      </FormField>
    )
    const input = screen.getByLabelText("Name") as HTMLInputElement
    expect(input.id).toBe("own-id")
    expect(input.required).toBe(false)
    expect(input.getAttribute("aria-describedby")).toBe(
      "elsewhere own-id-description"
    )
  })

  it("hides the label from sight only", () => {
    render(
      <FormField label="Dish name" hideLabel>
        <Input />
      </FormField>
    )
    expect(screen.getByRole("textbox", { name: "Dish name" })).toBeTruthy()
    expect(classes(screen.getByText("Dish name"))).toContain("sr-only")
  })

  it("makes its field errors polite when asked", () => {
    render(
      <FormField label="Name" error="Enter a name." announce="polite">
        <Textarea />
      </FormField>
    )
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toBe("Enter a name.")
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe(
      "true"
    )
  })

  it("hands the wiring to a render function, for a Select", () => {
    render(
      <FormField label="Venue" error="Choose a venue.">
        {(control) => (
          <VenueSelect
            id={control.id}
            aria-invalid={control["aria-invalid"]}
            aria-describedby={control["aria-describedby"]}
          />
        )}
      </FormField>
    )
    const trigger = screen.getByRole("combobox", { name: "Venue" })
    expect(trigger.getAttribute("aria-invalid")).toBe("true")
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby")!)!
        .textContent
    ).toBe("Choose a venue.")
  })

  it("renders on the server with matching ids", () => {
    const html = renderToStaticMarkup(
      <FormField label="Name" description="As on your rota">
        <input name="name" />
      </FormField>
    )
    const forId = /<label[^>]*for="([^"]+)"/.exec(html)![1]
    expect(html).toContain(`id="${forId}"`)
    expect(html).toContain(`aria-describedby="${forId}-description"`)
    expect(html).toContain(`id="${forId}-description"`)
  })
})

describe("SearchField", () => {
  it("is a labelled search box with a decorative magnifier", () => {
    render(<SearchField label="Search people" name="q" />)
    const input = screen.getByRole("searchbox", { name: "Search people" })
    expect(input.getAttribute("name")).toBe("q")
    for (const cls of RECIPE) expect(classes(input)).toContain(cls)
    const root = input.closest('[data-slot="search-field"]')!
    expect(root.tagName).toBe("DIV")
    expect(root.getAttribute("data-size")).toBe("md")
    expect(
      root
        .querySelector('[data-slot="search-field-icon"]')!
        .getAttribute("aria-hidden")
    ).toBe("true")
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("can hide its label from sight only", () => {
    render(<SearchField label="Search dishes" hideLabel />)
    expect(
      screen.getByRole("searchbox", { name: "Search dishes" })
    ).toBeTruthy()
    expect(classes(screen.getByText("Search dishes"))).toContain("sr-only")
  })

  it("holds its own text: Clear search shows, empties and returns focus", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onClear = vi.fn()
    render(
      <SearchField
        label="Search people"
        onValueChange={onValueChange}
        onClear={onClear}
      />
    )
    const input = screen.getByRole("searchbox") as HTMLInputElement
    await user.type(input, "As")
    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([
      "A",
      "As",
    ])
    const clear = screen.getByRole("button", { name: "Clear search" })
    expect(clear.getAttribute("type")).toBe("button")
    expect(clear.getAttribute("data-size")).toBe("icon")
    expect(classes(clear)).toContain("size-11")
    await user.click(clear)
    expect(input.value).toBe("")
    expect(onValueChange).toHaveBeenLastCalledWith("")
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull()
  })

  it("starts from a default value", () => {
    render(<SearchField label="Search" defaultValue="Soup" />)
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
      "Soup"
    )
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy()
  })

  it("follows a caller that holds the text", async () => {
    const user = userEvent.setup()
    function Held() {
      const [value, setValue] = useState("Asha")
      return (
        <SearchField
          label="Search"
          value={value}
          onValueChange={(next) => setValue(next.toUpperCase())}
        />
      )
    }
    render(<Held />)
    const input = screen.getByRole("searchbox") as HTMLInputElement
    await user.type(input, "x")
    expect(input.value).toBe("ASHAX")
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    expect(input.value).toBe("")
  })

  it("does not change a held value the caller ignores", async () => {
    const user = userEvent.setup()
    render(<SearchField label="Search" value="Asha" />)
    const input = screen.getByRole("searchbox") as HTMLInputElement
    await user.type(input, "x")
    expect(input.value).toBe("Asha")
  })

  it("can be reached and cleared from the keyboard", async () => {
    const user = userEvent.setup()
    render(<SearchField label="Search" defaultValue="Soup" />)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole("searchbox"))
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Clear search" })
    )
    await user.keyboard("{Enter}")
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("")
    expect(document.activeElement).toBe(screen.getByRole("searchbox"))
  })

  it("pressing Clear search does not blur the input first", async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<SearchField label="Search" defaultValue="soup" onBlur={onBlur} />)
    const input = screen.getByRole("searchbox", { name: "Search" })
    await user.click(input)
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    expect(onBlur).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it("has no Clear search while disabled or read-only", () => {
    render(
      <>
        <SearchField label="One" defaultValue="Soup" disabled />
        <SearchField label="Two" defaultValue="Soup" aria-disabled="true" />
        <SearchField label="Three" defaultValue="Soup" readOnly />
      </>
    )
    expect(screen.queryByRole("button")).toBeNull()
    expect(
      (screen.getByRole("searchbox", { name: "Two" }) as HTMLInputElement)
        .readOnly
    ).toBe(true)
  })

  it("puts the result count in a polite live region that is there from the start", () => {
    const { rerender } = render(<SearchField label="Search" resultCount="" />)
    const status = screen.getByRole("status")
    expect(status.textContent).toBe("")
    expect(status.getAttribute("data-slot")).toBe("search-field-count")
    rerender(<SearchField label="Search" resultCount="2 people" />)
    expect(screen.getByRole("status")).toBe(status)
    expect(status.textContent).toBe("2 people")
  })

  it("becomes a search form for a GET search, without submitting on clear", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <SearchField
        label="Search photos"
        name="q"
        defaultValue="soup"
        formProps={{ action: "/photos", onSubmit }}
      />
    )
    const form = screen.getByRole("search") as HTMLFormElement
    expect(form.tagName).toBe("FORM")
    expect(form.getAttribute("action")).toBe("/photos")
    expect(form.method).toBe("get")
    expect(form.getAttribute("data-slot")).toBe("search-field")
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    expect(onSubmit).not.toHaveBeenCalled()
    await user.type(screen.getByRole("searchbox"), "pie{Enter}")
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(new FormData(form).get("q")).toBe("pie")
  })

  it("uses the small size on the root and the input", () => {
    render(<SearchField label="Search" size="sm" />)
    const input = screen.getByRole("searchbox")
    expect(classes(input)).toContain("min-h-11")
    expect(
      input.closest('[data-slot="search-field"]')!.getAttribute("data-size")
    ).toBe("sm")
  })
})
