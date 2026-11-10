// A dated event (b03-design §6.3, §6.4; B03 UI design §5.5): one fixture
// showing, on one date, committed by a manager or an admin. It ends at its
// window's end; it promises nothing about other fixtures.

export type EventDraft = {
  title: string
  localDate: string
  start: string
  end: string
}

export type EventField = "title" | "localDate" | "window"

export const EVENT_LIMITS = { title: 120 } as const

export const EVENT_COPY = {
  title: "Fixture",
  date: "Date",
  from: "From",
  to: "To",
  endsNextDay: "Ends the next day.",
  whoCommitted: "Who committed",
  titleRequired: "Name the fixture.",
  dateRequired: "Choose the date.",
  windowInvalid:
    "Enter the times, for example 19:45 to 22:00, or leave both empty.",
  staffReadOnly: "Your manager commits to showing a fixture.",
  commit: "Commit to showing a fixture",
} as const

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function emptyEvent(): EventDraft {
  return { title: "", localDate: "", start: "", end: "" }
}

export const eventTouched = (d: EventDraft) =>
  Boolean(d.title.trim() || d.localDate || d.start || d.end)

/** A Yes commits to one showing: its fixture and date; times optional, both or neither. */
export function eventErrors(
  d: EventDraft,
  answer: string | null
): Partial<Record<EventField, string>> {
  if (answer !== "yes") return {}
  const errors: Partial<Record<EventField, string>> = {}
  if (!d.title.trim()) errors.title = EVENT_COPY.titleRequired
  else if (Array.from(d.title).length > EVENT_LIMITS.title)
    errors.title = `Use up to ${EVENT_LIMITS.title} characters.`
  if (!DATE.test(d.localDate)) errors.localDate = EVENT_COPY.dateRequired
  if (d.start || d.end) {
    if (!HHMM.test(d.start) || !HHMM.test(d.end) || d.start === d.end)
      errors.window = EVENT_COPY.windowInvalid
  }
  return errors
}

export function eventDetail(
  d: EventDraft,
  answer: string | null
): Record<string, unknown> | null {
  if (answer !== "yes") return null
  return {
    event: {
      title: d.title.trim(),
      localDate: d.localDate,
      ...(d.start && d.end ? { start: d.start, end: d.end } : {}),
    },
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")

export function eventFromDetail(detail: unknown): EventDraft {
  const d = emptyEvent()
  if (!isRecord(detail) || !isRecord(detail.event)) return d
  const e = detail.event
  return {
    title: str(e.title),
    localDate: DATE.test(str(e.localDate)) ? str(e.localDate) : "",
    start: str(e.start),
    end: str(e.end),
  }
}

export function eventFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): Partial<Record<EventField, string>> {
  const out: Partial<Record<EventField, string>> = {}
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (!message) continue
    const m = /^detail\.event(?:\.(title|localDate|window))?\b/.exec(path)
    if (!m) continue
    const field = (m[1] as EventField | undefined) ?? "title"
    if (!out[field]) out[field] = message
  }
  return out
}

/** A device draft's event part (the form's own model), defensively. */
export function eventFromDraft(v: unknown): EventDraft {
  if (!isRecord(v)) return emptyEvent()
  return {
    title: str(v.title),
    localDate: str(v.localDate),
    start: str(v.start),
    end: str(v.end),
  }
}
