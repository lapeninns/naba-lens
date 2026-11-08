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
  FixLabelsDialog,
  type CatalogueProp,
  type FixLabelsDialogProps,
} from "@/components/nabalens/labels"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"

import { CATALOGUE, asset, summary, view } from "./labels-fixtures"

afterEach(cleanup)

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }

const DRAFT: SaveLabelsInput = {
  assetId: "a1",
  expectedRevision: 0,
  catalogueVersionId: "version-1",
  contentTypes: ["dish"],
  note: "Plate 2",
  items: [
    { itemId: "item-bhaji", variantId: null },
    { itemId: "item-tikka", variantId: "var-lamb" },
  ],
  missingItem: null,
}

function ok(input: SaveLabelsInput): SaveLabelsResult {
  return {
    ok: true,
    assetId: input.assetId,
    labels: summary({ revision: input.expectedRevision + 1 }),
  }
}

async function waitForDialogFocus() {
  // Base UI moves initial focus on the next animation frame. Let that opening
  // lifecycle finish before interacting.
  const dialog = screen.getByRole("dialog")
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true)
  )
}

async function setup(props: Partial<FixLabelsDialogProps> = {}) {
  const onSave = vi.fn(
    props.onSave ?? (async (input: SaveLabelsInput) => ok(input))
  )
  const onOpenChange = vi.fn()
  const onRetryCatalogue = vi.fn()
  const all: FixLabelsDialogProps = {
    open: true,
    asset: asset("a1"),
    draft: DRAFT,
    catalogue: READY,
    onRetryCatalogue,
    onOpenChange,
    ...props,
    onSave,
  }
  const result = render(<FixLabelsDialog {...all} />)
  await waitForDialogFocus()
  return {
    user: userEvent.setup(),
    onSave,
    onOpenChange,
    onRetryCatalogue,
    rerender: (next: Partial<FixLabelsDialogProps>) =>
      result.rerender(<FixLabelsDialog {...all} {...next} />),
  }
}

function chips() {
  return screen.getByRole("list", { name: "Selected menu items" })
}

function saveButton() {
  return screen.getByRole("button", { name: /^Save/ })
}

const GONE_DRAFT: SaveLabelsInput = {
  ...DRAFT,
  items: [
    { itemId: "item-bhaji", variantId: null },
    { itemId: "item-gone", variantId: null },
  ],
}

