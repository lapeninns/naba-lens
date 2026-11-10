// Schedules (docs/knowledge/b03-design.md §6.1, A27): the shape checks and
// the occurrence expansion, mirroring private.schedule_problems,
// private.schedule_window_problems, private.schedule_exception_problems and
// private.schedule_occurrences. Pure, so B04 can use them for menu
// availability windows. tests/fixtures/knowledge/occurrences.json runs
// through both sides.

import type { ValueFieldProblem } from "@/lib/knowledge/contract"

import { safeDate } from "./dates"

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const
export type Weekday = (typeof WEEKDAYS)[number]

export type ScheduleWindow = { start: string; end: string }
export type Recurrence =
  | { kind: "weekly"; days: Weekday[] }
  | { kind: "monthly"; nth: 1 | 2 | 3 | 4 | 5 | -1; day: Weekday }
  | { kind: "dated"; dates: string[] }
export type ScheduleShape = {
  effectiveFrom: string
  effectiveTo?: string
  recurrence: Recurrence
  windows: ScheduleWindow[]
}
export type ScheduleException = {
  localDate: string
  kind: "cancelled" | "changed_window" | "extra"
  windows?: ScheduleWindow[]
}
export type Occurrence = {
  localDate: string
  /** UTC instants, ISO 8601. */
  startsAt: string
  endsAt: string
  state: "scheduled" | "cancelled" | "changed" | "extra"
}
export type ExpandResult =
  | { ok: true; occurrences: Occurrence[] }
  | { ok: false; reason: "invalid_range" | "invalid_timezone" }
  | { ok: false; reason: "invalid_value"; fields: ValueFieldProblem[] }

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const MAX_DAYS = 92
const DAY = 86_400_000

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const has = (o: Json, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const onlyKeys = (o: Json, keys: string[]) =>
  Object.keys(o).every((k) => keys.includes(k))
const problem = (
  path: string,
  p: ValueFieldProblem["problem"]
): ValueFieldProblem => ({ path, problem: p })

export function scheduleWindowProblems(
  path: string,
  windows: unknown
): ValueFieldProblem[] {
  if (!Array.isArray(windows) || windows.length < 1 || windows.length > 6)
    return [problem(path, "invalid")]
  const out: ValueFieldProblem[] = []
  windows.forEach((w: unknown, i) => {
    if (
      !isRecord(w) ||
      !onlyKeys(w, ["start", "end"]) ||
      typeof w.start !== "string" ||
      !HHMM.test(w.start) ||
      typeof w.end !== "string" ||
      !HHMM.test(w.end) ||
      w.start === w.end
    )
      out.push(problem(`${path}[${i}]`, "invalid"))
  })
  return out
}

const RECURRENCE_KEYS: Record<string, string[]> = {
  weekly: ["kind", "days"],
  monthly: ["kind", "nth", "day"],
  dated: ["kind", "dates"],
}

export function scheduleProblems(
  path: string,
  schedule: unknown
): ValueFieldProblem[] {
  if (!isRecord(schedule)) return [problem(path, "invalid")]
  const out: ValueFieldProblem[] = []
  for (const key of Object.keys(schedule).sort())
    if (
      !["effectiveFrom", "effectiveTo", "recurrence", "windows"].includes(key)
    )
      out.push(problem(`${path}.${key}`, "not_allowed"))

  let from: string | null = null
  if (!has(schedule, "effectiveFrom"))
    out.push(problem(`${path}.effectiveFrom`, "required"))
  else {
    from = safeDate(schedule.effectiveFrom)
    if (!from) out.push(problem(`${path}.effectiveFrom`, "invalid"))
  }
  if (has(schedule, "effectiveTo")) {
    const to = safeDate(schedule.effectiveTo)
    if (!to) out.push(problem(`${path}.effectiveTo`, "invalid"))
    else if (from && to < from)
      out.push(problem(`${path}.effectiveTo`, "out_of_range"))
  }

  if (!has(schedule, "recurrence"))
    out.push(problem(`${path}.recurrence`, "required"))
  else {
    const r = schedule.recurrence
    const kind = isRecord(r) && typeof r.kind === "string" ? r.kind : null
    if (
      !isRecord(r) ||
      !kind ||
      !RECURRENCE_KEYS[kind] ||
      !onlyKeys(r, RECURRENCE_KEYS[kind]!)
    )
      out.push(problem(`${path}.recurrence`, "invalid"))
    else if (kind === "weekly") {
      const days = r.days
      if (
        !Array.isArray(days) ||
        days.length < 1 ||
        days.length > 7 ||
        days.some(
          (d) => typeof d !== "string" || !WEEKDAYS.includes(d as Weekday)
        ) ||
        new Set(days).size !== days.length
      )
        out.push(problem(`${path}.recurrence.days`, "invalid"))
    } else if (kind === "monthly") {
      if (typeof r.nth !== "number" || ![1, 2, 3, 4, 5, -1].includes(r.nth))
        out.push(problem(`${path}.recurrence.nth`, "invalid"))
      if (typeof r.day !== "string" || !WEEKDAYS.includes(r.day as Weekday))
        out.push(problem(`${path}.recurrence.day`, "invalid"))
    } else {
      const dates = r.dates
      if (
        !Array.isArray(dates) ||
        dates.length < 1 ||
        dates.length > 60 ||
        dates.some((d) => !safeDate(d)) ||
        new Set(dates).size !== dates.length
      )
        out.push(problem(`${path}.recurrence.dates`, "invalid"))
    }
  }

  if (!has(schedule, "windows"))
    out.push(problem(`${path}.windows`, "required"))
  else out.push(...scheduleWindowProblems(`${path}.windows`, schedule.windows))
  return out
}

export function scheduleExceptionProblems(
  path: string,
  exceptions: unknown
): ValueFieldProblem[] {
  if (exceptions === null || exceptions === undefined) return []
  if (!Array.isArray(exceptions) || exceptions.length > 400)
    return [problem(path, "invalid")]
  const out: ValueFieldProblem[] = []
  exceptions.forEach((e: unknown, i) => {
    const p = `${path}[${i}]`
    if (
      !isRecord(e) ||
      !onlyKeys(e, ["localDate", "kind", "windows"]) ||
      !safeDate(e.localDate) ||
      typeof e.kind !== "string" ||
      !["cancelled", "changed_window", "extra"].includes(e.kind) ||
      (e.kind === "cancelled" && has(e, "windows"))
    )
      out.push(problem(p, "invalid"))
    else if (e.kind !== "cancelled")
      out.push(...scheduleWindowProblems(`${p}.windows`, e.windows))
  })
  return out
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** The zone's UTC offset at an instant, in milliseconds. */
function offsetAt(utc: number, timeZone: string): number {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(utc))
      .map((p) => [p.type, p.value])
  ) as Record<string, string>
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return local - Math.floor(utc / 1000) * 1000
}

