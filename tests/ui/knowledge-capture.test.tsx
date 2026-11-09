// @vitest-environment jsdom
// The capture form on a working-list question (B01-02, B01-03, D4): four
// answers with Couldn't establish, change reports, Save for later, a
// manager's self-confirmation choice, and truthful outcome and refusal copy.
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CaptureForm,
  type AssetsResult,
  type KnowledgeCapture,
} from "@/components/nabalens/amenities/capture"
import type { OpenAddOptions } from "@/components/nabalens/shell/add-context"
import type {
  AmenityFailure,
  CheckSummary,
  SubmittableAsset,
} from "@/lib/amenities/contract"
import type {
  AnswerInUse,
  KnowledgeFailure,
  KnowledgeResult,
  ServerDraft,
  SubmitKnowledgeInput,
  SubmittedFinding,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

const CHECK_ID = "8a000000-0000-4000-8000-000000000002"
const VIEWER_ID = "1a2b3c4d-0000-4aaa-8bbb-00000000000b"

const PHOTO: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000001a",
  kind: "photo",
  createdAt: "2026-11-02T10:00:00.000Z",
  source: "own",
  thumbUrl: null,
}

const check: CheckSummary = {
  id: CHECK_ID,
  venueId: "v1",
  entry: {
    key: "onsite_parking",
    category: "Arrival",
    question: "Is there parking on site?",
    captureBrief: "Photograph the car park entrance and its sign.",
    evidenceRule: "photo",
    isCore: true,
    position: 2,
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
  revision: 3,
  updatedAt: "2026-11-05T10:00:00.000Z",
}

const NONE: AnswerInUse = {
  status: "unavailable",
  reason: "unknown",
  detail: "not_checked",
  value: null,
  savedAt: null,
  sentAt: null,
  confirmation: { state: "not_required", self: false, at: null, by: null },
}
const YES: AnswerInUse = {
  ...NONE,
  status: "available",
  reason: null,
  detail: null,
  value: "yes",
  savedAt: "2026-11-03T14:05:00.000Z",
}

function slot(over: Partial<WorkingSlot> = {}): WorkingSlot {
  return {
    checkId: CHECK_ID,
    key: "onsite_parking",
    question: "Is there parking on site?",
    category: "Arrival",
    evidenceRule: "photo",
    progress: "needs_capture",
    slotRevision: 7,
    answerInUse: NONE,
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

const sent = (
  over: Partial<SubmittedFinding> = {}
): KnowledgeResult<SubmittedFinding> => ({
  ok: true,
  findingRef: { type: "contribution", id: "f1" },
  slotRevision: 8,
  replayed: false,
  outcome: "current",
  replacedOwn: null,
  recognition: { kind: "none" },
  ...over,
})

const refused = (code: KnowledgeFailure["code"]): KnowledgeFailure => ({
  ok: false,
  code,
  status: 409,
  message: code,
})

function keys() {
  let n = 0
  return () => `key-${++n}`
}

type Submit = (
  input: SubmitKnowledgeInput
) => Promise<KnowledgeResult<SubmittedFinding>>
type SaveDraft = NonNullable<KnowledgeCapture["saveDraft"]>
type DiscardDraft = NonNullable<KnowledgeCapture["discardDraft"]>

function setup({
  knowledgeSlot = slot(),
  submit = vi.fn<Submit>(async () => sent()),
  role = "staff",
  canSelfConfirm = false,
  serverDraft = null,
  saveDraft = vi.fn<SaveDraft>(async () => ({
    ok: true,
    draftRevision: 1,
    savedAt: "2026-11-06T09:00:00.000Z",
  })),
  discardDraft = vi.fn<DiscardDraft>(async () => ({ ok: true })),
  prefill = null,
}: {
  knowledgeSlot?: WorkingSlot
  submit?: ReturnType<typeof vi.fn<Submit>>
  role?: KnowledgeCapture["role"]
  canSelfConfirm?: boolean
  serverDraft?: ServerDraft | null
  saveDraft?: ReturnType<typeof vi.fn<SaveDraft>>
  discardDraft?: ReturnType<typeof vi.fn<DiscardDraft>>
  prefill?: KnowledgeCapture["prefill"]
} = {}) {
  const onDone = vi.fn()
  const onReload = vi.fn()
  const legacySubmit = vi.fn()
  const assets: AssetsResult = { ok: true, assets: [PHOTO] }
  const ui = (s: WorkingSlot) => (
    <CaptureForm
      check={check}
      viewerId={VIEWER_ID}
      initialAssets={assets}
      loadAssets={async () => assets}
      submit={legacySubmit}
      upload={null}
      onReload={onReload}
      onDone={onDone}
      signInHref="/login"
      pageHref={`/staff/tasks/amenities/${CHECK_ID}`}
      newKey={keys()}
      knowledge={{
        venueName: "The Old Crown",
        slot: s,
        role,
        canSelfConfirm,
        respondsTo: null,
        submit,
        saveDraft,
        discardDraft,
        serverDraft,
        prefill,
      }}
    />
  )
  const utils = render(ui(knowledgeSlot))
  return {
    user: userEvent.setup(),
    submit,
    legacySubmit,
    saveDraft,
    discardDraft,
    onDone,
    onReload,
    rerender: (s: WorkingSlot) => utils.rerender(ui(s)),
  }
}

const radio = (name: string) => screen.getByRole("radio", { name })
const photoBox = () =>
  screen.getByRole("checkbox", { name: "Photo added 2 Nov 2026, 10:00" })
const lastInput = (submit: ReturnType<typeof vi.fn<Submit>>) =>
  submit.mock.lastCall?.[0] as SubmitKnowledgeInput
const status = () =>
  screen
    .getAllByRole("status")
    .map((n) => n.textContent)
    .join(" ")

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("knowledge capture: before sending", () => {
  it("names the venue and says a confirmation-free answer is used straight away (D11)", () => {
    setup()
    const note = screen.getAllByRole("note")[0]
    expect(note.textContent).toContain("You're answering for The Old Crown.")
    expect(note.textContent).toContain(
      "No one needs to confirm this question. What you send becomes the venue's answer straight away."
    )
    expect(
      screen.getByText("This becomes the venue's answer when you send it.")
    ).toBeTruthy()
  })

  it("offers four answers, each named by its word with its hint as description", () => {
    setup()
    for (const [name, hint] of [
      ["Yes", "True for guests today."],
      ["No", "Not true today."],
      ["Not applicable", "The question doesn't fit this venue."],
      ["Couldn't establish", "You tried and couldn't find out."],
    ]) {
      const input = radio(name)
      const described = document.getElementById(
        input.getAttribute("aria-describedby")!
      )
      expect(described?.textContent).toBe(hint)
    }
    expect(screen.queryByText("Needs verification")).toBeNull()
  })

  it("says confirmation comes first on step-free entrance (D7)", () => {
    setup({
      knowledgeSlot: slot({
        key: "step_free_entrance",
        requiresConfirmation: true,
      }),
    })
    expect(
      screen.getByText(
        "Your manager confirms answers to this question before they're used."
      )
    ).toBeTruthy()
    expect(
      screen.getByText("Your manager confirms this before it's used.")
    ).toBeTruthy()
  })
})

describe("knowledge capture: sending", () => {
  it("sends an unassigned Yes with the slot revision and says it's the answer, with the credit the server reports", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ recognition: { kind: "scored", period: "2026-11" } })
    )
    const { user, onDone, legacySubmit } = setup({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit)).toEqual({
      checkId: CHECK_ID,
      slotRevision: 7,
      idempotencyKey: "key-1",
      kind: "finding",
      answer: "yes",
      assetIds: [PHOTO.assetId],
    })
    expect(legacySubmit).not.toHaveBeenCalled()
    expect(status()).toContain("Finding sent. It's now the venue's answer.")
    expect(status()).toContain("Counted in your November target.")
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("records Couldn't establish with its reason and what was tried, and never promises credit", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ outcome: "recorded", recognition: { kind: "not_scored" } })
    )
    const { user } = setup({ submit })
    await user.click(radio("Couldn't establish"))
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText("Choose why you couldn't establish it.")
    ).toBeTruthy()
    expect(screen.getByText("Say what you tried.")).toBeTruthy()
    await user.click(radio("Couldn't get to it (locked, closed or unsafe)"))
    await user.type(
      screen.getByRole("textbox", { name: /What did you try\?/ }),
      "The car park gate was locked"
    )
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit)).toMatchObject({
      answer: "unknown",
      unknownPreset: "could_not_access",
      triedText: "The car park gate was locked",
      assetIds: [],
    })
    expect(lastInput(submit)).not.toHaveProperty("reason")
    expect(status()).toContain(
      "Recorded: couldn't establish. The question stays open."
    )
    expect(status()).toContain(
      "Couldn't-establish findings don't count toward targets."
    )
  })

  it("asks what changed on a change report and says the answer is marked as being checked (D1)", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({
        outcome: "awaiting_confirmation",
        recognition: { kind: "pending" },
      })
    )
    const { user } = setup({
      submit,
      knowledgeSlot: slot({ mode: "change", answerInUse: YES }),
    })
    expect(
      screen.getByText(
        /If you send a different answer, it's marked as being checked/
      )
    ).toBeTruthy()
    await user.click(radio("No"))
    await user.type(screen.getByRole("textbox", { name: /^Reason/ }), "Closed")
    await user.click(screen.getByRole("button", { name: "Send change report" }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText("Say what changed.")).toBeTruthy()
    await user.type(
      screen.getByRole("textbox", { name: /What changed\?/ }),
      "The car park is now residents only"
    )
    await user.click(screen.getByRole("button", { name: "Send change report" }))
    expect(lastInput(submit)).toMatchObject({
      kind: "change_report",
      answer: "no",
      reason: "Closed",
      changeReason: "The car park is now residents only",
    })
    expect(status()).toContain(
      "Change report sent. Until your manager decides, the recorded answer is marked as being checked."
    )
    expect(status()).not.toMatch(/stays in use/)
  })
})

