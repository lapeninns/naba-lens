import { createHash } from "node:crypto"

import {
  maxBytesFor,
  MEDIA_LIMITS,
  MEDIA_PIPELINE_VERSION,
} from "@/lib/config/media"
import { mediaObjectKeys, STORAGE_BUCKETS } from "@/lib/config/storage"
import { imageSize, sniffMedia, validateMedia } from "@/lib/media"
import {
  imageCaptureTime,
  quickTimeCaptureTime,
} from "@/lib/media/capture-time"
import {
  EMPTY_LABEL_SUMMARY,
  type MediaLabelSummary,
  type SaveLabelsErrorCode,
} from "@/lib/menus/types"
import { ensureMediaOriginalArchived } from "@/lib/server/archive"
import { labelSaveMessage, tryLoadLabelSummaries } from "@/lib/server/labels"
import { touchMediaReservation } from "@/lib/server/lifecycle/cleanup"

import { validationMessage } from "./errors"
import { mediaRangeSource, statMediaObject } from "./storage"
import type { MediaActor, Outcome } from "./types"

export type FinaliseRequest = { assetId: string; idempotencyKey: string }

/**
 * Labels stored while the file was uploading (media_pending_labels): applied
 * by this finalise ("saved"), or not applied and waiting for the uploader to
 * fix them ("needs_attention"; the photo is ready either way).
 */
export type FinaliseLabels =
  | { state: "saved"; labels: MediaLabelSummary }
  | { state: "needs_attention"; code: SaveLabelsErrorCode; message: string }

/**
 * lib/upload FinaliseResult. A non-ok Outcome means "could not confirm, retry".
 * `labels` is present only when the asset had stored labels: applied in this
 * finalise, or an existing needs_attention draft on an already-ready asset.
 */
export type FinaliseResponse =
  | {
      state: "ready"
      labels?: FinaliseLabels
      /**
       * An exact copy (same SHA-256) of an earlier photo or video at the same
       * venue (spec §12.4). It is kept, but earns no contribution credit.
       * Only on the finalise that made the asset ready.
       */
      duplicate?: true
    }
  | { state: "failed"; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A `processing` claim older than this is treated as a crashed finalise. Measured
 * by the database (`take_over_stale_media_claim`) against the claim's updated_at
 * stamp, never with this host's clock (wave 3 finding 6).
 */
const STALE_CLAIM_INTERVAL = "2 minutes"
/** How long a second finalise waits for one already running. */
const WAIT_FOR_OTHER_MS = 20_000
/**
 * HEIC decodes run one at a time per process. lib/media already queues each
 * caller (FIFO) for up to one decode deadline before answering `decoder_busy`,
 * so each retry adds a full queue wait: keep this small (docs/runtime-sizing.md).
 */
export const BUSY_RETRIES = 1
/** Pause before busy-retry `attempt` (0-based). */
const busyRetryDelayMs = (attempt: number) => 1000 + attempt * 500

/**
 * Code-bounded worst case of the HEIC step of one finalise: every attempt
 * waits its full queue deadline, the last one gets the slot just in time and
 * decodes up to the deadline. Storage reads come on top.
 */
export const HEIC_FINALISE_WORST_CASE_MS =
  (BUSY_RETRIES + 1) * MEDIA_LIMITS.heicTimeoutMs +
  MEDIA_LIMITS.heicTimeoutMs +
  Array.from({ length: BUSY_RETRIES }, (_, i) => busyRetryDelayMs(i)).reduce(
    (a, b) => a + b,
    0
  )

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type AssetRow = {
  id: string
  uploader_id: string
  venue_id: string
  uploader_role: string | null
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
  // RLS: active staff read only their own, non-deleted rows; a manager
  // account only its own manager-era rows.
  const { data, error } = await actor.db
    .from("media_assets")
    .select(
      "id, uploader_id, venue_id, uploader_role, original_path, original_filename, media_type, upload_state, client_upload_key, size_bytes, updated_at"
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
    // Reset a stale claim to `failed` (compare-and-set in SQL), then re-claim.
    const { data: tookOver, error } = await actor.service.rpc(
      "take_over_stale_media_claim",
      { p_asset_id: row.id, p_stale_after: STALE_CLAIM_INTERVAL }
    )
    if (error) throw new Error(`asset_takeover_${error.code ?? "unknown"}`)
    if (tookOver) continue
    // Elapsed time of this request only; never compared with database times.
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
      /** SHA-256 of the original, when this step already had its bytes. */
      sha256?: string
      /** When it was taken, from the file's own metadata; null: unknown. */
      capturedAt: Date | null
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
          sha256: createHash("sha256").update(bytes).digest("hex"),
          capturedAt: imageCaptureTime(bytes),
        }
      }
      if (attempt >= BUSY_RETRIES) return result
      await sleep(busyRetryDelayMs(attempt))
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
  const durationSeconds =
    "durationSeconds" in result ? result.durationSeconds : undefined
  if (tooLong(durationSeconds)) return { ok: false, error: "video_too_long" }
  return {
    ok: true,
    mime: result.mime,
    size,
    width: "width" in result ? result.width : undefined,
    height: "height" in result ? result.height : undefined,
    durationSeconds,
    capturedAt: quickTimeCaptureTime(
      "creationTime" in result ? result.creationTime : undefined
    ),
  }
}

