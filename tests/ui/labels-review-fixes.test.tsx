// @vitest-environment jsdom
// Regressions for the independent review of the S2 label editor: pending must
// never block a host for good, a preset limited to some photos is not shown as
// common, echoed inputs don't cancel the preset, the variant question survives
// its entry being removed, and fixes/off-menu chips stay unambiguous.
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
  FixLabelsDialog,
  LabelEditorDialog,
  UploadLabelPanel,
  type CatalogueProp,
  type UploadLabelPanelProps,
} from "@/components/nabalens/labels"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"

import { CATALOGUE, MOMO_CATALOGUE, asset, summary } from "./labels-fixtures"

afterEach(cleanup)

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }
const BHAJI = {
  itemId: "item-bhaji",
  variantId: null,
  itemName: "Onion Bhaji",
  variantName: null,
}

function panel(props: Partial<UploadLabelPanelProps> = {}) {
  const onChange = vi.fn<(inputs: SaveLabelsInput[]) => void>()
  const onPendingChange = vi.fn<(pending: boolean) => void>()
  const all: UploadLabelPanelProps = {
    catalogue: READY,
    onRetryCatalogue: () => {},
    files: [
      { id: "f1", name: "a.jpg", kind: "image" },
      { id: "f2", name: "b.jpg", kind: "image" },
    ],
    onChange,
    onPendingChange,
    ...props,
  }
  const view = render(<UploadLabelPanel {...all} />)
  return {
    user: userEvent.setup(),
    onChange,
    onPendingChange,
    last: () => onChange.mock.calls.at(-1)![0],
    rerender: (next: Partial<UploadLabelPanelProps>) =>
      view.rerender(<UploadLabelPanel {...all} {...next} />),
    unmount: view.unmount,
  }
}

async function waitForDialogFocus() {
  const dialog = screen.getByRole("dialog")
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true)
  )
}

