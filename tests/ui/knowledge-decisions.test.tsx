// @vitest-environment jsdom
// Manager decisions on a working-list question (B01-04, rev 5 §6.2-§6.6):
// confirm, ask for more detail, don't confirm or keep the answer in use,
// Couldn't-establish findings, conflicts, answers that need a decision, and
// refusals in the manager's words.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }),
}))

import {
  DecisionPanel,
  type DecisionHandlers,
} from "@/components/nabalens/knowledge/decisions"
import type {
  AnswerInUse,
  QuestionView,
  PendingFinding,
} from "@/lib/knowledge-client/contract"

const NONE: AnswerInUse = {
  status: "unavailable",
  reason: "not_confirmed",
  detail: "pending",
  value: null,
  savedAt: null,
  sentAt: null,
  confirmation: { state: "not_required", self: false, at: null, by: null },
}
const YES: AnswerInUse = {
  status: "available",
  reason: null,
  detail: null,
  value: "yes",
  savedAt: "2026-11-03T14:05:00.000Z",
  sentAt: null,
  confirmation: {
    state: "confirmed",
    self: false,
    at: "2026-11-03T15:00:00.000Z",
    by: { id: "m1", displayName: "Maya Rai" },
  },
}
const DISPUTED: AnswerInUse = {
  ...YES,
  status: "unavailable",
  reason: "disputed",
  detail: "conflict",
}

let n = 0
function finding(over: Partial<PendingFinding> = {}): PendingFinding {
  n += 1
  return {
    findingRef: { type: "contribution", id: `f${n}` },
    kind: "finding",
    answer: "no",
    finding: "Gate locked",
    limitations: null,
    reason: "Residents only now",
    unknownPreset: null,
    triedText: null,
    changeReason: null,
    sender: { id: `s${n}`, displayName: "Sam Lee" },
    senderIsAssignee: false,
    mine: false,
    sentAt: "2026-11-05T10:00:00.000Z",
    evidence: [],
    wifi: null,
    disputes: false,
    detailRequest: null,
    removedEvidence: 0,
    ...over,
  }
}

function view(
  pending: PendingFinding[],
  answer: AnswerInUse = NONE,
  permissions: Partial<
    Extract<QuestionView, { inScope: true }>["permissions"]
  > = {}
): Extract<QuestionView, { inScope: true }> {
  return {
    inScope: true,
    venue: { id: "v1", name: "The Old Crown" },
    capture: {
      id: "c1",
      venueId: "v1",
      status: "active",
      progress: "complete",
      recheckReason: null,
      revision: 21,
      entry: {
        key: "onsite_parking",
        category: "Arrival",
        question: "Is there parking on site?",
        captureBrief: "",
        evidenceRule: "photo",
      },
    },
    slot: {
      checkId: "c1",
      key: "onsite_parking",
      question: "Is there parking on site?",
      category: "Arrival",
      evidenceRule: "photo",
      progress: "complete",
      slotRevision: 21,
      answerInUse: answer,
      previousAnswer: null,
      latestAttempt: null,
      assignee: null,
      mode: "none",
      requiresConfirmation: false,
      myLatest: null,
      myDraft: null,
      othersPending: 0,
      closedAssignment: null,
    },
    pending,
    permissions: {
      canContribute: true,
      canReportChange: false,
      canConfirm: true,
      canSelfConfirm: false,
      canRequestDetail: true,
      canDecline: true,
      ...permissions,
    },
    history: [],
  }
}

const ok = {
  ok: true as const,
  slotRevision: 22,
  replayed: false,
  replacedAnswer: null,
}

function setup(
  v: Extract<QuestionView, { inScope: true }>,
  h: Partial<DecisionHandlers> = {}
) {
  const handlers = {
    decide: vi.fn<DecisionHandlers["decide"]>(async () => ok),
    onResolveConflict: vi.fn<DecisionHandlers["onResolveConflict"]>(
      async () => ok
    ),
    ...h,
  }
  const onReopen = vi.fn()
  render(<DecisionPanel view={v} handlers={handlers} onReopen={onReopen} />)
  return { user: userEvent.setup(), handlers, onReopen }
}

