// @vitest-environment jsdom
// B02-06 on the capture form (design \u00A78): focus never drops to the page, slow
// is said, a send that left uploads out locks the form, uploads that finished
// after the person left are named, and 44 px targets at every width.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import AmenityCaptureNotFound from "@/app/staff/tasks/amenities/[checkId]/not-found"

import {
  CaptureForm,
  emptyDraft,
  saveDraft,
  type AssetsResult,
  type KnowledgeCapture,
  type SubmitHandler,
} from "@/components/nabalens/amenities/capture"
import type { OpenAddOptions } from "@/components/nabalens/shell/add-context"
import {
  UI_TEXT,
  WIFI_KEY,
  type AmenityResult,
  type CheckSummary,
  type SubmitInput,
  type SubmitResult,
  type SubmittableAsset,
} from "@/lib/amenities/contract"
import type {
  KnowledgeResult,
  SubmitKnowledgeInput,
  SubmittedFinding,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

const CHECK_ID = "8a000000-0000-4000-8000-000000000301"
const VIEWER_ID = "1a2b3c4d-0000-4aaa-8bbb-00000000030a"
const OWNER = { userId: VIEWER_ID, checkId: CHECK_ID }

const PHOTO: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000030a",
  kind: "photo",
  createdAt: "2026-11-02T10:00:00.000Z",
  source: "own",
  thumbUrl: null,
}
const VIDEO: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000030b",
  kind: "video",
  createdAt: "2026-11-03T10:00:00.000Z",
  source: "own",
  thumbUrl: null,
}

function check(over: Partial<CheckSummary> = {}): CheckSummary {
  return {
    id: CHECK_ID,
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
    assignee: null,
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 4,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...over,
  }
}

const SLOT: WorkingSlot = {
  checkId: CHECK_ID,
  key: "darts",
  question: "Is there a dartboard guests can use?",
  category: "Entertainment",
  evidenceRule: "photo",
  progress: "needs_capture",
  slotRevision: 7,
  answerInUse: {
    status: "unavailable",
    reason: "unknown",
    detail: "not_checked",
    value: null,
    savedAt: null,
    sentAt: null,
    confirmation: { state: "not_required", self: false, at: null, by: null },
  },
  previousAnswer: null,
  latestAttempt: null,
  assignee: null,
  mode: "answer",
  requiresConfirmation: false,
  myLatest: null,
  myDraft: null,
  othersPending: 0,
  closedAssignment: null,
}

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 1,
  maxVideoBytes: 1,
}

const sentOk: AmenityResult<SubmitResult> = {
  ok: true,
  submissionId: "5b000000-0000-4000-8000-000000000301",
  revision: 5,
  replayed: false,
}
const knowledgeSent: KnowledgeResult<SubmittedFinding> = {
  ok: true,
  findingRef: { type: "contribution", id: "f1" },
  slotRevision: 8,
  replayed: false,
  outcome: "current",
  replacedOwn: null,
  recognition: { kind: "none" },
}

