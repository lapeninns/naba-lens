// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuDiffView, countUnresolved } from "@/components/nabalens/menus"
import type { MenuDiff, MenuDocument } from "@/lib/menus/types"

afterEach(cleanup)

const diff: MenuDiff = {
  added: [
    {
      sourceKey: "mains--pie",
      itemId: null,
      name: "Pie",
      sectionName: "Mains",
    },
  ],
  changed: [
    {
      sourceKey: "mains--curry",
      itemId: "i-curry",
      name: "Lamb curry",
      sectionName: "Mains",
      fields: ["name", "variants"],
      before: { name: "Curry", variants: ["Veg"] },
    },
  ],
  removed: [
    {
      sourceKey: "mains--stew",
      itemId: "i-stew",
      name: "Stew",
      sectionName: "Mains",
    },
  ],
  uncertain: [
    {
      sourceKey: "mains--fish-and-chips",
      itemId: null,
      name: "Fish and chips",
      sectionName: "Mains",
      reason: "Same name as an existing item with a different key.",
      candidates: [
        {
          sourceKey: "classics--fish-and-chips",
          itemId: "i-fish",
          name: "Fish and chips",
          sectionName: "Classics",
        },
      ],
    },
    {
      sourceKey: "drinks--cola",
      itemId: null,
      name: "Cola",
      sectionName: "Drinks",
      reason: "Name matches an existing item.",
      candidates: [
        {
          sourceKey: "soft--cola",
          itemId: "i-cola",
          name: "Cola",
          sectionName: "Soft drinks",
        },
      ],
    },
  ],
  unchangedCount: 40,
}

const doc: MenuDocument = {
  title: "Next",
  sections: [
    {
      slug: "mains",
      name: "Mains",
      kind: "food",
      items: [
        {
          itemId: "i-curry",
          sourceKey: "mains--curry",
          name: "Lamb curry",
          description: null,
          aliases: [],
          sourceMeta: {},
          variants: [
            { variantId: "v1", name: "Veg" },
            { variantId: null, name: "Lamb" },
          ],
          review: null,
        },
      ],
    },
  ],
}

describe("MenuDiffView", () => {
  it("shows the counts, before → after and removed-item label warnings", () => {
    render(
      <MenuDiffView diff={diff} document={doc} labelCounts={{ "i-stew": 3 }} />
    )
    const count = (label: string) =>
      screen.getByTestId(`diff-count-${label}`).querySelector("dd")?.textContent
    expect(count("added")).toBe("1")
    expect(count("changed")).toBe("1")
    expect(count("removed")).toBe("1")
    expect(count("uncertain")).toBe("2")
    expect(count("unchanged")).toBe("40")

    const changed = screen.getByRole("region", { name: "Changed (1)" })
    const text = changed.textContent?.replace(/\s+/g, " ")
    expect(text).toContain("Name: Curry → changed to Lamb curry")
    expect(text).toContain("Variants: Veg → changed to Veg, Lamb")

    const removed = screen.getByRole("region", { name: "Removed (1)" })
    expect(removed.textContent).toContain(
      "3 labelled photos/videos keep this item"
    )
    expect(removed.textContent).toContain("The items are not deleted.")
  })

  it("blocks activation until uncertain matches are resolved and reports decisions", async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    render(<MenuDiffView diff={diff} onDecide={onDecide} />)

    expect(screen.getByText("2 uncertain matches to resolve")).toBeTruthy()
    expect(
      screen.getByText(/Activation is blocked until every uncertain match/)
    ).toBeTruthy()

    const fish = screen.getByRole("group", { name: /Fish and chips in Mains/ })
    const confirmFish = within(fish).getByRole("button", {
      name: "Confirm decision for Fish and chips",
    })
    expect(confirmFish.hasAttribute("disabled")).toBe(true)
    await user.click(
      within(fish).getByRole("radio", {
        name: "Same item as “Fish and chips” (Classics)",
      })
    )
    await user.click(confirmFish)
    expect(onDecide).toHaveBeenLastCalledWith("mains--fish-and-chips", {
      kind: "same",
      itemId: "i-fish",
    })

    const cola = screen.getByRole("group", { name: /Cola in Drinks/ })
    // Keyboard only: focus the radio group, arrow to "new", confirm.
    within(cola)
      .getByRole("radio", { name: /Same item as “Cola”/ })
      .focus()
    await user.keyboard(" ")
    await user.keyboard("{ArrowDown}")
    expect(
      (
        within(cola).getByRole("radio", {
          name: "Treat as new item",
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    within(cola)
      .getByRole("button", { name: "Confirm decision for Cola" })
      .focus()
    await user.keyboard("{Enter}")
    expect(onDecide).toHaveBeenLastCalledWith("drinks--cola", { kind: "new" })
  })

  it("counts decisions as resolved", () => {
    const decisions = {
      "mains--fish-and-chips": { kind: "same", itemId: "i-fish" } as const,
    }
    expect(countUnresolved(diff, decisions)).toBe(1)
    const { rerender } = render(
      <MenuDiffView diff={diff} decisions={decisions} onDecide={vi.fn()} />
    )
    expect(screen.getByText("1 uncertain match to resolve")).toBeTruthy()
    expect(
      screen.getByText("Resolved: same item as “Fish and chips”")
    ).toBeTruthy()
    rerender(
      <MenuDiffView
        diff={diff}
        decisions={{ ...decisions, "drinks--cola": { kind: "new" } }}
        onDecide={vi.fn()}
      />
    )
    expect(screen.getByText("All uncertain matches are resolved.")).toBeTruthy()
  })

  it("says when nothing changed", () => {
    render(
      <MenuDiffView
        diff={{
          added: [],
          changed: [],
          removed: [],
          uncertain: [],
          unchangedCount: 5,
        }}
      />
    )
    expect(
      screen.getByText("No differences from the active menu.")
    ).toBeTruthy()
  })
})
