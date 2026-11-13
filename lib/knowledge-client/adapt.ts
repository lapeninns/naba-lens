// Turns the knowledge server's DTOs (lib/knowledge/contract.ts) into the
// screens' view models (./contract). Pure, so it is tested on its own; the
// server seam (./services.ts) calls it on every read and command result.

import { evidenceHref } from "@/lib/amenities/contract"
import {
  KNOWLEDGE_ANSWERS,
  UNKNOWN_PRESETS,
  type ClosedAssignmentView,
  type DecideResult,
  type DraftView,
  type KnowledgeCheckView as ServerCheck,
  type KnowledgeSlotView,
  type MyFindingView,
  type MyFindingsPage as ServerFindingsPage,
  type PendingFindingView,
  type ResolveConflictResult,
  type StateReasonB03,
  type SubmitKnowledgeResult as ServerSubmitted,
  type ToConfirmItem as ServerToConfirm,
  type WorkingListView as ServerWorkingList,
} from "@/lib/knowledge/contract"

import type {
  ActorBasis,
  AnswerInUse,
  AnswerWithdrawal,
  DecisionResult,
  DraftPayload,
  FindingSummary,
  FindingsPage,
  KnowledgeAnswer,
  NoLongerUsedReason,
  FindingSource,
  Place,
  PendingFinding,
  PolicyNeed,
  QuestionView,
  ServerDraft,
  QualifiedAnswer,
  SlotDetail,
  SubmittedFinding,
  ToConfirmList,
  ToConfirmRow,
  UnknownPreset,
  WorkingList,
  WorkingSlot,
} from "./contract"

const DETAILS: readonly SlotDetail[] = [
  "not_enabled",
  "answer_withdrawn",
  "confirmation_revoked",
  "evidence_withdrawn",
  "conflict",
  "recheck_requested",
  "evidence_lost",
  "expired",
  "pending",
  "declined",
  "unable_to_establish",
  "not_checked",
  "qualified_answer",
  "policy_incomplete",
]

const POLICY_NEEDS: readonly PolicyNeed[] = [
  "stance",
  "conditions",
  "zones",
  "authority",
  "stated_on",
]

/**
 * `policyMissing` (b03-design A5), read defensively: absent stays absent, a
 * code this build doesn't know becomes `unrecognised` (once).
 */
export function policyMissingOf(v: unknown): PolicyNeed[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: PolicyNeed[] = []
  for (const code of v) {
    const need = (POLICY_NEEDS as readonly unknown[]).includes(code)
      ? (code as PolicyNeed)
      : "unrecognised"
    if (!out.includes(need)) out.push(need)
  }
  return out
}

const withPolicyMissing = (v: unknown) => {
  const needs = policyMissingOf(v)
  return needs ? { policyMissing: needs } : {}
}

function detailOf(slot: KnowledgeSlotView): SlotDetail | null {
  if (slot.detail && (DETAILS as readonly string[]).includes(slot.detail))
    return slot.detail as SlotDetail
  // A newer server's reason no answer is in use: kept as unrecognised, so the
  // screens say needs checking instead of reading it as nothing to check.
  if (slot.detail && slot.status === "unavailable") return "unrecognised"
  return slot.reason === "not_enabled" ? "not_enabled" : null
}

const QUALIFIERS = ["conditional", "temporarily_unavailable"] as const

/** `answerInUse.qualified` (b03-design §3.8), read defensively. */
function qualifiedOf(answer: unknown): QualifiedAnswer | null {
  if (!answer || typeof answer !== "object") return null
  const q = (answer as { qualified?: unknown }).qualified
  if (!q || typeof q !== "object") return null
  const { qualifier, detail } = q as { qualifier?: unknown; detail?: unknown }
  if (!(QUALIFIERS as readonly unknown[]).includes(qualifier)) return null
  const availability =
    detail && typeof detail === "object"
      ? (detail as { availability?: unknown }).availability
      : null
  const field = (key: "until" | "note") => {
    const v =
      availability && typeof availability === "object"
        ? (availability as Record<string, unknown>)[key]
        : null
    return typeof v === "string" && v ? v : null
  }
  return {
    qualifier: qualifier as QualifiedAnswer["qualifier"],
    until: field("until"),
    note: field("note"),
  }
}

