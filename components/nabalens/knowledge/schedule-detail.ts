// Schedules in the capture form (B03 UI design §5.1, §5.3; b03-design §6.1):
// the When editor's model, the checks the server makes again
// (scheduleProblems), the shape sent inline as `detail.schedule`, and the
// words for occurrences the server computes. Dates are never computed here:
// the preview and Upcoming come from the server.

import type { Occurrence } from "@/lib/knowledge-client/contract"

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
export type Repeats = "weekly" | "monthly" | "dated"
export type MonthWeek = 1 | 2 | 3 | 4 | -1

export type WindowDraft = { start: string; end: string }

export type ScheduleDraft = {
  effectiveFrom: string
  effectiveTo: string
  repeats: Repeats
  days: Weekday[]
  nth: MonthWeek | null
  monthDay: Weekday | ""
  dates: string[]
  windows: WindowDraft[]
}

export type ScheduleField =
  "effectiveFrom" | "effectiveTo" | "recurrence" | "windows"

export const SCHEDULE_LIMITS = { windows: 6, dates: 60 } as const

export const DAY_LABEL: Record<Weekday, { short: string; long: string }> = {
  mon: { short: "Mon", long: "Monday" },
  tue: { short: "Tue", long: "Tuesday" },
  wed: { short: "Wed", long: "Wednesday" },
  thu: { short: "Thu", long: "Thursday" },
  fri: { short: "Fri", long: "Friday" },
  sat: { short: "Sat", long: "Saturday" },
  sun: { short: "Sun", long: "Sunday" },
}

export const MONTH_WEEKS: MonthWeek[] = [1, 2, 3, 4, -1]
export const MONTH_WEEK_LABEL: Record<string, string> = {
  "1": "1st",
  "2": "2nd",
  "3": "3rd",
  "4": "4th",
  "-1": "Last",
}

export const SCHEDULE_COPY = {
  when: "When",
  timezone: (zone: string) => `Times are ${zoneLabel(zone)}.`,
  startsOn: "Starts on",
  lastDay: "Last day offered (optional)",
  lastDayHelp:
    "Leave empty if there's no planned end. From the next day it reads Not offered.",
  changeFrom: "Change from",
  changeHelp:
    "Your change applies from the date you choose. Earlier dates keep the old times.",
  repeats: "Repeats",
  repeatsLabel: {
    weekly: "Every week on",
    monthly: "Every month on the",
    dated: "Only on these dates",
  } satisfies Record<Repeats, string>,
  whichDays: "Which days?",
  whichWeek: "Which week",
  whichDay: "Which day",
  date: (n: number) => `Date ${n}`,
  addDate: "Add a date",
  removeDate: (n: number) => `Remove date ${n}`,
  times: "Times",
  timesHelp: "Add another time if it runs twice in a day.",
  time: (n: number) => `Time ${n}`,
  from: "From",
  to: "To",
  endsNextDay: "Ends the next day.",
  addTime: "Add another time",
  removeTime: (n: number) => `Remove time ${n}`,
  startRequired: "Choose the day it starts.",
  endBeforeStart: "Choose a last day on or after the day it starts.",
  daysRequired: "Choose at least one day.",
  monthlyRequired: "Choose which week and which day.",
  datesRequired: "Add at least one date.",
  datesRepeat: "Each date only once.",
  windowsRequired: "Add at least one time.",
  windowInvalid: "Enter the times, for example 12:00 to 15:00.",
  previewTitle: "Next dates if you send this",
  previewInvalid: "Fix the highlighted times to see the dates.",
  previewFailed: "The dates couldn't be shown. You can still send.",
  previewNone: "No dates in the next 13 weeks.",
  previewShown: (n: number) =>
    n === 1 ? "1 date shown." : `${n} dates shown.`,
  upcoming: "Upcoming",
  upcomingNone: (weeks: number) => `No dates in the next ${weeks} weeks.`,
  lastDayPassed: (date: string) => `The last day offered was ${date}.`,
  upcomingFailed: "Upcoming dates couldn't be loaded.",
} as const

