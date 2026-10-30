// @vitest-environment jsdom
import * as React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuDocumentEditor, editorIssues } from "@/components/nabalens/menus"
import type { MenuDocument } from "@/lib/menus/types"

afterEach(cleanup)

// Injected stand-ins for lib/menus/import helpers (stubs on the contract
// commit), so these tests only exercise the editor.
const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
const makeSourceKey = (section: string, name: string) =>
  `${section}--${slugify(name)}`

const START: MenuDocument = {
  title: "Autumn",
  sections: [
    {
      slug: "curries",
      name: "Curries",
      kind: "food",
      items: [
        {
          itemId: "item-1",
          sourceKey: "curries--tikka",
          name: "Tikka",
          description: "Creamy",
          aliases: ["CTM"],
          sourceMeta: { price: "12.50" },
          variants: [
            { variantId: "var-1", name: "Veg" },
            { variantId: "var-2", name: "Chicken" },
          ],
          review: null,
        },
        {
          itemId: "item-2",
          sourceKey: "curries--korma",
          name: "Korma",
          description: null,
          aliases: [],
          sourceMeta: {},
          variants: [],
          review: { candidates: ["item-9"], reason: "Similar name" },
        },
      ],
    },
  ],
}

function Harness({
  initial = START,
  onChange,
  ...rest
}: {
  initial?: MenuDocument
  onChange: (doc: MenuDocument) => void
} & Partial<React.ComponentProps<typeof MenuDocumentEditor>>) {
  const [doc, setDoc] = React.useState(initial)
  return (
    <MenuDocumentEditor
      value={doc}
      onChange={(next) => {
        onChange(next)
        setDoc(next)
      }}
      makeSourceKey={makeSourceKey}
      slugify={slugify}
      {...rest}
    />
  )
}

function lastDoc(spy: ReturnType<typeof vi.fn>): MenuDocument {
  return spy.mock.calls.at(-1)![0] as MenuDocument
}

/** Keyboard only: move focus without a pointer, then type. */
async function focusAndType(
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLElement,
  text: string
) {
  el.focus()
  await user.keyboard(text)
}