const ACTOR_BASES = ["venue_manager", "admin"] as const

/** A manager's or an admin's basis, read defensively; anything else is unknown. */
function basisOf(value: unknown): ActorBasis | null {
  return (ACTOR_BASES as readonly unknown[]).includes(value)
    ? (value as ActorBasis)
    : null
}

/**
 * `answerInUse.withdrawal` (UI §8.2): kept only whole, so the screen never
 * names a role without its date or a date without its role.
 */
function withdrawalOf(answer: unknown): AnswerWithdrawal | null {
  if (!answer || typeof answer !== "object") return null
  const w = (answer as { withdrawal?: unknown }).withdrawal
  if (!w || typeof w !== "object") return null
  const { at, basis } = w as { at?: unknown; basis?: unknown }
  const known = basisOf(basis)
  return typeof at === "string" && at && known ? { at, basis: known } : null
}

const withWithdrawal = (withdrawal: AnswerWithdrawal | null) =>
  withdrawal ? { withdrawal } : {}

/** The author's corrected or withdrawn line: basis and time, only together. */
function stateReasonActor(view: MyFindingView) {
  const basis = basisOf(view.stateReasonBasis)
  return basis && typeof view.stateReasonAt === "string" && view.stateReasonAt
    ? { stateReasonBasis: basis, stateReasonAt: view.stateReasonAt }
    : {}
}

/** A real calendar date as YYYY-MM-DD, or undefined. */
function calendarDateOf(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const [y, m, d] = v.split("-").map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.toISOString().slice(0, 10) === v ? v : undefined
}

const STEP_FREE_KEY = "step_free_entrance"

/**
 * A step-free entrance Yes with recorded detail (UI §3.3, §3.5): the place
 * ids saved as Step-free. Undefined for any other key, headline or an answer
 * from before the question had detail, which keep their earlier words.
 */
function stepFreeEntranceIdsOf(
  key: string,
  value: unknown,
  detail: unknown
): string[] | undefined {
  if (key !== STEP_FREE_KEY || value !== "yes") return undefined
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    return undefined
  const entrances = (detail as { entrances?: unknown }).entrances
  const ids: string[] = []
  for (const item of Array.isArray(entrances) ? entrances : []) {
    if (!item || typeof item !== "object") continue
    const { subjectId, stepFree } = item as Record<string, unknown>
    if (
      stepFree === "yes" &&
      typeof subjectId === "string" &&
      subjectId &&
      !ids.includes(subjectId)
    )
      ids.push(subjectId)
  }
  return ids
}

/** A step-free Yes in use whose entrances still need their labels. */
export function needsEntranceLabels(answer: AnswerInUse): boolean {
  return (
    answer.status === "available" &&
    !answer.qualified &&
    (answer.stepFreeEntranceIds?.length ?? 0) > 0 &&
    !answer.entranceLabels
  )
}

/**
 * The saved entrances' labels from the venue's own Places read. Every id
 * must be there for that venue; otherwise nothing is set and the screens
 * name no place (never a guess, never a Yes for the whole venue).
 */
export function withEntranceLabels(
  answer: AnswerInUse,
  venueId: string,
  read: { venueId: string | null; places: readonly Place[] | null } | null
): AnswerInUse {
  if (!needsEntranceLabels(answer)) return answer
  if (!read?.places || read.venueId !== venueId) return answer
  const labels: string[] = []
  for (const id of answer.stepFreeEntranceIds!) {
    const place = read.places.find(
      (p) => p.subjectId === id && p.kind === "entrance"
    )
    if (!place?.label) return answer
    labels.push(place.label)
  }
  return { ...answer, entranceLabels: labels }
}

