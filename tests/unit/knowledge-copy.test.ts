import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  answerInUseLines,
  checkDateBasis,
  checkDateLine,
  captureContextLines,
  dateAndTime,
  dockNote,
  findingExplanation,
  FINDING_STATE_CHIP,
  KNOWLEDGE_ANSWER_LABEL,
  periodMonth,
  policyNeedWords,
  recheckCauseLine,
  policyNotConfirmedLine,
  readerLine,
  recognitionLine,
  replacedOwnLine,
  sentCopy,
  slotRow,
} from "@/components/nabalens/knowledge/copy"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import { todoCount, todoItems } from "@/components/nabalens/tasks/todo-list"
import {
  FINDING_STATES,
  findingKey,
  isRetryable,
  knowledgeAssetsResult,
  type KnowledgeErrorCode,
  type AnswerInUse,
  type FreshnessEntry,
  type FindingSummary,
  type WorkingSlot,
} from "@/lib/knowledge-client/contract"

import { tasksView } from "../ui/tasks-fixtures"

// Short dates add the year outside the current London year (CA-29): these
// expectations are written in 2026.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"))
})
afterAll(() => {
  vi.useRealTimers()
})

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
    checkId: "c1",
    key: "onsite_parking",
    question: "Is there parking on site?",
    category: "Arrival",
    evidenceRule: "photo",
    progress: "needs_capture",
    slotRevision: 4,
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

function finding(over: Partial<FindingSummary> = {}): FindingSummary {
  return {
    findingRef: { type: "contribution", id: "f1" },
    checkId: "c1",
    question: "Is there parking on site?",
    venue: { id: "v1", name: "The Old Crown" },
    answer: "yes",
    kind: "finding",
    state: "awaiting_confirmation",
    noLongerUsed: null,
    stateReason: null,
    managerNote: null,
    detailRequestId: null,
    unknownPreset: null,
    answeredBy: null,
    sentAt: "2026-11-05T10:00:00.000Z",
    savedAt: null,
    decidedAt: null,
    recognition: { kind: "pending" },
    ...over,
  }
}

describe("knowledge words", () => {
  it("calls an unknown finding Couldn't establish, never a legacy word", () => {
    expect(KNOWLEDGE_ANSWER_LABEL.unknown).toBe("Couldn't establish")
    expect(Object.values(KNOWLEDGE_ANSWER_LABEL)).not.toContain(
      "Needs verification"
    )
    expect(CHIP_STATES.unknown.word).toBe("Needs verification")
    expect(CHIP_STATES.couldnt_establish.word).toBe("Couldn't establish")
    expect(CHIP_STATES.to_check.word).toBe("To check")
  })

  it("has one chip word per finding state", () => {
    const words = FINDING_STATES.map(
      (state) => CHIP_STATES[FINDING_STATE_CHIP[state]].word
    )
    expect(words).toEqual([
      "Saved",
      "Submitted",
      "Awaiting confirmation",
      "Current answer",
      "Needs attention",
      "Not confirmed",
      "No longer in use",
      "Closed",
    ])
  })

  it("keys findings by type and id, and retries only unavailable", () => {
    expect(findingKey({ type: "submission", id: "s9" })).toBe("submission:s9")
    expect(isRetryable("unavailable")).toBe(true)
    for (const code of [
      "knowledge_path_required",
      "knowledge_slot_out_of_scope",
      "already_decided",
      "self_confirmation_not_permitted",
      "draft_conflict",
    ] as const)
      expect(isRetryable(code)).toBe(false)
    expect(isRetryable("revision_conflict")).toBe(false)
  })

  it("formats months and times in London", () => {
    expect(periodMonth("2026-11")).toBe("November")
    expect(dateAndTime("2026-07-01T13:05:00.000Z")).toBe("1 Jul 2026, 14:05")
  })
})

