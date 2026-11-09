import { describe, expect, it } from "vitest"

import {
  adaptCheck,
  adaptDecision,
  adaptDraft,
  adaptFindingsPage,
  adaptSlot,
  adaptSubmitted,
  adaptToConfirm,
  adaptWorkingList,
} from "@/lib/knowledge-client/adapt"
import type {
  KnowledgeCheckView,
  KnowledgeSlotView,
  MyFindingView,
  PendingFindingView,
  ToConfirmItem,
} from "@/lib/knowledge/contract"

const CHECK = "8a000000-0000-4000-8000-000000000101"

function slot(over: Partial<KnowledgeSlotView> = {}): KnowledgeSlotView {
  return {
    checkId: CHECK,
    venueId: "v1",
    questionKey: "onsite_parking",
    question: "Is there parking on site?",
    category: "Arrival",
    evidenceRule: "photo",
    captureBrief: null,
    inScope: true,
    slotRevision: 9,
    status: "available",
    reason: null,
    detail: null,
    progress: "complete",
    checkStatus: "active",
    answerInUse: {
      value: "yes",
      available: true,
      reason: null,
      savedAt: "2026-11-03T14:05:00.000Z",
      sentAt: "2026-11-03T14:00:00.000Z",
      lastCheckedAt: null,
      confirmed: false,
      confirmationState: "not_required",
      evidenceState: "complete",
    },
    previousAnswer: null,
    requiresConfirmation: false,
    latestAttempt: null,
    assignee: { id: "u-secret", firstName: "Priya", isMe: false },
    mode: "change",
    othersPending: 1,
    myLatest: null,
    myDraft: null,
    closedAssignment: null,
    ...over,
  }
}

function pending(over: Partial<PendingFindingView> = {}): PendingFindingView {
  return {
    findingRef: { type: "contribution", id: "f1" },
    kind: "change_report",
    answer: "no",
    finding: null,
    limitations: null,
    reason: "Residents only",
    unknownPreset: null,
    triedText: null,
    changeReason: "Barrier added",
    sentAt: "2026-11-05T10:00:00.000Z",
    senderId: "s1",
    senderName: "Sam Lee",
    senderAssigned: false,
    isMine: false,
    detailRequested: false,
    detailRequest: null,
    wifi: null,
    evidence: [
      { assetId: "a1", kind: "photo", available: true },
      { assetId: "a2", kind: "video", available: true },
      { assetId: "a3", kind: "photo", available: false },
    ],
    ...over,
  }
}

function check(over: Partial<KnowledgeCheckView> = {}): KnowledgeCheckView {
  return {
    ...slot(),
    permissions: {
      canContribute: false,
      canReportChange: false,
      canConfirm: true,
      canSelfConfirm: false,
      canRequestDetail: true,
      canDecline: true,
    },
    pending: [pending()],
    ...over,
  }
}

const mine = (over: Partial<MyFindingView> = {}): MyFindingView => ({
  findingRef: { type: "contribution", id: "m1" },
  checkId: CHECK,
  venueId: "v1",
  venueName: "The Old Crown",
  questionKey: "onsite_parking",
  question: "Is there parking on site?",
  kind: "finding",
  answer: "yes",
  sentAt: "2026-11-05T10:00:00.000Z",
  state: "awaiting_confirmation",
  recognition: { kind: "pending" },
  ...over,
})