describe("MenuDocumentEditor", () => {
  it("adds and renames a section by keyboard; focus moves to the new section", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const addGroup = screen.getByRole("group", { name: "Add a section" })
    within(addGroup).getByRole("radio", { name: "Drinks" }).focus()
    await user.keyboard(" ")
    await focusAndType(
      user,
      screen.getByRole("textbox", { name: "New section name" }),
      "Drinks{Enter}"
    )
    expect(lastDoc(onChange).sections[1]).toEqual({
      slug: "drinks",
      name: "Drinks",
      kind: "drinks",
      items: [],
    })

    const nameInputs = screen.getAllByRole("textbox", { name: "Section name" })
    expect(document.activeElement).toBe(nameInputs[1])
    expect(screen.getByRole("status").textContent).toBe("Added section Drinks.")

    await user.keyboard("{Control>}a{/Control}Soft drinks")
    const renamed = lastDoc(onChange).sections[1]
    expect(renamed.name).toBe("Soft drinks")
    // The slug is the section's identity and never follows a rename.
    expect(renamed.slug).toBe("drinks")

    // Adding a second "Drinks" section gets a unique slug.
    await focusAndType(
      user,
      screen.getByRole("textbox", { name: "New section name" }),
      "Drinks{Enter}"
    )
    expect(lastDoc(onChange).sections[2].slug).toBe("drinks-2")
  })

  it("adds a new item with a null itemId and a generated source key", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = screen.getByRole("textbox", { name: "New item in Curries" })
    await focusAndType(user, input, "Dal{Enter}")
    const items = lastDoc(onChange).sections[0].items
    expect(items[2]).toEqual({
      itemId: null,
      sourceKey: "curries--dal",
      name: "Dal",
      description: null,
      aliases: [],
      sourceMeta: {},
      variants: [],
      review: null,
    })
    // Existing items are untouched.
    expect(items[0]).toBe(START.sections[0].items[0])
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).value).toBe("")

    // A clashing key is made unique; an empty name is refused.
    await user.keyboard("Dal{Enter}")
    expect(lastDoc(onChange).sections[0].items[3].sourceKey).toBe(
      "curries--dal-2"
    )
    const calls = onChange.mock.calls.length
    await user.keyboard("{Enter}")
    expect(onChange.mock.calls.length).toBe(calls)
    expect(screen.getByText("Enter a name first.")).toBeTruthy()
  })

  it("edits an item and its variants by keyboard, keeping itemId and variantIds", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const toggle = screen.getByRole("button", { name: /^Tikka/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    toggle.focus()
    await user.keyboard("{Enter}")
    expect(toggle.getAttribute("aria-expanded")).toBe("true")

    await focusAndType(
      user,
      screen.getByRole("textbox", { name: "Item name" }),
      " masala"
    )
    let item = lastDoc(onChange).sections[0].items[0]
    expect(item.name).toBe("Tikka masala")
    expect(item.itemId).toBe("item-1")
    expect(item.sourceKey).toBe("curries--tikka")
    expect(item.sourceMeta).toEqual({ price: "12.50" })

    // Rename a variant: same variantId.
    const veg = screen.getByRole("textbox", {
      name: "Variant 1 of Tikka masala",
    })
    await focusAndType(user, veg, "{Control>}a{/Control}Paneer")
    item = lastDoc(onChange).sections[0].items[0]
    expect(item.variants[0]).toEqual({ variantId: "var-1", name: "Paneer" })

    // Add a variant: null variantId.
    await focusAndType(
      user,
      screen.getByRole("textbox", { name: "New variant for Tikka masala" }),
      "Lamb{Enter}"
    )
    item = lastDoc(onChange).sections[0].items[0]
    expect(item.variants).toEqual([
      { variantId: "var-1", name: "Paneer" },
      { variantId: "var-2", name: "Chicken" },
      { variantId: null, name: "Lamb" },
    ])

    // Remove a variant by keyboard; focus stays in the variant list.
    screen.getByRole("button", { name: "Remove variant Chicken" }).focus()
    await user.keyboard("{Enter}")
    item = lastDoc(onChange).sections[0].items[0]
    expect(item.variants).toEqual([
      { variantId: "var-1", name: "Paneer" },
      { variantId: null, name: "Lamb" },
    ])
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Variant 2 of Tikka masala" })
    )

    // Aliases: rename and add.
    await focusAndType(
      user,
      screen.getByRole("textbox", { name: "New alias for Tikka masala" }),
      "Tikka{Enter}"
    )
    expect(lastDoc(onChange).sections[0].items[0].aliases).toEqual([
      "CTM",
      "Tikka",
    ])

    // Description cleared → null.
    const description = screen.getByRole("textbox", {
      name: "Description (optional)",
    })
    await focusAndType(user, description, "{Control>}a{/Control}{Backspace}")
    expect(lastDoc(onChange).sections[0].items[0].description).toBeNull()
  })

  it("flags duplicate variant names (case-insensitive, trimmed)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    screen.getByRole("button", { name: /^Tikka/ }).focus()
    await user.keyboard("{Enter}")
    await focusAndType(
      user,
      screen.getByRole("textbox", { name: "New variant for Tikka" }),
      " veg {Enter}"
    )
    const errors = screen.getByRole("region", { name: "1 error" })
    expect(errors.textContent).toContain(
      "“Tikka” has more than one variant called “veg”."
    )
    expect(
      screen.getByRole("button", { name: /^Tikka.*Has errors/ })
    ).toBeTruthy()
    expect(
      editorIssues({
        title: "t",
        sections: [
          {
            ...START.sections[0],
            items: [
              {
                ...START.sections[0].items[0],
                variants: [
                  { variantId: "a", name: "Veg" },
                  { variantId: "b", name: " VEG" },
                  { variantId: null, name: "veg" },
                ],
              },
            ],
          },
        ],
      })
    ).toHaveLength(1)
  })

  it("removes an item and moves focus to the next item", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    screen.getByRole("button", { name: /^Tikka/ }).focus()
    await user.keyboard("{Enter}")
    screen.getByRole("button", { name: "Remove Tikka" }).focus()
    await user.keyboard("{Enter}")
    const items = lastDoc(onChange).sections[0].items
    expect(items.map((i) => i.itemId)).toEqual(["item-2"])
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Korma/ })
    )
    expect(screen.getByRole("status").textContent).toBe(
      "Removed Tikka from this draft."
    )
  })

  it("moves items up/down and sections up/down, keeping ids", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const initial: MenuDocument = {
      ...START,
      sections: [
        ...START.sections,
        { slug: "drinks", name: "Drinks", kind: "drinks", items: [] },
      ],
    }
    render(<Harness initial={initial} onChange={onChange} />)
    screen.getByRole("button", { name: /^Korma/ }).focus()
    await user.keyboard("{Enter}")
    screen.getByRole("button", { name: "Move Korma up" }).focus()
    await user.keyboard("{Enter}")
    expect(lastDoc(onChange).sections[0].items.map((i) => i.itemId)).toEqual([
      "item-2",
      "item-1",
    ])

    screen.getByRole("button", { name: "Move section Drinks up" }).focus()
    await user.keyboard("{Enter}")
    expect(lastDoc(onChange).sections.map((s) => s.slug)).toEqual([
      "drinks",
      "curries",
    ])
    // At the top now: focus falls back to the section toggle.
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true")
    expect(document.activeElement?.textContent).toContain("Drinks")
  })

  it("asks before removing a section with items, and removes an empty one directly", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const initial: MenuDocument = {
      ...START,
      sections: [
        ...START.sections,
        { slug: "drinks", name: "Drinks", kind: "drinks", items: [] },
      ],
    }
    render(<Harness initial={initial} onChange={onChange} />)

    screen.getByRole("button", { name: "Remove section Drinks" }).focus()
    await user.keyboard("{Enter}")
    expect(lastDoc(onChange).sections.map((s) => s.slug)).toEqual(["curries"])
    expect(document.activeElement?.textContent).toContain("Curries")

    const calls = onChange.mock.calls.length
    screen.getByRole("button", { name: "Remove section Curries" }).focus()
    await user.keyboard("{Enter}")
    expect(onChange.mock.calls.length).toBe(calls)
    const confirm = screen.getByRole("group", {
      name: "Confirm removing section Curries",
    })
    expect(confirm.textContent).toContain("existing labels are kept")
    // "Keep section" has focus first (safe default).
    expect(document.activeElement?.textContent).toBe("Keep section")
    within(confirm).getByRole("button", { name: "Remove section" }).focus()
    await user.keyboard("{Enter}")
    expect(lastDoc(onChange).sections).toEqual([])
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "New section name" })
    )
  })

  it("filters by name or alias and shows badges", async () => {
    const user = userEvent.setup()
    render(
      <Harness
        onChange={vi.fn()}
        archivedItemIds={["item-2"]}
        labelCounts={{ "item-1": 4 }}
      />
    )
    expect(
      screen.getByRole("button", { name: /^Tikka.*4 labelled photos\/videos/ })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /^Korma.*Archived.*Needs review/ })
    ).toBeTruthy()

    await focusAndType(
      user,
      screen.getByRole("searchbox", { name: "Search items" }),
      "ctm"
    )
    expect(screen.getByText("1 item of 2 match “ctm”.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Korma/ })).toBeNull()
    expect(screen.getByRole("button", { name: /^Tikka/ })).toBeTruthy()
  })

  it("collapses sections and items", async () => {
    const user = userEvent.setup()
    render(<Harness onChange={vi.fn()} />)
    const section = screen.getByRole("button", { name: /^Curries/ })
    expect(section.getAttribute("aria-expanded")).toBe("true")
    section.focus()
    await user.keyboard("{Enter}")
    expect(section.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("button", { name: /^Tikka/ })).toBeNull()
  })

  it("read-only shows content without editing controls", async () => {
    const user = userEvent.setup()
    render(
      <Harness
        onChange={vi.fn()}
        readOnly
        renderItemActions={(item) => <span>actions for {item.itemId}</span>}
      />
    )
    expect(screen.getByRole("heading", { name: "Autumn" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Menu title" })).toBeNull()
    expect(screen.queryByRole("textbox", { name: /New section/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull()
    screen.getByRole("button", { name: /^Tikka/ }).focus()
    await user.keyboard("{Enter}")
    expect(screen.getByText("Veg, Chicken")).toBeTruthy()
    expect(screen.getByText("actions for item-1")).toBeTruthy()
  })

  it("marks items named by issue paths", () => {
    render(
      <Harness
        onChange={vi.fn()}
        issues={[
          {
            severity: "error",
            path: "sections[0].items[1].name",
            message: "Too long.",
          },
        ]}
      />
    )
    expect(
      screen.getByRole("button", { name: /^Korma.*Has errors/ })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /^Tikka.*Has errors/ })
    ).toBeNull()
  })
})
