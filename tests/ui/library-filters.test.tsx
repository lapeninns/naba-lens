// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  countActiveFilters,
  EMPTY_LIBRARY_FILTERS,
  LibraryFilters,
  type LibraryFilterValue,
  type LibraryMenuOptions,
} from "@/components/nabalens/library-filters"

const VENUES = [
  { id: "v1", name: "The Railway" },
  { id: "v2", name: "The Bell" },
]
const STAFF = [{ id: "s1", name: "Asha" }]

const MENU: LibraryMenuOptions = {
  venueId: "v1",
  categories: [
    { slug: "curries", name: "Curries" },
    { slug: "starters", name: "Starters" },
  ],
  items: [
    {
      id: "i1",
      name: "Lamb Bhuna",
      sectionName: "Curries",
      variants: [],
    },
    {
      id: "i2",
      name: "House Curry",
      sectionName: "Curries",
      variants: [
        { id: "x1", name: "Chicken" },
        { id: "x2", name: "Lamb" },
      ],
    },
    {
      id: "i3",
      name: "Onion Bhaji",
      sectionName: "Starters (not on active menu)",
      variants: [],
    },
  ],
}

afterEach(cleanup)

function setup(
  value: LibraryFilterValue = EMPTY_LIBRARY_FILTERS,
  menuOptions: LibraryMenuOptions | null = null
) {
  const onChange = vi.fn()
  const view = render(
    <LibraryFilters
      venues={VENUES}
      staff={STAFF}
      value={value}
      menuOptions={menuOptions}
      onChange={onChange}
    />
  )
  const rerender = (next: LibraryFilterValue, menu = menuOptions) =>
    view.rerender(
      <LibraryFilters
        venues={VENUES}
        staff={STAFF}
        value={next}
        menuOptions={menu}
        onChange={onChange}
      />
    )
  return { onChange, rerender, user: userEvent.setup() }
}

const withVenue = { ...EMPTY_LIBRARY_FILTERS, venueId: "v1" }

describe("LibraryFilters label search", () => {
  it("applies on Enter, tidied, and once on blur", async () => {
    const { onChange, user } = setup()
    const box = screen.getByRole("searchbox", {
      name: "Search labels and notes",
    })
    await user.type(box, "  lamb   bhuna {Enter}")
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_LIBRARY_FILTERS,
      query: "lamb bhuna",
    })
    // Leaving the box with the same text sends nothing more.
    await user.tab()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("applies with the Search button and on blur with changed text", async () => {
    const { onChange, user } = setup()
    const box = screen.getByRole("searchbox", {
      name: "Search labels and notes",
    })
    await user.type(box, "platter")
    await user.click(screen.getByRole("button", { name: "Search" }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "platter" })
    )
    expect(screen.getByRole("search", { name: "Library search" })).toBeTruthy()
  })

  it("clears the search with Escape and follows outside changes", async () => {
    const { onChange, rerender, user } = setup({
      ...EMPTY_LIBRARY_FILTERS,
      query: "lamb",
    })
    const box = screen.getByRole<HTMLInputElement>("searchbox", {
      name: "Search labels and notes",
    })
    expect(box.value).toBe("lamb")
    await user.click(box)
    await user.keyboard("{Escape}")
    expect(box.value).toBe("")
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: null })
    )
    rerender({ ...EMPTY_LIBRARY_FILTERS, query: "dal" })
    expect(box.value).toBe("dal")
  })
})

