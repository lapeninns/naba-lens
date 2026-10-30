// @vitest-environment jsdom
// LabelEditorHost (packet F): loading/error/retry, stale responses, saving
// through the batch Server Function and mixed-venue batches. The Server
// Functions are mocked; the real LabelEditorDialog (G) renders.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LabelEditorContextResult } from "@/app/_labels/actions"
import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"

import { CATALOGUE, asset, summary } from "./labels-fixtures"

const actions = vi.hoisted(() => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/_labels/actions", () => actions)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ready = (ids: string[], venue = "venue-1"): LabelEditorContextResult => ({
  ok: true,
  assets: ids.map((id) =>
    asset(id, undefined, { venueId: venue, venueName: `Venue ${venue}` })
  ),
  missing: [],
  catalogue: { ...CATALOGUE, venueId: venue },
})

function okFor(inputs: SaveLabelsInput[]): SaveLabelsResult[] {
  return inputs.map((i) => ({
    ok: true,
    assetId: i.assetId,
    labels: summary({
      revision: i.expectedRevision + 1,
      contentTypes: ["drinks"],
    }),
  }))
}

function setup(assetIds = ["a1"]) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  const view = render(
    <LabelEditorHost
      assetIds={assetIds}
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  )
  return {
    user: userEvent.setup(),
    onOpenChange,
    onSaved,
    rerender: (props: { open: boolean; assetIds?: string[] }) =>
      view.rerender(
        <LabelEditorHost
          assetIds={props.assetIds ?? assetIds}
          open={props.open}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      ),
  }
}

beforeEach(() => {
  actions.loadLabelEditorContext.mockReset()
  actions.loadLabelCatalogue.mockReset()
  actions.saveLabelBatch.mockReset()
})
afterEach(cleanup)

describe("LabelEditorHost", () => {
  it("renders nothing while closed and loads when opened", async () => {
    const closed = render(
      <LabelEditorHost assetIds={["a1"]} open={false} onOpenChange={vi.fn()} />
    )
    expect(document.body.textContent).toBe("")
    expect(actions.loadLabelEditorContext).not.toHaveBeenCalled()
    closed.unmount()

    const pending = deferred<LabelEditorContextResult>()
    actions.loadLabelEditorContext.mockReturnValueOnce(pending.promise)
    setup()
    expect(screen.getByRole("status").textContent).toMatch(/Loading labels/)
    expect(actions.loadLabelEditorContext).toHaveBeenCalledWith(["a1"])
    pending.resolve(ready(["a1"]))
    expect(
      await screen.findByRole("dialog", { name: "Add labels" })
    ).toBeTruthy()
    expect(
      screen.getByRole("combobox", { name: "Search the menu" })
    ).toBeTruthy()
  })

  it("shows a load error with Try again, and a network failure", async () => {
    actions.loadLabelEditorContext
      .mockResolvedValueOnce({
        ok: false,
        message: "Your account is not active.",
        status: 403,
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(ready(["a1"]))
    const { user, onOpenChange } = setup()
    expect(await screen.findByText("Your account is not active.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByText(/Check your connection and try again/)
    ).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("dialog", { name: "Add labels" })
    ).toBeTruthy()
    expect(actions.loadLabelEditorContext).toHaveBeenCalledTimes(3)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("explains when none of the files can be labelled; Close closes", async () => {
    actions.loadLabelEditorContext.mockResolvedValueOnce({
      ok: true,
      assets: [],
      missing: ["a1"],
      catalogue: null,
    })
    const { user, onOpenChange } = setup()
    expect(await screen.findByText(/cannot be labelled right now/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("ignores a response that arrives after closing", async () => {
    const late = deferred<LabelEditorContextResult>()
    actions.loadLabelEditorContext.mockReturnValueOnce(late.promise)
    const { rerender } = setup()
    rerender({ open: false })
    late.resolve(ready(["a1"]))
    await late.promise
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("passes a catalogue error to the editor and reloads it on retry, keeping edits", async () => {
    actions.loadLabelEditorContext.mockResolvedValueOnce({
      ...ready(["a1"]),
      catalogue: null,
      catalogueError: "The menu could not be loaded. Try again in a moment.",
    })
    actions.loadLabelCatalogue.mockResolvedValueOnce({
      ok: true,
      catalogue: CATALOGUE,
    })
    const { user } = setup()
    expect(
      await screen.findByText(
        "The menu could not be loaded. Try again in a moment."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Kitchen" }))
    await user.click(
      screen.getByRole("button", { name: "Retry loading the menu" })
    )
    expect(actions.loadLabelCatalogue).toHaveBeenCalledWith("venue-1")
    expect(
      await screen.findByRole("combobox", { name: "Search the menu" })
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Kitchen" })
        .getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("saves through saveLabelBatch, reports saved results and closes", async () => {
    actions.loadLabelEditorContext.mockResolvedValueOnce(ready(["a1"]))
    actions.saveLabelBatch.mockImplementation(async (inputs) => okFor(inputs))
    const { user, onOpenChange, onSaved } = setup()
    await screen.findByRole("dialog", { name: "Add labels" })
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(actions.saveLabelBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        assetId: "a1",
        expectedRevision: 0,
        catalogueVersionId:
          CATALOGUE.status === "active" && CATALOGUE.versionId,
        contentTypes: ["drinks"],
      }),
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ ok: true, assetId: "a1" }),
    ])
  })

  it("treats a failed Server Function call as a network error and keeps edits", async () => {
    actions.loadLabelEditorContext.mockResolvedValueOnce(ready(["a1"]))
    actions.saveLabelBatch
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockImplementationOnce(async (inputs: SaveLabelsInput[]) =>
        okFor(inputs)
      )
    const { user, onOpenChange, onSaved } = setup()
    await screen.findByRole("dialog", { name: "Add labels" })
    await user.click(screen.getByRole("button", { name: "Drinks" }))
    await user.click(screen.getByRole("button", { name: "Save labels" }))
    expect(
      await screen.findByText(/Check your connection and try again/)
    ).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Save labels" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(actions.saveLabelBatch).toHaveBeenCalledTimes(2)
  })

  it("labels mixed-venue files one venue at a time", async () => {
    actions.loadLabelEditorContext.mockImplementation(async (ids: string[]) =>
      ids.length > 2
        ? {
            ok: false,
            status: 400,
            message: "These files are from different venues.",
            venueGroups: [["a1", "a3"], ["b2"]],
          }
        : ready(ids, ids[0].startsWith("a") ? "venue-a" : "venue-b")
    )
    const { user, onOpenChange } = setup(["a1", "b2", "a3"])

    const first = await screen.findByRole("dialog", {
      name: "Label files (venue 1 of 2)",
    })
    expect(actions.loadLabelEditorContext).toHaveBeenNthCalledWith(2, [
      "a1",
      "a3",
    ])
    expect(within(first).getByText(/menu of Venue venue-a/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Skip for now" }))

    const second = await screen.findByRole("dialog", {
      name: "Label files (venue 2 of 2)",
    })
    expect(actions.loadLabelEditorContext).toHaveBeenLastCalledWith(["b2"])
    expect(within(second).getByText(/menu of Venue venue-b/)).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Skip for now" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
