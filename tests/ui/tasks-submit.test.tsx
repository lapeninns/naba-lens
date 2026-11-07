// @vitest-environment jsdom
// Staff submit flow: capture/choose -> send with one request ID per intent.
// Retries after a dropped connection or "unavailable" reuse the ID (the server
// replays instead of acting twice); conflicts reload; per-photo reasons show.
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SubmitPhotosInput,
  SubmitPhotosResult,
  SubmittablePhoto,
  SubmittablePhotosResult,
} from "@/components/nabalens/tasks"
import { SubmitPhotosPanel } from "@/components/nabalens/tasks"
import type { Uploader } from "@/components/nabalens/upload-queue"

import { photo } from "./tasks-fixtures"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

const REQUIREMENT = "6c000000-0000-4000-8000-0000000000aa"

const A = photo({
  assetId: "7d000000-0000-4000-8000-00000000000a",
  uploadedAt: "2026-11-02T10:00:00.000Z",
})
const B = photo({
  assetId: "7d000000-0000-4000-8000-00000000000b",
  uploadedAt: "2026-11-01T10:00:00.000Z",
})
const C = photo({
  assetId: "7d000000-0000-4000-8000-00000000000c",
  uploadedAt: "2026-10-30T10:00:00.000Z",
})

function page(
  items: SubmittablePhoto[],
  nextCursor: string | null = null
): SubmittablePhotosResult {
  return { ok: true, items, nextCursor }
}

function sent(
  count: number,
  extra: Partial<Extract<SubmitPhotosResult, { ok: true }>> = {},
  reused = false
): SubmitPhotosResult {
  return {
    ok: true,
    submitted: Array.from({ length: count }, (_, i) => ({
      submissionId: `4a000000-0000-4000-8000-00000000000${i}`,
      assetId: `7d000000-0000-4000-8000-00000000000${i}`,
      state: "submitted" as const,
      revision: 1,
      reused,
    })),
    skipped: [],
    replayed: false,
    ...extra,
  }
}

const noUpload: Uploader = async () => {}

function setup({
  photos = [A, B, C],
  initial = page(photos),
  submit = vi.fn<(input: SubmitPhotosInput) => Promise<SubmitPhotosResult>>(),
  loadPhotos = vi.fn(async () => page(photos)),
  requirementId = REQUIREMENT as string | null,
  replacesSubmissionId = null as string | null,
  uploader = noUpload,
  limits = LIMITS,
} = {}) {
  const onReload = vi.fn()
  const utils = render(
    <SubmitPhotosPanel
      requirementId={requirementId}
      replacesSubmissionId={replacesSubmissionId}
      initialPhotos={initial}
      loadPhotos={loadPhotos}
      submit={submit}
      uploader={uploader}
      limits={limits}
      onReload={onReload}
      signInHref="/login"
    />
  )
  return { user: userEvent.setup(), submit, loadPhotos, onReload, ...utils }
}

const tile = (date: string) =>
  within(screen.getByRole("list", { name: "Your photos" })).getByRole(
    "button",
    {
      // Fixture uploads are at 10:00 London time.
      name: `Photo uploaded ${date}, 10:00`,
    }
  )

beforeEach(() => window.sessionStorage.clear())
afterEach(cleanup)

