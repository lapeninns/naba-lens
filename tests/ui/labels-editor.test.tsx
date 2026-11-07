// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  LabelEditorDialog,
  PENDING_CHOICE_TEXT,
  type CatalogueProp,
  type LabelEditorDialogProps,
} from "@/components/nabalens/labels"
import type {
  LabelEditorAsset,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

import {
  CATALOGUE,
  MOMO_CATALOGUE,
  NO_MENU,
  asset,
  summary,
  view,
} from "./labels-fixtures"

afterEach(cleanup)

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }

function okFor(inputs: SaveLabelsInput[]): SaveLabelsResult[] {
  return inputs.map((i) => ({
    ok: true,
    assetId: i.assetId,
    labels: summary({ revision: i.expectedRevision + 1 }),
  }))
}

async function setup(
  props: Partial<LabelEditorDialogProps> & {
    assets?: LabelEditorAsset[]
  } = {}
) {
  const onSave = vi.fn(
    props.onSave ?? (async (inputs: SaveLabelsInput[]) => okFor(inputs))
  )
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  const onRetryCatalogue = vi.fn()
  const all: LabelEditorDialogProps = {
    open: true,
    assets: [asset("a1")],
    catalogue: READY,
    onRetryCatalogue,
    onOpenChange,
    onSaved,
    ...props,
    onSave,
  }
  const view = render(<LabelEditorDialog {...all} />)
  if (all.open) {
    // Base UI moves initial focus on the next animation frame. Let that opening
    // lifecycle finish before typing, especially when an existing chip is first.
    const dialog = screen.getByRole("dialog")
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true)
    )
  }
  return {
    user: userEvent.setup(),
    onSave,
    onOpenChange,
    onSaved,
    onRetryCatalogue,
    rerender: (next: Partial<LabelEditorDialogProps>) =>
      view.rerender(<LabelEditorDialog {...all} {...next} />),
  }
}