/**
 * A local wall-clock time as an instant, as Postgres reads
 * `timestamp at time zone`: in a spring gap the offset before the change, in
 * an autumn overlap the offset after it.
 */
export function localInstant(localMs: number, timeZone: string): number {
  const before = offsetAt(localMs - 12 * 3_600_000, timeZone)
  const after = offsetAt(localMs + 12 * 3_600_000, timeZone)
  if (before === after) return localMs - before
  const early = localMs - before
  const late = localMs - after
  const earlyOk = offsetAt(early, timeZone) === before
  const lateOk = offsetAt(late, timeZone) === after
  if (earlyOk && lateOk) return late
  if (!earlyOk && !lateOk) return early
  return earlyOk ? early : late
}

const dayMs = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number]
  return (h * 60 + m) * 60_000
}

function windowRows(
  day: number,
  windows: ScheduleWindow[],
  state: Occurrence["state"],
  timeZone: string
): Occurrence[] {
  return [...windows]
    .sort((a, b) =>
      a.start === b.start
        ? a.end < b.end
          ? -1
          : 1
        : a.start < b.start
          ? -1
          : 1
    )
    .map((w) => {
      const start = minutes(w.start)
      const end = minutes(w.end)
      return {
        localDate: isoDay(day),
        startsAt: new Date(localInstant(day + start, timeZone)).toISOString(),
        endsAt: new Date(
          localInstant(day + (end <= start ? DAY : 0) + end, timeZone)
        ).toISOString(),
        state,
      }
    })
}

