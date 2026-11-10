// @vitest-environment jsdom
// B02-06 in the upload sheet: focus never drops to the page (UP-08, UP-09),
// slow is said (UP-19), processing can't be cancelled and counts as finishing
// (UP-05), a lost reply is never raw browser text (UP-06), the progress bar's
// name (UP-13), phone layout (UP-15, UP-16, UP-17) and the sign-in sheet's
// Retry copy (UP-03).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SignInAgainSheet,
  type SessionGuard,
} from "@/components/nabalens/session-guard"
import { leaveCopy } from "@/components/nabalens/shell/leave-guard"
import {
  STILL_PROCESSING,
  UploadDialog,
} from "@/components/nabalens/upload-dialog"
import {
  STALLED_PROCESSING_MS,
  UploadQueue,
  type UploadContext,
  type Uploader,
} from "@/components/nabalens/upload-queue"
import { createUploader } from "@/lib/upload/uploader"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function jpeg(name: string) {
  return new File([new Uint8Array(64)], name, { type: "image/jpeg" })
}

function setup(uploader: Uploader) {
  render(
    <UploadDialog
      open
      onOpenChange={() => {}}
      uploader={uploader}
      limits={LIMITS}
    />
  )
}

/** Each call waits until the test settles it; processing is reported first. */
function heldUploader(processing = false) {
  const calls: {
    file: File
    ctx: UploadContext
    resolve: () => void
    reject: (e: unknown) => void
  }[] = []
  const upload: Uploader = (file, ctx) =>
    new Promise<void>((resolve, reject) => {
      if (processing) ctx.onProcessing()
      else ctx.onProgress(0.4)
      ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
      calls.push({ file, ctx, resolve, reject })
    })
  return { upload, calls }
}

const rows = () =>
  within(screen.getByRole("list", { name: "Files" })).getAllByRole("listitem")

describe("focus in the upload sheet (UP-08, UP-09)", () => {
  it("Remove moves focus to the next row's first action, then the title", async () => {
    const user = userEvent.setup()
    setup(heldUploader().upload)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("one.jpg"),
      jpeg("two.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Remove one.jpg" }))
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove two.jpg" })
    )
    await user.click(screen.getByRole("button", { name: "Remove two.jpg" }))
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Upload photos or videos" })
    )
  })

  it("Cancel moves focus to that row's Retry", async () => {
    const user = userEvent.setup()
    setup(heldUploader().upload)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("slow.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    await user.click(
      await screen.findByRole("button", { name: "Cancel slow.jpg" })
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Retry slow.jpg" })
      )
    )
  })

  it("Retry keeps focus on the row's status as the button goes", async () => {
    const user = userEvent.setup()
    let attempt = 0
    setup(async () => {
      attempt += 1
      if (attempt === 1) throw new Error("Server validation failed")
      await new Promise(() => {})
    })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("fail.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    await user.click(
      await screen.findByRole("button", { name: "Retry fail.jpg" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Retry fail.jpg" })
      ).toBeNull()
    )
    const status = document.activeElement as HTMLElement
    expect(status.tagName).toBe("P")
    expect(rows()[0].getAttribute("aria-describedby")).toBe(status.id)
  })
})

describe("the progress bar (UP-13)", () => {
  it("is named by the file; its value carries the percentage", async () => {
    const user = userEvent.setup()
    setup(heldUploader().upload)
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg("dish.jpg"),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    const bar = await screen.findByRole("progressbar")
    await waitFor(() => expect(bar.getAttribute("aria-valuenow")).toBe("40"))
    expect(bar.getAttribute("aria-label")).toBe("dish.jpg")
  })
})

describe("layout on phones (UP-15, UP-16, UP-17)", () => {
  it("wraps long names with the full text, moves a failed row's actions to their own line, and keeps the footer in reach", async () => {
    const user = userEvent.setup()
    const name = `${"a-very-long-file-name-".repeat(4)}.jpg`
    setup(async () => {
      throw new Error("Server validation failed")
    })
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      jpeg(name),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    const retry = await screen.findByRole("button", { name: `Retry ${name}` })
    const label = within(rows()[0]).getByText(name)
    expect(label.getAttribute("title")).toBe(name)
    expect(label.className).toContain("line-clamp-2")
    expect(label.className).not.toContain("truncate")
    expect(retry.parentElement!.className).toContain("max-[25rem]:basis-full")
    expect(
      screen.getByRole("button", { name: "Done" }).parentElement!.className
    ).toContain("sticky")
  })
})

