// @vitest-environment jsdom
// One "Saving N photos" sheet: uploads start on pick, labels are sent by asset
// ID as soon as each file is reserved (C1), finalise reports what it did with
// them (C2), and a row says "Saved" only once the photo is processed and its
// labels are on it. Failures say what to do with exactly one action (C5).
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

import { LeaveGuard } from "@/components/nabalens/shell/leave-guard"
import { UploadDialog } from "@/components/nabalens/upload-dialog"
import type {
  PendingLabelItem,
  UploadLabelPostResult,
  UploadLabels,
} from "@/components/nabalens/upload-label-drafts"
import type {
  Uploader,
  UploadLabelOutcome,
} from "@/components/nabalens/upload-queue"
import {
  EMPTY_LABEL_SUMMARY,
  type MediaLabelSummary,
  type SaveLabelsInput,
} from "@/lib/menus/types"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 3,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })
const mp4 = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "video/mp4" })

const BHAJI = { itemId: "item-bhaji", variantId: null }
const KORMA = { itemId: "item-korma", variantId: null }

function summary(names: string[], revision = 1): MediaLabelSummary {
  return {
    ...EMPTY_LABEL_SUMMARY,
    revision,
    hasLabels: names.length > 0,
    items: names.map((name) => ({
      itemId: `item-${name}`,
      variantId: null,
      name,
      variantName: null,
      sectionName: "Starters",
      labelledAs: null,
      state: "current" as const,
    })),
  }
}

function input(assetId: string, items = [BHAJI]): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: "version-1",
    contentTypes: [],
    note: null,
    items,
    missingItem: null,
  }
}

type Held = {
  name: string
  reserve: (assetId: string) => void
  resolve: (labels?: UploadLabelOutcome) => void
  reject: (error: unknown) => void
  progress: (fraction: number) => void
  signal: AbortSignal
}

/** Each attempt waits for the test; reserve() reports the asset ID. */
function heldUploader() {
  const held: Held[] = []
  const upload: Uploader = (file, ctx) =>
    new Promise((resolve, reject) => {
      let assetId = `asset-${file.name}`
      held.push({
        name: file.name,
        reserve: (id) => {
          assetId = id
          ctx.onReserved?.(id)
        },
        resolve: (labels) =>
          resolve(labels ? { assetId, labels } : { assetId }),
        reject,
        progress: (f) => ctx.onProgress(f),
        signal: ctx.signal,
      })
      ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
    })
  const find = (name: string) => held.findLast((h) => h.name === name)!
  return { upload, held, find }
}

type Panel = Parameters<UploadLabels["renderPanel"]>[0]

function labelsConfig(overrides: Partial<UploadLabels> = {}) {
  const panel: { current: Panel | null } = { current: null }
  const save = vi.fn(
    async (
      _venue: string,
      i: SaveLabelsInput
    ): Promise<UploadLabelPostResult> => ({
      ok: true,
      assetId: i.assetId,
      state: "pending",
    })
  )
  const discard = vi.fn(async () => true)
  const attention = vi.fn(async (): Promise<PendingLabelItem[] | null> => [])
  const onSaved = vi.fn()
  const config: UploadLabels = {
    save,
    discard,
    attention,
    onSaved,
    itemNames: (i) =>
      i.items.map((r) =>
        r.itemId === "item-bhaji" ? "Onion Bhaji" : r.itemId
      ),
    renderPanel: (props) => {
      panel.current = props
      return (
        <section aria-label="Labels">
          <p>What&apos;s in these photos? (optional)</p>
        </section>
      )
    },
    renderFix: ({ draft, problem, onSave, onClose }) => (
      <div role="dialog" aria-label="Fix labels">
        <p>{problem?.message}</p>
        <p>draft for {draft.assetId}</p>
        <button onClick={() => void onSave({ ...draft, items: [KORMA] })}>
          Save corrected
        </button>
        <button onClick={onClose}>Close fix</button>
      </div>
    ),
    ...overrides,
  }
  /** What the panel would send: one input per labelable file. */
  const choose = (pick: (id: string, index: number) => SaveLabelsInput) =>
    act(() => {
      const p = panel.current!
      p.onChange(
        "venue-1",
        p.items.map((item, index) => pick(item.id, index))
      )
    })
  return { config, panel, save, discard, attention, onSaved, choose }
}