describe("the venue's answer", () => {
  const lines = (answer: AnswerInUse, over: Partial<WorkingSlot> = {}) =>
    answerInUseLines(answer, slot(over))

  it("shows a save date, never a checked date", () => {
    expect(lines(YES)).toEqual(["Current answer: Yes. Recorded 3 Nov 2026."])
    expect(lines(YES).join(" ")).not.toMatch(/checked/i)
  })

  it("words every unavailable reason", () => {
    const at = (reason: AnswerInUse["reason"], detail: AnswerInUse["detail"]) =>
      lines(
        { ...YES, status: "unavailable", reason, detail },
        { previousAnswer: "yes" }
      )
    expect(at("disputed", "conflict")).toEqual([
      "Recorded answer: Yes. Being checked: a finding disagrees with it.",
    ])
    expect(at("not_confirmed", "pending")).toEqual([
      "Recorded answer: Yes. Awaiting confirmation.",
    ])
    expect(at("stale", "recheck_requested")).toEqual([
      "No answer in use: reopened.",
      "Previous answer: Yes.",
    ])
    expect(at("withdrawn", "evidence_withdrawn")).toEqual([
      "Recorded answer: Yes. Not in use: its evidence was removed.",
    ])
    expect(at("withdrawn", "confirmation_revoked")).toEqual([
      "Recorded answer: Yes. Not in use: its confirmation was withdrawn.",
    ])
    expect(
      lines(
        { ...NONE, detail: "unable_to_establish" },
        {
          latestAttempt: {
            preset: "could_not_access",
            at: "2026-11-05T10:00:00Z",
          },
        }
      )
    ).toEqual(["To check. Last try: couldn't establish (couldn't get to it)."])
    expect(lines(NONE)).toEqual(["To check."])
  })

  it("reads a detail it doesn't know as needs checking, never blank or Yes", () => {
    // A newer server's resolver details (B03 qualified answers, check dates).
    for (const detail of [
      "qualified_answer",
      "basis_missing",
      "schema_changed",
      "policy_incomplete",
    ]) {
      const answer = {
        ...YES,
        status: "unavailable",
        reason: "stale",
        detail,
      } as unknown as AnswerInUse
      expect(lines(answer, { previousAnswer: "yes" })).toEqual([
        "No answer in use: needs checking.",
        "Previous answer: Yes.",
      ])
      expect(lines(answer)).toEqual(["No answer in use: needs checking."])
      const row = slotRow(slot({ answerInUse: answer, previousAnswer: "yes" }))
      expect(row.status).toContain("No answer in use: needs checking.")
      expect(row.status).not.toMatch(/Current answer: Yes/)
    }
  })

  it("tells managers what readers get", () => {
    expect(
      readerLine({
        ...YES,
        status: "unavailable",
        reason: "disputed",
        detail: "conflict",
      })
    ).toBe("Readers are told the answer is being checked.")
    expect(readerLine(YES)).toBe("Readers get the current answer.")
  })
})

describe("a finding's state and recognition", () => {
  it("never says Saved for a sent finding", () => {
    for (const state of FINDING_STATES.filter((s) => s !== "saved"))
      expect(findingExplanation(finding({ state }))).not.toMatch(
        /^Saved|Not sent/
      )
    expect(findingExplanation(finding({ state: "saved" }))).toBe(
      "Not sent yet. Only you can see it."
    )
  })

  it("says a different answer is being checked, not that the answer stays in use", () => {
    const text = findingExplanation(finding(), "differs")
    expect(text).toBe(
      "Sent. The recorded answer is marked as being checked until your manager decides."
    )
    expect(text).not.toMatch(/stays in use/)
    expect(findingExplanation(finding(), "same")).toBe(
      "Sent. It agrees with the recorded answer; your manager confirms it."
    )
  })

  it("promises no credit", () => {
    expect(recognitionLine({ kind: "scored", period: "2026-11" }, "yes")).toBe(
      "Counted in your November target."
    )
    expect(recognitionLine({ kind: "not_scored" }, "unknown")).toBe(
      "Couldn't-establish findings don't count toward targets."
    )
    expect(recognitionLine({ kind: "not_scored" }, "no")).toBeNull()
    expect(recognitionLine({ kind: "pending" }, "yes")).toBeNull()
    expect(recognitionLine({ kind: "none" }, "yes")).toBeNull()
  })
})

