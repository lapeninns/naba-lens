// @vitest-environment jsdom
// The end of adding photos when they post straight to the Album (D21; the
// Open Design handoff of 20 Nov 2026, "Photos added"): the title says the
// photos were added, and while any has no label the sheet offers Label now
// (the one primary action) or Label later, each explained.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UploadDialog } from "@/components/nabalens/upload-dialog"
import type { Uploader } from "@/components/nabalens/upload-queue"

vi.mock("@/lib/config/staff-album-posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/staff-album-posts")>()),
  STAFF_ALBUM_POSTS: true,
}))

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

afterEach(() => cleanup())

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

const done: Uploader = async () => {}

function input() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!
}

describe("UploadDialog when photos post to the Album", () => {
  it("says the photos were added and offers Label now or Label later", async () => {
    const user = userEvent.setup()
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={done}
        limits={LIMITS}
        startOnPick
        keepRunningWhenClosed
        albumPosting
      />
    )
    await user.upload(input(), [jpeg("momo-1.jpg"), jpeg("momo-2.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "2 photos added",
    })
    expect(within(dialog).getByText("2 photos have no label yet")).toBeTruthy()
    const now = within(dialog).getByRole("link", { name: "Label now" })
    expect(now.getAttribute("href")).toBe("/staff/album/match-later?select=1")
    expect(now.getAttribute("data-variant")).toBe("primary")
    expect(
      within(dialog)
        .getByRole("link", { name: "Label later" })
        .getAttribute("href")
    ).toBe("/staff/photos")
    expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull()
  })

  it("keeps Done, and no choice, when photos are not posted", async () => {
    const user = userEvent.setup()
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={done}
        limits={LIMITS}
        startOnPick
        keepRunningWhenClosed
      />
    )
    await user.upload(input(), [jpeg("a.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    expect(
      await within(dialog).findByRole("button", { name: "Done" })
    ).toBeTruthy()
    expect(within(dialog).queryByRole("link", { name: "Label now" })).toBeNull()
  })

  it("counts a video as saved, since only photos post to the Album", async () => {
    const user = userEvent.setup()
    render(
      <UploadDialog
        open
        onOpenChange={() => {}}
        uploader={done}
        limits={LIMITS}
        startOnPick
        keepRunningWhenClosed
        albumPosting
      />
    )
    await user.upload(input(), [
      jpeg("momo.jpg"),
      new File([new Uint8Array(64)], "clip.mp4", { type: "video/mp4" }),
    ])
    const dialog = await screen.findByRole("dialog", { name: "2 files added" })
    expect(within(dialog).getByText("1 posted · 1 saved")).toBeTruthy()
  })
})
