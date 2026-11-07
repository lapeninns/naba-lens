import "server-only"

import { STORAGE_BUCKETS } from "@/lib/config/storage"
import { signedUrlTtlSeconds } from "@/lib/server/media/access"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { isUuid } from "./validate"

const notFound = { ok: false, status: 404, message: "Not found." } as const

/**
 * The caller-scoped check run before any storage key is read. Both return the
 * same shape: `task_evidence_asset` for task evidence, `menu_item_photo_asset`
 * for Our menu photos (labelled photos for the venue's manager or an admin, an
 * item's primary photo for staff at the venue, and the uploader's own).
 */
export type EvidenceCheck = "task_evidence_asset" | "menu_item_photo_asset"

/**
 * Signed (at most 60 s) URL for a task-evidence derivative. The caller-scoped
 * `task_evidence_asset` check runs first: the asset must be ready, undeleted
 * and on a coverage item or amenity fact the caller may see (its author, or
 * the venue's manager or an admin, including retained photos of people who
 * have left). Only then are storage keys read and signed with the service
 * role. Originals, downloads and video streams are never served here, and
 * community visibility is unchanged. Unknown and forbidden look the same.
 * `rpc` picks the check (see EvidenceCheck); the signing is the same.
 */
export async function signEvidence(
  actor: MediaActor,
  assetId: string,
  which: "thumbnail" | "preview",
  rpc: EvidenceCheck = "task_evidence_asset"
): Promise<Outcome<{ url: string }>> {
  if (!actor.profile.active || !isUuid(assetId)) return notFound
  const check = await actor.db.rpc(rpc, { p_asset_id: assetId })
  if (check.error) return { ok: false, status: 503, message: "Try again." }
  const allowed = check.data?.[0]
  if (
    !allowed ||
    allowed.media_type !== "image" ||
    !(which === "thumbnail" ? allowed.has_thumbnail : allowed.has_preview)
  )
    return notFound

  const { data, error } = await actor.service
    .from("media_assets")
    .select("thumbnail_path, preview_path, upload_state, deleted_at")
    .eq("id", assetId)
    .maybeSingle()
  if (error) return { ok: false, status: 503, message: "Try again." }
  const path = which === "thumbnail" ? data?.thumbnail_path : data?.preview_path
  if (!data || !path || data.upload_state !== "ready" || data.deleted_at)
    return notFound
  const signed = await actor.service.storage
    .from(STORAGE_BUCKETS.media)
    .createSignedUrl(path, signedUrlTtlSeconds())
  if (signed.error || !signed.data) return notFound
  return { ok: true, url: signed.data.signedUrl }
}