describe("after sending", () => {
  it("says an automatic answer is the venue's answer (D11)", () => {
    expect(
      sentCopy({
        outcome: "current",
        answer: "yes",
        compared: "none",
        changeReport: false,
      }).status
    ).toBe("Finding sent. It's now the venue's answer.")
  })

  it("words proposals by what they do to the answer in use (D1)", () => {
    const proposal = (
      compared: "none" | "differs" | "same",
      changeReport = false
    ) =>
      sentCopy({
        outcome: "awaiting_confirmation",
        answer: "no",
        compared,
        changeReport,
      }).status
    expect(proposal("none")).toBe(
      "Finding sent. Your manager confirms it before it's used."
    )
    expect(proposal("differs", true)).toBe(
      "Change report sent. Until your manager decides, the recorded answer is marked as being checked."
    )
    expect(proposal("same")).toBe(
      "Finding sent. It agrees with the recorded answer; your manager confirms it."
    )
    expect(
      sentCopy({
        outcome: "recorded",
        answer: "unknown",
        compared: "differs",
        changeReport: true,
      }).status
    ).toBe("Recorded: couldn't establish. The question stays open.")
  })

  it("words a manager's self-confirmation choice (D4)", () => {
    expect(
      sentCopy({
        outcome: "current",
        answer: "yes",
        compared: "none",
        changeReport: false,
        selfConfirmed: true,
      }).status
    ).toBe("Finding sent and confirmed by you. It's now the venue's answer.")
    expect(
      sentCopy({
        outcome: "awaiting_confirmation",
        answer: "yes",
        compared: "none",
        changeReport: false,
        leftForOthers: true,
      }).status
    ).toBe(
      "Finding sent. It waits for another manager or an admin to confirm it."
    )
  })
})

describe("capture context", () => {
  const context = (
    over: Partial<WorkingSlot>,
    role: "staff" | "manager" = "staff"
  ) =>
    captureContextLines({ venueName: "The Old Crown", slot: slot(over), role })

  it("says before sending that a confirmation-free answer is used straight away (D11)", () => {
    expect(context({})).toEqual([
      "You're answering for The Old Crown.",
      "No one needs to confirm this question. What you send becomes the venue's answer straight away.",
    ])
    expect(dockNote(slot(), "staff")).toBe(
      "This becomes the venue's answer when you send it."
    )
  })

  it("names only the assignee and counts other people's findings (D3)", () => {
    const lines = context({
      assignee: { firstName: "Priya", isMe: false },
      othersPending: 2,
    })
    expect(lines).toContain(
      "Priya is assigned. What you send goes to your manager to confirm; it doesn't take over their check."
    )
    expect(lines).toContain(
      "2 other findings are waiting. Your manager will compare them."
    )
    expect(context({ othersPending: 1 })).toEqual([
      "You're answering for The Old Crown.",
      "Someone else also sent a finding. Your manager will compare them.",
    ])
  })

  it("explains a change report without promising the answer stays in use (D1)", () => {
    const lines = context({ mode: "change", answerInUse: YES })
    expect(lines[1]).toBe(
      "Current answer: Yes, recorded 3 Nov 2026. If you send a different answer, it's marked as being checked until your manager decides. It isn't replaced unless your manager confirms your change."
    )
    expect(lines.join(" ")).not.toMatch(/stays in use/)
    expect(dockNote(slot({ mode: "change", answerInUse: YES }), "staff")).toBe(
      "Your manager confirms this before it's used."
    )
  })

  it("says step-free answers are confirmed (D7)", () => {
    expect(
      context({ key: "step_free_entrance", requiresConfirmation: true })[1]
    ).toBe(
      "Your manager confirms answers to this question before they're used."
    )
  })
})

