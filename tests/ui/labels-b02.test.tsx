// @vitest-environment jsdom
// B02-06 in the label surfaces: removing a dish chip keeps focus (UP-10), a
// label conflict names no role and says when in London time (UP-23), and a
// slow save says so after 15 s (rule 5).
import {
  act,
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
  UploadLabelPanel,
  type CatalogueProp,
  type FixLabelsDialogProps,
} from "@/components/nabalens/labels"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"

import { CATALOGUE, asset, summary } from "./labels-fixtures"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const READY: CatalogueProp = { state: "ready", catalogue: CATALOGUE }

describe("removing a dish chip (UP-10)", () => {
  const BHAJI = {
    itemId: "item-bhaji",
    variantId: null,
    itemName: "Onion Bhaji",
    variantName: null,
  }
  const LASSI = {
    itemId: "item-lassi",
    variantId: null,
    itemName: "Mango Lassi",
    variantName: null,
  }

  it("moves focus to the neighbour chip, then to the search field", async () => {
    const user = userEvent.setup()
    render(
      <UploadLabelPanel
        catalogue={READY}
        onRetryCatalogue={() => {}}
        files={[
          { id: "f1", name: "f1.jpg", kind: "image" },
          { id: "f2", name: "f2.jpg", kind: "image" },
        ]}
        presetFor={(id) => (id === "f1" ? BHAJI : id === "f2" ? LASSI : null)}
        onChange={() => {}}
        onPendingChange={() => {}}
      />
    )
    const list = await screen.findByRole("list", { name: "From the dish" })
    await user.click(
      within(list).getByRole("button", { name: "Remove Onion Bhaji" })
    )
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Mango Lassi" })
    )
    await user.click(screen.getByRole("button", { name: "Remove Mango Lassi" }))
    expect(screen.queryByRole("list", { name: "From the dish" })).toBeNull()
    expect(document.activeElement?.getAttribute("role")).toBe("combobox")
  })
})

const DRAFT: SaveLabelsInput = {
  assetId: "a1",
  expectedRevision: 0,
  catalogueVersionId: "version-1",
  contentTypes: ["dish"],
  note: null,
  items: [{ itemId: "item-bhaji", variantId: null }],
  missingItem: null,
}

async function fix(onSave: FixLabelsDialogProps["onSave"]) {
  render(
    <FixLabelsDialog
      open
      asset={asset("a1")}
      draft={DRAFT}
      catalogue={READY}
      onRetryCatalogue={() => {}}
      onOpenChange={() => {}}
      onSave={onSave}
    />
  )
  const dialog = await screen.findByRole("dialog")
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true)
  )
  return screen.getByRole("button", { name: /^Save/ })
}

describe("a label conflict (UP-23)", () => {
  it("names nobody and says when, as a London date and time", async () => {
    const user = userEvent.setup()
    const save = await fix(async (input): Promise<SaveLabelsResult> => ({
      ok: false,
      assetId: input.assetId,
      code: "conflict",
      message: "Changed meanwhile.",
      // 13:06 UTC in July is 14:06 in London.
      current: summary({ revision: 3, updatedAt: "2026-07-01T13:06:00Z" }),
    }))
    await user.click(save)
    expect(
      await screen.findByText(
        "Someone changed these labels on 1 Jul 2026 at 14:06. The latest labels are shown; check them, then save."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/admin changed/i)).toBeNull()
    expect(screen.queryByText(/a moment ago/)).toBeNull()
  })
})

describe("a slow label save (rule 5)", () => {
  it("says Saving… and, after 15 s without an answer, Still saving", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const save = await fix(() => new Promise(() => {}))
    await user.click(save)
    expect(save.textContent).toBe("Saving…")
    expect(screen.getByRole("status").textContent).toBe("Saving labels…")
    await act(async () => vi.advanceTimersByTime(15_000))
    expect(screen.getByRole("status").textContent).toBe(
      "Still saving; keep this page open."
    )
  })
})