describe("knowledge capture: a manager's own answer on a confirmation-required question (D4)", () => {
  const stepFree = slot({
    key: "step_free_entrance",
    requiresConfirmation: true,
  })

  it("requires a choice, names the primary after it and records it", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({
      submit,
      role: "manager",
      canSelfConfirm: true,
      knowledgeSlot: stepFree,
    })
    await user.click(radio("Not applicable"))
    await user.type(
      screen.getByRole("textbox", { name: /^Reason/ }),
      "No entrance"
    )
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText("Choose who confirms this answer.")).toBeTruthy()
    await user.click(radio("I confirm it now"))
    await user.click(screen.getByRole("button", { name: "Submit and confirm" }))
    expect(lastInput(submit)).toMatchObject({ confirmOwn: true })
    expect(status()).toContain(
      "Finding sent and confirmed by you. It's now the venue's answer."
    )
  })

  it("after a refused self-confirmation keeps only the other choice and nothing was sent", async () => {
    const submit = vi
      .fn<Submit>()
      .mockResolvedValueOnce(refused("self_confirmation_not_permitted"))
      .mockResolvedValueOnce(sent({ outcome: "awaiting_confirmation" }))
    const { user } = setup({
      submit,
      role: "manager",
      canSelfConfirm: true,
      knowledgeSlot: stepFree,
    })
    await user.click(radio("Not applicable"))
    await user.type(
      screen.getByRole("textbox", { name: /^Reason/ }),
      "No entrance"
    )
    await user.click(radio("I confirm it now"))
    await user.click(screen.getByRole("button", { name: "Submit and confirm" }))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("You can't confirm this yourself now")
    expect(alert.textContent).toContain(
      "Nothing was sent. Choose “Leave it for another manager or an admin”, then submit again."
    )
    expect(screen.queryByRole("radio", { name: "I confirm it now" })).toBeNull()
    const group = screen.getByRole("group", {
      name: /Who confirms this answer/,
    })
    await act(
      async () => new Promise<void>((r) => requestAnimationFrame(() => r()))
    )
    expect(document.activeElement).toBe(group)
    await user.click(radio("Leave it for another manager or an admin"))
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit)).toMatchObject({ confirmOwn: false })
    expect(status()).toContain(
      "Finding sent. It waits for another manager or an admin to confirm it."
    )
  })
})

