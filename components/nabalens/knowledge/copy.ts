// The exact words of the knowledge screens (WS2 UI design rev 5, §2-§6).
// Pure functions of the server's DTOs, so every screen and test uses the same
// copy. "Couldn't establish" is the staff word for an `unknown` finding; it is
// never "Needs verification" (legacy facts) or "To check" (never answered).

import { ANSWER_LABEL, type SubmitAnswer } from "@/lib/amenities/contract"
import type {
  AnswerInUse,
  FindingState,
  FindingSummary,
  KnowledgeAnswer,
  KnowledgeOutcome,
  Recognition,
  ToConfirmRow,
  UnknownPreset,
  WorkingSlot,
} from "@/lib/knowledge-client/contract"

import type { ChipStateKey } from "../status-chip"

// ---- Dates --------------------------------------------------------------------

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
})
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
})
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/London",
})
const monthName = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "Europe/London",
})

function parse(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "3 Nov" */
export function shortDate(iso: string): string {
  const date = parse(iso)
  return date ? dayMonth.format(date) : "an unknown date"
}

/** "3 Nov 2026" */
export function longDate(iso: string): string {
  const date = parse(iso)
  return date ? dayMonthYear.format(date) : "an unknown date"
}

/** "3 Nov 2026, 14:05" */
export function dateAndTime(iso: string): string {
  const date = parse(iso)
  return date ? dateTime.format(date).replace(" at ", ", ") : "an unknown time"
}

/** "2026-11" -> "November" */
export function periodMonth(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return period
  // Mid-month, so the London month is the same whatever the offset.
  return monthName.format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15))
  )
}

// ---- Answers --------------------------------------------------------------------

export const KNOWLEDGE_ANSWER_LABEL: Record<KnowledgeAnswer, string> = {
  ...ANSWER_LABEL,
  unknown: "Couldn't establish",
}

export const ANSWER_HINT: Record<KnowledgeAnswer, string> = {
  yes: "True for guests today.",
  no: "Not true today.",
  not_applicable: "The question doesn't fit this venue.",
  unknown: "You tried and couldn't find out.",
}

export const UNKNOWN_PRESET_LABEL: Record<UnknownPreset, string> = {
  no_one_sure: "No one could say for sure",
  could_not_access: "Couldn't get to it (locked, closed or unsafe)",
  needs_access: "Needs someone with access or a key",
  other: "Other",
}

/** Inside a sentence: "Last try: couldn't establish (no one could say for sure)." */
export const UNKNOWN_PRESET_SHORT: Record<UnknownPreset, string> = {
  no_one_sure: "no one could say for sure",
  could_not_access: "couldn't get to it",
  needs_access: "needs someone with access",
  other: "other reason",
}

export function answerWord(answer: KnowledgeAnswer | null): string {
  return answer ? KNOWLEDGE_ANSWER_LABEL[answer] : "To check"
}

// ---- The venue's answer (§2.2) ------------------------------------------------------

function previous(value: SubmitAnswer | null): string[] {
  return value ? [`Previous answer: ${ANSWER_LABEL[value]}.`] : []
}

/**
 * The venue's answer in staff and manager words, one sentence per line. Dates
 * are save dates ("Recorded"), never observation times.
 */
export function answerInUseLines(
  answer: AnswerInUse,
  slot: Pick<WorkingSlot, "previousAnswer" | "latestAttempt">
): string[] {
  const value = answer.value ? ANSWER_LABEL[answer.value] : null
  const recorded = answer.savedAt
    ? ` Recorded ${longDate(answer.savedAt)}.`
    : ""
  if (answer.status === "available")
    return value ? [`Current answer: ${value}.${recorded}`] : ["To check."]
  switch (answer.detail) {
    case "conflict":
      return [
        `Recorded answer: ${value ?? "none"}. Being checked: a finding disagrees with it.`,
      ]
    case "pending":
      return value
        ? [`Recorded answer: ${value}. Awaiting confirmation.`]
        : ["Awaiting confirmation."]
    case "declined":
      return ["To check. The last finding wasn't confirmed."]
    case "recheck_requested":
      return ["No answer in use: reopened.", ...previous(slot.previousAnswer)]
    case "evidence_lost":
      return [
        "No answer in use: its photo was deleted.",
        ...previous(slot.previousAnswer),
      ]
    case "evidence_withdrawn":
      return [
        `Recorded answer: ${value ?? "none"}. Not in use: its evidence was removed.`,
      ]
    case "confirmation_revoked":
      return [
        `Recorded answer: ${value ?? "none"}. Not in use: its confirmation was withdrawn.`,
      ]
    case "answer_withdrawn":
      return [`Recorded answer: ${value ?? "none"}. Not in use.`]
    case "expired":
      return [
        "No answer in use: it needs checking again.",
        ...previous(slot.previousAnswer),
      ]
    case "unable_to_establish":
      return slot.latestAttempt
        ? [
            slot.latestAttempt.preset
              ? `To check. Last try: couldn't establish (${UNKNOWN_PRESET_SHORT[slot.latestAttempt.preset]}).`
              : "To check. Last try: couldn't establish.",
          ]
        : ["To check."]
    case "not_checked":
    case "not_enabled":
    case null:
      return ["To check."]
  }
}

