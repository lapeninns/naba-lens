// @vitest-environment jsdom
// The capture form on a working-list question (B01-02, B01-03, D4): four
// answers with Couldn't establish, change reports, Save for later, a
// manager's self-confirmation choice, and truthful outcome and refusal copy.
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
import { londonToday } from "@/components/nabalens/amenities/capture/validate"
import { daysBefore } from "@/components/nabalens/knowledge/checked-on"
import { longDate } from "@/components/nabalens/knowledge/copy"

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
type DiscardDraft = NonNullable<KnowledgeCapture["onDiscardDraft"]>

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
  detailForm = null,
  loadNextDates,
  openRechecks,
}: {
  knowledgeSlot?: WorkingSlot
  submit?: ReturnType<typeof vi.fn<Submit>>
  role?: KnowledgeCapture["role"]
  canSelfConfirm?: boolean
  serverDraft?: ServerDraft | null
  saveDraft?: ReturnType<typeof vi.fn<SaveDraft>>
  discardDraft?: ReturnType<typeof vi.fn<DiscardDraft>>
  prefill?: KnowledgeCapture["prefill"]
  detailForm?: KnowledgeCapture["detailForm"]
  loadNextDates?: KnowledgeCapture["loadNextDates"]
  openRechecks?: number
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
        onDiscardDraft: discardDraft,
        serverDraft,
        prefill,
        detailForm,
        loadNextDates,
        openRechecks,
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

  it("treats a replay as sent, even when the question moved on since (M1)", async () => {
    const { user, onDone } = setup({
      // The replay returns the original slot revision, older than the one
      // on screen; that's not a stale send on the knowledge path.
      submit: vi.fn<Submit>(async () =>
        sent({
          replayed: true,
          slotRevision: 3,
          outcome: "awaiting_confirmation",
        })
      ),
    })
    await sendYes(user)
    expect(screen.queryByText(/This check has changed since/)).toBeNull()
    expect(
      window.localStorage.getItem(
        `nabalens.amenity-draft.v2:${VIEWER_ID}:${CHECK_ID}`
      )
    ).toBeNull()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      "the key was used for different details",
      "This submission was already used for a different finding. Reload and try again.",
      "This draft was already sent with different details. Reload to see what was recorded; your draft is kept.",
    ],
    [
      "the question was archived",
      "This check is archived. Restore it first, or reload the page.",
      "This question was archived, so it can't take a finding. Nothing was sent; reload to see it.",
    ],
    [
      "anything else changed",
      "This answer is no longer the one in use. Reload the page.",
      "This answer is no longer the one in use. Reload the page.",
    ],
  ])(
    "a state conflict where %s says so, with Reload only (L4)",
    async (_, message, shown) => {
      const { user, onReload } = setup({
        submit: vi.fn<Submit>(async () => ({
          ...refused("state_conflict"),
          message,
        })),
      })
      await sendYes(user)
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain(shown)
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
      await user.click(within(alert).getByRole("button", { name: "Reload" }))
      expect(onReload).toHaveBeenCalledTimes(1)
    }
  )

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
    let failing = false
    const loadAssets = vi.fn(async (): Promise<AssetsResult> =>
      failing
        ? {
            ok: false,
            code: "unavailable",
            status: 503,
            message: "We couldn't load your photos and videos.",
          }
        : { ok: true, assets: listed }
    )
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
          onDiscardDraft: null,
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
      ready: async ({ failReload = false } = {}) => {
        failing = failReload
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
        "Waiting for your photo to finish saving. It sends by itself when ready; keep this page open."
      )
    ).toBeTruthy()
    expect(radio("No").matches(":disabled")).toBe(true)
    // aria-disabled, so it keeps focus (CA-14).
    expect(
      screen
        .getByRole("button", { name: "Waiting for 1 photo…" })
        .getAttribute("aria-disabled")
    ).toBe("true")
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

  it("ends the wait with the list error when the photos can't be read, sending nothing (L3)", async () => {
    const { user, submit, pick, ready } = withUpload()
    await user.click(radio("Yes"))
    await pick()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    await user.click(screen.getByRole("button", { name: "Wait for it" }))
    await ready({ failReload: true })
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen
        .getAllByRole("alert")
        .map((a) => a.textContent)
        .join(" ")
    ).toContain(
      "We couldn't load your photos and videos. Nothing was sent. Try again when your photos and videos load."
    )
    expect(radio("No").matches(":disabled")).toBe(false)
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

describe("knowledge capture: a send removes the saved draft (CA-01, CA-02, CA-04, CA-06, CA-07, CA-16)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
  }
  const serverDraft: ServerDraft = {
    draftRevision: 3,
    savedAt: "2026-11-06T09:00:00.000Z",
    payload: {
      answer: "yes",
      finding: "",
      limitations: "",
      reason: "",
      unknownPreset: null,
      triedText: "",
      changeReason: "",
      wifi: { testSpot: "", testedOn: "", downloadMbps: "", uploadMbps: "" },
      sentSlotRevision: null,
    },
    assetIds: [],
    idempotencyKey: "server-key",
  }

  it("a send waits for a save still on its way, so the save can't come after it", async () => {
    const pending = deferred<{
      ok: true
      draftRevision: number
      savedAt: string
    }>()
    const saveDraft = vi.fn<SaveDraft>(() => pending.promise)
    const { user, submit } = setup({ saveDraft })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    // Saving: neither button can start another request, and neither drops
    // focus (aria-disabled, CA-14).
    expect(
      screen
        .getByRole("button", { name: "Saving…" })
        .getAttribute("aria-disabled")
    ).toBe("true")
    const submitButton = screen.getByRole("button", { name: "Submit finding" })
    expect(submitButton.getAttribute("aria-disabled")).toBe("true")
    await user.click(submitButton)
    expect(submit).not.toHaveBeenCalled()
    await act(async () =>
      pending.resolve({
        ok: true,
        draftRevision: 1,
        savedAt: "2026-11-06T09:00:00.000Z",
      })
    )
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  it("never saves again after a successful send, even when a save was waiting for a connection", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    const submit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(sent())
    const { user, saveDraft } = setup({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    expect(status()).toContain(
      "It's saved to your account when you're back online with this page open."
    )
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    online.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event("online"))
    })
    // The retry went; the waiting save didn't recreate the draft it removed.
    expect(submit).toHaveBeenCalledTimes(2)
    expect(saveDraft).not.toHaveBeenCalled()
    online.mockRestore()
  })

  it("after a conflict, takes the stored revision so the next save goes through", async () => {
    const saveDraft = vi
      .fn<SaveDraft>()
      .mockResolvedValueOnce({
        ok: false,
        code: "draft_conflict",
        status: 409,
        message: "conflict",
        draftRevision: 5,
      })
      .mockResolvedValueOnce({
        ok: true,
        draftRevision: 6,
        savedAt: "2026-11-06T10:00:00.000Z",
      })
    const { user } = setup({ saveDraft })
    await user.click(radio("No"))
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    expect(status()).toContain(
      "This draft was saved again since you opened it. Save for later again to replace that copy with this one."
    )
    expect(status()).not.toContain("The newer version is shown")
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    expect(saveDraft.mock.calls[1][0].draftRevision).toBe(5)
    expect(status()).toContain("Saved for later.")
  })

  it("names this phone, without the account's time, when the phone's copy is restored", async () => {
    window.localStorage.setItem(
      `nabalens.amenity-draft.v2:${VIEWER_ID}:${CHECK_ID}`,
      JSON.stringify({
        ...JSON.parse(JSON.stringify(serverDraft.payload)),
        idempotencyKey: "phone-key",
        attempted: false,
        revision: 7,
        answer: "no",
        reason: "Gate locked",
        confirmOwn: null,
        assetIds: [],
        redactionConfirmed: false,
        redactionAssetIds: [],
      })
    )
    setup({ serverDraft })
    expect(
      await screen.findByText("Restored from this phone. It hasn't been sent.")
    ).toBeTruthy()
    expect(screen.queryByText(/You saved this on/)).toBeNull()
  })

  it("keeps the draft and says so when the account copy can't be discarded", async () => {
    const onDiscard = vi.fn<DiscardDraft>(async () => ({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    }))
    const { user } = setup({ serverDraft, discardDraft: onDiscard })
    await user.click(
      await screen.findByRole("button", { name: "Discard draft" })
    )
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't discard your draft. It's still saved; try again."
    )
    expect(screen.getByText(/You saved this on/)).toBeTruthy()
  })

  it("after a discard, says so and starts at the answers", async () => {
    const { user } = setup({ serverDraft })
    await user.click(
      await screen.findByRole("button", { name: "Discard draft" })
    )
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(status()).toContain("Draft discarded.")
    await waitFor(() => expect(document.activeElement).toBe(radio("Yes")))
  })
})

