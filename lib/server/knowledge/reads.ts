import "server-only"

import {
  TRIAGE_QUEUES,
  type AssetDeleteImpact,
  type ContributionsFeedPage,
  type DraftView,
  type KnowledgeAsset,
  type KnowledgeCheckView,
  type KnowledgeResult,
  type LabelWork,
  type MyFindingsPage,
  type MyPending,
  type PilotPreviewRow,
  type ToConfirmItem,
  type TriageQueueSummary,
  type VenueCapabilities,
  type WorkingListView,
} from "@/lib/knowledge/contract"
import { redactError } from "@/lib/server/log/redact"
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
  optionalVenueId,
  parseCheckId,
  parseCursor,
  parseFeedCursor,
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

// ---- B02 reads (docs/knowledge/b02-design.md §3, §3a) ----------------------

/** R1. The caller's photos needing labels and label saves needing attention. */
export async function getLabelWork(
  actor: MediaActor
): Promise<KnowledgeResult<{ work: LabelWork }>> {
  const { data, error } = await knowledgeRpc(actor.db, "my_label_work", {})
  if (error) return knowledgeRpcFailure(error, "label work")
  const row = data[0]
  return {
    ok: true,
    work: {
      needsLabels: row?.needs_labels ?? 0,
      needsAttention: row?.needs_attention ?? 0,
    },
  }
}

/** R3. One row per manager queue, in a fixed order (default: their venue). */
export async function getManagerTriage(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{
    queues: TriageQueueSummary[]
    /** B03-e (§7.4): open recheck tasks; absent before the B03-e migration. */
    rechecks?: Omit<TriageQueueSummary, "queue" | "ownWaiting">
    /** B03-f (A12): undecided imported suggestions; absent before B03-f. */
    suggestions?: Omit<TriageQueueSummary, "queue" | "ownWaiting">
  }>
> {
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const { data, error } = await knowledgeRpc(
    actor.db,
    "manager_triage_summary",
    { p_venue_id: venueId.value }
  )
  if (error) return knowledgeRpcFailure(error, "manager triage")
  const rows = new Map(data.map((r) => [r.queue, r]))
  const rechecks = rows.get("rechecks")
  const suggestions = rows.get("suggestions")
  return {
    ok: true,
    queues: TRIAGE_QUEUES.map((queue) => {
      const r = rows.get(queue)
      return {
        queue,
        available: r?.available ?? false,
        waiting: r?.waiting ?? null,
        oldestWaitingAt: r?.oldest_waiting_at ?? null,
        ownWaiting: r?.own_waiting ?? null,
      }
    }),
    ...(rechecks
      ? {
          rechecks: {
            available: rechecks.available,
            waiting: rechecks.waiting,
            oldestWaitingAt: rechecks.oldest_waiting_at,
          },
        }
      : {}),
    ...(suggestions
      ? {
          suggestions: {
            available: suggestions.available,
            waiting: suggestions.waiting,
            oldestWaitingAt: suggestions.oldest_waiting_at,
          },
        }
      : {}),
  }
}

/** R5. The caller's photos, task sends and findings, newest first, 20 a page. */
export async function listMyContributions(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ page: ContributionsFeedPage }>> {
  const cursor = parseFeedCursor(isObject(input) ? input.cursor : null)
  if (!cursor.ok) return cursor
  const { data, error } = await knowledgeRpc(
    actor.db,
    "my_contributions_feed",
    { p_cursor: cursor.value, p_limit: 20 }
  )
  if (error) return knowledgeRpcFailure(error, "my contributions")
  return { ok: true, page: await withGroupIds(actor, data) }
}

/**
 * Photo rows gain their contribution group (W1). A failed lookup leaves
 * groupId out rather than failing the page.
 */
async function withGroupIds(
  actor: MediaActor,
  page: ContributionsFeedPage
): Promise<ContributionsFeedPage> {
  const photos = page.items.flatMap((i) =>
    i.type === "photo" ? [i.assetId] : []
  )
  if (photos.length === 0) return page
  const { data, error } = await knowledgeRpc(
    actor.db,
    "contribution_groups_for_assets",
    { p_asset_ids: photos }
  )
  if (error) {
    console.error(
      "[knowledge] contribution groups for my contributions failed",
      {
        error: redactError(
          new Error(`${error.code || "unknown"}: ${error.message ?? ""}`)
        ),
      }
    )
    return page
  }
  const byAsset = new Map(data.map((r) => [r.asset_id, r.group_id]))
  return {
    ...page,
    items: page.items.map((i) =>
      i.type === "photo" ? { ...i, groupId: byAsset.get(i.assetId) ?? null } : i
    ),
  }
}

/** R8. What the caller may do at the venue (an admin names one). */
export async function getVenueCapabilities(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ capabilities: VenueCapabilities }>> {
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const { data, error } = await knowledgeRpc(
    actor.db,
    "my_venue_capabilities",
    { p_venue_id: venueId.value }
  )
  if (error) return knowledgeRpcFailure(error, "venue capabilities")
  return { ok: true, capabilities: data }
}

/** R9. What deleting one of the caller's own photos would do. Advisory. */
export async function getAssetDeleteImpact(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ impact: AssetDeleteImpact }>> {
  if (!isObject(input) || !isUuid(input.assetId))
    return knowledgeFailure(
      "not_found",
      "This photo could not be found. It may have been deleted."
    )
  const { data, error } = await knowledgeRpc(
    actor.db,
    "my_asset_delete_impact",
    { p_asset_id: input.assetId }
  )
  if (error) return knowledgeRpcFailure(error, "delete impact")
  return { ok: true, impact: data }
}