describe("Home rows", () => {
  it("keeps the assignee informed when someone else answered", () => {
    const row = slotRow(
      slot({
        assignee: { firstName: "Sam", isMe: true },
        answerInUse: YES,
        closedAssignment: {
          eventId: 1,
          answeredBy: "Priya Gurung",
          at: "2026-11-05T10:00:00Z",
        },
      })
    )
    expect(row.status).toBe(
      "Answered by Priya Gurung on 5 Nov. Your assignment is closed; nothing more to do."
    )
    expect(row).toMatchObject({
      action: null,
      dismissable: true,
      chip: { state: "closed" },
    })
  })

  it("counts only work that needs me", () => {
    expect(
      slotRow(slot({ assignee: { firstName: "Sam", isMe: true } }))
    ).toMatchObject({
      action: "Start check",
      needsMe: true,
    })
    expect(slotRow(slot())).toMatchObject({
      action: "Answer this",
      needsMe: false,
    })
    expect(
      slotRow(slot({ myDraft: { savedAt: "2026-11-05T10:00:00Z" } }))
    ).toMatchObject({
      chip: { state: "saved" },
      action: "Finish",
      needsMe: false,
    })
    expect(
      slotRow(
        slot({
          myLatest: finding({
            state: "needs_attention",
            managerNote: "Show the ramp",
          }),
        })
      )
    ).toMatchObject({
      status: "Your manager asked: Show the ramp",
      action: "Add detail",
      needsMe: true,
    })
  })

  it("never names another person's pending finding to staff (D3)", () => {
    const row = slotRow(
      slot({ assignee: { firstName: "Sam", isMe: true }, othersPending: 1 })
    )
    expect(row.status).toBe(
      "Assigned to you. Someone else also sent a finding; your manager will compare them."
    )
  })

  it("offers a change on an answer in use, and shows a dispute", () => {
    expect(slotRow(slot({ answerInUse: YES, mode: "change" }))).toMatchObject({
      chip: { state: "current_answer" },
      status: "Current answer: Yes. Recorded 3 Nov 2026.",
      action: "Report a change",
    })
    expect(
      slotRow(
        slot({
          mode: "change",
          answerInUse: {
            ...YES,
            status: "unavailable",
            reason: "disputed",
            detail: "conflict",
          },
        })
      ).status
    ).toBe("Recorded answer: Yes. Being checked: a finding disagrees with it.")
  })
})

describe("replacedOwnLine", () => {
  it("says when the replaced finding was sent, never saved", () => {
    expect(replacedOwnLine("2026-11-04T10:00:00.000Z")).toBe(
      "Your earlier finding, sent 4 Nov, was replaced."
    )
    expect(replacedOwnLine(null)).toBe("Your earlier finding was replaced.")
  })
})

describe("knowledgeAssetsResult (F1)", () => {
  it("passes the own-media list through unchanged", () => {
    const assets = [
      {
        assetId: "a1",
        kind: "photo" as const,
        createdAt: "2026-11-05T10:00:00.000Z",
        source: "own" as const,
        thumbUrl: "/api/media/a1/thumb",
      },
    ]
    expect(knowledgeAssetsResult({ ok: true, assets })).toEqual({
      ok: true,
      assets,
    })
  })

  it("keeps amenity failure codes and reads knowledge-only ones as a state conflict", () => {
    const fail = (code: KnowledgeErrorCode) =>
      knowledgeAssetsResult({ ok: false, code, status: 409, message: "m" })
    expect(fail("knowledge_slot_out_of_scope")).toMatchObject({
      ok: false,
      code: "knowledge_slot_out_of_scope",
      message: "m",
    })
    expect(fail("already_decided")).toMatchObject({ code: "state_conflict" })
  })
})