/** "UK time" for Europe/London (S§14.2 A6), else the zone's own name. */
export function zoneLabel(zone: string): string {
  return zone === "Europe/London" ? "UK time" : zone
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A window whose end is at or before its start runs past midnight. */
export const endsNextDay = (w: WindowDraft) =>
  HHMM.test(w.start) && HHMM.test(w.end) && w.end <= w.start

export function emptySchedule(): ScheduleDraft {
  return {
    effectiveFrom: "",
    effectiveTo: "",
    repeats: "weekly",
    days: [],
    nth: null,
    monthDay: "",
    dates: [],
    windows: [{ start: "", end: "" }],
  }
}

export function scheduleTouched(d: ScheduleDraft): boolean {
  return (
    d.effectiveFrom !== "" ||
    d.effectiveTo !== "" ||
    d.days.length > 0 ||
    d.nth !== null ||
    d.monthDay !== "" ||
    d.dates.some(Boolean) ||
    d.windows.some((w) => w.start || w.end)
  )
}

/** The first bad time row, for focus and its message. */
export function firstBadWindow(
  d: ScheduleDraft
): { index: number; part: "start" | "end" } | null {
  for (const [index, w] of d.windows.entries()) {
    if (!HHMM.test(w.start)) return { index, part: "start" }
    if (!HHMM.test(w.end) || w.end === w.start) return { index, part: "end" }
  }
  return null
}

/** What the server's scheduleProblems would refuse, in the form's words. */
export function scheduleErrors(
  d: ScheduleDraft
): Partial<Record<ScheduleField, string>> {
  const errors: Partial<Record<ScheduleField, string>> = {}
  if (!DATE.test(d.effectiveFrom))
    errors.effectiveFrom = SCHEDULE_COPY.startRequired
  if (
    d.effectiveTo &&
    DATE.test(d.effectiveFrom) &&
    d.effectiveTo < d.effectiveFrom
  )
    errors.effectiveTo = SCHEDULE_COPY.endBeforeStart
  if (d.repeats === "weekly" && !d.days.length)
    errors.recurrence = SCHEDULE_COPY.daysRequired
  if (d.repeats === "monthly" && (d.nth === null || !d.monthDay))
    errors.recurrence = SCHEDULE_COPY.monthlyRequired
  if (d.repeats === "dated") {
    const dates = d.dates.filter(Boolean)
    if (!dates.length) errors.recurrence = SCHEDULE_COPY.datesRequired
    else if (new Set(dates).size !== dates.length)
      errors.recurrence = SCHEDULE_COPY.datesRepeat
  }
  if (!d.windows.length) errors.windows = SCHEDULE_COPY.windowsRequired
  else if (firstBadWindow(d)) errors.windows = SCHEDULE_COPY.windowInvalid
  return errors
}

/** The inline `detail.schedule` (b03-design §6.1), or null while invalid. */
export function scheduleShape(
  d: ScheduleDraft
): Record<string, unknown> | null {
  if (Object.keys(scheduleErrors(d)).length) return null
  const recurrence =
    d.repeats === "weekly"
      ? { kind: "weekly", days: WEEKDAYS.filter((day) => d.days.includes(day)) }
      : d.repeats === "monthly"
        ? { kind: "monthly", nth: d.nth, day: d.monthDay }
        : { kind: "dated", dates: [...d.dates.filter(Boolean)].sort() }
  return {
    effectiveFrom: d.effectiveFrom,
    ...(d.effectiveTo ? { effectiveTo: d.effectiveTo } : {}),
    recurrence,
    windows: d.windows.map((w) => ({ start: w.start, end: w.end })),
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")

/**
 * A stored schedule back into the editor, defensively. Changing a schedule
 * in use starts from it, from `changeFrom` (§5.1); its last day is kept.
 */
export function scheduleFromDetail(
  v: unknown,
  { changeFrom }: { changeFrom?: string } = {}
): ScheduleDraft {
  const d = emptySchedule()
  if (!isRecord(v)) return d
  d.effectiveFrom =
    changeFrom ?? (DATE.test(str(v.effectiveFrom)) ? str(v.effectiveFrom) : "")
  d.effectiveTo = DATE.test(str(v.effectiveTo)) ? str(v.effectiveTo) : ""
  const r = v.recurrence
  if (isRecord(r)) {
    if (r.kind === "weekly" && Array.isArray(r.days)) {
      d.repeats = "weekly"
      d.days = WEEKDAYS.filter((day) => (r.days as unknown[]).includes(day))
    } else if (r.kind === "monthly") {
      d.repeats = "monthly"
      d.nth = (MONTH_WEEKS as unknown[]).includes(r.nth)
        ? (r.nth as MonthWeek)
        : null
      d.monthDay = (WEEKDAYS as readonly unknown[]).includes(r.day)
        ? (r.day as Weekday)
        : ""
    } else if (r.kind === "dated" && Array.isArray(r.dates)) {
      d.repeats = "dated"
      d.dates = r.dates.filter(
        (x): x is string => typeof x === "string" && DATE.test(x)
      )
    }
  }
  if (Array.isArray(v.windows)) {
    const windows = v.windows
      .filter(isRecord)
      .map((w) => ({ start: str(w.start), end: str(w.end) }))
    if (windows.length) d.windows = windows
  }
  return d
}

/** The section a server error path belongs to, e.g. detail.schedule.windows[1].end. */
export function scheduleFieldOf(path: string): ScheduleField | null {
  const m =
    /^detail\.schedule(?:\.(effectiveFrom|effectiveTo|recurrence|windows))?\b/.exec(
      path
    )
  if (!m) return null
  return (m[1] as ScheduleField | undefined) ?? "recurrence"
}

export function scheduleFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): Partial<Record<ScheduleField, string>> {
  const out: Partial<Record<ScheduleField, string>> = {}
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (!message) continue
    const field = scheduleFieldOf(path)
    if (field && !out[field]) out[field] = message
  }
  return out
}

/** The London (or venue) local date after `date`, YYYY-MM-DD. */
export function nextDay(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`) + 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(zone: string, opts: Intl.DateTimeFormatOptions, key: string) {
  const k = `${zone}|${key}`
  let f = fmtCache.get(k)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...opts })
    fmtCache.set(k, f)
  }
  return f
}

const timeIn = (iso: string, zone: string) =>
  fmt(
    zone,
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    "t"
  ).format(new Date(iso))

/** "Sunday 16 Nov 2026" for a local date (no zone shift: it's a date). */
export function localDateWords(date: string): string {
  const parts = fmt(
    "UTC",
    { weekday: "long", day: "numeric", month: "short", year: "numeric" },
    "d"
  ).formatToParts(new Date(`${date}T12:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ""
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`
}

/**
 * One occurrence in words, in the venue's time (§5.3): "{weekday} {date},
 * {from} to {to}", past midnight "(ends the next day)", and its exception.
 */
export function occurrenceLine(o: Occurrence, zone: string): string {
  const day = localDateWords(o.localDate)
  if (o.state === "cancelled") return `${day}: cancelled`
  const from = timeIn(o.startsAt, zone)
  const to = timeIn(o.endsAt, zone)
  const endDate = fmt(
    zone,
    { year: "numeric", month: "2-digit", day: "2-digit" },
    "ymd"
  ).formatToParts(new Date(o.endsAt))
  const ymd = `${endDate.find((p) => p.type === "year")?.value}-${endDate.find((p) => p.type === "month")?.value}-${endDate.find((p) => p.type === "day")?.value}`
  const next = ymd !== o.localDate ? " (ends the next day)" : ""
  const suffix =
    o.state === "changed"
      ? " (different times)"
      : o.state === "extra"
        ? " (extra date)"
        : ""
  return `${day}, ${from} to ${to}${next}${suffix}`
}

export const DATE_CHANGE_COPY = {
  open: "Add a change for one date",
  title: "Add a change for one date",
  description:
    "For one date on the schedule in use. The rest of the schedule stays as it is.",
  date: "Date",
  what: "What happens",
  kindLabel: {
    cancelled: "Cancelled",
    changed_window: "Different times",
    extra: "Extra date",
  },
  from: "From",
  to: "To",
  note: "Note (internal, optional)",
  submit: "Add change",
  cancel: "Cancel",
  dateRequired: "Choose the date.",
  kindRequired: "Choose what happens on that date.",
  timesInvalid: "Enter the times, for example 12:00 to 15:00.",
  added: (date: string, kind: "cancelled" | "changed_window" | "extra") =>
    `${localDateWords(date)}: ${
      kind === "cancelled"
        ? "cancelled"
        : kind === "changed_window"
          ? "times changed"
          : "added"
    }.`,
  conflict:
    "This question changed since you opened it. Nothing was changed. Reload to see the latest.",
  lost: "We couldn't confirm the change was saved. Try again; it won't be added twice.",
  staffLine: "Something different on a date? Report a change.",
  tryAgain: "Try again",
  reload: "Reload",
} as const
