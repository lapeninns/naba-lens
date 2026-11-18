import {
  normaliseRemovalReason,
  parseRemovalImpact,
  parseRemovalRequests,
  type RemovalImpact,
  type RemovalRequest,
  type RemovalRequestState,
} from "@/lib/media/removal"
import { removeTombstonedObjects } from "@/lib/server/lifecycle/remove-media"
import type { RemoveObjects } from "@/lib/server/lifecycle/storage"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

/*
 * Removal of accepted media (FA-21, spec §3.3, §16). The database decides who
 * may do what (20261118107100_media_removal.sql); these calls run as the
 * caller and only map refusals to statuses and words. After an admin removal
 * the service role deletes the stored objects, as for a withdrawal.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type DbError = { code?: string; message?: string } | null

const notFound = {
  ok: false,
  status: 404,
  message: "This photo could not be found.",
} as const
const unavailable = {
  ok: false,
  status: 503,
  message: "Couldn't reach Naba-Lens. Try again.",
} as const
const needReason = {
  ok: false,
  status: 400,
  message: "Give a reason of at least 3 characters.",
} as const

function refusal(error: DbError): Outcome<never> {
  switch (error?.message) {
    case "media_asset_not_found":
    case "request_not_found":
      return notFound
    case "not_active_user":
    case "not_permitted":
      return { ok: false, status: 403, message: "Not allowed." }
    case "reason_required":
      return needReason
    case "withdraw_instead":
      return {
        ok: false,
        status: 409,
        message:
          "This photo hasn't been accepted yet, so you can remove it yourself.",
      }
    case "request_closed":
      return {
        ok: false,
        status: 409,
        message: "This request has already been decided.",
      }
    case "impact_changed":
      return {
        ok: false,
        status: 409,
        message:
          "What this removal affects has changed. Check the preview again.",
      }
    case "media_asset_published":
      return {
        ok: false,
        status: 409,
        message: "This photo is published. Withdraw its public uses first.",
      }
    default:
      return unavailable
  }
}

/** What removing the asset touches. Admins and the venue's manager. */
export async function getRemovalImpact(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<{ impact: RemovalImpact }>> {
  if (!UUID.test(assetId)) return notFound
  const { data, error } = await actor.db.rpc("media_removal_impact", {
    p_asset_id: assetId,
  })
  if (error) return refusal(error)
  const impact = parseRemovalImpact(data)
  return impact ? { ok: true, impact } : unavailable
}

/** The uploader of an accepted photo, or the venue's manager, asks an admin. */
export async function requestMediaRemoval(
  actor: MediaActor,
  assetId: string,
  rawReason: unknown
): Promise<Outcome<{ requestId: string; created: boolean }>> {
  if (!UUID.test(assetId)) return notFound
  const reason = normaliseRemovalReason(rawReason)
  if (!reason) return needReason
  const { data, error } = await actor.db.rpc("request_media_removal", {
    p_asset_id: assetId,
    p_reason: reason,
  })
  if (error) return refusal(error)
  const row = data as { requestId?: unknown; created?: unknown } | null
  if (typeof row?.requestId !== "string") return unavailable
  return { ok: true, requestId: row.requestId, created: row.created === true }
}

/** The requester withdraws an open request. */
export async function cancelMediaRemovalRequest(
  actor: MediaActor,
  requestId: string
): Promise<Outcome<Record<never, never>>> {
  if (!UUID.test(requestId)) return notFound
  const { error } = await actor.db.rpc("cancel_media_removal_request", {
    p_request_id: requestId,
  })
  return error ? refusal(error) : { ok: true }
}

/** Admin: keep the photo, with a reason the requester sees. */
export async function declineMediaRemovalRequest(
  actor: MediaActor,
  requestId: string,
  rawReason: unknown
): Promise<Outcome<Record<never, never>>> {
  if (!UUID.test(requestId)) return notFound
  const reason = normaliseRemovalReason(rawReason)
  if (!reason) return needReason
  const { error } = await actor.db.rpc("decline_media_removal_request", {
    p_request_id: requestId,
    p_reason: reason,
  })
  return error ? refusal(error) : { ok: true }
}

/**
 * Admin: removes an asset (accepted or not) with a reason and the token of
 * the impact preview the admin saw. Open requests for it close as completed.
 */
export async function removeAcceptedMediaAsset(
  actor: MediaActor,
  input: { assetId: string; reason: unknown; impactToken: string },
  removeObjects?: RemoveObjects
): Promise<
  Outcome<{ closedRequests: string[]; storage: "removed" | "pending" }>
> {
  if (!UUID.test(input.assetId)) return notFound
  const reason = normaliseRemovalReason(input.reason)
  if (!reason) return needReason
  if (typeof input.impactToken !== "string" || !input.impactToken)
    return refusal({ message: "impact_changed" })
  const { data, error } = await actor.db.rpc("admin_delete_media_asset", {
    p_asset_id: input.assetId,
    p_reason: reason,
    p_impact_token: input.impactToken,
  })
  if (error) return refusal(error)
  const closed = (data as { closedRequests?: unknown } | null)?.closedRequests
  const storage = await removeTombstonedObjects(
    actor.service,
    input.assetId,
    removeObjects
  )
  return {
    ok: true,
    closedRequests: Array.isArray(closed)
      ? closed.filter((id): id is string => typeof id === "string")
      : [],
    storage,
  }
}

/** Admins all, managers their venue, everyone else their own. */
export async function listMediaRemovalRequests(
  actor: MediaActor,
  filters: { state?: RemovalRequestState | null; venueId?: string | null } = {}
): Promise<Outcome<{ requests: RemovalRequest[] }>> {
  if (filters.venueId && !UUID.test(filters.venueId))
    return { ok: false, status: 400, message: "Invalid venue." }
  const { data, error } = await actor.db.rpc("media_removal_requests", {
    p_state: filters.state === undefined ? "open" : (filters.state as string),
    ...(filters.venueId ? { p_venue_id: filters.venueId } : {}),
  })
  if (error) return refusal(error)
  return { ok: true, requests: parseRemovalRequests(data) }
}
