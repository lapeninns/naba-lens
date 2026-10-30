// @vitest-environment jsdom
// v0.3: optional "Label these files" after upload. Labelling is offered only
// for finished files with a known asset id and never blocks or changes uploads.
import { cleanup, render, screen } from "@testing-library/react"
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
    expect(screen.getByRole("button", { name: "Retry failed" })).toBeTruthy()
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