describe("knowledge adapter: the question", () => {
  it("passes on only the assignee's first name to the screens", () => {
    const view = adaptSlot(slot())
    expect(view.assignee).toEqual({ firstName: "Priya", isMe: false })
    expect(JSON.stringify(view)).not.toContain("u-secret")
  })

  it("keeps the resolver's status and reason, and reads not-enabled as out of scope", () => {
    expect(
      adaptSlot(
        slot({ status: "unavailable", reason: "disputed", detail: "conflict" })
      ).answerInUse
    ).toMatchObject({
      status: "unavailable",
      reason: "disputed",
      detail: "conflict",
      value: "yes",
    })
    expect(
      adaptSlot(
        slot({
          status: "unavailable",
          reason: "not_enabled",
          detail: null,
          answerInUse: null,
        })
      ).answerInUse
    ).toMatchObject({
      reason: "not_enabled",
      detail: "not_enabled",
      value: null,
    })
    expect(
      adaptSlot(slot({ detail: "something_new" })).answerInUse.detail
    ).toBeNull()
  })

  it("marks a different answer as disputing, maps evidence to its routes, and adds the answers that need a decision", () => {
    const toConfirm: ToConfirmItem[] = [
      {
        checkId: CHECK,
        questionKey: "onsite_parking",
        question: "Is there parking on site?",
        findingRef: { type: "submission", id: "sub1" },
        kind: "evidence_withdrawn",
        answer: "yes",
        senderName: null,
        sentAt: null,
        slotRevision: 9,
        conflict: false,
        disputes: false,
      },
      {
        checkId: "another-check",
        questionKey: "guest_toilets",
        question: "Toilets?",
        findingRef: { type: "submission", id: "sub2" },
        kind: "answer_awaiting_confirmation",
        answer: "no",
        senderName: null,
        sentAt: null,
        slotRevision: 3,
        conflict: false,
        disputes: false,
      },
    ]
    const view = adaptCheck(
      check({
        pending: [
          pending(),
          pending({
            findingRef: { type: "contribution", id: "f2" },
            answer: "yes",
            detailRequested: true,
          }),
        ],
      }),
      "The Old Crown",
      toConfirm
    )
    if (!view.inScope) throw new Error("in scope")
    expect(view.venue).toEqual({ id: "v1", name: "The Old Crown" })
    expect(
      view.pending.map((p) => [p.findingRef.id, p.kind, p.disputes])
    ).toEqual([
      ["sub1", "evidence_removed", false],
      ["f1", "change_report", true],
      ["f2", "change_report", false],
    ])
    const [, first, second] = view.pending
    expect(first.sender).toEqual({ id: "s1", displayName: "Sam Lee" })
    expect(first.evidence).toEqual([
      expect.objectContaining({
        assetId: "a1",
        thumbUrl: "/api/amenities/evidence/a1/thumb",
        streamUrl: null,
      }),
      expect.objectContaining({
        assetId: "a2",
        streamUrl: "/api/amenities/evidence/a2/stream",
      }),
      expect.objectContaining({
        assetId: "a3",
        thumbUrl: null,
        available: false,
      }),
    ])
    expect(second.detailRequest).toEqual({
      decisionId: null,
      note: null,
      at: null,
    })
  })

  it("reports a question off the working list as out of scope", () => {
    expect(adaptCheck(check({ inScope: false }), "The Old Crown")).toEqual({
      inScope: false,
    })
  })

  it("lists only in-scope slots, and no list without a venue", () => {
    expect(
      adaptWorkingList({
        venue: { id: "v1", name: "The Old Crown" },
        items: [slot(), slot({ checkId: "x", inScope: false })],
      })?.slots.map((s) => s.checkId)
    ).toEqual([CHECK])
    expect(adaptWorkingList({ venue: null, items: [] })).toBeNull()
  })
})

describe("knowledge adapter: history, drafts and results", () => {
  it("names drafts from the server, and keeps closed assignments", () => {
    const page = adaptFindingsPage(
      {
        items: [
          mine({ state: "no_longer_used", stateReason: "replaced_by_own" }),
          mine({
            state: "not_confirmed",
            managerNote: "Wrong car park",
            findingRef: { type: "contribution", id: "m2" },
          }),
          {
            kind: "assignment_closed",
            state: "assignment_closed",
            checkId: CHECK,
            venueId: "v1",
            questionKey: "onsite_parking",
            question: "Is there parking on site?",
            answeredBy: "Maya Rai",
            sentAt: "2026-11-06T09:00:00.000Z",
          },
        ],
        drafts: [
          {
            checkId: CHECK,
            venueId: "v1",
            venueName: "The Old Crown",
            questionKey: "onsite_parking",
            question: "Is there parking on site?",
            savedAt: "2026-11-06T08:00:00.000Z",
            sendable: true,
          },
          {
            checkId: "old",
            venueId: "v0",
            venueName: "The Swan",
            questionKey: "step_free_entrance",
            question: "Is the entrance step-free?",
            savedAt: "2026-10-01T08:00:00.000Z",
            sendable: false,
          },
        ],
        nextCursor: null,
        hiddenEarlierVenues: [],
      },
      new Map([
        [
          CHECK,
          { question: "Is there parking on site?", venueName: "The Old Crown" },
        ],
      ])
    )
    expect(
      page.items.map((i) => [i.state, i.question, i.sendable ?? null])
    ).toEqual([
      ["saved", "Is there parking on site?", true],
      ["saved", "Is the entrance step-free?", false],
      ["no_longer_used", "Is there parking on site?", null],
      ["not_confirmed", "Is there parking on site?", null],
      ["assignment_closed", "Is there parking on site?", null],
    ])
    expect(page.items[2].noLongerUsed).toBe("replaced_by_own")
    expect(page.items[3].stateReason).toBe("Wrong car park")
    expect(page.items[4]).toMatchObject({
      answeredBy: "Maya Rai",
      decidedAt: "2026-11-06T09:00:00.000Z",
    })
  })

  it("reads a draft payload defensively", () => {
    const draft = adaptDraft({
      checkId: CHECK,
      venueId: "v1",
      draftRevision: 2,
      payload: {
        answer: "maybe",
        finding: 7,
        unknownPreset: "needs_access",
        sentSlotRevision: 5,
        wifi: "x",
      },
      assetIds: [],
      idempotencyKey: "k",
      savedAt: "2026-11-06T08:00:00.000Z",
      sendable: true,
    })
    expect(draft.payload).toMatchObject({
      answer: null,
      finding: "",
      unknownPreset: "needs_access",
      sentSlotRevision: 5,
      wifi: { testSpot: "", testedOn: "", downloadMbps: "", uploadMbps: "" },
    })
  })

  it("adapts command results", () => {
    expect(
      adaptSubmitted({
        findingRef: { type: "contribution", id: "f9" },
        submissionId: null,
        outcome: "awaiting_confirmation",
        replacedOwn: "f8",
        replacedOwnSentAt: "2026-11-04T10:00:00.000Z",
        slotRevision: 10,
        replayed: false,
        recognition: { kind: "pending" },
      }).replacedOwn
    ).toEqual({
      findingRef: { type: "contribution", id: "f8" },
      sentAt: "2026-11-04T10:00:00.000Z",
    })
    expect(
      adaptDecision({
        decisionId: "d",
        submissionId: null,
        replacedAnswer: "no",
        slotRevision: 11,
        replayed: true,
      })
    ).toEqual({ slotRevision: 11, replayed: true, replacedAnswer: "no" })
    expect(
      adaptDecision({
        submissionId: null,
        settled: 2,
        slotRevision: 12,
        replayed: false,
      })
    ).toEqual({ slotRevision: 12, replayed: false, replacedAnswer: null })
    expect(
      adaptToConfirm(
        [
          {
            checkId: CHECK,
            questionKey: "onsite_parking",
            question: "Is there parking on site?",
            findingRef: { type: "submission", id: "s" },
            kind: "answer_awaiting_confirmation",
            answer: null,
            senderName: null,
            sentAt: null,
            slotRevision: 9,
            conflict: false,
            disputes: false,
          },
        ],
        1
      ).items[0]
    ).toMatchObject({ kind: "answer_unconfirmed", sender: null, answer: null })
  })
})

