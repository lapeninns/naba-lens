// Corrections, withdrawals and history words (B03 UI design §8). No credit
// or target wording anywhere here (rule 9).

import { ANSWER_LABEL } from "@/lib/amenities/contract"
import type {
  CorrectionValue,
  SlotEventView,
  SlotHistoryView,
} from "@/lib/knowledge-client/contract"

import { dateAndTime, longDate } from "./copy"

export const WITHDRAW_COPY = {
  open: "Withdraw the answer",
  title: "Withdraw this answer?",
  body: (value: string) =>
    `Readers stop getting “${value}” straight away. It stays in the history, and a new finding can become the answer later.`,
  why: "Why?",
  whyHelp: "The person who sent this answer sees your reason.",
  whyEmpty: "Say why.",
  confirm: "Withdraw answer",
  pending: "Withdrawing…",
  done: "Withdrawn. No answer is in use.",
  notPermitted:
    "Only a manager account or an admin can withdraw answers. Nothing was changed.",
  lost: "We couldn't confirm the answer was withdrawn. Try again; it won't be withdrawn twice.",
} as const

export const CORRECT_COPY = {
  open: "Correct the answer",
  why: "Why are you correcting it?",
  whyHelp: "The person who sent this answer sees your reason.",
  whyEmpty: "Say why you're correcting it.",
  whatChanges: "What changes",
  before: "Before",
  after: "After",
  material: "Needs confirming again",
  materialLine:
    "This change needs confirming before it's used. Until then readers are told it's awaiting confirmation.",
  smallLine: "Small change: the confirmation stays.",
  nothing: "Nothing has changed yet.",
  save: "Save correction",
  doneMaterial: "Corrected. It needs confirming before it's used.",
  doneSelf: "Corrected and confirmed by you.",
  doneSmall: "Corrected. The confirmation stays.",
  notPermitted:
    "Only a manager account or an admin can correct answers. Nothing was changed.",
  conflict:
    "Someone changed this answer since you opened it. Nothing was corrected. Reload to see the latest; your changes are kept on this page.",
  context: "You're correcting the answer in use.",
} as const

export const HISTORY_COPY = {
  title: "History",
  empty: "Nothing has happened on this question yet.",
  checkDatesNote:
    "Check dates aren't listed here. Use “See the answer on a date” to see when it was past its check date.",
  showOlder: "Show older",
  failed: "The history couldn't be loaded.",
  tryAgain: "Try again",
} as const

export const AT_DATE_COPY = {
  title: "See the answer on a date",
  date: "Date",
  time: "Time (optional)",
  timeHelp: "Leave empty for the end of that day, UK time.",
  show: "Show",
  dateRequired: "Choose the date.",
  dateFuture: "Choose today or an earlier day.",
  none: (when: string) => `No answer was in use on ${when}.`,
  was: (when: string, value: string) =>
    `On ${when} the answer in use was ${value}.`,
  withdrawn: "It had been withdrawn.",
  confirmed: "Confirmed",
  notConfirmed: "Not confirmed",
  version: (n: number) => `Recorded under version ${n} of this question`,
  because: (rule: string) => `Selected because: ${rule}`,
  failed: "We couldn't load the answer for that date.",
  tryAgain: "Try again",
} as const

const BASIS: Record<string, string> = {
  venue_manager: "venue manager",
  admin: "admin",
  staff: "staff",
}

/** "{name} ({basis})", or "Someone" when the read has no person. */
export function who(actor: SlotEventView["actor"]): string {
  if (!actor) return "Someone"
  const name = actor.name ?? "A former team member"
  const basis = actor.basis ? BASIS[actor.basis] : null
  return basis ? `${name} (${basis})` : name
}

function valueWords(v: CorrectionValue | null): string {
  if (!v) return "none"
  return ANSWER_LABEL[v.headline]
}