describe("slotRow: an assignee who already sent (HM-01, HM-02)", () => {
  const assigned = { assignee: { firstName: "Sam", isMe: true } }

  it("doesn't ask an assignee to start a check whose finding awaits confirmation", () => {
    const row = slotRow(
      slot({
        ...assigned,
        myLatest: finding({ state: "awaiting_confirmation" }),
      })
    )
    expect(row).toMatchObject({
      chip: { state: "awaiting_confirmation" },
      action: "View",
      needsMe: false,
    })
    expect(row.status).toBe(
      "You sent a finding. Your manager confirms it before it's used."
    )
  })

  it("offers an assignee's saved draft before Start check, and still counts it", () => {
    const row = slotRow(
      slot({ ...assigned, myDraft: { savedAt: "2026-11-06T09:30:00.000Z" } })
    )
    expect(row).toMatchObject({
      chip: { state: "saved" },
      action: "Finish",
      needsMe: true,
    })
    expect(
      slotRow(slot({ myDraft: { savedAt: "2026-11-06T09:30:00.000Z" } }))
        .needsMe
    ).toBe(false)
  })

  it('never ends on "Your manager asked:" with nothing after it', () => {
    expect(
      slotRow(
        slot({
          myLatest: finding({ state: "needs_attention", managerNote: null }),
        })
      ).status
    ).toBe("Your manager asked for more detail.")
  })

  it("leaves an awaiting check out of To do and the badge", () => {
    const awaiting = slot({
      ...assigned,
      checkId: "c-sent",
      myLatest: finding({ state: "awaiting_confirmation" }),
    })
    const items = todoItems(
      tasksView(),
      new Date(),
      0,
      [{ id: "c-sent" } as never, { id: "c-open" } as never],
      [awaiting]
    )
    const amenity = items.find((item) => item.kind === "amenity")
    expect(
      amenity && "checks" in amenity ? amenity.checks.map((c) => c.id) : []
    ).toEqual(["c-open"])
    expect(todoCount(items)).toBe(1)
  })
})