/** private.schedule_occurrences: local dates from..to (at most 92 days). */
export function expandScheduleOccurrences(input: {
  timezone: string
  effectiveFrom: string
  effectiveTo?: string | null
  recurrence: unknown
  windows: unknown
  exceptions?: unknown
  from: string
  to: string
}): ExpandResult {
  const from = safeDate(input.from)
  const to = safeDate(input.to)
  if (
    !from ||
    !to ||
    to < from ||
    (dayMs(to) - dayMs(from)) / DAY > MAX_DAYS - 1
  )
    return { ok: false, reason: "invalid_range" }
  try {
    formatter(input.timezone)
  } catch {
    return { ok: false, reason: "invalid_timezone" }
  }
  const shape: Json = {
    effectiveFrom: input.effectiveFrom,
    recurrence: input.recurrence,
    windows: input.windows,
  }
  if (input.effectiveTo) shape.effectiveTo = input.effectiveTo
  const fields = [
    ...scheduleProblems("schedule", shape),
    ...scheduleExceptionProblems("exceptions", input.exceptions),
  ]
  if (fields.length) return { ok: false, reason: "invalid_value", fields }

  const recurrence = input.recurrence as Recurrence
  const windows = input.windows as ScheduleWindow[]
  const exceptions = (input.exceptions ?? []) as ScheduleException[]
  const first = Math.max(dayMs(from), dayMs(input.effectiveFrom))
  const last = Math.min(
    dayMs(to),
    input.effectiveTo ? dayMs(input.effectiveTo) : dayMs(to)
  )
  const out: Occurrence[] = []
  for (let day = first; day <= last; day += DAY) {
    const date = isoDay(day)
    const name = WEEKDAYS[(new Date(day).getUTCDay() + 6) % 7]!
    const dom = new Date(day).getUTCDate()
    const monthDays = new Date(
      Date.UTC(
        new Date(day).getUTCFullYear(),
        new Date(day).getUTCMonth() + 1,
        0
      )
    ).getUTCDate()
    const scheduled =
      recurrence.kind === "weekly"
        ? recurrence.days.includes(name)
        : recurrence.kind === "monthly"
          ? name === recurrence.day &&
            (recurrence.nth === -1
              ? dom + 7 > monthDays
              : Math.floor((dom - 1) / 7) + 1 === recurrence.nth)
          : recurrence.dates.includes(date)
    const exception = [...exceptions]
      .reverse()
      .find(
        (e) =>
          e.localDate === date &&
          (e.kind === "cancelled" || e.kind === "changed_window")
      )
    if (scheduled) {
      if (exception?.kind === "cancelled")
        out.push(...windowRows(day, windows, "cancelled", input.timezone))
      else if (exception?.kind === "changed_window")
        out.push(
          ...windowRows(day, exception.windows!, "changed", input.timezone)
        )
      else out.push(...windowRows(day, windows, "scheduled", input.timezone))
    }
    const extras = exceptions
      .filter((e) => e.localDate === date && e.kind === "extra")
      .flatMap((e) => e.windows!)
    if (extras.length)
      out.push(...windowRows(day, extras, "extra", input.timezone))
  }
  return { ok: true, occurrences: out }
}