export function adaptAnswerInUse(slot: KnowledgeSlotView): AnswerInUse {
  const answer = slot.answerInUse
  const observedOn = calendarDateOf(answer?.observedOn)
  const stepFreeEntranceIds = stepFreeEntranceIdsOf(
    slot.questionKey,
    answer?.value,
    answer?.detail
  )
  return {
    status: slot.status,
    reason: slot.reason,
    detail: detailOf(slot),
    value: answer?.value ?? null,
    savedAt: answer?.savedAt ?? null,
    sentAt: answer?.sentAt ?? null,
    qualified: qualifiedOf(answer),
    ...withPolicyMissing(answer?.policyMissing),
    ...(answer?.detail &&
    typeof answer.detail === "object" &&
    !Array.isArray(answer.detail)
      ? { answerDetail: answer.detail as Record<string, unknown> }
      : {}),
    ...(observedOn ? { observedOn } : {}),
    ...(stepFreeEntranceIds ? { stepFreeEntranceIds } : {}),
    ...(typeof answer?.scheduleId === "string" && answer.scheduleId
      ? { scheduleId: answer.scheduleId }
      : {}),
    ...withoutAdoptable(sourceOf(answer ?? {})),
    ...withWithdrawal(withdrawalOf(answer)),
    confirmation: {
      state: answer?.confirmationState ?? "not_required",
      // Managers and admins only: staff get no confirmer.
      self: answer?.confirmedSelf === true,
      at: answer?.confirmedAt ?? null,
      by: answer?.confirmedByFirstName
        ? { id: "", displayName: answer.confirmedByFirstName }
        : null,
    },
  }
}

const NO_LONGER_USED: Record<StateReasonB03, NoLongerUsedReason> = {
  archived: "archived",
  replaced_by_newer: "replaced_by_newer_answer",
  reopened: "reopened",
  replaced_by_own: "replaced_by_own",
  corrected: "corrected",
  withdrawn: "withdrawn",
}

export function adaptFinding(view: MyFindingView): FindingSummary {
  return {
    findingRef: view.findingRef,
    checkId: view.checkId,
    question: view.question,
    venue: { id: view.venueId, name: view.venueName },
    answer: view.answer,
    kind: view.kind,
    state: view.state,
    noLongerUsed:
      view.state === "no_longer_used" && view.stateReason
        ? // A reason added after this build reads as none.
          (NO_LONGER_USED[view.stateReason] ?? null)
        : null,
    stateReason: view.managerNote ?? null,
    ...stateReasonActor(view),
    managerNote: view.managerNote ?? null,
    detailRequestId: view.detailRequestId ?? null,
    unknownPreset: view.unknownPreset ?? null,
    answeredBy: null,
    sentAt: view.sentAt,
    savedAt: null,
    decidedAt: view.decidedAt ?? null,
    recognition: view.recognition,
  }
}

export function adaptClosed(
  view: ClosedAssignmentView,
  venueName: string
): FindingSummary {
  return {
    findingRef: null,
    checkId: view.checkId,
    question: view.question,
    venue: { id: view.venueId, name: venueName },
    answer: null,
    kind: "assignment",
    state: "assignment_closed",
    noLongerUsed: null,
    stateReason: null,
    managerNote: null,
    detailRequestId: null,
    unknownPreset: null,
    answeredBy: view.answeredBy,
    // Someone else's answer: never shown as this person's send or decision.
    answeredAt: view.sentAt,
    sentAt: null,
    savedAt: null,
    decidedAt: null,
    recognition: { kind: "none" },
  }
}