describe("qualified answers (B03 UI design §2.5)", () => {
  const COND: AnswerInUse = {
    ...YES,
    status: "unavailable",
    reason: "stale",
    detail: "qualified_answer",
    qualified: { qualifier: "conditional", until: null, note: null },
  }
  const AWAY: AnswerInUse = {
    ...COND,
    qualified: {
      qualifier: "temporarily_unavailable",
      until: "2026-11-20",
      note: null,
    },
  }
  const lines = (answer: AnswerInUse, over: Partial<WorkingSlot> = {}) =>
    answerInUseLines(answer, slot({ previousAnswer: "yes", ...over }))

  it("shows the qualifier only for a qualified_answer status, never a bare Yes", () => {
    expect(lines(COND)).toEqual(["Current answer: Allowed with conditions."])
    expect(lines(AWAY)).toEqual(["Temporarily unavailable until 20 Nov 2026."])
    expect(
      lines({
        ...AWAY,
        qualified: { ...AWAY.qualified!, until: null, note: "⟨Note⟩" },
      })
    ).toEqual(["Temporarily unavailable: ⟨Note⟩"])
    expect(lines(COND).join(" ")).not.toMatch(/\bYes\b/)
  })

  it("keeps needs checking when the qualified object is missing", () => {
    expect(lines({ ...COND, qualified: null })).toEqual([
      "No answer in use: needs checking.",
      "Previous answer: Yes.",
    ])
  })

  it("lets any other status win, with the qualified answer as the previous answer", () => {
    // A qualified answer that is also past its check date.
    expect(lines({ ...COND, detail: "expired" })).toEqual([
      "No answer in use: it needs checking again.",
      "Previous answer: Allowed with conditions.",
    ])
    expect(
      lines({ ...AWAY, reason: "withdrawn", detail: "answer_withdrawn" })
    ).toEqual(["Recorded answer: Temporarily unavailable. Not in use."])
    expect(lines({ ...COND, reason: "disputed", detail: "conflict" })).toEqual([
      "Recorded answer: Allowed with conditions. Being checked: a finding disagrees with it.",
    ])
    for (const detail of ["expired", "answer_withdrawn", "conflict"] as const)
      expect(lines({ ...COND, detail }).join(" ")).not.toMatch(
        /Current answer|\bYes\b/
      )
  })

  it("a staff row says Check again for an assignee and is never To do", () => {
    const mine = slotRow(
      slot({
        answerInUse: COND,
        progress: "needs_recheck",
        assignee: { firstName: "⟨Name⟩", isMe: true },
      })
    )
    expect(mine).toMatchObject({
      chip: { word: "Allowed with conditions", tone: "attention" },
      status: "Current answer: Allowed with conditions. Assigned to you.",
      action: "Check again",
      needsMe: false,
    })
    const theirs = slotRow(slot({ answerInUse: AWAY, mode: "change" }))
    expect(theirs).toMatchObject({
      chip: { word: "Temporarily unavailable" },
      action: "Report a change",
      needsMe: false,
    })
    // Another status wins: no qualifier chip.
    const expired = slotRow(
      slot({
        answerInUse: { ...COND, detail: "expired" },
        previousAnswer: "yes",
      })
    )
    expect(expired.chip).not.toMatchObject({ word: "Allowed with conditions" })
    expect(expired.status).toContain(
      "Previous answer: Allowed with conditions."
    )
  })

  it("the change-mode capture context names the qualifier, not Yes", () => {
    const text = captureContextLines({
      venueName: "⟨Venue⟩",
      slot: slot({ answerInUse: COND, mode: "change" }),
      role: "staff",
    }).join(" ")
    expect(text).toContain("Current answer: Allowed with conditions")
    expect(text).not.toMatch(/Current answer: Yes/)
  })
})

describe("what a policy still needs (B03 UI design §4.3)", () => {
  it("words each code in the server's order, and a code it doesn't know", () => {
    expect(
      policyNeedWords([
        "stance",
        "conditions",
        "zones",
        "authority",
        "stated_on",
        "unrecognised",
      ])
    ).toEqual([
      "a rule (not Couldn't establish)",
      "at least one condition",
      "at least one area with its rule",
      "confirmation by a venue manager, with where it was stated",
      "the date it was stated",
      "something this screen can't name; reload to see it",
    ])
    expect(policyNeedWords(["authority"], { admin: true })).toEqual([
      "confirmation by an admin, with where it was stated",
    ])
  })

  it("says Not confirmed with what's missing, and nothing when complete", () => {
    expect(policyNotConfirmedLine(["zones", "stated_on"])).toBe(
      "Not confirmed: it still needs at least one area with its rule and the date it was stated."
    )
    expect(policyNotConfirmedLine([])).toBeNull()
    expect(policyNotConfirmedLine(undefined)).toBeNull()
  })

  it("never shows an incomplete policy in use as an answer", () => {
    const answer: AnswerInUse = {
      ...YES,
      status: "unavailable",
      reason: "not_confirmed",
      detail: "policy_incomplete",
      policyMissing: ["authority"],
    }
    expect(answerInUseLines(answer, slot())).toEqual([
      "Not confirmed: it still needs confirmation by a venue manager, with where it was stated.",
    ])
    expect(
      answerInUseLines({ ...answer, policyMissing: undefined }, slot())
    ).toEqual(["No answer in use: needs checking."])
    expect(
      slotRow(
        slot({
          answerInUse: answer,
          progress: "needs_recheck",
          assignee: { firstName: "⟨Name⟩", isMe: true },
        })
      )
    ).toMatchObject({
      chip: { state: "not_confirmed" },
      action: "View",
      needsMe: false,
    })
  })
})