/** Search the given picker (or the only one) and choose an option. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  option: RegExp,
  scope: HTMLElement = document.body
) {
  const box = within(scope).getByRole("combobox")
  await user.clear(box)
  await user.type(box, query)
  await user.click(within(scope).getByRole("option", { name: option }))
}

describe("LabelEditorDialog: search and selection", () => {
  it("finds items by name, alias and section, keeping same names apart", async () => {
    const { user } = await setup()
    const dialog = screen.getByRole("dialog", { name: "Labels" })
    const box = within(dialog).getByRole("combobox", {
      name: "Menu item at The Railway (optional)",
    })

    await user.type(box, "bhajia")
    expect(
      screen.getByRole("option", { name: /Onion Bhaji.*also called Bhajia/ })
    ).toBeTruthy()

    await user.clear(box)
    await user.type(box, "chicken")
    const options = screen.getAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual([
      "ChickenKorma Dishes",
      "ChickenMadras Dishes",
      "Tikka MasalaHouse Specials · choose a variant",
    ])
    expect(box.getAttribute("aria-expanded")).toBe("true")

    await user.click(
      screen.getByRole("option", { name: /Chicken.*Korma Dishes/ })
    )
    await pick(user, "madras", /Chicken.*Madras Dishes/)
    const chips = screen.getByRole("list", { name: "Selected menu items" })
    expect(
      within(chips).getByRole("button", {
        name: "Remove Chicken (Korma Dishes)",
      })
    ).toBeTruthy()
    expect(
      within(chips).getByRole("button", {
        name: "Remove Chicken (Madras Dishes)",
      })
    ).toBeTruthy()
  })

  it("asks which variant, including not specified, and marks added ones", async () => {
    const { user } = await setup()
    await pick(user, "tikka", /Tikka Masala/)
    const group = screen.getByRole("group", { name: /Which Tikka Masala\?/ })
    expect(document.activeElement).toBe(
      within(group).getByRole("button", { name: "Chicken" })
    )
    await user.click(within(group).getByRole("button", { name: "Lamb" }))
    expect(
      screen.getByRole("button", { name: "Remove Tikka Masala, Lamb" })
    ).toBeTruthy()

    await pick(user, "tikka", /Tikka Masala/)
    const again = screen.getByRole("group", { name: /Which Tikka Masala\?/ })
    expect(
      (
        within(again).getByRole("button", {
          name: "Lamb (added)",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    // Choosing the dish again adds it as "Not specified" straight away.
    const notSpecified = within(again).getByRole("button", {
      name: "Not specified",
    })
    expect(notSpecified.getAttribute("aria-pressed")).toBe("true")
    expect(
      screen.getByRole("button", {
        name: "Remove Tikka Masala (Not specified)",
      })
    ).toBeTruthy()
    await user.click(notSpecified)
    expect(
      screen.queryByRole("group", { name: /Which Tikka Masala\?/ })
    ).toBeNull()
    expect(
      screen.getByRole("button", {
        name: "Remove Tikka Masala (Not specified)",
      })
    ).toBeTruthy()
  })

  it("works with the keyboard only: choose, remove, Escape clears search not the dialog", async () => {
    const { user, onOpenChange } = await setup()
    const box = screen.getByRole("combobox", {
      name: "Menu item at The Railway (optional)",
    })
    box.focus()
    await user.keyboard("mango")
    await user.keyboard("{ArrowDown}")
    expect(box.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /Mango Lassi/ }).id
    )
    await user.keyboard("{Enter}")
    const remove = screen.getByRole("button", { name: "Remove Mango Lassi" })
    expect(document.activeElement).toBe(box)
    expect((box as HTMLInputElement).value).toBe("")

    // Variant chooser by keyboard.
    await user.keyboard("tikka{ArrowDown}{Enter}")
    expect(document.activeElement?.textContent).toBe("Chicken")
    await user.keyboard("{Enter}")
    expect(
      screen.getByRole("button", { name: "Remove Tikka Masala, Chicken" })
    ).toBeTruthy()

    // Shift+Tab reaches the chips; Enter removes and focus moves on.
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Tikka Masala, Chicken" })
    )
    await user.keyboard("{Enter}")
    expect(document.activeElement).toBe(remove)
    await user.keyboard("{Enter}")
    expect(
      screen.queryByRole("list", { name: "Selected menu items" })
    ).toBeNull()
    expect(document.activeElement).toBe(box)

    await user.keyboard("lassi{Escape}")
    expect((box as HTMLInputElement).value).toBe("")
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("limits content types to four with an explanation", async () => {
    const { user } = await setup()
    const group = screen.getByRole("group", {
      name: "What's in the photo (up to 4)",
    })
    for (const name of ["Finished dish", "Plating", "Drinks", "Kitchen"])
      await user.click(within(group).getByRole("button", { name }))
    expect(within(group).getByText(/4 chosen, the most allowed/)).toBeTruthy()
    const team = within(group).getByRole("button", { name: "Team" })
    expect(team.getAttribute("aria-disabled")).toBe("true")
    await user.click(team)
    expect(team.getAttribute("aria-pressed")).toBe("false")
    await user.click(within(group).getByRole("button", { name: "Plating" }))
    await user.click(team)
    expect(team.getAttribute("aria-pressed")).toBe("true")
  })

  it("counts remaining note characters", async () => {
    const { user } = await setup()
    const note = screen.getByRole("textbox", { name: "Note (optional)" })
    expect(note.getAttribute("maxlength")).toBe("280")
    await user.type(note, "Hello")
    expect(screen.getByText("275 characters left")).toBeTruthy()
    expect(note.getAttribute("aria-describedby")).toContain(
      screen.getByText("275 characters left").id
    )
  })

  it("shows existing off-menu and archived items with their state and lets them be removed", async () => {
    const labels = summary({
      revision: 4,
      items: [
        view("item-old", "Lamb Bhuna", "Curries", {
          state: "not_on_active_menu",
          labelledAs: "Lamb Bhoona",
        }),
        view("item-gone", "Prawn Puri", "Starters", { state: "archived" }),
      ],
    })
    const { user, onSave } = await setup({ assets: [asset("a1", labels)] })
    expect(screen.getByRole("dialog", { name: "Labels" })).toBeTruthy()
    const chips = screen.getByRole("list", { name: "Selected menu items" })
    expect(
      within(chips).getByText(
        /Not on the current menu · labelled as Lamb Bhoona/
      )
    ).toBeTruthy()
    expect(within(chips).getByText(/Archived/)).toBeTruthy()

    await user.type(screen.getByRole("combobox"), "bhuna")
    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(
      screen.getByText(/Nothing on The Railway's menu matches "bhuna"/)
    ).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Remove Prawn Puri" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-old", variantId: null },
    ])
  })
})

describe("LabelEditorDialog: saving one file", () => {
  it("builds the exact SaveLabelsInput and closes when saved", async () => {
    const labels = summary({
      revision: 3,
      items: [view("item-korma-chicken", "Chicken", "Korma Dishes")],
      contentTypes: ["dish"],
      note: "Old note",
    })
    const { user, onSave, onSaved, onOpenChange } = await setup({
      assets: [asset("a1", labels)],
    })
    await pick(user, "lassi", /Mango Lassi/)
    const types = screen.getByRole("group", {
      name: "What's in the photo (up to 4)",
    })
    await user.click(
      within(types).getByRole("button", { name: "Finished dish" })
    )
    await user.click(within(types).getByRole("button", { name: "Drinks" }))
    const note = screen.getByRole("textbox", { name: "Note (optional)" })
    await user.clear(note)
    await user.type(note, "  New note ")
    await user.click(
      screen.getByRole("button", { name: "Item not on the menu?" })
    )
    await user.type(
      screen.getByRole("textbox", { name: "Missing menu item" }),
      "Lamb shank"
    )
    expect(screen.getByText(/isn't on The Railway's menu/)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual([
      {
        assetId: "a1",
        expectedRevision: 3,
        catalogueVersionId: "version-1",
        contentTypes: ["drinks"],
        note: "New note",
        items: [
          { itemId: "item-korma-chicken", variantId: null },
          { itemId: "item-lassi", variantId: null },
        ],
        missingItem: "Lamb shank",
      },
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ ok: true, assetId: "a1" }),
    ])
  })

  it("withdraws an existing missing-item suggestion when cleared", async () => {
    const { user, onSave } = await setup({
      assets: [asset("a1", summary({ revision: 1, missingItem: "Pie" }))],
    })
    const field = screen.getByRole("textbox", { name: "Missing menu item" })
    expect((field as HTMLInputElement).value).toBe("Pie")
    await user.clear(field)
    expect(screen.getByText(/will be withdrawn/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[0][0][0].missingItem).toBe("")
  })

  it("prevents a double submit while saving", async () => {
    let resolve!: (r: SaveLabelsResult[]) => void
    const { user, onSave } = await setup({
      onSave: () => new Promise((r) => (resolve = r)),
    })
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    const saving = screen.getByRole("button", { name: "Saving…" })
    expect((saving as HTMLButtonElement).disabled).toBe(true)
    await user.click(saving)
    expect(onSave).toHaveBeenCalledTimes(1)
    resolve(okFor(onSave.mock.calls[0][0]))
  })

  it("keeps edits after a network failure and retries", async () => {
    let fail = true
    const { user, onSave, onOpenChange } = await setup({
      onSave: async (inputs) => {
        if (fail) throw new Error("offline")
        return okFor(inputs)
      },
    })
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    const alert = await screen.findByText(/Check your connection and try again/)
    await waitFor(() =>
      expect(document.activeElement).toBe(alert.closest("[tabindex]"))
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("button", { name: "Drinks" })
        .getAttribute("aria-pressed")
    ).toBe("true")

    fail = false
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1][0][0].contentTypes).toEqual(["drinks"])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("recovers from a conflict by keeping my changes on top", async () => {
    const current = summary({
      revision: 7,
      items: [view("item-lassi", "Mango Lassi", "Drinks")],
      note: "Their note",
    })
    const { user, onSave, onOpenChange } = await setup({
      assets: [asset("a1", summary({ revision: 2 }))],
      onSave: vi
        .fn()
        .mockResolvedValueOnce([
          {
            ok: false,
            assetId: "a1",
            code: "conflict",
            message: "Changed",
            current,
          },
        ])
        .mockImplementation(async (inputs: SaveLabelsInput[]) => okFor(inputs)),
    })
    await pick(user, "bhaji", /Onion Bhaji/)
    await user.type(
      screen.getByRole("textbox", { name: "Note (optional)" }),
      "Mine"
    )
    await user.click(screen.getByRole("button", { name: "Save labels" }))

    const problem = await screen.findByText(/^An admin changed these labels/)
    await waitFor(() =>
      expect(document.activeElement).toBe(problem.closest("[tabindex]"))
    )
    expect(screen.getByText("Their note")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Labels not saved.")
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("button", { name: "Keep my changes on top" })
    )
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[1][0]).toEqual([
      expect.objectContaining({
        expectedRevision: 7,
        note: "Mine",
        items: [
          { itemId: "item-lassi", variantId: null },
          { itemId: "item-bhaji", variantId: null },
        ],
      }),
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("recovers from a conflict by adopting the saved labels", async () => {
    const current = summary({ revision: 7, contentTypes: ["team"] })
    const { user, onSave, onOpenChange } = await setup({
      assets: [asset("a1", summary({ revision: 2 }))],
      onSave: vi.fn().mockResolvedValueOnce([
        {
          ok: false,
          assetId: "a1",
          code: "conflict",
          message: "Changed",
          current,
        },
      ]),
    })
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    await user.click(
      await screen.findByRole("button", { name: "Use the saved labels" })
    )
    expect(screen.getByText(/Using the labels that are saved now/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Team" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen
        .getByRole("button", { name: "Drinks" })
        .getAttribute("aria-pressed")
    ).toBe("false")
    // Nothing left to save: closes without another save or a discard prompt.
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("highlights unavailable items, removes them and retries", async () => {
    const { user, onSave, onOpenChange } = await setup({
      onSave: vi
        .fn()
        .mockResolvedValueOnce([
          {
            ok: false,
            assetId: "a1",
            code: "unavailable_items",
            message: "Onion Bhaji is no longer on the menu.",
            unavailableItemIds: ["item-bhaji"],
          },
        ])
        .mockImplementation(async (inputs: SaveLabelsInput[]) => okFor(inputs)),
    })
    await pick(user, "bhaji", /Onion Bhaji/)
    await pick(user, "lassi", /Mango Lassi/)
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(
      await screen.findByText("Some menu items are no longer available")
    ).toBeTruthy()
    const chip = screen
      .getByRole("button", { name: "Remove Onion Bhaji" })
      .closest("li")!
    expect(chip.getAttribute("data-unavailable")).toBe("true")
    expect(within(chip).getByText(/No longer on the menu/)).toBeTruthy()

    await user.click(
      screen.getByRole("button", { name: "Remove unavailable items" })
    )
    expect(
      screen.queryByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeNull()
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[1][0][0].items).toEqual([
      { itemId: "item-lassi", variantId: null },
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("handles a menu change during editing: keeps edits and reloads the catalogue", async () => {
    const { user, onRetryCatalogue, onOpenChange } = await setup({
      onSave: async () => [
        {
          ok: false,
          assetId: "a1",
          code: "catalogue_changed",
          message: "The menu changed.",
        },
      ],
    })
    await pick(user, "lassi", /Mango Lassi/)
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(
      await screen.findByText(
        "The menu for this venue was updated while you were editing"
      )
    ).toBeTruthy()
    expect(onRetryCatalogue).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Remove Mango Lassi" })
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Reload the menu" }))
    expect(onRetryCatalogue).toHaveBeenCalledTimes(2)
  })
})

describe("LabelEditorDialog: batch", () => {
  const a1 = asset(
    "a1",
    summary({
      revision: 2,
      items: [view("item-madras-chicken", "Chicken", "Madras Dishes")],
      note: "A note",
    })
  )
  const a2 = asset("a2")

  async function fillCommonAndAdjustSecond(
    user: ReturnType<typeof userEvent.setup>
  ) {
    const common = screen.getByRole("region", {
      name: "Common to all 2 photos",
    })
    expect(
      within(common).getByText(/Each file keeps the labels it already has/)
    ).toBeTruthy()
    await pick(user, "lassi", /Mango Lassi/, common)
    await user.click(within(common).getByRole("button", { name: "Drinks" }))
    await user.type(
      within(common).getByRole("textbox", {
        name: "Note (optional) for all files",
      }),
      "Common note"
    )

    await user.click(
      screen.getByRole("button", { name: "Adjust labels for photo 2" })
    )
    const panel = document.getElementById(
      screen
        .getByRole("button", { name: "Adjust labels for photo 2" })
        .getAttribute("aria-controls")!
    )!
    const fileChips = within(panel).getByRole("list", {
      name: "Selected menu items for photo 2",
    })
    await user.click(
      within(fileChips).getByRole("button", {
        name: "Remove Mango Lassi for photo 2",
      })
    )
    expect(
      within(panel).getByRole("button", {
        name: "Add back Mango Lassi for photo 2",
      })
    ).toBeTruthy()
    await pick(user, "bhaji", /Onion Bhaji/, panel)
    const note = within(panel).getByRole("textbox", {
      name: "Note (optional) for photo 2",
    })
    expect((note as HTMLTextAreaElement).value).toBe("Common note")
    await user.clear(note)
    await user.type(note, "Only a2")
    return panel
  }

  it("applies the common selection to every file with per-file overrides", async () => {
    const { user, onSave } = await setup({ assets: [a1, a2] })
    expect(screen.getByRole("dialog", { name: "Labels" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy()
    await fillCommonAndAdjustSecond(user)
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[0][0]).toEqual([
      {
        assetId: "a1",
        expectedRevision: 2,
        catalogueVersionId: "version-1",
        contentTypes: ["drinks"],
        note: "Common note",
        items: [
          { itemId: "item-madras-chicken", variantId: null },
          { itemId: "item-lassi", variantId: null },
        ],
        missingItem: null,
      },
      {
        assetId: "a2",
        expectedRevision: 0,
        catalogueVersionId: "version-1",
        contentTypes: ["drinks"],
        note: "Only a2",
        items: [{ itemId: "item-bhaji", variantId: null }],
        missingItem: null,
      },
    ])
  })

  it("on partial failure marks saved files, keeps edits and retries only the failed file", async () => {
    const onSave = vi
      .fn()
      .mockImplementationOnce(async (inputs: SaveLabelsInput[]) => [
        okFor(inputs)[0],
        {
          ok: false,
          assetId: "a2",
          code: "invalid",
          message: "That note is not allowed.",
        },
      ])
      .mockImplementation(async (inputs: SaveLabelsInput[]) => okFor(inputs))
    const { user, onSaved, onOpenChange } = await setup({
      assets: [a1, a2],
      onSave,
    })
    const panel = await fillCommonAndAdjustSecond(user)
    await user.click(screen.getByRole("button", { name: "Save labels" }))

    expect(await screen.findByText("That note is not allowed.")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe(
      "1 of 2 files saved. 1 needs attention."
    )
    const files = screen.getByRole("list", { name: "Photos" })
    const [row1, row2] = within(files)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === files)
    expect(within(row1).getByText(/Saved$/)).toBeTruthy()
    expect(within(row2).getByText(/Not saved$/)).toBeTruthy()
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ assetId: "a1", ok: true }),
    ])
    expect(onOpenChange).not.toHaveBeenCalled()
    // a2's edits are still there.
    expect(
      within(panel).getByRole("button", {
        name: "Remove Onion Bhaji for photo 2",
      })
    ).toBeTruthy()
    expect(
      (
        within(panel).getByRole("textbox", {
          name: "Note (optional) for photo 2",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Only a2")
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain(
        "That note is not allowed."
      )
    )

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(
      onSave.mock.calls[1][0].map((i: SaveLabelsInput) => i.assetId)
    ).toEqual(["a2"])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe("LabelEditorDialog: catalogue states", () => {
  it("loading shows a skeleton; other fields work; edits survive the catalogue arriving", async () => {
    const { user, rerender } = await setup({ catalogue: { state: "loading" } })
    expect(screen.getByText("Loading the menu…")).toBeTruthy()
    expect(screen.queryByRole("combobox")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Kitchen" }))
    rerender({ catalogue: READY })
    expect(
      screen.getByRole("combobox", {
        name: "Menu item at The Railway (optional)",
      })
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Kitchen" })
        .getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("error shows the message and Retry; the rest stays usable", async () => {
    const { user, onRetryCatalogue, onSave } = await setup({
      catalogue: { state: "error", message: "The menu service is busy." },
    })
    expect(screen.getByText("The menu service is busy.")).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Retry loading the menu" })
    )
    expect(onRetryCatalogue).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "Venue" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      contentTypes: ["venue"],
      catalogueVersionId: null,
    })
  })

  it("no active menu: explains, and content types, note and missing item still work", async () => {
    const { user, onSave } = await setup({
      catalogue: { state: "ready", catalogue: NO_MENU },
    })
    expect(screen.getByText(/The Railway has no active menu yet/)).toBeTruthy()
    expect(screen.queryByRole("combobox")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Event" }))
    await user.click(
      screen.getByRole("button", { name: "Item not on the menu?" })
    )
    await user.type(
      screen.getByRole("textbox", { name: "Missing menu item" }),
      "Quiz night platter"
    )
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      catalogueVersionId: null,
      contentTypes: ["event"],
      items: [],
      missingItem: "Quiz night platter",
    })
  })
})

describe("LabelEditorDialog: skip and cancel", () => {
  it("skips straight away when nothing changed", async () => {
    const { user, onOpenChange, onSave } = await setup()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("asks before discarding unsaved edits (button and Escape)", async () => {
    const { user, onOpenChange } = await setup()
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    const confirm = await screen.findByRole("alertdialog", {
      name: "Discard label changes?",
    })
    await user.click(
      within(confirm).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("button", { name: "Drinks" })
        .getAttribute("aria-pressed")
    ).toBe("true")

    await user.keyboard("{Escape}")
    const again = await screen.findByRole("alertdialog", {
      name: "Discard label changes?",
    })
    await user.click(
      within(again).getByRole("button", { name: "Discard changes" })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("renders nothing when closed", async () => {
    await setup({ open: false })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("LabelEditorDialog: staff and admin", () => {
  it("never shows staff their original file names", async () => {
    await setup({ assets: [asset("a1"), asset("a2")] })
    const dialog = screen.getByRole("dialog", { name: "Labels" })
    expect(dialog.textContent).not.toMatch(/a[12]\.jpg/)
    expect(
      screen.getByText(
        "These labels go on all 2 photos. You can change one photo's labels later from the photo itself."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Adjust labels for photo 2" })
    ).toBeTruthy()
  })

  it("shows staff their photo and the label rule", async () => {
    await setup()
    const dialog = screen.getByRole("dialog", { name: "Labels" })
    expect(within(dialog).getByText("Your photo")).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/a1\.jpg/)
    expect(
      screen.getByText(
        "A label describes what is in the file. It is not a claim about allergens, dietary suitability, price or availability, and not permission to publish."
      )
    ).toBeTruthy()
  })

  it("names the missing item from a search with no match", async () => {
    const { user, onSave } = await setup()
    await user.type(screen.getByRole("combobox"), "momo")
    expect(
      screen.getByText(`Nothing on The Railway's menu matches "momo".`)
    ).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: 'Add "momo" as a missing item' })
    )
    const field = screen.getByRole("textbox", { name: "Missing menu item" })
    expect((field as HTMLInputElement).value).toBe("momo")
    expect(document.activeElement).toBe(field)
    expect(
      screen.getByText(
        "momo isn't on The Railway's menu. We'll save it as a suggestion and an admin will review it."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave.mock.calls[0][0][0].missingItem).toBe("momo")
  })

  it("gives admins the file name, the upload-venue rule and the open suggestion", async () => {
    await setup({
      audience: "admin",
      assets: [
        asset("a1", summary({ revision: 2, missingItem: "Momo platter" })),
      ],
    })
    const dialog = screen.getByRole("dialog", { name: "Edit labels" })
    expect(within(dialog).getByText("The Railway · a1.jpg")).toBeTruthy()
    expect(
      screen.getByRole("combobox", { name: "Menu item at The Railway" })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Searches the menu of the venue at upload, The Railway, not where the uploader works now."
      )
    ).toBeTruthy()
    expect(screen.getByText("1 missing-item suggestion")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open Menus" }).getAttribute("href")
    ).toBe("/admin/menus/venue-1")
    // The saved suggestion is not prefilled for editing.
    expect(
      screen.queryByRole("textbox", { name: "Missing menu item" })
    ).toBeNull()
  })
})

describe("LabelEditorDialog: variant default and unfinished choices (audit J4b)", () => {
  const MOMO: CatalogueProp = { state: "ready", catalogue: MOMO_CATALOGUE }
  const MOMO_OPTION = /Momo.*choose a variant/

  async function expectPendingNotice() {
    const text = await screen.findByText(PENDING_CHOICE_TEXT)
    const notice = text.closest("[tabindex]") as HTMLElement
    expect(notice).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(notice))
    return notice
  }

  it("saves a dish with variants as Not specified when the question is left unanswered", async () => {
    const { user, onSave, onOpenChange } = await setup({ catalogue: MOMO })
    await pick(user, "momo", MOMO_OPTION)
    const group = screen.getByRole("group", { name: /Which Momo\?/ })
    expect(
      within(group)
        .getByRole("button", { name: "Not specified" })
        .getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      within(group)
        .getByRole("button", { name: "Veg" })
        .getAttribute("aria-pressed")
    ).toBe("false")
    const chips = screen.getByRole("list", { name: "Selected menu items" })
    expect(
      within(chips).getByRole("button", { name: "Remove Momo (Not specified)" })
    ).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        assetId: "a1",
        catalogueVersionId: "version-1",
        items: [{ itemId: "item-momo", variantId: null }],
      }),
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByText(PENDING_CHOICE_TEXT)).toBeNull()
  })

  it("replaces the Not specified entry when a variant is chosen", async () => {
    const { user, onSave, onOpenChange } = await setup({ catalogue: MOMO })
    await pick(user, "momo", MOMO_OPTION)
    const group = screen.getByRole("group", { name: /Which Momo\?/ })
    await user.click(within(group).getByRole("button", { name: "Veg" }))
    expect(screen.queryByRole("group", { name: /Which Momo\?/ })).toBeNull()
    const chips = screen.getByRole("list", { name: "Selected menu items" })
    expect(
      within(chips).getByRole("button", { name: "Remove Momo, Veg" })
    ).toBeTruthy()
    expect(
      within(chips).queryByRole("button", {
        name: "Remove Momo (Not specified)",
      })
    ).toBeNull()

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-momo", variantId: "var-veg" },
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("will not save over unchosen search text; clearing the search lets Save work", async () => {
    const { user, onSave, onOpenChange } = await setup({ catalogue: MOMO })
    const box = screen.getByRole("combobox")
    await user.type(box, "bhaji")
    expect(screen.getByRole("option", { name: /Onion Bhaji/ })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    await expectPendingNotice()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()

    await user.clear(box)
    await waitFor(() =>
      expect(screen.queryByText(PENDING_CHOICE_TEXT)).toBeNull()
    )
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      items: [],
      contentTypes: ["drinks"],
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("treats an open additive variant question as pending until cancelled", async () => {
    const { user, onSave, onOpenChange } = await setup({ catalogue: MOMO })
    await pick(user, "momo", MOMO_OPTION)
    await user.click(
      within(screen.getByRole("group", { name: /Which Momo\?/ })).getByRole(
        "button",
        { name: "Not specified" }
      )
    )
    expect(screen.queryByRole("group", { name: /Which Momo\?/ })).toBeNull()

    await pick(user, "momo", MOMO_OPTION)
    const again = screen.getByRole("group", { name: /Which Momo\?/ })
    const cancel = within(again).getByRole("button", { name: "Cancel" })
    expect(
      (
        within(again).getByRole("button", {
          name: "Not specified (added)",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    // Nothing is added until a variant is chosen.
    expect(
      within(
        screen.getByRole("list", { name: "Selected menu items" })
      ).getAllByRole("button", { name: /^Remove Momo/ })
    ).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    await expectPendingNotice()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()

    await user.click(cancel)
    expect(screen.queryByRole("group", { name: /Which Momo\?/ })).toBeNull()
    await waitFor(() =>
      expect(screen.queryByText(PENDING_CHOICE_TEXT)).toBeNull()
    )
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-momo", variantId: null },
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("blocks a batch save while the common picker has an unfinished choice", async () => {
    const { user, onSave, onOpenChange } = await setup({
      catalogue: MOMO,
      assets: [asset("a1"), asset("a2")],
    })
    const common = screen.getByRole("region", {
      name: "Common to all 2 photos",
    })
    const box = within(common).getByRole("combobox")
    await user.type(box, "bhaji")
    expect(
      within(common).getByRole("option", { name: /Onion Bhaji/ })
    ).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    await expectPendingNotice()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(
      within(common).getByRole("option", { name: /Onion Bhaji/ })
    )
    await waitFor(() =>
      expect(screen.queryByText(PENDING_CHOICE_TEXT)).toBeNull()
    )
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(
      onSave.mock.calls[0][0].map((i: SaveLabelsInput) => [i.assetId, i.items])
    ).toEqual([
      ["a1", [{ itemId: "item-bhaji", variantId: null }]],
      ["a2", [{ itemId: "item-bhaji", variantId: null }]],
    ])
  })
})
