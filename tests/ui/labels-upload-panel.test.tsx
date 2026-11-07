// @vitest-environment jsdom
// UploadLabelPanel (C3/C5): optional labels inside the upload sheet. One
// common "What's in these photos?" field, "More details" for content types and
// a note, "Adjust" per photo for exceptions, and a preset already applied as a
// removable chip. Every change emits one SaveLabelsInput per file.
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
  UploadLabelPanel,
  type CatalogueProp,
  type UploadLabelFile,
  type UploadLabelPanelProps,
} from "@/components/nabalens/labels"
import {
  CONTENT_TYPE_LABELS,
  LABEL_LIMITS,
  type SaveLabelsInput,
} from "@/lib/menus/types"

import { CATALOGUE, MOMO_CATALOGUE } from "./labels-fixtures"

afterEach(cleanup)

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }
const MOMO: CatalogueProp = { state: "ready", catalogue: MOMO_CATALOGUE }
const LOADING: CatalogueProp = { state: "loading" }

const BHAJI = {
  itemId: "item-bhaji",
  variantId: null,
  itemName: "Onion Bhaji",
  variantName: null,
}

function files(...ids: string[]): UploadLabelFile[] {
  return ids.map((id) => ({ id, name: `${id}.jpg`, kind: "image" }))
}

function empty(assetId: string): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: "version-1",
    contentTypes: [],
    note: null,
    items: [],
    missingItem: null,
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <div data-testid="sheet">{children}</div>
}

function setup(props: Partial<UploadLabelPanelProps> = {}) {
  const onChange = vi.fn<(inputs: SaveLabelsInput[]) => void>()
  const onPendingChange = vi.fn<(pending: boolean) => void>()
  const all: UploadLabelPanelProps = {
    catalogue: READY,
    onRetryCatalogue: () => {},
    files: files("f1", "f2"),
    onChange,
    onPendingChange,
    ...props,
  }
  const view = render(
    <Wrapper>
      <UploadLabelPanel {...all} />
    </Wrapper>
  )
  const rerender = (next: Partial<UploadLabelPanelProps>) =>
    view.rerender(
      <Wrapper>
        <UploadLabelPanel {...all} {...next} />
      </Wrapper>
    )
  return {
    user: userEvent.setup(),
    onChange,
    onPendingChange,
    rerender,
    last: () => onChange.mock.lastCall![0],
  }
}