const card = (name: RegExp | string) => screen.getByRole("article", { name })

beforeEach(() => {
  n = 0
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("To confirm: one finding", () => {
  it("confirms a finding when nothing is in use, with the slot revision", async () => {
    const f = finding()
    const { user, handlers } = setup(view([f]))
    expect(screen.getByRole("heading", { name: /To confirm/ })).toBeTruthy()
    expect(
      screen.getByText("Readers are told it's awaiting confirmation.")
    ).toBeTruthy()
    const c = card("Finding from Sam Lee")
    expect(within(c).getByText("None")).toBeTruthy()
    await user.click(within(c).getByRole("button", { name: "Confirm" }))
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        findingRef: f.findingRef,
        decision: "confirm",
        slotRevision: 21,
        idempotencyKey: expect.any(String),
      })
    )
    expect(
      screen.getByText("Confirmed. This is now the answer for The Old Crown.")
    ).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalled()
  })

  it("asks before replacing an answer in use", async () => {
    const { user, handlers } = setup(view([finding()], YES))
    expect(
      screen.getByText("Readers still get the current answer.")
    ).toBeTruthy()
    const c = card("Finding from Sam Lee")
    expect(within(c).getByText("Different")).toBeTruthy()
    expect(
      within(c).getByText("Confirmed by Maya Rai on 3 Nov 2026")
    ).toBeTruthy()
    await user.click(within(c).getByRole("button", { name: "Confirm" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Replace the current answer?",
    })
    expect(dialog.textContent).toContain(
      "“Yes” stops being used and stays in the history. “No” is used from now."
    )
    expect(handlers.decide).not.toHaveBeenCalled()
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm and replace" })
    )
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "confirm" })
    )
  })

  it("keeps the answer in use against a disputing finding, saying what readers see (D1)", async () => {
    const f = finding({
      disputes: true,
      kind: "change_report",
      changeReason: "Residents only",
    })
    const { user, handlers } = setup(view([f], DISPUTED))
    expect(
      screen.getByText(
        "While this is undecided, readers are told the answer is being checked. Confirm the change, keep the answer in use, or reopen the question."
      )
    ).toBeTruthy()
    const c = card("Change report from Sam Lee")
    await user.click(
      within(c).getByRole("button", { name: "Keep the answer in use" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Keep the answer in use?",
    })
    expect(dialog.textContent).toContain(
      "The answer in use doesn't change. Readers get the answer again."
    )
    await user.type(
      within(dialog).getByRole("textbox", { name: /Why not\?/ }),
      "Checked it myself"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Keep the answer in use" })
    )
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "decline",
        note: "Checked it myself",
      })
    )
    expect(screen.getByText("Not confirmed. Sam will see why.")).toBeTruthy()
  })

  it("asks the sender for more detail", async () => {
    const { user, handlers } = setup(view([finding()]))
    await user.click(
      screen.getByRole("button", { name: "Ask for more detail" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Ask Sam for more detail",
    })
    expect(dialog.textContent).toContain("Sam sees this on Home.")
    await user.type(
      within(dialog).getByRole("textbox", { name: /What do you need\?/ }),
      "A photo of the sign"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Ask for more detail" })
    )
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "request_detail",
        note: "A photo of the sign",
      })
    )
    expect(screen.getByText("Asked Sam for more detail.")).toBeTruthy()
  })

  it("offers no decision on the manager's own finding without self-confirmation", () => {
    setup(view([finding({ mine: true })]))
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull()
    expect(
      screen.getByText(
        "You sent this, so another manager or an admin confirms it."
      )
    ).toBeTruthy()
  })
})

