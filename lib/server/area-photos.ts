import "server-only"

import {
  failure,
  invalid,
  NOT_FOUND,
  NOT_PERMITTED,
  unavailableFailure,
  type DbError,
} from "@/lib/server/coverage/errors"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"
import { mediaRoutes } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

// G-9 (docs/plans/goals-not-tasks.md, phase 3): venue-area labels on photos
// that are not a dish or a drink, their review, and nothing else. Month credit
// is read-through in SQL (20261116170000_area_photos.sql); every function here
// is a thin call that the database scopes again.

export type AreaPhotoState =
  "pending" | "accepted" | "needs_another_photo" | "withdrawn"

export type AreaPlace = { subjectId: string; kind: string; label: string }

export type AreaLabel = {
  assetId: string
  labelId: string
  subjectId: string
  label: string
  state: AreaPhotoState
  reason: string | null
}

export type AreaPhotoCard = {
  labelId: string
  assetId: string
  authorName: string
  area: string
  uploadedAt: string
  labelledAt: string
  creditMonth: string
  state: AreaPhotoState
  reason: string | null
  decidedAt: string | null
  canDecide: boolean
  thumbnailUrl: string | null
  previewUrl: string | null
}

export type AreaQueueStatus = "pending" | "decided"
export type AreaDecision = "accepted" | "needs_another_photo" | "withdrawn"

type Result<T> = ({ ok: true } & T) | CoverageFailure

// The RPCs are not in the generated types until the coordinator regenerates
// lib/db/types.ts; a narrow local shape for the calls below.
type Rpc = {
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: DbError }>
}
const rpc = (actor: MediaActor, fn: string, args?: Record<string, unknown>) =>
  (actor.db as unknown as Rpc).rpc(fn, args)

const MESSAGES: Record<string, CoverageFailure> = {
  not_active_user: NOT_PERMITTED,
  not_venue_manager: NOT_PERMITTED,
  media_asset_not_found: NOT_FOUND,
  area_photo_not_found: failure(
    "not_found",
    "This photo is no longer waiting for review. Reload the page."
  ),
  self_review_not_allowed: failure(
    "not_permitted",
    "This is your photo. Another reviewer decides on it."
  ),
  area_wrong_venue: failure(
    "invalid_input",
    "That place belongs to another venue. Reload the page."
  ),
  area_unavailable: failure(
    "state_conflict",
    "That place is no longer listed for this venue. Choose another."
  ),
  area_label_image_only: failure(
    "invalid_input",
    "Only photos can be labelled with a venue area."
  ),
  reason_required: invalid(
    { reason: "Say what the next photo needs." },
    "Say what the next photo needs."
  ),
  area_photo_conflict: failure(
    "state_conflict",
    "Someone already decided on this photo. Reload to see the decision."
  ),
}

function areaFailure(error: DbError, context: string): CoverageFailure {
  const known = error?.message ? MESSAGES[error.message] : undefined
  return known ?? unavailableFailure(context, error)
}

const isState = (value: unknown): value is AreaPhotoState =>
  value === "pending" ||
  value === "accepted" ||
  value === "needs_another_photo" ||
  value === "withdrawn"

const text = (value: unknown) => (typeof value === "string" ? value : null)

/** The caller's venue's active places, for the area picker. */
export async function listAreaPlaces(
  actor: MediaActor
): Promise<Result<{ places: AreaPlace[] }>> {
  const { data, error } = await rpc(actor, "knowledge_subjects", {
    p_venue_id: null,
  })
  if (error) return areaFailure(error, "area places")
  const items = (data as { items?: unknown } | null)?.items
  const places = (Array.isArray(items) ? items : []).flatMap(
    (p): AreaPlace[] => {
      const row = p as Record<string, unknown>
      if (!isUuid(row.subjectId) || row.active === false) return []
      const label = text(row.label)
      const kind = text(row.kind)
      return label && kind ? [{ subjectId: row.subjectId, kind, label }] : []
    }
  )
  return { ok: true, places }
}

