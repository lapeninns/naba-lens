// B04-b1 read-time resolution (b04-design §5.2 #4–7, §5.5, A1-4, A1-6): the
// price in force at an instant, the local-midnight cutover of a future-dated
// value with no job, history, withdrawn and conflicting values, temporary
// unavailability past `until`, and availability schedules over the B03
// occurrence fixtures (clock changes, windows past midnight) and a linked B03
// service. The database mirror is pinned by tests/security/menus-trading.test.ts.
// Synthetic values only.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  localDateAt,
  localMidnight,
  scheduleStateAt,
  type LocalMenuSchedule,
} from "@/lib/menus/trading/availability"
import {
  resolveAvailability,
  resolveField,
  resolveTemporary,
  tradingHead,
  type LineRecords,
} from "@/lib/menus/trading/resolve"
import type {
  TradingAssertionRecord,
  TradingDecisionRecord,
  TradingValue,
} from "@/lib/menus/trading/types"
import type { Occurrence } from "@/lib/server/knowledge/schedules"

const TZ = "Europe/London"
let seq = 0

const price = (pence: number): TradingValue => ({
  kind: "fixed",
  amountMinor: pence,
  currency: "GBP",
})

function assertion(
  id: string,
  value: TradingValue,
  opts: Partial<TradingAssertionRecord> = {}
): TradingAssertionRecord {
  return {
    id,
    field: "price",
    value,
    basis: "manager_statement",
    supersedes: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...opts,
  }
}

function decision(
  assertionId: string,
  kind: TradingDecisionRecord["decision"],
  decidedAt: string
): TradingDecisionRecord {
  seq += 1
  return kind === "confirmed"
    ? {
        assertionId,
        decision: kind,
        decidedAt,
        seq,
        statedOn: decidedAt.slice(0, 10),
        statedOnSource: "form_default",
      }
    : { assertionId, decision: kind, decidedAt, seq }
}

const line = (
  assertions: TradingAssertionRecord[],
  decisions: TradingDecisionRecord[]
): LineRecords => ({ assertions, decisions, timeZone: TZ })

const amount = (records: LineRecords, at: string) => {
  const s = resolveField(records, "price", at)
  return s.status === "available" && "amountMinor" in s.value
    ? s.value.amountMinor
    : s
}

