// Ordering and target wording for the Team screens. Pure: safe in Server and
// Client Components.
import { TARGET_SOURCE_LABEL, labelFor, monthName } from "./copy"
import type { MonthlyProgress, PeriodKey } from "./types"

export type PeriodTiming = "past" | "current" | "future"

export function timingOf(period: PeriodKey, current: PeriodKey): PeriodTiming {
  return period < current ? "past" : period === current ? "current" : "future"
}

/** When a target change must carry a reason (current-month edits, any past month). */
export function targetReasonRequired(
  row: Pick<MonthlyProgress, "targetCount" | "source">,
  timing: PeriodTiming
): boolean {
  if (timing === "past") return true
  return (
    timing === "current" &&
    row.targetCount != null &&
    row.source !== "placeholder"
  )
}

function previousPeriod(period: PeriodKey): PeriodKey {
  const [year, month] = period.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

/** A to Z by surname, ties by the whole name. */
export function bySurname(a: string, b: string): number {
  const options = { sensitivity: "base" } as const
  return (
    surname(a).localeCompare(surname(b), "en-GB", options) ||
    a.localeCompare(b, "en-GB", options)
  )
}

/** Needs setup first, then A to Z by surname; never by progress. */
export function rosterOrder(a: MonthlyProgress, b: MonthlyProgress): number {
  const setup =
    Number(b.status === "needs_setup") - Number(a.status === "needs_setup")
  if (setup !== 0) return setup
  return bySurname(a.person.displayName, b.person.displayName)
}

/** Where the target came from, in the row's own words. */
export function targetSourceText(
  row: Pick<MonthlyProgress, "source">,
  period: PeriodKey,
  timing: PeriodTiming
): string | null {
  if (!row.source || row.source === "placeholder") return null
  if (row.source === "copied" && timing === "past")
    return `Copied from ${monthName(previousPeriod(period))}`
  return labelFor(TARGET_SOURCE_LABEL, row.source)
}