/** What readers of the venue's answers get now (manager panel). */
export function readerLine(answer: AnswerInUse): string {
  if (answer.status === "available") return "Readers get the current answer."
  switch (answer.reason) {
    case "disputed":
      return "Readers are told the answer is being checked."
    case "not_confirmed":
      return answer.detail === "pending"
        ? "Readers are told it's awaiting confirmation."
        : "Readers aren't given an answer."
    case "unknown":
      return answer.detail === "unable_to_establish"
        ? "Readers are told it couldn't be established."
        : "Readers are told it hasn't been checked."
    default:
      return "Readers aren't given an answer."
  }
}

// ---- A finding's state (§2.3) ---------------------------------------------------------

export const FINDING_STATE_CHIP: Record<FindingState, ChipStateKey> = {
  saved: "saved",
  submitted: "submitted",
  awaiting_confirmation: "awaiting_confirmation",
  current: "current_answer",
  needs_attention: "needs_attention",
  not_confirmed: "not_confirmed",
  no_longer_used: "no_longer_used",
  assignment_closed: "closed",
}

const NO_LONGER_USED: Record<
  NonNullable<FindingSummary["noLongerUsed"]>,
  (reason: string | null) => string
> = {
  archived: () => "The question was archived",
  replaced_by_newer_answer: () => "A newer answer replaced it",
  reopened: (reason) =>
    reason
      ? `Your manager reopened the question: ${reason}`
      : "Your manager reopened the question",
  evidence_deleted: () => "Its photo was deleted",
  replaced_by_detail: () => "Replaced by your added detail",
  replaced_by_own: () => "Replaced by your newer finding",
}

/** How a finding compared with the venue's answer when it was sent. */
export type Compared = "none" | "differs" | "same"

/** The line under a finding's chip. */
export function findingExplanation(
  finding: Pick<
    FindingSummary,
    | "state"
    | "answer"
    | "noLongerUsed"
    | "stateReason"
    | "managerNote"
    | "answeredBy"
    | "decidedAt"
  >,
  compared: Compared = "none"
): string {
  switch (finding.state) {
    case "saved":
      return "Not sent yet. Only you can see it."
    case "submitted":
      return "Recorded as Couldn't establish. The question stays open."
    case "awaiting_confirmation":
      return compared === "differs"
        ? "Sent. The recorded answer is marked as being checked until your manager decides."
        : compared === "same"
          ? "Sent. It agrees with the recorded answer; your manager confirms it."
          : "Sent. Your manager confirms it before it's used."
    case "current":
      return "In use as the venue's answer."
    case "needs_attention":
      return `Your manager asked for more detail: ${finding.managerNote ?? ""}`.trim()
    case "not_confirmed":
      return finding.stateReason
        ? `Your manager didn't use this: ${finding.stateReason}`
        : "Your manager didn't use this."
    case "no_longer_used": {
      const why = finding.noLongerUsed
        ? NO_LONGER_USED[finding.noLongerUsed](finding.stateReason)
        : "It isn't used any more"
      return `${why}. It stays in your history.`
    }
    case "assignment_closed":
      return `Assigned to you; answered by ${finding.answeredBy ?? "a former team member"}${finding.decidedAt ? ` on ${shortDate(finding.decidedAt)}` : ""}.`
  }
}

// ---- Recognition (§2.4) ----------------------------------------------------------------

/**
 * The credit line, only from what the server reports. Never promises credit:
 * pending findings say nothing.
 */