describe("To confirm: Couldn't establish (rev 5 §6.2)", () => {
  const unknown = (over: Partial<PendingFinding> = {}) =>
    finding({
      answer: "unknown",
      reason: null,
      unknownPreset: "needs_access",
      triedText: "Asked the bar",
      ...over,
    })

  it("never offers Confirm; without a dispute, Mark as seen", async () => {
    const f = unknown()
    const { user, handlers } = setup(view([f]))
    const c = card("Finding from Sam Lee")
    expect(within(c).queryByRole("button", { name: "Confirm" })).toBeNull()
    expect(
      within(c).getByText("Needs someone with access or a key")
    ).toBeTruthy()
    await user.click(within(c).getByRole("button", { name: "Mark as seen" }))
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({ findingRef: f.findingRef, decision: "seen" })
    )
  })

  it("as the only disputing finding offers Keep the answer in use, through conflict resolution (R3)", async () => {
    const { user, handlers } = setup(
      view([unknown({ disputes: true, kind: "change_report" })], DISPUTED)
    )
    const c = card("Change report from Sam Lee")
    expect(c.textContent).toContain(
      "Either Keep the answer in use or Mark as seen ends the dispute, and readers then get the answer again."
    )
    await user.click(
      within(c).getByRole("button", { name: "Keep the answer in use" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Keep the answer in use?",
    })
    expect(dialog.textContent).toContain(
      "The answer in use doesn't change, and every finding listed here is settled: this one, the only one, is marked as seen. Readers get the answer again."
    )
    await user.type(
      within(dialog).getByRole("textbox", { name: /Why not\?/ }),
      "Seen it"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Keep the answer in use" })
    )
    expect(handlers.decide).not.toHaveBeenCalled()
    expect(handlers.onResolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        checkId: "c1",
        slotRevision: 21,
        choose: "keep_in_use",
        reason: "Seen it",
      })
    )
  })

  it("with another disputing finding undecided offers only Mark as seen and Ask for more detail", () => {
    setup(
      view(
        [
          finding({ disputes: true }),
          unknown({
            disputes: true,
            sender: { id: "s9", displayName: "Ana Gurung" },
          }),
        ],
        DISPUTED
      )
    )
    const c = card("Finding from Ana Gurung")
    expect(
      within(c).queryByRole("button", { name: "Keep the answer in use" })
    ).toBeNull()
    expect(within(c).getByRole("button", { name: "Mark as seen" })).toBeTruthy()
    expect(
      within(c).getByRole("button", { name: "Ask for more detail" })
    ).toBeTruthy()
    expect(c.textContent).toContain(
      "Marking it as seen settles this finding only. The other findings here still need a decision."
    )
    expect(c.textContent).not.toContain("only once the other")
  })

  it("with an agreeing proposal also undecided offers no Keep, since Keep settles that one too (M2)", () => {
    setup(
      view(
        [
          finding({ answer: "yes", disputes: false }),
          unknown({
            disputes: true,
            sender: { id: "s9", displayName: "Ana Gurung" },
          }),
        ],
        DISPUTED
      )
    )
    const c = card("Finding from Ana Gurung")
    expect(
      within(c).queryByRole("button", { name: "Keep the answer in use" })
    ).toBeNull()
    expect(within(c).getByRole("button", { name: "Mark as seen" })).toBeTruthy()
    expect(
      within(c).getByRole("button", { name: "Ask for more detail" })
    ).toBeTruthy()
    // Both findings are listed.
    expect(card("Finding from Sam Lee")).toBeTruthy()
  })
})

