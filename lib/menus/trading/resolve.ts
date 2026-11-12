// B04-b1 read-time resolution (docs: b04-design §5.5, A1-6). Mirrors
// private.menu_trading_field_state, private.menu_trading_head,
// private.menu_trading_temporary_state and private.menu_trading_availability
// in supabase/migrations/20261110203000_menu_b04b_trading_assertions.sql over
// one line's assertions and decisions. Pure: no job, no clock of its own.
//
// An assertion counts once confirmed at or before `at`. It starts at the later
// of its confirmation and venue-local midnight of effectiveFrom, and ends at
// local midnight after effectiveTo. A confirmed assertion that was in force at
// some moment (not withdrawn before it started) and covers `at` is covering.
// Every ancestor (supersedes chain) of a covering assertion drops out: a
// correction replaces what it supersedes on its own dates, and a withdrawal
// never brings an older value back. Of the rest, one unwithdrawn assertion is
// the value; two or more read disputed / conflict; only withdrawn ones read
// withdrawn / value_withdrawn; none reads unknown / not_recorded. A1-6
// (B04-d2): a single live price or availability confirmed before a line
// review opened at or before `at` reads not_confirmed / pending.

import {
  addDays,
  localMidnight,
  scheduleStateAt,
  type LinkedService,
  type MenuSchedule,
} from "./availability"
import type {
  AvailabilityState,
  FieldState,
  TradingAssertionRecord,
  TradingDecisionRecord,
  TradingField,
  TradingLineReviewRecord,
} from "./types"

export type LineRecords = {
  assertions: TradingAssertionRecord[]
  decisions: TradingDecisionRecord[]
  /** The venue's timezone (private.venue_timezone; Europe/London). */
  timeZone: string
  /** public.menu_trading_line_reviews of the line (A1-6); none when absent. */
  reviews?: TradingLineReviewRecord[]
}

type Confirmed = {
  a: TradingAssertionRecord
  confirmedAt: number
  confirmedSeq: number
  statedOn: string | null
  statedOnSource: FieldStateAvailable["statedOnSource"]
  withdrawnAt: number | null
  startsAt: number
  endsAt: number
}
type FieldStateAvailable = Extract<FieldState, { status: "available" }>

const ms = (v: Date | string | number) => new Date(v).getTime()
const iso = (v: number) => new Date(v).toISOString()

function confirmedRows(
  records: LineRecords,
  field: TradingField,
  atMs: number
): Confirmed[] {
  const out: Confirmed[] = []
  for (const a of records.assertions) {
    if (a.field !== field) continue
    const confirm = records.decisions.find(
      (d) =>
        d.assertionId === a.id &&
        d.decision === "confirmed" &&
        ms(d.decidedAt) <= atMs
    )
    if (!confirm) continue
    const withdraw = records.decisions.find(
      (d) =>
        d.assertionId === a.id &&
        d.decision === "withdrawn" &&
        ms(d.decidedAt) <= atMs
    )
    const confirmedAt = ms(confirm.decidedAt)
    out.push({
      a,
      confirmedAt,
      confirmedSeq: confirm.seq,
      statedOn: confirm.statedOn ?? null,
      statedOnSource: confirm.statedOnSource ?? null,
      withdrawnAt: withdraw ? ms(withdraw.decidedAt) : null,
      startsAt: Math.max(
        confirmedAt,
        a.effectiveFrom
          ? localMidnight(a.effectiveFrom, records.timeZone)
          : confirmedAt
      ),
      endsAt: a.effectiveTo
        ? localMidnight(addDays(a.effectiveTo, 1), records.timeZone)
        : Infinity,
    })
  }
  return out
}

/** private.menu_trading_field_state. */
export function resolveField(
  records: LineRecords,
  field: TradingField,
  at: Date | string | number
): FieldState {
  const atMs = ms(at)
  const covering = confirmedRows(records, field, atMs).filter(
    (x) =>
      x.startsAt <= atMs &&
      x.endsAt > atMs &&
      (x.withdrawnAt === null || x.withdrawnAt > x.startsAt)
  )
  const byId = new Map(records.assertions.map((a) => [a.id, a]))
  const ancestors = new Set<string>()
  for (const x of covering) {
    let next = x.a.supersedes
    while (next && !ancestors.has(next)) {
      ancestors.add(next)
      next = byId.get(next)?.supersedes ?? null
    }
  }
  const heads = covering.filter((x) => !ancestors.has(x.a.id))
  const live = heads.filter((x) => x.withdrawnAt === null)
  if (live.length === 1) {
    const l = live[0]!
    if (field !== "temporary_unavailability") {
      const since = (records.reviews ?? [])
        .filter(
          (r) => ms(r.openedAt) <= atMs && r.lastDecisionSeq >= l.confirmedSeq
        )
        .reduce<number | null>(
          (max, r) =>
            max === null || ms(r.openedAt) > max ? ms(r.openedAt) : max,
          null
        )
      if (since !== null)
        return {
          status: "unavailable",
          reason: "not_confirmed",
          detail: "pending",
          previousAssertionId: l.a.id,
          reviewSince: iso(since),
        }
    }
    return {
      status: "available",
      assertionId: l.a.id,
      value: l.a.value,
      updatedBy: l.a.basis === "source_mapping" ? "menu_source" : "manager",
      effectiveFrom: l.a.effectiveFrom,
      effectiveTo: l.a.effectiveTo,
      startsAt: iso(l.startsAt),
      endsAt: l.endsAt === Infinity ? null : iso(l.endsAt),
      confirmedAt: iso(l.confirmedAt),
      statedOn: l.statedOn,
      statedOnSource: l.statedOnSource,
    }
  }
  if (live.length > 1)
    return {
      status: "unavailable",
      reason: "disputed",
      detail: "conflict",
      assertionIds: [...live]
        .sort((x, y) =>
          x.confirmedAt === y.confirmedAt
            ? x.a.id < y.a.id
              ? -1
              : 1
            : x.confirmedAt - y.confirmedAt
        )
        .map((x) => x.a.id),
    }
  if (heads.length)
    return {
      status: "unavailable",
      reason: "withdrawn",
      detail: "value_withdrawn",
    }
  return { status: "unavailable", reason: "unknown", detail: "not_recorded" }
}