describe("price resolution (§5.5 step 1)", () => {
  it("reads nothing recorded, a proposal or a declined proposal as unknown / not_recorded", () => {
    const unknown = {
      status: "unavailable",
      reason: "unknown",
      detail: "not_recorded",
    }
    expect(resolveField(line([], []), "price", "2026-11-10T12:00:00Z")).toEqual(
      unknown
    )
    const proposed = line([assertion("a", price(1050))], [])
    expect(resolveField(proposed, "price", "2026-11-10T12:00:00Z")).toEqual(
      unknown
    )
    const declined = line(
      [assertion("a", price(1050))],
      [decision("a", "declined", "2026-11-10T09:00:00Z")]
    )
    expect(resolveField(declined, "price", "2026-11-10T12:00:00Z")).toEqual(
      unknown
    )
  })

  it("reads a confirmed value from its confirmation, with its basis but no person", () => {
    const records = line(
      [assertion("h", price(1050), { basis: "staff_report" })],
      [decision("h", "confirmed", "2026-11-10T09:00:00Z")]
    )
    expect(
      resolveField(records, "price", "2026-11-10T08:59:59Z")
    ).toMatchObject({
      status: "unavailable",
      detail: "not_recorded",
    })
    expect(resolveField(records, "price", "2026-11-10T09:00:00Z")).toEqual({
      status: "available",
      assertionId: "h",
      value: price(1050),
      updatedBy: "manager",
      effectiveFrom: null,
      effectiveTo: null,
      startsAt: "2026-11-10T09:00:00.000Z",
      endsAt: null,
      confirmedAt: "2026-11-10T09:00:00.000Z",
      statedOn: "2026-11-10",
      statedOnSource: "form_default",
    })
    const source = line(
      [assertion("s", price(995), { basis: "source_mapping" })],
      [decision("s", "confirmed", "2026-11-10T09:00:00Z")]
    )
    expect(resolveField(source, "price", "2026-11-10T10:00:00Z")).toMatchObject(
      {
        updatedBy: "menu_source",
      }
    )
  })

  it("changes a future-dated confirmed price at venue-local midnight with no job (GMT)", () => {
    const records = line(
      [
        assertion("h", price(1050)),
        assertion("p", price(1150), {
          supersedes: "h",
          effectiveFrom: "2026-11-11",
        }),
      ],
      [
        decision("h", "confirmed", "2026-11-01T09:00:00Z"),
        decision("p", "confirmed", "2026-11-10T15:00:00Z"),
      ]
    )
    expect(amount(records, "2026-11-10T16:00:00Z")).toBe(1050)
    expect(amount(records, "2026-11-10T23:59:59.999Z")).toBe(1050)
    expect(amount(records, "2026-11-11T00:00:00Z")).toBe(1150)
    // History: before the new price was confirmed, the old one, always.
    expect(amount(records, "2026-11-05T12:00:00Z")).toBe(1050)
    expect(tradingHead(records, "price")).toBe("p")
  })

  it("changes at local midnight in summer time (23:00 UTC the day before)", () => {
    const records = line(
      [
        assertion("h", price(500)),
        assertion("p", price(550), {
          supersedes: "h",
          effectiveFrom: "2027-04-01",
        }),
      ],
      [
        decision("h", "confirmed", "2027-03-01T09:00:00Z"),
        decision("p", "confirmed", "2027-03-30T09:00:00Z"),
      ]
    )
    expect(localMidnight("2027-04-01", TZ)).toBe(
      Date.parse("2027-03-31T23:00:00Z")
    )
    expect(amount(records, "2027-03-31T22:59:59Z")).toBe(500)
    expect(amount(records, "2027-03-31T23:00:00Z")).toBe(550)
  })

  it("never applies a value before its confirmation, whatever its effective date", () => {
    const records = line(
      [assertion("h", price(500), { effectiveFrom: "2026-11-10" })],
      [decision("h", "confirmed", "2026-11-10T15:00:00Z")]
    )
    expect(amount(records, "2026-11-10T14:59:59Z")).toMatchObject({
      detail: "not_recorded",
    })
    expect(amount(records, "2026-11-10T15:00:00Z")).toBe(500)
  })

  it("reads a newer withdrawal with no replacement as withdrawn, never the older value", () => {
    const records = line(
      [
        assertion("g", price(900)),
        assertion("h", price(1000), { supersedes: "g" }),
      ],
      [
        decision("g", "confirmed", "2026-11-01T09:00:00Z"),
        decision("h", "confirmed", "2026-11-05T09:00:00Z"),
        decision("h", "withdrawn", "2026-11-08T09:00:00Z"),
      ]
    )
    expect(amount(records, "2026-11-03T12:00:00Z")).toBe(900)
    expect(amount(records, "2026-11-06T12:00:00Z")).toBe(1000)
    expect(resolveField(records, "price", "2026-11-09T12:00:00Z")).toEqual({
      status: "unavailable",
      reason: "withdrawn",
      detail: "value_withdrawn",
    })
    expect(tradingHead(records, "price")).toBeNull()
  })

  it("reads two confirmed values on the same dates as disputed until one is withdrawn", () => {
    const records = line(
      [assertion("x", price(1000)), assertion("y", price(1200))],
      [
        decision("x", "confirmed", "2026-11-05T09:00:00Z"),
        decision("y", "confirmed", "2026-11-05T09:00:00Z"),
      ]
    )
    expect(resolveField(records, "price", "2026-11-06T12:00:00Z")).toEqual({
      status: "unavailable",
      reason: "disputed",
      detail: "conflict",
      assertionIds: ["x", "y"],
    })
    records.decisions.push(decision("y", "withdrawn", "2026-11-07T09:00:00Z"))
    expect(amount(records, "2026-11-06T12:00:00Z")).toMatchObject({
      reason: "disputed",
    })
    expect(amount(records, "2026-11-08T12:00:00Z")).toBe(1000)
  })

  it("replaces a value only on the dates of a seasonal correction", () => {
    const records = line(
      [
        assertion("h", price(1000)),
        assertion("p", price(1300), {
          supersedes: "h",
          effectiveFrom: "2026-12-01",
          effectiveTo: "2026-12-31",
        }),
      ],
      [
        decision("h", "confirmed", "2026-11-01T09:00:00Z"),
        decision("p", "confirmed", "2026-11-10T09:00:00Z"),
      ]
    )
    expect(amount(records, "2026-11-30T23:59:59Z")).toBe(1000)
    expect(amount(records, "2026-12-15T12:00:00Z")).toBe(1300)
    expect(amount(records, "2026-12-31T23:59:59Z")).toBe(1300)
    expect(amount(records, "2027-01-01T00:00:00Z")).toBe(1000)
  })

  it("keeps the current value when a future correction is withdrawn before it starts", () => {
    const records = line(
      [
        assertion("h", price(1000)),
        assertion("p", price(1100), {
          supersedes: "h",
          effectiveFrom: "2026-11-20",
        }),
      ],
      [
        decision("h", "confirmed", "2026-11-01T09:00:00Z"),
        decision("p", "confirmed", "2026-11-10T09:00:00Z"),
        decision("p", "withdrawn", "2026-11-12T09:00:00Z"),
      ]
    )
    expect(amount(records, "2026-11-25T12:00:00Z")).toBe(1000)
    expect(tradingHead(records, "price")).toBe("h")
  })

  it("lets the latest correction win through a chain that has not started", () => {
    const records = line(
      [
        assertion("h", price(1000)),
        assertion("p1", price(1100), {
          supersedes: "h",
          effectiveFrom: "2026-11-20",
        }),
        assertion("p2", price(1050), { supersedes: "p1" }),
      ],
      [
        decision("h", "confirmed", "2026-11-01T09:00:00Z"),
        decision("p1", "confirmed", "2026-11-10T09:00:00Z"),
        decision("p2", "confirmed", "2026-11-11T09:00:00Z"),
      ]
    )
    expect(amount(records, "2026-11-11T12:00:00Z")).toBe(1050)
    expect(amount(records, "2026-11-25T12:00:00Z")).toBe(1050)
    expect(tradingHead(records, "price")).toBe("p2")
  })
})

