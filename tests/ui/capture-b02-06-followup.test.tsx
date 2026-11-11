// @vitest-environment jsdom
// B02-06 follow-up: the draft-save guard (L-b, R11), the Wi-Fi redaction tick
// while a photo is saving, the legacy list's heading (HM-11) and the reason
// field's error (CA-13).
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AmenityTaskList,
  CaptureForm,
  loadDraft,
  type AssetsResult,
  type KnowledgeCapture,
  type SubmitHandler,
} from "@/components/nabalens/amenities/capture"
import { ReasonDialog } from "@/components/nabalens/coverage"
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
  KnowledgeFailure,
  KnowledgeResult,
  SaveDraftInput,
  SubmitKnowledgeInput,
  SubmittedFinding,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

const CHECK_ID = "8a000000-0000-4000-8000-000000000401"
const VIEWER_ID = "1a2b3c4d-0000-4aaa-8bbb-00000000040a"
const OWNER = { userId: VIEWER_ID, checkId: CHECK_ID }

const PHOTO: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000040a",
  kind: "photo",
  createdAt: "2026-11-02T10:00:00.000Z",
  source: "own",
  thumbUrl: null,
}
const LATER: SubmittableAsset = {
  ...PHOTO,
  assetId: "7d000000-0000-4000-8000-00000000040b",
  createdAt: "2026-11-03T10:00:00.000Z",
}