/**
 * private.menu_trading_head: the assertion a new proposal supersedes. Read at
 * the time of writing, so every recorded decision counts.
 */
export function tradingHead(
  records: LineRecords,
  field: TradingField
): string | null {
  const all = confirmedRows(records, field, Infinity)
  const effective = all.filter(
    (s) => s.withdrawnAt === null || s.withdrawnAt > s.startsAt
  )
  const heads = all
    .filter(
      (x) =>
        x.withdrawnAt === null &&
        !effective.some((s) => s.a.supersedes === x.a.id)
    )
    .sort((x, y) => y.confirmedSeq - x.confirmedSeq)
  return heads[0]?.a.id ?? null
}

export type TemporaryState =
  | {
      state: "temporarily_unavailable"
      until: string | null
      assertionId: string
    }
  | {
      state: "needs_checking"
      reason: "stale"
      detail: "recheck_requested"
      until: string
      assertionId: string
    }
  | {
      state: "unknown"
      reason: "disputed"
      detail: "conflict"
      field: "temporary_unavailability"
    }

/** private.menu_trading_temporary_state; null when none applies. */
export function resolveTemporary(
  records: LineRecords,
  at: Date | string | number
): TemporaryState | null {
  const state = resolveField(records, "temporary_unavailability", at)
  if (state.status === "available") {
    const value = state.value
    if (!("state" in value) || value.state !== "temporarily_unavailable")
      return null
    if (value.until === null || ms(at) < ms(value.until))
      return {
        state: "temporarily_unavailable",
        until: value.until,
        assertionId: state.assertionId,
      }
    return {
      state: "needs_checking",
      reason: "stale",
      detail: "recheck_requested",
      until: value.until,
      assertionId: state.assertionId,
    }
  }
  if (state.reason === "disputed")
    return {
      state: "unknown",
      reason: "disputed",
      detail: "conflict",
      field: "temporary_unavailability",
    }
  return null
}

/**
 * private.menu_trading_availability: temporary unavailability first, then the
 * confirmed availability assertion (always, not offered, or its schedule).
 * `linked` supplies a linked service as it stood at `at`, for a schedule id.
 */
export function resolveAvailability(
  records: LineRecords,
  at: Date | string | number,
  schedules: Record<string, MenuSchedule> = {},
  linked: (scheduleId: string) => LinkedService | null = () => null
): AvailabilityState {
  const temporary = resolveTemporary(records, at)
  if (temporary) {
    if (temporary.state === "unknown")
      return {
        state: "unknown",
        reason: temporary.reason,
        detail: temporary.detail,
      }
    return temporary.state === "temporarily_unavailable"
      ? { state: "temporarily_unavailable", until: temporary.until }
      : {
          state: "needs_checking",
          reason: "stale",
          detail: "recheck_requested",
          until: temporary.until,
        }
  }
  const state = resolveField(records, "availability", at)
  if (state.status !== "available")
    return { state: "unknown", reason: state.reason, detail: state.detail }
  const value = state.value
  if (!("state" in value))
    return { state: "unknown", reason: "unknown", detail: "not_recorded" }
  if (value.state === "always") return { state: "available", source: "always" }
  if (value.state === "not_offered")
    return { state: "not_offered", detail: "not_offered" }
  if (value.state !== "scheduled")
    return { state: "unknown", reason: "unknown", detail: "not_recorded" }
  const schedule = schedules[value.scheduleId]
  if (!schedule)
    return { state: "unknown", reason: "unknown", detail: "not_recorded" }
  const s = scheduleStateAt(schedule, at, linked(value.scheduleId))
  switch (s.state) {
    case "available":
      return { state: "available", source: s.source, occurrence: s.occurrence }
    case "cancelled":
      return { state: "cancelled", source: s.source, occurrence: s.occurrence }
    case "outside_window":
      return { state: "outside_window", source: s.source }
    case "not_offered":
      return { state: "not_offered", detail: s.detail }
    default:
      return { state: "unknown", reason: s.reason, detail: s.detail }
  }
}