describe("To confirm: findings that disagree (§6.4)", () => {
  it("decides them as one choice, listing Couldn't establish as also recorded", async () => {
    const a = finding({ answer: "no", disputes: true })
    const b = finding({
      answer: "not_applicable",
      disputes: true,
      sender: { id: "s2", displayName: "Ana Gurung" },
    })
    const u = finding({
      answer: "unknown",
      reason: null,
      unknownPreset: "other",
      triedText: "x",
      sender: { id: "s3", displayName: "Raj Tamang" },
    })
    const { user, handlers } = setup(view([a, b, u], DISPUTED))
    expect(
      screen.getByText(
        "These findings disagree. Choose which one to use, or keep the answer in use."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull()
    expect(
      screen.getAllByRole("button", { name: "Use this answer" })
    ).toHaveLength(2)
    const also = screen.getByRole("region", { name: "Also recorded" })
    expect(
      within(also).getByRole("button", { name: "Mark as seen" })
    ).toBeTruthy()
    await user.click(
      within(card("Finding from Ana Gurung")).getByRole("button", {
        name: "Use this answer",
      })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Use Ana's answer?",
    })
    expect(dialog.textContent).toContain(
      "The other findings are marked Not confirmed with your reason, and any Couldn't-establish findings listed here are marked as seen. Only findings sent after this can disagree with the new answer."
    )
    expect(dialog.textContent).toContain(
      "Everyone who sent a finding sees this."
    )
    await user.type(
      within(dialog).getByRole("textbox", { name: /Why this one\?/ }),
      "Matches the sign"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Use this answer" })
    )
    expect(handlers.onResolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        choose: b.findingRef,
        reason: "Matches the sign",
        slotRevision: 21,
      })
    )
    await user.click(
      screen.getByRole("button", { name: "Keep the answer in use" })
    )
    expect(
      (await screen.findByRole("dialog", { name: "Keep the answer in use?" }))
        .textContent
    ).toContain(
      "Every finding listed here is settled: answers, including any that agree with the answer in use, are marked Not confirmed with your reason, and Couldn't-establish findings are marked as seen."
    )
  })
})

describe("To confirm: answers in use that need a decision", () => {
  it("an unconfirmed answer can be confirmed; Don't confirm says the question is reopened", async () => {
    const f = finding({
      kind: "answer_unconfirmed",
      findingRef: { type: "submission", id: "sub1" },
      answer: "yes",
    })
    const { user, handlers } = setup(
      view([f], {
        ...YES,
        status: "unavailable",
        reason: "not_confirmed",
        detail: "pending",
        confirmation: {
          ...YES.confirmation,
          state: "pending",
          by: null,
          at: null,
        },
      })
    )
    const c = card("Answer in use, not confirmed")
    expect(c.textContent).toContain(
      "This answer is recorded but not confirmed, so readers are told it's awaiting confirmation."
    )
    await user.click(within(c).getByRole("button", { name: "Don't confirm" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Don't confirm this finding?",
    })
    expect(dialog.textContent).toContain(
      "The question is reopened: staff see it as Needs recheck."
    )
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await user.click(within(c).getByRole("button", { name: "Confirm" }))
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        findingRef: { type: "submission", id: "sub1" },
        decision: "confirm",
      })
    )
  })

  it("evidence removed: keep this answer (reaffirm) or reopen", async () => {
    const f = finding({
      kind: "evidence_removed",
      removedEvidence: 1,
      findingRef: { type: "submission", id: "sub2" },
    })
    const { user, handlers, onReopen } = setup(
      view([f], {
        ...YES,
        status: "unavailable",
        reason: "withdrawn",
        detail: "evidence_withdrawn",
        value: "no",
      })
    )
    const c = card("Evidence removed from the answer in use")
    expect(c.textContent).toContain(
      "1 photo attached to this answer was deleted. Readers aren't given the answer until you decide."
    )
    await user.click(within(c).getByRole("button", { name: "Reopen" }))
    expect(onReopen).toHaveBeenCalled()
    await user.click(
      within(c).getByRole("button", { name: "Keep this answer" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Keep this answer?",
    })
    expect(dialog.textContent).toContain(
      "The remaining evidence is enough. Readers get the answer again."
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Keep this answer" })
    )
    expect(handlers.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "reaffirm" })
    )
  })
})

