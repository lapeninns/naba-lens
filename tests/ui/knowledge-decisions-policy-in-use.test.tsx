// @vitest-environment jsdom
// B03-b (B03 UI §4, A38): the policy in use on a To confirm card reads its
// rows from the answer's recorded detail, a retired condition type by its
// label, apart from the finding's rows. Only what the owner's lists and the
// venue's places name; never who stated it.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { DecisionPanel } from "@/components/nabalens/knowledge/decisions"
import { AnswerOnDate } from "@/components/nabalens/knowledge/corrections"
import {
  policyFacts,
  type PolicyContext,
} from "@/components/nabalens/knowledge/policy-detail"
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
  retiredConditionTypes: [
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

  it("shows no policy rows for an incomplete policy awaiting confirmation (§4.3)", () => {
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
    const inUse = facts(group("In use now"))
    expect(inUse).toMatchObject({ Answer: "Yes, recorded 1 Oct 2026" })
    for (const term of ["Rule", "Conditions", "Applies to", "Stated on"])
      expect(inUse[term]).toBeUndefined()
    expect(screen.queryByText(/On a lead/)).toBeNull()
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

  it("names a retired condition and exception from their own lists when codes match", () => {
    const shared = (label: string) => ({
      code: "shared",
      label,
      needsValue: false,
      valueKind: null,
    })
    const rows = policyFacts(
      {
        stance: "conditional",
        conditions: [{ type: "shared" }],
        exceptions: [{ type: "shared" }],
      },
      {
        ...POLICY,
        retiredConditionTypes: [shared("⟨Condition label⟩")],
        retiredExceptionTypes: [shared("⟨Exception label⟩")],
      }
    )
    expect(
      Object.fromEntries(rows.map((r) => [r.term, r.value]))
    ).toMatchObject({
      Conditions: "⟨Condition label⟩ (no longer offered)",
      Exceptions: "⟨Exception label⟩ (no longer offered)",
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

describe("the policy in use on the normal views (B03 UI §4.4, §8.5, A38)", () => {
  async function renderCheck(answer: AnswerInUse) {
    const { AmenityCheckDetail } =
      await import("@/components/nabalens/amenities/manage")
    const { detail, WIFI_CHECK } = await import("./amenities-manage-fixtures")
    render(
      <AmenityCheckDetail
        detail={detail({ check: { ...WIFI_CHECK, progress: "complete" } })}
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
          policy: POLICY,
        }}
      />
    )
    return screen
      .getByRole("heading", { name: "Where it stands" })
      .closest("section")!
  }

  it("Where it stands names a retired condition with nothing to confirm", async () => {
    const section = await renderCheck(IN_USE)
    // No pending finding: no To confirm card to carry it.
    expect(screen.queryByRole("heading", { name: "In use now" })).toBeNull()
    expect(facts(section)).toMatchObject({
      Rule: "Allowed with conditions",
      Areas: "⟨Back bar⟩: Allowed",
      Conditions: "⟨On a lead⟩ (no longer offered)",
      "Applies to": "This venue",
      "Stated on": "30 Sept 2026",
    })
  })

  it("Where it stands shows no rows for an incomplete policy", async () => {
    const section = await renderCheck({
      ...IN_USE,
      status: "unavailable",
      reason: "not_confirmed",
      detail: "policy_incomplete",
      policyMissing: ["stated_on"],
    })
    expect(facts(section).Conditions).toBeUndefined()
    expect(facts(section).Rule).toBeUndefined()
  })

  async function showOnDate(policy: PolicyContext | null) {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      history: {
        checkId: "c1",
        at: "2026-10-02T22:59:59.000Z",
        answerInUse: {
          submissionId: "sub1",
          answer: "yes",
          sentAt: "2026-10-01T09:00:00.000Z",
          confirmationState: "confirmed",
          withdrawn: false,
          detail: {
            stance: "conditional",
            conditions: [{ type: "on_lead" }],
            policyScope: "venue",
          },
          questionVersion: 1,
          selectionRule: "confirmation",
        },
      },
    })
    render(
      <AnswerOnDate
        checkId="c1"
        today="2026-11-10"
        load={load}
        policy={policy}
      />
    )
    const user = userEvent.setup()
    const date = screen.getByLabelText("Date")
    await user.type(date, "2026-10-02")
    await user.click(screen.getByRole("button", { name: "Show" }))
    await screen.findByText(/the answer in use was Yes/)
    return load
  }

  it("the answer on a date names a retired condition from the snapshot", async () => {
    const load = await showOnDate(POLICY)
    expect(load).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText("Conditions: ⟨On a lead⟩ (no longer offered)")
    ).toBeTruthy()
    expect(screen.getByText("Rule: Allowed with conditions")).toBeTruthy()
  })

  it("the answer on a date adds no policy rows off a policy question", async () => {
    await showOnDate(null)
    expect(screen.queryByText(/^Conditions:/)).toBeNull()
  })
})
