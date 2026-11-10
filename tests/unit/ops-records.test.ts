import { describe, expect, it } from "vitest"

import {
  initialChecklist,
  lintDestinationChecklist,
  type ChecklistItem,
} from "@/lib/ops/destinations"
import {
  emptyObservationLog,
  lintObservationLog,
  observedCompletion,
  type ObservationRow,
} from "@/lib/ops/observations"
import {
  identityOnlyRecord,
  lintOnboardingRecord,
  ONBOARDING_FIELDS,
} from "@/lib/ops/onboarding"
import { parseRoster } from "@/lib/ops/roster"

// DEV FIXTURE venues only: never production identifiers.
const ROSTER_TEXT = `Initialising login role...
┌──────────────────────────────────────┬──────────────────┬──────────────────┬────────┐
│ id                                   │ slug             │ name             │ active │
├──────────────────────────────────────┼──────────────────┼──────────────────┼────────┤
│ 00000000-0000-4000-8000-0000000000a1 │ dev-fixture-one  │ DEV FIXTURE One  │ true   │
│ 00000000-0000-4000-8000-0000000000b2 │ dev-fixture-two  │ DEV FIXTURE Two  │ true   │
└──────────────────────────────────────┴──────────────────┴──────────────────┴────────┘
`
const roster = parseRoster(ROSTER_TEXT)
const venue = roster[0]

const record = () =>
  structuredClone(
    identityOnlyRecord({
      venue,
      rosterSource: "roster.txt",
      crosswalkStatus: "probable",
      crosswalkSource: "crosswalk proposal",
      generation: "A",
      generationSource: "inventory",
      updatedAt: "2026-11-10T12:00:00Z",
    })
  )
const messages = (problems: { path: string; message: string }[]) =>
  problems.map((p) => `${p.path}: ${p.message}`)

describe("roster", () => {
  it("reads id, slug, name and active from the printed table", () => {
    expect(roster).toEqual([
      {
        id: "00000000-0000-4000-8000-0000000000a1",
        slug: "dev-fixture-one",
        name: "DEV FIXTURE One",
        active: true,
      },
      {
        id: "00000000-0000-4000-8000-0000000000b2",
        slug: "dev-fixture-two",
        name: "DEV FIXTURE Two",
        active: true,
      },
    ])
  })
})

describe("T-B10-11 onboarding records", () => {
  it("creates an identity-only record that passes, with every other field not recorded", () => {
    const r = record()
    expect(lintOnboardingRecord(r, roster, venue.id)).toEqual([])
    expect(Object.keys(r.fields)).toEqual(ONBOARDING_FIELDS.map((f) => f.key))
    const recorded = Object.entries(r.fields)
      .filter(([, e]) => "value" in e)
      .map(([k]) => k)
    expect(recorded).toEqual([
      "identity.venue_id",
      "identity.slug",
      "identity.name",
      "identity.crosswalk_status",
      "identity.generation",
    ])
  })

  it("refuses an identity value that differs from the roster", () => {
    const r = record()
    r.fields["identity.name"] = { value: "DEV FIXTURE Typo", source: "typed" }
    expect(messages(lintOnboardingRecord(r, roster))).toContain(
      "$.fields.identity.name: differs from the roster"
    )
  })

  it("refuses a value without a source, and inferred or unknown shapes", () => {
    const r = record() as unknown as { fields: Record<string, unknown> }
    r.fields["accounts.staff"] = { value: 4 }
    r.fields["targets.policy"] = {
      value: "5",
      source: "guess",
      notApplicable: "x",
    }
    r.fields["wave.assignment"] = {
      notRecorded: { owner: "Someone", dueBy: "soon" },
    }
    const found = messages(lintOnboardingRecord(r, roster))
    expect(found).toContain(
      "$.fields.accounts.staff: needs a value and its source"
    )
    expect(found).toContain(
      "$.fields.targets.policy: must be exactly one of { value, source }, { notApplicable } or { notRecorded }"
    )
    expect(found).toContain(
      "$.fields.wave.assignment: not recorded needs an owner role and a due milestone"
    )
  })

  it("refuses missing and unknown fields, a venue outside the roster and personal data", () => {
    const r = record() as unknown as {
      venueId: string
      fields: Record<string, unknown>
    }
    delete r.fields["devices.readiness"]
    r.fields["people.confirmer_name"] = { value: "x", source: "y" }
    r.fields["review.to_confirm_cadence"] = {
      value: "weekly, ask someone@example.com",
      source: "note",
    }
    const found = messages(lintOnboardingRecord(r, roster, "another-file"))
    expect(found).toContain("$.fields.devices.readiness: is missing")
    expect(found).toContain(
      "$.fields.people.confirmer_name: is not a template field"
    )
    expect(found).toContain("$.venueId: does not match the file name")
    expect(found).toContain(
      "$.fields.review.to_confirm_cadence.value: contains an email address"
    )
    r.venueId = "00000000-0000-4000-8000-0000000000ff"
    expect(messages(lintOnboardingRecord(r, roster))).toContain(
      "$.venueId: is not in the roster"
    )
  })

  it("accepts only probable or verified crosswalk rows and generations A to D", () => {
    const r = record()
    r.fields["identity.crosswalk_status"] = { value: "maybe", source: "x" }
    r.fields["identity.generation"] = { value: "E", source: "x" }
    const found = messages(lintOnboardingRecord(r, roster))
    expect(found).toContain(
      "$.fields.identity.crosswalk_status: must be probable or verified"
    )
    expect(found).toContain(
      "$.fields.identity.generation: must be A, B, C or D"
    )
  })
})