describe("FixLabelsDialog: reopening a stored draft", () => {
  it("shows the stored items, content types and note under 'Fix labels'", async () => {
    await setup()
    expect(screen.getByRole("dialog", { name: "Fix labels" })).toBeTruthy()
    const list = chips()
    expect(within(list).getByText("Onion Bhaji")).toBeTruthy()
    expect(within(list).getByText("Tikka Masala (Lamb)")).toBeTruthy()
    expect(
      within(list).getByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeTruthy()
    expect(
      within(list).getByRole("button", { name: "Remove Tikka Masala (Lamb)" })
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Finished dish" })
        .getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen
        .getByRole("button", { name: "Preparation" })
        .getAttribute("aria-pressed")
    ).toBe("false")
    expect(
      (
        screen.getByRole("textbox", {
          name: "Note (optional)",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Plate 2")
  })

  it("marks an item no longer on the menu as removable, named OFF_MENU_NAME", async () => {
    await setup({ draft: GONE_DRAFT })
    const list = chips()
    const gone = within(list)
      .getByText("Dish no longer on the menu")
      .closest("li")!
    expect(within(gone).getByText(/No longer on the menu/)).toBeTruthy()
    expect(within(gone).getByRole("button", { name: /^Remove/ })).toBeTruthy()
    // The item still on the menu is not flagged.
    const bhaji = within(list).getByText("Onion Bhaji").closest("li")!
    expect(bhaji.textContent).not.toMatch(/No longer on the menu/)
  })

  it("keeps the known name of an off-menu item from the asset's labels", async () => {
    const labels = summary({
      revision: 3,
      items: [
        view("item-gone", "Lamb Rogan", "Old Curries", {
          state: "not_on_active_menu",
        }),
      ],
    })
    await setup({ asset: asset("a1", labels), draft: GONE_DRAFT })
    const list = chips()
    const gone = within(list).getByText("Lamb Rogan").closest("li")!
    expect(within(gone).getByText(/No longer on the menu/)).toBeTruthy()
    expect(
      within(gone).getByRole("button", { name: "Remove Lamb Rogan" })
    ).toBeTruthy()
    expect(within(list).queryByText("Dish no longer on the menu")).toBeNull()
  })
})

describe("FixLabelsDialog: saving", () => {
  it("saves with the current catalogue version and revision, without the removed item", async () => {
    let resolve!: (r: SaveLabelsResult) => void
    const labels = summary({ revision: 4 })
    const { user, onSave, onOpenChange } = await setup({
      asset: asset("a1", labels),
      draft: { ...GONE_DRAFT, catalogueVersionId: "old-version" },
      onSave: () =>
        new Promise<SaveLabelsResult>((r) => {
          resolve = r
        }),
    })
    await user.click(
      within(chips()).getByRole("button", {
        name: "Remove Dish no longer on the menu",
      })
    )
    await user.click(saveButton())

    expect(onSave).toHaveBeenCalledTimes(1)
    const input = onSave.mock.calls[0][0]
    expect(input).toMatchObject({
      assetId: "a1",
      catalogueVersionId: "version-1",
      expectedRevision: 4,
      contentTypes: ["dish"],
      note: "Plate 2",
      items: [{ itemId: "item-bhaji", variantId: null }],
    })
    // Not closed while the save is in flight.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    resolve(ok(input))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("saves even when nothing was changed", async () => {
    const { user, onSave, onOpenChange } = await setup()
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({
      assetId: "a1",
      expectedRevision: 0,
      catalogueVersionId: "version-1",
      contentTypes: ["dish"],
      note: "Plate 2",
      items: [
        { itemId: "item-bhaji", variantId: null },
        { itemId: "item-tikka", variantId: "var-lamb" },
      ],
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("stays open with an inline error when refused, then saves after a fix", async () => {
    const save = vi
      .fn<(input: SaveLabelsInput) => Promise<SaveLabelsResult>>()
      .mockResolvedValueOnce({
        ok: false,
        assetId: "a1",
        code: "unavailable_items",
        message: "Onion Bhaji is not available any more.",
        unavailableItemIds: ["item-bhaji"],
      })
      .mockImplementation(async (input) => ok(input))
    const { user, onSave, onOpenChange } = await setup({ onSave: save })

    await user.click(saveButton())
    expect(
      await screen.findByText("Some menu items are no longer available")
    ).toBeTruthy()
    expect(
      screen.getByText("Onion Bhaji is not available any more.")
    ).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole("dialog", { name: "Fix labels" })).toBeTruthy()
    const bhaji = within(chips()).getByText("Onion Bhaji").closest("li")!
    expect(bhaji.textContent).toMatch(/No longer on the menu/)

    await user.click(
      screen.getByRole("button", { name: "Remove unavailable items" })
    )
    expect(within(chips()).queryByText("Onion Bhaji")).toBeNull()
    await user.click(saveButton())

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1][0].items).toEqual([
      { itemId: "item-tikka", variantId: "var-lamb" },
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("stays open with a network notice when the save throws", async () => {
    const { user, onSave, onOpenChange } = await setup({
      onSave: async () => {
        throw new Error("offline")
      },
    })
    await user.click(saveButton())
    expect(await screen.findByText("The labels couldn't be saved")).toBeTruthy()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole("dialog", { name: "Fix labels" })).toBeTruthy()
    // The draft is still there.
    expect(within(chips()).getByText("Onion Bhaji")).toBeTruthy()
  })
})

describe("FixLabelsDialog: problem and loading", () => {
  it("shows the stored problem before any save", async () => {
    const { onSave } = await setup({
      problem: {
        code: "catalogue_changed",
        message: "The menu changed. Check the dish.",
      },
    })
    expect(
      screen.getByText(
        "The menu for this venue was updated while you were editing"
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reload the menu" })).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("shows a stored conflict's own message when nothing current came with it", async () => {
    const savedSince =
      "Labels were saved on this photo since. Yours are added to them; nothing is removed."
    await setup({ problem: { code: "conflict", message: savedSince } })
    expect(screen.getByText(savedSince)).toBeTruthy()
    expect(screen.queryByText(/An admin changed these labels/)).toBeNull()
  })

  it("keeps the conflict copy and choices for a save refused as changed meanwhile", async () => {
    const { user } = await setup({
      onSave: async (input: SaveLabelsInput) => ({
        ok: false,
        assetId: input.assetId,
        code: "conflict",
        message: "Changed meanwhile.",
        current: summary({ revision: 3 }),
      }),
    })
    await user.click(saveButton())
    expect(
      await screen.findByText(
        "An admin changed these labels a moment ago. Their labels are shown; check them, then save."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Use the saved labels" })
    ).toBeTruthy()
  })
  it("shows a generic stored problem's message", async () => {
    await setup({
      problem: { code: "invalid", message: "The labels were not accepted." },
    })
    expect(screen.getByText("Labels not saved")).toBeTruthy()
    expect(screen.getByText("The labels were not accepted.")).toBeTruthy()
  })

  it("disables Save while the menu loads, then shows the draft", async () => {
    const onSave = vi.fn(async (input: SaveLabelsInput) => ok(input))
    const onOpenChange = vi.fn()
    const props: FixLabelsDialogProps = {
      open: true,
      asset: asset("a1"),
      draft: DRAFT,
      catalogue: { state: "loading" },
      onRetryCatalogue: vi.fn(),
      onOpenChange,
      onSave,
    }
    const { rerender } = render(<FixLabelsDialog {...props} />)
    await waitForDialogFocus()
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText("Tikka Masala (Lamb)")).toBeNull()

    rerender(<FixLabelsDialog {...props} catalogue={READY} />)
    await waitFor(() =>
      expect(within(chips()).getByText("Tikka Masala (Lamb)")).toBeTruthy()
    )
    expect(within(chips()).getByText("Onion Bhaji")).toBeTruthy()
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)

    const user = userEvent.setup()
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].items).toEqual(DRAFT.items)
  })
})

describe("FixLabelsDialog: cancel", () => {
  it("closes without asking when nothing was edited", async () => {
    const { user, onOpenChange, onSave } = await setup()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("asks before discarding an edited draft", async () => {
    const { user, onOpenChange } = await setup()
    await user.click(
      within(chips()).getByRole("button", { name: "Remove Onion Bhaji" })
    )
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Discard label changes?")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