describe("LibraryFilters more filters", () => {
  it("opens a labelled disclosure and needs a venue for menu filters", async () => {
    const { user } = setup()
    const more = screen.getByRole("button", { name: /More filters/ })
    expect(more.getAttribute("aria-expanded")).toBe("false")
    await user.click(more)
    expect(more.getAttribute("aria-expanded")).toBe("true")

    const item = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Menu item",
    })
    expect(item.disabled).toBe(true)
    expect(item.getAttribute("aria-describedby")).toBeTruthy()
    expect(
      document.getElementById(item.getAttribute("aria-describedby")!)
        ?.textContent
    ).toMatch(/Choose a venue to filter by menu item/)
    const category = screen.getByLabelText("Category")
    expect(
      category.hasAttribute("disabled") ||
        category.getAttribute("data-disabled") !== null
    ).toBe(true)
    // Content type, labels and dates work without a venue.
    expect(screen.getByLabelText("Content type")).toBeTruthy()
    expect(screen.getByRole("group", { name: "Labels" })).toBeTruthy()
    expect(screen.getByLabelText("From")).toBeTruthy()
    expect(screen.getByLabelText("To")).toBeTruthy()
  })

  it("starts open, with a count, when a hidden filter is on", () => {
    setup({ ...withVenue, labelState: "unlabelled", from: "2026-10-01" })
    const more = screen.getByRole("button", { name: /More filters/ })
    expect(more.getAttribute("aria-expanded")).toBe("true")
    expect(more.textContent).toContain("2")
    expect(screen.getByText("3 filters on")).toBeTruthy()
  })

  it("waits for the menu of a newly chosen venue", async () => {
    const { user } = setup({ ...EMPTY_LIBRARY_FILTERS, venueId: "v2" }, MENU)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    const item = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Menu item",
    })
    expect(item.disabled).toBe(true)
    expect(screen.getByText(/Loading this venue's menu/)).toBeTruthy()
  })

  it("picks a menu item with the keyboard, then shows its variants", async () => {
    const { onChange, rerender, user } = setup(withVenue, MENU)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    const item = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Menu item",
    })
    expect(item.disabled).toBe(false)
    await user.click(item)
    await user.keyboard("curry")
    const list = screen.getByRole("listbox", { name: "Menu items" })
    expect(item.getAttribute("aria-expanded")).toBe("true")
    expect(
      [...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    ).toEqual(["House CurryCurries"])
    await user.keyboard("{ArrowDown}")
    expect(item.getAttribute("aria-activedescendant")).toBeTruthy()
    await user.keyboard("{Enter}")
    expect(onChange).toHaveBeenLastCalledWith({
      ...withVenue,
      itemId: "i2",
      variantId: null,
    })
    expect(item.getAttribute("aria-expanded")).toBe("false")

    rerender({ ...withVenue, itemId: "i2" })
    expect(item.value).toBe("House Curry")
    expect(screen.getByLabelText("Variant")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Clear menu item" }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...withVenue,
      itemId: null,
      variantId: null,
    })
  })

  it("hides Variant for items without variants and finds historical items", async () => {
    const { user } = setup({ ...withVenue, itemId: "i1" }, MENU)
    expect(screen.queryByLabelText("Variant")).toBeNull()
    const item = screen.getByRole("combobox", { name: "Menu item" })
    await user.clear(item)
    await user.type(item, "not on active")
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Onion BhajiStarters (not on active menu)",
    ])
    await user.keyboard("{Escape}")
    expect(item.getAttribute("aria-expanded")).toBe("false")
    expect((item as HTMLInputElement).value).toBe("Lamb Bhuna")
    await user.type(item, "zzz")
    expect(screen.getByText("No menu items match.")).toBeTruthy()
  })

  it("clears item, variant and category when the venue changes", async () => {
    const { onChange, user } = setup(
      { ...withVenue, itemId: "i2", variantId: "x1", category: "curries" },
      MENU
    )
    await user.click(screen.getByRole("combobox", { name: "Venue" }))
    await user.click(await screen.findByRole("option", { name: "The Bell" }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_LIBRARY_FILTERS,
      venueId: "v2",
    })
  })

  it("sets the label state and dates", async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    await user.click(screen.getByRole("button", { name: "Needs labels" }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_LIBRARY_FILTERS,
      labelState: "unlabelled",
    })
    await user.type(screen.getByLabelText("From"), "2026-10-25")
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "2026-10-25" })
    )
  })

  it("clears every filter and counts them", async () => {
    const all: LibraryFilterValue = {
      venueId: "v1",
      staffId: "s1",
      type: "video",
      itemId: "i2",
      variantId: "x1",
      category: "curries",
      contentType: "dish",
      labelState: "labelled",
      query: "lamb",
      from: "2026-10-01",
      to: "2026-10-31",
    }
    expect(countActiveFilters(all)).toBe(11)
    expect(
      countActiveFilters({ venueId: null, staffId: null, type: "all" })
    ).toBe(0)
    const { onChange, user } = setup(all, MENU)
    expect(screen.getByText("11 filters on")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_LIBRARY_FILTERS)
  })
})