describe("knowledge adapter: fields for deciders (ef27740e)", () => {
  it("names the confirmer, says when it was their own finding, and gives staff none", () => {
    const confirmed = adaptSlot(
      slot({
        answerInUse: {
          ...slot().answerInUse!,
          confirmed: true,
          confirmationState: "confirmed",
          confirmedByFirstName: "Maya",
          confirmedAt: "2026-11-04T12:00:00.000Z",
          confirmedSelf: true,
        },
      })
    ).answerInUse.confirmation
    expect(confirmed).toEqual({
      state: "confirmed",
      self: true,
      at: "2026-11-04T12:00:00.000Z",
      by: { id: "", displayName: "Maya" },
    })
    // Staff: the keys are absent.
    expect(adaptSlot(slot()).answerInUse.confirmation).toEqual({
      state: "not_required",
      self: false,
      at: null,
      by: null,
    })
  })

  it("passes on the latest request for more detail with its note", () => {
    const view = adaptCheck(
      check({
        pending: [
          pending({
            detailRequested: true,
            detailRequest: {
              decisionId: "d1",
              note: "Which car park?",
              requestedAt: "2026-11-06T09:00:00.000Z",
            },
          }),
        ],
      }),
      "The Old Crown"
    )
    if (!view.inScope) throw new Error("in scope")
    expect(view.pending[0].detailRequest).toEqual({
      decisionId: "d1",
      note: "Which car park?",
      at: "2026-11-06T09:00:00.000Z",
    })
  })

  it("takes each To confirm row's dispute from the server", () => {
    const row = (disputes: boolean): ToConfirmItem => ({
      checkId: CHECK,
      questionKey: "onsite_parking",
      question: "Is there parking on site?",
      findingRef: { type: "contribution", id: disputes ? "a" : "b" },
      kind: "change_report",
      answer: "no",
      senderName: "Sam Lee",
      sentAt: "2026-11-05T10:00:00.000Z",
      slotRevision: 9,
      conflict: false,
      disputes,
    })
    expect(
      adaptToConfirm([row(true), row(false)], 2).items.map((r) => r.disputes)
    ).toEqual([true, false])
  })
})

describe("knowledge adapter: the capture screen's check (F1)", () => {
  it("describes the check from the knowledge read, guarded by the slot revision", () => {
    const view = adaptCheck(check({ captureBrief: null }), "The Old Crown")
    if (!view.inScope) throw new Error("in scope")
    expect(view.capture).toEqual({
      id: CHECK,
      venueId: "v1",
      status: "active",
      progress: "complete",
      recheckReason: null,
      revision: 9,
      entry: {
        key: "onsite_parking",
        category: "Arrival",
        question: "Is there parking on site?",
        captureBrief: "",
        evidenceRule: "photo",
      },
    })
  })
})