function sheet(props: Partial<React.ComponentProps<typeof UploadDialog>>) {
  const onOpenChange = vi.fn()
  const onBusyChange = vi.fn()
  const view = (open = true) => (
    <UploadDialog
      open={open}
      onOpenChange={onOpenChange}
      uploader={props.uploader!}
      limits={LIMITS}
      startOnPick
      keepRunningWhenClosed
      onBusyChange={onBusyChange}
      {...props}
    />
  )
  const result = render(view())
  return {
    user: userEvent.setup(),
    onOpenChange,
    onBusyChange,
    rerender: (open: boolean) => result.rerender(view(open)),
  }
}

const row = (name: string) =>
  within(screen.getByRole("list", { name: "Files" }))
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(name))!

describe("Saving sheet: uploads start on pick", () => {
  it("starts every picked file at once, titled by count, with Done always available", async () => {
    const { upload, held } = heldUploader()
    const { user, onOpenChange, rerender } = sheet({ uploader: upload })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
      jpeg("c.jpg"),
    ])
    await waitFor(() => expect(held).toHaveLength(3))
    expect(
      screen.getByRole("heading", { name: "Saving 3 photos" })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Upload \d/ })).toBeNull()
    act(() => held[0].progress(0.4))
    expect(row("a.jpg").textContent).toContain("Saving…")
    expect(row("a.jpg").textContent).toContain("Uploading 40%")

    const done = screen.getByRole("button", { name: "Done" })
    expect(done.hasAttribute("disabled")).toBe(false)
    expect(screen.getByRole("button", { name: "Add more" })).toBeTruthy()
    await user.click(done)
    // Hidden, not cancelled: the uploads carry on.
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(false)
    expect(held.some((h) => h.signal.aborted)).toBe(false)
    await act(async () => held[0].resolve())
    rerender(true)
    expect(row("a.jpg").textContent).toContain("Saved")
    expect(row("b.jpg").textContent).toContain("Saving…")
  })

  it("uses the singular title and Remove/Cancel per file", async () => {
    const { upload, held } = heldUploader()
    const { user } = sheet({ uploader: upload })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("one.jpg"),
    ])
    await waitFor(() => expect(held).toHaveLength(1))
    expect(screen.getByRole("heading", { name: "Saving 1 photo" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Cancel one.jpg" }))
    expect(screen.queryByRole("list", { name: "Files" })).toBeNull()
  })

  it("reports each file as soon as it is ready, before a slow video", async () => {
    const { upload, find } = heldUploader()
    const onReady = vi.fn()
    const { user } = sheet({ uploader: upload, onReady })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      mp4("slow.mp4"),
      jpeg("dish.jpg"),
    ])
    await waitFor(() => expect(find("dish.jpg")).toBeTruthy())
    await act(async () => find("dish.jpg").resolve())
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenLastCalledWith(
      ["asset-dish.jpg"],
      [expect.objectContaining({ name: "dish.jpg" })]
    )
    // The video is still uploading.
    expect(row("slow.mp4").textContent).toContain("Saving…")
    await act(async () => find("slow.mp4").resolve())
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenLastCalledWith(
      ["asset-slow.mp4"],
      [expect.objectContaining({ name: "slow.mp4" })]
    )
    expect(screen.getByRole("heading", { name: "Saving 2 files" })).toBeTruthy()
  })
})