describe("To confirm: refusals (§6.6)", () => {
  it("says someone already decided, and re-reads the page", async () => {
    const { user } = setup(view([finding()]), {
      decide: vi.fn(async () => ({
        ok: false as const,
        code: "already_decided" as const,
        status: 409 as const,
        message: "x",
      })),
    })
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    expect(
      screen.getByText(
        "Someone already decided this finding. Reload to see the result."
      )
    ).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it.each([
    [
      "knowledge_slot_out_of_scope",
      "This question was taken off the question list, so nothing was changed. Reload to see it.",
    ],
    [
      "revision_conflict",
      "This check changed. The page now shows the latest; check whether your decision is there.",
    ],
    [
      "self_confirmation_not_permitted",
      "You sent this, so another manager or an admin confirms it.",
    ],
    [
      "asset_ineligible",
      "This finding's photo was deleted, so it can't be used. Ask for more detail or don't confirm it.",
    ],
  ] as const)("words %s and offers no Try again", async (code, text) => {
    const { user } = setup(view([finding()]), {
      decide: vi.fn(async () => ({
        ok: false as const,
        code,
        status: 409 as const,
        message: "x",
      })),
    })
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("says an archived check can't be decided, and offers no Try again", async () => {
    const { user } = setup(view([finding()]), {
      decide: vi.fn(async () => ({
        ok: false as const,
        code: "state_conflict" as const,
        status: 409 as const,
        message:
          "This check is archived. Restore it first, or reload the page.",
      })),
    })
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    expect(
      screen.getByText(
        "This check is archived. Restore it first, or reload the page."
      )
    ).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("offers Try again with the same request after a lost reply", async () => {
    const decide = vi
      .fn<DecisionHandlers["decide"]>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok)
    const { user } = setup(view([finding()]), { decide })
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    expect(
      screen.getByText(
        "We couldn't confirm your decision was saved. Check your connection and try again; nothing is decided twice."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls[1][0].idempotencyKey).toBe(
      decide.mock.calls[0][0].idempotencyKey
    )
  })
})

describe("the check page on a working-list question", () => {
  it("shows To confirm first, the venue's answer in knowledge words, and says reopening takes the answer out of use", async () => {
    const { AmenityCheckDetail } =
      await import("@/components/nabalens/amenities/manage")
    const { detail, WIFI_CHECK } = await import("./amenities-manage-fixtures")
    const v = view([finding()], YES)
    const user = userEvent.setup()
    render(
      <AmenityCheckDetail
        detail={detail({
          check: { ...WIFI_CHECK, progress: "complete", answer: "yes" },
        })}
        basePath="/manager"
        handlers={{
          assign: vi.fn(),
          setNotes: vi.fn(),
          archive: vi.fn(),
          restore: vi.fn(),
          reopen: vi.fn(),
        }}
        knowledge={{
          view: v,
          handlers: { decide: vi.fn(), onResolveConflict: vi.fn() },
        }}
      />
    )
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent)
    expect(headings[0]).toMatch(/^To confirm/)
    expect(
      screen.getByText("Current answer: Yes. Recorded 3 Nov 2026.")
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Reopen" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Reopen this check",
    })
    expect(dialog.textContent).toContain(
      "goes back to Needs recheck for staff. Its answer stops being used straight away and stays in the history."
    )
    expect(dialog.textContent).not.toContain("The current answer stays")
  })
})

describe("To confirm: recovery and focus (MG-02, MG-04, MG-05, MG-06, MG-11)", () => {
  it("keeps the success notice after the last finding is decided (MG-02)", async () => {
    const f = finding()
    const handlers = {
      decide: vi.fn<DecisionHandlers["decide"]>(async () => ok),
      onResolveConflict: vi.fn<DecisionHandlers["onResolveConflict"]>(
        async () => ok
      ),
    }
    const { rerender } = render(
      <DecisionPanel view={view([f])} handlers={handlers} />
    )
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }))
    // The refresh brings the question with nothing left to decide.
    rerender(<DecisionPanel view={view([])} handlers={handlers} />)
    expect(
      screen.getByText("Confirmed. This is now the answer for The Old Crown.")
    ).toBeTruthy()
    expect(
      screen.getByText("Nothing left to confirm on this question.")
    ).toBeTruthy()
  })

  it("replays the same request when the same decision is tapped again after a lost reply (MG-06)", async () => {
    const decide = vi
      .fn<DecisionHandlers["decide"]>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok)
    const { user } = setup(view([finding()]), { decide })
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    const [first, second] = decide.mock.calls.map((c) => c[0])
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
  })

  it("keeps a typed reason in its dialog when the reply is lost (MG-04)", async () => {
    const decide = vi
      .fn<DecisionHandlers["decide"]>()
      .mockRejectedValue(new TypeError("Failed to fetch"))
    const { user } = setup(view([finding()]), { decide })
    await user.click(screen.getByRole("button", { name: "Don't confirm" }))
    const dialog = await screen.findByRole("dialog")
    const field = within(dialog).getByRole("textbox", { name: /Why not\?/ })
    await user.type(field, "Wrong car park")
    await user.click(
      within(dialog).getByRole("button", { name: "Don't confirm" })
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect((field as HTMLTextAreaElement).value).toBe("Wrong car park")
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "We couldn't confirm your decision was saved."
    )
  })

  it("keeps the note and the dialog open when a confirmation is refused (MG-05)", async () => {
    const decide = vi.fn<DecisionHandlers["decide"]>(async () => ({
      ok: false,
      code: "self_confirmation_not_permitted",
      status: 403,
      message: "refused",
    }))
    const { user } = setup(view([finding({ answer: "no" })], YES), { decide })
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Replace the current answer?",
    })
    const note = within(dialog).getByRole("textbox", { name: /Note/ })
    await user.type(note, "Checked the sign")
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm and replace" })
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect((note as HTMLTextAreaElement).value).toBe("Checked the sign")
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "You sent this, so another manager or an admin confirms it."
    )
  })

  it("puts focus on the To confirm heading after a decision (MG-11)", async () => {
    const { user } = setup(view([finding()]))
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("amenity-to-confirm-title")
    )
  })
})

