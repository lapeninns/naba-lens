// Browser upload orchestration: preflight -> reserve -> transfer -> finalise.
// Client-only; reserve/finalise are injected (server actions in the app).

import { AbortedError, TransferError } from "./errors"
import { preflight } from "./preflight"
import { signedPut, type XhrLike } from "./signed-put"
import { SUPABASE_TUS_CHUNK_SIZE, tusTransfer, type TusAdapters } from "./tus"
import type {
  ClientUploadLimits,
  FinaliseFn,
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
  /** Number of uploads currently in flight (for the beforeunload guard). */
  activeCount(): number
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
        })
      } catch (error) {
        return fail({
          code: "reserve_failed",
          message: messageOf(error, "Could not start the upload."),
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
        onProgress(1)
        onStateChange("ready")
        return { assetId, state: "ready" }
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
      onProgress(1)
      onStateChange("processing")

      try {
        const result = await finalise({
          assetId: reservation.assetId,
          idempotencyKey,
        })
        if (result.state === "ready") {
          onStateChange("ready")
          return { assetId, state: "ready" }
        }
        return fail({
          code: "processing_failed",
          message: result.error ?? "This file could not be processed.",
          retryable: false,
        })
      } catch (error) {
        return fail({
          code: "finalise_failed",
          message: messageOf(error, "Could not confirm the upload."),
          retryable: true,
        })
      }
    } finally {
      active--
    }
  }

  return Object.assign(upload, { activeCount: () => active })
}

function aborted(): UploadError {
  return { code: "aborted", message: "Upload cancelled.", retryable: true }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
