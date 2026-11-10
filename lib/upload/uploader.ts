// Browser upload orchestration: preflight -> reserve -> transfer -> finalise.
// Client-only; reserve/finalise are injected (server actions in the app).

import {
  AbortedError,
  FinaliseRefusedError,
  ReservationGoneError,
  TransferError,
} from "./errors"
import { preflight } from "./preflight"
import { signedPut, type XhrLike } from "./signed-put"
import { SUPABASE_TUS_CHUNK_SIZE, tusTransfer, type TusAdapters } from "./tus"
import type {
  ClientUploadLimits,
  FinaliseFn,
  MediaKind,
  ReserveFn,
  ReserveResult,
  UploadError,
  UploadFn,
  UploadResult,
} from "./types"

/** Photos above this go over TUS; Supabase recommends TUS above 6 MB. */
export const DEFAULT_RESUMABLE_THRESHOLD = 6 * 1024 * 1024

export const DEFAULT_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000]

export type CreateUploaderOptions = {
  reserve: ReserveFn
  finalise: FinaliseFn
  /** e.g. `process.env.NEXT_PUBLIC_SUPABASE_URL`. */
  supabaseUrl: string
  /** Current session access token, e.g. from `supabase.auth.getSession()`. */
  getAccessToken: () => Promise<string | null>
  limits: ClientUploadLimits
  /** Publishable/anon key, sent as `apikey` on TUS requests when given. */
  apiKey?: string
  /** Photos larger than this use TUS. Videos always use TUS. */
  resumableThresholdBytes?: number
  retryDelays?: number[]
  /** Test seam. Supabase requires 6 MiB; don't change in production. */
  chunkSize?: number
  /** Test seams for environments without XMLHttpRequest / browser storage. */
  createXhr?: () => XhrLike
  tusAdapters?: TusAdapters
}

export type MediaUploader = UploadFn & {
  /** Number of uploads currently in flight, including those finalising. */
  activeCount(): number
  /**
   * Uploads that leaving the page would stop (for the beforeunload guard):
   * reserving or transferring. One handed to the server's finalise, or found
   * already ready, is not counted: the server finishes it either way.
   */
  stoppableCount(): number
}

