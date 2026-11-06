// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UploadDialog } from "@/components/nabalens/upload-dialog"
import type { Uploader } from "@/components/nabalens/upload-queue"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 1,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

function jpeg(name: string) {
  return new File([new Uint8Array(64)], name, { type: "image/jpeg" })
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online)
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Each call waits until the test settles it. */
function heldUploader() {
  const held: {
    name: string
    resolve: () => void
    reject: (e: Error) => void
  }[] = []
  const upload: Uploader = (file) =>
    new Promise<void>((resolve, reject) => {
      held.push({ name: file.name, resolve, reject })
    })
  return { upload, held }
}

function setup(upload: Uploader) {
  render(
    <UploadDialog
      open
      onOpenChange={() => {}}
      uploader={upload}
      limits={LIMITS}
    />
  )
  return userEvent.setup()
}

const status = () =>
  within(screen.getByRole("dialog")).getAllByRole("status").at(-1)!

describe("UploadDialog on a weak signal", () => {
  it("counts the ready files before the upload starts", async () => {
    const user = setup(heldUploader().upload)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
      jpeg("c.jpg"),
    ])
    expect(status().textContent).toBe("3 ready · up to 10 at a time")
  })

  it("waits for a signal while offline and carries on when it is back", async () => {
    const { upload, held } = heldUploader()
    const user = setup(upload)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
      jpeg("c.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 3 files" }))
    expect(
      screen.getByText("Keep this page open while files upload.")
    ).toBeTruthy()
    expect(status().textContent).toBe("0 uploaded · 3 in progress")

    await act(async () => held[0].resolve())
    setOnline(false)
    expect(
      screen.getByText(
        "Waiting for a signal. Keep this page open; nothing is sent twice."
      )
    ).toBeTruthy()
    await act(async () => held[1].reject(new Error("Failed to fetch")))
    expect(status().textContent).toBe("1 uploaded · 2 waiting")
    expect(screen.queryByText(/Failed/)).toBeNull()
    expect(held).toHaveLength(2)

    setOnline(true)
    expect(screen.queryByText(/Waiting for a signal/)).toBeNull()
    expect(held.map((h) => h.name)).toEqual(["a.jpg", "b.jpg", "b.jpg"])
    expect(status().textContent).toBe("1 uploaded · 2 in progress")
  })

  it("offers per-file Retry and one Retry N failed primary after failures", async () => {
    const { upload, held } = heldUploader()
    const user = setup(upload)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("a.jpg"),
      jpeg("b.jpg"),
      jpeg("c.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 3 files" }))
    await act(async () => held[0].reject(new Error("The connection dropped.")))
    await act(async () => held[1].resolve())
    await act(async () => held[2].reject(new Error("The connection dropped.")))
    expect(status().textContent).toBe("1 uploaded · 2 failed")
    expect(screen.getByRole("button", { name: "Retry a.jpg" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Retry c.jpg" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Retry 2 failed" }))
    expect(status().textContent).toBe("1 uploaded · 2 in progress")
    await act(async () => held[3].resolve())
    await act(async () => held[4].reject(new Error("The connection dropped.")))
    expect(screen.getByRole("button", { name: "Retry 1 failed" })).toBeTruthy()
  })
})
