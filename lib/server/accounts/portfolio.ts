// INTERIM (accounts track): the admin view of one staff member's portfolio.
// The slice track owns the media queries. When its listing function is merged,
// the integrator should point /admin/staff/[id] at it and delete this file; the
// return shape matches the UI's MediaItem so the page does not change.

import { MEDIA_LIMITS } from "@/lib/config/media"
import { STORAGE_BUCKETS } from "@/lib/config/storage"

import {
  fail,
  requireAdminCaller,
  type AccountResult,
  type AccountsContext,
} from "./context"
import { dbFailed } from "./invite"
import { isUuid } from "./validation"

/** Structurally identical to components/nabalens MediaItem (server code cannot import it). */
export type PortfolioMediaItem = {
  id: string
  mediaType: "image" | "video"
  uploadState: "uploading" | "processing" | "ready" | "failed"
  thumbnailUrl: string | null
  previewUrl: string | null
  mimeType: string | null
  originalFilename: string
  createdAt: string
  contributorId: string
  contributorName: string
  venueName: string
  width: number | null
  height: number | null
  durationSeconds: number | null
  sizeBytes: number | null
}

export type PortfolioPage = {
  items: PortfolioMediaItem[]
  /** Opaque; pass back to get the next page. Null on the last page. */
  nextCursor: string | null
}

type Cursor = { createdAt: string; id: string }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

// Postgres timestamptz as PostgREST returns it, kept verbatim (microseconds).
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || raw.length > 200) return null
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (
      isUuid(value?.id) &&
      typeof value?.createdAt === "string" &&
      TIMESTAMP.test(value.createdAt)
    ) {
      return { id: value.id, createdAt: value.createdAt }
    }
  } catch {}
  return null
}

/**
 * Ready, non-deleted media uploaded by one person, newest first, as the calling
 * admin sees it (RLS: admins read every ready asset, including those of inactive
 * staff). Each asset keeps its upload-time venue. Signed URLs expire after
 * MEDIA_LIMITS.signedUrlExpirySeconds.
 */
export async function listMediaForUploader(
  ctx: AccountsContext,
  uploaderId: unknown,
  options: { cursor?: unknown; limit?: number } = {}
): Promise<AccountResult<PortfolioPage>> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth
  if (!isUuid(uploaderId)) return fail("not_found", "Not found.")

  const limit = Math.min(
    Math.max(options.limit ?? MEDIA_LIMITS.pageSize, 1),
    100
  )
  const cursor = options.cursor == null ? null : decodeCursor(options.cursor)
  if (options.cursor != null && !cursor) {
    return fail("invalid_input", "That page is no longer available. Reload.")
  }

  let query = ctx.caller
    .from("media_assets")
    .select(
      "id, media_type, upload_state, original_path, preview_path, thumbnail_path, validated_mime_type, original_filename, created_at, uploader_id, width, height, duration_seconds, size_bytes, venue:venues(name), uploader:profiles(display_name)"
    )
    .eq("uploader_id", uploaderId)
    .eq("upload_state", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1)
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`
    )
  }
  const { data, error } = await query
  if (error) return dbFailed()

  const rows = data.slice(0, limit)
  // Images preview from their derivative; videos play the validated original.
  const paths = rows
    .flatMap((r) => [
      ...(r.thumbnail_path ? [r.thumbnail_path] : []),
      r.media_type === "video" ? r.original_path : (r.preview_path ?? null),
    ])
    .filter((p): p is string => !!p)

  const urls = new Map<string, string>()
  if (paths.length > 0) {
    // Service role after requireAdminCaller and the RLS row read above: end
    // users have no storage read policy (wave 3 finding 1).
    const { data: signed } = await ctx.service.storage
      .from(STORAGE_BUCKETS.media)
      .createSignedUrls(paths, MEDIA_LIMITS.signedUrlExpirySeconds)
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl)
    }
  }

  const items: PortfolioMediaItem[] = rows.map((r) => {
    const previewPath =
      r.media_type === "video" ? r.original_path : r.preview_path
    return {
      id: r.id,
      mediaType: r.media_type,
      uploadState: r.upload_state,
      thumbnailUrl: r.thumbnail_path
        ? (urls.get(r.thumbnail_path) ?? null)
        : null,
      previewUrl: previewPath ? (urls.get(previewPath) ?? null) : null,
      mimeType: r.validated_mime_type,
      originalFilename: r.original_filename,
      createdAt: r.created_at,
      contributorId: r.uploader_id,
      contributorName: r.uploader?.display_name ?? "",
      venueName: r.venue?.name ?? "",
      width: r.width,
      height: r.height,
      durationSeconds:
        r.duration_seconds === null ? null : Number(r.duration_seconds),
      sizeBytes: r.size_bytes,
    }
  })

  const last = rows.at(-1)
  return {
    ok: true,
    items,
    nextCursor:
      data.length > limit && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
  }
}
