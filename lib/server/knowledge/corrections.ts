import "server-only"

import type { SubmitAnswer } from "@/lib/amenities/contract"
import {
  KNOWLEDGE_LIMITS as LIMITS,
  type CorrectResult,
  type KnowledgeResult,
  type SlotEventView,
  type SlotHistoryView,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { knowledgeInvalid, knowledgeRpcFailure } from "./errors"
import { knowledgeRpc } from "./rpc"
import { intInRange, isObject, isUuid, NOT_FOUND } from "./validate"

// Corrections, withdrawals, schema upgrades and history (B03-g, b03-design
// §9, A15, A16). Correct and withdraw are for a manager account or an admin;
// a staff account holding a legacy grant is refused (it takes part in
// credit, §9.6). The database decides material versus non-material.

const RELOAD = knowledgeInvalid(
  { idempotencyKey: "Reload the page and try again." },
  "This request is invalid. Reload the page."
)
const HEADLINES: readonly SubmitAnswer[] = ["yes", "no", "not_applicable"]
const KEY = /^[a-z0-9_]{1,40}$/
const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9]{1,19}$/
const isRevision = (v: unknown): v is number =>
  intInRange(v, 0, Number.MAX_SAFE_INTEGER)

function reasonOf(v: unknown): string | null {
  return typeof v === "string" &&
    v.trim().length > 0 &&
    v.trim().length <= LIMITS.reason
    ? v.trim()
    : null
}

/** Corrects the answer in use (§9.1); `reason` is shown in history. */
export async function correctAnswer(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<CorrectResult>> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const errors: Record<string, string> = {}
  if (!isRevision(input.slotRevision))
    errors.slotRevision = "Reload the page and try again."
  if (!HEADLINES.includes(input.headline as SubmitAnswer))
    errors.headline = "Choose Yes, No or Not applicable."
  const detail = input.detail ?? null
  if (detail !== null && !isObject(detail))
    errors.detail = "Check these details."
  const reason = reasonOf(input.reason)
  if (!reason) errors.reason = "Say why this is being corrected."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_correct", {
    p_check_id: input.checkId,
    p_slot_revision: input.slotRevision as number,
    p_idempotency_key: input.idempotencyKey,
    p_headline: input.headline as SubmitAnswer,
    p_detail: detail as Record<string, unknown> | null,
    p_reason: reason!,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge correct")
  return { ok: true, ...data }
}

/** Takes the answer in use out of use (§9.2); it stays in history. */
export async function withdrawAnswer(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{
    decisionId: string
    slotRevision: number
    replayed: boolean
  }>
> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  if (!isUuid(input.idempotencyKey)) return RELOAD
  if (!isRevision(input.slotRevision))
    return knowledgeInvalid({ slotRevision: "Reload the page and try again." })
  const reason = reasonOf(input.reason)
  if (!reason) return knowledgeInvalid({ reason: "Say why it is withdrawn." })
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_withdraw", {
    p_check_id: input.checkId,
    p_slot_revision: input.slotRevision,
    p_idempotency_key: input.idempotencyKey,
    p_reason: reason,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge withdraw")
  return { ok: true, ...data }
}

/** Admin: a schema upgrade dry run, or its apply (§9.3). */
export async function runSchemaUpgrade(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ result: Record<string, unknown> }>> {
  if (!isObject(input) || typeof input.key !== "string" || !KEY.test(input.key))
    return knowledgeInvalid({ key: "Choose a question." })
  if (input.mode !== "dry_run" && input.mode !== "apply")
    return knowledgeInvalid({ mode: "Choose a dry run or apply." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_upgrade_run",
    {
      p_key: input.key,
      p_mode: input.mode,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge upgrade run")
  return { ok: true, result: data }
}

/** Managers and admins: the answer in use at a moment (§9.4). */
export async function getSlotHistory(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ history: SlotHistoryView }>> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  const at = input.at ?? new Date().toISOString()
  if (typeof at !== "string" || Number.isNaN(Date.parse(at)))
    return knowledgeInvalid({ at: "Choose a time." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_slot_history",
    {
      p_check_id: input.checkId,
      p_at: at,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge slot history")
  return { ok: true, history: data }
}

/** Managers and admins: the slot's events, newest first (A16). */
export async function listSlotEvents(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{ items: SlotEventView[]; nextCursor: string | null }>
> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  const cursor = input.cursor ?? null
  if (cursor !== null && (typeof cursor !== "string" || !CURSOR.test(cursor)))
    return knowledgeInvalid({ cursor: "Reload the page." })
  const limit = input.limit ?? 20
  if (!intInRange(limit, 1, 50))
    return knowledgeInvalid({ limit: "Choose up to 50." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_slot_events",
    {
      p_check_id: input.checkId,
      p_cursor: cursor as string | null,
      p_limit: limit as number,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge slot events")
  return { ok: true, ...data }
}
