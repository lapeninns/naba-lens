// @vitest-environment jsdom
// Album AL-4 (DESIGN.md §5 Brief): a manager writes, changes and clears the
// one-line brief of a menu section (/manager/album) and of one dish (the
// manager's menu item page). The result is written beside the field (§6.7);
// a failure keeps what was typed.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AlbumPlacesForm,
  type AlbumBriefSetter,
  type AlbumPlacesGroup,
} from "@/components/nabalens/album/album-places-form"
import {
  DishBrief,
  type DishBriefAction,
} from "@/components/nabalens/album/dish-brief"
import {
  SLOT_BRIEF_COPY,
  SlotBriefField,
  type SlotBriefSaver,
} from "@/components/nabalens/album/slot-brief-field"
import { BRIEF_MAX } from "@/lib/album/model"

afterEach(cleanup)

const BAR = "00000000-0000-4000-8000-00000000b001"
const DISH = "00000000-0000-4000-8000-0000000d0001"

/** An optional field's name: its label then "(optional)". */
const named = (label: string) => new RegExp(`^${label}\\s*\\(optional\\)$`)
const field = (label = "Brief") =>
  screen.getByRole("textbox", { name: named(label) }) as HTMLInputElement
const button = (name: string, root: HTMLElement = document.body) =>
  within(root).getByRole("button", { name }) as HTMLButtonElement
/** The text of every element the control names in aria-describedby. */
const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
const statusText = (root: HTMLElement = document.body) =>
  within(root)
    .getAllByRole("status")
    .map((el) => el.textContent ?? "")
    .join(" ")

const groups: AlbumPlacesGroup[] = [
  {
    source: "menu_section",
    key: "desserts",
    name: "Desserts",
    subjectId: BAR,
    brief: "The bowl from above, spoon at the side",
  },
  {
    source: "menu_section",
    key: "drinks",
    name: "Drinks",
    subjectId: null,
    brief: null,
  },
  { source: "amenity_category", key: "Games", name: "Games", subjectId: null },
]

const places = [{ subjectId: BAR, label: "The bar" }]
const placeOk = vi.fn(async () => ({ ok: true as const }))

describe("SlotBriefField", () => {
  it("saves a trimmed line and says so beside the field", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SlotBriefSaver>(async (brief) => ({
      ok: true,
      brief,
    }))
    render(<SlotBriefField name="Desserts" brief={null} onSave={onSave} />)
    const input = field()
    // Nothing typed yet: nothing to save, nothing to clear.
    expect(button(SLOT_BRIEF_COPY.save).disabled).toBe(true)
    expect(
      screen.queryByRole("button", { name: SLOT_BRIEF_COPY.clear })
    ).toBeNull()
    expect(description(input)).toContain(SLOT_BRIEF_COPY.hint)

    await user.type(input, "  The bowl from above  ")
    await user.click(button(SLOT_BRIEF_COPY.save))
    expect(onSave).toHaveBeenCalledWith("The bowl from above")
    expect(statusText()).toContain("Saved: the brief for Desserts.")
    expect(input.value).toBe("The bowl from above")
    // Saved: the same words are not sent again, and Clear appears.
    expect(button(SLOT_BRIEF_COPY.save).disabled).toBe(true)
    expect(button(SLOT_BRIEF_COPY.clear).disabled).toBe(false)
  })

  it("clears a saved brief", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SlotBriefSaver>(async () => ({
      ok: true,
      brief: null,
    }))
    render(
      <SlotBriefField name="Korma" brief="Korma in its pot" onSave={onSave} />
    )
    expect(field().value).toBe("Korma in its pot")
    await user.click(button(SLOT_BRIEF_COPY.clear))
    expect(onSave).toHaveBeenCalledWith(null)
    expect(field().value).toBe("")
    expect(statusText()).toContain("Cleared the brief for Korma.")
    expect(
      screen.queryByRole("button", { name: SLOT_BRIEF_COPY.clear })
    ).toBeNull()
  })

  it("refuses more than the limit and keeps the words", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SlotBriefSaver>()
    render(<SlotBriefField name="Desserts" brief={null} onSave={onSave} />)
    const input = field()
    await user.click(input)
    await user.paste("x".repeat(BRIEF_MAX + 1))
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(description(input)).toContain(SLOT_BRIEF_COPY.tooLong)
    expect(screen.getByText(SLOT_BRIEF_COPY.count(BRIEF_MAX + 1))).toBeTruthy()
    expect(button(SLOT_BRIEF_COPY.save).disabled).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
    expect(input.value).toHaveLength(BRIEF_MAX + 1)
  })

  it("shows a failure beside the field and keeps what was typed", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SlotBriefSaver>(async () => ({
      ok: false,
      message:
        "That section or dish is no longer on the active menu. Reload the page.",
    }))
    render(<SlotBriefField name="Desserts" brief={null} onSave={onSave} />)
    const input = field()
    await user.type(input, "Bowl from above")
    await user.click(button(SLOT_BRIEF_COPY.save))
    expect(statusText()).toContain("no longer on the active menu")
    expect(input.value).toBe("Bowl from above")
  })

  it("says the connection dropped when the call throws", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SlotBriefSaver>(async () => {
      throw new Error("offline")
    })
    render(<SlotBriefField name="Desserts" brief={null} onSave={onSave} />)
    await user.type(field(), "Bowl")
    await user.click(button(SLOT_BRIEF_COPY.save))
    expect(statusText()).toContain(SLOT_BRIEF_COPY.network)
    expect(field().value).toBe("Bowl")
  })
})