describe("temporary unavailability (§5.2 #5, A1-6)", () => {
  const temp = (until: string | null): TradingValue => ({
    state: "temporarily_unavailable",
    until,
  })
  const always: TradingValue = { state: "always" }
  const records = () =>
    line(
      [
        assertion("av", always, { field: "availability" }),
        assertion("t1", temp("2026-11-10T18:00:00Z"), {
          field: "temporary_unavailability",
        }),
      ],
      [
        decision("av", "confirmed", "2026-11-01T09:00:00Z"),
        decision("t1", "confirmed", "2026-11-10T12:00:00Z"),
      ]
    )

  it("takes priority over availability before `until`", () => {
    expect(resolveAvailability(records(), "2026-11-10T11:00:00Z")).toEqual({
      state: "available",
      source: "always",
    })
    expect(resolveAvailability(records(), "2026-11-10T17:59:59Z")).toEqual({
      state: "temporarily_unavailable",
      until: "2026-11-10T18:00:00Z",
    })
  })

  it("reads needs_checking at and after `until`, never silently available, with no job", () => {
    for (const at of ["2026-11-10T18:00:00Z", "2026-11-12T09:00:00Z"])
      expect(resolveAvailability(records(), at)).toEqual({
        state: "needs_checking",
        reason: "stale",
        detail: "recheck_requested",
        until: "2026-11-10T18:00:00Z",
      })
  })

  it("stays needs_checking while a later report is only proposed", () => {
    const r = records()
    r.assertions.push(
      assertion(
        "t2",
        { state: "back_in_service" },
        {
          field: "temporary_unavailability",
          supersedes: "t1",
          basis: "staff_report",
        }
      )
    )
    expect(resolveTemporary(r, "2026-11-11T09:00:00Z")).toMatchObject({
      state: "needs_checking",
      assertionId: "t1",
    })
    r.decisions.push(decision("t2", "declined", "2026-11-11T10:00:00Z"))
    expect(resolveTemporary(r, "2026-11-11T11:00:00Z")).toMatchObject({
      state: "needs_checking",
    })
  })

  it("ends with a confirmed return to service or a withdrawal", () => {
    const r = records()
    r.assertions.push(
      assertion(
        "t2",
        { state: "back_in_service" },
        {
          field: "temporary_unavailability",
          supersedes: "t1",
        }
      )
    )
    r.decisions.push(decision("t2", "confirmed", "2026-11-11T10:00:00Z"))
    expect(resolveTemporary(r, "2026-11-11T10:00:00Z")).toBeNull()
    expect(resolveAvailability(r, "2026-11-11T10:00:00Z")).toEqual({
      state: "available",
      source: "always",
    })
    const w = records()
    w.decisions.push(decision("t1", "withdrawn", "2026-11-10T13:00:00Z"))
    expect(resolveTemporary(w, "2026-11-10T14:00:00Z")).toBeNull()
  })

  it("keeps an open-ended statement in force", () => {
    const r = line(
      [assertion("t", temp(null), { field: "temporary_unavailability" })],
      [decision("t", "confirmed", "2026-11-10T12:00:00Z")]
    )
    expect(resolveAvailability(r, "2027-01-01T00:00:00Z")).toEqual({
      state: "temporarily_unavailable",
      until: null,
    })
  })
})