describe("knowledge capture: facility detail and Checked on (B03-b)", () => {
  const BAR = {
    subjectId: "5a000000-0000-4000-8000-000000000001",
    kind: "area" as const,
    label: "⟨Back bar⟩",
    active: true,
  }
  const FACILITY = { schema: "facility" as const, places: [BAR] }
  const today = londonToday()

  it("keeps today's form, with no detail or Checked on, without a detail form", async () => {
    const { user } = setup()
    await user.click(radio("Yes"))
    expect(screen.queryByRole("group", { name: "Where is it?" })).toBeNull()
    expect(screen.queryByLabelText("When did you check?")).toBeNull()
  })

  it("sends the facility detail and the form's date, left as the form's", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit, detailForm: FACILITY })
    await user.click(radio("Yes"))
    await user.click(screen.getByRole("checkbox", { name: "⟨Back bar⟩" }))
    await user.click(photoBox())
    expect(
      (screen.getByLabelText("When did you check?") as HTMLInputElement).value
    ).toBe(today)
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit)).toMatchObject({
      answer: "yes",
      detail: { locations: [{ subjectId: BAR.subjectId }] },
      observedOn: today,
      observedOnSource: "form_default",
    })
  })

  it("sends a changed date as chosen, and no detail for No", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit, detailForm: FACILITY })
    await user.click(radio("No"))
    expect(screen.queryByRole("group", { name: "Where is it?" })).toBeNull()
    const date = screen.getByLabelText("When did you check?")
    await user.clear(date)
    await user.type(date, daysBefore(today, 2))
    await user.type(screen.getByLabelText(/Reason/), "⟨Reason⟩")
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    const input = lastInput(submit)
    expect(input).toMatchObject({
      answer: "no",
      observedOn: daysBefore(today, 2),
      observedOnSource: "chosen",
    })
    expect(input).not.toHaveProperty("detail")
  })

  it("puts the server's detail and date errors on their fields", async () => {
    const submit = vi.fn<Submit>(async () => ({
      ok: false as const,
      code: "invalid_input" as const,
      status: 400 as const,
      message: "Check the highlighted answers.",
      fieldErrors: {
        "detail.locations[0]": "Choose a place at this venue.",
        observedOn: "Choose a date in the last 30 days.",
      },
    }))
    const { user } = setup({ submit, detailForm: FACILITY })
    await user.click(radio("Yes"))
    await user.click(screen.getByRole("checkbox", { name: "⟨Back bar⟩" }))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(
      await screen.findByText("Choose a place at this venue.")
    ).toBeTruthy()
    expect(screen.getByText("Choose a date in the last 30 days.")).toBeTruthy()
    expect(
      screen.getByLabelText("When did you check?").getAttribute("aria-invalid")
    ).toBe("true")
    expect(
      screen.getByText("Nothing was sent. Check the highlighted answers.")
    ).toBeTruthy()
  })

  it("clears a draft's form date from an earlier day and needs a choice (D-B3-12)", async () => {
    const started = daysBefore(today, 3)
    window.localStorage.setItem(
      `nabalens.amenity-draft.v2:${VIEWER_ID}:${CHECK_ID}`,
      JSON.stringify({
        idempotencyKey: "stored-key",
        attempted: false,
        revision: 7,
        answer: "no",
        reason: "⟨Reason⟩",
        checkedOn: { date: started, source: "form_default" },
      })
    )
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit, detailForm: FACILITY })
    const date = (await screen.findByLabelText(
      "When did you check?"
    )) as HTMLInputElement
    expect(date.value).toBe("")
    expect(
      screen.getByText(
        `This draft was started on ${longDate(started)}. Choose the day you checked.`
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText("Choose the day you checked.")).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(date))
  })

  it("saves the detail and Checked on with the account draft", async () => {
    const { user, saveDraft } = setup({ detailForm: FACILITY })
    await user.click(radio("Yes"))
    await user.click(screen.getByRole("checkbox", { name: "⟨Back bar⟩" }))
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    expect(saveDraft.mock.lastCall?.[0].payload).toMatchObject({
      answer: "yes",
      detail: { locations: [{ subjectId: BAR.subjectId }] },
      checkedOn: { date: today, source: "form_default" },
    })
  })
})