export function adaptSlot(slot: KnowledgeSlotView): WorkingSlot {
  return {
    checkId: slot.checkId,
    key: slot.questionKey,
    question: slot.question,
    category: slot.category,
    evidenceRule: slot.evidenceRule,
    progress: slot.progress,
    slotRevision: slot.slotRevision,
    answerInUse: adaptAnswerInUse(slot),
    previousAnswer: slot.previousAnswer,
    latestAttempt: slot.latestAttempt
      ? { preset: slot.latestAttempt.preset, at: slot.latestAttempt.at }
      : null,
    assignee: slot.assignee
      ? { firstName: slot.assignee.firstName, isMe: slot.assignee.isMe }
      : null,
    mode: slot.mode,
    requiresConfirmation: slot.requiresConfirmation,
    myLatest: slot.myLatest ? adaptFinding(slot.myLatest) : null,
    myDraft: slot.myDraft ? { savedAt: slot.myDraft.savedAt } : null,
    othersPending: slot.othersPending,
    closedAssignment: slot.closedAssignment
      ? {
          eventId: slot.closedAssignment.eventId,
          answeredBy: slot.closedAssignment.answeredBy,
          at: slot.closedAssignment.at,
        }
      : null,
    ...(Array.isArray(slot.freshness) ? { freshness: slot.freshness } : {}),
  }
}

export function adaptWorkingList(list: ServerWorkingList): WorkingList | null {
  if (!list.venue) return null
  return {
    venue: list.venue,
    slots: list.items.filter((item) => item.inScope).map(adaptSlot),
  }
}

/** A different answer from the one in use (Couldn't establish always is). */
function disputes(answer: KnowledgeAnswer | null, inUse: AnswerInUse) {
  return inUse.value !== null && answer !== null && answer !== inUse.value
}

function adaptPending(
  view: PendingFindingView,
  inUse: AnswerInUse
): PendingFinding {
  return {
    findingRef: view.findingRef,
    kind: view.kind,
    answer: view.answer,
    finding: view.finding,
    limitations: view.limitations,
    reason: view.reason,
    unknownPreset: view.unknownPreset,
    triedText: view.triedText,
    changeReason: view.changeReason,
    sender: { id: view.senderId, displayName: view.senderName },
    senderIsAssignee: view.senderAssigned,
    mine: view.isMine,
    sentAt: view.sentAt,
    evidence: view.evidence.map((item) => ({
      assetId: item.assetId,
      kind: item.kind,
      available: item.available,
      thumbUrl: item.available ? evidenceHref(item.assetId, "thumb") : null,
      previewUrl: item.available ? evidenceHref(item.assetId, "preview") : null,
      streamUrl:
        item.available && item.kind === "video"
          ? evidenceHref(item.assetId, "stream")
          : null,
    })),
    wifi: view.wifi,
    disputes: disputes(view.answer, inUse),
    // The latest request, for deciders; the flag alone for anyone else.
    detailRequest: view.detailRequest
      ? {
          decisionId: view.detailRequest.decisionId,
          note: view.detailRequest.note,
          at: view.detailRequest.requestedAt,
        }
      : view.detailRequested
        ? { decisionId: null, note: null, at: null }
        : null,
    removedEvidence: 0,
    ...withPolicyMissing(view.policyMissing),
    // Only policy findings carry policyMissing; their detail is a policy.
    ...(Array.isArray(view.policyMissing) && view.detail
      ? { policyDetail: view.detail }
      : {}),
    ...sourceOf(view),
    ...(typeof view.sourceExcerpt === "string" && view.sourceExcerpt
      ? { sourceExcerpt: view.sourceExcerpt }
      : {}),
  }
}

const FINDING_SOURCES: readonly FindingSource[] = [
  "staff_finding",
  "manager_statement",
  "legacy_fact",
  "external_source",
]

const withoutAdoptable = (s: ReturnType<typeof sourceOf>) => ({
  ...(s.source ? { source: s.source } : {}),
  ...(s.sourceLabel ? { sourceLabel: s.sourceLabel } : {}),
})

/** B03-f: where a finding came from, read defensively (A12, A23). */
function sourceOf(v: {
  source?: unknown
  sourceLabel?: unknown
  adoptable?: unknown
}): { source?: FindingSource; sourceLabel?: string; adoptable?: boolean } {
  const source = (FINDING_SOURCES as readonly unknown[]).includes(v.source)
    ? (v.source as FindingSource)
    : undefined
  if (!source) return {}
  return {
    source,
    ...(typeof v.sourceLabel === "string" && v.sourceLabel
      ? { sourceLabel: v.sourceLabel }
      : {}),
    ...(typeof v.adoptable === "boolean" ? { adoptable: v.adoptable } : {}),
  }
}

