import "server-only"

import type {
  DraftView,
  KnowledgeCheckView,
  KnowledgeResult,
  MyFindingsPage,
  MyPending,
  PilotPreviewRow,
  ToConfirmItem,
  WorkingListView,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { knowledgeInvalid, knowledgeRpcFailure } from "./errors"
import { knowledgeRpc } from "./rpc"
import {
  isObject,
  isUuid,
  NOT_FOUND,
  parseCheckId,
  parseCursor,
  parsePeriod,
} from "./validate"

// Every read goes through the resolver in one statement, so a screen sees one
// snapshot and every slot carries the `slotRevision` its commands send back.

/** S1. The caller's working list at their current venue. */
export async function getWorkingList(
  actor: MediaActor
): Promise<KnowledgeResult<{ list: WorkingListView }>> {
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_working_list",
    {}
  )
  if (error) return knowledgeRpcFailure(error, "knowledge working list")
  return { ok: true, list: data }
}

/** S2. One question with its pending findings and the caller's permissions. */
export async function getKnowledgeCheck(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ check: KnowledgeCheckView }>> {
  const checkId = parseCheckId(input)
  if (!checkId.ok) return checkId
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_check", {
    p_check_id: checkId.value,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge check")
  return { ok: true, check: data }
}

/** S4. The caller's draft for a question, or null. */
export async function getDraft(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ draft: DraftView | null }>> {
  const checkId = parseCheckId(input)
  if (!checkId.ok) return checkId
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_get_draft", {
    p_check_id: checkId.value,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge draft")
  return { ok: true, draft: data }
}

/** S5. The caller's findings across venues, newest first, 20 a page. */
export async function listMyFindings(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ page: MyFindingsPage }>> {
  const cursor = parseCursor(isObject(input) ? input.cursor : null)
  if (!cursor.ok) return cursor
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_my_contributions",
    {
      p_cursor: cursor.value,
      p_limit: 20,
    }
  )
  if (error) return knowledgeRpcFailure(error, "my findings")
  return { ok: true, page: data }
}

/** S6. Findings and answers waiting for a manager (default: their venue). */
export async function listToConfirm(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ count: number; items: ToConfirmItem[] }>> {
  const venueId = isObject(input) ? (input.venueId ?? null) : null
  if (venueId !== null && !isUuid(venueId))
    return knowledgeInvalid({ venueId: "Choose a venue." })
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_to_confirm", {
    p_venue_id: venueId,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge to confirm")
  return { ok: true, count: data.count, items: data.items }
}

/** S14. Findings still waiting, and Couldn't-establish ones, in a London month. */
export async function getMyPending(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ pending: MyPending }>> {
  const period = parsePeriod(isObject(input) ? input.period : null)
  if (!period.ok) return period
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_my_pending", {
    p_period: period.value,
  })
  if (error) return knowledgeRpcFailure(error, "my pending findings")
  if (!data) return NOT_FOUND
  return { ok: true, pending: data }
}

/** Admin only: every question's resolver state at a venue, before enabling. */
export async function getPilotPreview(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ rows: PilotPreviewRow[] }>> {
  if (!isObject(input) || !isUuid(input.venueId))
    return knowledgeInvalid({ venueId: "Choose a venue." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_pilot_preview",
    {
      p_venue_id: input.venueId,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge pilot preview")
  return { ok: true, rows: data }
}