// ---------------------------------------------------------------------------
// Availability schedules over the B03 occurrence fixtures
// ---------------------------------------------------------------------------

type FixtureCase = {
  name: string
  input: {
    timezone: string
    effectiveFrom: string
    effectiveTo?: string
    recurrence: unknown
    windows: unknown
    exceptions?: LocalMenuSchedule["exceptions"]
    from: string
    to: string
  }
  expect: { occurrences?: Occurrence[] }
}

const { cases } = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/knowledge/occurrences.json"),
    "utf8"
  )
) as { cases: FixtureCase[] }

const scheduleOf = (c: FixtureCase): LocalMenuSchedule => ({
  id: "s",
  timezone: c.input.timezone,
  effectiveFrom: c.input.effectiveFrom,
  effectiveTo: c.input.effectiveTo ?? null,
  recurrence: c.input.recurrence,
  windows: c.input.windows,
  exceptions: c.input.exceptions ?? [],
})

describe("menu schedules over the shared B03 fixtures (§5.2 #4)", () => {
  const withOccurrences = cases.filter((c) => c.expect.occurrences?.length)

  it.each(withOccurrences.map((c) => [c.name, c] as const))(
    "%s: inside every occurrence, the read matches it",
    (_, c) => {
      const schedule = scheduleOf(c)
      for (const o of c.expect.occurrences!) {
        const mid = (Date.parse(o.startsAt) + Date.parse(o.endsAt)) / 2
        const state = scheduleStateAt(schedule, mid)
        if (o.state === "cancelled") {
          expect(["cancelled", "available"]).toContain(state.state)
        } else {
          expect(state.state).toBe("available")
        }
        if (state.state === "available" || state.state === "cancelled") {
          expect(Date.parse(state.occurrence.startsAt)).toBeLessThanOrEqual(mid)
          expect(Date.parse(state.occurrence.endsAt)).toBeGreaterThan(mid)
        }
      }
    }
  )

  const roast = scheduleOf(cases[0]!)

  it("keeps Sunday lunch at local noon across the October clock change", () => {
    expect(scheduleStateAt(roast, "2026-10-18T11:30:00Z")).toMatchObject({
      state: "available",
      occurrence: {
        localDate: "2026-10-18",
        startsAt: "2026-10-18T11:00:00.000Z",
      },
    })
    expect(scheduleStateAt(roast, "2026-10-25T11:30:00Z")).toEqual({
      state: "outside_window",
      source: "menu_schedule",
    })
    expect(scheduleStateAt(roast, "2026-10-25T12:30:00Z")).toMatchObject({
      state: "available",
      occurrence: { startsAt: "2026-10-25T12:00:00.000Z" },
    })
  })

  it("reads a cancelled Sunday as cancelled and a changed one at its new time", () => {
    expect(scheduleStateAt(roast, "2026-11-08T13:00:00Z")).toMatchObject({
      state: "cancelled",
      occurrence: { localDate: "2026-11-08", state: "cancelled" },
    })
    expect(scheduleStateAt(roast, "2026-11-15T12:30:00Z")).toMatchObject({
      state: "outside_window",
    })
    expect(scheduleStateAt(roast, "2026-11-15T15:30:00Z")).toMatchObject({
      state: "available",
      occurrence: { state: "changed" },
    })
    expect(scheduleStateAt(roast, "2026-11-11T19:00:00Z")).toMatchObject({
      state: "available",
      occurrence: { state: "extra" },
    })
  })

  it("reads not_offered after effectiveTo and before effectiveFrom", () => {
    expect(scheduleStateAt(roast, "2026-11-29T13:00:00Z")).toEqual({
      state: "not_offered",
      detail: "schedule_ended",
      source: "menu_schedule",
    })
    expect(scheduleStateAt(roast, "2026-09-27T13:00:00Z")).toEqual({
      state: "not_offered",
      detail: "not_started",
      source: "menu_schedule",
    })
  })

  it("gives a window past midnight to its start date, into the spring gap", () => {
    const late = scheduleOf(cases[1]!)
    // 00:30 GMT on Sunday 29 March: Saturday's 23:00–02:00 window.
    expect(localDateAt("2026-03-29T00:30:00Z", TZ)).toBe("2026-03-29")
    expect(scheduleStateAt(late, "2026-03-29T00:30:00Z")).toMatchObject({
      state: "available",
      occurrence: {
        localDate: "2026-03-28",
        startsAt: "2026-03-28T23:00:00.000Z",
        endsAt: "2026-03-29T01:00:00.000Z",
      },
    })
    expect(scheduleStateAt(late, "2026-03-29T01:00:00Z")).toMatchObject({
      state: "outside_window",
    })
  })

  it("reads the autumn repeated hour as the offset after the change", () => {
    const repeated = scheduleOf(cases[3]!)
    expect(scheduleStateAt(repeated, "2026-10-25T00:30:00Z")).toMatchObject({
      state: "outside_window",
    })
    expect(scheduleStateAt(repeated, "2026-10-25T01:15:00Z")).toMatchObject({
      state: "available",
    })
  })

  it("ignores an exception added after the instant read (history)", () => {
    const s: LocalMenuSchedule = {
      ...roast,
      exceptions: [
        {
          localDate: "2026-11-01",
          kind: "cancelled",
          createdAt: "2026-11-01T12:30:00Z",
        },
      ],
    }
    expect(scheduleStateAt(s, "2026-11-01T12:15:00Z")).toMatchObject({
      state: "available",
    })
    expect(scheduleStateAt(s, "2026-11-01T12:45:00Z")).toMatchObject({
      state: "cancelled",
    })
  })
})

