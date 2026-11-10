import { describe, expect, it } from "vitest"

import { entryIntents } from "@/lib/work-client/entry"
import {
  parseCapabilities,
  parseDeleteImpact,
  parseLabelWork,
  parseTriage,
} from "@/lib/work-client/parse"
import {
  orderTodo,
  todoBadge,
  withoutTodo,
  type TodoEntry,
} from "@/lib/work-client/todo"

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

  it("is null without a known account kind or venue", () => {
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

function entry(key: string, kind: TodoEntry["kind"], members = 1): TodoEntry {
  return { key, kind, members }
}

describe("orderTodo (D1)", () => {
  it("puts failed uploads first and keeps ties in their given order", () => {
    const ordered = orderTodo([
      entry("task:due", "due_soon"),
      entry("labels", "labels", 5),
      entry("finding:1", "finding"),
      entry("replacement:1", "replacement"),
      entry("upload:dev", "upload", 2),
      entry("check:1", "check"),
      entry("recheck:1", "recheck"),
      entry("task:late", "overdue"),
      entry("setup", "setup"),
      entry("confirm:findings", "confirm_findings", 2),
      entry("review:photos", "review_photos", 3),
    ])
    expect(ordered.map((e) => e.key)).toEqual([
      "upload:dev",
      "finding:1",
      "replacement:1",
      "recheck:1",
      "task:late",
      "labels",
      "check:1",
      "task:due",
      "setup",
      "confirm:findings",
      "review:photos",
    ])
  })

  it("leads with setup when it blocks sending", () => {
    const ordered = orderTodo([
      entry("upload:dev", "upload"),
      { ...entry("setup", "setup"), blocking: true },
    ])
    expect(ordered[0].key).toBe("setup")
  })
})

describe("todoBadge", () => {
  it("counts grouped members and is unknown when a read failed", () => {
    const entries = [
      entry("check:group", "check", 4),
      entry("labels", "labels"),
    ]
    expect(todoBadge(entries, false)).toBe(5)
    expect(todoBadge(entries, true)).toBeNull()
    expect(todoBadge([], false)).toBe(0)
  })
})

describe("withoutTodo (one home per piece of work)", () => {
  it("drops rows that are already To do cards and counts them", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(
      withoutTodo(rows, (row) => `check:${row.id}`, [entry("check:b", "check")])
    ).toEqual({ rows: [{ id: "a" }, { id: "c" }], inTodo: 1 })
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