export function recognitionLine(
  recognition: Recognition,
  answer: KnowledgeAnswer | null
): string | null {
  switch (recognition.kind) {
    case "scored":
      return `Counted in your ${periodMonth(recognition.period)} target.`
    case "not_scored":
      return answer === "unknown"
        ? "Couldn't-establish findings don't count toward targets."
        : null
    case "pending":
    case "none":
      return null
  }
}

// ---- After sending (§4.2, §4.3) ---------------------------------------------------------

export type SentCopy = {
  /** In-form status line (role="status"). */
  status: string
  /** Home notice title. */
  title: string
  /** Home notice body, after the question. */
  body: string
  tone: "positive" | "info" | "plain"
}

export function sentCopy({
  outcome,
  answer,
  compared,
  changeReport,
  selfConfirmed = false,
  leftForOthers = false,
}: {
  outcome: KnowledgeOutcome
  answer: KnowledgeAnswer
  compared: Compared
  changeReport: boolean
  /** A manager confirmed their own finding (D4). */
  selfConfirmed?: boolean
  /** A manager left their own finding for someone else to confirm. */
  leftForOthers?: boolean
}): SentCopy {
  if (outcome === "recorded" || answer === "unknown")
    return {
      status: "Recorded: couldn't establish. The question stays open.",
      title: "Recorded",
      body: "You couldn't establish the answer. The question stays open.",
      tone: "plain",
    }
  if (outcome === "current")
    return selfConfirmed
      ? {
          status:
            "Finding sent and confirmed by you. It's now the venue's answer.",
          title: "Finding sent",
          body: "Confirmed by you. It's now the venue's answer.",
          tone: "positive",
        }
      : {
          status: "Finding sent. It's now the venue's answer.",
          title: "Finding sent",
          body: "It's now the venue's answer.",
          tone: "positive",
        }
  if (leftForOthers)
    return {
      status:
        "Finding sent. It waits for another manager or an admin to confirm it.",
      title: "Finding sent",
      body: "It waits for another manager or an admin to confirm it.",
      tone: "info",
    }
  if (compared === "same")
    return {
      status:
        "Finding sent. It agrees with the recorded answer; your manager confirms it.",
      title: "Finding sent",
      body: "It agrees with the recorded answer; your manager confirms it.",
      tone: "info",
    }
  if (compared === "differs" || changeReport)
    return {
      status:
        "Change report sent. Until your manager decides, the recorded answer is marked as being checked.",
      title: "Change report sent",
      body: "Until your manager decides, the recorded answer is marked as being checked.",
      tone: "info",
    }
  return {
    status: "Finding sent. Your manager confirms it before it's used.",
    title: "Finding sent",
    body: "Your manager confirms it before it's used.",
    tone: "info",
  }
}

/**
 * The monthly card's "also this month" lines (§4.7): findings that aren't in
 * the target number, and never will be for Couldn't establish. None at zero.
 */
export function pendingLines(
  pending: { awaitingConfirmation: number; unknownRecorded: number } | null
): string[] {
  if (!pending) return []
  const lines: string[] = []
  const waiting = pending.awaitingConfirmation
  if (waiting > 0)
    lines.push(
      `Also this month: ${waiting} ${waiting === 1 ? "finding" : "findings"} waiting for confirmation. ${waiting === 1 ? "It's" : "They're"} not in this count.`
    )
  const unknown = pending.unknownRecorded
  if (unknown > 0)
    lines.push(
      `${unknown} couldn't-establish ${unknown === 1 ? "finding" : "findings"} recorded. ${unknown === 1 ? "It doesn't" : "These don't"} count toward targets.`
    )
  return lines
}

export const DETAIL_SENT: SentCopy = {
  status: "Detail sent. Your manager will look at it again.",
  title: "Detail sent",
  body: "Your manager will look at it again.",
  tone: "info",
}

export const DRAFT_SAVED: SentCopy = {
  status: "Saved for later. Not sent yet. Finish it from Home or Me.",
  title: "Saved for later",
  body: "Not sent yet. Finish it from Home or Me.",
  tone: "plain",
}

/**
 * Home's notice after a send (§4.3), from the person's latest finding as the
 * server has it now, so a reload stays truthful. Null when there is nothing
 * of theirs to announce.
 */
