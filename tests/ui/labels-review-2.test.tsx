// @vitest-environment jsdom
// Regressions for the second review of the upload label flow (review-1,
// items m9 and m11-m14): the upload panel and Fix labels must not drop,
// bring back or misname labels while the menu loads or reloads.
import * as React from "react"
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

import {
  CATALOGUE,
  MOMO_CATALOGUE,
  asset,
  summary,
  view,
} from "./labels-fixtures"

afterEach(cleanup)

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }
const MOMO: CatalogueProp = { state: "ready", catalogue: MOMO_CATALOGUE }

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
    pending: () => onPendingChange.mock.calls.at(-1)?.[0],
    rerender: (next: Partial<UploadLabelPanelProps>) =>
      view.rerender(<UploadLabelPanel {...all} {...next} />),
  }
}

async function pickIn(
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  query: string,
  option: RegExp
) {
  await user.type(box, query)
  const listbox = document.getElementById(box.getAttribute("aria-controls")!)!
  await user.click(within(listbox).getByRole("option", { name: option }))
}

describe("m13: answering the variant question in the common field", () => {
  it("keeps the dish off a photo where Adjust removed it (upload panel)", async () => {
    const { user, last } = panel({ catalogue: MOMO })
    const common = screen.getByRole("combobox", {
      name: /What's in these photos\?/,
    })
    await pickIn(user, common, "momo", /^Momo/)
    expect(last().map((i) => i.items)).toEqual([
      [{ itemId: "item-momo", variantId: null }],
      [{ itemId: "item-momo", variantId: null }],
    ])

    await user.click(
      screen.getByRole("button", { name: "Adjust labels for photo 2" })
    )
    await user.click(
      screen.getByRole("button", {
        name: "Remove Momo (Not specified) for photo 2",
      })
    )
    expect(last()[1].items).toEqual([])

    // The common question is still open: answering it renames the dish.
    await user.click(screen.getByRole("button", { name: "Veg" }))
    expect(last().map((i) => i.items)).toEqual([
      [{ itemId: "item-momo", variantId: "var-veg" }],
      [],
    ])
  })

  it("keeps the dish off a file where it was removed (batch editor)", async () => {
    const onSave = vi.fn(async (inputs: SaveLabelsInput[]) =>
      inputs.map((i): SaveLabelsResult => ({
        ok: true,
        assetId: i.assetId,
        labels: summary({ revision: 1 }),
      }))
    )
    render(
      <LabelEditorDialog
        open
        assets={[asset("a1"), asset("a2")]}
        catalogue={MOMO}
        onRetryCatalogue={() => {}}
        onOpenChange={() => {}}
        onSave={onSave}
      />
    )
    const dialog = screen.getByRole("dialog")
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true)
    )
    const user = userEvent.setup()
    const common = within(dialog).getAllByRole("combobox")[0]
    await pickIn(user, common, "momo", /^Momo/)

    await user.click(
      screen.getByRole("button", { name: "Adjust labels for photo 2" })
    )
    await user.click(
      screen.getByRole("button", {
        name: "Remove Momo (Not specified) for photo 2",
      })
    )
    await user.click(screen.getByRole("button", { name: "Veg" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const inputs = onSave.mock.calls[0][0]
    expect(inputs.map((i) => [i.assetId, i.items])).toEqual([
      ["a1", [{ itemId: "item-momo", variantId: "var-veg" }]],
    ])
  })
})

const LOADING: CatalogueProp = { state: "loading" }
const BHAJI = {
  itemId: "item-bhaji",
  variantId: null,
  itemName: "Onion Bhaji",
  variantName: null,
}
const BHAJI_REF = { itemId: "item-bhaji", variantId: null }

function stored(assetId: string, extra: Partial<SaveLabelsInput> = {}) {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: "version-1",
    contentTypes: [],
    note: null,
    items: [],
    missingItem: null,
    ...extra,
  } satisfies SaveLabelsInput
}

