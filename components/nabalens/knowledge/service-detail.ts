// Service detail (b03-design §6; B03 UI design §5): when it runs, how guests
// order (takeaway, internal), broadcasters held (sports subscriptions), and
// the facility fields a service shares (fees, availability). A service has
// no places and no "how to ask": the server refuses them.

import type { ValueListItem } from "@/lib/knowledge-client/contract"

import {
  MONTH_WEEKS,
  WEEKDAYS,
  emptySchedule,
  scheduleErrors,
  scheduleFieldErrors,
  scheduleFromDetail,
  scheduleShape,
  scheduleTouched,
  type ScheduleDraft,
  type MonthWeek,
  type ScheduleField,
  type Weekday,
} from "./schedule-detail"

export type ServiceDraft = {
  schedule: ScheduleDraft
  /** takeaway_service: how guests order (internal), b03-design §6.3. */
  channels: string[]
  /** sports_subscription: codes from the broadcasters list (A9). */
  broadcasters: string[]
}

export type ServiceField = ScheduleField | "channels" | "broadcasters"

export const SERVICE_LIMITS = { channels: 10, channel: 40 } as const

export const SERVICE_COPY = {
  channels: "How guests order (internal)",
  channelsHelp: "For example ⟨phone⟩ or ⟨app⟩. Kept for staff and managers.",
  channel: (n: number) => `Way ${n}`,
  addChannel: "Add a way to order",
  removeChannel: (n: number) => `Remove way ${n}`,
  channelInvalid: `Use 1 to ${SERVICE_LIMITS.channel} characters.`,
  broadcasters: "Subscriptions held",
  noBroadcasters: "No broadcaster list is set up yet. Ask an admin.",
} as const

/** Fixed lines for the sport questions (§5.5), on the check page and form. */
export const SPORT_LINES: Record<string, string> = {
  sports_screens:
    "Screens only. This doesn't say which channels the venue has or which fixtures it shows.",
  sports_subscription:
    "Subscriptions only. Having a subscription isn't a promise to show any particular fixture.",
  sports_fixture_showing:
    "One fixture, on one date. It promises nothing about other fixtures.",
}

export function emptyService(): ServiceDraft {
  return { schedule: emptySchedule(), channels: [], broadcasters: [] }
}

export function serviceTouched(d: ServiceDraft): boolean {
  return (
    scheduleTouched(d.schedule) ||
    d.channels.some((c) => c.trim()) ||
    d.broadcasters.length > 0
  )
}

type Ctx = { channels: boolean; broadcasters: readonly ValueListItem[] | null }

/** The schedule is optional; once started it must be whole. */
export function serviceErrors(
  d: ServiceDraft,
  ctx: Ctx
): Partial<Record<ServiceField, string>> {
  const errors: Partial<Record<ServiceField, string>> = scheduleTouched(
    d.schedule
  )
    ? scheduleErrors(d.schedule)
    : {}
  if (
    ctx.channels &&
    d.channels.some(
      (c) =>
        c.trim() !== "" && Array.from(c.trim()).length > SERVICE_LIMITS.channel
    )
  )
    errors.channels = SERVICE_COPY.channelInvalid
  return errors
}

/** The service's own part of the detail (the facility part is merged in). */
export function serviceDetail(
  d: ServiceDraft,
  ctx: Ctx
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (scheduleTouched(d.schedule)) {
    const schedule = scheduleShape(d.schedule)
    if (schedule) out.schedule = schedule
  }
  const channels = d.channels.map((c) => c.trim()).filter(Boolean)
  if (ctx.channels && channels.length) out.channels = channels
  if (ctx.broadcasters && d.broadcasters.length)
    out.broadcasters = d.broadcasters.filter((code) =>
      ctx.broadcasters!.some((b) => b.code === code)
    )
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export function serviceFromDetail(
  detail: unknown,
  options?: { changeFrom?: string }
): ServiceDraft {
  const d = emptyService()
  if (!isRecord(detail)) return d
  if (isRecord(detail.schedule))
    d.schedule = scheduleFromDetail(detail.schedule, options)
  if (Array.isArray(detail.channels))
    d.channels = detail.channels.filter(
      (c): c is string => typeof c === "string"
    )
  if (Array.isArray(detail.broadcasters))
    d.broadcasters = detail.broadcasters.filter(
      (c): c is string => typeof c === "string"
    )
  return d
}

export function serviceFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): Partial<Record<ServiceField, string>> {
  const out: Partial<Record<ServiceField, string>> = {
    ...scheduleFieldErrors(fieldErrors),
  }
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (!message) continue
    const m = /^detail\.(channels|broadcasters)\b/.exec(path)
    if (m && !out[m[1] as ServiceField]) out[m[1] as ServiceField] = message
  }
  return out
}

/** A device draft's service part (the form's own model), defensively. */
export function serviceFromDraft(v: unknown): ServiceDraft {
  const d = emptyService()
  if (!isRecord(v)) return d
  const s = isRecord(v.schedule) ? v.schedule : null
  if (s) {
    const str = (x: unknown) => (typeof x === "string" ? x : "")
    const base = emptySchedule()
    d.schedule = {
      effectiveFrom: str(s.effectiveFrom),
      effectiveTo: str(s.effectiveTo),
      repeats:
        s.repeats === "monthly" || s.repeats === "dated" ? s.repeats : "weekly",
      days: Array.isArray(s.days)
        ? WEEKDAYS.filter((day) => (s.days as unknown[]).includes(day))
        : [],
      nth: (MONTH_WEEKS as unknown[]).includes(s.nth)
        ? (s.nth as MonthWeek)
        : null,
      monthDay: (WEEKDAYS as readonly unknown[]).includes(s.monthDay)
        ? (s.monthDay as Weekday)
        : "",
      dates: Array.isArray(s.dates)
        ? s.dates.filter((x): x is string => typeof x === "string")
        : [],
      windows: Array.isArray(s.windows)
        ? s.windows
            .filter(isRecord)
            .map((w) => ({ start: str(w.start), end: str(w.end) }))
        : base.windows,
    }
  }
  if (Array.isArray(v.channels))
    d.channels = v.channels.filter((c): c is string => typeof c === "string")
  if (Array.isArray(v.broadcasters))
    d.broadcasters = v.broadcasters.filter(
      (c): c is string => typeof c === "string"
    )
  return d
}
