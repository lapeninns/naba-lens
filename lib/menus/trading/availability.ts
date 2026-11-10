// B04-02c (docs: b04-design §5.2 #4–5, §5.5 step 2, A1-4): a menu schedule at
// an instant. A local schedule expands through B03's shared occurrence
// expansion (expandScheduleOccurrences, the mirror of
// private.schedule_occurrences, b03-design A27) over the previous and current
// local dates, so a window past midnight belongs to its start date and local
// times hold across clock changes. A schedule linked to a B03 service check
// takes that service's B03 status, value and occurrences as input: B03 owns
// them, its deliberate stop and its recheck. Mirrors
// private.menu_trading_schedule_state. Pure.

import {
  expandScheduleOccurrences,
  localInstant,
  type Occurrence,
  type ScheduleException,
} from "@/lib/server/knowledge/schedules"

import type { OccurrenceView } from "./types"

export type LocalMenuSchedule = {
  id: string
  timezone: string
  effectiveFrom: string
  effectiveTo: string | null
  recurrence: unknown
  windows: unknown
  /** In the order they were added; createdAt filters a past read. */
  exceptions: (ScheduleException & { createdAt?: string })[]
  knowledgeCheckId?: null
}

export type LinkedMenuSchedule = {
  id: string
  timezone: string
  effectiveFrom: string
  effectiveTo: string | null
  knowledgeCheckId: string
}

export type MenuSchedule = LocalMenuSchedule | LinkedMenuSchedule

/**
 * What B03 says about the linked service at the instant read: its status
 * (private.knowledge_slot_state_b03: status, reason, detail, value; a
 * deliberate stop in effect reads value 'no') and its occurrences over the
 * previous and current local dates (public.knowledge_occurrences, which ends
 * them at a deliberate stop), or null when the reader may not read them.
 */
export type LinkedService = {
  status: string
  reason: string | null
  detail: string | null
  value: string | null
  occurrences: Occurrence[] | null
}

export type ScheduleState =
  | {
      state: "available" | "cancelled"
      occurrence: OccurrenceView
      source: "menu_schedule" | "service"
    }
  | { state: "outside_window"; source: "menu_schedule" | "service" }
  | {
      state: "not_offered"
      detail: "not_started" | "schedule_ended" | "service_not_offered"
      source: "menu_schedule" | "service"
    }
  | {
      state: "unknown"
      reason: string
      detail: string
      source?: "menu_schedule" | "service"
    }

const DAY = 86_400_000

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
/** The local date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateAt(
  at: Date | string | number,
  timeZone: string
): string {
  let f = dateFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    dateFormatters.set(timeZone, f)
  }
  return f.format(new Date(at))
}

const dayMs = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The calendar date `days` after `date`. */
export function addDays(date: string, days: number): string {
  return isoDay(dayMs(date) + days * DAY)
}

/** Venue-local midnight starting `date`, as `date::timestamp at time zone tz`. */
export function localMidnight(date: string, timeZone: string): number {
  return localInstant(dayMs(date), timeZone)
}

function pick(
  occurrences: Occurrence[],
  atMs: number
): { open: OccurrenceView | null; cancelled: OccurrenceView | null } {
  const covering = occurrences
    .filter(
      (o) => Date.parse(o.startsAt) <= atMs && Date.parse(o.endsAt) > atMs
    )
    .sort((a, b) =>
      a.startsAt === b.startsAt
        ? Date.parse(a.endsAt) - Date.parse(b.endsAt)
        : Date.parse(a.startsAt) - Date.parse(b.startsAt)
    )
  return {
    open: covering.find((o) => o.state !== "cancelled") ?? null,
    cancelled: covering.find((o) => o.state === "cancelled") ?? null,
  }
}

/** private.menu_trading_schedule_state. */
export function scheduleStateAt(
  schedule: MenuSchedule,
  at: Date | string | number,
  linked?: LinkedService | null
): ScheduleState {
  const atMs = new Date(at).getTime()
  const day = localDateAt(atMs, schedule.timezone)
  let found: { open: OccurrenceView | null; cancelled: OccurrenceView | null }
  let source: "menu_schedule" | "service"
  if (!schedule.knowledgeCheckId) {
    source = "menu_schedule"
    const local = schedule as LocalMenuSchedule
    const result = expandScheduleOccurrences({
      timezone: local.timezone,
      effectiveFrom: local.effectiveFrom,
      effectiveTo: local.effectiveTo,
      recurrence: local.recurrence,
      windows: local.windows,
      exceptions: local.exceptions
        .filter((e) => !e.createdAt || Date.parse(e.createdAt) <= atMs)
        .map(({ localDate, kind, windows }) =>
          windows ? { localDate, kind, windows } : { localDate, kind }
        ),
      from: addDays(day, -1),
      to: day,
    })
    if (!result.ok)
      return { state: "unknown", reason: "unknown", detail: "not_recorded" }
    found = pick(result.occurrences, atMs)
  } else {
    source = "service"
    if (!linked)
      return {
        state: "unknown",
        reason: "unknown",
        detail: "service_unreadable",
        source,
      }
    if (linked.status !== "available")
      return {
        state: "unknown",
        reason: linked.reason ?? "unknown",
        detail: linked.detail ?? "not_checked",
        source,
      }
    if (linked.value === "no")
      return { state: "not_offered", detail: "service_not_offered", source }
    if (linked.value !== "yes")
      return {
        state: "unknown",
        reason: "unknown",
        detail: "not_checked",
        source,
      }
    if (linked.occurrences === null)
      return {
        state: "unknown",
        reason: "unknown",
        detail: "service_unreadable",
        source,
      }
    found = pick(
      linked.occurrences.filter(
        (o) =>
          o.localDate >= schedule.effectiveFrom &&
          (schedule.effectiveTo === null || o.localDate <= schedule.effectiveTo)
      ),
      atMs
    )
  }
  if (found.open) return { state: "available", occurrence: found.open, source }
  if (found.cancelled)
    return { state: "cancelled", occurrence: found.cancelled, source }
  if (day < schedule.effectiveFrom)
    return { state: "not_offered", detail: "not_started", source }
  if (schedule.effectiveTo !== null && day > schedule.effectiveTo)
    return { state: "not_offered", detail: "schedule_ended", source }
  return { state: "outside_window", source }
}