describe("SubmitPhotosPanel", () => {
  it.each([null, "older"])(
    "retries a failed global upload refresh from the first page with cursor %s",
    async (nextCursor) => {
      const user = userEvent.setup()
      const loadPhotos = vi
        .fn<(input: unknown) => Promise<SubmittablePhotosResult>>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(page([B, A]))
      const panel = (refreshSignal: number) => (
        <SubmitPhotosPanel
          requirementId={REQUIREMENT}
          initialPhotos={page([A], nextCursor)}
          refreshSignal={refreshSignal}
          loadPhotos={loadPhotos}
          submit={vi.fn()}
          uploader={noUpload}
          limits={LIMITS}
          onReload={vi.fn()}
          signInHref="/login"
        />
      )
      const { rerender } = render(panel(0))
      await user.click(tile("2 Nov 2026"))
      rerender(panel(1))
      await user.click(await screen.findByRole("button", { name: "Try again" }))
      await waitFor(() => expect(loadPhotos).toHaveBeenCalledTimes(2))
      expect(loadPhotos).toHaveBeenLastCalledWith({
        requirementId: REQUIREMENT,
        cursor: null,
      })
      expect(tile("1 Nov 2026")).toBeTruthy()
      expect(tile("2 Nov 2026").getAttribute("aria-pressed")).toBe("true")
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    }
  )

  it("retries a failed next page using its pagination cursor", async () => {
    const loadPhotos = vi
      .fn<() => Promise<SubmittablePhotosResult>>()
      .mockResolvedValueOnce({
        ok: false,
        code: "unavailable",
        status: 503,
        message: "offline",
      })
      .mockResolvedValue(page([B]))
    const { user } = setup({ initial: page([A], "older"), loadPhotos })
    await user.click(screen.getByRole("button", { name: "Load more" }))
    await user.click(await screen.findByRole("button", { name: "Try again" }))
    expect(loadPhotos).toHaveBeenNthCalledWith(2, {
      requirementId: REQUIREMENT,
      cursor: "older",
    })
    expect(tile("2 Nov 2026")).toBeTruthy()
    expect(tile("1 Nov 2026")).toBeTruthy()
  })

  it("coalesces refresh signals behind an active photo read and retains selected older photos", async () => {
    const user = userEvent.setup()
    let finishFirst!: (value: SubmittablePhotosResult) => void
    const loadPhotos = vi
      .fn<(input: unknown) => Promise<SubmittablePhotosResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          })
      )
      .mockResolvedValue(page([C]))
    const panel = (refreshSignal: number) => (
      <SubmitPhotosPanel
        requirementId={REQUIREMENT}
        initialPhotos={page([A])}
        refreshSignal={refreshSignal}
        loadPhotos={loadPhotos}
        submit={vi.fn()}
        uploader={noUpload}
        limits={LIMITS}
        onReload={vi.fn()}
        signInHref="/login"
      />
    )
    const { rerender } = render(panel(0))
    await user.click(tile("2 Nov 2026"))
    rerender(panel(1))
    rerender(panel(2))
    rerender(panel(3))
    expect(loadPhotos).toHaveBeenCalledTimes(1)
    await act(async () => finishFirst(page([B])))
    await waitFor(() => expect(loadPhotos).toHaveBeenCalledTimes(2))
    expect(tile("30 Oct 2026")).toBeTruthy()
    expect(tile("2 Nov 2026").getAttribute("aria-pressed")).toBe("true")
  })

  it("finishes pagination before refreshing after an upload and preserves a newly selected page item", async () => {
    const user = userEvent.setup()
    let finishMore!: (value: SubmittablePhotosResult) => void
    let finishRefresh!: (value: SubmittablePhotosResult) => void
    const loadPhotos = vi
      .fn<(input: unknown) => Promise<SubmittablePhotosResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishMore = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve
          })
      )
    const panel = (refreshSignal: number) => (
      <SubmitPhotosPanel
        requirementId={REQUIREMENT}
        initialPhotos={page([A], "older")}
        refreshSignal={refreshSignal}
        loadPhotos={loadPhotos}
        submit={vi.fn()}
        uploader={noUpload}
        limits={LIMITS}
        onReload={vi.fn()}
        signInHref="/login"
      />
    )
    const { rerender } = render(panel(0))
    await user.click(screen.getByRole("button", { name: "Load more" }))
    rerender(panel(1))
    rerender(panel(2))
    expect(loadPhotos).toHaveBeenCalledExactlyOnceWith({
      requirementId: REQUIREMENT,
      cursor: "older",
    })
    await act(async () => finishMore(page([B])))
    await user.click(tile("1 Nov 2026"))
    await act(async () => finishRefresh(page([C])))
    expect(tile("1 Nov 2026").getAttribute("aria-pressed")).toBe("true")
    expect(tile("30 Oct 2026")).toBeTruthy()
    expect(loadPhotos).toHaveBeenCalledTimes(2)
  })

  it("sends the selected photos once and explains that sharing is not gated", async () => {
    const { user, submit, loadPhotos } = setup()
    submit.mockResolvedValue(sent(2))
    expect(
      screen.getByRole("button", { name: "Select photos to send" })
    ).toHaveProperty("disabled", true)

    await user.click(tile("2 Nov 2026"))
    await user.click(tile("1 Nov 2026"))
    expect(tile("2 Nov 2026").getAttribute("aria-pressed")).toBe("true")
    await user.click(screen.getByRole("button", { name: "Send 2 photos" }))

    expect(submit).toHaveBeenCalledTimes(1)
    const input = submit.mock.calls[0][0]
    expect(input.requirementId).toBe(REQUIREMENT)
    expect(input.assetIds).toEqual([A.assetId, B.assetId])
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/)
    const status = await screen.findByRole("status")
    expect(status.textContent).toContain("Sent 2 photos for review.")
    expect(status.textContent).toContain(
      "already in your portfolio and Explore"
    )
    // Selection cleared and eligibility re-read.
    expect(tile("2 Nov 2026").getAttribute("aria-pressed")).toBe("false")
    await waitFor(() =>
      expect(loadPhotos).toHaveBeenCalledWith({
        requirementId: REQUIREMENT,
        cursor: null,
      })
    )
  })

  it("retries a dropped connection with the same request ID", async () => {
    const { user, submit } = setup()
    submit
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(sent(1))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Nothing is sent twice.")

    await user.click(within(alert).getByRole("button", { name: "Try again" }))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1][0].requestId).toBe(
      submit.mock.calls[0][0].requestId
    )
    expect((await screen.findByRole("status")).textContent).toContain(
      "Sent 1 photo for review."
    )
  })

  it("retries 'unavailable' with the same ID and starts a new ID after success", async () => {
    const { user, submit } = setup()
    submit
      .mockResolvedValueOnce({
        ok: false,
        code: "unavailable",
        status: 503,
        message: "x",
      })
      .mockResolvedValueOnce(sent(1))
      .mockResolvedValueOnce(sent(1))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    await user.click(
      within(await screen.findByRole("alert")).getByRole("button", {
        name: "Try again",
      })
    )
    await screen.findByRole("status")
    // A later intent with the same photo is a new request.
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    const ids = submit.mock.calls.map((c) => c[0].requestId)
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })

  it("uses a new request ID when the selection changes after a failure", async () => {
    const { user, submit } = setup()
    submit
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(sent(2))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    await screen.findByRole("alert")
    await user.click(tile("1 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 2 photos" }))
    expect(submit.mock.calls[1][0].requestId).not.toBe(
      submit.mock.calls[0][0].requestId
    )
  })

  it("keeps the request ID across a reload of a pending send", async () => {
    const first = setup()
    first.submit.mockRejectedValueOnce(new Error("page closed"))
    await first.user.click(tile("2 Nov 2026"))
    await first.user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    await screen.findByRole("alert")
    const lost = first.submit.mock.calls[0][0].requestId
    cleanup()

    const second = setup()
    second.submit.mockResolvedValueOnce(sent(1, { replayed: true }))
    await second.user.click(tile("2 Nov 2026"))
    await second.user.click(
      screen.getByRole("button", { name: "Send 1 photo" })
    )
    expect(second.submit.mock.calls[0][0].requestId).toBe(lost)
    expect((await screen.findByRole("status")).textContent).toContain(
      "These photos were already sent. Nothing was sent twice."
    )
  })

  it("offers Reload on a state conflict and starts a new ID afterwards", async () => {
    const { user, submit, onReload } = setup()
    submit
      .mockResolvedValueOnce({
        ok: false,
        code: "state_conflict",
        status: 409,
        message: "x",
      })
      .mockResolvedValueOnce(sent(1))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/This task changed/)
    await user.click(within(alert).getByRole("button", { name: "Reload" }))
    expect(onReload).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    expect(submit.mock.calls[1][0].requestId).not.toBe(
      submit.mock.calls[0][0].requestId
    )
  })

  it("explains losing the assignment (not permitted) and offers Reload", async () => {
    const { user, submit } = setup()
    submit.mockResolvedValueOnce({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: "x",
    })
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/can't send photos to this task any more/)
    expect(within(alert).getByRole("button", { name: "Reload" })).toBeTruthy()
  })

  it("shows per-photo reasons when no photo was eligible and deselects them", async () => {
    const { user, submit } = setup()
    submit.mockResolvedValueOnce({
      ok: false,
      code: "asset_ineligible",
      status: 409,
      message: "x",
      assetErrors: [{ assetId: A.assetId, reason: "counted_elsewhere" }],
    })
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    await screen.findByRole("alert")
    expect(
      screen.getByText("Already counting toward another task.")
    ).toBeTruthy()
    expect(tile("2 Nov 2026").getAttribute("aria-pressed")).toBe("false")
    expect(tile("2 Nov 2026").getAttribute("aria-disabled")).toBe("true")
  })

  it("sends a replacement with the item it answers", async () => {
    const original = "4a000000-0000-4000-8000-0000000000ee"
    const { user, submit } = setup({ replacesSubmissionId: original })
    submit.mockResolvedValueOnce(sent(1))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send another photo" }))
    expect(submit.mock.calls[0][0]).toMatchObject({
      requirementId: REQUIREMENT,
      assetIds: [A.assetId],
      replacesSubmissionId: original,
    })
  })

  it("says who reviews a sent replacement", async () => {
    const { user, submit } = setup({
      replacesSubmissionId: "4a000000-0000-4000-8000-0000000000ee",
    })
    submit.mockResolvedValueOnce(sent(1))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send another photo" }))
    expect((await screen.findByRole("status")).textContent).toContain(
      "Your new photo is waiting for review"
    )
  })

  it("keeps the replacement message when a refresh closes the request mid-send", async () => {
    const submit =
      vi.fn<(input: SubmitPhotosInput) => Promise<SubmitPhotosResult>>()
    let resolve!: (result: SubmitPhotosResult) => void
    submit.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const panel = (replacing: boolean) => (
      <SubmitPhotosPanel
        requirementId={REQUIREMENT}
        replacesSubmissionId={
          replacing ? "4a000000-0000-4000-8000-0000000000ee" : null
        }
        reviewerName={replacing ? "Anil Thapa" : null}
        initialPhotos={page([A, B, C])}
        loadPhotos={vi.fn(async () => page([A, B, C]))}
        submit={submit}
        uploader={noUpload}
        limits={LIMITS}
        onReload={vi.fn()}
        signInHref="/login"
      />
    )
    const user = userEvent.setup()
    const { rerender } = render(panel(true))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send another photo" }))
    // The router refresh lands first: the answered request is closed.
    rerender(panel(false))
    resolve(sent(1))
    const status = await screen.findByRole("status")
    expect(status.textContent).toContain("Your new photo is waiting for review")
    expect(status.textContent).toContain("Anil Thapa reviews it next.")
  })

  it("reports photos already live on the task as already sent", async () => {
    const { user, submit } = setup()
    submit.mockResolvedValueOnce(sent(1, {}, true))
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    expect((await screen.findByRole("status")).textContent).toContain(
      "These photos were already sent. Nothing was sent twice."
    )
  })

  it("reports skipped photos on partial success", async () => {
    const { user, submit } = setup()
    submit.mockResolvedValueOnce(
      sent(1, {
        skipped: [{ assetId: B.assetId, reason: "already_submitted" }],
      })
    )
    await user.click(tile("2 Nov 2026"))
    await user.click(tile("1 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 2 photos" }))
    expect((await screen.findByRole("status")).textContent).toContain(
      "1 photo wasn't sent."
    )
  })

  it("shows processing photos as not countable and not selectable", async () => {
    const processing = photo({
      eligible: false,
      reason: "not_ready",
      uploadedAt: "2026-11-02T12:00:00.000Z",
    })
    const { user } = setup({ photos: [processing, A] })
    const t = within(
      screen.getByRole("list", { name: "Your photos" })
    ).getByRole("button", { name: "Photo uploaded 2 Nov 2026, 12:00" })
    expect(t.getAttribute("aria-disabled")).toBe("true")
    expect(
      screen.getByText("Still processing. It can't count until it's ready.")
    ).toBeTruthy()
    await user.click(t)
    expect(t.getAttribute("aria-pressed")).toBe("false")
    expect(
      screen.getByText(
        /photos still processing or that failed to upload don't count/
      )
    ).toBeTruthy()
  })

  it("says when a photo is already a monthly photo rather than another task's", () => {
    setup({
      photos: [
        photo({
          eligible: false,
          reason: "counted_elsewhere",
          live: {
            submissionId: "4a000000-0000-4000-8000-000000000077",
            state: "accepted",
            requirementId: null,
          },
        }),
        photo({
          eligible: false,
          reason: "counted_elsewhere",
          live: {
            submissionId: "4a000000-0000-4000-8000-000000000078",
            state: "submitted",
            requirementId: "6c000000-0000-4000-8000-000000000001",
          },
        }),
      ],
    })
    expect(screen.getByText("Already sent as a monthly photo.")).toBeTruthy()
    expect(
      screen.getByText("Already counting toward another task.")
    ).toBeTruthy()
  })

  it("calls a photo already sent this month a monthly photo on the month page", () => {
    setup({
      requirementId: null,
      photos: [photo({ eligible: false, reason: "already_submitted" })],
    })
    expect(screen.getByText("Already sent as a monthly photo.")).toBeTruthy()
    expect(screen.queryByText("Already sent for this task.")).toBeNull()
  })

  it("warns that sending a photo pending on another task moves it", () => {
    setup({
      photos: [
        photo({
          live: {
            submissionId: "4a000000-0000-4000-8000-000000000079",
            state: "submitted",
            requirementId: "6c000000-0000-4000-8000-000000000002",
          },
        }),
      ],
    })
    expect(
      screen.getByText(
        "Waiting for review on another task. Sending it here moves it."
      )
    ).toBeTruthy()
    expect(tile("2 Nov 2026").getAttribute("aria-disabled")).toBeNull()
  })

  it("marks older photos as task-only for a task but not for monthly photos", () => {
    const older = photo({ countsTowardMonthly: false })
    setup({ photos: [older] })
    expect(screen.getByText("Task only (from an earlier month)")).toBeTruthy()
    cleanup()
    setup({
      photos: [
        photo({
          eligible: false,
          reason: "outside_period",
          countsTowardMonthly: false,
        }),
      ],
      requirementId: null,
    })
    expect(
      screen.getByText(
        "Uploaded before this month, so it can't count toward this month."
      )
    ).toBeTruthy()
  })

  it("caps one send at the upload batch limit", async () => {
    const { user } = setup({ limits: { ...LIMITS, maxBatchFiles: 2 } })
    await user.click(tile("2 Nov 2026"))
    await user.click(tile("1 Nov 2026"))
    expect(screen.getByText("You can send up to 2 at a time.")).toBeTruthy()
    await user.click(tile("30 Oct 2026"))
    expect(tile("30 Oct 2026").getAttribute("aria-pressed")).toBe("false")
  })

  it("asks to sign in again when the session ended", async () => {
    const { user, submit } = setup()
    submit.mockResolvedValueOnce({
      ok: false,
      code: "unauthenticated",
      status: 401,
      message: "x",
    })
    await user.click(tile("2 Nov 2026"))
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    const alert = await screen.findByRole("alert")
    expect(
      within(alert).getByRole("link", { name: "Sign in" }).getAttribute("href")
    ).toBe("/login")
  })

  it("recovers from a failed first load with Try again", async () => {
    const loadPhotos = vi.fn(async () => page([A]))
    const { user } = setup({
      initial: { ok: false, code: "unavailable", status: 503, message: "x" },
      loadPhotos,
    })
    expect(screen.getByRole("alert").textContent).toMatch(
      /couldn't send that just now|Try again/
    )
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(loadPhotos).toHaveBeenCalledWith({
      requirementId: REQUIREMENT,
      cursor: null,
    })
    expect(
      await screen.findByRole("list", { name: "Your photos" })
    ).toBeTruthy()
  })

  it("selects newly uploaded photos once they are ready", async () => {
    const fresh = photo({
      assetId: "7d000000-0000-4000-8000-0000000000ff",
      uploadedAt: "2026-11-02T15:00:00.000Z",
    })
    const uploader: Uploader = async (_file, ctx) => {
      ctx.onProcessing()
      await Promise.resolve()
      return { assetId: fresh.assetId }
    }
    const loadPhotos = vi.fn(async () => page([fresh, A]))
    const { user } = setup({ photos: [A], uploader, loadPhotos })

    // Outside the staff layout the panel picks through its own hidden
    // library input (opened by "Choose from your photos").
    const library = document.querySelector<HTMLInputElement>(
      'input[data-photo-source="library"]'
    )!
    expect(library.multiple).toBe(true)
    expect(library.hasAttribute("capture")).toBe(false)
    expect(library.accept).not.toMatch(/video/)
    await user.upload(library, [
      new File([new Uint8Array(64)], "pass.jpg", { type: "image/jpeg" }),
    ])
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("heading", { name: "Upload photos" })
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    expect(await within(dialog).findByText("1 uploaded")).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Done" }))

    expect(await screen.findByText("1 new photo selected.")).toBeTruthy()
    const uploaded = within(
      screen.getByRole("list", { name: "Your photos" })
    ).getByRole("button", { name: "Photo uploaded 2 Nov 2026, 15:00" })
    expect(uploaded.getAttribute("aria-pressed")).toBe("true")
    expect(tile("2 Nov 2026").getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: "Send 1 photo" })).toBeTruthy()
  })
})