describe("To confirm: the recorded time of an answer in use (X-07)", () => {
  it("shows the answer's recorded time, and no line when it isn't known", () => {
    const current = finding({
      kind: "answer_unconfirmed",
      findingRef: { type: "submission", id: "sub-x" },
      answer: "yes",
      recordedAt: "2026-11-03T14:05:00.000Z",
    })
    setup(view([current], YES))
    expect(screen.getByText("Recorded 3 Nov 2026, 14:05")).toBeTruthy()
    cleanup()
    setup(view([{ ...current, recordedAt: null, sentAt: "" }], YES))
    expect(screen.queryByText(/^Recorded/)).toBeNull()
    expect(screen.queryByText(/an unknown time/)).toBeNull()
  })
})

describe("To confirm: each finding is an article with two headed lists (MG-15)", () => {
  it("names the article and heads In use now and This finding over their own lists", () => {
    setup(view([finding()]))
    const article = card("Finding from Sam Lee")
    expect(article.closest("li")).toBeTruthy()
    const groups = within(article).getAllByRole("heading", { level: 4 })
    expect(groups.map((h) => h.textContent)).toEqual([
      "In use now",
      "This finding",
    ])
    for (const heading of groups) {
      const list = heading.nextElementSibling
      expect(list?.tagName).toBe("DL")
      expect(
        within(list as HTMLElement).getAllByRole("term").length
      ).toBeGreaterThan(0)
    }
  })
})

