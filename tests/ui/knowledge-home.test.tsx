// @vitest-environment jsdom
import { cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { sentNoticeFor } from "@/components/nabalens/knowledge/copy"
import type {
  AnswerInUse,
  FindingSummary,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

afterEach(cleanup)

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

describe("sentNoticeFor (§4.3)", () => {
  const sent = (over: Partial<FindingSummary>, s: Partial<WorkingSlot> = {}) =>
    sentNoticeFor(slot({ myLatest: finding(over), ...s }))

  it("says it's the venue's answer, with the target line only when it counted", () => {
    expect(
      sent({
        state: "current",
        recognition: { kind: "scored", period: "2026-11" },
      })
    ).toMatchObject({
      title: "Finding sent",
      body: "It's now the venue's answer.",
      tone: "positive",
      extra: "Counted in your November target.",
    })
    expect(
      sent({ state: "current", recognition: { kind: "not_scored" } })
    ).toMatchObject({ extra: null })
  })

  it("tells a change report from a finding that agrees", () => {
    expect(sent({ answer: "no" }, { answerInUse: YES })).toMatchObject({
      title: "Change report sent",
      tone: "info",
    })
    expect(sent({ answer: "yes" }, { answerInUse: YES })).toMatchObject({
      body: "It agrees with the recorded answer; your manager confirms it.",
    })
    expect(sent({})).toMatchObject({
      body: "Your manager confirms it before it's used.",
    })
  })

  it("records Couldn't establish, announces added detail, and a newer draft", () => {
    expect(sent({ answer: "unknown", state: "submitted" })).toMatchObject({
      title: "Recorded",
      tone: "plain",
    })
    expect(sent({ kind: "detail" })).toMatchObject({ title: "Detail sent" })
    expect(
      sent({}, { myDraft: { savedAt: "2026-11-06T10:00:00.000Z" } })
    ).toMatchObject({ title: "Saved for later", tone: "plain" })
  })

  it("says nothing when the finding isn't in a sent state any more", () => {
    expect(sent({ state: "needs_attention" })).toBeNull()
    expect(sent({ state: "no_longer_used" })).toBeNull()
    expect(sentNoticeFor(slot())).toBeNull()
  })
})
