// @vitest-environment jsdom
// UploadDialog's task-flow props: onReady reports each ready asset as soon as
// that file is ready (C4), and imagesOnly keeps videos out (coverage is
// image-only).
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UploadDialog } from "@/components/nabalens/upload-dialog"
import type { Uploader } from "@/components/nabalens/upload-queue"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

afterEach(cleanup)

function file(name: string, type: string) {
  return new File([new Uint8Array(64)], name, { type })
}

/** Ready with an asset ID; files named *fail* fail their first attempt. */
const uploader: Uploader = async (f, ctx) => {
  ctx.onProcessing()
  await Promise.resolve()
  if (f.name.includes("fail") && ctx.attempt === 1) throw new Error("Nope")
  return { assetId: `asset-${f.name}` }
}

describe("UploadDialog onReady", () => {
  it("reports each ready asset once, as soon as it is ready", async () => {
    const onReady = vi.fn()
    const onUploaded = vi.fn()
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={uploader}
        limits={LIMITS}
        onUploaded={onUploaded}
        onReady={onReady}
      />
    )
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      file("a.jpg", "image/jpeg"),
      file("fail.jpg", "image/jpeg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 2 files" }))
    expect(await screen.findByText("1 uploaded · 1 failed")).toBeTruthy()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenLastCalledWith(
      ["asset-a.jpg"],
      [expect.objectContaining({ name: "a.jpg" })]
    )

    await user.click(screen.getByRole("button", { name: "Retry fail.jpg" }))
    expect(await screen.findByText("2 uploaded")).toBeTruthy()
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenLastCalledWith(
      ["asset-fail.jpg"],
      [expect.objectContaining({ name: "fail.jpg" })]
    )
    // Existing callback unchanged.
    expect(onUploaded).toHaveBeenNthCalledWith(1, 1)
    expect(onUploaded).toHaveBeenNthCalledWith(2, 1)
  })

  it("hands over a photo before a slow video in the same batch finishes", async () => {
    let finishVideo = () => {}
    const slow: Uploader = async (f) => {
      if (f.name.endsWith(".mp4"))
        await new Promise<void>((resolve) => (finishVideo = resolve))
      return { assetId: `asset-${f.name}` }
    }
    const onReady = vi.fn()
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={slow}
        limits={LIMITS}
        onReady={onReady}
      />
    )
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      file("clip.mp4", "video/mp4"),
      file("dish.jpg", "image/jpeg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 2 files" }))
    expect(await screen.findByText("1 uploaded · 1 in progress")).toBeTruthy()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenLastCalledWith(
      ["asset-dish.jpg"],
      [expect.objectContaining({ name: "dish.jpg" })]
    )
    await act(async () => finishVideo())
    expect(await screen.findByText("2 uploaded")).toBeTruthy()
    expect(onReady).toHaveBeenLastCalledWith(
      ["asset-clip.mp4"],
      [expect.objectContaining({ name: "clip.mp4" })]
    )
  })

  it("does not call onReady for uploaders that report no asset ID", async () => {
    const onReady = vi.fn()
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={async () => {}}
        limits={LIMITS}
        onReady={onReady}
      />
    )
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      file("a.jpg", "image/jpeg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    expect(await screen.findByText("1 uploaded")).toBeTruthy()
    expect(onReady).not.toHaveBeenCalled()
  })
})

describe("UploadDialog imagesOnly", () => {
  it("accepts photos only and rejects videos with a reason", async () => {
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={uploader}
        limits={LIMITS}
        imagesOnly
      />
    )
    expect(screen.getByRole("heading", { name: "Upload photos" })).toBeTruthy()
    const input = screen.getByLabelText<HTMLInputElement>("Choose photos")
    expect(input.accept).not.toMatch(/video|\.mp4|\.mov/)
    expect(screen.getByLabelText<HTMLInputElement>("Take a photo").accept).toBe(
      "image/*"
    )

    const user = userEvent.setup({ applyAccept: false })
    await user.upload(input, [
      file("dish.jpg", "image/jpeg"),
      file("clip.mp4", "video/mp4"),
      file("notes.txt", "text/plain"),
    ])
    const alert = screen.getByRole("alert")
    expect(within(alert).getByText("2 files were not added")).toBeTruthy()
    expect(alert.textContent).toContain(
      "clip.mp4: Only photos can be added here."
    )
    expect(alert.textContent).toContain(
      "notes.txt: This file type is not supported. Use JPEG, PNG, WebP or HEIC."
    )
    const files = screen.getByRole("list", { name: "Files" })
    expect(within(files).getAllByRole("listitem")).toHaveLength(1)
    expect(within(files).getByText("dish.jpg")).toBeTruthy()
  })

  it("keeps photos-or-videos behaviour by default", () => {
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={uploader}
        limits={LIMITS}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Upload photos or videos" })
    ).toBeTruthy()
    expect(
      screen.getByLabelText<HTMLInputElement>("Choose photos or videos").accept
    ).toMatch(/video\/mp4/)
  })
})
