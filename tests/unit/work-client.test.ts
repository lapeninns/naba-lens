import { describe, expect, it } from "vitest"

import { entryIntents } from "@/lib/work-client/entry"
import {
  parseCapabilities,
  parseDeleteImpact,
  parseLabelWork,
  parseTriage,
} from "@/lib/work-client/parse"

const CAPS = {
  accountKind: "staff",
  venueId: "v1",
  canUpload: true,
  canLabel: true,
  canSendFindings: true,
  canConfirmFindings: false,
  canSelfConfirm: { wifi: true, parking: false },
  canReviewMenuPhotos: false,
  canDecideOwnMenuPhoto: false,
  canReviewChecklist: false,
  canBeAssigned: true,
  canCorrect: false,
  canWithdraw: false,
  canReadHistory: false,
  canStatePolicy: false,
  canStateOrgPolicy: false,
  policyBasis: null,
}

describe("parseCapabilities (R8)", () => {
  it("reads every key", () => {
    expect(parseCapabilities(CAPS)).toEqual(CAPS)
  })

  it("treats anything but true as not allowed", () => {
    const caps = parseCapabilities({
      ...CAPS,
      canUpload: "true",
      canLabel: 1,
      canSelfConfirm: { wifi: "yes" },
      canBeAssigned: undefined,
    })
    expect(caps).toMatchObject({
      canUpload: false,
      canLabel: false,
      canBeAssigned: false,
      canSelfConfirm: { wifi: false },
    })
  })

  it("reads the B03-g flags, and only an exact true allows them", () => {
    expect(
      parseCapabilities({
        ...CAPS,
        accountKind: "manager",
        canCorrect: true,
        canWithdraw: "yes",
        canReadHistory: true,
      })
    ).toMatchObject({
      canCorrect: true,
      canWithdraw: false,
      canReadHistory: true,
    })
    // A server from before B03-g leaves them out.
    const older: Record<string, unknown> = { ...CAPS }
    delete older.canCorrect
    delete older.canWithdraw
    delete older.canReadHistory
    expect(parseCapabilities(older)).toMatchObject({
      canCorrect: false,
      canWithdraw: false,
      canReadHistory: false,
    })
  })

  it("accepts a staff member with no current venue", () => {
    expect(parseCapabilities({ ...CAPS, venueId: null })).toMatchObject({
      venueId: null,
    })
  })

  it("is null without a known account kind or a readable venue", () => {
    expect(parseCapabilities({ ...CAPS, accountKind: "owner" })).toBeNull()
    expect(parseCapabilities({ ...CAPS, venueId: "" })).toBeNull()
    expect(parseCapabilities(null)).toBeNull()
    expect(parseCapabilities([CAPS])).toBeNull()
  })
})

describe("parseLabelWork (R1)", () => {
  it("reads the table row or a camelCased object", () => {
    expect(parseLabelWork([{ needs_labels: 3, needs_attention: 1 }])).toEqual({
      needsLabels: 3,
      needsAttention: 1,
    })
    expect(parseLabelWork({ needsLabels: 0, needsAttention: 0 })).toEqual({
      needsLabels: 0,
      needsAttention: 0,
    })
  })

  it("is null for a missing or negative count", () => {
    expect(parseLabelWork([])).toBeNull()
    expect(parseLabelWork({ needs_labels: -1, needs_attention: 0 })).toBeNull()
    expect(parseLabelWork({ needs_labels: 2 })).toBeNull()
  })
})