describe("Saving sheet: labels by asset ID", () => {
  it("sends labels once the file is reserved and shows Saved when finalise put them on the photo", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("dish.jpg"),
    ])
    expect(screen.getByText("What's in these photos? (optional)")).toBeTruthy()
    await labels.choose((id) => input(id))
    // No asset yet: nothing sent, but the labels count as still saving.
    expect(labels.save).not.toHaveBeenCalled()
    expect(screen.getByText("1 photo still saving labels")).toBeTruthy()

    act(() => find("dish.jpg").reserve("asset-1"))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    expect(labels.save).toHaveBeenLastCalledWith(
      "venue-1",
      expect.objectContaining({
        assetId: "asset-1",
        items: [BHAJI],
        expectedRevision: 0,
      })
    )
    // Kept on the server: still "Saving…" until the photo has them.
    expect(row("dish.jpg").textContent).toContain("Saving…")

    await act(async () =>
      find("dish.jpg").resolve({
        state: "saved",
        labels: summary(["Onion Bhaji"]),
      })
    )
    await waitFor(() =>
      expect(row("dish.jpg").textContent).toContain(
        "Saved · Onion Bhaji · waiting for manager review"
      )
    )
    expect(screen.queryByText(/still saving labels/)).toBeNull()
    expect(labels.onSaved).toHaveBeenCalledWith("asset-1")
    expect(labels.save).toHaveBeenCalledTimes(1)
  })

  it("sends a change again and discards labels the person clears", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    act(() => find("b.jpg").reserve("asset-b"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(2))
    expect(screen.getByText("2 photos still saving labels")).toBeTruthy()

    // b.jpg adjusted to Korma; a.jpg cleared.
    await labels.choose((id, i) =>
      i === 0 ? input(id, []) : input(id, [KORMA])
    )
    await waitFor(() => expect(labels.discard).toHaveBeenCalledWith("asset-a"))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(3))
    expect(labels.save).toHaveBeenLastCalledWith(
      "venue-1",
      expect.objectContaining({ assetId: "asset-b", items: [KORMA] })
    )
    await waitFor(() =>
      expect(screen.getByText("1 photo still saving labels")).toBeTruthy()
    )
    await act(async () => find("a.jpg").resolve())
    expect(row("a.jpg").textContent).toContain("Saved")
  })

  it("clearing labels already on the photo saves the empty choice at its revision", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig({
      save: vi.fn(
        async (
          _v: string,
          i: SaveLabelsInput
        ): Promise<UploadLabelPostResult> => ({
          ok: true,
          assetId: i.assetId,
          state: "saved",
          labels: summary(
            i.items.length ? ["Onion Bhaji"] : [],
            i.expectedRevision + 1
          ),
        })
      ),
    })
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await act(async () => find("a.jpg").resolve())
    await labels.choose((id) => input(id))
    await waitFor(() =>
      expect(row("a.jpg").textContent).toContain(
        "Saved · Onion Bhaji · waiting for manager review"
      )
    )
    await labels.choose((id) => input(id, []))
    await waitFor(() => expect(labels.config.save).toHaveBeenCalledTimes(2))
    expect(labels.config.save).toHaveBeenLastCalledWith(
      "venue-1",
      expect.objectContaining({
        assetId: "asset-a",
        items: [],
        expectedRevision: 1,
      })
    )
    await waitFor(() =>
      expect(row("a.jpg").textContent?.trim()).toMatch(/Saved$/)
    )
    expect(labels.discard).not.toHaveBeenCalled()
  })

  it("finalise needs attention: the menu changed, and Fix labels saves a corrected choice", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("dish.jpg"),
    ])
    act(() => find("dish.jpg").reserve("asset-1"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    await act(async () =>
      find("dish.jpg").resolve({
        state: "needs_attention",
        code: "catalogue_changed",
        message: "The menu changed. Check the dish.",
      })
    )
    await waitFor(() =>
      expect(row("dish.jpg").textContent).toContain("Needs attention")
    )
    expect(row("dish.jpg").textContent).toContain(
      "The menu changed. Check the dish."
    )
    expect(screen.queryByText(/still saving labels/)).toBeNull()

    labels.save.mockResolvedValueOnce({
      ok: true,
      assetId: "asset-1",
      state: "saved",
      labels: summary(["Korma"]),
    })
    await user.click(
      screen.getByRole("button", { name: "Fix labels for dish.jpg" })
    )
    const fix = screen.getByRole("dialog", { name: "Fix labels" })
    expect(within(fix).getByText("draft for asset-1")).toBeTruthy()
    expect(
      within(fix).getByText("The menu changed. Check the dish.")
    ).toBeTruthy()
    await user.click(
      within(fix).getByRole("button", { name: "Save corrected" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Fix labels" })).toBeNull()
    )
    expect(labels.save).toHaveBeenLastCalledWith(
      "venue-1",
      expect.objectContaining({ assetId: "asset-1", items: [KORMA] })
    )
    expect(row("dish.jpg").textContent).toContain(
      "Saved · Korma · waiting for manager review"
    )
  })

  it("a refused direct save asks for Fix labels, never only Discard", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    labels.save.mockResolvedValue({
      ok: false,
      assetId: "asset-1",
      code: "unavailable_items",
      message: "One of these items is no longer on the menu.",
    })
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("dish.jpg"),
    ])
    act(() => find("dish.jpg").reserve("asset-1"))
    await act(async () => find("dish.jpg").resolve())
    await labels.choose((id) => input(id))
    await waitFor(() =>
      expect(row("dish.jpg").textContent).toContain("Needs attention")
    )
    expect(row("dish.jpg").textContent).toContain(
      "The menu changed. Check the dish."
    )
    expect(
      screen.getByRole("button", { name: "Fix labels for dish.jpg" })
    ).toBeTruthy()
    // One action: Fix labels (the photo itself is safe, so no Remove).
    expect(
      within(row("dish.jpg"))
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Fix labels"])
  })

  it("no answer: Labels not saved yet, and Retry labels sends them again", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    labels.save.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("dish.jpg"),
    ])
    act(() => find("dish.jpg").reserve("asset-1"))
    await act(async () => find("dish.jpg").resolve())
    await labels.choose((id) => input(id))
    await waitFor(() =>
      expect(row("dish.jpg").textContent).toContain("Labels not saved yet.")
    )
    expect(row("dish.jpg").textContent).toContain("Needs attention")

    labels.save.mockResolvedValueOnce({
      ok: true,
      assetId: "asset-1",
      state: "saved",
      labels: summary(["Onion Bhaji"]),
    })
    await user.click(
      screen.getByRole("button", { name: "Retry labels for dish.jpg" })
    )
    await waitFor(() =>
      expect(row("dish.jpg").textContent).toContain(
        "Saved · Onion Bhaji · waiting for manager review"
      )
    )
    expect(labels.save).toHaveBeenCalledTimes(2)
  })

  it("done without a finalise answer: asks the server whether the labels were applied", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    labels.attention.mockResolvedValueOnce([])
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    act(() => find("b.jpg").reserve("asset-b"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(2))

    await act(async () => find("a.jpg").resolve())
    await waitFor(() =>
      expect(row("a.jpg").textContent).toContain(
        "Saved · Onion Bhaji · waiting for manager review"
      )
    )
    labels.attention.mockResolvedValueOnce([
      {
        assetId: "asset-b",
        venueId: "venue-1",
        status: "needs_attention",
        code: "catalogue_changed",
        message: "The menu changed. Check the dish.",
        input: input("asset-b"),
        uploadState: "ready",
        mediaType: "image",
        thumbnailUrl: null,
        updatedAt: "2026-11-07T10:00:00Z",
      },
    ])
    await act(async () => find("b.jpg").resolve())
    await waitFor(() =>
      expect(row("b.jpg").textContent).toContain("Needs attention")
    )
    expect(
      screen.getByRole("button", { name: "Fix labels for b.jpg" })
    ).toBeTruthy()
  })
})