function keys() {
  let n = 0
  return () => `key-${++n}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

type Submit = (
  input: SubmitKnowledgeInput
) => Promise<KnowledgeResult<SubmittedFinding>>
type SaveDraft = NonNullable<KnowledgeCapture["saveDraft"]>

/** The legacy form, optionally with the Add queue. */
function legacy({
  summary = check(),
  assets = [PHOTO, VIDEO],
  submit = vi.fn<SubmitHandler>(async () => sentOk),
  addQueue = false,
}: {
  summary?: CheckSummary
  assets?: SubmittableAsset[]
  submit?: ReturnType<typeof vi.fn<SubmitHandler>>
  addQueue?: boolean
} = {}) {
  const onDone = vi.fn()
  const openAdd = vi.fn()
  const loadAssets = vi.fn(async (): Promise<AssetsResult> => ({
    ok: true,
    assets,
  }))
  const utils = render(
    <CaptureForm
      check={summary}
      viewerId={VIEWER_ID}
      initialAssets={{ ok: true, assets }}
      loadAssets={loadAssets}
      submit={submit}
      upload={{
        addQueue: addQueue ? { openAdd } : null,
        uploader: async () => {},
        limits: LIMITS,
      }}
      onReload={vi.fn()}
      onDone={onDone}
      signInHref="/login"
      newKey={keys()}
    />
  )
  return {
    ...utils,
    user: userEvent.setup(),
    submit,
    onDone,
    openAdd,
    loadAssets,
    added: () => openAdd.mock.lastCall?.[0] as OpenAddOptions,
  }
}

/** The knowledge form, with the Add queue. */
function knowledge({
  submit = vi.fn<Submit>(async () => knowledgeSent),
  saveDraft: save = vi.fn<SaveDraft>(async () => ({
    ok: true,
    draftRevision: 1,
    savedAt: "2026-11-06T09:00:00.000Z",
  })),
}: {
  submit?: ReturnType<typeof vi.fn<Submit>>
  saveDraft?: ReturnType<typeof vi.fn<SaveDraft>>
} = {}) {
  const openAdd = vi.fn()
  render(
    <CaptureForm
      check={check()}
      viewerId={VIEWER_ID}
      initialAssets={{ ok: true, assets: [PHOTO] }}
      loadAssets={async () => ({ ok: true, assets: [PHOTO] })}
      submit={vi.fn()}
      upload={{
        addQueue: { openAdd },
        uploader: async () => {},
        limits: LIMITS,
      }}
      onReload={vi.fn()}
      onDone={vi.fn()}
      signInHref="/login"
      newKey={keys()}
      knowledge={{
        venueName: "The Old Crown",
        slot: SLOT,
        role: "staff",
        canSelfConfirm: false,
        respondsTo: null,
        submit,
        saveDraft: save,
        onDiscardDraft: null,
        serverDraft: null,
      }}
    />
  )
  return {
    user: userEvent.setup(),
    submit,
    saveDraft: save,
    added: () => openAdd.mock.lastCall?.[0] as OpenAddOptions,
  }
}

const radio = (name: string) => screen.getByRole("radio", { name })
const photoBox = () =>
  screen.getByRole("checkbox", { name: "Photo added 2 Nov 2026, 10:00" })
const videoBox = () =>
  screen.getByRole("checkbox", { name: "Video added 3 Nov 2026, 10:00" })
const lastLegacy = (submit: ReturnType<typeof vi.fn<SubmitHandler>>) =>
  submit.mock.lastCall?.[0] as SubmitInput

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("capture: two sends queued behind one save (L-a)", () => {
  it("sends once, never twice, when Try again is tapped twice during a save", async () => {
    const save = deferred<{
      ok: true
      draftRevision: number
      savedAt: string
    }>()
    const submit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(knowledgeSent)
    const { user } = knowledge({
      submit,
      saveDraft: vi.fn<SaveDraft>(() => save.promise),
    })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    expect(submit).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    const retry = screen.getByRole("button", { name: UI_TEXT.retry })
    await user.click(retry)
    await user.click(retry)
    await act(async () =>
      save.resolve({
        ok: true,
        draftRevision: 1,
        savedAt: "2026-11-06T09:00:00.000Z",
      })
    )
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1][0].idempotencyKey).toBe(
      submit.mock.calls[0][0].idempotencyKey
    )
  })
})

describe("capture: a restored draft whose send had no answer (CA-05)", () => {
  const attempted = () => ({
    ...emptyDraft(() => "sent-key", 4),
    attempted: true,
    answer: "no" as const,
    reason: "Board removed",
  })

  it("says the last send may not have arrived, and goes once it is sent", async () => {
    saveDraft(OWNER, attempted())
    const { user, submit } = legacy()
    expect(
      await screen.findByText(
        "Your last send may not have arrived. Send again; nothing is sent twice."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    expect(lastLegacy(submit).idempotencyKey).toBe("sent-key")
    expect(screen.queryByText(/Your last send may not have arrived/)).toBeNull()
  })

  it("on a working-list question, never says the restored copy wasn't sent", async () => {
    saveDraft(OWNER, { ...attempted(), revision: 7, sentSlotRevision: 7 })
    knowledge()
    expect(await screen.findByText("Restored from this phone.")).toBeTruthy()
    expect(
      screen.getByText(
        "Your last send may not have arrived. Send again; nothing is sent twice."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/It hasn't been sent/)).toBeNull()
  })

  it("an offline send says to keep the page open", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    window.dispatchEvent(new Event("offline"))
    const submit = vi
      .fn<SubmitHandler>()
      .mockRejectedValue(new TypeError("Failed to fetch"))
    const { user } = legacy({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Keep this page open"
    )
    online.mockRestore()
  })
})

describe("capture: a send that left late uploads out locks the form (CA-09)", () => {
  async function sentWithLate() {
    let answer!: (result: AmenityResult<SubmitResult>) => void
    const submit = vi.fn<SubmitHandler>(
      () => new Promise((resolve) => (answer = resolve))
    )
    const view = legacy({ assets: [PHOTO], submit, addQueue: true })
    await view.user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = view.added()
    await view.user.click(radio("Yes"))
    await view.user.click(photoBox())
    await view.user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    view.loadAssets.mockResolvedValue({ ok: true, assets: [VIDEO, PHOTO] })
    opts.onReady?.([VIDEO.assetId])
    await act(async () => answer(sentOk))
    return view
  }

  it("offers Done (focused) and a deliberate second send, with the answers locked", async () => {
    const { onDone } = await sentWithLate()
    const done = await screen.findByRole("button", { name: "Done" })
    await waitFor(() => expect(document.activeElement).toBe(done))
    expect(radio("No").matches(":disabled")).toBe(true)
    expect(screen.queryByRole("button", { name: UI_TEXT.submit })).toBeNull()
    expect(
      screen.getByText(/1 new upload finished while your answer was sending/)
    ).toBeTruthy()
    await userEvent.setup().click(done)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("Send again with the new photo resends the answer, with it, under a new key", async () => {
    const { user, submit } = await sentWithLate()
    await user.click(
      await screen.findByRole("button", {
        name: "Send again with the new photo",
      })
    )
    await waitFor(() =>
      expect((videoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect((radio("Yes") as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    expect(submit).toHaveBeenCalledTimes(2)
    const [first, second] = submit.mock.calls.map((c) => c[0])
    expect(second.answer).toBe("yes")
    expect(second.assetIds).toEqual([PHOTO.assetId, VIDEO.assetId])
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
  })
})

describe("capture: uploads that finished after the person left (CA-10)", () => {
  it("names a newer unticked upload, and leaves the choice to the person", async () => {
    saveDraft(OWNER, {
      ...emptyDraft(() => "k", 4),
      answer: "yes",
      assetIds: [PHOTO.assetId],
      uploadsPending: { count: 1, after: PHOTO.createdAt },
    })
    legacy()
    expect(
      await screen.findByText(
        "1 upload finished after you left; tick it to add it."
      )
    ).toBeTruthy()
    expect((videoBox() as HTMLInputElement).checked).toBe(false)
  })

  it("remembers uploads still saving in this device's draft", async () => {
    const { user, added } = legacy({ addQueue: true })
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    act(() => added().onPicked?.([new File(["x"], "a.jpg")]))
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem(
            `nabalens.amenity-draft.v2:${VIEWER_ID}:${CHECK_ID}`
          ) ?? "{}"
        ).uploadsPending
      ).toEqual({ count: 1, after: VIDEO.createdAt })
    )
  })
})

describe("capture: focus and announcements", () => {
  it("a failed check focuses the first invalid control, with no alert per field (CA-13)", async () => {
    const { user } = legacy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    await waitFor(() => expect(document.activeElement).toBe(radio("Yes")))
    expect(screen.queryByRole("alert")).toBeNull()
    const group = radio("Yes").closest("fieldset")!
    const described = group.getAttribute("aria-describedby") ?? ""
    expect(document.getElementById(described)?.textContent).toBeTruthy()
  })

  it("Submit keeps focus while sending and says Sending\u2026 (CA-14, CA-24)", async () => {
    const submit = vi.fn<SubmitHandler>(() => new Promise(() => {}))
    const { user } = legacy({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    const sending = screen.getByRole("button", { name: "Sending\u2026" })
    expect(sending.getAttribute("aria-disabled")).toBe("true")
    expect(document.activeElement).toBe(sending)
    await user.click(sending)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it("after 15 s without a reply says to keep the page open (CA-24)", async () => {
    const submit = vi.fn<SubmitHandler>(() => new Promise(() => {}))
    legacy({ submit })
    fireEvent.click(radio("Yes"))
    fireEvent.click(photoBox())
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    await act(async () => {})
    expect(screen.queryByText("Still sending; keep this page open.")).toBeNull()
    act(() => vi.advanceTimersByTime(15_000))
    expect(
      screen
        .getByText("Still sending; keep this page open.")
        .closest("[role=status]")
    ).toBeTruthy()
  })

  it("Wait for it hands focus to Stop waiting and edit (CA-17)", async () => {
    const { user, added } = knowledge()
    await user.click(radio("Yes"))
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    act(() =>
      added().onPicked?.([new File(["x"], "a.jpg", { type: "image/jpeg" })])
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    await user.click(screen.getByRole("button", { name: "Wait for it" }))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Stop waiting and edit" })
      )
    )
    expect(
      screen.getByText(
        "Waiting for your photo to finish saving. It sends by itself when ready; keep this page open."
      )
    ).toBeTruthy()
  })

  it("names videos as videos while they save (CA-26)", async () => {
    const { user, added } = knowledge()
    await user.click(radio("No"))
    await user.type(screen.getByRole("textbox", { name: /^Reason/ }), "Gone")
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    act(() =>
      added().onPicked?.([
        new File(["x"], "a.mp4", { type: "video/mp4" }),
        new File(["x"], "b.mp4", { type: "video/mp4" }),
      ])
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    expect(
      screen.getByText(
        "Your 2 videos are still saving. Wait for them, or send without them."
      )
    ).toBeTruthy()
  })

  it("announces the evidence rule only when met changes (CA-18)", async () => {
    const { user, container } = legacy()
    const live = () =>
      container.querySelector(".sr-only[aria-live=polite]")?.textContent
    expect(
      screen.getByTestId("evidence-rule-status").getAttribute("aria-live")
    ).toBeNull()
    await user.click(radio("Yes"))
    expect(live()).toBe("")
    await user.click(photoBox())
    expect(live()).toBe("Evidence rule met: Photo.")
    await user.click(videoBox())
    expect(live()).toBe("Evidence rule met: Photo.")
    await user.click(photoBox())
    await user.click(videoBox())
    expect(live()).toBe("Evidence rule not met: Photo.")
  })
})

describe("capture: a question that isn't found (CA-30)", () => {
  it("says it can't be found for the venue, never that it isn't yours", () => {
    render(<AmenityCaptureNotFound />)
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "We can't find this question for your venue.",
      })
    ).toBeTruthy()
    expect(screen.queryByText(/isn't yours|assigned to you/)).toBeNull()
  })
})

describe("capture: layout", () => {
  it("keeps notices in the page flow; only the buttons are sticky (CA-22)", async () => {
    const submit = vi
      .fn<SubmitHandler>()
      .mockRejectedValue(new TypeError("Failed to fetch"))
    const { user } = legacy({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    const alert = await screen.findByRole("alert")
    expect(alert.closest(".sticky")).toBeNull()
    expect(
      screen.getByRole("button", { name: UI_TEXT.submit }).closest(".sticky")
    ).toBeTruthy()
  })

  it("never shrinks a target below 44 px from md up (X-03)", async () => {
    const { user, container } = legacy({
      summary: check({
        entry: { ...check().entry, key: WIFI_KEY },
      }),
    })
    await user.click(radio("Yes"))
    expect(
      screen.getByRole("textbox", { name: "Where you tested" })
    ).toBeTruthy()
    expect(container.innerHTML).not.toMatch(/md:min-h-(0|8|9)\b/)
  })
})