describe("m9: a menu still loading does not hold the host", () => {
  it("is not pending with a file's own dish waiting for the menu", async () => {
    const { pending, last, rerender } = panel({
      catalogue: LOADING,
      presetFor: (id) => (id === "f1" ? BHAJI : null),
    })
    expect(pending()).toBe(false)
    rerender({ catalogue: READY })
    await waitFor(() => expect(last()[0].items).toEqual([BHAJI_REF]))
    expect(pending()).toBe(false)
  })

  it("is not pending with restored labels waiting for the menu, and keeps them", () => {
    const { pending, last } = panel({
      catalogue: LOADING,
      initial: [stored("f1", { items: [BHAJI_REF] })],
    })
    expect(pending()).toBe(false)
    expect(last()[0].items).toEqual([BHAJI_REF])
  })

  it("is still pending while a menu choice is unfinished", async () => {
    const { user, pending } = panel({ catalogue: READY })
    await user.type(
      screen.getByRole("combobox", { name: /What's in these photos\?/ }),
      "bhaji"
    )
    expect(pending()).toBe(true)
  })
})

describe("m11: the menu reloads or fails after items were picked", () => {
  it("keeps sending the version last shown, then the new one", async () => {
    const { user, last, rerender } = panel({ catalogue: READY })
    await pickIn(
      user,
      screen.getByRole("combobox", { name: /What's in these photos\?/ }),
      "bhaji",
      /Onion Bhaji/
    )
    expect(last()[0]).toMatchObject({
      items: [BHAJI_REF],
      catalogueVersionId: "version-1",
    })

    rerender({ catalogue: LOADING })
    expect(last().map((i) => i.catalogueVersionId)).toEqual([
      "version-1",
      "version-1",
    ])
    rerender({ catalogue: { state: "error", message: "Menu down" } })
    expect(last().map((i) => i.catalogueVersionId)).toEqual([
      "version-1",
      "version-1",
    ])
    // A disabled file (failed) emits the same version too.
    rerender({ catalogue: LOADING, disabledIds: ["f2"] })
    expect(last()[1].catalogueVersionId).toBe("version-1")

    const next =
      CATALOGUE.status === "active"
        ? { ...CATALOGUE, versionId: "version-2" }
        : CATALOGUE
    rerender({ catalogue: { state: "ready", catalogue: next } })
    await waitFor(() => expect(last()[0].catalogueVersionId).toBe("version-2"))
    expect(last()[0].items).toEqual([BHAJI_REF])
  })

  it("sends null while nothing has been shown yet", () => {
    const { last } = panel({ catalogue: LOADING })
    expect(last().map((i) => i.catalogueVersionId)).toEqual([null, null])
  })
})

describe("m12: photos restored before the menu loads", () => {
  it("shows Too many labels instead of dropping a content type", async () => {
    const { user, last, pending } = panel({
      catalogue: LOADING,
      initial: [
        stored("f1", {
          items: [BHAJI_REF],
          contentTypes: ["preparation", "plating", "kitchen", "team"],
        }),
      ],
    })
    await user.click(
      screen.getByRole("button", { name: "More details for all photos" })
    )
    await user.click(screen.getByRole("button", { name: "Finished dish" }))

    expect(last()[0].contentTypes).toEqual([
      "dish",
      "preparation",
      "plating",
      "kitchen",
      "team",
    ])
    expect(screen.getByText("Too many labels for this photo")).toBeTruthy()
    expect(pending()).toBe(true)

    // Taking the common one off again fixes it.
    await user.click(screen.getByRole("button", { name: "Finished dish" }))
    expect(last()[0].contentTypes).toEqual([
      "preparation",
      "plating",
      "kitchen",
      "team",
    ])
    expect(screen.queryByText("Too many labels for this photo")).toBeNull()
    expect(pending()).toBe(false)
  })

  it("keeps the photo's own note over the common note before and after the menu loads", async () => {
    const { user, last, rerender } = panel({
      catalogue: LOADING,
      initial: [
        stored("f1", { items: [BHAJI_REF], note: "Own note" }),
        stored("f2"),
      ],
    })
    await user.click(
      screen.getByRole("button", { name: "More details for all photos" })
    )
    await user.type(screen.getByRole("textbox", { name: /^Note/ }), "Common")
    expect(last().map((i) => i.note)).toEqual(["Own note", "Common"])

    rerender({ catalogue: READY })
    await waitFor(() => expect(screen.getByText(/^Onion Bhaji/)).toBeTruthy())
    expect(last().map((i) => i.note)).toEqual(["Own note", "Common"])
    expect(last()[0].items).toEqual([BHAJI_REF])
  })
})

describe("m14: Fix labels after its menu reload lands", () => {
  it("names the chips from the menu as it is now, before Save", async () => {
    const draft = stored("a1", {
      items: [
        { itemId: "item-bhaji", variantId: null },
        { itemId: "item-tikka", variantId: "var-lamb" },
        { itemId: "item-gone", variantId: null },
      ],
    })
    if (CATALOGUE.status !== "active") throw new Error("fixture")
    // Since the sheet loaded the menu: Onion Bhaji renamed, Tikka Masala
    // dropped, and the dish that was gone is back.
    const now = {
      ...CATALOGUE,
      versionId: "version-2",
      sections: [
        {
          ...CATALOGUE.sections[0],
          items: [{ ...CATALOGUE.sections[0].items[0], name: "Onion Pakora" }],
        },
        {
          id: "sec-curries",
          slug: "curries",
          name: "Curries",
          kind: "food" as const,
          items: [
            {
              itemId: "item-gone",
              name: "Lamb Rogan",
              description: null,
              aliases: [],
              variants: [],
            },
          ],
        },
      ],
    }
    const onSave = vi.fn(
      async (input: SaveLabelsInput): Promise<SaveLabelsResult> => ({
        ok: true,
        assetId: input.assetId,
        labels: summary({ revision: 1 }),
      })
    )
    const props = {
      open: true,
      onOpenChange: () => {},
      asset: asset("a1"),
      draft,
      onRetryCatalogue: () => {},
      onSave,
    }
    // FixHost opens with the sheet's menu, then reloads it.
    const view = render(<FixLabelsDialog {...props} catalogue={READY} />)
    const chips = () =>
      screen.getByRole("list", { name: "Selected menu items" })
    expect(within(chips()).getByText("Onion Bhaji")).toBeTruthy()
    view.rerender(
      <FixLabelsDialog {...props} catalogue={{ state: "loading" }} />
    )
    view.rerender(
      <FixLabelsDialog
        {...props}
        catalogue={{ state: "ready", catalogue: now }}
      />
    )

    await waitFor(() =>
      expect(within(chips()).getByText("Onion Pakora")).toBeTruthy()
    )
    expect(within(chips()).queryByText("Onion Bhaji")).toBeNull()
    const back = within(chips()).getByText("Lamb Rogan").closest("li")!
    expect(back.textContent).not.toMatch(/No longer on the menu/)
    expect(within(chips()).queryByText("Dish no longer on the menu")).toBeNull()
    const gone = within(chips())
      .getByText(/^Tikka Masala/)
      .closest("li")!
    expect(gone.textContent).toMatch(/No longer on the menu/)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /^Save/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      catalogueVersionId: "version-2",
      items: draft.items,
    })
  })
})

describe("review of these fixes", () => {
  it("m13: answering the variant keeps a file's saved label of that variant (batch editor)", async () => {
    const onSave = vi.fn(async (inputs: SaveLabelsInput[]) =>
      inputs.map((i): SaveLabelsResult => ({
        ok: true,
        assetId: i.assetId,
        labels: summary({ revision: 2 }),
      }))
    )
    const saved = summary({
      revision: 1,
      items: [
        view("item-momo", "Momo", "Momo", {
          variantId: "var-momo-chicken",
          variantName: "Chicken",
        }),
      ],
    })
    render(
      <LabelEditorDialog
        open
        assets={[asset("a1", saved), asset("a2")]}
        catalogue={MOMO}
        onRetryCatalogue={() => {}}
        onOpenChange={() => {}}
        onSave={onSave}
      />
    )
    const dialog = screen.getByRole("dialog")
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true)
    )
    const user = userEvent.setup()
    await pickIn(
      user,
      within(dialog).getAllByRole("combobox")[0],
      "momo",
      /^Momo/
    )
    await user.click(
      screen.getByRole("button", { name: "Adjust labels for photo 1" })
    )
    await user.click(
      screen.getByRole("button", {
        name: "Remove Momo (Not specified) for photo 1",
      })
    )
    await user.click(screen.getByRole("button", { name: "Chicken" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const inputs = onSave.mock.calls[0][0]
    // Photo 1 keeps its saved Momo (Chicken): nothing to change there.
    expect(inputs.map((i) => [i.assetId, i.items])).toEqual([
      ["a2", [{ itemId: "item-momo", variantId: "var-momo-chicken" }]],
    ])
  })

  it("m11: edits made while the menu reloads are sent again when it is back", async () => {
    const { user, onChange, last, pending, rerender } = panel({
      catalogue: READY,
    })
    await pickIn(
      user,
      screen.getByRole("combobox", { name: /What's in these photos\?/ }),
      "bhaji",
      /Onion Bhaji/
    )
    await user.click(
      screen.getByRole("button", { name: "More details for all photos" })
    )
    rerender({ catalogue: LOADING })
    await user.click(screen.getByRole("button", { name: "Finished dish" }))
    // The host cannot store this yet (it waits for the menu): pending.
    expect(pending()).toBe(true)
    const calls = onChange.mock.calls.length

    // The same menu comes back: the same inputs are sent again.
    rerender({ catalogue: READY })
    await waitFor(() =>
      expect(onChange.mock.calls.length).toBeGreaterThan(calls)
    )
    expect(last()[0]).toMatchObject({
      items: [BHAJI_REF],
      contentTypes: ["dish"],
      catalogueVersionId: "version-1",
    })
    expect(pending()).toBe(false)
  })

  it("m9: details chosen while the menu loads are pending until it is ready", async () => {
    const { user, pending, rerender } = panel({
      catalogue: LOADING,
      presetFor: (id) => (id === "f1" ? BHAJI : null),
    })
    expect(pending()).toBe(false)
    await user.click(
      screen.getByRole("button", { name: "More details for all photos" })
    )
    await user.click(screen.getByRole("button", { name: "Finished dish" }))
    expect(pending()).toBe(true)
    rerender({ catalogue: READY })
    await waitFor(() => expect(pending()).toBe(false))
  })
})

describe("N1: files changing while the menu is not ready", () => {
  const ONE = [{ id: "f1", name: "a.jpg", kind: "image" as const }]
  const TWO = [...ONE, { id: "f2", name: "b.jpg", kind: "image" as const }]

  it("is not pending when a file is added, fails or is removed", () => {
    const { pending, rerender } = panel({ catalogue: LOADING, files: ONE })
    expect(pending()).toBe(false)
    rerender({ catalogue: LOADING, files: TWO })
    expect(pending()).toBe(false)
    rerender({ catalogue: LOADING, files: TWO, disabledIds: ["f2"] })
    expect(pending()).toBe(false)
    rerender({
      catalogue: { state: "error", message: "Menu down" },
      files: ONE,
    })
    expect(pending()).toBe(false)
  })

  it("is still pending after a real edit, until the menu is ready", async () => {
    const { user, pending, rerender } = panel({
      catalogue: LOADING,
      files: ONE,
    })
    rerender({ catalogue: LOADING, files: TWO })
    await user.click(
      screen.getByRole("button", { name: "More details for all photos" })
    )
    expect(pending()).toBe(false)
    await user.click(screen.getByRole("button", { name: "Finished dish" }))
    expect(pending()).toBe(true)
    rerender({ catalogue: READY, files: TWO })
    await waitFor(() => expect(pending()).toBe(false))
  })
})

describe("N2: Fix labels when its own menu reload fails", () => {
  it("saves with the menu version its chips were named from, never null", async () => {
    const draft = stored("a1", {
      items: [{ itemId: "item-bhaji", variantId: null }],
    })
    const onSave = vi.fn(
      async (input: SaveLabelsInput): Promise<SaveLabelsResult> => ({
        ok: true,
        assetId: input.assetId,
        labels: summary({ revision: 1 }),
      })
    )
    const props = {
      open: true,
      onOpenChange: () => {},
      asset: asset("a1"),
      draft,
      onRetryCatalogue: () => {},
      onSave,
    }
    // FixHost opens with the sheet's menu, then its reload fails.
    const view = render(<FixLabelsDialog {...props} catalogue={READY} />)
    view.rerender(
      <FixLabelsDialog {...props} catalogue={{ state: "loading" }} />
    )
    view.rerender(
      <FixLabelsDialog
        {...props}
        catalogue={{ state: "error", message: "Menu down" }}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /^Save/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      catalogueVersionId: "version-1",
      items: draft.items,
    })
  })
})
