// Europe/London calendar helpers for coverage periods. The database decides
// which month "now" is (private.current_london_month); these only label and
// convert values for display and validate input shapes.

import type { DueView, LocalDate, PeriodKey, PeriodView } from "./types"

const LONDON = "Europe/London"
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})
const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
})

function londonParts(instant: Date) {
  const parts: Record<string, number> = {}
  for (const p of PARTS.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value)
  }
  return parts as Record<
    "year" | "month" | "day" | "hour" | "minute" | "second",
    number
  >
}

function offsetMs(instant: Date): number {
  const p = londonParts(instant)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall - Math.floor(instant.getTime() / 1000) * 1000
}

/** UTC instant of London midnight starting this calendar day (`day` may overflow). */
export function londonMidnight(year: number, month: number, day: number): Date {
  const wall = Date.UTC(year, month - 1, day)
  const first = wall - offsetMs(new Date(wall))
  // UK clocks change at 01:00 UTC, so midnight is never skipped; one
  // correction covers a guess that landed on the other side of a change.
  const second = wall - offsetMs(new Date(first))
  return new Date(second)
}

export function periodKeyOf(instant: Date): PeriodKey {
  const p = londonParts(instant)
  return `${p.year}-${String(p.month).padStart(2, "0")}`
}

export function localDateOf(instant: Date): LocalDate {
  const p = londonParts(instant)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

export function isPeriodKey(value: unknown): value is PeriodKey {
  if (typeof value !== "string") return false
  const match = PERIOD.exec(value)
  return !!match && Number(match[1]) >= 2000 && Number(match[1]) <= 2999
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false
  const match = DAY.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    y >= 2000 &&
    y <= 2999 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}

/** The database's `period_month` date (day 1) for a period. */
export function periodMonthDate(key: PeriodKey): string {
  return `${key}-01`
}

/** Period of a `date` column value ("2026-11-01") or "YYYY-MM-DD". */
export function periodOfDate(value: string): PeriodKey {
  return value.slice(0, 7)
}

export function shiftPeriod(key: PeriodKey, months: number): PeriodKey {
  const [y, m] = key.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export function periodView(key: PeriodKey, now: Date = new Date()): PeriodView {
  const [y, m] = key.split("-").map(Number)
  return {
    key,
    label: MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1))),
    startsAt: londonMidnight(y, m, 1).toISOString(),
    endsAt: londonMidnight(y, m + 1, 1).toISOString(),
    isCurrent: periodKeyOf(now) === key,
    timeZone: LONDON,
  }
}

export function dayLabel(day: LocalDate): string {
  const [y, m, d] = day.split("-").map(Number)
  return DAY_LABEL.format(new Date(Date.UTC(y, m - 1, d)))
}

export function dueView(dueOn: LocalDate, overdue: boolean): DueView {
  const [y, m, d] = dueOn.split("-").map(Number)
  return {
    dueOn,
    dueAt: londonMidnight(y, m, d + 1).toISOString(),
    label: `Due ${dayLabel(dueOn)}`,
    overdue,
  }
}

/**
 * A manager's "needed by" date on one still-needed dish (v0.5 rule 24,
 * decision 1). Deliberately separate from `DueView`: it orders the list and is
 * shown, but it has no overdue state, so it carries no flag a screen could
 * draw as late. Until the end of the day (London) it reads "Needed by 30 Nov";
 * after that just "Needed", and the dish stays first in the list.
 */
export type NeededByView = {
  neededBy: LocalDate
  /** "Needed by 30 Nov" (the year is added outside this year), then "Needed". */
  label: string
}

const NEEDED_BY_SHORT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
})

export const NEEDED_WORD = "Needed"

/** Null for no date or a value that is not a calendar day. */
export function neededByView(
  neededBy: LocalDate | null | undefined,
  now: Date = new Date()
): NeededByView | null {
  if (!isLocalDate(neededBy)) return null
  const today = localDateOf(now)
  if (neededBy < today) return { neededBy, label: NEEDED_WORD }
  const [y, m, d] = neededBy.split("-").map(Number)
  const day =
    today.slice(0, 4) === neededBy.slice(0, 4)
      ? NEEDED_BY_SHORT.format(new Date(Date.UTC(y, m - 1, d)))
      : dayLabel(neededBy)
  return { neededBy, label: `${NEEDED_WORD} by ${day}` }
}

/** Overdue for display: the due day has passed in London and the work is not complete. */
export function isOverdue(
  dueOn: LocalDate | null,
  complete: boolean,
  now: Date = new Date()
): boolean {
  return !!dueOn && !complete && dueOn < localDateOf(now)
}