describe("availability resolution with schedules and a linked B03 service", () => {
  const scheduled = (id: string): TradingValue => ({
    state: "scheduled",
    scheduleId: id,
  })
  const roastLine = (scheduleId: string) =>
    line(
      [assertion("a", scheduled(scheduleId), { field: "availability" })],
      [decision("a", "confirmed", "2026-10-01T09:00:00Z")]
    )

  it("reads a local schedule through the confirmed availability assertion", () => {
    const schedules = { s: scheduleOf(cases[0]!) }
    expect(
      resolveAvailability(roastLine("s"), "2026-10-18T11:30:00Z", schedules)
    ).toMatchObject({
      state: "available",
      source: "menu_schedule",
    })
    expect(
      resolveAvailability(roastLine("s"), "2026-10-19T11:30:00Z", schedules)
    ).toEqual({
      state: "outside_window",
      source: "menu_schedule",
    })
  })

  it("reads unknown with no confirmed availability, and not_offered when stated", () => {
    expect(resolveAvailability(line([], []), "2026-11-10T12:00:00Z")).toEqual({
      state: "unknown",
      reason: "unknown",
      detail: "not_recorded",
    })
    const notOffered = line(
      [assertion("n", { state: "not_offered" }, { field: "availability" })],
      [decision("n", "confirmed", "2026-11-01T09:00:00Z")]
    )
    expect(resolveAvailability(notOffered, "2026-11-10T12:00:00Z")).toEqual({
      state: "not_offered",
      detail: "not_offered",
    })
  })

  const linkedSchedule = {
    s: {
      id: "s",
      timezone: TZ,
      effectiveFrom: "2026-10-01",
      effectiveTo: null,
      knowledgeCheckId: "check",
    },
  }
  const sunday: Occurrence = {
    localDate: "2026-11-15",
    startsAt: "2026-11-15T12:00:00.000Z",
    endsAt: "2026-11-15T15:00:00.000Z",
    state: "scheduled",
  }

  it("consumes the B03 service occurrence while the service reads yes", () => {
    const out = resolveAvailability(
      roastLine("s"),
      "2026-11-15T13:00:00Z",
      linkedSchedule,
      () => ({ state: "offered", occurrences: [sunday] })
    )
    expect(out).toEqual({
      state: "available",
      source: "service",
      occurrence: sunday,
    })
  })

  it("reads not_offered once a deliberate stop is in effect (B03 reads No)", () => {
    const out = resolveAvailability(
      roastLine("s"),
      "2026-11-22T13:00:00Z",
      linkedSchedule,
      () => ({ state: "not_offered" })
    )
    expect(out).toEqual({ state: "not_offered", detail: "service_not_offered" })
  })

  it("passes B03's unavailable reason through, and reads not_recorded without a reading", () => {
    expect(
      resolveAvailability(
        roastLine("s"),
        "2026-11-15T13:00:00Z",
        linkedSchedule,
        () => ({
          state: "unknown",
          reason: "withdrawn",
          detail: "answer_withdrawn",
        })
      )
    ).toEqual({
      state: "unknown",
      reason: "withdrawn",
      detail: "answer_withdrawn",
    })
    // A past evidence state B03 cannot rebuild is unknown, never today's.
    expect(
      resolveAvailability(
        roastLine("s"),
        "2026-11-15T13:00:00Z",
        linkedSchedule,
        () => ({
          state: "unknown",
          reason: "unknown",
          detail: "service_history_unsupported",
        })
      )
    ).toEqual({
      state: "unknown",
      reason: "unknown",
      detail: "service_history_unsupported",
    })
    expect(
      resolveAvailability(
        roastLine("s"),
        "2026-11-15T13:00:00Z",
        linkedSchedule
      )
    ).toEqual({
      state: "unknown",
      reason: "unknown",
      detail: "not_recorded",
    })
  })

  it("keeps a service occurrence inside the menu schedule's own dates", () => {
    const bounded = { s: { ...linkedSchedule.s, effectiveTo: "2026-11-14" } }
    const out = resolveAvailability(
      roastLine("s"),
      "2026-11-15T13:00:00Z",
      bounded,
      () => ({ state: "offered", occurrences: [sunday] })
    )
    expect(out).toEqual({ state: "not_offered", detail: "schedule_ended" })
  })
})