/** Answers in use that need a decision come from the To confirm list. */
function currentCard(
  item: ServerToConfirm,
  inUse: AnswerInUse
): PendingFinding | null {
  const kind =
    item.kind === "answer_awaiting_confirmation"
      ? "answer_unconfirmed"
      : item.kind === "evidence_withdrawn"
        ? "evidence_removed"
        : null
  const answer = item.answer ?? inUse.value
  if (!kind || !answer) return null
  return {
    findingRef: item.findingRef,
    kind,
    answer,
    finding: null,
    limitations: null,
    reason: null,
    unknownPreset: null,
    triedText: null,
    changeReason: null,
    sender: null,
    senderIsAssignee: false,
    mine: false,
    sentAt: item.sentAt ?? "",
    // "Recorded" is the answer's own time, or no line at all (X-07).
    recordedAt: inUse.savedAt,
    evidence: [],
    wifi: null,
    disputes: false,
    detailRequest: null,
    removedEvidence: 0,
    ...withPolicyMissing(item.policyMissing),
  }
}

export function adaptCheck(
  check: ServerCheck,
  venueName: string,
  toConfirm: readonly ServerToConfirm[] = []
): QuestionView {
  if (!check.inScope) return { inScope: false }
  const slot = {
    ...adaptSlot(check),
    ...(check.mySentAt === undefined ? {} : { mySentAt: check.mySentAt }),
  }
  const inUse = slot.answerInUse
  const current = toConfirm
    .filter((item) => item.checkId === check.checkId)
    .map((item) => currentCard(item, inUse))
    .filter((card): card is PendingFinding => card !== null)
  return {
    inScope: true,
    slot,
    capture: {
      id: check.checkId,
      venueId: check.venueId,
      status: check.checkStatus,
      progress: check.progress,
      // Shown by the legacy form only; the knowledge form says why it's open.
      recheckReason: null,
      // The knowledge path is guarded by the slot revision, not the check's.
      revision: check.slotRevision,
      entry: {
        key: check.questionKey,
        category: check.category,
        question: check.question,
        captureBrief: check.captureBrief ?? "",
        evidenceRule: check.evidenceRule,
      },
    },
    venue: { id: check.venueId, name: venueName },
    pending: [...current, ...check.pending.map((p) => adaptPending(p, inUse))],
    permissions: check.permissions,
    history: [],
    ...(typeof check.timezone === "string" && check.timezone
      ? { timezone: check.timezone }
      : {}),
  }
}

export function adaptToConfirm(
  items: readonly ServerToConfirm[],
  count: number
): ToConfirmList {
  return {
    count,
    items: items.map((item): ToConfirmRow => ({
      checkId: item.checkId,
      question: item.question,
      kind:
        item.kind === "answer_awaiting_confirmation"
          ? "answer_unconfirmed"
          : item.kind === "evidence_withdrawn"
            ? "evidence_removed"
            : item.kind,
      sender: item.senderName ? { id: "", displayName: item.senderName } : null,
      sentAt: item.sentAt,
      answer: item.answer,
      conflict: item.conflict,
      disputes: item.disputes,
      slotRevision: item.slotRevision,
      waitingSince: item.waitingSince ?? null,
      ...withPolicyMissing(item.policyMissing),
      // A row only says where it came from; Confirm is the card's to gate.
      ...withoutAdoptable(sourceOf(item)),
    })),
  }
}