export function sentNoticeFor(
  slot: Pick<WorkingSlot, "myLatest" | "myDraft" | "answerInUse">
): (SentCopy & { extra: string | null }) | null {
  const latest = slot.myLatest
  const draft = slot.myDraft
  const sentAt = latest?.sentAt ?? latest?.savedAt ?? null
  if (draft && (!latest || !sentAt || draft.savedAt > sentAt))
    return { ...DRAFT_SAVED, extra: null }
  if (!latest?.answer) return null
  // Recognition only when it is real; nothing is promised (§2.4).
  const extra =
    latest.recognition.kind === "scored"
      ? recognitionLine(latest.recognition, latest.answer)
      : null
  if (latest.kind === "detail" && latest.state === "awaiting_confirmation")
    return { ...DETAIL_SENT, extra }
  const inUse = slot.answerInUse.value
  const base = {
    answer: latest.answer,
    compared: "none" as const,
    changeReport: false,
  }
  switch (latest.state) {
    case "current":
      return { ...sentCopy({ ...base, outcome: "current" }), extra }
    case "submitted":
      return { ...sentCopy({ ...base, outcome: "recorded" }), extra }
    case "awaiting_confirmation":
      return {
        ...sentCopy({
          ...base,
          outcome: "awaiting_confirmation",
          compared: inUse
            ? inUse === latest.answer
              ? "same"
              : "differs"
            : "none",
          changeReport: latest.kind === "change_report",
        }),
        extra,
      }
    default:
      return null
  }
}

export function replacedOwnLine(sentAt: string | null): string {
  return sentAt
    ? `Your earlier finding, sent ${shortDate(sentAt)}, was replaced.`
    : "Your earlier finding was replaced."
}

// ---- Failures (§3.1, §4.2, §6.6) -------------------------------------------------------

export const KNOWLEDGE_FAILURE_COPY = {
  pathRequired: {
    title: "This question has a new form",
    body: "Nothing was sent. Open the question again to use the new form; your draft is kept on this device.",
    action: "Open the question again",
  },
  outOfScope: (venue: string) => ({
    title: "This question changed",
    body: `Nothing was sent. This question was taken off ${venue}'s question list while you were working. Reload to continue with the earlier form; your draft is kept on this device.`,
    action: "Reload",
  }),
  waitConflict: {
    title: "This question changed",
    body: "This question changed while your photo was saving. Nothing was sent. Reload to see the latest; your draft is kept.",
    action: "Reload",
  },
  notPermitted:
    "Nothing was sent: you can't send a finding for this question any more. Your draft is kept.",
  reusedKey:
    "This draft was already sent with different details. Reload to see what was recorded; your draft is kept.",
  archived:
    "This question was archived, so it can't take a finding. Nothing was sent; reload to see it.",
  conflict:
    "This question changed while you were working. Nothing was sent; reload to see the latest. Your draft is kept.",
  selfConfirmStale: {
    title: "You can't confirm this yourself now",
    body: "Nothing was sent. Choose “Leave it for another manager or an admin”, then submit again.",
  },
  decision: {
    stale:
      "This check changed since you opened it. Reload to see the latest; nothing was decided.",
    alreadyDecided:
      "Someone already decided this finding. Reload to see the result.",
    selfNotPermitted:
      "You sent this, so another manager or an admin confirms it.",
    evidenceGone:
      "This finding's photo was deleted, so it can't be used. Ask for more detail or don't confirm it.",
    lost: "We couldn't confirm your decision was saved. Check your connection and try again; nothing is decided twice.",
    outOfScope:
      "This question was taken off the question list, so nothing was changed. Reload to see it.",
  },
} as const

// ---- To confirm (§6.1) ---------------------------------------------------------------

export const TO_CONFIRM_COPY = {
  title: "To confirm",
  empty: "Nothing to confirm.",
  /** Accessible words after the count on the Amenities tab. */
  badge: (n: number) =>
    n === 1 ? "finding to confirm" : "findings to confirm",
  overviewRow: (n: number) =>
    `${n} ${n === 1 ? "finding to confirm" : "findings to confirm"}`,
} as const

/** One question's line in To confirm: what waits, and from whom. */
export function toConfirmLine(rows: readonly ToConfirmRow[]): string {
  if (rows.length > 1)
    return rows.some((row) => row.conflict)
      ? `${rows.length} findings disagree`
      : `${rows.length} findings to decide`
  const [row] = rows
  const name = row.sender?.displayName ?? "a former team member"
  switch (row.kind) {
    case "finding":
      return `Finding from ${name}`
    case "change_report":
      return `Change report from ${name}`
    case "detail":
      return `Added detail from ${name}`
    case "answer_unconfirmed":
      return "Answer in use, not confirmed"
    case "evidence_removed":
      return "Evidence removed from the answer in use"
  }
}