describe("slow processing (UP-19) and no Cancel while processing (UP-05)", () => {
  it("says it is still processing after 30 s, then offers Retry after the stale window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { upload, calls } = heldUploader(true)
    setup(upload)
    fireEvent.change(screen.getByLabelText("Choose photos or videos"), {
      target: { files: [jpeg("slow.jpg")] },
    })
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.queryByRole("button", { name: "Cancel slow.jpg" })).toBeNull()
    expect(screen.queryByText(STILL_PROCESSING)).toBeNull()

    await act(async () => vi.advanceTimersByTime(30_000))
    expect(screen.getByText(STILL_PROCESSING)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry slow.jpg" })).toBeNull()

    await act(async () =>
      vi.advanceTimersByTime(STALLED_PROCESSING_MS - 30_000)
    )
    expect(
      screen.getByText(
        "We couldn't confirm this photo saved. Tap Retry; nothing is sent twice."
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry slow.jpg" }))
    await waitFor(() => expect(calls).toHaveLength(2))
    // The first run was given up: its late answer changes nothing.
    expect(calls[0].ctx.signal.aborted).toBe(true)
  })

  it("the queue never cancels a processing file and retries one only once stalled", async () => {
    const { upload, calls } = heldUploader(true)
    const queue = new UploadQueue(upload, LIMITS)
    queue.add([jpeg("a.jpg")])
    queue.start()
    await Promise.resolve()
    const [item] = queue.getSnapshot()
    expect(item.status).toBe("processing")
    queue.cancel(item.id)
    queue.cancelAll()
    queue.retry(item.id)
    expect(queue.getSnapshot()[0].status).toBe("processing")
    expect(calls).toHaveLength(1)
    queue.retry(item.id, item.processingAt! + STALLED_PROCESSING_MS)
    await Promise.resolve()
    expect(calls).toHaveLength(2)
  })

  it("the leave dialog counts processing files as finishing, not stopping", () => {
    expect(leaveCopy("leave", 1, 0, 1).body).toBe(
      "Leave now and 1 upload stops. Finished photos stay uploaded. 1 photo is finishing and will still be saved."
    )
    expect(leaveCopy("logout", 0, 1, 2).body).toBe(
      "2 photos are finishing and will still be saved. Labels for 1 photo haven't saved yet."
    )
  })
})

describe("a lost reserve or finalise reply (UP-06)", () => {
  const limits = { maxPhotoBytes: 1024 * 1024, maxVideoBytes: 1024 * 1024 }
  const reserved = {
    assetId: "asset-1",
    objectKey: "u/asset-1/original.jpg",
    bucket: "media" as const,
    resumable: false,
    state: "processing" as const,
  }

  it("never shows the browser's own text", async () => {
    const lost = createUploader({
      reserve: async () => {
        throw new TypeError("Failed to fetch")
      },
      finalise: async () => ({ state: "ready" }),
      supabaseUrl: "https://example.test",
      getAccessToken: async () => null,
      limits,
    })
    expect(
      (await lost(jpeg("a.jpg"), { idempotencyKey: "k1" })).error?.message
    ).toBe(
      "We couldn't confirm this photo saved. Tap Retry; nothing is sent twice."
    )

    const lostFinalise = createUploader({
      reserve: async () => reserved,
      finalise: async () => {
        throw new TypeError("Load failed")
      },
      supabaseUrl: "https://example.test",
      getAccessToken: async () => null,
      limits,
    })
    const result = await lostFinalise(jpeg("a.jpg"), { idempotencyKey: "k2" })
    expect(result.error).toMatchObject({
      code: "finalise_failed",
      retryable: true,
      message:
        "We couldn't confirm this photo saved. Tap Retry; nothing is sent twice.",
    })
  })

  it("keeps a server's own answer", async () => {
    const refused = createUploader({
      reserve: async () => {
        throw new Error("Your upload limit was reached.")
      },
      finalise: async () => ({ state: "ready" }),
      supabaseUrl: "https://example.test",
      getAccessToken: async () => null,
      limits,
    })
    expect(
      (await refused(jpeg("a.jpg"), { idempotencyKey: "k3" })).error?.message
    ).toBe("Your upload limit was reached.")
  })
})

describe("signing in again while this tab holds the files (UP-03)", () => {
  const guard: SessionGuard = {
    email: "priya.gurung@example.test",
    captchaRequired: false,
    captchaSiteKey: null,
    sendLink: async () => ({}),
    isSignedIn: async () => false,
  }

  it("says to tap Retry here, never to choose them again", async () => {
    render(
      <SignInAgainSheet
        open
        onOpenChange={() => {}}
        guard={{ ...guard, verifyCode: async () => ({}) }}
        stopped={2}
      />
    )
    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain(
      "Sign in again here, then tap Retry on each stopped photo. Nothing is sent twice."
    )
    expect(dialog.textContent).not.toMatch(/choose/i)
  })

  it("without a code, comes back to this page to tap Retry", async () => {
    render(
      <SignInAgainSheet
        open
        onOpenChange={() => {}}
        guard={guard}
        stopped={1}
      />
    )
    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain(
      "Open it on this phone, come back to this page, then tap Retry on the stopped photo."
    )
    expect(dialog.textContent).not.toMatch(/choose/i)
  })
})
