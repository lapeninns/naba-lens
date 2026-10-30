import { uploadBlockReason } from "@/lib/auth/profile"
import { maxBytesFor, MEDIA_LIMITS } from "@/lib/config/media"
import { STORAGE_BUCKETS } from "@/lib/config/storage"

import { touchMediaReservation } from "@/lib/server/lifecycle/cleanup"

import { rpcFailure } from "./errors"
import { statMediaObject } from "./storage"
import type { MediaActor, MediaKind, Outcome, UploadState } from "./types"

/** Browser hints (lib/upload ReserveInput). None of these are trusted. */
export type ReserveRequest = {
  idempotencyKey: string
  filename: string
  sizeBytes: number
  contentType: string
  mediaType: MediaKind
  preferResumable: boolean
}

export type ReserveResponse = {
  assetId: string
  objectKey: string
  bucket: "media"
  uploadUrl?: string
  token?: string
  resumable: boolean
  state?: UploadState
}

/** Same threshold as lib/upload: Supabase's TUS chunk size. */
const RESUMABLE_ABOVE_BYTES = 6 * 1024 * 1024

export const UPLOAD_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

const EXTENSIONS: Record<MediaKind, Record<string, string>> = {
  image: {
    jpg: "jpg",
    jpeg: "jpg",
    png: "png",
    webp: "webp",
    heic: "heic",
    heif: "heif",
  },
  video: { mp4: "mp4", mov: "mov", webm: "webm" },
}

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
}

const BLOCKED: Record<string, string> = {
  not_staff: "Only staff accounts can upload.",
  no_venue:
    "Your account is not assigned to a venue yet, so uploads are paused. Ask an admin to assign your venue.",
  venue_inactive:
    "Your venue is not taking uploads right now. Ask an admin to check your venue.",
}

/** Display name without path separators or control characters. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""

  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  return cleaned.slice(0, 255)
}

/**
 * Key extension from the browser's filename or type. Cosmetic only: the stored
 * MIME type always comes from content validation in `finaliseAsset`.
 */
function keyExtension(kind: MediaKind, filename: string, contentType: string) {
  const fromName = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : ""
  const fromType = EXTENSION_FOR_TYPE[contentType.toLowerCase().split(";")[0]]
  return (
    EXTENSIONS[kind][fromName] ??
    (fromType && Object.values(EXTENSIONS[kind]).includes(fromType)
      ? fromType
      : null)
  )
}

function invalid(message: string): Outcome<never> {
  return { ok: false, status: 400, message }
}

/**
 * Reserve an upload (spec §5 step 2). The database derives owner, venue, asset ID
 * and object key from the caller's current profile; a repeated idempotency key
 * returns the same asset. Returns a narrowly scoped signed upload URL for the
 * reserved key only, signed as the caller so the storage insert policy applies.
 */
export async function reserveAsset(
  actor: MediaActor,
  input: ReserveRequest
): Promise<Outcome<ReserveResponse>> {
  const blocked = uploadBlockReason(actor.profile)
  if (blocked) return { ok: false, status: 403, message: BLOCKED[blocked] }

  if (
    typeof input?.idempotencyKey !== "string" ||
    !UPLOAD_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    return invalid(
      "This upload is missing its retry key. Reload and try again."
    )
  }
  if (input.mediaType !== "image" && input.mediaType !== "video") {
    return invalid("Choose a photo or a video.")
  }
  const filename = cleanFilename(String(input.filename ?? ""))
  if (!filename) return invalid("This file has no name.")
  const size = Number(input.sizeBytes)
  if (!Number.isSafeInteger(size) || size <= 0) {
    return invalid("This file is empty.")
  }
  const max = maxBytesFor(input.mediaType)
  if (size > max) {
    return invalid(
      `${input.mediaType === "image" ? "Photos" : "Videos"} can be up to ${Math.round(max / (1024 * 1024))} MB.`
    )
  }
  const ext = keyExtension(
    input.mediaType,
    filename,
    String(input.contentType ?? "")
  )
  if (!ext) {
    return invalid(
      "This file type is not supported. Use JPEG, PNG, WebP, HEIC, MP4, MOV or WebM."
    )
  }

  const { data, error } = await actor.db.rpc("reserve_media_asset", {
    p_media_type: input.mediaType,
    p_extension: ext,
    p_original_filename: filename,
    p_size_bytes: size,
    p_client_upload_key: input.idempotencyKey,
  })
  if (error) return rpcFailure(error)
  const row = data?.[0]
  if (!row)
    return { ok: false, status: 503, message: "Could not reserve the upload." }

  const base = {
    assetId: row.id,
    objectKey: row.original_path,
    bucket: STORAGE_BUCKETS.media,
  } as const

  // Every attempt that is not already finished counts as upload activity, so
  // the 24 h abandoned-upload cleanup never removes a live (TUS) transfer.
  // Same as lifecycle's recordUploadActivity, with this request's service client.
  if (row.upload_state !== "ready") {
    try {
      await touchMediaReservation(actor.service, row.id)
    } catch {
      return {
        ok: false,
        status: 503,
        message: "Could not prepare the upload. Try again.",
      }
    }
  }

  if (row.upload_state === "ready" || row.upload_state === "processing") {
    return { ok: true, ...base, resumable: false, state: row.upload_state }
  }

  if (row.upload_state === "uploading" && row.reused) {
    // A retry whose earlier transfer finished but lost its response.
    const stored = await statMediaObject(actor.storage, row.original_path)
    if (stored !== null) {
      return { ok: true, ...base, resumable: false, state: "processing" }
    }
  }

  if (row.upload_state === "failed") {
    // Bytes already stored: let the client finalise again (validation is
    // idempotent). No bytes: reopen the reservation so the transfer can run.
    const stored = await statMediaObject(actor.storage, row.original_path)
    if (stored !== null) {
      return { ok: true, ...base, resumable: false, state: "processing" }
    }
    const { error: reopenError } = await actor.service
      .from("media_assets")
      .update({ upload_state: "uploading" })
      .eq("id", row.id)
      .eq("uploader_id", actor.profile.id)
      .eq("upload_state", "failed")
      .is("deleted_at", null)
    if (reopenError) {
      return { ok: false, status: 503, message: "Could not reopen the upload." }
    }
  }

  const resumable =
    input.preferResumable === true ||
    input.mediaType === "video" ||
    size > RESUMABLE_ABOVE_BYTES ||
    size > MEDIA_LIMITS.maxPhotoBytes
  if (resumable) {
    return { ok: true, ...base, resumable: true, state: "uploading" }
  }

  // A fresh URL per call; it expires after two hours and never overwrites.
  const signed = await actor.db.storage
    .from(STORAGE_BUCKETS.media)
    .createSignedUploadUrl(row.original_path)
  if (signed.error || !signed.data) {
    return {
      ok: false,
      status: 503,
      message: "Could not prepare the upload. Try again.",
    }
  }
  return {
    ok: true,
    ...base,
    resumable: false,
    uploadUrl: signed.data.signedUrl,
    token: signed.data.token,
    state: "uploading",
  }
}