function commonBox() {
  return screen.getByRole("combobox", { name: /What's in these photos\?/ })
}

/** Types into a search box and taps the matching option next to it. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  query: string,
  option: RegExp
) {
  await user.type(box, query)
  const listbox = document.getElementById(box.getAttribute("aria-controls")!)!
  await user.click(within(listbox).getByRole("option", { name: option }))
}

/** The rows of "Your photos" (direct children only, not nested chips). */
function rows() {
  const list = screen.getByRole("list", { name: /^Your photos?$/ })
  return Array.from(list.children) as HTMLElement[]
}

function lastPending(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.lastCall?.[0]
}

describe("UploadLabelPanel", () => {
  it("labels the common field as optional", () => {
    setup()
    const label = screen
      .getAllByText(/What's in these photos\?/)
      .find((el) => el.closest("label"))!
    expect(label.textContent).toContain("(optional)")
    expect(commonBox()).toBeTruthy()
    expect(screen.getByTestId("sheet").querySelector("[role=dialog]")).toBe(
      null
    )
  })

  it("emits one input per file on mount and after every change", async () => {
    const { user, onChange, last } = setup()
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0]).toEqual([empty("f1"), empty("f2")])

    const calls = onChange.mock.calls.length
    await pick(user, commonBox(), "bhaji", /Onion Bhaji/)
    expect(onChange.mock.calls.length).toBeGreaterThan(calls)
    expect(last()).toEqual([
      { ...empty("f1"), items: [{ itemId: "item-bhaji", variantId: null }] },
      { ...empty("f2"), items: [{ itemId: "item-bhaji", variantId: null }] },
    ])
  })

  it("adjusts one photo only", async () => {
    const { user, last } = setup()
    await pick(user, commonBox(), "bhaji", /Onion Bhaji/)

    const adjust = screen.getByRole("button", {
      name: "Adjust labels for photo 2",
    })
    expect(adjust.getAttribute("aria-expanded")).toBe("false")
    await user.click(adjust)
    expect(adjust.getAttribute("aria-expanded")).toBe("true")

    const own = screen.getByRole("list", {
      name: "Selected menu items for photo 2",
    })
    await user.click(
      within(own).getByRole("button", {
        name: "Remove Onion Bhaji for photo 2",
      })
    )
    expect(last()[0].items).toEqual([{ itemId: "item-bhaji", variantId: null }])
    expect(last()[1].items).toEqual([])
    expect(
      screen.getByRole("button", { name: "Add back Onion Bhaji for photo 2" })
    ).toBeTruthy()

    const fileBox = screen.getByRole("combobox", {
      name: /Menu item at The Railway.*for photo 2/,
    })
    await pick(user, fileBox, "lassi", /Mango Lassi/)
    expect(last()[0].items).toEqual([{ itemId: "item-bhaji", variantId: null }])
    expect(last()[1].items).toEqual([{ itemId: "item-lassi", variantId: null }])
    expect(within(rows()[1]).getAllByText("Mango Lassi").length).toBe(2)

    await user.click(adjust)
    expect(adjust.getAttribute("aria-expanded")).toBe("false")
    // Closing keeps the exception.
    expect(last()[1].items).toEqual([{ itemId: "item-lassi", variantId: null }])
  })

  describe("preset", () => {
    it("applies only to presetAssetIds and can be removed", async () => {
      const { user, last } = setup({ preset: BHAJI, presetAssetIds: ["f1"] })
      const remove = screen.getByRole("button", { name: "Remove Onion Bhaji" })
      expect(last()[0].items).toEqual([
        { itemId: "item-bhaji", variantId: null },
      ])
      expect(last()[1].items).toEqual([])

      await user.click(remove)
      expect(last()[0].items).toEqual([])
      expect(last()[1].items).toEqual([])
      expect(screen.queryByRole("button", { name: "Remove Onion Bhaji" })).toBe(
        null
      )
    })

    it("applies to every file without presetAssetIds", () => {
      const { last } = setup({ preset: BHAJI })
      expect(last().map((i) => i.items)).toEqual([
        [{ itemId: "item-bhaji", variantId: null }],
        [{ itemId: "item-bhaji", variantId: null }],
      ])
    })

    it("goes on a file added later unless it was removed", async () => {
      const { user, last, rerender } = setup({
        preset: BHAJI,
        presetAssetIds: ["f1"],
        files: files("f1"),
      })
      rerender({ files: files("f1", "f2"), presetAssetIds: ["f1", "f2"] })
      await waitFor(() => expect(last()).toHaveLength(2))
      expect(last()[1].items).toEqual([
        { itemId: "item-bhaji", variantId: null },
      ])

      await user.click(
        screen.getByRole("button", { name: "Remove Onion Bhaji" })
      )
      rerender({
        files: files("f1", "f2", "f3"),
        presetAssetIds: ["f1", "f2", "f3"],
      })
      await waitFor(() => expect(last()).toHaveLength(3))
      expect(last().map((i) => i.items)).toEqual([[], [], []])
    })
  })

  describe("presetFor (each file's own dish)", () => {
    const LASSI = {
      itemId: "item-lassi",
      variantId: null,
      itemName: "Mango Lassi",
      variantName: null,
    }
    const BHAJI_ITEM = [{ itemId: "item-bhaji", variantId: null }]
    const LASSI_ITEM = [{ itemId: "item-lassi", variantId: null }]
    const own = (id: string) =>
      id === "f1" ? BHAJI : id === "f2" ? LASSI : null

    /** Each dish as its own chip, naming its photos. */
    function chip(name: string) {
      const list = screen.getByRole("list", { name: "From the dish" })
      return within(list)
        .getAllByRole("listitem")
        .find((li) =>
          within(li).queryByRole("button", { name: `Remove ${name}` })
        )!
    }

    async function keepsBothAfterAnEdit(
      user: ReturnType<typeof userEvent.setup>,
      last: () => SaveLabelsInput[]
    ) {
      await user.click(screen.getByRole("button", { name: /^More details/ }))
      const group = screen.getByRole("group", { name: /^What's in the photo/ })
      await user.click(
        within(group).getByRole("button", { name: CONTENT_TYPE_LABELS.dish })
      )
      expect(last().map((i) => [i.items, i.contentTypes])).toEqual([
        [BHAJI_ITEM, ["dish"]],
        [LASSI_ITEM, ["dish"]],
      ])
    }

    it("puts each file's own dish on it after the menu loads, and an edit keeps both", async () => {
      const { user, last, onPendingChange, rerender } = setup({
        catalogue: LOADING,
        presetFor: own,
      })
      expect(lastPending(onPendingChange)).toBe(true)
      rerender({ catalogue: READY })
      await waitFor(() =>
        expect(last().map((i) => i.items)).toEqual([BHAJI_ITEM, LASSI_ITEM])
      )
      expect(lastPending(onPendingChange)).toBe(false)
      expect(chip("Onion Bhaji").textContent).toContain("On photo 1 only")
      expect(chip("Mango Lassi").textContent).toContain("On photo 2 only")
      expect(within(rows()[0]).getByText("Onion Bhaji")).toBeTruthy()
      expect(within(rows()[1]).getByText("Mango Lassi")).toBeTruthy()
      await keepsBothAfterAnEdit(user, last)
    })

    it("does the same after the menu failed to load and is retried", async () => {
      const { user, last, onPendingChange, rerender } = setup({
        catalogue: { state: "error", message: "Couldn't load." },
        presetFor: own,
      })
      expect(lastPending(onPendingChange)).toBe(false)
      expect(last().map((i) => i.items)).toEqual([[], []])
      rerender({ catalogue: LOADING })
      rerender({ catalogue: READY })
      await waitFor(() =>
        expect(last().map((i) => i.items)).toEqual([BHAJI_ITEM, LASSI_ITEM])
      )
      await keepsBothAfterAnEdit(user, last)
    })

    it("gives a file added later its own dish, and removing one dish leaves the other", async () => {
      const { user, last, rerender } = setup({
        files: files("f1"),
        presetFor: own,
      })
      // One photo, one dish: in the common field.
      expect(screen.queryByRole("list", { name: "From the dish" })).toBeNull()
      expect(
        screen.getByRole("button", { name: "Remove Onion Bhaji" })
      ).toBeTruthy()
      rerender({ files: files("f1", "f2", "f3") })
      await waitFor(() =>
        expect(last().map((i) => i.items)).toEqual([BHAJI_ITEM, LASSI_ITEM, []])
      )

      await user.click(
        screen.getByRole("button", { name: "Remove Onion Bhaji" })
      )
      expect(last().map((i) => i.items)).toEqual([[], LASSI_ITEM, []])
      expect(chip("Mango Lassi").textContent).toContain("On photo 2 only")
      expect(screen.queryByRole("button", { name: "Remove Onion Bhaji" })).toBe(
        null
      )
    })

    it("still gives a file added after a dish was removed its own dish", async () => {
      const { user, last, rerender } = setup({
        files: files("f1"),
        presetFor: own,
      })
      await user.click(
        screen.getByRole("button", { name: "Remove Onion Bhaji" })
      )
      expect(last().map((i) => i.items)).toEqual([[]])
      rerender({ files: files("f1", "f2") })
      await waitFor(() =>
        expect(last().map((i) => i.items)).toEqual([[], LASSI_ITEM])
      )
      expect(
        screen.getByRole("button", { name: "Remove Mango Lassi" })
      ).toBeTruthy()
    })

    it("shows one dish in the common field when every photo has it", () => {
      const { last } = setup({ presetFor: () => BHAJI })
      expect(last().map((i) => i.items)).toEqual([BHAJI_ITEM, BHAJI_ITEM])
      expect(screen.queryByRole("list", { name: "From the dish" })).toBeNull()
      expect(
        screen.getAllByRole("button", { name: "Remove Onion Bhaji" })
      ).toHaveLength(1)
    })

    it("names each dish that isn't on the menu", () => {
      const { last } = setup({
        presetFor: (id) => ({
          itemId: `gone-${id}`,
          variantId: null,
          itemName: `Gone ${id}`,
          variantName: null,
        }),
      })
      expect(last().map((i) => i.items)).toEqual([[], []])
      expect(
        screen.getByText(
          "Gone f1 isn't on the current menu, so it wasn't added."
        )
      ).toBeTruthy()
      expect(
        screen.getByText(
          "Gone f2 isn't on the current menu, so it wasn't added."
        )
      ).toBeTruthy()
    })
  })

  it("adds a dish with variants as Not specified, and a variant replaces it", async () => {
    const { user, last } = setup({ catalogue: MOMO })
    await pick(user, commonBox(), "momo", /^Momo/)
    expect(last().map((i) => i.items)).toEqual([
      [{ itemId: "item-momo", variantId: null }],
      [{ itemId: "item-momo", variantId: null }],
    ])
    expect(within(rows()[0]).getByText("Momo (Not specified)")).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Not specified" })
        .getAttribute("aria-pressed")
    ).toBe("true")

    await user.click(screen.getByRole("button", { name: "Veg" }))
    expect(last().map((i) => i.items)).toEqual([
      [{ itemId: "item-momo", variantId: "var-veg" }],
      [{ itemId: "item-momo", variantId: "var-veg" }],
    ])
    expect(within(rows()[1]).getByText("Momo, Veg")).toBeTruthy()
  })

  describe("onPendingChange", () => {
    it("is true while matching search text is not chosen", async () => {
      const { user, onPendingChange } = setup()
      expect(lastPending(onPendingChange)).toBe(false)
      await user.type(commonBox(), "bhaji")
      expect(lastPending(onPendingChange)).toBe(true)
      await user.click(screen.getByRole("option", { name: /Onion Bhaji/ }))
      expect(lastPending(onPendingChange)).toBe(false)
    })

    it("is true while the menu loads with a preset waiting", async () => {
      const { onPendingChange, last, rerender } = setup({
        catalogue: LOADING,
        preset: BHAJI,
      })
      expect(lastPending(onPendingChange)).toBe(true)
      expect(last().map((i) => i.items)).toEqual([[], []])
      expect(last()[0].catalogueVersionId).toBeNull()

      rerender({ catalogue: READY })
      await waitFor(() => expect(lastPending(onPendingChange)).toBe(false))
      expect(last().map((i) => i.items)).toEqual([
        [{ itemId: "item-bhaji", variantId: null }],
        [{ itemId: "item-bhaji", variantId: null }],
      ])
      expect(last()[0].catalogueVersionId).toBe("version-1")
    })
  })

  it("emits empty labels for a disabled file", async () => {
    const { user, last } = setup({ disabledIds: ["f2"] })
    await pick(user, commonBox(), "bhaji", /Onion Bhaji/)
    expect(last()[0].items).toEqual([{ itemId: "item-bhaji", variantId: null }])
    expect(last()[1]).toEqual(empty("f2"))
    expect(
      (
        screen.getByRole("button", {
          name: "Adjust labels for photo 2",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(within(rows()[1]).getByText("Not saved (photo not saved)"))
  })

  it("restores initial inputs without re-applying the preset", () => {
    const restored: SaveLabelsInput = {
      ...empty("f1"),
      items: [{ itemId: "item-lassi", variantId: null }],
      contentTypes: ["dish"],
      note: "Window table",
    }
    const { last } = setup({ initial: [restored], preset: BHAJI })
    expect(
      within(rows()[0]).getByText("Mango Lassi · 1 content type · note")
    ).toBeTruthy()
    expect(last()[0]).toEqual(restored)
    expect(last()[1].items).toEqual([{ itemId: "item-bhaji", variantId: null }])
  })

  it("handles the most files a batch allows, and a single file", () => {
    const ids = Array.from(
      { length: LABEL_LIMITS.maxBatchAssets },
      (_, i) => `f${i + 1}`
    )
    const { last } = setup({ files: files(...ids) })
    expect(
      screen.getAllByRole("button", { name: /^Adjust labels/ })
    ).toHaveLength(10)
    expect(
      screen.getByRole("button", { name: "Adjust labels for photo 10" })
    ).toBeTruthy()
    expect(last()).toHaveLength(10)
    expect(last().map((i) => i.assetId)).toEqual(ids)
    cleanup()

    const single = setup({ files: files("only") })
    expect(screen.getByRole("list", { name: "Your photo" })).toBeTruthy()
    expect(
      screen.getByRole("combobox", {
        name: "What's in these photos? (optional)",
      })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: /^More details$/ })).toBeTruthy()
    expect(single.last()).toEqual([empty("only")])
  })

  it("reveals content types and a note for all photos behind More details", async () => {
    const { user, last } = setup()
    const toggle = screen.getByRole("button", { name: /^More details/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("group", { name: /^What's in the photo/ })).toBe(
      null
    )
    await user.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    const group = screen.getByRole("group", { name: /^What's in the photo/ })
    await user.click(
      within(group).getByRole("button", { name: CONTENT_TYPE_LABELS.dish })
    )
    expect(last().map((i) => i.contentTypes)).toEqual([["dish"], ["dish"]])

    await user.type(screen.getByRole("textbox", { name: /^Note/ }), "Busy")
    expect(last().map((i) => i.note)).toEqual(["Busy", "Busy"])
    expect(within(rows()[0]).getByText("1 content type · note")).toBeTruthy()
  })

  it("gives every button an accessible name", async () => {
    const { user } = setup({
      preset: BHAJI,
      catalogue: MOMO,
      files: files("f1", "f2", "f3"),
    })
    await user.click(screen.getByRole("button", { name: /^More details/ }))
    await user.click(
      screen.getByRole("button", { name: "Adjust labels for photo 1" })
    )
    await pick(user, commonBox(), "momo", /^Momo/)
    const buttons = screen.getAllByRole("button")
    expect(buttons.length).toBeGreaterThan(5)
    for (const button of buttons) {
      const name =
        button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""
      expect(name, button.outerHTML).not.toBe("")
    }
  })
})
