import "server-only"

import type {
  DecideResult,
  Decision,
  KnowledgeResult,
  ResolveConflictResult,
  SubmitKnowledgeResult,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { knowledgeInvalid, knowledgeRpcFailure } from "./errors"
import { knowledgeRpc } from "./rpc"
import {
  intInRange,
  isObject,
  parseCheckId,
  parseDecide,
  parseDraft,
  parseKnowledgeSubmit,
  parseResolve,
  parseWorkingList,
} from "./validate"

// Every command takes the `slotRevision` the caller saw and an idempotency
// key. A stale revision is `revision_conflict` with nothing recorded; a
// repeated key returns the first result with `replayed: true`.

/** S3. Sends a finding, change report or requested detail. */
export async function submitKnowledgeFinding(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<SubmitKnowledgeResult>> {
  const parsed = parseKnowledgeSubmit(input)
  if (!parsed.ok) return parsed
  const p = parsed.value
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_submit", {
    p_check_id: p.checkId,
    p_slot_revision: p.slotRevision,
    p_idempotency_key: p.idempotencyKey,
    p_kind: p.kind,
    p_answer: p.answer,
    p_finding: p.finding,
    p_limitations: p.limitations,
    p_reason: p.reason,
    p_unknown_preset: p.unknownPreset,
    p_tried_text: p.triedText,
    p_change_reason: p.changeReason,
    p_responds_to: p.respondsTo,
    p_asset_ids: p.assetIds,
    p_internal_metadata: p.wifi,
    p_redaction_confirmed: p.redactionConfirmed,
    p_confirm_own: p.confirmOwn,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge submit")
  const { contributionId, ...rest } = data
  return { ok: true, ...rest, findingRef: { type: "contribution", id: contributionId } }
}

async function decide(
  actor: MediaActor,
  input: unknown,
  decision: Decision
): Promise<KnowledgeResult<DecideResult>> {
  const parsed = parseDecide(input, decision)
  if (!parsed.ok) return parsed
  const p = parsed.value
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_decide", {
    p_target_type: p.target.type,
    p_target_id: p.target.id,
    p_decision: p.decision,
    p_slot_revision: p.slotRevision,
    p_idempotency_key: p.idempotencyKey,
    p_note: p.note,
  })
  if (error) return knowledgeRpcFailure(error, `knowledge ${decision}`)
  return { ok: true, ...data }
}

/** S7. Confirms a finding (adopting it) or an answer awaiting confirmation. */
export const confirmFinding = (actor: MediaActor, input: unknown) =>
  decide(actor, input, "confirm")
/** S7 (§10). Keeps an answer whose evidence was withdrawn. */
export const reaffirmAnswer = (actor: MediaActor, input: unknown) =>
  decide(actor, input, "reaffirm")
/** S8. Asks the sender for more detail; `note` is required. */
export const requestMoreDetail = (actor: MediaActor, input: unknown) =>
  decide(actor, input, "request_detail")
/** S9. Declines a finding, or an unconfirmed answer (which reopens it). */
export const declineFinding = (actor: MediaActor, input: unknown) =>
  decide(actor, input, "decline")
/** S11. Marks a Couldn't-establish finding as seen; ends its dispute. */
export const markUnknownSeen = (actor: MediaActor, input: unknown) =>
  decide(actor, input, "seen")
/** Withdraws a confirmation; `note` is required. */
export const revokeConfirmation = (actor: MediaActor, input: unknown) =>
  decide(actor, input, "revoke")

/** S10. Chooses one finding, or keeps the answer in use, settling every other. */
export async function resolveConflict(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<ResolveConflictResult>> {
  const parsed = parseResolve(input)
  if (!parsed.ok) return parsed
  const p = parsed.value
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_resolve_conflict", {
    p_check_id: p.checkId,
    p_slot_revision: p.slotRevision,
    p_idempotency_key: p.idempotencyKey,
    p_choose: p.choose,
    p_reason: p.reason,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge resolve conflict")
  return { ok: true, ...data }
}

/** S4. Saves the caller's draft; `draftRevision` null creates it. */
export async function saveDraft(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ draftRevision: number; savedAt: string }>> {
  const parsed = parseDraft(input)
  if (!parsed.ok) return parsed
  const p = parsed.value
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_save_draft", {
    p_check_id: p.checkId,
    p_draft_revision: p.draftRevision,
    p_payload: p.payload,
    p_asset_ids: p.assetIds,
    p_idempotency_key: p.idempotencyKey,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge save draft")
  return { ok: true, ...data }
}

export async function discardDraft(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ discarded: boolean }>> {
  const checkId = parseCheckId(input)
  if (!checkId.ok) return checkId
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_discard_draft", {
    p_check_id: checkId.value,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge discard draft")
  return { ok: true, discarded: data }
}

/** S13. Hides a closed-assignment notice for the caller. Best effort. */
export async function dismissClosedAssignment(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ dismissed: boolean }>> {
  if (!isObject(input) || !intInRange(input.eventId, 1, Number.MAX_SAFE_INTEGER))
    return knowledgeInvalid({ eventId: "Reload the page." })
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_dismiss_outcome", {
    p_event_id: input.eventId,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge dismiss outcome")
  return { ok: true, dismissed: data }
}

/** Admin only: adds questions to, or removes them from, a venue's working list. */
export async function setWorkingList(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ changed: number }>> {
  const parsed = parseWorkingList(input)
  if (!parsed.ok) return parsed
  const p = parsed.value
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_set_working_list", {
    p_venue_id: p.venueId,
    p_keys: p.keys,
    p_enabled: p.enabled,
    p_reason: p.reason,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge working list change")
  return { ok: true, changed: data }
}