describe("Saving sheet: files that fail", () => {
  it("a file that can't be used shows the reason and Remove only, and its labels are not saved", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("broken.jpg"),
    ])
    act(() => find("broken.jpg").reserve("asset-x"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    await act(async () =>
      find("broken.jpg").reject(
        Object.assign(new Error("The photo could not be decoded."), {
          error: { code: "processing_failed", retryable: false },
        })
      )
    )
    const broken = row("broken.jpg")
    expect(broken.textContent).toContain("Needs attention")
    expect(broken.textContent).toContain(
      "This file can't be used: The photo could not be decoded."
    )
    expect(broken.textContent).toContain("Not saved (photo not saved)")
    expect(broken.textContent).not.toContain(
      "Labels will save when this file is ready"
    )
    expect(within(broken).queryByRole("button", { name: /Retry/ })).toBeNull()
    expect(
      within(broken).getByRole("button", { name: "Remove broken.jpg" })
    ).toBeTruthy()
    expect(screen.queryByText(/still saving labels/)).toBeNull()
    expect(labels.panel.current?.disabledIds).toEqual([
      labels.panel.current!.items[0].id,
    ])

    await user.click(
      within(broken).getByRole("button", { name: "Remove broken.jpg" })
    )
    expect(screen.queryByRole("list", { name: "Files" })).toBeNull()
    expect(labels.discard).toHaveBeenCalledWith("asset-x")
  })

  it("a retryable failure keeps Retry", async () => {
    const { upload, find } = heldUploader()
    sheet({ uploader: upload })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    await waitFor(() => expect(find("a.jpg")).toBeTruthy())
    await act(async () =>
      find("a.jpg").reject(new Error("The upload was interrupted."))
    )
    expect(row("a.jpg").textContent).toContain("Needs attention")
    await user.click(screen.getByRole("button", { name: "Retry a.jpg" }))
    await act(async () => find("a.jpg").resolve())
    expect(row("a.jpg").textContent).toContain("Saved")
  })
})

