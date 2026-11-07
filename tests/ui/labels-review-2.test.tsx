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
  LabelEditorDialog,
  UploadLabelPanel,
  type CatalogueProp,
  type UploadLabelPanelProps,
} from "@/components/nabalens/labels"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"

import { CATALOGUE, MOMO_CATALOGUE, asset, summary } from "./labels-fixtures"

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
      inputs.map(
        (i): SaveLabelsResult => ({
          ok: true,
          assetId: i.assetId,
          labels: summary({ revision: 1 }),
        })
      )
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