describe("Album places: section briefs", () => {
  it("gives each menu section, and no amenity category, a named brief field", () => {
    render(
      <AlbumPlacesForm
        places={places}
        groups={groups}
        onSet={placeOk}
        onSetBrief={vi.fn<AlbumBriefSetter>()}
      />
    )
    expect(field("Brief for Desserts").value).toBe(
      "The bowl from above, spoon at the side"
    )
    expect(field("Brief for Drinks").value).toBe("")
    expect(
      screen.queryByRole("textbox", { name: named("Brief for Games") })
    ).toBeNull()
    expect(screen.getAllByRole("textbox")).toHaveLength(2)
    // The place selects are still there and still named.
    expect(screen.getByRole("combobox", { name: "Desserts" })).toBeTruthy()
  })

  it("has no brief fields without a setter", () => {
    render(<AlbumPlacesForm places={places} groups={groups} onSet={placeOk} />)
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
  })

  it("sends the section's slug with the brief", async () => {
    const user = userEvent.setup()
    const onSetBrief = vi.fn<AlbumBriefSetter>(async ({ brief }) => ({
      ok: true,
      brief,
    }))
    render(
      <AlbumPlacesForm
        places={places}
        groups={groups}
        onSet={placeOk}
        onSetBrief={onSetBrief}
      />
    )
    const input = field("Brief for Drinks")
    await user.type(input, "The glass on the bar, label out")
    const row = input.closest("li")!
    await user.click(button(SLOT_BRIEF_COPY.save, row))
    expect(onSetBrief).toHaveBeenCalledWith({
      source: "menu_section",
      key: "drinks",
      brief: "The glass on the bar, label out",
    })
    expect(statusText(row)).toContain("Saved: the brief for Drinks.")
  })
})

describe("Album places: no places listed yet", () => {
  it("still gives each menu section its brief field, with no place to pick", () => {
    render(
      <AlbumPlacesForm
        places={[]}
        groups={groups.map((g) => ({ ...g, subjectId: null }))}
        onSet={placeOk}
        onSetBrief={vi.fn<AlbumBriefSetter>()}
      />
    )
    expect(field("Brief for Desserts").value).toBe(
      "The bowl from above, spoon at the side"
    )
    expect(field("Brief for Drinks")).toBeTruthy()
    expect(screen.queryAllByRole("combobox")).toHaveLength(0)
    expect(screen.getAllByText("Not placed")).toHaveLength(3)
  })
})

describe("brief hint words (DESIGN.md §7)", () => {
  it("says staff add the photo, never take it", () => {
    expect(SLOT_BRIEF_COPY.hint).toContain("before they add the photo")
    expect(SLOT_BRIEF_COPY.hint).not.toMatch(/\btake\b/i)
  })
})

describe("DishBrief", () => {
  it("says which brief staff see without the dish's own", () => {
    const { rerender } = render(
      <DishBrief
        itemId={DISH}
        name="Sticky toffee pudding"
        brief={null}
        section={{ name: "Desserts", brief: "The bowl from above" }}
        setAction={vi.fn<DishBriefAction>()}
      />
    )
    expect(
      screen.getByRole("heading", { level: 2, name: "Brief" })
    ).toBeTruthy()
    expect(description(field("Brief for Sticky toffee pudding"))).toContain(
      'staff see the Desserts brief: "The bowl from above"'
    )
    rerender(
      <DishBrief
        itemId={DISH}
        name="Sticky toffee pudding"
        brief={null}
        section={{ name: "Desserts", brief: null }}
        setAction={vi.fn<DishBriefAction>()}
      />
    )
    expect(description(field("Brief for Sticky toffee pudding"))).toContain(
      "Desserts has no brief yet"
    )
  })

  it("sends the dish's id with the brief", async () => {
    const user = userEvent.setup()
    const setAction = vi.fn<DishBriefAction>(async ({ brief }) => ({
      ok: true,
      brief,
    }))
    render(
      <DishBrief
        itemId={DISH}
        name="Sticky toffee pudding"
        brief={null}
        section={{ name: "Desserts", brief: null }}
        setAction={setAction}
      />
    )
    await user.type(
      field("Brief for Sticky toffee pudding"),
      "With custard poured, spoon in"
    )
    await user.click(button(SLOT_BRIEF_COPY.save))
    expect(setAction).toHaveBeenCalledWith({
      source: "menu_item",
      key: DISH,
      brief: "With custard poured, spoon in",
    })
  })
})