describe("knowledge capture: refusals are never retried", () => {
  async function sendYes(user: ReturnType<typeof userEvent.setup>) {
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
  }

  it("a question taken off the list says nothing was sent and offers only Reload (R1)", async () => {
    const { user, onReload } = setup({
      submit: vi.fn<Submit>(async () => refused("knowledge_slot_out_of_scope")),
    })
    await sendYes(user)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("This question changed")
    expect(alert.textContent).toContain(
      "Nothing was sent. This question was taken off The Old Crown's question list while you were working."
    )
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    await user.click(within(alert).getByRole("button", { name: "Reload" }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it.each([
    "already_decided",
    "draft_conflict",
    "knowledge_path_required",
    "self_confirmation_not_permitted",
    "state_conflict",
    "revision_conflict",
  ] as const)("never offers Try again for %s", async (code) => {
    const { user } = setup({ submit: vi.fn<Submit>(async () => refused(code)) })
    await sendYes(user)
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("retries a lost answer with the same key and the same slot revision, even after the slot moved (T3c)", async () => {
    const submit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(sent({ replayed: true, slotRevision: 8 }))
    const { user, rerender } = setup({ submit })
    await sendYes(user)
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
    rerender(slot({ slotRevision: 8 }))
    await user.click(screen.getByRole("button", { name: "Try again" }))
    const [first, second] = submit.mock.calls.map((c) => c[0])
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(second.slotRevision).toBe(7)
    const stored = JSON.parse(
      window.localStorage.getItem(
        `nabalens.amenity-draft.v2:${VIEWER_ID}:${CHECK_ID}`
      ) ?? "null"
    )
    // The successful replay cleared the device draft.
    expect(stored).toBeNull()
  })

  it("the legacy form sends a refused working-list question back to its page, never Try again (G2)", async () => {
    const legacy = vi.fn(async (): Promise<AmenityFailure> => ({
      ok: false,
      code: "knowledge_path_required" as AmenityFailure["code"],
      status: 409,
      message: "knowledge_path_required",
    }))
    render(
      <CaptureForm
        check={check}
        viewerId={VIEWER_ID}
        initialAssets={{ ok: true, assets: [PHOTO] }}
        loadAssets={async () => ({ ok: true, assets: [PHOTO] })}
        submit={legacy}
        upload={null}
        onReload={vi.fn()}
        onDone={vi.fn()}
        signInHref="/login"
        pageHref={`/staff/tasks/amenities/${CHECK_ID}`}
      />
    )
    const user = userEvent.setup()
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("This question has a new form")
    expect(alert.textContent).toContain(
      "Nothing was sent. Open the question again to use the new form; your draft is kept on this device."
    )
    expect(
      within(alert)
        .getByRole("link", { name: "Open the question again" })
        .getAttribute("href")
    ).toBe(`/staff/tasks/amenities/${CHECK_ID}`)
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })
})

describe("knowledge capture: Save for later", () => {
  it("saves an unanswered draft to the account and says it wasn't sent", async () => {
    const { user, saveDraft, submit } = setup()
    await user.type(
      screen.getByRole("textbox", { name: /What you found/ }),
      "Small car park at the back"
    )
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    expect(submit).not.toHaveBeenCalled()
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        checkId: CHECK_ID,
        draftRevision: null,
        payload: expect.objectContaining({
          answer: null,
          finding: "Small car park at the back",
          sentSlotRevision: null,
        }),
      })
    )
    expect(status()).toContain(
      "Saved for later. Not sent yet. Finish it from Home or Me."
    )
  })

  it("restores the account's draft with its date and discards it on request", async () => {
    const serverDraft: ServerDraft = {
      draftRevision: 3,
      savedAt: "2026-11-05T10:30:00.000Z",
      idempotencyKey: "server-key",
      assetIds: [],
      payload: {
        answer: "no",
        finding: "",
        limitations: "",
        reason: "Gate locked at night",
        unknownPreset: null,
        triedText: "",
        changeReason: "",
        wifi: { testSpot: "", testedOn: "", downloadMbps: "", uploadMbps: "" },
        sentSlotRevision: null,
      },
    }
    const { user, discardDraft } = setup({ serverDraft })
    expect(
      screen.getByText(
        "You saved this on 5 Nov 2026, 10:30. It hasn't been sent."
      )
    ).toBeTruthy()
    expect((radio("No") as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole("button", { name: "Discard draft" }))
    const dialog = await screen.findByRole("alertdialog", {
      name: "Discard this draft?",
    })
    await user.click(within(dialog).getByRole("button", { name: "Discard" }))
    expect(discardDraft).toHaveBeenCalledTimes(1)
    expect((radio("No") as HTMLInputElement).checked).toBe(false)
  })
})

describe("knowledge capture: evidence that isn't ready yet (D2, G4)", () => {
  const NEW_PHOTO: SubmittableAsset = {
    assetId: "7d000000-0000-4000-8000-00000000002b",
    kind: "photo",
    createdAt: "2026-11-06T10:00:00.000Z",
    source: "own",
    thumbUrl: null,
  }

  function withUpload(submit = vi.fn<Submit>(async () => sent())) {
    let listed: SubmittableAsset[] = [PHOTO]
    const loadAssets = vi.fn(async (): Promise<AssetsResult> => ({
      ok: true,
      assets: listed,
    }))
    const opened: { last: OpenAddOptions | undefined } = { last: undefined }
    const openAdd = vi.fn((opts?: OpenAddOptions) => {
      opened.last = opts
    })
    const onDone = vi.fn()
    const onReload = vi.fn()
    render(
      <CaptureForm
        check={check}
        viewerId={VIEWER_ID}
        initialAssets={{ ok: true, assets: [PHOTO] }}
        loadAssets={loadAssets}
        submit={vi.fn()}
        upload={{
          addQueue: { openAdd },
          uploader: async () => {},
          limits: {
            maxBatchFiles: 10,
            maxParallelUploads: 2,
            maxPhotoBytes: 1,
            maxVideoBytes: 1,
          },
        }}
        onReload={onReload}
        onDone={onDone}
        signInHref="/login"
        newKey={keys()}
        knowledge={{
          venueName: "The Old Crown",
          slot: slot(),
          role: "staff",
          canSelfConfirm: false,
          respondsTo: null,
          submit,
          saveDraft: null,
          discardDraft: null,
          serverDraft: null,
        }}
      />
    )
    return {
      user: userEvent.setup(),
      submit,
      onDone,
      opened,
      pick: async () => {
        await userEvent
          .setup()
          .click(
            screen.getByRole("button", { name: /Choose from your photos/ })
          )
        act(() => opened.last?.onPicked?.([new File(["x"], "new.jpg")]))
      },
      ready: async () => {
        listed = [PHOTO, NEW_PHOTO]
        await act(async () => {
          opened.last?.onReady?.([NEW_PHOTO.assetId])
        })
      },
    }
  }

  it("sends nothing while a photo from here is saving, and offers to send without it when the answer doesn't need it", async () => {
    const { user, submit, pick } = withUpload()
    await user.click(radio("No"))
    await user.type(
      screen.getByRole("textbox", { name: /^Reason/ }),
      "Residents only"
    )
    await pick()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        "Your photo is still saving. Wait for it, or send without it."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Send without it" }))
    expect(lastInput(submit)).toMatchObject({ answer: "no", assetIds: [] })
  })

  it("for a Yes that only the saving photo would meet, offers only to wait", async () => {
    const { user, submit, pick } = withUpload()
    await user.click(radio("Yes"))
    await pick()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        "Yes needs evidence: Photo. Wait for your photo to finish saving."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Send without it" })).toBeNull()
    expect(screen.getByRole("button", { name: "Wait for it" })).toBeTruthy()
  })

  it("waits read-only, then sends by itself with the same key once the photo is ready", async () => {
    const { user, submit, pick, ready, onDone } = withUpload()
    await user.click(radio("Yes"))
    await pick()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    await user.click(screen.getByRole("button", { name: "Wait for it" }))
    expect(
      screen.getByText(
        "Waiting for your photo to finish saving. It sends by itself when ready."
      )
    ).toBeTruthy()
    expect(radio("No").matches(":disabled")).toBe(true)
    expect(
      (
        screen.getByRole("button", {
          name: "Waiting for 1 photo…",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    await ready()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(lastInput(submit)).toMatchObject({
      answer: "yes",
      idempotencyKey: "key-1",
      assetIds: [NEW_PHOTO.assetId],
    })
    expect(onDone).toHaveBeenCalled()
  })

  it("Stop waiting and edit cancels: nothing sends when the photo is ready", async () => {
    const { user, submit, pick, ready } = withUpload()
    await user.click(radio("Yes"))
    await pick()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    await user.click(screen.getByRole("button", { name: "Wait for it" }))
    await user.click(
      screen.getByRole("button", { name: "Stop waiting and edit" })
    )
    expect(radio("No").matches(":disabled")).toBe(false)
    await ready()
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Submit finding" })).toBeTruthy()
  })

  it("says the question changed while the photo was saving when the send meets a newer revision", async () => {
    const { user, pick, ready } = withUpload(
      vi.fn<Submit>(async () => refused("revision_conflict"))
    )
    await user.click(radio("Yes"))
    await pick()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    await user.click(screen.getByRole("button", { name: "Wait for it" }))
    await ready()
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain(
      "This question changed while your photo was saving. Nothing was sent."
    )
    expect(within(alert).getByRole("button", { name: "Reload" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })
})

describe("knowledge capture: credit lines only when the server says scored", () => {
  const stepFree = slot({
    key: "step_free_entrance",
    requiresConfirmation: true,
  })

  it.each([{ kind: "none" as const }, { kind: "pending" as const }])(
    "a manager's direct capture with recognition %o shows no counted line",
    async (recognition) => {
      const submit = vi.fn<Submit>(async () =>
        sent({ outcome: "current", recognition })
      )
      const { user } = setup({
        submit,
        role: "manager",
        canSelfConfirm: true,
        knowledgeSlot: stepFree,
      })
      await user.click(radio("Yes"))
      await user.click(photoBox())
      await user.click(radio("I confirm it now"))
      await user.click(
        screen.getByRole("button", { name: "Submit and confirm" })
      )
      expect(status()).toContain("It's now the venue's answer.")
      expect(status()).not.toMatch(/Counted in/)
    }
  )
})

describe("Change my finding (§4.6)", () => {
  it("starts from the undecided finding's answer", () => {
    setup({ prefill: { answer: "no", unknownPreset: null } })
    expect((radio("No") as HTMLInputElement).checked).toBe(true)
  })
})