describe("T-B10-12 observation logs", () => {
  const row: ObservationRow = {
    date: "2026-11-20",
    roleKind: "kitchen",
    taskType: "capture",
    outcome: "completed",
    helpNeeded: false,
    evidenceType: "S",
  }

  it("passes an empty log and a well-formed row", () => {
    expect(
      lintObservationLog(emptyObservationLog(venue.id), roster, venue.id)
    ).toEqual([])
    const log = { ...emptyObservationLog(venue.id), rows: [row] }
    expect(lintObservationLog(log, roster, venue.id)).toEqual([])
  })

  it("refuses names and malformed rows", () => {
    const log = {
      ...emptyObservationLog(venue.id),
      rows: [{ ...row, staffName: "x", date: "20/11/2026", evidenceType: "Z" }],
    }
    const found = messages(lintObservationLog(log, roster))
    expect(found).toContain("$.rows[0].staffName: is not an allowed column")
    expect(found).toContain("$.rows[0].date: must be YYYY-MM-DD")
    expect(found).toContain("$.rows[0].evidenceType: is not an evidence type")
  })

  it("computes M-AD-3 as completed without help over all observed attempts", () => {
    const rows: ObservationRow[] = [
      row,
      { ...row, helpNeeded: true },
      { ...row, outcome: "failed" },
      row,
    ]
    expect(observedCompletion(rows)).toEqual({ value: 50, sample: 4 })
    expect(observedCompletion([])).toEqual({ value: 0, sample: 0 })
  })
})

describe("T-B10-13 destination checklist", () => {
  it("starts with every check outstanding and naming what it waits for", () => {
    const checklist = initialChecklist(roster)
    expect(lintDestinationChecklist(checklist, roster)).toEqual([])
    // 10 websites x 12 checks, 3 undecided x 1, 2 fixture venues x 7 NabaPresence checks.
    expect(checklist.items).toHaveLength(120 + 3 + 14)
    expect(checklist.items.every((i) => i.state === "outstanding")).toBe(true)
  })

  it("refuses a missing check, an outstanding item without a dependency and a result without evidence", () => {
    const checklist = initialChecklist(roster)
    const [first, second, ...rest] = checklist.items
    const passed: ChecklistItem = {
      destination: second.destination,
      check: second.check,
      state: "passed",
      evidencePath: "",
      observedAt: "2026-11-20T10:00:00Z",
      sourceRevision: "abc",
    }
    const broken = {
      ...checklist,
      items: [{ ...rest[0], waitingFor: [] }, passed, ...rest.slice(1)],
    }
    const found = messages(lintDestinationChecklist(broken, roster))
    expect(found).toContain(
      `$.items: ${first.destination} ${first.check} is missing`
    )
    expect(found).toContain(
      "$.items[0]: an outstanding check names what it waits for"
    )
    expect(found).toContain(
      "$.items[1]: a result needs an evidence path, a UTC time and a source revision"
    )
  })
})