describe("Saving sheet: leaving", () => {
  it("Done with an incomplete choice asks first; uploads carry on either way", async () => {
    const { upload, held } = heldUploader()
    const labels = labelsConfig()
    const { user, onOpenChange, rerender } = sheet({
      uploader: upload,
      labels: labels.config,
    })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    await waitFor(() => expect(held).toHaveLength(1))
    act(() => labels.panel.current!.onPendingChange(true))
    await user.click(screen.getByRole("button", { name: "Done" }))
    const confirm = screen.getByRole("alertdialog")
    expect(confirm.textContent).toContain(
      "Uploads carry on; only these labels are discarded."
    )
    await user.click(
      within(confirm).getByRole("button", { name: "Keep labelling" })
    )
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Done" }))
    await user.click(screen.getByRole("button", { name: "Discard labels" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(false)
    expect(held[0].signal.aborted).toBe(false)
    await act(async () => held[0].resolve())
    rerender(true)
    // Finished while hidden, so the queue cleared; a cancelled file would
    // still be listed as needing attention.
    expect(screen.queryByRole("list", { name: "Files" })).toBeNull()
  })

  it("the leave guard counts labels the server does not have yet, not kept ones", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    labels.save.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const loggedOut = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <LeaveGuard>
        <UploadDialog
          open
          onOpenChange={vi.fn()}
          uploader={upload}
          limits={LIMITS}
          labels={labels.config}
          startOnPick
          keepRunningWhenClosed
        />
        <form data-logout onSubmit={loggedOut}>
          <button type="submit">Log out</button>
        </form>
      </LeaveGuard>
    )
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await act(async () => find("a.jpg").resolve())
    await labels.choose((id) => input(id))
    await waitFor(() =>
      expect(row("a.jpg").textContent).toContain("Labels not saved yet.")
    )

    // The photo is safe, its labels are not: reload and Log out both ask.
    const unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await user.click(screen.getByRole("button", { name: "Done" }))
    await user.click(
      screen.getByRole("button", { name: "Log out", hidden: true })
    )
    const ask = await screen.findByRole("alertdialog")
    expect(within(ask).getByText("Log out now?")).toBeTruthy()
    expect(ask.textContent).toContain("Labels for 1 photo haven't saved yet.")
    expect(loggedOut).not.toHaveBeenCalled()
    await user.click(within(ask).getByRole("button", { name: "Stay" }))

    // Retried: kept by the server now (finalise has not said otherwise), so
    // leaving loses nothing.
    labels.attention.mockReturnValue(new Promise(() => {}))
    await user.click(
      screen.getByRole("button", {
        name: "Retry labels for a.jpg",
        hidden: true,
      })
    )
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const again = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(again)
      expect(again.defaultPrevented).toBe(false)
    })
    expect(labels.attention).toHaveBeenCalled()
    expect(row("a.jpg").textContent).toContain("Saving…")
  })

  it("reports files saving labels and needing attention to the host", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    const { onBusyChange } = sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalled())
    labels.attention.mockResolvedValueOnce(null)
    await act(async () => find("a.jpg").resolve())
    await waitFor(() =>
      expect(onBusyChange).toHaveBeenLastCalledWith({
        active: 0,
        failed: 0,
        stopped: 0,
        attention: 1,
      })
    )
    expect(row("a.jpg").textContent).toContain("Labels not saved yet.")
    // Retry asks again whether finalise applied them (nothing is sent twice).
    await user.click(
      screen.getByRole("button", { name: "Retry labels for a.jpg" })
    )
    await waitFor(() =>
      expect(onBusyChange).toHaveBeenLastCalledWith({
        active: 0,
        failed: 0,
        stopped: 0,
      })
    )
    expect(labels.save).toHaveBeenCalledTimes(1)
  })
})