describe("knowledge capture: accessibility detail (B03 UI §3.2, §3.3)", () => {
  const MAIN = {
    subjectId: "5a000000-0000-4000-8000-000000000011",
    kind: "entrance" as const,
    label: "⟨Main entrance⟩",
    active: true,
  }
  const SIDE = {
    subjectId: "5a000000-0000-4000-8000-000000000012",
    kind: "entrance" as const,
    label: "⟨Side door⟩",
    active: true,
  }
  const TOILET = {
    subjectId: "5a000000-0000-4000-8000-000000000013",
    kind: "facility_point" as const,
    label: "⟨Ground floor toilet⟩",
    active: true,
  }
  const stepFreeForm = (
    places = [MAIN, SIDE, TOILET],
    canManagePlaces = false
  ) => ({
    schema: "accessibility" as const,
    places,
    features: [],
    stepFree: true,
    canManagePlaces,
  })
  const otherForm = (features: { key: string; label: string }[] = []) => ({
    schema: "accessibility" as const,
    places: [MAIN, TOILET],
    features: features.map((f) => ({ ...f, measurable: false })),
    stepFree: false,
    canManagePlaces: false,
  })
  const stepFreeSlot = () => slot({ key: "step_free_entrance" })
  const entrance = (label: string, value: string) =>
    within(screen.getByRole("group", { name: label })).getByRole("radio", {
      name: value,
    })

  it("lists only Places entrances for step-free, and a Yes needs one marked step-free", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({
      submit,
      knowledgeSlot: stepFreeSlot(),
      detailForm: stepFreeForm(),
    })
    await user.click(radio("Yes"))
    const group = screen.getByRole("group", {
      name: "Which entrances did you check?",
    })
    expect(
      within(group).getByRole("group", { name: "⟨Main entrance⟩" })
    ).toBeTruthy()
    expect(within(group).queryByText("⟨Ground floor toilet⟩")).toBeNull()
    expect(
      screen.queryByRole("group", { name: /What did you check/ })
    ).toBeNull()
    expect(screen.queryByText("Features")).toBeNull()
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        "To answer Yes, mark at least one entrance as step-free."
      )
    ).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        entrance("⟨Main entrance⟩", "Step-free")
      )
    )
    await user.click(entrance("⟨Main entrance⟩", "Step-free"))
    expect(
      screen.getByText(
        "Yes says ⟨Main entrance⟩ is step-free. It says nothing about the others."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    const input = lastInput(submit)
    expect(input.detail).toMatchObject({
      entrances: [
        { subjectId: MAIN.subjectId, stepFree: "yes" },
        { subjectId: SIDE.subjectId, stepFree: "not_checked" },
      ],
    })
    expect(input.detail).not.toHaveProperty("scope")
    expect(input.detail).not.toHaveProperty("features")
  })

  it("says to ask a manager when no entrances are listed, and refuses a No", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({
      submit,
      knowledgeSlot: stepFreeSlot(),
      detailForm: stepFreeForm([TOILET]),
    })
    await user.click(radio("No"))
    expect(
      screen.getByText(
        "No entrances are listed for The Old Crown yet. Ask your manager to add entrances under Places."
      )
    ).toBeTruthy()
    await user.type(screen.getByLabelText(/Reason/), "⟨Reason⟩")
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        "No needs The Old Crown's entrances to be listed first. Ask your manager to add them under Places, or send Couldn't establish."
      )
    ).toBeTruthy()
  })

  it("tells a manager to add entrances under Places", async () => {
    const { user } = setup({
      role: "manager",
      knowledgeSlot: stepFreeSlot(),
      detailForm: stepFreeForm([], true),
    })
    await user.click(radio("No"))
    expect(
      screen.getByText(
        "No entrances are listed for The Old Crown yet. Add entrances under Places."
      )
    ).toBeTruthy()
  })

  it("asks no detail for Couldn't establish", async () => {
    const { user } = setup({
      knowledgeSlot: stepFreeSlot(),
      detailForm: stepFreeForm(),
    })
    await user.click(radio("Couldn't establish"))
    expect(
      screen.queryByRole("group", { name: "Which entrances did you check?" })
    ).toBeNull()
    expect(screen.getByLabelText("When did you check?")).toBeTruthy()
  })

  it("needs what was checked on any other question, and sends every feature, untouched as Not checked", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({
      submit,
      detailForm: otherForm([
        { key: "grab_rails", label: "⟨Grab rails⟩" },
        { key: "alarm_cord", label: "⟨Alarm cord⟩" },
      ]),
    })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText("Choose what you checked, or name it.")
    ).toBeTruthy()
    const scope = screen.getByRole("group", {
      name: "What did you check? (required)",
    })
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(scope).getByRole("radio", { name: "⟨Main entrance⟩" })
      )
    )
    await user.click(
      within(scope).getByRole("radio", { name: "⟨Ground floor toilet⟩" })
    )
    await user.click(
      within(screen.getByRole("group", { name: "⟨Grab rails⟩" })).getByRole(
        "radio",
        { name: "Yes" }
      )
    )
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit).detail).toMatchObject({
      scope: { subjectId: TOILET.subjectId },
      features: { grab_rails: "yes", alarm_cord: "not_checked" },
    })
  })

  it("shows no features section when the version lists none", async () => {
    const { user } = setup({ detailForm: otherForm() })
    await user.click(radio("No"))
    expect(
      screen.getByRole("group", { name: "What did you check? (required)" })
    ).toBeTruthy()
    expect(screen.queryByText("Features")).toBeNull()
  })

  it("puts the server's entrance error on the entrances", async () => {
    const submit = vi.fn<Submit>(async () => ({
      ok: false as const,
      code: "invalid_input" as const,
      status: 400 as const,
      message: "Check the highlighted answers.",
      fieldErrors: {
        "detail.entrances": "Mark every listed entrance.",
      },
    }))
    const { user } = setup({
      submit,
      knowledgeSlot: stepFreeSlot(),
      detailForm: stepFreeForm(),
    })
    await user.click(radio("Yes"))
    await user.click(entrance("⟨Side door⟩", "Step-free"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(await screen.findByText("Mark every listed entrance.")).toBeTruthy()
  })

  it("saves the entrances with the account draft and keeps them on this device", async () => {
    const { user, saveDraft } = setup({
      knowledgeSlot: stepFreeSlot(),
      detailForm: stepFreeForm(),
    })
    await user.click(radio("Yes"))
    await user.click(entrance("⟨Main entrance⟩", "Step-free"))
    await user.click(screen.getByRole("button", { name: "Save for later" }))
    expect(saveDraft.mock.lastCall?.[0].payload).toMatchObject({
      detail: {
        entrances: [
          { subjectId: MAIN.subjectId, stepFree: "yes" },
          { subjectId: SIDE.subjectId, stepFree: "not_checked" },
        ],
      },
    })
    cleanup()
    setup({ knowledgeSlot: stepFreeSlot(), detailForm: stepFreeForm() })
    await waitFor(() =>
      expect(
        (entrance("⟨Main entrance⟩", "Step-free") as HTMLInputElement).checked
      ).toBe(true)
    )
  })
})
describe("knowledge capture: policy (B03 UI §4)", () => {
  const BAR = {
    subjectId: "5a000000-0000-4000-8000-000000000001",
    kind: "area" as const,
    label: "⟨Back bar⟩",
    active: true,
  }
  const statement = (over: Record<string, unknown> = {}) => ({
    schema: "policy" as const,
    places: [BAR],
    conditionTypes: [],
    exceptionTypes: [],
    requiresZones: false,
    basis: "venue_manager" as const,
    canStateOrgPolicy: false,
    ...over,
  })
  const today = londonToday()

  it("asks the rule instead of the answers, with no Checked on, and saves an incomplete policy as not confirmed", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ outcome: "awaiting_confirmation" })
    )
    const { user } = setup({ submit, role: "manager", detailForm: statement() })
    expect(screen.queryByRole("radio", { name: /^Yes/ })).toBeNull()
    await user.click(screen.getByRole("radio", { name: "Allowed" }))
    expect(screen.queryByLabelText("When did you check?")).toBeNull()
    const note = screen.getByRole("note", {
      name: "What this policy still needs",
    })
    expect(
      within(note).getByText(
        "confirmation by a venue manager, with where it was stated"
      )
    ).toBeTruthy()
    await user.click(photoBox())
    await user.click(
      screen.getByRole("button", { name: "Save policy (not confirmed)" })
    )
    const input = lastInput(submit)
    expect(input).toMatchObject({
      answer: "yes",
      detail: {
        stance: "allowed",
        policyScope: "venue",
        authority: { basis: "venue_manager" },
      },
    })
    expect(input).not.toHaveProperty("observedOn")
    expect(
      await screen.findByText(
        "Recorded. Not confirmed yet: it still needs confirmation by a venue manager, with where it was stated and the date it was stated."
      )
    ).toBeTruthy()
  })

  it("sends who stated it, and says nothing is missing once it's complete", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ outcome: "awaiting_confirmation" })
    )
    const { user } = setup({ submit, role: "manager", detailForm: statement() })
    await user.click(screen.getByRole("radio", { name: "Not allowed" }))
    const date = screen.getByLabelText("Stated on")
    await user.type(date, today)
    await user.click(screen.getByRole("radio", { name: "Written policy" }))
    expect(screen.getByText("Nothing is missing.")).toBeTruthy()
    await user.type(screen.getByLabelText(/Reason/), "⟨Reason⟩")
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit)).toMatchObject({
      answer: "no",
      detail: {
        stance: "not_allowed",
        authority: {
          basis: "venue_manager",
          statedOn: today,
          source: "written_policy",
        },
      },
    })
  })

  it("keeps Allowed with conditions unavailable while no condition types are set up", async () => {
    const { user } = setup({ role: "manager", detailForm: statement() })
    const conditional = screen.getByRole("radio", {
      name: "Allowed with conditions",
    })
    expect(conditional.getAttribute("aria-disabled")).toBe("true")
    await user.click(conditional)
    expect((conditional as HTMLInputElement).checked).toBe(false)
  })

  it("marks Areas required and lists them as missing when the version requires them", async () => {
    const { user } = setup({
      role: "manager",
      detailForm: statement({ requiresZones: true }),
    })
    await user.click(screen.getByRole("radio", { name: "Allowed" }))
    expect(screen.getByRole("group", { name: "Areas (required)" })).toBeTruthy()
    expect(screen.getByText("at least one area with its rule")).toBeTruthy()
  })

  it("stops a send for a half-filled area and focuses it", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit, role: "manager", detailForm: statement() })
    await user.click(screen.getByRole("radio", { name: "Allowed" }))
    await user.click(screen.getByRole("button", { name: "Add an area" }))
    await user.click(
      within(screen.getByRole("group", { name: "Rule here" })).getByRole(
        "radio",
        { name: "Allowed" }
      )
    )
    await user.click(photoBox())
    await user.click(
      screen.getByRole("button", { name: "Save policy (not confirmed)" })
    )
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText("Choose the area, or name it.")).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Place"))
    )
  })

  it("puts the server's policy errors on their sections", async () => {
    const submit = vi.fn<Submit>(async () => ({
      ok: false as const,
      code: "invalid_input" as const,
      status: 400 as const,
      message: "Check the highlighted answers.",
      fieldErrors: { "detail.authority.statedOn": "⟨Date problem⟩" },
    }))
    const { user } = setup({ submit, role: "manager", detailForm: statement() })
    await user.click(screen.getByRole("radio", { name: "Allowed" }))
    await user.click(photoBox())
    await user.click(
      screen.getByRole("button", { name: "Save policy (not confirmed)" })
    )
    expect(await screen.findByText("⟨Date problem⟩")).toBeTruthy()
  })

  it("gives staff the observation form: the rule seen and areas, never who stated it", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ outcome: "awaiting_confirmation" })
    )
    const { user } = setup({
      submit,
      detailForm: statement({ basis: null }),
    })
    expect(screen.getByRole("group", { name: "The rule you saw" })).toBeTruthy()
    expect(
      screen.getByText(
        "A manager or an admin states the policy. What you send helps them; it doesn't set the rule."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("radio", { name: "Allowed" }))
    expect(screen.queryByLabelText("Stated on")).toBeNull()
    expect(screen.queryByText("What this policy still needs")).toBeNull()
    expect(
      screen.getByText(
        "A photo can show what's there, such as a sign or a bowl. It doesn't confirm the policy."
      )
    ).toBeTruthy()
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit).detail).toEqual({ stance: "allowed" })
  })

  it("records Couldn't establish with its reason and no policy sections", async () => {
    const { user } = setup({ role: "manager", detailForm: statement() })
    await user.click(screen.getByRole("radio", { name: "Couldn't establish" }))
    expect(screen.queryByRole("group", { name: "Areas" })).toBeNull()
    expect(screen.getByText("a rule (not Couldn't establish)")).toBeTruthy()
  })
})
describe("knowledge capture: a qualified answer's reason (B03 UI §2.6)", () => {
  it("doesn't say a manager asked for the recheck", () => {
    render(
      <CaptureForm
        check={{
          ...check,
          progress: "needs_recheck",
          recheckReason: "⟨Server reason⟩",
          qualification: "conditional",
        }}
        viewerId={VIEWER_ID}
        initialAssets={{ ok: true, assets: [] }}
        loadAssets={async () => ({ ok: true, assets: [] })}
        submit={vi.fn()}
        upload={null}
        onReload={vi.fn()}
        onDone={vi.fn()}
        signInHref="/login"
        newKey={keys()}
      />
    )
    expect(screen.getByText("This answer needs checking")).toBeTruthy()
    expect(screen.queryByText("Your manager asked for a recheck")).toBeNull()
  })
})