/** Areas on the caller's own photos (at most 100 ids). */
export async function getMyAreaLabels(
  actor: MediaActor,
  assetIds: readonly string[]
): Promise<Result<{ labels: AreaLabel[] }>> {
  const ids = [...new Set(assetIds)].filter((id) => isUuid(id))
  if (ids.length !== assetIds.length || ids.length > 100)
    return invalid({ assetIds: "Reload the page." })
  if (ids.length === 0) return { ok: true, labels: [] }
  const { data, error } = await rpc(actor, "my_area_labels", {
    p_asset_ids: ids,
  })
  if (error) return areaFailure(error, "my area labels")
  const labels = ((data as Record<string, unknown>[] | null) ?? []).flatMap(
    (r): AreaLabel[] =>
      isUuid(r.asset_id) &&
      isUuid(r.label_id) &&
      isUuid(r.subject_id) &&
      isState(r.state)
        ? [
            {
              assetId: r.asset_id,
              labelId: r.label_id,
              subjectId: r.subject_id,
              label: text(r.subject_label) ?? "",
              state: r.state,
              reason: text(r.reason),
            },
          ]
        : []
  )
  return { ok: true, labels }
}

/** Sets (or, with null, clears) the area of one of the caller's photos. */
export async function setAreaLabel(
  actor: MediaActor,
  assetId: unknown,
  subjectId: unknown
): Promise<Result<{ subjectId: string | null }>> {
  if (!isUuid(assetId)) return invalid({ assetId: "Reload the page." })
  if (subjectId !== null && !isUuid(subjectId))
    return invalid({ subjectId: "Choose a place." })
  const { error } = await rpc(actor, "set_media_area_label", {
    p_asset_id: assetId,
    p_subject_id: subjectId,
  })
  if (error) return areaFailure(error, "set area label")
  return { ok: true, subjectId }
}

/** The venue's area photos: waiting for review, or already decided. */
export async function listAreaPhotoQueue(
  ctx: ManagerPhotoCtx,
  status: AreaQueueStatus = "pending"
): Promise<Result<{ cards: AreaPhotoCard[] }>> {
  const { data, error } = await rpc(ctx.actor, "area_photo_queue", {
    p_venue_id: ctx.venueId,
    p_status: status === "pending" ? "pending" : "all",
    p_limit: 50,
  })
  if (error) return areaFailure(error, "area photo queue")
  const cards = ((data as Record<string, unknown>[] | null) ?? []).flatMap(
    (r): AreaPhotoCard[] => {
      if (!isUuid(r.label_id) || !isUuid(r.asset_id) || !isState(r.state))
        return []
      if (status === "decided" && r.state === "pending") return []
      return [
        {
          labelId: r.label_id,
          assetId: r.asset_id,
          authorName: text(r.author_name) ?? "",
          area: text(r.subject_label) ?? "",
          uploadedAt: text(r.uploaded_at) ?? "",
          labelledAt: text(r.labelled_at) ?? "",
          creditMonth: text(r.credit_month) ?? "",
          state: r.state,
          reason: text(r.reason),
          decidedAt: text(r.decided_at),
          canDecide: r.can_decide === true,
          thumbnailUrl: r.has_thumbnail
            ? mediaRoutes.thumbnail(r.asset_id)
            : null,
          previewUrl: r.has_preview ? mediaRoutes.preview(r.asset_id) : null,
        },
      ]
    }
  )
  return { ok: true, cards }
}

/** One decision; a reason is required except to accept. */
export async function decideAreaPhoto(
  ctx: ManagerPhotoCtx,
  labelId: unknown,
  decision: unknown,
  reason: unknown
): Promise<Result<{ state: AreaPhotoState }>> {
  if (!isUuid(labelId)) return invalid({ labelId: "Reload the page." })
  if (
    decision !== "accepted" &&
    decision !== "needs_another_photo" &&
    decision !== "withdrawn"
  )
    return invalid({ decision: "Reload the page." })
  const why = typeof reason === "string" ? reason.trim() : ""
  if (decision !== "accepted" && !why) return MESSAGES.reason_required!
  if (why.length > 500)
    return invalid({ reason: "Use 500 characters or fewer." })
  const { data, error } = await rpc(ctx.actor, "decide_area_photo", {
    p_label_id: labelId,
    p_action: decision,
    p_reason: decision === "accepted" ? null : why,
  })
  if (error) return areaFailure(error, "decide area photo")
  const state = (data as { state?: unknown }[] | null)?.[0]?.state
  return { ok: true, state: isState(state) ? state : decision }
}
