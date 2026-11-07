// @vitest-environment jsdom
// Task and amenity screens take each upload as soon as THAT file is ready
// (Add's onReady fires once per file): selections accumulate, never replace
// or wait for the batch, "Send photos" stays a separate step, and a late
// callback after the screen is gone returns false: Add keeps the file saved
// in the person's photos, not attached to the screen.
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

import {
  CaptureForm,
  type AssetsResult,
  type SubmitHandler,
} from "@/components/nabalens/amenities/capture"
import type { OpenAddOptions } from "@/components/nabalens/shell/add-context"
import {
  SubmitPhotosPanel,
  type SubmittablePhoto,
  type SubmittablePhotosResult,
} from "@/components/nabalens/tasks"
import type { Uploader } from "@/components/nabalens/upload-queue"
import type { CheckSummary, SubmittableAsset } from "@/lib/amenities/contract"

import { photo } from "./tasks-fixtures"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}
const REQUIREMENT = "6c000000-0000-4000-8000-0000000000aa"
const noUpload: Uploader = async () => {}

/** A promise resolved from outside: holds a read in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})
afterEach(cleanup)

describe("SubmitPhotosPanel: photos arrive one at a time", () => {
  const OLD = photo({
    assetId: "7d000000-0000-4000-8000-0000000000a0",
    uploadedAt: "2026-11-01T10:00:00.000Z",
  })
  const P1 = photo({
    assetId: "7d000000-0000-4000-8000-0000000000a1",
    uploadedAt: "2026-11-02T11:00:00.000Z",
  })
  const P2 = photo({
    assetId: "7d000000-0000-4000-8000-0000000000a2",
    uploadedAt: "2026-11-02T12:00:00.000Z",
  })
  const P3 = photo({
    assetId: "7d000000-0000-4000-8000-0000000000a3",
    uploadedAt: "2026-11-02T13:00:00.000Z",
  })

  const page = (items: SubmittablePhoto[]): SubmittablePhotosResult => ({
    ok: true,
    items,
    nextCursor: null,
  })

  function setup(
    loadPhotos: (input: unknown) => Promise<SubmittablePhotosResult>
  ) {
    const openAdd = vi.fn<(opts?: OpenAddOptions) => void>()
    const submit = vi.fn()
    const utils = render(
      <SubmitPhotosPanel
        requirementId={REQUIREMENT}
        initialPhotos={page([OLD])}
        loadPhotos={loadPhotos}
        submit={submit}
        addQueue={{ openAdd }}
        uploader={noUpload}
        limits={LIMITS}
        onReload={vi.fn()}
        signInHref="/login"
      />
    )
    return { user: userEvent.setup(), openAdd, submit, ...utils }
  }

  const tile = (time: string, date = "2 Nov 2026") =>
    within(screen.getByRole("list", { name: "Your photos" })).getByRole(
      "button",
      { name: `Photo uploaded ${date}, ${time}` }
    )

  it("adds each photo to the selection as it is ready, keeping earlier picks", async () => {
    let listed = [OLD]
    const loadPhotos = vi.fn(async () => page(listed))
    const { user, openAdd, submit } = setup(loadPhotos)

    // The person already chose an older photo by hand.
    await user.click(tile("10:00", "1 Nov 2026"))
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    expect(opts.source).toBe("library")
    expect(opts.imagesOnly).toBe(true)
    act(() => opts.onPicked?.())

    // The first photo is ready while the others still upload.
    listed = [P1, OLD]
    expect(opts.onReady!([P1.assetId])).not.toBe(false)
    await waitFor(() =>
      expect(tile("11:00").getAttribute("aria-pressed")).toBe("true")
    )
    expect(screen.getByText("1 new photo selected.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send 2 photos" })).toBeTruthy()

    // Then the second and third, one call each: added, never replacing.
    listed = [P2, P1, OLD]
    opts.onReady!([P2.assetId])
    await waitFor(() =>
      expect(tile("12:00").getAttribute("aria-pressed")).toBe("true")
    )
    listed = [P3, P2, P1, OLD]
    opts.onReady!([P3.assetId])
    await waitFor(() =>
      expect(tile("13:00").getAttribute("aria-pressed")).toBe("true")
    )
    expect(tile("11:00").getAttribute("aria-pressed")).toBe("true")
    expect(tile("10:00", "1 Nov 2026").getAttribute("aria-pressed")).toBe(
      "true"
    )
    // The note counts the whole pick, not just the latest photo.
    expect(screen.getByText("3 new photos selected.")).toBeTruthy()
    // Sending stays the person's own step.
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Send 4 photos" })).toBeTruthy()
  })

  it("selects a photo that arrives while an earlier read is still loading", async () => {
    const slow = deferred<SubmittablePhotosResult>()
    const loadPhotos = vi
      .fn<(input: unknown) => Promise<SubmittablePhotosResult>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(page([P2, P1, OLD]))
    const { user, openAdd } = setup(loadPhotos)
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    opts.onReady!([P1.assetId])
    // P2 is ready before the read for P1 answers: queued, not lost.
    opts.onReady!([P2.assetId])
    await act(async () => slow.resolve(page([P1, OLD])))
    await waitFor(() =>
      expect(tile("12:00").getAttribute("aria-pressed")).toBe("true")
    )
    expect(tile("11:00").getAttribute("aria-pressed")).toBe("true")
    expect(loadPhotos).toHaveBeenCalledTimes(2)
    expect(screen.getByText("2 new photos selected.")).toBeTruthy()
  })

  it("starts a fresh count for the next pick", async () => {
    let listed = [P1, OLD]
    const { user, openAdd } = setup(vi.fn(async () => page(listed)))
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const first = openAdd.mock.lastCall![0]!
    act(() => first.onPicked?.())
    first.onReady!([P1.assetId])
    expect(await screen.findByText("1 new photo selected.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Take a photo" }))
    const second = openAdd.mock.lastCall![0]!
    expect(second.source).toBe("camera")
    act(() => second.onPicked?.())
    listed = [P2, P1, OLD]
    second.onReady!([P2.assetId])
    await waitFor(() =>
      expect(tile("12:00").getAttribute("aria-pressed")).toBe("true")
    )
    expect(screen.getByText("1 new photo selected.")).toBeTruthy()
  })

  it("keeps a photo that became ready during a send selected after it succeeds", async () => {
    let listed = [P1, OLD]
    const loadPhotos = vi.fn(async () => page(listed))
    const { user, openAdd, submit } = setup(loadPhotos)
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    act(() => opts.onPicked?.())
    opts.onReady!([P1.assetId])
    await waitFor(() =>
      expect(tile("11:00").getAttribute("aria-pressed")).toBe("true")
    )

    const sending = deferred<unknown>()
    submit.mockReturnValueOnce(sending.promise)
    await user.click(screen.getByRole("button", { name: "Send 1 photo" }))
    expect(submit.mock.lastCall![0].assetIds).toEqual([P1.assetId])

    // P2 finishes saving while P1 is being sent: it is selected.
    listed = [P2, P1, OLD]
    opts.onReady!([P2.assetId])
    await waitFor(() =>
      expect(tile("12:00").getAttribute("aria-pressed")).toBe("true")
    )

    await act(async () =>
      sending.resolve({
        ok: true,
        submitted: [
          {
            submissionId: "4a000000-0000-4000-8000-000000000001",
            assetId: P1.assetId,
            state: "submitted",
            revision: 1,
            reused: false,
          },
        ],
        skipped: [],
        replayed: false,
      })
    )
    // Only the sent photo leaves the selection; P2 waits for the next send.
    await waitFor(() =>
      expect(tile("11:00").getAttribute("aria-pressed")).toBe("false")
    )
    expect(tile("12:00").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("1 new photo selected.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send 1 photo" })).toBeTruthy()
  })

  it("returns false for a photo ready after the screen is gone", async () => {
    const loadPhotos = vi.fn(async () => page([P1, OLD]))
    const { user, openAdd, unmount } = setup(loadPhotos)
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    unmount()
    // Add then keeps the photo saved, just not attached to this task.
    expect(opts.onReady!([P1.assetId])).toBe(false)
    expect(loadPhotos).not.toHaveBeenCalled()
  })
})

describe("CaptureForm (amenity check): uploads arrive one at a time", () => {
  const CHECK: CheckSummary = {
    id: "8a000000-0000-4000-8000-000000000001",
    venueId: "v1",
    entry: {
      key: "darts",
      category: "Entertainment",
      question: "Is there a dartboard guests can use?",
      captureBrief: "Photograph the dartboard and the throwing line.",
      evidenceRule: "photo",
      isCore: false,
      position: 30,
      version: 1,
    },
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    assignee: { id: "me", displayName: "TEST Sam" },
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 4,
    updatedAt: "2026-11-05T10:00:00.000Z",
  }
  const asset = (n: number, day: number): SubmittableAsset => ({
    assetId: `7d000000-0000-4000-8000-0000000000b${n}`,
    kind: "photo",
    createdAt: `2026-11-0${day}T10:00:00.000Z`,
    source: "own",
    thumbUrl: null,
  })
  const OLD = asset(0, 1)
  const A1 = asset(1, 2)
  const A2 = asset(2, 3)
  const ok = (assets: SubmittableAsset[]): AssetsResult => ({
    ok: true,
    assets,
  })
  const box = (day: number) =>
    screen.getByRole("checkbox", {
      name: `Photo added ${day} Nov 2026, 10:00`,
    }) as HTMLInputElement

  function setup(
    loadAssets: (input: { checkId: string }) => Promise<AssetsResult>
  ) {
    const openAdd = vi.fn<(opts?: OpenAddOptions) => void>()
    const submit = vi.fn<SubmitHandler>()
    const utils = render(
      <CaptureForm
        check={CHECK}
        viewerId="1a2b3c4d-0000-4aaa-8bbb-00000000000a"
        initialAssets={ok([OLD])}
        loadAssets={loadAssets}
        submit={submit}
        upload={{ addQueue: { openAdd }, uploader: noUpload, limits: LIMITS }}
        onReload={vi.fn()}
        onDone={vi.fn()}
        signInHref="/login"
      />
    )
    return { user: userEvent.setup(), openAdd, submit, ...utils }
  }

  it("adds each upload as it is ready and keeps the earlier choice", async () => {
    let listed = [OLD]
    const { user, openAdd, submit } = setup(vi.fn(async () => ok(listed)))
    await user.click(box(1))
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    expect(opts.purpose).toBe("amenity")
    act(() => opts.onPicked?.())

    listed = [A1, OLD]
    opts.onReady!([A1.assetId])
    await waitFor(() => expect(box(2).checked).toBe(true))
    listed = [A2, A1, OLD]
    opts.onReady!([A2.assetId])
    await waitFor(() => expect(box(3).checked).toBe(true))
    expect(box(2).checked).toBe(true)
    expect(box(1).checked).toBe(true)
    expect(screen.getByText("2 new uploads selected.")).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it("never lets an older read drop an upload a newer one selected", async () => {
    const slow = deferred<AssetsResult>()
    const loadAssets = vi
      .fn<(input: { checkId: string }) => Promise<AssetsResult>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(ok([A2, A1, OLD]))
    const { user, openAdd } = setup(loadAssets)
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    opts.onReady!([A1.assetId])
    opts.onReady!([A2.assetId])
    // The first read answers late with a list made before A2 was ready.
    await act(async () => slow.resolve(ok([A1, OLD])))
    await waitFor(() => expect(box(3).checked).toBe(true))
    expect(box(2).checked).toBe(true)
    expect(loadAssets).toHaveBeenCalledTimes(2)
  })

  it("returns false for an upload ready after the form is gone", async () => {
    const loadAssets = vi.fn(async () => ok([A1, OLD]))
    const { user, openAdd, unmount } = setup(loadAssets)
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall![0]!
    unmount()
    expect(opts.onReady!([A1.assetId])).toBe(false)
    expect(loadAssets).not.toHaveBeenCalled()
  })
})