describe("knowledge capture: services and fixture showings (B03 UI §5)", () => {
  const service = (over: Record<string, unknown> = {}) => ({
    schema: "service" as const,
    timezone: "Europe/London",
    channels: false,
    broadcasters: null,
    ...over,
  })

  it("asks When for Offered, previews through the server, and sends it with Checked on", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const preview = vi.fn(async () => ({ ok: true as const, occurrences: [] }))
    const { user } = setup({
      submit,
      detailForm: service(),
      loadNextDates: preview,
    })
    await user.click(radio("Yes"))
    expect(screen.getByText("Times are UK time.")).toBeTruthy()
    expect(
      screen.getByText("Fix the highlighted times to see the dates.")
    ).toBeTruthy()
    await user.type(screen.getByLabelText("Starts on"), "2026-11-15")
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }))
    await user.type(screen.getByLabelText("From"), "12:00")
    await user.type(screen.getByLabelText("To"), "15:00")
    await waitFor(() => expect(preview).toHaveBeenCalled(), { timeout: 2000 })
    expect(screen.queryByText("Where is it?")).toBeNull()
    expect(screen.queryByLabelText("How to ask for it")).toBeNull()
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(lastInput(submit)).toMatchObject({
      answer: "yes",
      detail: {
        schedule: {
          effectiveFrom: "2026-11-15",
          recurrence: { kind: "weekly", days: ["sun"] },
          windows: [{ start: "12:00", end: "15:00" }],
        },
      },
      observedOnSource: "form_default",
    })
  })

  it("stops a half-written When and focuses its first gap", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit, detailForm: service() })
    await user.click(radio("Yes"))
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText("Choose the day it starts.")).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Starts on"))
    )
  })

  it("needs the day it's back or a note when temporarily unavailable", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit, detailForm: service() })
    await user.click(radio("Yes"))
    await user.click(screen.getByText("Availability", { selector: "summary" }))
    await user.click(
      screen.getByRole("radio", { name: "Temporarily unavailable" })
    )
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(submit).not.toHaveBeenCalled()
    expect(
      screen.getByText("Add the day it's back, or say what's happening.")
    ).toBeTruthy()
  })

  it("says no broadcaster list is set up, and the subscription line", async () => {
    const { user } = setup({
      knowledgeSlot: slot({ key: "sports_subscription" }),
      detailForm: service({ broadcasters: [] }),
    })
    expect(
      screen.getByText(
        "Subscriptions only. Having a subscription isn't a promise to show any particular fixture."
      )
    ).toBeTruthy()
    await user.click(radio("Yes"))
    expect(
      screen.getByText("No broadcaster list is set up yet. Ask an admin.")
    ).toBeTruthy()
  })

  it("commits a manager to one showing, with no Checked on", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({
      submit,
      role: "manager",
      knowledgeSlot: slot({ key: "sports_fixture_showing" }),
      detailForm: {
        schema: "schedule_event",
        committedBy: "You, as venue manager",
      },
    })
    expect(
      screen.getByText(
        "One fixture, on one date. It promises nothing about other fixtures."
      )
    ).toBeTruthy()
    await user.click(radio("Yes"))
    expect(screen.queryByLabelText("When did you check?")).toBeNull()
    expect(screen.getByText("You, as venue manager")).toBeTruthy()
    await user.type(screen.getByLabelText("Fixture"), "⟨Fixture⟩")
    await user.type(screen.getByLabelText("Date"), "2026-11-21")
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    const input = lastInput(submit)
    expect(input.detail).toEqual({
      event: { title: "⟨Fixture⟩", localDate: "2026-11-21" },
    })
    expect(input).not.toHaveProperty("observedOn")
  })
})