describe("Saving sheet: label edge cases", () => {
  it("cleared while finalise applied them: the empty choice is sent over the photo's labels", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    await labels.choose((id) => input(id, []))
    await waitFor(() => expect(labels.discard).toHaveBeenCalledWith("asset-a"))
    // Finalise got there first and put the dish on the photo.
    labels.save.mockResolvedValueOnce({
      ok: true,
      assetId: "asset-a",
      state: "saved",
      labels: summary([], 2),
    })
    await act(async () =>
      find("a.jpg").resolve({
        state: "saved",
        labels: summary(["Onion Bhaji"]),
      })
    )
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(2))
    expect(labels.save).toHaveBeenLastCalledWith(
      "venue-1",
      expect.objectContaining({
        assetId: "asset-a",
        items: [],
        expectedRevision: 1,
      })
    )
    await waitFor(() =>
      expect(row("a.jpg").textContent?.trim()).toMatch(/Saved$/)
    )
  })

  it("a send with no answer is discarded when the person clears the labels", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    labels.save.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(row("a.jpg").textContent).toContain("Saving…"))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    await labels.choose((id) => input(id, []))
    await waitFor(() => expect(labels.discard).toHaveBeenCalledWith("asset-a"))
  })

  it("removing a file while its labels are being sent discards what the send left", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    let answer = (_: UploadLabelPostResult) => {}
    labels.save.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve))
    )
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole("button", { name: "Cancel a.jpg" }))
    expect(labels.discard).not.toHaveBeenCalled()
    await act(async () =>
      answer({ ok: true, assetId: "asset-a", state: "pending" })
    )
    expect(labels.discard).toHaveBeenCalledWith("asset-a")
  })

  it("finalise's own wording for a menu change still reads as C5 copy", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalled())
    await act(async () =>
      find("a.jpg").resolve({
        state: "needs_attention",
        code: "catalogue_changed",
        message: "The menu changed while you were labelling.",
      })
    )
    await waitFor(() =>
      expect(row("a.jpg").textContent).toContain(
        "The menu changed. Check the dish."
      )
    )
  })

  it("a dish waiting for the menu is not Saved and counts as unsaved until it is sent", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    let menu = false
    const seed = (item: { id: string }) =>
      menu ? { venueId: "venue-1", input: input(item.id) } : undefined
    const { rerender } = render(
      <UploadDialog
        open
        onOpenChange={vi.fn()}
        uploader={upload}
        limits={LIMITS}
        startOnPick
        keepRunningWhenClosed
        labels={{ ...labels.config, seed }}
      />
    )
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("dish.jpg"),
    ])
    act(() => find("dish.jpg").reserve("asset-d"))
    await act(async () => find("dish.jpg").resolve())
    expect(row("dish.jpg").textContent).toContain("Saving…")
    expect(row("dish.jpg").textContent).not.toContain("Saved")
    const unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    // The menu arrives: the dish is applied and sent.
    menu = true
    labels.save.mockResolvedValueOnce({
      ok: true,
      assetId: "asset-d",
      state: "saved",
      labels: summary(["Onion Bhaji"]),
    })
    rerender(
      <UploadDialog
        open
        onOpenChange={vi.fn()}
        uploader={upload}
        limits={LIMITS}
        startOnPick
        keepRunningWhenClosed
        labels={{ ...labels.config, seed }}
      />
    )
    await waitFor(() =>
      expect(row("dish.jpg").textContent).toContain(
        "Saved · Onion Bhaji · waiting for manager review"
      )
    )
  })

  it("still kept for a ready photo: sent again once, then asks for Retry", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    const kept: PendingLabelItem = {
      assetId: "asset-a",
      venueId: "venue-1",
      status: "pending",
      code: null,
      message: null,
      input: input("asset-a"),
      uploadState: "ready",
      mediaType: "image",
      thumbnailUrl: null,
      updatedAt: "2026-11-07T10:00:00Z",
    }
    labels.attention.mockResolvedValue([kept])
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(1))
    await act(async () => find("a.jpg").resolve())
    await waitFor(() =>
      expect(row("a.jpg").textContent).toContain("Labels not saved yet.")
    )
    expect(labels.save).toHaveBeenCalledTimes(2)
    expect(labels.attention).toHaveBeenCalledTimes(2)
  })

  it("a conflict is sent again once at the photo's revision", async () => {
    const { upload, find } = heldUploader()
    const labels = labelsConfig()
    labels.save
      .mockResolvedValueOnce({
        ok: false,
        assetId: "asset-a",
        code: "conflict",
        message: "These labels changed.",
        current: summary(["Korma"], 3),
      })
      .mockResolvedValueOnce({
        ok: true,
        assetId: "asset-a",
        state: "saved",
        labels: summary(["Onion Bhaji"], 4),
      })
    sheet({ uploader: upload, labels: labels.config })
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
    ])
    act(() => find("a.jpg").reserve("asset-a"))
    await act(async () => find("a.jpg").resolve())
    await labels.choose((id) => input(id))
    await waitFor(() => expect(labels.save).toHaveBeenCalledTimes(2))
    expect(labels.save).toHaveBeenLastCalledWith(
      "venue-1",
      expect.objectContaining({ expectedRevision: 3 })
    )
    await waitFor(() =>
      expect(row("a.jpg").textContent).toContain("Saved · Onion Bhaji")
    )
  })
})