/**
 * Over the video length limit (spec §12.1). Half a second of slack: a phone's
 * one-minute clip is often a few hundredths over. Unknown length (fragmented
 * MP4): held to the byte limit only.
 */
export function tooLong(durationSeconds: number | undefined): boolean {
  return (
    durationSeconds !== undefined &&
    durationSeconds > MEDIA_LIMITS.maxVideoSeconds + 0.5
  )
}

/** Range reads of this size when hashing a stored original. */
const HASH_CHUNK_BYTES = 8 * 1024 * 1024

/**
 * SHA-256 of the stored original (FA-35). Reuses the archive's receipt when
 * archiving already read the file; otherwise streams it in range reads.
 */
async function originalSha256(
  actor: MediaActor,
  row: AssetRow,
  size: number
): Promise<string> {
  const { data, error } = await actor.service
    .from("media_archive_receipts")
    .select("sha256")
    .eq("asset_id", row.id)
    .eq("size_bytes", size)
    .limit(1)
    .maybeSingle()
  if (!error && data?.sha256) return data.sha256
  const source = mediaRangeSource(actor.storage, row.original_path, size)
  const hash = createHash("sha256")
  for (let offset = 0; offset < size; offset += HASH_CHUNK_BYTES) {
    const length = Math.min(HASH_CHUNK_BYTES, size - offset)
    const chunk = await source.read(offset, length)
    if (chunk.byteLength !== length) throw new Error("hash_short_read")
    hash.update(chunk)
  }
  return hash.digest("hex")
}

/**
 * One media_renditions row per derivative written (spec §12.3). Also used by
 * the legacy import (scripts/import), which has only the service role.
 */
export async function recordRenditions(
  actor: Pick<MediaActor, "service">,
  assetId: string,
  keys: ReturnType<typeof mediaObjectKeys>,
  preview: Uint8Array,
  thumb: Uint8Array
) {
  const [previewSize, thumbSize] = await Promise.all([
    imageSize(preview),
    imageSize(thumb),
  ])
  const settings = (maxEdge: number) => ({
    format: "webp",
    fit: "inside",
    maxEdgePx: maxEdge,
    withoutEnlargement: true,
    orientation: "exif-applied",
    metadata: "stripped",
  })
  const { error } = await actor.service.from("media_renditions").upsert(
    [
      {
        asset_id: assetId,
        kind: "preview",
        object_key: keys.preview,
        mime_type: "image/webp",
        width: previewSize?.width ?? null,
        height: previewSize?.height ?? null,
        pipeline_version: MEDIA_PIPELINE_VERSION,
        settings: settings(MEDIA_LIMITS.previewPixels),
      },
      {
        asset_id: assetId,
        kind: "thumbnail",
        object_key: keys.thumbnail,
        mime_type: "image/webp",
        width: thumbSize?.width ?? null,
        height: thumbSize?.height ?? null,
        pipeline_version: MEDIA_PIPELINE_VERSION,
        settings: settings(MEDIA_LIMITS.thumbnailPixels),
      },
    ],
    { onConflict: "asset_id,kind" }
  )
  if (error) throw new Error("rendition_record")
}

const ACCESS_ENDED: Outcome<never> = {
  ok: false,
  status: 403,
  message:
    "You can no longer add photos at this venue, so this upload can't be finished.",
}

const CHECK_FAILED: Outcome<never> = {
  ok: false,
  status: 503,
  message: "Could not check this file right now. Try again.",
}

const MANAGER_ENDED: Outcome<never> = {
  ok: false,
  status: 403,
  message:
    "Your venue manager access has ended, so this upload can't be finished.",
}