describe("To confirm: a policy that still needs something (B03 UI §4.4)", () => {
  const photo = {
    assetId: "a1",
    kind: "photo" as const,
    available: true,
    thumbUrl: null,
    previewUrl: null,
    streamUrl: null,
  }

  it("keeps Confirm unavailable while content is missing, saying why, and still offers more detail", async () => {
    const { user, handlers } = setup(
      view([finding({ answer: "yes", policyMissing: ["zones", "authority"] })])
    )
    const confirm = screen.getByRole("button", { name: "Confirm" })
    expect(confirm.getAttribute("aria-disabled")).toBe("true")
    const why = document.getElementById(
      confirm.getAttribute("aria-describedby")!
    )
    expect(why?.textContent).toBe(
      "Can't confirm yet: it still needs at least one area with its rule."
    )
    await user.click(confirm)
    expect(handlers.decide).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Ask for more detail" })
    ).toBeTruthy()
  })

  it("lets Confirm supply the confirmation when that's all it needs", async () => {
    const { user, handlers } = setup(
      view([finding({ answer: "yes", policyMissing: ["authority"] })])
    )
    const confirm = screen.getByRole("button", { name: "Confirm" })
    expect(confirm.getAttribute("aria-disabled")).toBeNull()
    await user.click(confirm)
    await waitFor(() => expect(handlers.decide).toHaveBeenCalled())
  })

  it("says a staff photo doesn't confirm the policy", () => {
    setup(
      view([
        finding({
          answer: "yes",
          evidence: [photo],
          policyMissing: ["authority", "stated_on"],
        }),
      ])
    )
    expect(
      screen.getByText(
        "This photo shows what Sam saw. It doesn't confirm the policy."
      )
    ).toBeTruthy()
  })

  it("says nothing of policies on other questions", () => {
    setup(view([finding({ answer: "yes", evidence: [photo] })]))
    expect(screen.queryByText(/doesn't confirm the policy/)).toBeNull()
    expect(
      screen
        .getByRole("button", { name: "Confirm" })
        .getAttribute("aria-disabled")
    ).toBeNull()
  })
})

describe("the check page on an incomplete policy (B03 UI §4.3)", () => {
  it("never shows it as confirmed, and lists what it still needs", async () => {
    const { AmenityCheckDetail } =
      await import("@/components/nabalens/amenities/manage")
    const { detail, WIFI_CHECK } = await import("./amenities-manage-fixtures")
    const incomplete: AnswerInUse = {
      ...YES,
      status: "unavailable",
      reason: "not_confirmed",
      detail: "policy_incomplete",
      policyMissing: ["conditions", "stated_on"],
    }
    render(
      <AmenityCheckDetail
        detail={detail({
          check: { ...WIFI_CHECK, progress: "complete", answer: "yes" },
        })}
        basePath="/manager"
        handlers={{
          assign: vi.fn(),
          setNotes: vi.fn(),
          archive: vi.fn(),
          restore: vi.fn(),
          reopen: vi.fn(),
        }}
        knowledge={{
          view: view([], incomplete),
          handlers: { decide: vi.fn(), onResolveConflict: vi.fn() },
        }}
      />
    )
    const note = screen.getByRole("note", {
      name: "What this policy still needs",
    })
    expect(
      within(note)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["at least one condition", "the date it was stated"])
    expect(
      screen.getByText(
        "Not confirmed: it still needs at least one condition and the date it was stated."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/^Current answer/)).toBeNull()
  })
})

describe("a policy question's check page and cards (B03 UI §4.1, §4.4)", () => {
  const POLICY = {
    places: [
      {
        subjectId: "5a000000-0000-4000-8000-000000000001",
        kind: "area" as const,
        label: "⟨Back bar⟩",
        active: true,
      },
    ],
    conditionTypes: [],
    exceptionTypes: [],
  }

  it("reads the policy's rows on its card", () => {
    render(
      <DecisionPanel
        view={view([
          finding({
            answer: "yes",
            policyMissing: ["authority"],
            policyDetail: {
              stance: "allowed",
              zones: [
                {
                  subjectId: "5a000000-0000-4000-8000-000000000001",
                  stance: "allowed",
                },
              ],
            },
          }),
        ])}
        handlers={{ decide: vi.fn(), onResolveConflict: vi.fn() }}
        policy={POLICY}
      />
    )
    const article = screen.getByRole("article")
    expect(within(article).getByText("Rule")).toBeTruthy()
    expect(within(article).getByText("Allowed")).toBeTruthy()
    expect(within(article).getByText("⟨Back bar⟩: Allowed")).toBeTruthy()
  })

  it("offers State the policy instead of Capture myself", async () => {
    const { AmenityCheckDetail } =
      await import("@/components/nabalens/amenities/manage")
    const { detail, WIFI_CHECK } = await import("./amenities-manage-fixtures")
    const props = {
      detail: detail({
        check: {
          ...WIFI_CHECK,
          progress: "complete" as const,
          answer: "yes" as const,
        },
      }),
      basePath: "/manager",
      canUpload: false,
      handlers: {
        assign: vi.fn(),
        setNotes: vi.fn(),
        archive: vi.fn(),
        restore: vi.fn(),
        reopen: vi.fn(),
      },
    }
    const { unmount } = render(
      <AmenityCheckDetail
        {...props}
        knowledge={{
          view: view([], YES),
          handlers: { decide: vi.fn(), onResolveConflict: vi.fn() },
          policy: POLICY,
        }}
      />
    )
    const state = screen.getByRole("link", { name: "State the policy" })
    expect(state.getAttribute("href")).toContain("/capture")
    expect(screen.queryByRole("link", { name: "Capture myself" })).toBeNull()
    expect(screen.queryByText(/attaches photos and videos already/)).toBeNull()
    unmount()
    render(
      <AmenityCheckDetail
        {...props}
        knowledge={{
          view: view([], YES),
          handlers: { decide: vi.fn(), onResolveConflict: vi.fn() },
        }}
      />
    )
    expect(screen.getByRole("link", { name: "Capture myself" })).toBeTruthy()
  })
})

describe("To confirm: Complete the policy (B03 UI §4.4)", () => {
  it("links a policy that can't be confirmed yet to the editor, where the viewer states policies", () => {
    const blocked = finding({
      answer: "yes",
      policyMissing: ["zones"],
      policyDetail: { stance: "allowed" },
    })
    const ready = finding({
      answer: "yes",
      policyMissing: ["authority"],
      policyDetail: { stance: "allowed" },
    })
    render(
      <DecisionPanel
        view={view([blocked, { ...ready, answer: "no" }])}
        handlers={{ decide: vi.fn(), onResolveConflict: vi.fn() }}
        completeHref={(f) =>
          `/manager/amenities/c1/capture?complete=${f.findingRef.id}`
        }
      />
    )
    const links = screen.getAllByRole("link", { name: "Complete the policy" })
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute("href")).toBe(
      `/manager/amenities/c1/capture?complete=${blocked.findingRef.id}`
    )
    // Two findings that disagree: choosing one adopts it, so the incomplete
    // policy can't be chosen either.
    const [first, second] = screen.getAllByRole("button", {
      name: "Use this answer",
    })
    expect(first.getAttribute("aria-disabled")).toBe("true")
    expect(second.getAttribute("aria-disabled")).toBeNull()
  })

  it("offers no link without a place to state the policy", () => {
    render(
      <DecisionPanel
        view={view([finding({ answer: "yes", policyMissing: ["zones"] })])}
        handlers={{ decide: vi.fn(), onResolveConflict: vi.fn() }}
      />
    )
    expect(
      screen.queryByRole("link", { name: "Complete the policy" })
    ).toBeNull()
  })
})