describe("UploadLabelPanel review fixes", () => {
  it("does not stay pending when the menu fails to load with a preset waiting", () => {
    const { onPendingChange, rerender } = panel({
      catalogue: { state: "loading" },
      preset: BHAJI,
    })
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    rerender({ catalogue: { state: "error", message: "Menu down" } })
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByText("Menu down")).toBeTruthy()
  })

  it("reports pending false when unmounted while pending", async () => {
    const { user, onPendingChange, unmount } = panel()
    await user.type(
      screen.getByRole("combobox", { name: /What's in these photos\?/ }),
      "bhaji"
    )
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    unmount()
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it("shows a preset limited to some photos on its own, not as common", async () => {
    const { user, last } = panel({ preset: BHAJI, presetAssetIds: ["f1"] })
    const own = screen.getByRole("list", { name: "From the dish" })
    expect(within(own).getByText("On photo 1 only")).toBeTruthy()
    expect(
      screen.queryByRole("list", { name: "Selected menu items for all files" })
    ).toBeNull()
    expect(last().map((i) => i.items)).toEqual([
      [{ itemId: "item-bhaji", variantId: null }],
      [],
    ])

    // The dish can still be picked for every photo from the common field.
    await user.type(
      screen.getByRole("combobox", { name: /What's in these photos\?/ }),
      "bhaji"
    )
    await user.click(screen.getByRole("option", { name: /Onion Bhaji/ }))
    expect(last().map((i) => i.items)).toEqual([
      [{ itemId: "item-bhaji", variantId: null }],
      [{ itemId: "item-bhaji", variantId: null }],
    ])
    expect(screen.queryByRole("list", { name: "From the dish" })).toBeNull()
  })

  it("keeps the preset when empty inputs stored while the menu loaded are restored", () => {
    const empty = (assetId: string): SaveLabelsInput => ({
      assetId,
      expectedRevision: 0,
      catalogueVersionId: null,
      contentTypes: [],
      note: null,
      items: [],
      missingItem: null,
    })
    const { last, rerender } = panel({
      catalogue: { state: "loading" },
      preset: BHAJI,
      presetAssetIds: ["f1"],
      initial: [empty("f1"), empty("f2")],
    })
    rerender({ catalogue: READY })
    expect(last()[0].items).toEqual([{ itemId: "item-bhaji", variantId: null }])
    expect(last()[0].catalogueVersionId).toBe("version-1")
  })

  it("adds common details to restored files while the menu is unavailable", async () => {
    const restored: SaveLabelsInput = {
      assetId: "f1",
      expectedRevision: 0,
      catalogueVersionId: "version-1",
      contentTypes: [],
      note: null,
      items: [{ itemId: "item-bhaji", variantId: null }],
      missingItem: null,
    }
    const { user, last } = panel({
      catalogue: { state: "error", message: "Menu down" },
      initial: [restored],
    })
    expect(screen.getByText("Labels kept: 1 menu item")).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "More details for all photos" })
    )
    await user.click(screen.getByRole("button", { name: "Finished dish" }))
    expect(last()[0]).toEqual({ ...restored, contentTypes: ["dish"] })
    expect(last()[1].contentTypes).toEqual(["dish"])
  })
})

describe("variant question review fixes", () => {
  it("adds the dish again when its Not specified chip was removed while asking", async () => {
    const { user, last } = panel({
      catalogue: { state: "ready", catalogue: MOMO_CATALOGUE },
    })
    await user.type(
      screen.getByRole("combobox", { name: /What's in these photos\?/ }),
      "momo"
    )
    await user.click(screen.getByRole("option", { name: /Momo/ }))
    await user.click(
      screen.getByRole("button", { name: "Remove Momo (Not specified)" })
    )
    expect(last()[0].items).toEqual([])
    const group = screen.getByRole("group", { name: /Which Momo\?/ })
    await user.click(
      within(group).getByRole("button", { name: "Not specified" })
    )
    expect(last()[0].items).toEqual([{ itemId: "item-momo", variantId: null }])
  })
})

describe("FixLabelsDialog review fixes", () => {
  const draft: SaveLabelsInput = {
    assetId: "a1",
    expectedRevision: 0,
    catalogueVersionId: "version-1",
    contentTypes: [],
    note: null,
    items: [
      { itemId: "gone-1", variantId: null },
      { itemId: "gone-2", variantId: null },
    ],
    missingItem: null,
  }

  it("closes without asking after a failed save when nothing was edited", async () => {
    const onSave = vi.fn(
      async (input: SaveLabelsInput): Promise<SaveLabelsResult> => ({
        ok: false,
        assetId: input.assetId,
        code: "invalid",
        message: "Not allowed.",
      })
    )
    const onOpenChange = vi.fn()
    render(
      <FixLabelsDialog
        open
        onOpenChange={onOpenChange}
        asset={asset("a1")}
        draft={draft}
        catalogue={READY}
        onRetryCatalogue={() => {}}
        onSave={onSave}
      />
    )
    await waitForDialogFocus()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(await screen.findByText("Not allowed.")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("names two off-menu dishes apart and says it once", async () => {
    render(
      <FixLabelsDialog
        open
        onOpenChange={() => {}}
        asset={asset("a1")}
        draft={draft}
        catalogue={READY}
        onRetryCatalogue={() => {}}
        onSave={async (input) => ({
          ok: true,
          assetId: input.assetId,
          labels: summary(),
        })}
      />
    )
    await waitForDialogFocus()
    const chips = screen.getByRole("list", { name: "Selected menu items" })
    expect(
      within(chips).getByRole("button", {
        name: "Remove Dish no longer on the menu, 1 of 2",
      })
    ).toBeTruthy()
    expect(
      within(chips).getByRole("button", {
        name: "Remove Dish no longer on the menu, 2 of 2",
      })
    ).toBeTruthy()
    expect(within(chips).getAllByText("No longer on the menu")).toHaveLength(2)
  })
})

describe("LabelEditorDialog review fixes", () => {
  it("announces the pending-choice error once (focused, not an alert)", async () => {
    render(
      <LabelEditorDialog
        open
        onOpenChange={() => {}}
        assets={[asset("a1")]}
        catalogue={READY}
        onRetryCatalogue={() => {}}
        onSave={async () => []}
      />
    )
    await waitForDialogFocus()
    const user = userEvent.setup()
    await user.type(screen.getByRole("combobox"), "bhaji")
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    const notice = screen
      .getByText(/Finish choosing the menu item first/)
      .closest("[tabindex='-1']") as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(notice))
    expect(notice.getAttribute("role")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("keeps focus when the default Not specified entry reaches the item limit", async () => {
    const items = Array.from({ length: 19 }, (_, i) => ({
      itemId: `old-${i}`,
      variantId: null,
      name: `Old ${i}`,
      variantName: null,
      sectionName: `Old section ${i}`,
      labelledAs: null,
      state: "not_on_active_menu" as const,
    }))
    render(
      <LabelEditorDialog
        open
        onOpenChange={() => {}}
        assets={[asset("a1", summary({ revision: 1, items }))]}
        catalogue={{ state: "ready", catalogue: MOMO_CATALOGUE }}
        onRetryCatalogue={() => {}}
        onSave={async () => []}
      />
    )
    await waitForDialogFocus()
    const user = userEvent.setup()
    await user.type(screen.getByRole("combobox"), "momo")
    await user.click(screen.getByRole("option", { name: /Momo/ }))
    const group = screen.getByRole("group", { name: /Which Momo\?/ })
    await user.click(within(group).getByRole("button", { name: "Veg" }))
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain(
        "20 menu items is the most allowed"
      )
    )
  })
})