/**
 * The role the caller holds at `venueId` through an open membership (any of
 * their venues, not only the active one); null when none; undefined when it
 * could not be read.
 */
async function roleAtVenue(
  actor: MediaActor,
  venueId: string
): Promise<string | null | undefined> {
  const { data, error } = await actor.db.rpc("my_venue_memberships")
  if (error) return undefined
  const rows = (data ?? []) as { venue_id: string; role: string | null }[]
  return rows.find((row) => row.venue_id === venueId)?.role ?? null
}

/**
 * Whether the caller may still finish an upload reserved at `row.venue_id`
 * (null when they may). K2, review R10: the same rule as the storage write
 * trigger and complete_media_finalise (private.media_upload_venue_allowed,
 * 20261118109200): keyed on the role held at the upload's venue, not on the
 * active venue, so switching to another of one's venues never ends an upload
 * in flight; ending the membership does (AC12). A manager-era reservation
 * needs the manager role there; a staff-era one an open staff membership
 * there (or, for a legacy account, working there now). The database checks
 * again under the row lock.
 */
async function uploadAccessEnded(
  actor: MediaActor,
  row: Pick<AssetRow, "venue_id" | "uploader_role">
): Promise<Outcome<never> | null> {
  if (actor.profile.role === "admin") return null
  const managerEra =
    row.uploader_role === "manager" ||
    (row.uploader_role === null && actor.profile.role === "manager")
  if (managerEra) {
    const role = await roleAtVenue(actor, row.venue_id)
    if (role === undefined) return CHECK_FAILED
    return role === "manager"
      ? null
      : actor.profile.role === "manager"
        ? MANAGER_ENDED
        : ACCESS_ENDED
  }
  if (actor.profile.venueId === row.venue_id && actor.profile.role === "staff")
    return null
  const role = await roleAtVenue(actor, row.venue_id)
  if (role === undefined) return CHECK_FAILED
  return role === "staff" ? null : ACCESS_ENDED
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
  if (actor.profile.role !== "staff" && actor.profile.role !== "manager") {
    return {
      ok: false,
      status: 403,
      message: "Only staff and venue manager accounts can upload.",
    }
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
  if (row.upload_state === "ready") return readyWithAttention(actor, row.id)
  // Only while the caller still holds a role at the upload's venue (spec
  // §12.4, AC12, R10); complete_media_finalise checks the same rule under
  // the row lock.
  const ended = await uploadAccessEnded(actor, row)
  if (ended) return ended

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
  if (claimed === "ready") return readyWithAttention(actor, row.id)
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
      if (await setState(actor, row.id, ["processing"], "failed"))
        await discardStoredLabels(actor, row.id)
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
    // false: this claim was lost (another finalise took it over and may have
    // made the asset ready), so its stored labels are not ours to discard.
    const failedHere = await setState(actor, row.id, ["processing"], "failed")
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
    // Nor its stored labels: they can never apply ("photo not saved"). With
    // the original gone, stage_media_labels stores no new ones either. A
    // temporary failure (above and below) keeps them for the Retry.
    if (failedHere) await discardStoredLabels(actor, row.id)
    return {
      ok: true,
      state: "failed",
      error: validationMessage(validation.error),
    }
  }

  const keys = mediaObjectKeys(row.uploader_id, row.id, "bin")
  let derivatives = false
  let completed: CompleteRow
  let accessEnded = false
  try {
    // A successful upload must have a verified durable original + attribution
    // receipt before it can become ready. Archival failure remains retryable.
    await ensureMediaOriginalArchived(actor.service, row.id, {
      sizeBytes: validation.size,
      mimeType: validation.mime,
    })
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
      await recordRenditions(
        actor,
        row.id,
        keys,
        validation.preview,
        validation.thumb
      )
      derivatives = true
    }
    const contentSha256 =
      validation.sha256 ?? (await originalSha256(actor, row, validation.size))

    // `ready` (compare-and-set on processing) and any labels stored while the
    // file uploaded, applied as the uploader, in one transaction: a label POST
    // either lands before this and is applied here, or sees `ready` and saves
    // directly. An omitted argument is NULL (a video has no derivatives).
    const { data, error } = await actor.service.rpc("complete_media_finalise", {
      p_asset_id: row.id,
      p_validated_mime_type: validation.mime,
      p_size_bytes: validation.size,
      p_width: validation.width,
      p_height: validation.height,
      p_duration_seconds:
        validation.durationSeconds === undefined
          ? undefined
          : Math.round(validation.durationSeconds * 1000) / 1000,
      p_preview_path: derivatives ? keys.preview : undefined,
      p_thumbnail_path: derivatives ? keys.thumbnail : undefined,
      p_content_sha256: contentSha256,
      p_captured_at: validation.capturedAt?.toISOString(),
    })
    if (error?.message?.includes("upload_access_ended")) accessEnded = true
    if (error || !data?.[0]) throw new Error("asset_ready_update")
    completed = data[0] as CompleteRow
  } catch {
    await setState(actor, row.id, ["processing"], "failed").catch(() => {})
    // Access ended while it was processing: the bytes stay private (only the
    // uploader's own row, never ready) until the 24 h cleanup.
    if (accessEnded) return ACCESS_ENDED
    return {
      ok: false,
      status: 503,
      message: "Could not save this file right now. Try again.",
    }
  }

  if (!completed.became_ready) return settleLostClaim(actor, row, keys)
  const labels = await completedLabels(actor, row.id, completed)
  return {
    ok: true,
    state: "ready",
    ...(labels ? { labels } : {}),
    ...(completed.duplicate_of_asset_id ? { duplicate: true as const } : {}),
  }
}