// ---- Evidence that isn't ready yet (§4.2, G4) ----------------------------------------

const photos = (n: number) => (n === 1 ? "your photo" : `your ${n} photos`)

export const UPLOAD_WAIT_COPY = {
  pending: (n: number) =>
    n === 1
      ? "Your photo is still saving. Wait for it, or send without it."
      : `Your ${n} photos are still saving. Wait for them, or send without them.`,
  yesNeeds: (rule: string, n: number) =>
    `Yes needs evidence: ${rule}. Wait for ${photos(n)} to finish saving.`,
  waitFor: (n: number) => (n === 1 ? "Wait for it" : "Wait for them"),
  sendWithout: (n: number) =>
    n === 1 ? "Send without it" : "Send without them",
  waiting: (n: number) =>
    `Waiting for ${photos(n)} to finish saving. It sends by itself when ready.`,
  primary: (n: number) => `Waiting for ${n} ${n === 1 ? "photo" : "photos"}…`,
  stop: "Stop waiting and edit",
  offline:
    "You're offline. Your photo will finish saving when you're back online; then you can send.",
  failed: "This photo couldn't be processed. Add it again or choose another.",
} as const

// ---- Capture context (§4.2) ----------------------------------------------------------

/** The plain notice above the capture form: venue line, then one situation line. */
export function captureContextLines({
  venueName,
  slot,
  role,
  canSelfConfirm = false,
}: {
  venueName: string
  slot: Pick<
    WorkingSlot,
    | "mode"
    | "assignee"
    | "requiresConfirmation"
    | "answerInUse"
    | "othersPending"
    | "myLatest"
  >
  role: "staff" | "manager"
  /** Managers on a confirmation-required question: may they confirm their own? */
  canSelfConfirm?: boolean
}): string[] {
  const lines = [`You're answering for ${venueName}.`]
  const answer = slot.answerInUse
  if (slot.mode === "change" && answer.value) {
    const recorded = answer.savedAt
      ? `, recorded ${longDate(answer.savedAt)}`
      : ""
    lines.push(
      `Current answer: ${ANSWER_LABEL[answer.value]}${recorded}. If you send a different answer, it's marked as being checked until your manager decides. It isn't replaced unless your manager confirms your change.`
    )
  } else if (answer.reason === "disputed" || answer.detail === "pending") {
    lines.push(
      `${answerInUseLines(answer, { previousAnswer: null, latestAttempt: null })[0]} Your manager decides.`
    )
  } else if (slot.assignee && !slot.assignee.isMe && role === "staff") {
    lines.push(
      `${slot.assignee.firstName ?? "Someone else"} is assigned. What you send goes to your manager to confirm; it doesn't take over their check.`
    )
  } else if (slot.requiresConfirmation) {
    lines.push(
      role === "staff"
        ? "Your manager confirms answers to this question before they're used."
        : canSelfConfirm
          ? "Answers to this question need confirming. You can confirm your own, or leave it for another manager or an admin."
          : "Another manager or an admin confirms this before it's used."
    )
  } else if (role === "manager") {
    lines.push("What you send becomes the venue's answer straight away.")
  } else if (slot.othersPending === 0) {
    lines.push(
      "No one needs to confirm this question. What you send becomes the venue's answer straight away."
    )
  }
  if (slot.myLatest?.state === "awaiting_confirmation" && slot.myLatest.sentAt)
    lines.push(
      `You already sent a finding on ${shortDate(slot.myLatest.sentAt)}. Sending again replaces it.`
    )
  if (slot.othersPending === 1)
    lines.push(
      "Someone else also sent a finding. Your manager will compare them."
    )
  else if (slot.othersPending > 1)
    lines.push(
      `${slot.othersPending} other findings are waiting. Your manager will compare them.`
    )
  return lines
}

/** The muted line under the submit button. */
export function dockNote(
  slot: Pick<
    WorkingSlot,
    | "mode"
    | "assignee"
    | "requiresConfirmation"
    | "answerInUse"
    | "othersPending"
  >,
  role: "staff" | "manager"
): string | null {
  if (role === "manager") return null
  const proposal =
    slot.mode === "change" ||
    slot.requiresConfirmation ||
    (slot.assignee !== null && !slot.assignee.isMe) ||
    slot.othersPending > 0 ||
    slot.answerInUse.reason === "disputed"
  return proposal
    ? "Your manager confirms this before it's used."
    : "This becomes the venue's answer when you send it."
}

