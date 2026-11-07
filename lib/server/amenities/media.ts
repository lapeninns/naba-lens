import "server-only"

import { isUuid } from "@/lib/server/coverage/validate"
import type { ReadableAsset } from "@/lib/server/media/access"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { amenityRpc } from "./rpc"

const notFound = { ok: false, status: 404, message: "Not found." } as const
const unavailable = { ok: false, status: 503, message: "Try again." } as const

/**
 * A video the caller may play as amenity evidence (or as one of their own
 * submittable assets). The caller-scoped `amenity_evidence_asset` check runs
 * first; only then does the service role read the storage path. The result
 * has no filename, so `streamOriginal` answers `inline` and never offers the
 * original as a download. Unknown and forbidden are the same 404.
 */
export async function amenityVideo(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<{ asset: ReadableAsset }>> {
  if (!actor.profile.active || !isUuid(assetId)) return notFound
  const check = await amenityRpc(actor, "amenity_evidence_asset", {
    p_asset_id: assetId,
  })
  if (check.error) return unavailable
  if (check.data[0]?.media_type !== "video") return notFound

  const { data, error } = await actor.service
    .from("media_assets")
    .select(
      "id, uploader_id, media_type, original_path, validated_mime_type, size_bytes, upload_state, deleted_at"
    )
    .eq("id", assetId)
    .maybeSingle()
  if (error) return unavailable
  if (
    !data ||
    data.media_type !== "video" ||
    data.upload_state !== "ready" ||
    data.deleted_at !== null ||
    !data.validated_mime_type ||
    data.size_bytes === null
  )
    return notFound
  return {
    ok: true,
    asset: {
      id: data.id,
      uploaderId: data.uploader_id,
      mediaType: data.media_type,
      originalPath: data.original_path,
      previewPath: null,
      thumbnailPath: null,
      mimeType: data.validated_mime_type,
      sizeBytes: Number(data.size_bytes),
      originalFilename: null,
    },
  }
}
