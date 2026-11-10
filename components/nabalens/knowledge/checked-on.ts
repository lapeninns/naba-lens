// "Checked on" (b03-design §7.2; B03 UI design §3.2): the day the person says
// they looked. It defaults to today and records whether it was left as the
// form's date or chosen. It is never filled from a photo, an upload or a save
// time, and a default date left in a draft is never carried to a later day.

import { longDate } from "./copy"

export type CheckedOnSource = "form_default" | "chosen"

export type CheckedOn = {
  /** London date, YYYY-MM-DD; null until chosen after a later-day reopen. */
  date: string | null
  source: CheckedOnSource | null
}

/** How far back a person may say they checked (OD-15 default). */
export const CHECKED_ON_MAX_DAYS_AGO = 30

export const CHECKED_ON_COPY = {
  label: "When did you check?",
  help: "The day you looked. Change it if you checked on an earlier day.",
  startedOn: (date: string) =>
    `This draft was started on ${longDate(date)}. Choose the day you checked.`,
  required: "Choose the day you checked.",
  future: "Choose today or an earlier day.",
  tooOld:
    "This date is more than 30 days ago. Check again and choose the new date.",
} as const

const DAY_MS = 86_400_000

/** `today` minus `days`, as YYYY-MM-DD (calendar arithmetic, no time zone). */
export function daysBefore(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!) - days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

/** A new form: today, left as the form's date. */
export function newCheckedOn(today: string): CheckedOn {
  return { date: today, source: "form_default" }
}

/** The person changed the field: whatever they pick is chosen, today too. */
export function chooseCheckedOn(value: string): CheckedOn {
  return { date: value || null, source: "chosen" }
}

/**
 * A draft's date when the form is opened again. A chosen date is kept. A
 * form's date is kept the same London day; on a later day it is cleared and
 * a choice is required (D-B3-12, OD-15's call), with the notice saying why.
 */
export function reopenCheckedOn(
  saved: CheckedOn,
  today: string
): { value: CheckedOn; notice: string | null } {
  if (saved.source === "form_default" && saved.date && saved.date !== today)
    return {
      value: { date: null, source: null },
      notice: CHECKED_ON_COPY.startedOn(saved.date),
    }
  return { value: saved, notice: null }
}

/** The field's error before sending, or null. */
export function checkedOnError(value: CheckedOn, today: string): string | null {
  if (!value.date || !value.source) return CHECKED_ON_COPY.required
  if (value.date > today) return CHECKED_ON_COPY.future
  if (value.date < daysBefore(today, CHECKED_ON_MAX_DAYS_AGO))
    return CHECKED_ON_COPY.tooOld
  return null
}

/** The line shown with an answer: staff see their own, managers the sender. */
export function checkedOnLine(
  value: { date: string | null; source: CheckedOnSource | null },
  viewer: { kind: "own" } | { kind: "manager"; senderName: string | null }
): string | null {
  if (!value.date) return null
  const day = longDate(value.date)
  if (viewer.kind === "own") return `You checked on ${day}.`
  const by = viewer.senderName ? ` by ${viewer.senderName}` : ""
  const note =
    value.source === "form_default" ? " (the form's date, not changed)" : ""
  return `Checked on ${day}${by}${note}.`
}
