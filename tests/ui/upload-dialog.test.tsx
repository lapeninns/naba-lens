// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
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

function jpeg(name: string) {
  return new File([new Uint8Array(64)], name, { type: "image/jpeg" })
}

/** Fails files named *fail* on their first attempt; reports progress and processing. */
const fakeUploader: Uploader = async (file, ctx) => {
  ctx.setResumeToken(ctx.resumeToken ?? `asset-${file.name}`)
  ctx.onProgress(0.5)
  ctx.onProcessing()
  await Promise.resolve()
  if (file.name.includes("fail") && ctx.attempt === 1) throw new Error("Server validation failed")
}

function setup(uploader: Uploader = fakeUploader) {
  const onUploaded = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <UploadDialog
      open
      onOpenChange={onOpenChange}
      uploader={uploader}
      limits={LIMITS}
      onUploaded={onUploaded}
    />
  )
  return { user: userEvent.setup(), onUploaded, onOpenChange }
}

describe("UploadDialog", () => {
  it("previews selected files, removes one, uploads the rest and reports completion", async () => {
    const { user, onUploaded } = setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("one.jpg"),
      jpeg("two.jpg"),
    ])
    const files = screen.getByRole("list", { name: "Files" })
    expect(within(files).getAllByRole("listitem")).toHaveLength(2)

    await user.click(screen.getByRole("button", { name: "Remove one.jpg" }))
    expect(within(files).getAllByRole("listitem")).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    expect(await screen.findByText("1 uploaded")).toBeTruthy()
    expect(onUploaded).toHaveBeenCalledWith(1)
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy()
  })

  it("shows a per-file failure, keeps the successful file and retries", async () => {
    const { user, onUploaded } = setup()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("good.jpg"),
      jpeg("fail.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 2 files" }))
    expect(await screen.findByText("1 uploaded · 1 failed")).toBeTruthy()
    expect(screen.getByText(/Server validation failed/)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Retry fail.jpg" }))
    expect(await screen.findByText("2 uploaded")).toBeTruthy()
    expect(onUploaded).toHaveBeenNthCalledWith(1, 1)
    expect(onUploaded).toHaveBeenNthCalledWith(2, 1)
  })

  it("explains rejected files without adding them", async () => {
    const { user } = setup()
    const big = new File([new Uint8Array(8)], "big.jpg", { type: "image/jpeg" })
    Object.defineProperty(big, "size", { value: LIMITS.maxPhotoBytes + 1 })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [big])
    expect(screen.getByText("1 file was not added")).toBeTruthy()
    expect(screen.getByText(/Photos can be up to 20 MB/)).toBeTruthy()
    expect(screen.queryByRole("list", { name: "Files" })).toBeNull()
  })

  it("does not close while uploads are running, and cancel stops them", async () => {
    const never: Uploader = (_file, ctx) =>
      new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("x"))))
    const { user, onOpenChange } = setup(never)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [jpeg("slow.jpg")])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    expect(screen.getByText(/Uploading/)).toBeTruthy()

    await user.keyboard("{Escape}")
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Uploads are still running/)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Cancel all" }))
    await waitFor(() => expect(screen.getByText("0 uploaded · 1 cancelled")).toBeTruthy())
    expect(screen.getByRole("button", { name: "Retry slow.jpg" })).toBeTruthy()
  })
})