describe("a declared portion or variant-meaning change (A1-6, B04-d2)", () => {
  const confirmedBefore = () => {
    const a = assertion("p", price(1400))
    const d = decision("p", "confirmed", "2026-11-10T09:00:00Z")
    return { a, d }
  }

  it("reads a value confirmed before the review as not_confirmed / pending from the review on, and unchanged before it", () => {
    const { a, d } = confirmedBefore()
    const records: LineRecords = {
      ...line([a], [d]),
      reviews: [{ openedAt: "2026-11-10T12:00:00Z", lastDecisionSeq: d.seq }],
    }
    expect(amount(records, "2026-11-10T11:59:59Z")).toBe(1400)
    expect(resolveField(records, "price", "2026-11-10T12:00:00Z")).toEqual({
      status: "unavailable",
      reason: "not_confirmed",
      detail: "pending",
      previousAssertionId: "p",
      reviewSince: "2026-11-10T12:00:00.000Z",
    })
  })

  it("orders by decision sequence, not the clock: a later confirmation at the same instant is current", () => {
    const { a, d } = confirmedBefore()
    const b = assertion("q", price(1450), { supersedes: "p" })
    const review = { openedAt: "2026-11-10T09:00:00Z", lastDecisionSeq: d.seq }
    const records: LineRecords = {
      ...line([a, b], [d, decision("q", "confirmed", "2026-11-10T09:00:00Z")]),
      reviews: [review],
    }
    expect(amount(records, "2026-11-10T09:00:00Z")).toBe(1450)
  })

  it("keeps withdrawn ahead of not_confirmed, and leaves temporary unavailability alone", () => {
    const { a, d } = confirmedBefore()
    const withdrawn: LineRecords = {
      ...line([a], [d, decision("p", "withdrawn", "2026-11-10T13:00:00Z")]),
      reviews: [{ openedAt: "2026-11-10T12:00:00Z", lastDecisionSeq: d.seq }],
    }
    expect(resolveField(withdrawn, "price", "2026-11-10T14:00:00Z")).toEqual({
      status: "unavailable",
      reason: "withdrawn",
      detail: "value_withdrawn",
    })
    const off = assertion(
      "t",
      { state: "temporarily_unavailable", until: null },
      {
        field: "temporary_unavailability",
      }
    )
    const offDecision = decision("t", "confirmed", "2026-11-10T09:00:00Z")
    const temporary: LineRecords = {
      ...line([off], [offDecision]),
      reviews: [
        { openedAt: "2026-11-10T12:00:00Z", lastDecisionSeq: offDecision.seq },
      ],
    }
    expect(
      resolveField(
        temporary,
        "temporary_unavailability",
        "2026-11-10T13:00:00Z"
      )
    ).toMatchObject({ status: "available", assertionId: "t" })
  })

  it("reads availability as unknown / not_confirmed while it waits", () => {
    const a = assertion("v", { state: "always" }, { field: "availability" })
    const d = decision("v", "confirmed", "2026-11-10T09:00:00Z")
    const records: LineRecords = {
      ...line([a], [d]),
      reviews: [{ openedAt: "2026-11-10T12:00:00Z", lastDecisionSeq: d.seq }],
    }
    expect(resolveAvailability(records, "2026-11-10T13:00:00Z")).toMatchObject({
      state: "unknown",
      reason: "not_confirmed",
      detail: "pending",
    })
  })
})
