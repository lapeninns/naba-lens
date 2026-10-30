// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  LabelBadge,
  LabelSummary,
  labelBadgeText,
} from "@/components/nabalens/labels"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

import { summary, view } from "./labels-fixtures"

afterEach(cleanup)

describe("LabelSummary", () => {
  it("shows the empty variant", () => {
    render(<LabelSummary labels={EMPTY_LABEL_SUMMARY} />)
    expect(screen.getByText("No labels yet")).toBeTruthy()
    cleanup()
    render(<LabelSummary labels={null} />)
    expect(screen.getByText("No labels yet")).toBeTruthy()
  })

  it("shows items with variant, section, state and labelled-as, content types, note and missing item", () => {
    render(
      <LabelSummary
        labels={summary({
          items: [
            view("i1", "Tikka Masala", "House Specials", {
              variantId: "v1",
              variantName: "Lamb",
            }),
            view("i2", "Lamb Bhuna", "Curries", {
              state: "not_on_active_menu",
              labelledAs: "Lamb Bhoona",
            }),
            view("i3", "Prawn Puri", "Starters", { state: "archived" }),
          ],
          contentTypes: ["dish", "plating"],
          note: "Friday special",
          missingItem: "Lamb shank",
        })}
      />
    )
    const items = screen.getByRole("list", { name: "Menu items" })
    const rows = within(items).getAllByRole("listitem")
    expect(rows[0].textContent).toBe("Tikka Masala, Lamb · House Specials")
    expect(rows[1].textContent).toBe(
      "Lamb Bhuna · CurriesNot on the current menulabelled as Lamb Bhoona"
    )
    expect(rows[2].textContent).toContain("Archived")
    const types = screen.getByRole("list", { name: "Content types" })
    expect(
      within(types)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Finished dish", "Plating"])
    expect(screen.getByText("Friday special")).toBeTruthy()
    expect(screen.getByText("Lamb shank")).toBeTruthy()
  })
})

describe("LabelBadge", () => {
  it("shows Needs labels, a count, or nothing when unknown", () => {
    const { container, rerender } = render(
      <LabelBadge labels={EMPTY_LABEL_SUMMARY} />
    )
    expect(screen.getByText("Needs labels")).toBeTruthy()
    // A note alone does not make an asset labelled.
    rerender(<LabelBadge labels={summary({ note: "Just a note" })} />)
    expect(screen.getByText("Needs labels")).toBeTruthy()
    rerender(
      <LabelBadge
        labels={summary({
          items: [view("i1", "Chicken", "Korma Dishes")],
          contentTypes: ["dish"],
        })}
      />
    )
    expect(screen.getByText("2 labels")).toBeTruthy()
    rerender(<LabelBadge labels={null} />)
    expect(container.textContent).toBe("")
    expect(labelBadgeText(undefined)).toBeNull()
    expect(labelBadgeText(summary({ contentTypes: ["team"] }))).toBe("1 label")
  })
})
