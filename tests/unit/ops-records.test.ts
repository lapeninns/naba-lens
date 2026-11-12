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
  AGGREGATE_FIELDS,
  aggregateProblems,
  applyAggregate,
  EXTERNAL_DESTINATIONS_OUT_OF_SCOPE,
  identityOnlyRecord,
  lintOnboardingRecord,
  ONBOARDING_FIELDS,
  upgradeV1Record,
  type VenueAggregate,
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
      "identity.active",
    ])
    expect(r.schema).toBe("b10-onboarding/2")
    expect(r.fields["scope.external_destinations"]).toEqual({
      notApplicable: EXTERNAL_DESTINATIONS_OUT_OF_SCOPE,
    })
  })

  it("has no website, NabaPresence, crosswalk or generation field (owner correction, 11 Nov 2026)", () => {
    for (const f of ONBOARDING_FIELDS)
      expect(f.key, f.key).not.toMatch(
        /website|nabapresence|crosswalk|generation|destination(?!s$)/
      )
    expect(ONBOARDING_FIELDS.map((f) => f.key)).toContain(
      "scope.external_destinations"
    )
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

  it("requires the out-of-scope boundary exactly, and an active flag that matches the roster", () => {
    const r = record()
    r.fields["scope.external_destinations"] = {
      notRecorded: { owner: "PO", dueBy: "b10_exit" },
    }
    r.fields["identity.active"] = { value: "no", source: "typed" }
    const found = messages(lintOnboardingRecord(r, roster))
    expect(found).toContain(
      "$.fields.scope.external_destinations: must state the owner's out-of-scope boundary exactly"
    )
    expect(found).toContain("$.fields.identity.active: differs from the roster")
  })

  it("refuses a schema-1 record", () => {
    const r = { ...record(), schema: "b10-onboarding/1" }
    expect(messages(lintOnboardingRecord(r, roster))).toContain(
      "$.schema: must be b10-onboarding/2"
    )
  })
})

describe("B10-03 schema 1 to 2", () => {
  const v1 = () => ({
    schema: "b10-onboarding/1",
    venueId: venue.id,
    recordVersion: 1,
    updatedAt: "2026-11-10T12:17:44Z",
    updatedByRole: "WS6",
    fields: {
      "identity.venue_id": { value: venue.id, source: "roster.txt" },
      "identity.crosswalk_status": { value: "probable", source: "inv" },
      "identity.website": {
        notRecorded: { owner: "WS5", dueBy: "wave_entry" },
      },
      "consumers.nabapresence": {
        notRecorded: { owner: "WS5", dueBy: "b10_exit" },
      },
      "review.to_confirm_cadence": { value: "weekly", source: "VM note" },
      "accounts.staff": {
        notRecorded: { owner: "COORD", dueBy: "wave_entry" },
      },
    },
  })

  it("keeps shared entries, drops external fields and passes the lint", () => {
    const { record: r, dropped } = upgradeV1Record(v1(), {
      venue,
      rosterSource: "roster.txt",
      updatedAt: "2026-11-12T13:30:00Z",
    })
    expect(lintOnboardingRecord(r, roster, venue.id)).toEqual([])
    expect(r.recordVersion).toBe(2)
    expect(r.fields["review.to_confirm_cadence"]).toEqual({
      value: "weekly",
      source: "VM note",
    })
    expect(dropped).toEqual([
      "identity.crosswalk_status",
      "identity.website",
      "consumers.nabapresence",
    ])
  })

  it("refuses another schema or another venue", () => {
    const input = {
      venue,
      rosterSource: "roster.txt",
      updatedAt: "2026-11-12T13:30:00Z",
    }
    expect(() => upgradeV1Record({ ...v1(), schema: "x" }, input)).toThrow()
    expect(() =>
      upgradeV1Record({ ...v1(), venueId: roster[1].id }, input)
    ).toThrow()
  })
})

describe("B10-03c aggregate read", () => {
  const row = (): VenueAggregate => ({
    venueId: venue.id,
    active: true,
    managerAccounts: 1,
    staff: { foh: 3, boh: 2, unassigned: 1 },
    staffWithLegacyGrant: 0,
    amenitiesEnabledOn: "2026-11-07",
    amenityChecks: { complete: 2, needs_capture: 3 },
    workingListKeys: ["onsite_parking", "guest_wifi"],
    activeMenuVersions: 1,
    activeMenuActivatedOn: "2026-11-01",
    coverageRequirements: { active: 4, needs_setup: 1 },
    venueMonthlyTarget: null,
    staffTargetsThisMonth: { set: 5, needsSetup: 1 },
    londonMonth: "2026-11",
  })
  const input = {
    source: "aggregate 2026-11-12",
    updatedAt: "2026-11-12T14:00:00Z",
  }

  it("fills only the aggregate fields, each with its source, and still passes", () => {
    const before = record()
    const after = applyAggregate(before, row(), input)
    expect(lintOnboardingRecord(after, roster, venue.id)).toEqual([])
    expect(after.recordVersion).toBe(2)
    for (const f of ONBOARDING_FIELDS)
      if ((AGGREGATE_FIELDS as readonly string[]).includes(f.key))
        expect(after.fields[f.key], f.key).toMatchObject({
          source: input.source,
        })
      else expect(after.fields[f.key], f.key).toEqual(before.fields[f.key])
    expect(after.fields["accounts.staff"]).toEqual({
      value: "6 (FOH 3, BOH 2, unassigned 1)",
      source: input.source,
    })
    expect(after.fields["knowledge.working_list"]).toMatchObject({
      value: "guest_wifi, onsite_parking",
    })
    expect(after.fields["targets.venue_monthly"]).toMatchObject({
      value: "none in force for 2026-11",
    })
  })

  it("refuses a row with free text, extra keys or another venue", () => {
    expect(aggregateProblems({ ...row(), note: "x" })).not.toEqual([])
    expect(
      aggregateProblems({ ...row(), workingListKeys: ["Ask Sam at the bar"] })
    ).toContain("workingListKeys")
    expect(
      aggregateProblems({ ...row(), amenityChecks: { complete: "two" } })
    ).toContain("amenityChecks")
    expect(() =>
      applyAggregate(record(), { ...row(), venueId: roster[1].id }, input)
    ).toThrow("another venue")
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