describe("parseTriage (R3)", () => {
  it("keeps queues in a fixed order and never sums them", () => {
    const rows = parseTriage([
      { queue: "checklist", available: false },
      {
        queue: "findings",
        available: true,
        waiting: 2,
        oldest_waiting_at: "2026-11-09T10:00:00Z",
        own_waiting: 0,
      },
      {
        queue: "menu_photos",
        available: true,
        waiting: 4,
        oldest_waiting_at: null,
        own_waiting: 1,
      },
    ])
    expect(rows).toEqual([
      {
        queue: "menu_photos",
        available: true,
        waiting: 4,
        oldestWaitingAt: null,
        ownWaiting: 1,
      },
      {
        queue: "findings",
        available: true,
        waiting: 2,
        oldestWaitingAt: "2026-11-09T10:00:00Z",
        ownWaiting: 0,
      },
      { queue: "checklist", available: false },
    ])
  })

  it("drops unknown queues and duplicates; null when a count is unreadable", () => {
    expect(
      parseTriage([
        { queue: "surveys", available: true, waiting: 1 },
        { queue: "findings", available: false },
        { queue: "findings", available: true, waiting: 9 },
      ])
    ).toEqual([{ queue: "findings", available: false }])
    expect(
      parseTriage([{ queue: "findings", available: true, waiting: "2" }])
    ).toBeNull()
    expect(parseTriage({})).toBeNull()
  })
})

describe("parseDeleteImpact (R9)", () => {
  const item = {
    kind: "answer_in_use",
    effect: "withdrawn",
    venueId: "v1",
    venueName: "The Old Crown",
    checkId: "c1",
    questionKey: "parking",
    question: "Is there parking on site?",
    yours: false,
  }

  it("keeps only the venue, question, effect and yours", () => {
    expect(parseDeleteImpact({ assetId: "a1", impacts: [item] })).toEqual({
      status: "known",
      items: [
        {
          kind: "answer_in_use",
          effect: "withdrawn",
          venueName: "The Old Crown",
          question: "Is there parking on site?",
          yours: false,
        },
      ],
    })
  })

  it("is unknown for a kind or effect this client can't word", () => {
    expect(
      parseDeleteImpact({ impacts: [{ ...item, effect: "archived" }] })
    ).toEqual({ status: "unknown" })
  })

  it("is null when the read is unusable", () => {
    expect(parseDeleteImpact({})).toBeNull()
    expect(
      parseDeleteImpact({ impacts: [{ ...item, yours: "no" }] })
    ).toBeNull()
  })
})

describe("entryIntents (§4.1)", () => {
  const all = {
    hasWorkingList: true,
    hasAnsweredQuestions: true,
    hasTasks: true,
  }

  it("offers staff every choice they can complete", () => {
    expect(entryIntents(parseCapabilities(CAPS), all)).toEqual([
      "dish",
      "task",
      "question",
      "change",
      "photos",
    ])
  })

  it("offers a manager-only account questions and changes, no uploads", () => {
    const manager = parseCapabilities({
      ...CAPS,
      accountKind: "manager",
      canUpload: false,
      canLabel: false,
      canBeAssigned: false,
      canConfirmFindings: true,
    })
    expect(entryIntents(manager, all)).toEqual(["question", "change"])
  })

  it("hides choices with nothing behind them", () => {
    expect(
      entryIntents(parseCapabilities(CAPS), {
        hasWorkingList: false,
        hasAnsweredQuestions: false,
        hasTasks: false,
      })
    ).toEqual(["dish", "photos"])
  })

  it("is null when capabilities couldn't be read", () => {
    expect(entryIntents(null, all)).toBeNull()
  })
})

describe("A35 policy capabilities", () => {
  it("reads who may state a policy, for every venue, and on which basis", () => {
    expect(
      parseCapabilities({
        ...CAPS,
        accountKind: "staff_with_grant",
        canStatePolicy: true,
        canStateOrgPolicy: false,
        policyBasis: "venue_manager",
      })
    ).toMatchObject({
      canStatePolicy: true,
      canStateOrgPolicy: false,
      policyBasis: "venue_manager",
    })
    expect(
      parseCapabilities({
        ...CAPS,
        canStatePolicy: "yes",
        policyBasis: "owner",
      })
    ).toMatchObject({ canStatePolicy: false, policyBasis: null })
  })
})
