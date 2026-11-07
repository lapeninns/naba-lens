// @vitest-environment jsdom
// Label picker focus and the Our menu preset. A work focus only orders: its
// sections win ties and feed an empty-box "Suggested" list, its content types
// show first, and search still covers the whole menu. A preset is an unsaved
// applied label: a removable chip saved with the other labels unless removed.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { LabelEditorContextResult } from "@/app/_labels/actions"
import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import {
  LabelEditorDialog,
  type CatalogueProp,
  type LabelEditorDialogProps,
} from "@/components/nabalens/labels"
import {
  buildCatalogueIndex,
  searchCatalogue,
  sectionFocusRank,
  suggestedItems,
} from "@/components/nabalens/labels/catalogue-search"
import { presetDraft } from "@/components/nabalens/labels/label-draft"
import { contentTypeDisplayOrder } from "@/components/nabalens/labels/label-fields"
import { workFocus, type WorkFocus } from "@/lib/config/work-roles"
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type SaveLabelsInput,
  type SaveLabelsResult,
} from "@/lib/menus/types"

import { CATALOGUE, asset, summary } from "./labels-fixtures"

const actions = vi.hoisted(() => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/_labels/actions", () => actions)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }

const MADRAS: WorkFocus = {
  sectionKinds: ["food"],
  sectionKeywords: ["madras"],
  contentTypes: ["preparation", "kitchen"],
}
const BAR = workFocus("bartender")!

function okFor(inputs: SaveLabelsInput[]): SaveLabelsResult[] {
  return inputs.map((i) => ({
    ok: true,
    assetId: i.assetId,
    labels: summary({ revision: i.expectedRevision + 1 }),
  }))
}

async function open(props: Partial<LabelEditorDialogProps> = {}) {
  const onSave = vi.fn(async (inputs: SaveLabelsInput[]) => okFor(inputs))
  const onOpenChange = vi.fn()
  const all = {
    open: true,
    assets: [asset("a1")],
    catalogue: READY,
    onRetryCatalogue: () => {},
    onOpenChange,
    onSave,
    ...props,
  }
  const view = render(<LabelEditorDialog {...all} />)
  const dialog = screen.getByRole("dialog")
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true)
  )
  return {
    user: userEvent.setup(),
    onSave,
    onOpenChange,
    dialog,
    rerender: (next: Partial<LabelEditorDialogProps>) =>
      view.rerender(<LabelEditorDialog {...all} {...next} />),
  }
}

describe("catalogue focus", () => {
  it("ranks focus sections first for ties without filtering search", () => {
    const plain = searchCatalogue(buildCatalogueIndex(CATALOGUE), "chicken")
    const focused = searchCatalogue(
      buildCatalogueIndex(CATALOGUE, MADRAS),
      "chicken"
    )
    expect(plain.map((h) => h.section.slug)).toEqual([
      "korma-dishes",
      "madras-dishes",
      "house-specials",
    ])
    // Same items, Madras first among the equal name matches.
    expect(focused.map((h) => h.section.slug)).toEqual([
      "madras-dishes",
      "korma-dishes",
      "house-specials",
    ])
    // A better match still wins over focus, and other kinds stay findable.
    const drinks = searchCatalogue(
      buildCatalogueIndex(CATALOGUE, MADRAS),
      "lassi"
    )
    expect(drinks.map((h) => h.item.name)).toEqual(["Mango Lassi"])
  })

  it("ranks keyword sections, then kinds, and nothing without a focus", () => {
    const madras = CATALOGUE.status === "active" ? CATALOGUE.sections : []
    expect(madras.map((s) => sectionFocusRank(s, MADRAS))).toEqual([
      1, 1, 1, 0, 1000,
    ])
    expect(madras.map((s) => sectionFocusRank(s, null))).toEqual([
      1000, 1000, 1000, 1000, 1000,
    ])
  })

  it("suggests focus items only, closest first", () => {
    expect(
      suggestedItems(buildCatalogueIndex(CATALOGUE, BAR)).map(
        (h) => h.item.name
      )
    ).toEqual(["Mango Lassi"])
    expect(
      suggestedItems(buildCatalogueIndex(CATALOGUE, MADRAS))[0].section.slug
    ).toBe("madras-dishes")
    expect(suggestedItems(buildCatalogueIndex(CATALOGUE))).toEqual([])
  })

  it("orders content-type chips for display only", () => {
    expect(contentTypeDisplayOrder(["drinks", "venue"]).slice(0, 2)).toEqual([
      "drinks",
      "venue",
    ])
    expect(contentTypeDisplayOrder()).toEqual([...CONTENT_TYPES])
    expect(new Set(contentTypeDisplayOrder(["event"]))).toEqual(
      new Set(CONTENT_TYPES)
    )
  })
})