describe("the check page of a schedule in use (B03 UI §5.2, §5.3, §5.5)", () => {
  async function page(answer: AnswerInUse, key = "onsite_parking") {
    const { AmenityCheckDetail } =
      await import("@/components/nabalens/amenities/manage")
    const { detail, WIFI_CHECK } = await import("./amenities-manage-fixtures")
    render(
      <AmenityCheckDetail
        detail={detail({
          check: {
            ...WIFI_CHECK,
            entry: { ...WIFI_CHECK.entry, key },
            progress: "complete",
            answer: "yes",
          },
        })}
        basePath="/manager"
        handlers={{
          assign: vi.fn(),
          setNotes: vi.fn(),
          archive: vi.fn(),
          restore: vi.fn(),
          reopen: vi.fn(),
        }}
        knowledge={{
          view: view([], answer),
          handlers: { decide: vi.fn(), onResolveConflict: vi.fn() },
          schedule: {
            read: { ok: true, occurrences: [] },
            timezone: "Europe/London",
            lastDay: null,
            today: "2026-11-10",
            addException: vi.fn(),
          },
        }}
      />
    )
  }

  it("shows Upcoming, and a change for one date only with the schedule in use's id", async () => {
    await page({ ...YES, scheduleId: "5c000000-0000-4000-8000-000000000001" })
    expect(screen.getByRole("heading", { name: "Upcoming" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Add a change for one date" })
    ).toBeTruthy()
    cleanup()
    await page(YES)
    expect(screen.getByRole("heading", { name: "Upcoming" })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Add a change for one date" })
    ).toBeNull()
  })

  it("keeps the subscription's fixed line on its check page", async () => {
    await page(YES, "sports_subscription")
    expect(
      screen.getByText(
        "Subscriptions only. Having a subscription isn't a promise to show any particular fixture."
      )
    ).toBeTruthy()
  })
})
