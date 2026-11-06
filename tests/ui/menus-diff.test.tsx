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
      screen.getByTestId(`diff-count-${label}`).textContent
    expect(count("added")).toBe("+ 1 added")
    expect(count("changed")).toBe("~ 1 changed")
    expect(count("removed")).toBe("− 1 removed")
    expect(count("uncertain")).toBe("2 uncertain")
    expect(count("unchanged")).toBe("40 unchanged")

    const changed = screen.getByRole("region", { name: "Changed" })
    const text = changed.textContent?.replace(/\s+/g, " ")
    expect(text).toContain("Name Curry changed to Lamb curry")
    expect(text).toContain("Variants Veg changed to Veg, Lamb")

    const removed = screen.getByRole("region", { name: "Removed" })
    expect(removed.textContent).toContain(
      "3 labelled photos/videos keep this item"
    )
    expect(removed.textContent).toContain("the item is not deleted.")
  })

  it("shows changed source details as reference only", () => {
    render(
      <MenuDiffView
        diff={{
          ...diff,
          changed: [
            {
              ...diff.changed[0],
              fields: ["meta"],
              before: { meta: { price: "£13.95" } },
            },
          ],
        }}
        document={{
          ...doc,
          sections: doc.sections.map((s) => ({
            ...s,
            items: s.items.map((i) => ({
              ...i,
              sourceMeta: { price: "£14.50" },
            })),
          })),
        }}
      />
    )
    const changed = screen.getByRole("region", { name: "Changed" })
    expect(changed.textContent?.replace(/\s+/g, " ")).toContain(
      "Source price £13.95 changed to £14.50 · kept for reference only"
    )
  })

  it("asks for a decision on uncertain matches and reports it", async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    render(<MenuDiffView diff={diff} onDecide={onDecide} />)

    expect(screen.getByText("2 items · decide before activating")).toBeTruthy()

    const fish = screen.getByRole("group", { name: "Fish and chips in Mains" })
    await user.click(
      within(fish).getByRole("button", {
        name: "Same item as Fish and chips (Classics)",
      })
    )
    expect(onDecide).toHaveBeenLastCalledWith("mains--fish-and-chips", {
      kind: "same",
      itemId: "i-fish",
    })

    const cola = screen.getByRole("group", { name: "Cola in Drinks" })
    // Keyboard only.
    within(cola)
      .getByRole("button", { name: "Treat as new item: Cola" })
      .focus()
    await user.keyboard("{Enter}")
    expect(onDecide).toHaveBeenLastCalledWith("drinks--cola", { kind: "new" })
  })

  it("disables the choices while locked and hides them when read-only", () => {
    const { rerender } = render(
      <MenuDiffView diff={diff} onDecide={vi.fn()} locked />
    )
    const fish = screen.getByRole("group", { name: "Fish and chips in Mains" })
    expect(fish.hasAttribute("disabled")).toBe(true)
    rerender(<MenuDiffView diff={diff} readOnly />)
    expect(screen.queryByRole("button", { name: /Same item as/ })).toBeNull()
  })

  it("counts decisions as resolved", async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    const decisions = {
      "mains--fish-and-chips": { kind: "same", itemId: "i-fish" } as const,
    }
    expect(countUnresolved(diff, decisions)).toBe(1)
    const { rerender } = render(
      <MenuDiffView diff={diff} decisions={decisions} onDecide={onDecide} />
    )
    expect(screen.getByTestId("diff-count-uncertain").textContent).toBe(
      "1 uncertain"
    )
    expect(
      screen.getByText(
        "Same item as Fish and chips (Classics). Labels stay with it."
      )
    ).toBeTruthy()
    rerender(
      <MenuDiffView
        diff={diff}
        decisions={{ ...decisions, "drinks--cola": { kind: "new" } }}
        onDecide={onDecide}
      />
    )
    expect(screen.getByTestId("diff-count-uncertain").textContent).toBe(
      "0 uncertain"
    )
    expect(screen.getByText("2 decided")).toBeTruthy()
    expect(screen.getByText("Treated as a new item in Drinks.")).toBeTruthy()

    await user.click(
      screen.getByRole("button", { name: "Change the decision for Cola" })
    )
    await user.click(
      screen.getByRole("button", { name: "Same item as Cola (Soft drinks)" })
    )
    expect(onDecide).toHaveBeenLastCalledWith("drinks--cola", {
      kind: "same",
      itemId: "i-cola",
    })
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
