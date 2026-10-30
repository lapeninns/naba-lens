import { maxBytesFor, MEDIA_LIMITS } from "@/lib/config/media"
import { mediaObjectKeys, STORAGE_BUCKETS } from "@/lib/config/storage"
import { sniffMedia, validateMedia } from "@/lib/media"
import { touchMediaReservation } from "@/lib/server/lifecycle/cleanup"

import { validationMessage } from "./errors"
import { mediaRangeSource, statMediaObject } from "./storage"
import type { MediaActor, Outcome } from "./types"

export type FinaliseRequest = { assetId: string; idempotencyKey: string }

/** lib/upload FinaliseResult. A non-ok Outcome means "could not confirm, retry". */
export type FinaliseResponse =
  { state: "ready" } | { state: "failed"; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A `processing` claim older than this is treated as a crashed finalise. */
const STALE_PROCESSING_MS = 2 * 60 * 1000
/** How long a second finalise waits for one already running. */
const WAIT_FOR_OTHER_MS = 20_000
/** HEIC decodes run one at a time per process (`decoder_busy` means retry). */
const BUSY_RETRIES = 8

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type AssetRow = {
  id: string
  uploader_id: string
  original_path: string
  original_filename: string
  media_type: "image" | "video"
  upload_state: "uploading" | "processing" | "ready" | "failed"
  client_upload_key: string | null
  /** Declared by the browser at reserve (its exact File.size); null if unknown. */
  size_bytes: number | null
  updated_at: string
}

const notFound: Outcome<never> = {
  ok: false,
  status: 404,
  message: "This upload could not be found.",
}

async function readOwnAsset(actor: MediaActor, assetId: string) {
  // RLS: active staff read only their own, non-deleted rows.
  const { data, error } = await actor.db
    .from("media_assets")
    .select(
      "id, uploader_id, original_path, original_filename, media_type, upload_state, client_upload_key, size_bytes, updated_at"
    )
    .eq("id", assetId)
    .eq("uploader_id", actor.profile.id)
    .is("deleted_at", null)
    .maybeSingle()
  if (error) throw new Error(`asset_read_${error.code ?? "unknown"}`)
  return data as AssetRow | null
}

/** processing -> uploading|failed claims: compare-and-set on the state. */
async function setState(
  actor: MediaActor,
  assetId: string,
  from: AssetRow["upload_state"][],
  to: AssetRow["upload_state"]
) {
  const { data, error } = await actor.service
    .from("media_assets")
    .update({ upload_state: to })
    .eq("id", assetId)
    .in("upload_state", from)
    .is("deleted_at", null)
    .select("id")
  if (error) throw new Error(`asset_state_${error.code ?? "unknown"}`)
  return (data?.length ?? 0) > 0
}

async function claim(actor: MediaActor, row: AssetRow) {
  if (await setState(actor, row.id, ["uploading", "failed"], "processing")) {
    return "claimed" as const
  }
  // Someone else is processing: wait for them, then take over a stale claim.
  const started = Date.now()
  for (;;) {
    const current = await readOwnAsset(actor, row.id)
    if (!current) return "gone" as const
    if (current.upload_state === "ready") return "ready" as const
    if (current.upload_state !== "processing") {
      if (await setState(actor, row.id, ["uploading", "failed"], "processing"))
        return "claimed" as const
      continue
    }
    if (Date.now() - Date.parse(current.updated_at) > STALE_PROCESSING_MS) {
      // Reset then re-claim, each step a compare-and-set.
      const { data } = await actor.service
        .from("media_assets")
        .update({ upload_state: "failed" })
        .eq("id", row.id)
        .eq("upload_state", "processing")
        .eq("updated_at", current.updated_at)
        .select("id")
      if (data?.length) continue
    }
    if (Date.now() - started > WAIT_FOR_OTHER_MS) return "busy" as const
    await sleep(500)
  }
}

type Validation =
  | {
      ok: true
      mime: string
      size: number
      width?: number
      height?: number
      durationSeconds?: number
      preview?: Uint8Array
      thumb?: Uint8Array
    }
  | { ok: false; error: string }

async function validateStored(
  actor: MediaActor,
  row: AssetRow,
  size: number
): Promise<Validation> {
  // Size checks come first, so an oversized object is never read.
  if (size > maxBytesFor(row.media_type)) {
    return { ok: false, error: "file_too_large" }
  }
  // The browser declares its exact File.size at reserve: any difference means
  // different bytes were stored under this reservation.
  if (row.size_bytes !== null && Number(row.size_bytes) !== size) {
    return { ok: false, error: "size_mismatch" }
  }
  const source = mediaRangeSource(actor.storage, row.original_path, size)
  const head = await source.read(0, Math.min(size, MEDIA_LIMITS.sniffHeadBytes))
  const type = sniffMedia(head)
  if (!type) return { ok: false, error: "unsupported_type" }
  // media_type is fixed at reservation, so content must agree with it.
  if (type.kind !== row.media_type) return { ok: false, error: "type_mismatch" }

  // The browser's MIME label is never consulted: "" means "unknown".
  if (type.kind === "image") {
    if (size > MEDIA_LIMITS.maxPhotoBytes) {
      return { ok: false, error: "file_too_large" }
    }
    const bytes = await source.read(0, size)
    if (bytes.byteLength !== size) return { ok: false, error: "size_mismatch" }
    for (let attempt = 0; ; attempt++) {
      const result = await validateMedia({
        bytes,
        size,
        declaredMime: "",
        filename: row.original_filename,
      })
      if (result.ok || result.error !== "decoder_busy") {
        if (!result.ok) return result
        if (result.kind !== "image" || !("preview" in result))
          return { ok: false, error: "type_mismatch" }
        return {
          ok: true,
          mime: result.mime,
          size,
          width: result.width,
          height: result.height,
          preview: result.preview,
          thumb: result.thumb,
        }
      }
      if (attempt >= BUSY_RETRIES) return result
      await sleep(1000 + attempt * 500)
    }
  }

  if (size > MEDIA_LIMITS.maxVideoBytes) {
    return { ok: false, error: "file_too_large" }
  }
  const result = await validateMedia({
    source,
    size,
    declaredMime: "",
    filename: row.original_filename,
  })
  if (!result.ok) return result
  if (result.kind !== "video") return { ok: false, error: "type_mismatch" }
  return {
    ok: true,
    mime: result.mime,
    size,
    width: "width" in result ? result.width : undefined,
    height: "height" in result ? result.height : undefined,
    durationSeconds:
      "durationSeconds" in result ? result.durationSeconds : undefined,
  }
}

/**
 * Finalise an upload (spec §5 steps 4–5). Idempotent: a ready asset returns
 * ready; a concurrent call waits for the first; a crashed claim is taken over.
 * Validates the stored bytes with lib/media (never the browser's MIME type),
 * writes derivatives, then marks the asset `ready`, or `failed` with a reason.
 * Failed validation can never become `ready`.
 */
export async function finaliseAsset(
  actor: MediaActor,
  input: FinaliseRequest
): Promise<Outcome<FinaliseResponse>> {
  if (actor.profile.role !== "staff") {
    return { ok: false, status: 403, message: "Only staff can upload." }
  }
  if (typeof input?.assetId !== "string" || !UUID.test(input.assetId)) {
    return notFound
  }
  const row = await readOwnAsset(actor, input.assetId)
  if (!row) return notFound
  // The key ties a finalise to the reservation it came from.
  if (row.client_upload_key && row.client_upload_key !== input.idempotencyKey) {
    return notFound
  }
  if (row.upload_state === "ready") return { ok: true, state: "ready" }

  // Finalise begins: record upload activity for cleanup (lifecycle's
  // recordUploadActivity). Skipped for `processing`, which cleanup never
  // touches, so retries cannot keep a crashed claim looking fresh.
  if (row.upload_state !== "processing") {
    try {
      await touchMediaReservation(actor.service, row.id)
    } catch {
      return {
        ok: false,
        status: 503,
        message: "Could not check this file right now. Try again.",
      }
    }
  }

  const claimed = await claim(actor, row)
  if (claimed === "ready") return { ok: true, state: "ready" }
  if (claimed === "gone") return notFound
  if (claimed === "busy") {
    return {
      ok: false,
      status: 409,
      message: "This file is still processing. Try again in a moment.",
    }
  }

  let validation: Validation
  try {
    const size = await statMediaObject(actor.storage, row.original_path)
    if (size === null && row.upload_state === "failed") {
      // Failed validation earlier and its bytes were removed: still failed.
      // (A retry through reserve reopens the reservation for a new transfer.)
      await setState(actor, row.id, ["processing"], "failed")
      return {
        ok: true,
        state: "failed",
        error: "This file could not be used. Choose it again to upload it.",
      }
    }
    if (size === null) {
      // Nothing stored yet: reopen the reservation so the transfer can run.
      await setState(actor, row.id, ["processing"], "uploading")
      return {
        ok: false,
        status: 409,
        message: "The file has not finished uploading. Try again.",
      }
    }
    validation = await validateStored(actor, row, size)
  } catch {
    // Storage or decoder trouble, not the file's fault: keep it retryable.
    await setState(actor, row.id, ["processing"], "failed").catch(() => {})
    return {
      ok: false,
      status: 503,
      message: "Could not check this file right now. Try again.",
    }
  }

  if (!validation.ok) {
    await setState(actor, row.id, ["processing"], "failed")
    if (validation.error === "decoder_busy") {
      return {
        ok: false,
        status: 503,
        message: "The server is busy processing photos. Try again.",
      }
    }
    // Terminal: the bytes can never become ready, so don't keep them for the
    // 24 h cleanup. Best effort; cleanup still removes a failed row's objects.
    await removeObjects(actor, [row.original_path])
    return {
      ok: true,
      state: "failed",
      error: validationMessage(validation.error),
    }
  }

  const keys = mediaObjectKeys(row.uploader_id, row.id, "bin")
  let claimLost = false
  const update: {
    upload_state: "ready"
    validated_mime_type: string
    size_bytes: number
    width: number | null
    height: number | null
    duration_seconds: number | null
    preview_path?: string
    thumbnail_path?: string
  } = {
    upload_state: "ready",
    validated_mime_type: validation.mime,
    size_bytes: validation.size,
    width: validation.width ?? null,
    height: validation.height ?? null,
    duration_seconds:
      validation.durationSeconds === undefined
        ? null
        : Math.round(validation.durationSeconds * 1000) / 1000,
  }

  try {
    if (validation.preview && validation.thumb) {
      const bucket = actor.service.storage.from(STORAGE_BUCKETS.media)
      // upsert: a crashed earlier attempt may have stored one already. These are
      // server-generated WebP files; the browser never writes these keys.
      for (const [key, body] of [
        [keys.preview, validation.preview],
        [keys.thumbnail, validation.thumb],
      ] as const) {
        const { error } = await bucket.upload(key, body, {
          contentType: "image/webp",
          cacheControl: String(MEDIA_LIMITS.signedUrlExpirySeconds),
          upsert: true,
        })
        if (error) throw new Error("derivative_upload")
      }
      update.preview_path = keys.preview
      update.thumbnail_path = keys.thumbnail
    }

    const { data, error } = await actor.service
      .from("media_assets")
      .update(update)
      .eq("id", row.id)
      .eq("upload_state", "processing")
      .is("deleted_at", null)
      .select("id")
    if (error) throw new Error("asset_ready_update")
    claimLost = !data?.length
  } catch {
    await setState(actor, row.id, ["processing"], "failed").catch(() => {})
    return {
      ok: false,
      status: 503,
      message: "Could not save this file right now. Try again.",
    }
  }

  if (claimLost) return settleLostClaim(actor, row, keys)
  return { ok: true, state: "ready" }
}

/**
 * The `ready` update matched nothing: the asset was deleted while it was being
 * processed, or another finalise took the claim over. A deleted asset must not
 * keep the derivatives just written (the delete has already reported its
 * objects removed), so remove them and the original and answer 404. An asset
 * another finalise made ready is a success, not an error.
 */
async function settleLostClaim(
  actor: MediaActor,
  row: AssetRow,
  keys: ReturnType<typeof mediaObjectKeys>
): Promise<Outcome<FinaliseResponse>> {
  const { data: current, error } = await actor.service
    .from("media_assets")
    .select("upload_state, deleted_at")
    .eq("id", row.id)
    .maybeSingle()
  if (error) {
    return {
      ok: false,
      status: 503,
      message: "Could not check this file right now. Try again.",
    }
  }
  if (!current || current.deleted_at !== null) {
    await removeObjects(actor, [
      keys.preview,
      keys.thumbnail,
      row.original_path,
    ])
    return notFound
  }
  if (current.upload_state === "ready") return { ok: true, state: "ready" }
  return {
    ok: false,
    status: 409,
    message: "This file is still processing. Try again in a moment.",
  }
}

/** Service-role removal that never throws; cleanup retries what is left. */
async function removeObjects(actor: MediaActor, names: string[]) {
  try {
    await actor.service.storage.from(STORAGE_BUCKETS.media).remove(names)
  } catch {
    // Left for the cleanup job, which lists objects of failed/deleted assets.
  }
}
