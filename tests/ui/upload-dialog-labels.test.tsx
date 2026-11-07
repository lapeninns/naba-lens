// @vitest-environment jsdom
// v0.3: optional "Label these files" after upload. Labelling is offered only
// for finished files with a known asset id and never blocks or changes uploads.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UploadDialog } from "@/components/nabalens/upload-dialog"
import type { Uploader } from "@/components/nabalens/upload-queue"
import { EMPTY_LABEL_SUMMARY, type SaveLabelsInput } from "@/lib/menus/types"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

afterEach(cleanup)

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

/** Ready with an asset id; files named *fail* fail; *noid* resolve without one. */
const uploader: Uploader = async (file) => {
  await Promise.resolve()
  if (file.name.includes("fail")) throw new Error("Server validation failed")
  if (file.name.includes("noid")) return
  return { assetId: `asset-${file.name}` }
}

function setup(onLabel?: (ids: string[]) => void) {
  const onOpenChange = vi.fn()
  render(
    <UploadDialog
      open
      onOpenChange={onOpenChange}
      uploader={uploader}
      limits={LIMITS}
      onLabel={onLabel}
    />
  )
  return { user: userEvent.setup(), onOpenChange }
}

describe("UploadDialog optional labelling", () => {
  it("applies each queued draft only when its file is ready, including after retry", async () => {
    const attempts = new Map<
      string,
      PromiseWithResolvers<{ assetId: string }>
    >()
    const upload: Uploader = (file, context) => {
      const attempt = Promise.withResolvers<{ assetId: string }>()
      attempts.set(file.name, attempt)
      context.onProcessing()
      return attempt.promise
    }
    const save = vi.fn(async (_venue: string, input: SaveLabelsInput) => ({
      ok: true as const,
      assetId: input.assetId,
      labels: EMPTY_LABEL_SUMMARY,
    }))
    const user = userEvent.setup()
    render(
      <UploadDialog
        open
        keepRunningWhenClosed
        onOpenChange={vi.fn()}
        uploader={upload}
        limits={LIMITS}
        draftLabels={{
          save,
          renderEditor: ({ items, onQueue, onClose }) => (
            <button
              onClick={() => {
                onQueue(
                  "venue",
                  items.map((item) => ({
                    assetId: item.id,
                    expectedRevision: 0,
                    catalogueVersionId: "menu",
                    contentTypes: ["preparation"],
                    note: item.file.name,
                    items: [],
                    missingItem: null,
                  }))
                )
                onClose()
              }}
            >
              Save test drafts
            </button>
          ),
        }}
      />
    )
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("first.jpg"),
      jpeg("second.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload and label" }))
    await waitFor(() => expect(attempts.size).toBe(2))
    await user.click(screen.getByRole("button", { name: "Save test drafts" }))
    expect(save).not.toHaveBeenCalled()

    await act(async () =>
      attempts.get("first.jpg")!.resolve({ assetId: "first-asset" })
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenNthCalledWith(
      1,
      "venue",
      expect.objectContaining({
        assetId: "first-asset",
        note: "first.jpg",
      })
    )
    const failed = attempts.get("second.jpg")!
    await act(async () => failed.reject(new Error("Upload interrupted")))
    expect(
      screen.getByText("Labels will save when this file is ready")
    ).toBeTruthy()
    expect(save).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "Retry second.jpg" }))
    await waitFor(() => expect(attempts.get("second.jpg")).not.toBe(failed))
    await act(async () =>
      attempts.get("second.jpg")!.resolve({ assetId: "second-asset" })
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenNthCalledWith(
      2,
      "venue",
      expect.objectContaining({
        assetId: "second-asset",
        note: "second.jpg",
      })
    )
    expect(await screen.findAllByText("Labels saved")).toHaveLength(2)
  })

  it("offers labelling for the finished files only, then closes", async () => {
    const onLabel = vi.fn()
    const { user, onOpenChange } = setup(onLabel)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
      jpeg("fail.jpg"),
    ])
    expect(screen.queryByRole("button", { name: /Label these files/ })).toBe(
      null
    )
    await user.click(screen.getByRole("button", { name: "Upload 3 files" }))
    expect(await screen.findByText("2 uploaded · 1 failed")).toBeTruthy()
    // Retry stays available next to the optional action.
    expect(screen.getByRole("button", { name: "Retry 1 failed" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Label these files" }))
    expect(onLabel).toHaveBeenCalledWith(["asset-a.jpg", "asset-b.jpg"])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("uses singular copy and can be skipped with Done", async () => {
    const onLabel = vi.fn()
    const { user, onOpenChange } = setup(onLabel)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("one.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    expect(
      await screen.findByRole("button", { name: "Label this file" })
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(onLabel).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("does not offer labelling without asset ids or without a handler", async () => {
    const onLabel = vi.fn()
    const first = setup(onLabel)
    await first.user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("noid.jpg"),
    ])
    await first.user.click(
      screen.getByRole("button", { name: "Upload 1 file" })
    )
    expect(await screen.findByText("1 uploaded")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Label th/ })).toBe(null)
    cleanup()

    const second = setup(undefined)
    await second.user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("x.jpg"),
    ])
    await second.user.click(
      screen.getByRole("button", { name: "Upload 1 file" })
    )
    expect(await screen.findByText("1 uploaded")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Label th/ })).toBe(null)
  })
})
