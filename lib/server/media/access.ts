import { MEDIA_LIMITS } from "@/lib/config/media"
import { STORAGE_BUCKETS } from "@/lib/config/storage"

import { fetchMediaObject } from "./storage"
import type { MediaActor, Outcome } from "./types"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReadableAsset = {
  id: string
  uploaderId: string
  mediaType: "image" | "video"
  originalPath: string
  previewPath: string | null
  thumbnailPath: string | null
  mimeType: string
  sizeBytes: number
  /** Null for a colleague: original filenames stay with the owner and admins. */
  originalFilename: string | null
}

const notFound: Outcome<never> = {
  ok: false,
  status: 404,
  message: "Not found.",
}

/** Every private media response, including redirects to signed URLs. */
export const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const

const unavailable: Outcome<never> = {
  ok: false,
  status: 503,
  message: "Try again.",
}

/**
 * A ready, non-deleted asset the caller may read: their own, any ready asset as
 * an active admin, or an active colleague's portfolio asset. Own and admin rows
 * come through the caller's RLS-scoped client. Colleagues have no row access:
 * the `community_readable_assets` check runs as the caller, and only after it
 * passes does the service role read the storage paths. A service-role step
 * afterwards therefore only touches an authorised asset. Unknown and forbidden
 * assets look the same (404).
 */