export function createUploader(options: CreateUploaderOptions): MediaUploader {
  const {
    reserve,
    finalise,
    limits,
    resumableThresholdBytes = DEFAULT_RESUMABLE_THRESHOLD,
    retryDelays = DEFAULT_RETRY_DELAYS,
    chunkSize = SUPABASE_TUS_CHUNK_SIZE,
    // XMLHttpRequest's `this`-typed handlers don't match XhrLike structurally.
    createXhr = () => new XMLHttpRequest() as unknown as XhrLike,
  } = options
  const endpoint = `${options.supabaseUrl.replace(/\/+$/, "")}/storage/v1/upload/resumable`
  let active = 0
  let stoppable = 0

  const upload: UploadFn = async (file, uploadOptions) => {
    const { idempotencyKey, signal } = uploadOptions
    const onProgress = uploadOptions.onProgress ?? (() => {})
    const onStateChange = uploadOptions.onStateChange ?? (() => {})
    let assetId: string | null = null

    const fail = (error: UploadError): UploadResult => {
      onStateChange("failed")
      return { assetId, state: "failed", error }
    }

    const checked = preflight(file, limits)
    if (!checked.ok) return fail(checked.error)
    if (signal?.aborted) return fail(aborted())

    active++
    stoppable++
    let handedOff = false
    // From here the server owns the outcome; counted down once, whatever
    // happens after.
    const handOff = () => {
      if (handedOff) return
      handedOff = true
      stoppable--
    }
    try {
      onStateChange("uploading")

      let reservation: ReserveResult
      try {
        reservation = await reserve({
          idempotencyKey,
          filename: file.name,
          sizeBytes: file.size,
          contentType: checked.contentType,
          mediaType: checked.kind,
          preferResumable:
            checked.kind === "video" || file.size > resumableThresholdBytes,
          ...(uploadOptions.purpose ? { purpose: uploadOptions.purpose } : {}),
        })
      } catch (error) {
        if (error instanceof ReservationGoneError) {
          return fail({
            code: "reservation_gone",
            message:
              "This unfinished upload was removed or expired. Retry to upload the file again.",
            retryable: true,
          })
        }
        return fail({
          code: "reserve_failed",
          message: networkOr(
            error,
            checked.kind,
            "Could not start the upload."
          ),
          retryable: true,
        })
      }
      assetId = reservation.assetId
      uploadOptions.onReserved?.({
        assetId,
        resumable: reservation.resumable,
      })
      if (signal?.aborted) return fail(aborted())

      if (reservation.state === "ready") {
        // An earlier finalise finished it (the tab may have closed while it
        // ran), maybe leaving its stored labels needing attention. Finalise
        // answers a ready asset at once and reports such a draft; with no
        // answer, the photo is still ready, just without that report.
        handOff()
        onProgress(1)
        const labels = await finalise({ assetId, idempotencyKey })
          .then((result) =>
            result.state === "ready" ? result.labels : undefined
          )
          .catch(() => undefined)
        onStateChange("ready")
        return labels
          ? { assetId, state: "ready", labels }
          : { assetId, state: "ready" }
      }

      if (reservation.state !== "processing") {
        try {
          if (reservation.resumable) {
            await tusTransfer({
              endpoint,
              file,
              assetId: reservation.assetId,
              bucket: reservation.bucket,
              objectKey: reservation.objectKey,
              contentType: checked.contentType,
              getAccessToken: options.getAccessToken,
              apiKey: options.apiKey,
              chunkSize,
              retryDelays,
              onProgress,
              signal,
              adapters: options.tusAdapters,
            })
          } else {
            if (!reservation.uploadUrl) {
              throw new TransferError(
                "The server did not return an upload URL."
              )
            }
            await signedPut({
              url: reservation.uploadUrl,
              file,
              contentType: checked.contentType,
              onProgress,
              signal,
              retryDelays,
              createXhr,
            })
          }
        } catch (error) {
          if (error instanceof AbortedError) return fail(aborted())
          return fail({
            code: "transfer_failed",
            message: messageOf(error, "The upload was interrupted."),
            retryable: true,
          })
        }
      }

      // Never finalise a cancelled upload. Once finalise starts it runs to
      // completion: the server owns validation from here.
      if (signal?.aborted) return fail(aborted())
      handOff()
      onProgress(1)
      onStateChange("processing")

      try {
        const result = await finalise({
          assetId: reservation.assetId,
          idempotencyKey,
        })
        if (result.state === "ready") {
          onStateChange("ready")
          return result.labels
            ? { assetId, state: "ready", labels: result.labels }
            : { assetId, state: "ready" }
        }
        return fail({
          code: "processing_failed",
          message: result.error ?? "This file could not be processed.",
          retryable: false,
        })
      } catch (error) {
        if (error instanceof FinaliseRefusedError)
          return fail({
            code: "finalise_refused",
            message: error.message,
            retryable: false,
          })
        return fail({
          code: "finalise_failed",
          message: networkOr(
            error,
            checked.kind,
            "Could not confirm the upload."
          ),
          retryable: true,
        })
      }
    } finally {
      handOff()
      active--
    }
  }

  return Object.assign(upload, {
    activeCount: () => active,
    stoppableCount: () => stoppable,
  })
}

function aborted(): UploadError {
  return { code: "aborted", message: "Upload cancelled.", retryable: true }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** A reserve or finalise whose reply never arrived; Retry reuses the key. */
export function unconfirmedMessage(kind: MediaKind) {
  return `We couldn't confirm this ${kind === "video" ? "video" : "photo"} saved. Tap Retry; nothing is sent twice.`
}

// fetch rejects with a TypeError whose text is the browser's own ("Failed to
// fetch", "Load failed", "NetworkError when attempting to fetch resource.").
function isNetworkError(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      /failed to fetch|load failed|networkerror|network request failed/i.test(
        error.message
      ))
  )
}

function networkOr(error: unknown, kind: MediaKind, fallback: string) {
  return isNetworkError(error)
    ? unconfirmedMessage(kind)
    : messageOf(error, fallback)
}