describe("menu item picker with a focus", () => {
  it("shows a Suggested listbox on the empty box; typing searches everything", async () => {
    const { user, dialog } = await open({ focus: BAR })
    const box = within(dialog).getByRole("combobox", { name: /^Menu item at/ })
    await user.click(box)
    const suggested = within(dialog).getByRole("listbox", {
      name: "Suggested for your work",
    })
    expect(box.getAttribute("aria-expanded")).toBe("true")
    expect(box.getAttribute("aria-controls")).toBe(suggested.id)
    const options = within(suggested).getAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Mango Lassi"),
    ])
    await user.keyboard("{ArrowDown}")
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0].id)
    expect(options[0].getAttribute("aria-selected")).toBe("true")

    // Searching is not limited to the focus sections.
    await user.type(box, "bhaji")
    const matching = within(dialog).getByRole("listbox", {
      name: "Matching menu items",
    })
    expect(within(matching).getByRole("option").textContent).toContain(
      "Onion Bhaji"
    )

    // Escape clears, a second closes the suggestions (not the dialog).
    await user.keyboard("{Escape}")
    expect(
      within(dialog).getByRole("listbox", { name: "Suggested for your work" })
    ).toBeTruthy()
    await user.keyboard("{Escape}")
    expect(box.getAttribute("aria-expanded")).toBe("false")
  })

  it("picks a suggestion with Enter", async () => {
    const { user, dialog } = await open({ focus: BAR })
    const box = within(dialog).getByRole("combobox", { name: /^Menu item at/ })
    await user.click(box)
    await user.keyboard("{ArrowDown}{Enter}")
    expect(
      within(
        within(dialog).getByRole("list", { name: "Selected menu items" })
      ).getByText("Mango Lassi")
    ).toBeTruthy()
  })

  it("offers no suggestions without a focus", async () => {
    const { user, dialog } = await open()
    const box = within(dialog).getByRole("combobox", { name: /^Menu item at/ })
    await user.click(box)
    expect(box.getAttribute("aria-expanded")).toBe("false")
    expect(
      within(dialog).queryByRole("listbox", { name: "Suggested for your work" })
    ).toBeNull()
  })

  it("shows the focus content types first and saves in the usual order", async () => {
    const { user, dialog, onSave } = await open({ focus: BAR })
    const group = within(dialog).getByRole("group", {
      name: /^What's in the photo/,
    })
    const chips = within(group).getAllByRole("button")
    expect(chips.slice(0, 3).map((c) => c.textContent)).toEqual(
      BAR.contentTypes.map((t) => CONTENT_TYPE_LABELS[t])
    )
    await user.click(
      within(group).getByRole("button", { name: CONTENT_TYPE_LABELS.venue })
    )
    await user.click(
      within(group).getByRole("button", { name: CONTENT_TYPE_LABELS.dish })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0][0].contentTypes).toEqual(["dish", "venue"])
  })
})

describe("Our menu preset", () => {
  const preset = {
    itemId: "item-tikka",
    variantId: "var-lamb",
    itemName: "Old name",
    variantName: "Lamb",
  }

  it("builds a draft from the catalogue, or nothing when it is off the menu", () => {
    expect(presetDraft(CATALOGUE, preset)).toMatchObject({
      itemId: "item-tikka",
      variantId: "var-lamb",
      name: "Tikka Masala",
      variantName: "Lamb",
      sectionName: "House Specials",
    })
    expect(
      presetDraft(CATALOGUE, { itemId: "gone", variantId: null })
    ).toBeNull()
    expect(presetDraft(null, preset)).toBeNull()
  })

  it("is applied as a removable chip and saved with the labels", async () => {
    const { user, dialog, onSave } = await open({ preset })
    expect(within(dialog).getByText("Tikka Masala, Lamb added")).toBeTruthy()
    const chips = within(dialog).getByRole("list", {
      name: "Selected menu items",
    })
    expect(within(chips).getByText("Tikka Masala, Lamb")).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-tikka", variantId: "var-lamb" },
    ])
  })

  it("asks before discarding the draft, and removing it leaves nothing to save", async () => {
    const { user, dialog, onSave, onOpenChange } = await open({ preset })
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Remove Tikka Masala, Lamb" })
    )
    expect(within(dialog).queryByText("Tikka Masala, Lamb added")).toBeNull()
    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("goes on every file of a batch as a common label", async () => {
    const { dialog } = await open({
      preset,
      assets: [asset("a1"), asset("a2")],
    })
    expect(
      within(
        within(dialog).getByRole("list", {
          name: "Selected menu items for all files",
        })
      ).getByText("Tikka Masala, Lamb")
    ).toBeTruthy()
  })

  it("goes only on the files it came with, so earlier files stay unchanged", async () => {
    const { user, dialog, onSave } = await open({
      preset,
      presetAssetIds: ["a4"],
      assets: [asset("a1"), asset("a2"), asset("a3"), asset("a4")],
    })
    expect(
      within(dialog).queryByRole("list", {
        name: "Selected menu items for all files",
      })
    ).toBeNull()
    expect(
      within(dialog).getByText(/on the photo picked for it, not the others/)
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: /^Save labels/ })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const saved = onSave.mock.calls[0][0]
    expect(saved.map((i) => i.assetId)).toEqual(["a4"])
    expect(saved[0].items).toEqual([
      expect.objectContaining({ itemId: preset.itemId }),
    ])
  })
})

