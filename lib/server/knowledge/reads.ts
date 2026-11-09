import "server-only"

import type {
  DraftView,
  KnowledgeAsset,
  KnowledgeCheckView,
  KnowledgeResult,
  MyFindingsPage,
  MyPending,
  PilotPreviewRow,
  ToConfirmItem,
  WorkingListView,
} from "@/lib/knowledge/contract"
import { mediaRoutes } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import {
  knowledgeFailure,
  knowledgeInvalid,
  knowledgeRpcFailure,
} from "./errors"
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

/** As private.amenity_submittable: newest first, at most this many. */
const ASSETS_LIMIT = 200

/**
 * The caller's own photos and videos they may attach on a working-list
 * question: ready, not deleted, uploaded at the question's venue. Exactly the
 * staff rule of private.amenity_asset_ineligibility, which knowledge_submit
 * applies, read as the caller (RLS: own rows of active staff only). Staff need
 * no assignment here, unlike amenity_submittable_assets. Managers and admins
 * keep listSubmittableAssets, which also offers legacy coverage media.
 */
export async function listKnowledgeAssets(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ assets: KnowledgeAsset[] }>> {
  const checkId = parseCheckId(input)
  if (!checkId.ok) return checkId
  const slot = await knowledgeRpc(actor.db, "knowledge_check", {
    p_check_id: checkId.value,
  })
  if (slot.error) return knowledgeRpcFailure(slot.error, "knowledge assets")
  if (!slot.data.inScope)
    return knowledgeFailure(
      "knowledge_slot_out_of_scope",
      "This question is no longer on the working list. Reload the page."
    )
  const { data, error } = await actor.db
    .from("media_assets")
    .select("id, media_type, created_at, thumbnail_path")
    .eq("uploader_id", actor.profile.id)
    .eq("venue_id", slot.data.venueId)
    .eq("upload_state", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ASSETS_LIMIT)
  if (error) return knowledgeRpcFailure(error, "knowledge assets")
  return {
    ok: true,
    assets: (data ?? []).map((a) => ({
      assetId: a.id,
      kind: a.media_type === "video" ? "video" : "photo",
      createdAt: a.created_at,
      source: "own",
      thumbUrl: a.thumbnail_path ? mediaRoutes.thumbnail(a.id) : null,
    })),
  }
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