// ---- Home rows (§4.1) ---------------------------------------------------------------------

export type SlotRow = {
  chip:
    { state: ChipStateKey } | { word: string; tone: "attention" | "pending" }
  status: string
  /** Visible trailing text of the link; null when the row has no link. */
  action: string | null
  /** The row needs this person (counted in the section badge). */
  needsMe: boolean
  dismissable: boolean
}

export function slotRow(slot: WorkingSlot): SlotRow {
  const mine = slot.assignee?.isMe === true
  const others =
    slot.othersPending === 1
      ? "Someone else also sent a finding; your manager will compare them."
      : `${slot.othersPending} other findings are waiting; your manager will compare them.`
  const latest = slot.myLatest
  const answer = slot.answerInUse

  if (latest?.state === "needs_attention")
    return {
      chip: { state: "needs_attention" },
      status: `Your manager asked: ${latest.managerNote ?? ""}`.trim(),
      action: "Add detail",
      needsMe: true,
      dismissable: false,
    }
  if (slot.closedAssignment)
    return {
      chip: { state: "closed" },
      status: `Answered by ${slot.closedAssignment.answeredBy ?? "a former team member"} on ${shortDate(slot.closedAssignment.at)}. Your assignment is closed; nothing more to do.`,
      action: null,
      needsMe: false,
      dismissable: true,
    }
  if (mine && slot.progress === "needs_recheck")
    return {
      chip: { word: "Needs recheck", tone: "attention" },
      status: answerInUseLines(answer, slot).join(" "),
      action: "Recheck",
      needsMe: true,
      dismissable: false,
    }
  if (mine && answer.status !== "available")
    return {
      chip: { word: "Needs capture", tone: "pending" },
      status:
        slot.othersPending > 0
          ? `Assigned to you. ${others}`
          : "Assigned to you.",
      action: "Start check",
      needsMe: true,
      dismissable: false,
    }
  if (slot.myDraft)
    return {
      chip: { state: "saved" },
      status: `Not sent yet. Saved ${dateAndTime(slot.myDraft.savedAt)}.`,
      action: "Finish",
      needsMe: false,
      dismissable: false,
    }
  if (latest?.state === "awaiting_confirmation")
    return {
      chip: { state: "awaiting_confirmation" },
      status:
        answer.reason === "disputed"
          ? `Recorded answer: ${answer.value ? ANSWER_LABEL[answer.value] : "none"}. Being checked: a finding disagrees with it.`
          : answer.value && latest.answer === answer.value
            ? "You sent a finding. It agrees with the recorded answer; your manager confirms it."
            : "You sent a finding. Your manager confirms it before it's used.",
      action: "View",
      needsMe: false,
      dismissable: false,
    }
  if (answer.status === "available")
    return {
      chip: { state: "current_answer" },
      status: answerInUseLines(answer, slot).join(" "),
      action: slot.mode === "change" ? "Report a change" : "View",
      needsMe: false,
      dismissable: false,
    }
  if (answer.reason === "disputed" || answer.detail === "pending")
    return {
      chip: { state: "awaiting_confirmation" },
      status: answerInUseLines(answer, slot).join(" "),
      action: slot.mode === "change" ? "Report a change" : "View",
      needsMe: false,
      dismissable: false,
    }
  // Open: nothing in use.
  const lead =
    answer.detail === "not_checked" || answer.detail === null
      ? null
      : answerInUseLines(answer, slot).join(" ")
  if (slot.assignee && !slot.assignee.isMe)
    return {
      chip: { state: "to_check" },
      status: [
        lead,
        `${slot.assignee.firstName ?? "Someone"} is assigned. You can still add what you know.`,
      ]
        .filter(Boolean)
        .join(" "),
      action: "Add what you know",
      needsMe: false,
      dismissable: false,
    }
  return {
    chip: { state: "to_check" },
    status: [
      lead,
      slot.requiresConfirmation
        ? "No one is assigned. Your manager confirms answers to this one."
        : "No one is assigned. What you send becomes the answer.",
    ]
      .filter(Boolean)
      .join(" "),
    action: "Answer this",
    needsMe: false,
    dismissable: false,
  }
}