export function adaptFindingsPage(
  page: ServerFindingsPage,
  /** Question words and venue names the screen already has, by check. */
  known: ReadonlyMap<string, { question: string; venueName: string }>
): FindingsPage {
  const venueOf = (checkId: string) => known.get(checkId)?.venueName ?? ""
  const drafts = page.drafts.map((draft): FindingSummary => ({
    findingRef: null,
    checkId: draft.checkId,
    question:
      draft.question || known.get(draft.checkId)?.question || "A saved draft",
    venue: {
      id: draft.venueId,
      name: draft.venueName || venueOf(draft.checkId),
    },
    answer: null,
    kind: "draft",
    state: "saved",
    noLongerUsed: null,
    stateReason: null,
    managerNote: null,
    detailRequestId: null,
    unknownPreset: null,
    answeredBy: null,
    sentAt: null,
    savedAt: draft.savedAt,
    decidedAt: null,
    recognition: { kind: "pending" },
    sendable: draft.sendable,
  }))
  return {
    items: [
      ...drafts,
      ...page.items.map((item) =>
        "findingRef" in item
          ? adaptFinding(item)
          : adaptClosed(item, venueOf(item.checkId))
      ),
    ],
    nextCursor: page.nextCursor,
    hiddenEarlierVenues: page.hiddenEarlierVenues,
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** A saved payload, defensively: drafts are free-form JSON on the server. */
export function adaptDraft(view: DraftView): ServerDraft {
  const p = view.payload
  const wifi =
    p.wifi && typeof p.wifi === "object"
      ? (p.wifi as Record<string, unknown>)
      : {}
  const payload: DraftPayload = {
    answer: (KNOWLEDGE_ANSWERS as readonly unknown[]).includes(p.answer)
      ? (p.answer as KnowledgeAnswer)
      : null,
    finding: str(p.finding),
    limitations: str(p.limitations),
    reason: str(p.reason),
    unknownPreset: (UNKNOWN_PRESETS as readonly unknown[]).includes(
      p.unknownPreset
    )
      ? (p.unknownPreset as UnknownPreset)
      : null,
    triedText: str(p.triedText),
    changeReason: str(p.changeReason),
    wifi: {
      testSpot: str(wifi.testSpot),
      testedOn: str(wifi.testedOn),
      downloadMbps: str(wifi.downloadMbps),
      uploadMbps: str(wifi.uploadMbps),
    },
    sentSlotRevision:
      typeof p.sentSlotRevision === "number" &&
      Number.isInteger(p.sentSlotRevision)
        ? p.sentSlotRevision
        : null,
    ...(p.detail && typeof p.detail === "object" && !Array.isArray(p.detail)
      ? { detail: p.detail as Record<string, unknown> }
      : {}),
    ...draftCheckedOnOf(p.checkedOn),
  }
  return {
    draftRevision: view.draftRevision,
    savedAt: view.savedAt,
    payload,
    assetIds: view.assetIds,
    idempotencyKey: view.idempotencyKey,
    sendable: view.sendable,
  }
}

export function adaptSubmitted(result: ServerSubmitted): SubmittedFinding {
  return {
    findingRef: result.findingRef,
    slotRevision: result.slotRevision,
    replayed: result.replayed,
    outcome: result.outcome,
    replacedOwn: result.replacedOwn
      ? {
          findingRef: { type: "contribution", id: result.replacedOwn },
          sentAt: result.replacedOwnSentAt ?? null,
        }
      : null,
    recognition: result.recognition,
    ...(result.sentAt === undefined ? {} : { sentAt: result.sentAt }),
    ...(Array.isArray(result.rechecksClosed)
      ? { rechecksClosed: result.rechecksClosed }
      : {}),
  }
}

export function adaptDecision(
  result: DecideResult | ResolveConflictResult
): DecisionResult {
  return {
    slotRevision: result.slotRevision,
    replayed: result.replayed,
    replacedAnswer: "replacedAnswer" in result ? result.replacedAnswer : null,
  }
}

/** A draft's Checked on, defensively (drafts are free-form JSON). */
function draftCheckedOnOf(v: unknown): Pick<DraftPayload, "checkedOn"> {
  if (!v || typeof v !== "object") return {}
  const c = v as Record<string, unknown>
  return {
    checkedOn: {
      date:
        typeof c.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.date)
          ? c.date
          : null,
      source:
        c.source === "form_default" || c.source === "chosen" ? c.source : null,
    },
  }
}
