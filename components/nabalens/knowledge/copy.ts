// The exact words of the knowledge screens (WS2 UI design rev 5, §2-§6).
// Pure functions of the server's DTOs, so every screen and test uses the same
// copy. "Couldn't establish" is the staff word for an `unknown` finding; it is
// never "Needs verification" (legacy facts) or "To check" (never answered).

import {
  ANSWER_LABEL,
  type Qualification,
  type SubmitAnswer,
} from "@/lib/amenities/contract"
import type {
  AnswerInUse,
  FreshnessEntry,
  QualifiedAnswer,
  RecheckTask,
  FindingState,
  FindingSummary,
  KnowledgeAnswer,
  KnowledgeOutcome,
  PolicyNeed,
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
const yearOnly = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
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

/** "3 Nov", or "3 Nov 2025" when it isn't this London year (CA-29). */
export function shortDate(iso: string, now: Date = new Date()): string {
  const date = parse(iso)
  if (!date) return "an unknown date"
  return yearOnly.format(date) === yearOnly.format(now)
    ? dayMonth.format(date)
    : dayMonthYear.format(date)
}

/**
 * Whether instant `a` is after `b`. Compared as instants, never as text: the
 * RPCs may write the same moment as `Z` or `+00:00` and with different
 * fraction lengths (HM-24).
 */
export function isAfter(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b)
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

/** Words for a qualified answer's qualifier (B03 UI design §2.2, §2.5). */
export const QUALIFIER_WORD: Record<QualifiedAnswer["qualifier"], string> = {
  conditional: "Allowed with conditions",
  temporarily_unavailable: "Temporarily unavailable",
}

/** "Temporarily unavailable until 3 Nov 2026." / "Allowed with conditions." */
/**
 * The legacy check reads' qualification (A19, A39, review M3): a qualified
 * answer still in use, or one presented as needs recheck because it isn't
 * (an incomplete policy, a withdrawn answer).
 */
export const LEGACY_QUALIFICATION_WORD: Record<Qualification, string> = {
  conditional: "Allowed with conditions",
  temporarily_unavailable: "Temporarily unavailable",
  policy_incomplete: "Not confirmed",
  withdrawn: "Withdrawn",
}

/** A qualified answer still in use: its own group, never a recheck (§2.6). */
export const qualifiedInUse = (q: Qualification | null | undefined) =>
  q === "conditional" || q === "temporarily_unavailable"

export function qualifiedLine(q: QualifiedAnswer): string {
  if (q.qualifier === "temporarily_unavailable") {
    if (q.until) return `Temporarily unavailable until ${longDate(q.until)}.`
    if (q.note) return `Temporarily unavailable: ${q.note}`
    return "Temporarily unavailable."
  }
  return "Current answer: Allowed with conditions."
}

/** The answer's word: its qualifier when it has one, never a bare Yes (§2.5). */
export function inUseWord(answer: AnswerInUse): string | null {
  if (answer.qualified) return QUALIFIER_WORD[answer.qualified.qualifier]
  return answer.value ? ANSWER_LABEL[answer.value] : null
}

/**
 * The previous answer, worded by its qualifier when it had one: a stale,
 * withdrawn or disputed status wins over the qualifier (§2.5 Q1), and the
 * qualified answer is what was there before.
 */
function priorAnswer(
  answer: AnswerInUse,
  slot: Pick<WorkingSlot, "previousAnswer">
): string[] {
  if (answer.qualified)
    return [`Previous answer: ${QUALIFIER_WORD[answer.qualified.qualifier]}.`]
  return previous(slot.previousAnswer)
}

/**
 * The venue's answer in staff and manager words, one sentence per line. Dates
 * are save dates ("Recorded"), never observation times.
 */
/**
 * What a policy still needs, as words (B03 UI design §4.3). Authority names
 * an admin for a policy only an admin may confirm.
 */
export function policyNeedWords(
  needs: readonly PolicyNeed[],
  { admin = false }: { admin?: boolean } = {}
): string[] {
  return needs.map((need) => {
    switch (need) {
      case "stance":
        return "a rule (not Couldn't establish)"
      case "conditions":
        return "at least one condition"
      case "zones":
        return "at least one area with its rule"
      case "authority":
        return `confirmation by ${admin ? "an admin" : "a venue manager"}, with where it was stated`
      case "stated_on":
        return "the date it was stated"
      default:
        return "something this screen can't name; reload to see it"
    }
  })
}

/** "a, b and c". */
export function joinWords(words: readonly string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
    : (words[0] ?? "")
}

/**
 * Why Confirm is unavailable on a policy item (§4.4): anything missing but
 * the confirmation itself, which confirming supplies. Null when it may be
 * confirmed.
 */
export function policyConfirmBlock(
  needs: readonly PolicyNeed[] | undefined
): string | null {
  const content = (needs ?? []).filter((need) => need !== "authority")
  if (!content.length) return null
  return `Can't confirm yet: it still needs ${joinWords(policyNeedWords(content))}.`
}

/** Under a staff photo on a policy question (§4.4, S§5.3). */
export function policyPhotoLine(firstName: string): string {
  return `This photo shows what ${firstName} saw. It doesn't confirm the policy.`
}

/** "Not confirmed: it still needs …" (§4.3), or null when nothing is missing. */
export function policyNotConfirmedLine(
  needs: readonly PolicyNeed[] | undefined,
  options?: { admin?: boolean }
): string | null {
  if (!needs?.length) return null
  return `Not confirmed: it still needs ${joinWords(policyNeedWords(needs, options))}.`
}

export function answerInUseLines(
  answer: AnswerInUse,
  slot: Pick<WorkingSlot, "previousAnswer" | "latestAttempt">
): string[] {
  const value = inUseWord(answer)
  const recorded = answer.savedAt
    ? ` Recorded ${longDate(answer.savedAt)}.`
    : ""
  if (answer.status === "available") {
    if (!value) return ["To check."]
    // B03-f (§7.1): an adopted import names its source, never a person.
    if (answer.source === "external_source" || answer.source === "legacy_fact")
      return [
        `Current answer: ${value}. Imported from ${answer.sourceLabel ?? "the old facts list"}.`,
      ]
    return [`Current answer: ${value}.${recorded}`]
  }
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
      return ["No answer in use: reopened.", ...priorAnswer(answer, slot)]
    case "evidence_lost":
      return [
        "No answer in use: its photo was deleted.",
        ...priorAnswer(answer, slot),
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
        ...priorAnswer(answer, slot),
      ]
    case "unable_to_establish":
      return slot.latestAttempt
        ? [
            slot.latestAttempt.preset
              ? `To check. Last try: couldn't establish (${UNKNOWN_PRESET_SHORT[slot.latestAttempt.preset]}).`
              : "To check. Last try: couldn't establish.",
          ]
        : ["To check."]
    case "qualified_answer":
      // §2.5 Q1: only this status is set aside for the qualifier. Without the
      // qualified object (an older server shape) it stays needs checking.
      return answer.qualified
        ? [qualifiedLine(answer.qualified)]
        : ["No answer in use: needs checking.", ...priorAnswer(answer, slot)]
    case "policy_incomplete": {
      // Without the list (an older server shape) it stays needs checking. // Never shown as confirmed while something is missing (§4.3).
      const line = policyNotConfirmedLine(answer.policyMissing)
      return line
        ? [line]
        : ["No answer in use: needs checking.", ...priorAnswer(answer, slot)]
    }
    case "not_checked":
    case "not_enabled":
    case null:
      return ["To check."]
    case "unrecognised":
    default:
      // A detail this build doesn't know yet (a newer server: qualified
      // answers, check dates, form changes). Never blank and never "Yes".
      return ["No answer in use: needs checking.", ...priorAnswer(answer, slot)]
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
  // B03-g (A15): the role only; the read carries no basis, and no name (D3).
  corrected: () => "A manager or an admin corrected it",
  withdrawn: () => "A manager or an admin withdrew it",
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
    | "answeredAt"
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
      // B03-g (§8.2): "No longer in use: …" with the reason they gave.
      if (
        finding.noLongerUsed === "corrected" ||
        finding.noLongerUsed === "withdrawn"
      )
        return `No longer in use: a manager or an admin ${finding.noLongerUsed === "corrected" ? "corrected" : "withdrew"} it.${finding.stateReason ? ` ${finding.stateReason}` : ""}`
      const why = finding.noLongerUsed
        ? NO_LONGER_USED[finding.noLongerUsed](finding.stateReason)
        : "It isn't used any more"
      return `${why}. It stays in your history.`
    }
    case "assignment_closed":
      return `Assigned to you; answered by ${finding.answeredBy ?? "a former team member"}${finding.answeredAt ? ` on ${shortDate(finding.answeredAt)}` : ""}.`
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
 * Save for later refused or overtaken (§8.10 L-b). Never names a device: the
 * other send or save may have been from this phone.
 */
export const DRAFT_SAVE_COPY = {
  alreadySent: "This finding was already sent.",
  newerSend: (sentAt: string | null) =>
    sentAt
      ? `You sent a finding on ${dateAndTime(sentAt)}. Start a new draft to change it.`
      : "You sent a finding since. Start a new draft to change it.",
  startNew: "Start a new draft",
  conflictGone:
    "This draft was sent or discarded since you opened it. Save for later again to keep this version.",
  conflictSaved:
    "This draft was saved again since you opened it. Save for later again to replace that copy with this one.",
} as const

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
  if (draft && (!latest || !sentAt || isAfter(draft.savedAt, sentAt)))
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

/**
 * A manager's or admin's own finding, named on the check page after "Capture
 * myself" (CA-15): the same outcomes staff are told. Null without a sent
 * finding of theirs, so the notice never rests on the URL alone.
 */
export function managerSentNoticeFor(
  slot: Pick<WorkingSlot, "myLatest" | "answerInUse" | "requiresConfirmation">
): SentCopy | null {
  const latest = slot.myLatest
  if (!latest?.answer) return null
  const base = {
    answer: latest.answer,
    compared: "none" as const,
    changeReport: false,
  }
  switch (latest.state) {
    case "current":
      return sentCopy({
        ...base,
        outcome: "current",
        selfConfirmed:
          slot.requiresConfirmation && slot.answerInUse.confirmation.self,
      })
    case "submitted":
      return sentCopy({ ...base, outcome: "recorded" })
    case "awaiting_confirmation":
      return sentCopy({
        ...base,
        outcome: "awaiting_confirmation",
        leftForOthers: true,
      })
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
      "This check changed. The page now shows the latest; check whether your decision is there.",
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
  /** A failed read: never shown as nothing waiting (MG-03). */
  failed: "Findings to confirm couldn't be loaded. Reload to try again.",
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

/** What the uploads still saving are: photos, videos, or both or unknown. */
export type UploadKinds = "photo" | "video" | "mixed"

/** "photo", "videos", "photo or video", "photos and videos" */
export function uploadNoun(n: number, kinds: UploadKinds = "mixed"): string {
  if (kinds === "photo") return n === 1 ? "photo" : "photos"
  if (kinds === "video") return n === 1 ? "video" : "videos"
  return n === 1 ? "photo or video" : "photos and videos"
}

const yours = (n: number, kinds: UploadKinds) =>
  n === 1 ? `your ${uploadNoun(1, kinds)}` : `your ${n} ${uploadNoun(n, kinds)}`

export const UPLOAD_WAIT_COPY = {
  pending: (n: number, kinds: UploadKinds = "photo") =>
    n === 1
      ? `Your ${uploadNoun(1, kinds)} is still saving. Wait for it, or send without it.`
      : `Your ${n} ${uploadNoun(n, kinds)} are still saving. Wait for them, or send without them.`,
  yesNeeds: (rule: string, n: number, kinds: UploadKinds = "photo") =>
    `Yes needs evidence: ${rule}. Wait for ${yours(n, kinds)} to finish saving.`,
  waitFor: (n: number) => (n === 1 ? "Wait for it" : "Wait for them"),
  sendWithout: (n: number) =>
    n === 1 ? "Send without it" : "Send without them",
  waiting: (n: number, kinds: UploadKinds = "photo") =>
    `Waiting for ${yours(n, kinds)} to finish saving. It sends by itself when ready; keep this page open.`,
  primary: (n: number, kinds: UploadKinds = "photo") =>
    `Waiting for ${n} ${uploadNoun(n, kinds)}…`,
  stop: "Stop waiting and edit",
  // A closed tab doesn't resume an upload (UP-01): only this page finishes it.
  offline: (n: number, kinds: UploadKinds = "photo") =>
    `You're offline. Keep this page open: ${yours(n, kinds)} ${n === 1 ? "finishes" : "finish"} saving when you're back online; then you can send.`,
  // Add stopped without a ready upload: failed, cancelled or removed there.
  failed: (n: number, kinds: UploadKinds = "photo") =>
    n === 1
      ? `Your ${uploadNoun(1, kinds)} didn't finish saving. Add it again or choose another.`
      : `Your ${n} ${uploadNoun(n, kinds)} didn't finish saving. Add them again or choose others.`,
  // The same, when Add said why (CA-11).
  unfinished: (
    n: number,
    kinds: UploadKinds,
    reason: "failed" | "cancelled" | "removed"
  ) => {
    const what =
      n === 1
        ? `Your ${uploadNoun(1, kinds)}`
        : `Your ${n} ${uploadNoun(n, kinds)}`
    const was = n === 1 ? "was" : "were"
    const how =
      reason === "failed"
        ? "failed to save"
        : reason === "cancelled"
          ? `${was} cancelled in Add`
          : `${was} removed from Add`
    return n === 1
      ? `${what} ${how}. Add it again or choose another.`
      : `${what} ${how}. Add them again or choose others.`
  },
} as const

/**
 * Under the Wi-Fi redaction tick while uploads from the form are saving: the
 * tick vouches for the exact photos sent, so it waits for them.
 */
export function redactionWaitLine(n: number, kinds: UploadKinds = "photo") {
  return `Tick this when ${yours(n, kinds)} ${n === 1 ? "has" : "have"} finished saving: it covers every photo and video you send.`
}

// ---- Sending (§8.1 rule 5, CA-05, CA-24) -----------------------------------------------

export const SEND_PROGRESS_COPY = {
  sending: "Sending…",
  /** After 15 s without a reply. */
  slow: "Still sending; keep this page open.",
  /** A restored draft whose send never had a definite answer. */
  lastSendUnsure:
    "Your last send may not have arrived. Send again; nothing is sent twice.",
} as const

/** How long a send goes without a reply before the screen says so. */
export const SLOW_SEND_MS = 15_000

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
      `Current answer: ${inUseWord(answer)}${recorded}. If you send a different answer, it's marked as being checked until your manager decides. It isn't replaced unless your manager confirms your change.`
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
      status: latest.managerNote
        ? `Your manager asked: ${latest.managerNote}`
        : "Your manager asked for more detail.",
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
  // What I sent is waiting on my manager: not mine to do again (HM-01).
  if (latest?.state === "awaiting_confirmation")
    return {
      chip: { state: "awaiting_confirmation" },
      status:
        answer.reason === "disputed"
          ? `Recorded answer: ${inUseWord(answer) ?? "none"}. Being checked: a finding disagrees with it.`
          : answer.value && latest.answer === answer.value
            ? "You sent a finding. It agrees with the recorded answer; your manager confirms it."
            : "You sent a finding. Your manager confirms it before it's used.",
      action: "View",
      needsMe: false,
      dismissable: false,
    }
  // My unsent draft, before "Start check": finishing it is the next step;
  // it still needs me when the check is assigned to me (HM-02).
  if (slot.myDraft)
    return {
      chip: { state: "saved" },
      status: `Not sent yet. Saved ${dateAndTime(slot.myDraft.savedAt)}.`,
      action: "Finish",
      needsMe: mine,
      dismissable: false,
    }
  // A qualified answer in use (§2.5 Q3): its qualifier, never "Needs
  // capture"; an assignee is asked to check it again. Never To do (Q4).
  if (answer.detail === "qualified_answer" && answer.qualified)
    return {
      chip: {
        word: QUALIFIER_WORD[answer.qualified.qualifier],
        tone: "attention",
      },
      status: [
        qualifiedLine(answer.qualified),
        mine ? "Assigned to you." : null,
      ]
        .filter(Boolean)
        .join(" "),
      action: mine
        ? "Check again"
        : slot.mode === "change"
          ? "Report a change"
          : "View",
      needsMe: false,
      dismissable: false,
    }
  // An incomplete policy in use (§4.3): never confirmed while something is
  // missing. A manager or an admin completes it, so it isn't staff's to do.
  if (answer.detail === "policy_incomplete")
    return {
      chip: { state: "not_confirmed" },
      status: answerInUseLines(answer, slot).join(" "),
      action: slot.mode === "change" ? "Report a change" : "View",
      needsMe: false,
      dismissable: false,
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

// ---- Rechecks (B03 UI design §6.2) ------------------------------------------------------

/**
 * A recheck card's line by cause (§6.2). `previous` is the answer last in
 * use, when there was one; `policy` words a stated-on key.
 */
export function recheckCauseLine(
  task: Pick<RecheckTask, "cause" | "dueAt">,
  {
    previous = null,
    policy = false,
    now = new Date(),
  }: { previous?: string | null; policy?: boolean; now?: Date } = {}
): string {
  const date = longDate(task.dueAt)
  // Review low 1: until the hourly job turns it into an expired task, a
  // due_soon task read after its due time is already past its check date.
  const cause =
    task.cause === "due_soon" && Date.parse(task.dueAt) <= now.getTime()
      ? "expired"
      : task.cause
  switch (cause) {
    case "due_soon":
      return `Due for a check by ${date}. The current answer stays in use until then.`
    case "expired":
      return previous
        ? `Past its check date since ${date}. Previous answer: ${previous}.`
        : `Past its check date since ${date}.`
    case "basis_missing":
      return policy
        ? "It was sent without the date the policy was stated. Check it and add the date."
        : "It was sent without the day it was checked. Check it and add the date."
    case "schedule_ended":
      return `Its last day offered was ${date}. Check whether it continues.`
    case "temporary_until_passed":
      return `It was temporarily unavailable until ${date}. Check whether it's back.`
    case "evidence_lost":
      return "Its photo was deleted. Check it again."
    case "schema_changed":
      return "This question now asks for more detail. Check it again."
    case "scope_changed":
      return "A new entrance was listed after this answer was sent. Check it."
    default:
      return "It needs checking again."
  }
}

export const RECHECK_COPY = {
  done: "Recheck done.",
  sentOpen:
    "Recheck sent. It stays open until a manager or an admin confirms your finding.",
} as const

// ---- Check dates (B03 UI design §6.1, §6.3) --------------------------------------------

const INTERNAL = "For staff and internal tools"

/** The check page's line for one use's freshness; null when unrated or public. */
export function checkDateLine(
  entry: FreshnessEntry,
  { policy = false }: { policy?: boolean } = {}
): string | null {
  // Public use gets no line until B06 grants one for the key (D-B3-7).
  if (entry.use !== "internal") return null
  const date = entry.nextCheckDue ? longDate(entry.nextCheckDue) : null
  switch (entry.state) {
    case "current":
      return date
        ? `${INTERNAL}: up to date. Next check due ${date}.`
        : `${INTERNAL}: up to date.`
    case "due_soon":
      return date
        ? `${INTERNAL}: due for a check by ${date}.`
        : `${INTERNAL}: due for a check soon.`
    case "expired":
      return `${INTERNAL}: past its check date${date ? ` since ${date}` : ""}. Not in use for this until it's checked again.`
    case "basis_missing":
      return policy
        ? `${INTERNAL}: not in use, because it was sent without the date the policy was stated.`
        : `${INTERNAL}: not in use, because it was sent without the day it was checked.`
    default:
      return null
  }
}

/** What a check date counts from (§6.1); a schedule's last day is never one. */
export function checkDateBasis(entry: FreshnessEntry): string | null {
  const on = entry.basisDate ? ` (${longDate(entry.basisDate)})` : ""
  switch (entry.basis) {
    case "observed_on":
      return `Counted from the day it was checked${on}`
    case "stated_on":
      return `Counted from the day the policy was stated${on}`
    case "event_end":
      return "Ends when the event ends"
    default:
      return null
  }
}

export const CHECK_DATES_COPY = {
  title: "Check dates",
  noRule: "This question has no check-date rule.",
  waitingFinding:
    "A finding is waiting for you to confirm; the recheck closes once it's confirmed.",
  opensWithinHour: "Past its check date. A recheck opens within the hour.",
  recheckOpen: (cause: string, assignee: string | null) =>
    `Recheck open: ${cause} ${assignee ? `Assigned to ${assignee}.` : "Not assigned."}`,
  rechecksCount: (n: number) =>
    n === 1 ? "1 recheck is open." : `${n} rechecks are open.`,
  rechecksFailed: "Open rechecks couldn't be loaded.",
} as const

// ---- Admin: what enabling check dates would do (B03 UI design §6.4) ----------------

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const FRESHNESS_PREVIEW_COPY = {
  title: "Check dates",
  intro:
    "This changes nothing. Turning a rule on is an owner decision and a release step.",
  question: "Question",
  internal: "Rule for staff and internal tools (optional)",
  public: "Rule for guests (optional)",
  ruleHelp: "The rule's id, for example ⟨offering_90⟩.",
  show: "Show what it would do",
  use: { internal: "For staff and internal tools", public: "For guests" },
  expired: (n: number) =>
    `${plural(n, "answer", "answers")} would be past their check date`,
  basisMissing: (n: number) =>
    `${n} would be not in use because they have no check date`,
  rechecks: (n: number) => `${plural(n, "recheck", "rechecks")} would open`,
  answers: (n: number) => `${plural(n, "answer", "answers")} in use`,
  none: "No venue has an answer to this question.",
  failed: "We couldn't work out what this rule would do.",
  tryAgain: "Try again",
  noRegistry: "The question list couldn't be read.",
  aVenue: "A venue",
} as const

/** The recheck tasks a preview row would open: due soon, expired, no date. */
export const previewRechecks = (item: {
  dueSoon: number
  expired: number
  basisMissing: number
}) => item.dueSoon + item.expired + item.basisMissing
