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
  type SubmitKnowledgeResult as ServerSubmitted,
  type ToConfirmItem as ServerToConfirm,
  type WorkingListView as ServerWorkingList,
} from "@/lib/knowledge/contract"

import type {
  AnswerInUse,
  DecisionResult,
  DraftPayload,
  FindingSummary,
  FindingsPage,
  KnowledgeAnswer,
  NoLongerUsedReason,
  PendingFinding,
  QuestionView,
  ServerDraft,
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
]

function detailOf(slot: KnowledgeSlotView): SlotDetail | null {
  if (slot.detail && (DETAILS as readonly string[]).includes(slot.detail))
    return slot.detail as SlotDetail
  return slot.reason === "not_enabled" ? "not_enabled" : null
}

export function adaptAnswerInUse(slot: KnowledgeSlotView): AnswerInUse {
  const answer = slot.answerInUse
  return {
    status: slot.status,
    reason: slot.reason,
    detail: detailOf(slot),
    value: answer?.value ?? null,
    savedAt: answer?.savedAt ?? null,
    sentAt: answer?.sentAt ?? null,
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

const NO_LONGER_USED: Record<
  NonNullable<MyFindingView["stateReason"]>,
  NoLongerUsedReason
> = {
  archived: "archived",
  replaced_by_newer: "replaced_by_newer_answer",
  reopened: "reopened",
  replaced_by_own: "replaced_by_own",
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
        ? NO_LONGER_USED[view.stateReason]
        : null,
    stateReason: view.managerNote ?? null,
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

function adaptClosed(
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
    sentAt: view.sentAt,
    savedAt: null,
    decidedAt: view.sentAt,
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
    sentAt: item.sentAt ?? inUse.savedAt ?? "",
    evidence: [],
    wifi: null,
    disputes: false,
    detailRequest: null,
    removedEvidence: 0,
  }
}

export function adaptCheck(
  check: ServerCheck,
  venueName: string,
  toConfirm: readonly ServerToConfirm[] = []
): QuestionView {
  if (!check.inScope) return { inScope: false }
  const slot = adaptSlot(check)
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
