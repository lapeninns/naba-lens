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
  originalFilename: string
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

/**
 * A ready, non-deleted asset the caller may read: their own (active staff) or any
 * (active admin). Read through the caller's RLS-scoped client, then re-checked
 * here, so a service-role step afterwards only touches an authorised asset.
 * Unknown and forbidden assets look the same (404).
 */
export async function getReadableAsset(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<{ asset: ReadableAsset }>> {
  if (!UUID.test(assetId)) return notFound
  const { data, error } = await actor.db
    .from("media_assets")
    .select(
      "id, uploader_id, media_type, original_path, preview_path, thumbnail_path, validated_mime_type, size_bytes, original_filename, upload_state, deleted_at"
    )
    .eq("id", assetId)
    .maybeSingle()
  if (error) return { ok: false, status: 503, message: "Try again." }
  if (
    !data ||
    data.deleted_at !== null ||
    data.upload_state !== "ready" ||
    !data.validated_mime_type ||
    data.size_bytes === null
  ) {
    return notFound
  }
  const allowed =
    actor.profile.role === "admin" ||
    (actor.profile.role === "staff" && data.uploader_id === actor.profile.id)
  if (!allowed) return notFound
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

/**
 * A fresh signed URL (MEDIA_LIMITS.signedUrlExpirySeconds = 60 s) for an image
 * derivative. Signed with the service role only after `getReadableAsset` has
 * authorised the caller and the asset: end users have no storage read policy, so
 * they cannot mint signed URLs (of any lifetime) themselves (wave 3 finding 1).
 */
export async function signDerivative(
  actor: MediaActor,
  assetId: string,
  which: "thumbnail" | "preview"
): Promise<Outcome<{ url: string }>> {
  const found = await getReadableAsset(actor, assetId)
  if (!found.ok) return found
  const path =
    which === "thumbnail" ? found.asset.thumbnailPath : found.asset.previewPath
  if (!path) return notFound
  const { data, error } = await actor.service.storage
    .from(STORAGE_BUCKETS.media)
    .createSignedUrl(path, MEDIA_LIMITS.signedUrlExpirySeconds)
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
 * metadata or the browser: attachment disposition, validated Content-Type,
 * nosniff and private, no-store.
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
    await upstream.body?.cancel()
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
    "content-disposition": attachmentDisposition(
      asset.originalFilename,
      asset.mimeType
    ),
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