/** One row of complete_media_finalise (nulls as the database sends them). */
type CompleteRow = {
  became_ready: boolean
  labels_state: "saved" | "needs_attention" | null
  labels_code: string | null
  labels_revision: number | null
  labels_has_labels: boolean | null
  /** An earlier live ready asset at the venue with the same bytes. */
  duplicate_of_asset_id?: string | null
}

const LABEL_CODES: readonly SaveLabelsErrorCode[] = [
  "conflict",
  "unavailable_items",
  "not_found",
  "forbidden",
  "invalid",
  "catalogue_changed",
  "unavailable",
]

const asLabelCode = (code: string | null): SaveLabelsErrorCode =>
  LABEL_CODES.find((c) => c === code) ?? "unavailable"

function needsAttention(code: string | null): FinaliseLabels {
  const known = asLabelCode(code)
  return {
    state: "needs_attention",
    code: known,
    message: labelSaveMessage(known),
  }
}

/** The `labels` of a finalise that just made the asset ready. */
async function completedLabels(
  actor: MediaActor,
  assetId: string,
  done: CompleteRow
): Promise<FinaliseLabels | null> {
  if (done.labels_state === "needs_attention")
    return needsAttention(done.labels_code)
  if (done.labels_state !== "saved") return null
  const summaries = await tryLoadLabelSummaries(actor.db, [assetId], {
    viewerId: actor.profile.id,
  })
  const labels = summaries?.get(assetId)
  if (labels) return { state: "saved", labels }
  // Saved, but the fresh read failed: never report a failure that hides a
  // save. The revision is the database's, so the next edit does not conflict.
  return {
    state: "saved",
    labels: {
      ...EMPTY_LABEL_SUMMARY,
      revision: done.labels_revision ?? 0,
      hasLabels: done.labels_has_labels ?? false,
    },
  }
}

/**
 * An already-ready asset: `labels` only for a needs_attention draft (one that
 * was applied left nothing behind). A failed read just omits it; finalise
 * itself succeeded.
 */
async function readyWithAttention(
  actor: MediaActor,
  assetId: string
): Promise<Outcome<FinaliseResponse>> {
  const { data, error } = await actor.service
    .from("media_pending_labels")
    .select("code")
    .eq("asset_id", assetId)
    .eq("status", "needs_attention")
    .maybeSingle()
  if (error || !data) return { ok: true, state: "ready" }
  return { ok: true, state: "ready", labels: needsAttention(data.code) }
}

/**
 * A file that can never become ready takes its stored labels with it, after
 * its original is gone (the RPC waits for a label POST storing labels at this
 * moment and deletes those too). Best effort: if this fails, the 24 h cleanup
 * tombstones the failed asset and the tombstone trigger removes them.
 */
async function discardStoredLabels(actor: MediaActor, assetId: string) {
  try {
    const { error } = await actor.service.rpc("discard_unusable_media_labels", {
      p_asset_id: assetId,
    })
    if (error) throw new Error(`labels_discard_${error.code ?? "unknown"}`)
  } catch {
    // Left for the cleanup.
  }
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
  // Another finalise made it ready and applied any stored labels.
  if (current.upload_state === "ready") return readyWithAttention(actor, row.id)
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