describe("knowledge capture: a date change is the manager's (B03 UI §5.2)", () => {
  it("points staff at Report a change when a schedule is in use", () => {
    setup({
      knowledgeSlot: slot({
        mode: "change",
        answerInUse: {
          ...YES,
          scheduleId: "5c000000-0000-4000-8000-000000000001",
        },
      }),
    })
    expect(
      screen.getByText("Something different on a date? Report a change.")
    ).toBeTruthy()
  })
})

describe("knowledge capture: a recheck's sent notice (B03 UI §6.2)", () => {
  it("says Recheck done only when the server closed the task", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ rechecksClosed: [{ taskId: "t1", use: "internal" }] })
    )
    const { user } = setup({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(await screen.findByText("Recheck done.")).toBeTruthy()
  })

  it("says the recheck stays open while the finding awaits confirmation", async () => {
    const submit = vi.fn<Submit>(async () =>
      sent({ outcome: "awaiting_confirmation" })
    )
    const { user } = setup({ submit, openRechecks: 1 })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    expect(
      await screen.findByText(
        "Recheck sent. It stays open until a manager or an admin confirms your finding."
      )
    ).toBeTruthy()
    expect(screen.queryByText("Recheck done.")).toBeNull()
  })

  it("claims nothing about a recheck without one", async () => {
    const submit = vi.fn<Submit>(async () => sent())
    const { user } = setup({ submit })
    await user.click(radio("Yes"))
    await user.click(photoBox())
    await user.click(screen.getByRole("button", { name: "Submit finding" }))
    await screen.findByText(/Finding sent/)
    expect(screen.queryByText(/Recheck/)).toBeNull()
  })
})