describe("recheck causes (B03 UI §6.2)", () => {
  it("words every cause, with the date and previous answer where they apply", () => {
    const at = "2026-11-18T00:00:00.000Z"
    const line = (
      cause: Parameters<typeof recheckCauseLine>[0]["cause"],
      o = {}
    ) => recheckCauseLine({ cause, dueAt: at }, o)
    expect(line("due_soon")).toBe(
      "Due for a check by 18 Nov 2026. The current answer stays in use until then."
    )
    expect(line("expired", { previous: "Yes" })).toBe(
      "Past its check date since 18 Nov 2026. Previous answer: Yes."
    )
    expect(line("basis_missing")).toBe(
      "It was sent without the day it was checked. Check it and add the date."
    )
    expect(line("basis_missing", { policy: true })).toBe(
      "It was sent without the date the policy was stated. Check it and add the date."
    )
    expect(line("schedule_ended")).toBe(
      "Its last day offered was 18 Nov 2026. Check whether it continues."
    )
    expect(line("temporary_until_passed")).toBe(
      "It was temporarily unavailable until 18 Nov 2026. Check whether it's back."
    )
    expect(line("evidence_lost")).toBe("Its photo was deleted. Check it again.")
    expect(line("schema_changed")).toBe(
      "This question now asks for more detail. Check it again."
    )
    expect(line("scope_changed")).toBe(
      "A new entrance was listed after this answer was sent. Check it."
    )
  })
})

describe("check dates (B03 UI design §6.1)", () => {
  const entry = (over: Partial<FreshnessEntry> = {}): FreshnessEntry => ({
    use: "internal",
    state: "current",
    nextCheckDue: "2027-02-08",
    basis: "observed_on",
    basisDate: "2026-11-10",
    ...over,
  })

  it("words each state for staff and internal tools, and never the public use", () => {
    expect(checkDateLine(entry())).toBe(
      "For staff and internal tools: up to date. Next check due 8 Feb 2027."
    )
    expect(checkDateLine(entry({ state: "due_soon" }))).toBe(
      "For staff and internal tools: due for a check by 8 Feb 2027."
    )
    expect(checkDateLine(entry({ state: "expired" }))).toBe(
      "For staff and internal tools: past its check date since 8 Feb 2027. Not in use for this until it's checked again."
    )
    expect(checkDateLine(entry({ state: "basis_missing" }))).toBe(
      "For staff and internal tools: not in use, because it was sent without the day it was checked."
    )
    expect(
      checkDateLine(entry({ state: "basis_missing" }), { policy: true })
    ).toBe(
      "For staff and internal tools: not in use, because it was sent without the date the policy was stated."
    )
    expect(checkDateLine(entry({ use: "public" }))).toBeNull()
    expect(checkDateLine(entry({ state: "unrated" }))).toBeNull()
  })

  it("says what it counts from", () => {
    expect(checkDateBasis(entry())).toBe(
      "Counted from the day it was checked (10 Nov 2026)"
    )
    expect(checkDateBasis(entry({ basis: "stated_on" }))).toBe(
      "Counted from the day the policy was stated (10 Nov 2026)"
    )
    expect(checkDateBasis(entry({ basis: "event_end" }))).toBe(
      "Ends when the event ends"
    )
  })
})

describe("an author's answer that was corrected or withdrawn (B03 UI §8.2, A15)", () => {
  it("says a manager or an admin took it out of use, with their reason and no name", () => {
    expect(
      findingExplanation(
        finding({
          state: "no_longer_used",
          noLongerUsed: "corrected",
          stateReason: "⟨Reason⟩",
        })
      )
    ).toBe("No longer in use: a manager or an admin corrected it. ⟨Reason⟩")
    expect(
      findingExplanation(
        finding({
          state: "no_longer_used",
          noLongerUsed: "withdrawn",
          stateReason: null,
        })
      )
    ).toBe("No longer in use: a manager or an admin withdrew it.")
  })
})
