// @vitest-environment jsdom
// B03-b (B03 UI §4, A38): the policy in use on a To confirm card reads its
// rows from the answer's recorded detail, a retired condition type by its
// label, apart from the finding's rows. Only what the owner's lists and the
// venue's places name; never who stated it.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { DecisionPanel } from "@/components/nabalens/knowledge/decisions"
import type { PolicyContext } from "@/components/nabalens/knowledge/policy-detail"
import type {
  AnswerInUse,
  PendingFinding,
  QuestionView,
} from "@/lib/knowledge-client/contract"

const BAR = "5a000000-0000-4000-8000-000000000001"
const ELSEWHERE = "5a000000-0000-4000-8000-0000000000ff"

const POLICY: PolicyContext = {
  places: [{ subjectId: BAR, kind: "area", label: "⟨Back bar⟩", active: true }],
  conditionTypes: [
    { code: "max", label: "⟨Up to⟩", needsValue: true, valueKind: "number" },
  ],
  exceptionTypes: [],
  retiredTypes: [
    {
      code: "on_lead",
      label: "⟨On a lead⟩",
      needsValue: false,
      valueKind: null,
    },
  ],
}

/** A conditional policy in use whose condition type is now retired. */
const IN_USE: AnswerInUse = {
  status: "available",
  reason: null,
  detail: null,
  value: "yes",
  savedAt: "2026-10-01T09:00:00.000Z",
  sentAt: null,
  qualified: { qualifier: "conditional", until: null, note: null },
  answerDetail: {
    stance: "conditional",
    zones: [{ subjectId: BAR, stance: "allowed" }],
    conditions: [{ type: "on_lead" }],
    policyScope: "venue",
    authority: {
      basis: "venue_manager",
      statedOn: "2026-09-30",
      source: "written_policy",
    },
  },
  confirmation: {
    state: "confirmed",
    self: true,
    at: "2026-10-01T09:00:00.000Z",
    by: null,
  },
}

function finding(over: Partial<PendingFinding> = {}): PendingFinding {
  return {
    findingRef: { type: "contribution", id: "f1" },
    kind: "finding",
    answer: "yes",
    finding: null,
    limitations: null,
    reason: null,
    unknownPreset: null,
    triedText: null,
    changeReason: null,
    sender: { id: "s1", displayName: "Sam Lee" },
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
  answer: AnswerInUse
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
        key: "dogs_inside",
        category: "Policies",
        question: "Are dogs allowed inside?",
        captureBrief: "",
        evidenceRule: "photo",
      },
    },
    slot: {
      checkId: "c1",
      key: "dogs_inside",
      question: "Are dogs allowed inside?",
      category: "Policies",
      evidenceRule: "photo",
      progress: "complete",
      slotRevision: 21,
      answerInUse: answer,
      previousAnswer: null,
      latestAttempt: null,
      assignee: null,
      mode: "none",
      requiresConfirmation: true,
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
      canSelfConfirm: true,
      canRequestDetail: true,
      canDecline: true,
    },
    history: [],
  }
}

function show(
  pending: PendingFinding[],
  answer: AnswerInUse,
  policy: PolicyContext | null = POLICY
) {
  render(
    <DecisionPanel
      view={view(pending, answer)}
      handlers={{ decide: vi.fn(), onResolveConflict: vi.fn() }}
      policy={policy}
    />
  )
}

/** A headed group of facts on the card, by its heading. */
const group = (name: string) =>
  screen.getByRole("heading", { level: 4, name }).parentElement!

/** A group's facts as term → value. */
function facts(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const dt of el.querySelectorAll("dt"))
    out[dt.textContent ?? ""] = dt.nextElementSibling?.textContent ?? ""
  return out
}

afterEach(cleanup)

describe("To confirm: the policy in use (B03 UI §4, A38)", () => {
  it("names a retired condition type on the answer in use, apart from the finding", () => {
    show(
      [
        finding({
          policyMissing: [],
          policyDetail: {
            stance: "conditional",
            conditions: [{ type: "max", value: 2 }],
            policyScope: "venue",
            authority: { basis: "admin", statedOn: "2026-11-04" },
          },
        }),
      ],
      IN_USE
    )
    const inUse = group("In use now")
    expect(facts(inUse)).toMatchObject({
      Rule: "Allowed with conditions",
      Areas: "⟨Back bar⟩: Allowed",
      Conditions: "⟨On a lead⟩ (no longer offered)",
      "Applies to": "This venue",
      "Stated on": "30 Sept 2026",
      Where: "Written policy",
    })
    const pending = group("This finding")
    expect(facts(pending)).toMatchObject({
      Rule: "Allowed with conditions",
      Conditions: "⟨Up to⟩: 2",
      "Stated on": "4 Nov 2026",
    })
    // Each list keeps its own facts.
    expect(within(pending).queryByText(/On a lead/)).toBeNull()
    expect(within(inUse).queryByText(/Up to/)).toBeNull()
    // Who stated it isn't a fact on either.
    expect(screen.queryByText(/venue manager|as admin/i)).toBeNull()
  })

  it("reads it on an answer awaiting confirmation, where only the answer in use is shown", () => {
    show(
      [
        finding({
          kind: "answer_unconfirmed",
          findingRef: { type: "submission", id: "sub1" },
          policyMissing: ["stated_on"],
        }),
      ],
      {
        ...IN_USE,
        status: "unavailable",
        reason: "not_confirmed",
        detail: "policy_incomplete",
        policyMissing: ["stated_on"],
        answerDetail: {
          stance: "conditional",
          conditions: [{ type: "on_lead" }],
        },
        confirmation: { state: "pending", self: false, at: null, by: null },
      }
    )
    expect(screen.queryByRole("heading", { name: "This finding" })).toBeNull()
    expect(facts(group("In use now"))).toMatchObject({
      Answer: "Yes, recorded 1 Oct 2026",
      Rule: "Allowed with conditions",
      Conditions: "⟨On a lead⟩ (no longer offered)",
    })
    // Still incomplete: Confirm says why it can't be used yet.
    const confirm = screen.getByRole("button", { name: "Confirm" })
    expect(confirm.getAttribute("aria-disabled")).toBe("true")
  })

  it("names an unknown code as it is and a place outside the venue's list generically", () => {
    show([finding({ answer: "no" })], {
      ...IN_USE,
      answerDetail: {
        stance: "conditional",
        zones: [{ subjectId: ELSEWHERE, stance: "not_allowed" }],
        conditions: [{ type: "mystery_code" }],
      },
    })
    expect(facts(group("In use now"))).toMatchObject({
      Areas: "that place: Not allowed",
      Conditions: "mystery_code (no longer offered)",
    })
  })

  it("adds nothing off a policy question, or with no answer in use", () => {
    show([finding({ answer: "no" })], IN_USE, null)
    expect(Object.keys(facts(group("In use now")))).toEqual([
      "Answer",
      "Confirmation",
    ])
    cleanup()
    show([finding()], { ...IN_USE, value: null, savedAt: null })
    expect(Object.keys(facts(group("In use now")))).toEqual(["Answer"])
  })
})