/** Why an answer became the one in use (§8.4), naming who where it can. */
export function selectionRuleWords(
  rule: string | null,
  name: string | null = null
): string | null {
  switch (rule) {
    case "adopted":
      return "Used automatically (no confirmation needed)"
    case "confirmation":
      return name ? `Confirmed by ${name}` : "Confirmed"
    case "conflict_choice":
      return name
        ? `Chosen by ${name} from findings that disagreed`
        : "Chosen from findings that disagreed"
    case "correction":
      return name ? `Corrected by ${name}` : "Corrected"
    case "withdrawal":
      return "Withdrawn"
    default:
      return null
  }
}

/** One history line (§8.4), audience-filtered by the server. */
export function eventLine(e: SlotEventView): string {
  const by = who(e.actor)
  const name = e.actor?.name ?? null
  const why = e.reason ? ` Why: ${e.reason}` : ""
  switch (e.kind) {
    case "correction": {
      const change =
        e.before && e.after && e.before.headline !== e.after.headline
          ? `${valueWords(e.before)} → ${valueWords(e.after)}`
          : "details changed"
      const kept =
        e.material === true ? "Needs confirming again." : "Confirmation kept."
      return `Corrected by ${by}: ${change}. ${kept}${why}`
    }
    case "withdrawal":
      return `Withdrawn by ${by}.${why}`
    case "contribution":
      return e.answer
        ? `Finding sent by ${by}: ${e.answer === "unknown" ? "Couldn't establish" : ANSWER_LABEL[e.answer]}.`
        : `Finding sent by ${by}.`
    case "correction_sent":
      return `Correction recorded by ${by}.`
    case "adoption":
      return `In use. ${selectionRuleWords(e.selectionRule ?? "adopted", name) ?? ""}`.trim()
    case "confirmation":
      return `Confirmed by ${by}.`
    case "decline":
      return `Not confirmed by ${by}.${why}`
    case "revoke":
      return `Confirmation withdrawn by ${by}.${why}`
    case "reaffirm":
      return `Kept in use by ${by}.${why}`
    case "seen":
      return `Marked as seen by ${by}.`
    case "detail_request":
      return `${by} asked for more detail.${why}`
    case "schedule_exception":
      return `Date change added by ${by}.`
    case "upgrade":
      return "Upgraded to the new form: details not recorded."
    default:
      return `Changed by ${by}.`
  }
}

export function eventWhen(e: SlotEventView): string {
  return dateAndTime(e.at)
}

/** The answer-on-a-date result in words (§8.5). */
export function atDateLines(view: SlotHistoryView, when: string): string[] {
  const a = view.answerInUse
  if (!a) return [AT_DATE_COPY.none(when)]
  const lines: (string | null)[] = [
    AT_DATE_COPY.was(when, ANSWER_LABEL[a.answer]),
  ]
  if (a.withdrawn) lines.push(AT_DATE_COPY.withdrawn)
  lines.push(
    a.confirmationState === "confirmed"
      ? AT_DATE_COPY.confirmed
      : a.confirmationState === "not_required"
        ? null
        : AT_DATE_COPY.notConfirmed
  )
  lines.push(AT_DATE_COPY.version(a.questionVersion))
  const rule = selectionRuleWords(a.selectionRule)
  if (rule) lines.push(AT_DATE_COPY.because(rule.toLowerCase()))
  return lines.filter((l): l is string => Boolean(l))
}

/**
 * A London wall-clock date and time as an instant, for the history read.
 * Without a time, the end of that day.
 */
export function londonInstant(date: string, time: string | null): string {
  const t = time || "23:59:59"
  const [h, m, s = "0"] = t.split(":")
  const probe = new Date(`${date}T12:00:00Z`)
  const londonHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(probe)
  )
  const offsetHours = londonHour - 12
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(h) - offsetHours,
    Number(m),
    Number(s)
  )
  return new Date(utc).toISOString()
}

export const whenWords = (date: string, time: string | null) =>
  time ? `${longDate(date)}, ${time}` : longDate(date)