describe("Our menu preset: catalogue, variants and removal", () => {
  const bhaji = {
    itemId: "item-bhaji",
    variantId: null,
    itemName: "Onion Bhaji",
    variantName: null,
  }

  function selected(dialog: HTMLElement) {
    return within(dialog).getByRole("list", { name: "Selected menu items" })
  }

  it("waits for a loading menu, then applies the preset once and saves it", async () => {
    const { user, dialog, onSave, rerender } = await open({
      preset: bhaji,
      catalogue: { state: "loading" },
    })
    expect(within(dialog).queryByText("Onion Bhaji added")).toBeNull()
    expect(
      within(dialog).queryByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeNull()

    rerender({ catalogue: READY })
    expect(within(dialog).getByText("Onion Bhaji added")).toBeTruthy()
    expect(
      within(dialog).getAllByRole("button", { name: "Remove Onion Bhaji" })
    ).toHaveLength(1)

    // A later catalogue refresh does not apply it a second time.
    rerender({ catalogue: { state: "ready", catalogue: { ...CATALOGUE } } })
    expect(
      within(dialog).getAllByRole("button", { name: "Remove Onion Bhaji" })
    ).toHaveLength(1)

    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-bhaji", variantId: null },
    ])
  })

  it("keeps a dish with variants as Not specified when the preset names none", async () => {
    const { user, dialog, onSave } = await open({
      preset: {
        itemId: "item-tikka",
        variantId: null,
        itemName: "Tikka Masala",
        variantName: null,
      },
    })
    expect(
      within(dialog).getByRole("button", {
        name: "Remove Tikka Masala (Not specified)",
      })
    ).toBeTruthy()
    expect(
      within(selected(dialog)).getByText(/Tikka Masala \(Not specified\)/)
    ).toBeTruthy()

    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-tikka", variantId: null },
    ])
  })

  it("adds nothing for a preset no longer on the menu, so Save just closes", async () => {
    const { user, dialog, onSave, onOpenChange } = await open({
      preset: {
        itemId: "item-gone",
        variantId: null,
        itemName: "Old Special",
        variantName: null,
      },
    })
    expect(within(dialog).queryByText(/added$/)).toBeNull()
    expect(
      within(dialog).queryByRole("button", { name: /^Remove / })
    ).toBeNull()
    expect(
      within(dialog).queryByRole("list", { name: "Selected menu items" })
    ).toBeNull()

    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("saves only the other item after the preset chip is removed", async () => {
    const { user, dialog, onSave } = await open({ preset: bhaji })
    await user.click(
      within(dialog).getByRole("button", { name: "Remove Onion Bhaji" })
    )
    expect(
      within(dialog).queryByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeNull()

    const box = within(dialog).getByRole("combobox", { name: /^Menu item at/ })
    await user.type(box, "lassi")
    await user.click(
      within(dialog).getByRole("option", { name: /Mango Lassi/ })
    )
    expect(within(selected(dialog)).getByText("Mango Lassi")).toBeTruthy()
    expect(within(selected(dialog)).queryByText("Onion Bhaji")).toBeNull()

    await user.click(
      within(dialog).getByRole("button", { name: "Save labels" })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0][0].items).toEqual([
      { itemId: "item-lassi", variantId: null },
    ])
  })
})

describe("LabelEditorHost focus", () => {
  it("uses the caller's work focus from the editor context", async () => {
    const result: LabelEditorContextResult = {
      ok: true,
      viewer: "staff",
      assets: [asset("a1")],
      missing: [],
      catalogue: CATALOGUE,
      focus: BAR,
    }
    actions.loadLabelEditorContext.mockResolvedValue(result)
    const user = userEvent.setup()
    render(<LabelEditorHost assetIds={["a1"]} open onOpenChange={() => {}} />)
    const box = await screen.findByRole("combobox", { name: /^Menu item at/ })
    await user.click(box)
    expect(
      screen.getByRole("listbox", { name: "Suggested for your work" })
    ).toBeTruthy()
  })

  it("lets a caller turn the focus off", async () => {
    actions.loadLabelEditorContext.mockResolvedValue({
      ok: true,
      viewer: "staff",
      assets: [asset("a1")],
      missing: [],
      catalogue: CATALOGUE,
      focus: BAR,
    } satisfies LabelEditorContextResult)
    const user = userEvent.setup()
    render(
      <LabelEditorHost
        assetIds={["a1"]}
        open
        onOpenChange={() => {}}
        focus={null}
      />
    )
    const box = await screen.findByRole("combobox", { name: /^Menu item at/ })
    await user.click(box)
    expect(box.getAttribute("aria-expanded")).toBe("false")
  })
})