export async function getReadableAsset(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<{ asset: ReadableAsset }>> {
  if (!actor.profile.active || !UUID.test(assetId)) return notFound
  const { data, error } = await actor.db
    .from("media_assets")
    .select(
      "id, uploader_id, media_type, original_path, preview_path, thumbnail_path, validated_mime_type, size_bytes, original_filename, upload_state, deleted_at"
    )
    .eq("id", assetId)
    .maybeSingle()
  if (error) return unavailable
  if (
    data &&
    (actor.profile.role === "admin" || data.uploader_id === actor.profile.id)
  ) {
    if (
      data.deleted_at !== null ||
      data.upload_state !== "ready" ||
      !data.validated_mime_type ||
      data.size_bytes === null
    ) {
      return notFound
    }
    return {
      ok: true,
      asset: {
        id: data.id,
        uploaderId: data.uploader_id,
        mediaType: data.media_type,
        originalPath: data.original_path,
        previewPath: data.preview_path,
        thumbnailPath: data.thumbnail_path,
        mimeType: data.validated_mime_type,
        sizeBytes: Number(data.size_bytes),
        originalFilename: data.original_filename,
      },
    }
  }
  if (actor.profile.role !== "staff") return notFound
  return getColleagueAsset(actor, assetId)
}

async function getColleagueAsset(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<{ asset: ReadableAsset }>> {
  // Rechecked on every request, so a deactivated colleague's media becomes
  // unavailable to peers at once.
  const checked = await actor.db.rpc("community_readable_assets", {
    p_asset_ids: [assetId],
  })
  if (checked.error) return unavailable
  const row = checked.data?.find((r) => r.id === assetId)
  if (!row || !row.validated_mime_type || row.size_bytes === null) {
    return notFound
  }
  const paths = await actor.service
    .from("media_assets")
    .select("original_path, preview_path, thumbnail_path")
    .eq("id", assetId)
    .eq("upload_state", "ready")
    .is("deleted_at", null)
    .maybeSingle()
  if (paths.error) return unavailable
  if (!paths.data) return notFound
  return {
    ok: true,
    asset: {
      id: row.id,
      uploaderId: row.uploader_id,
      mediaType: row.media_type,
      originalPath: paths.data.original_path,
      previewPath: paths.data.preview_path,
      thumbnailPath: paths.data.thumbnail_path,
      mimeType: row.validated_mime_type,
      sizeBytes: Number(row.size_bytes),
      originalFilename: null,
    },
  }
}

type CanOpenClient = {
  rpc(
    fn: "asset_search_can_open",
    args: { p_asset_id: string }
  ): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Search arm of the thumbnail gate (B05-m4): the venue's effective manager
 * (manager accounts and legacy staff grant holders) may see the thumbnail of an
 * asset that asset search lists for it. The database answers
 * with the search predicate itself (`asset_search_can_open`, as the caller);
 * only then does the service role read the storage paths. Thumbnails only:
 * originals, previews and downloads keep the rules of `getReadableAsset`.
 */
async function getSearchThumbnailAsset(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<{ asset: ReadableAsset }>> {
  const checked = await (actor.db as unknown as CanOpenClient).rpc(
    "asset_search_can_open",
    { p_asset_id: assetId }
  )
  if (checked.error) return unavailable
  if (checked.data !== true) return notFound
  const { data, error } = await actor.service
    .from("media_assets")
    .select(
      "id, uploader_id, media_type, original_path, preview_path, thumbnail_path, validated_mime_type, size_bytes"
    )
    .eq("id", assetId)
    .eq("upload_state", "ready")
    .is("deleted_at", null)
    .maybeSingle()
  if (error) return unavailable
  if (!data || !data.validated_mime_type || data.size_bytes === null)
    return notFound
  return {
    ok: true,
    asset: {
      id: data.id,
      uploaderId: data.uploader_id,
      mediaType: data.media_type,
      originalPath: data.original_path,
      previewPath: data.preview_path,
      thumbnailPath: data.thumbnail_path,
      mimeType: data.validated_mime_type,
      sizeBytes: Number(data.size_bytes),
      originalFilename: null,
    },
  }
}

/**
 * Lifetime of newly issued signed read URLs: MEDIA_LIMITS.signedUrlExpirySeconds
 * (60 s). Tests can SHORTEN it with NABALENS_SIGNED_URL_TTL_SECONDS to exercise
 * expiry; the override can never lengthen it, so it cannot weaken production.
 */
export function signedUrlTtlSeconds(): number {
  const limit = MEDIA_LIMITS.signedUrlExpirySeconds
  const raw = process.env.NABALENS_SIGNED_URL_TTL_SECONDS
  const override = raw && /^\d+$/.test(raw) ? Number(raw) : NaN
  return override >= 1 && override < limit ? override : limit
}

/**
 * A fresh signed URL (signedUrlTtlSeconds(), at most 60 s) for an image
 * derivative. Signed with the service role only after `getReadableAsset` has
 * authorised the caller and the asset: end users have no storage read policy, so
 * they cannot mint signed URLs (of any lifetime) themselves (wave 3 finding 1).
 * A thumbnail that `getReadableAsset` refuses (404) for an active non-admin is
 * retried through the asset-search arm (`getSearchThumbnailAsset`), which lets
 * `asset_search_can_open` decide: the venue's effective manager, including a
 * legacy staff account holding an open manager grant, gets the thumbnails its
 * search lists; anyone search refuses gets false and keeps the 404. Only that
 * 404 path costs the extra call; the same TTL applies.
 */
export async function signDerivative(
  actor: MediaActor,
  assetId: string,
  which: "thumbnail" | "preview"
): Promise<Outcome<{ url: string }>> {
  let found = await getReadableAsset(actor, assetId)
  if (
    !found.ok &&
    found.status === 404 &&
    which === "thumbnail" &&
    actor.profile.active &&
    actor.profile.role !== "admin" &&
    UUID.test(assetId)
  )
    found = await getSearchThumbnailAsset(actor, assetId)
  if (!found.ok) return found
  const path =
    which === "thumbnail" ? found.asset.thumbnailPath : found.asset.previewPath
  if (!path) return notFound
  const { data, error } = await actor.service.storage
    .from(STORAGE_BUCKETS.media)
    .createSignedUrl(path, signedUrlTtlSeconds())
  if (error || !data) return notFound
  return { ok: true, url: data.signedUrl }
}

const EXTENSION_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
}

/**
 * `attachment` disposition with a safe ASCII fallback and an RFC 5987 UTF-8
 * name. The extension always matches the validated type, so an original named
 * `menu.html` is saved as `menu.jpg`.
 */
export function attachmentDisposition(filename: string, mime: string): string {
  const ext = EXTENSION_FOR_MIME[mime] ?? "bin"
  const stem =
    filename
      .replace(/\.[^.]*$/, "")

      .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
      .trim() || "nabalens-file"
  const name = `${stem}.${ext}`
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * Streams an original byte-for-byte (download, or inline video playback through
 * Range requests). Headers come from the validated record, never from storage
 * metadata or the browser: validated Content-Type, nosniff and private,
 * no-store. The owner and admins get an attachment disposition with the
 * original filename; a colleague (no filename on the asset) gets a bare
 * `inline`, so playback never hands out the uploader's filename. The bytes are
 * still the original, including any embedded metadata such as location.
 */
export async function streamOriginal(
  actor: MediaActor,
  asset: ReadableAsset,
  range: string | null
): Promise<Response> {
  const upstream = await fetchMediaObject(
    actor.storage,
    asset.originalPath,
    range
  )
  if (upstream.status !== 200 && upstream.status !== 206) {
    // Drain the small error body. Awaiting body.cancel() here never settled
    // under `next start` (Next's fetch hands back a tee'd stream), so a missing
    // original hung the download instead of answering 404.
    await upstream.arrayBuffer().catch(() => undefined)
    if (upstream.status === 416) {
      return new Response(null, {
        status: 416,
        headers: {
          ...PRIVATE_HEADERS,
          "content-range": `bytes */${asset.sizeBytes}`,
        },
      })
    }
    return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS })
  }
  const headers = new Headers({
    ...PRIVATE_HEADERS,
    "content-type": asset.mimeType,
    "content-disposition":
      asset.originalFilename === null
        ? "inline"
        : attachmentDisposition(asset.originalFilename, asset.mimeType),
    "accept-ranges": "bytes",
  })
  for (const name of [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