function check(over: Partial<CheckSummary> = {}): CheckSummary {
  return {
    id: CHECK_ID,
    venueId: "v1",
    entry: {
      key: "darts",
      category: "Entertainment",
      question: "Is there a dartboard guests can use?",
      captureBrief: "Photograph the dartboard.",
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

function slot(over: Partial<WorkingSlot> = {}): WorkingSlot {
  return {
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
    ...over,
  }
}

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 1,
  maxVideoBytes: 1,
}

const MY_SENT = "2026-11-05T10:00:00.000Z"

function keys() {
  let n = 0
  return () => `key-${++n}`
}

type Submit = (
  input: SubmitKnowledgeInput
) => Promise<KnowledgeResult<SubmittedFinding>>
type SaveDraft = NonNullable<KnowledgeCapture["saveDraft"]>

const saved = { ok: true as const, draftRevision: 1, savedAt: MY_SENT }

const alreadySent = (
  sentReason: "key_sent" | "newer_send",
  sentAt: string
): KnowledgeFailure =>
  ({
    ok: false,
    code: "draft_already_sent",
    status: 409,
    message: "This finding was already sent.",
    sentReason,
    sentAt,
  }) as KnowledgeFailure

function knowledge({
  knowledgeSlot = slot({ mySentAt: MY_SENT }),
  saveDraft = vi.fn<SaveDraft>(async () => saved),
  submit = vi.fn<Submit>(async () => ({
    ok: true,
    findingRef: { type: "contribution", id: "f1" },
    slotRevision: 8,
    replayed: false,
    outcome: "current",
    replacedOwn: null,
    recognition: { kind: "none" },
    sentAt: "2026-11-08T09:00:00.000Z",
  })),
}: {
  knowledgeSlot?: WorkingSlot
  saveDraft?: ReturnType<typeof vi.fn<SaveDraft>>
  submit?: ReturnType<typeof vi.fn<Submit>>
} = {}) {
  const { container } = render(
    <CaptureForm
      check={check()}
      viewerId={VIEWER_ID}
      initialAssets={{ ok: true, assets: [PHOTO] }}
      loadAssets={async () => ({ ok: true, assets: [PHOTO] })}
      submit={vi.fn()}
      upload={null}
      onReload={vi.fn()}
      onDone={vi.fn()}
      signInHref="/login"
      newKey={keys()}
      knowledge={{
        venueName: "The Old Crown",
        slot: knowledgeSlot,
        role: "staff",
        canSelfConfirm: false,
        respondsTo: null,
        submit,
        saveDraft,
        onDiscardDraft: null,
        serverDraft: null,
      }}
    />
  )
  return { user: userEvent.setup(), saveDraft, submit, container }
}

const radio = (name: string) => screen.getByRole("radio", { name })
const reasonBox = () => screen.getByRole("textbox", { name: /^Reason/ })
const saveButton = () => screen.getByRole("button", { name: "Save for later" })
const saveInput = (
  saveDraft: ReturnType<typeof vi.fn<SaveDraft>>,
  call: number
) => saveDraft.mock.calls[call][0] as SaveDraftInput
const stored = () => loadDraft(OWNER)

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("draft-save guard (L-b)", () => {
  it("sends the loaded send time as the base of every save", async () => {
    const { user, saveDraft } = knowledge()
    await user.click(radio("No"))
    await user.click(saveButton())
    expect(saveInput(saveDraft, 0).baseSentAt).toBe(MY_SENT)
  })

  it("from an older server (no send time read), saves without a base, as before", async () => {
    const { user, saveDraft } = knowledge({ knowledgeSlot: slot() })
    await user.click(radio("No"))
    await user.click(saveButton())
    expect("baseSentAt" in saveInput(saveDraft, 0)).toBe(false)
  })

  it("after a send from this form, its send time becomes the base", async () => {
    const { user, saveDraft } = knowledge()
    await user.click(radio("No"))
    await user.type(reasonBox(), "Board removed")
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    await user.click(radio("Yes"))
    await user.click(saveButton())
    expect(saveInput(saveDraft, 0).baseSentAt).toBe("2026-11-08T09:00:00.000Z")
  })

  it("key_sent: says it was sent, clears this phone's copy and starts a new draft after that send", async () => {
    const saveDraft = vi
      .fn<SaveDraft>()
      .mockResolvedValueOnce(
        alreadySent("key_sent", "2026-11-06T08:00:00.000Z")
      )
      .mockResolvedValue(saved)
    const { user, container } = knowledge({ saveDraft })
    await user.click(radio("No"))
    await user.type(reasonBox(), "Board removed")
    expect(stored()?.reason).toBe("Board removed")
    const oldKey = stored()?.idempotencyKey
    await user.click(saveButton())
    expect(
      await screen.findByText("This finding was already sent.")
    ).toBeTruthy()
    await waitFor(() => expect(stored()).toBeNull())
    expect((radio("No") as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole("textbox", { name: /^Reason/ })).toBeNull()
    await user.click(radio("Yes"))
    await user.click(saveButton())
    const next = saveInput(saveDraft, 1)
    expect(next.baseSentAt).toBe("2026-11-06T08:00:00.000Z")
    expect(next.idempotencyKey).not.toBe(oldKey)
    expect(container.textContent).not.toMatch(/another device/i)
  })

  it("newer_send: names the send, and Start a new draft keeps the text with a new key and base", async () => {
    const saveDraft = vi
      .fn<SaveDraft>()
      .mockResolvedValueOnce(
        alreadySent("newer_send", "2026-11-07T15:30:00.000Z")
      )
      .mockResolvedValue(saved)
    const { user, container } = knowledge({ saveDraft })
    await user.click(radio("No"))
    await user.type(reasonBox(), "Board removed")
    const oldKey = stored()?.idempotencyKey
    await user.click(saveButton())
    expect(
      await screen.findByText(
        "You sent a finding on 7 Nov 2026, 15:30. Start a new draft to change it."
      )
    ).toBeTruthy()
    expect(container.textContent).not.toMatch(/another device/i)
    await user.click(screen.getByRole("button", { name: "Start a new draft" }))
    // The old draft's phone copy is gone; what is on screen is the new one.
    await waitFor(() => expect(stored()?.idempotencyKey).not.toBe(oldKey))
    expect(stored()?.reason).toBe("Board removed")
    expect((radio("No") as HTMLInputElement).checked).toBe(true)
    expect((reasonBox() as HTMLTextAreaElement).value).toBe("Board removed")
    await waitFor(() => expect(document.activeElement).toBe(saveButton()))
    await user.click(saveButton())
    const next = saveInput(saveDraft, 1)
    expect(next.baseSentAt).toBe("2026-11-07T15:30:00.000Z")
    expect(next.idempotencyKey).not.toBe(oldKey)
    expect(next.payload.reason).toBe("Board removed")
    expect(container.textContent).not.toMatch(/another device/i)
  })
})

describe("guest_wifi: the redaction tick waits for a photo still saving", () => {
  function wifi() {
    const openAdd = vi.fn()
    const loadAssets = vi.fn(async (): Promise<AssetsResult> => ({
      ok: true,
      assets: [PHOTO],
    }))
    const submit = vi.fn<SubmitHandler>(
      async (): Promise<AmenityResult<SubmitResult>> => ({
        ok: true,
        submissionId: "5b000000-0000-4000-8000-000000000401",
        revision: 5,
        replayed: false,
      })
    )
    render(
      <CaptureForm
        check={check({ entry: { ...check().entry, key: WIFI_KEY } })}
        viewerId={VIEWER_ID}
        initialAssets={{ ok: true, assets: [PHOTO] }}
        loadAssets={loadAssets}
        submit={submit}
        upload={{
          addQueue: { openAdd },
          uploader: async () => {},
          limits: LIMITS,
        }}
        onReload={vi.fn()}
        onDone={vi.fn()}
        signInHref="/login"
        newKey={keys()}
      />
    )
    const user = userEvent.setup()
    return {
      user,
      submit,
      pick: async () => {
        await user.click(
          screen.getByRole("button", { name: "Choose from your photos" })
        )
        const opts = openAdd.mock.lastCall?.[0] as OpenAddOptions
        act(() =>
          opts.onPicked?.([new File(["x"], "a.jpg", { type: "image/jpeg" })])
        )
        return opts
      },
      arrive: async (opts: OpenAddOptions) => {
        loadAssets.mockResolvedValue({ ok: true, assets: [LATER, PHOTO] })
        await act(async () => {
          opts.onReady?.([LATER.assetId])
        })
      },
    }
  }
  const tick = () =>
    screen.getByRole("checkbox", { name: UI_TEXT.redactionConfirm })

  it("can't be ticked while the photo saves, says why, and can be once it is in", async () => {
    const { user, submit, pick, arrive } = wifi()
    await user.click(radio("Yes"))
    const opts = await pick()
    expect((tick() as HTMLInputElement).disabled).toBe(true)
    const why = document.getElementById(
      tick().getAttribute("aria-describedby") ?? ""
    )
    expect(why?.textContent).toBe(
      "Tick this when your photo has finished saving: it covers every photo and video you send."
    )
    await arrive(opts)
    await waitFor(() =>
      expect((tick() as HTMLInputElement).disabled).toBe(false)
    )
    expect(screen.queryByText(/Tick this when/)).toBeNull()
    await user.click(tick())
    await user.type(
      screen.getByRole("textbox", { name: "Where you tested" }),
      "Garden"
    )
    await user.type(screen.getByLabelText("Test date"), "2026-11-01")
    await user.type(
      screen.getByRole("textbox", { name: "Download (Mbps)" }),
      "50"
    )
    await user.type(
      screen.getByRole("textbox", { name: "Upload (Mbps)" }),
      "10"
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.submit }))
    expect((submit.mock.lastCall?.[0] as SubmitInput).redactionConfirmed).toBe(
      true
    )
  })

  it("keeps the rule: a tick given before the photo arrived is asked for again", async () => {
    const { user, pick, arrive } = wifi()
    await user.click(radio("Yes"))
    await user.click(screen.getByRole("checkbox", { name: /^Photo added/ }))
    await user.click(tick())
    expect((tick() as HTMLInputElement).checked).toBe(true)
    const opts = await pick()
    await arrive(opts)
    await waitFor(() =>
      expect((tick() as HTMLInputElement).checked).toBe(false)
    )
  })
})

describe("the legacy amenity list's heading (HM-11)", () => {
  const task = check({ assignee: { id: "me", displayName: "TEST Sam" } })

  it("without a heading reads as today", () => {
    render(<AmenityTaskList tasks={[task]} />)
    expect(
      screen.getByRole("heading", { level: 2, name: /^Amenity checks/ })
    ).toBeTruthy()
    expect(screen.getByRole("list", { name: "Amenity checks" })).toBeTruthy()
  })

  it("takes the heading Home gives it", () => {
    render(<AmenityTaskList tasks={[task]} heading="Other amenity checks" />)
    expect(
      screen.getByRole("heading", { level: 2, name: /^Other amenity checks/ })
    ).toBeTruthy()
    expect(
      screen.getByRole("list", { name: "Other amenity checks" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: /^Amenity checks/ })
    ).toBeNull()
  })
})

describe("the reason field's error (CA-13)", () => {
  it("is no alert: a failed check focuses the field, whose description carries it", async () => {
    const onConfirm = vi.fn(async () => ({ ok: true as const }))
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="Decline this photo?"
        label="Reason"
        confirmLabel="Decline"
        pendingLabel="Declining\u2026"
        onConfirm={onConfirm}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Decline" }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
    const field = screen.getByRole("textbox", { name: "Reason" })
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute("aria-invalid")).toBe("true")
    const ids = (field.getAttribute("aria-describedby") ?? "").split(" ")
    expect(
      ids.map((id) => document.getElementById(id)?.textContent).join(" ")
    ).toContain("Give a reason.")
  })

  it("a refused reason from the server also focuses the field", async () => {
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="Decline this photo?"
        label="Reason"
        confirmLabel="Decline"
        pendingLabel="Declining\u2026"
        onConfirm={async () => ({
          ok: false as const,
          error: "Check the reason.",
          fieldError: "Keep it under 500 characters.",
        })}
      />
    )
    const user = userEvent.setup()
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "x")
    await user.click(screen.getByRole("button", { name: "Decline" }))
    const field = screen.getByRole("textbox", { name: "Reason" })
    await waitFor(() => expect(document.activeElement).toBe(field))
    // The overall error stays one alert; the field's message isn't another.
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Check the reason.",
    ])
  })

  it("focuses the refused field even when a frame runs before the re-render", async () => {
    // A slow render (a loaded device or test run) lets the next animation
    // frame fire while the field is still disabled for the pending request.
    // Focus must follow the re-enabled field, not that frame.
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        cb(performance.now())
        return 0
      })
    try {
      render(
        <ReasonDialog
          open
          onOpenChange={vi.fn()}
          title="Decline this photo?"
          label="Reason"
          confirmLabel="Decline"
          pendingLabel="Declining…"
          onConfirm={async () => ({
            ok: false as const,
            error: "Check the reason.",
            fieldError: "Keep it under 500 characters.",
          })}
        />
      )
      const user = userEvent.setup()
      await user.type(screen.getByRole("textbox", { name: "Reason" }), "x")
      await user.click(screen.getByRole("button", { name: "Decline" }))
      const field = screen.getByRole("textbox", { name: "Reason" })
      await waitFor(() => expect(document.activeElement).toBe(field))
    } finally {
      raf.mockRestore()
    }
  })
})
