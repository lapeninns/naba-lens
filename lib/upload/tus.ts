// Resumable path for large photos and all videos: Supabase Storage's TUS
// endpoint via tus-js-client.
// https://supabase.com/docs/guides/storage/uploads/resumable-uploads

import * as tus from "tus-js-client"

import { AbortedError, isAlreadyExists, TransferError } from "./errors"

/** Supabase requires exactly 6 MiB chunks on its resumable endpoint. */
export const SUPABASE_TUS_CHUNK_SIZE = 6 * 1024 * 1024

/** tus-js-client hooks that tests (and unusual runtimes) may replace. */
export type TusAdapters = Pick<
  tus.UploadOptions,
  "urlStorage" | "fileReader" | "httpStack"
>

export type TusTransferOptions = {
  endpoint: string
  file: Blob
  assetId: string
  bucket: string
  objectKey: string
  contentType: string
  getAccessToken: () => Promise<string | null>
  apiKey?: string
  chunkSize: number
  retryDelays: number[]
  onProgress: (fraction: number) => void
  signal?: AbortSignal
  adapters?: TusAdapters
}

/** Stable per reservation, so a retry of the same asset resumes its transfer. */
export function tusFingerprint(assetId: string) {
  return `nabalens-media:${assetId}`
}

/** Resolves when every byte is stored (or the object already existed). */
export async function tusTransfer(options: TusTransferOptions): Promise<void> {
  const { signal } = options
  if (signal?.aborted) throw new AbortedError()

  const initialToken = await options.getAccessToken()
  if (!initialToken) {
    throw new TransferError("Your session has expired. Sign in and retry.")
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve()
    }

    const upload = new tus.Upload(options.file, {
      endpoint: options.endpoint,
      chunkSize: options.chunkSize,
      retryDelays: options.retryDelays,
      // Supabase: POST without data, then PATCH 6 MiB chunks.
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      fingerprint: async () => tusFingerprint(options.assetId),
      headers: {
        "x-upsert": "false",
        ...(options.apiKey ? { apikey: options.apiKey } : {}),
      },
      metadata: {
        bucketName: options.bucket,
        objectName: options.objectKey,
        contentType: options.contentType || "application/octet-stream",
        cacheControl: "3600",
      },
      // Refresh the bearer token per request: video transfers can outlive it.
      onBeforeRequest: async (req) => {
        const token = (await options.getAccessToken()) ?? initialToken
        req.setHeader("authorization", `Bearer ${token}`)
      },
      onShouldRetry: (err, attempt, opts) => {
        if (isCreateConflict(err)) return false
        return tus.defaultOptions.onShouldRetry!(err, attempt, opts)
      },
      onProgress: (sent, total) => {
        if (total > 0) options.onProgress(sent / total)
      },
      onSuccess: () => settle(),
      onError: (err) => {
        if (isCreateConflict(err)) {
          options.onProgress(1)
          return settle()
        }
        const status = statusOf(err)
        settle(
          new TransferError(
            status
              ? `Storage rejected the upload (HTTP ${status}).`
              : "The connection was interrupted.",
            status
          )
        )
      },
      ...options.adapters,
    })

    const onAbort = () => {
      // Keep the server-side upload (no terminate) so a retry can resume it;
      // abandoned uploads are removed by the server's cleanup job.
      void upload.abort(false)
      settle(new AbortedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (settled) return
        const match = previous.find((p) => p.size === options.file.size)
        if (match) upload.resumeFromPreviousUpload(match)
        upload.start()
      })
      .catch(() => {
        // URL storage unavailable (e.g. private mode): start fresh.
        if (!settled) upload.start()
      })
  })
}

function statusOf(err: Error): number | null {
  const res = (err as tus.DetailedError).originalResponse
  return res ? res.getStatus() : null
}

/**
 * Creating the upload failed because the object already exists: an earlier
 * attempt stored every byte but its final response was lost.
 */
function isCreateConflict(err: Error): boolean {
  const { originalRequest, originalResponse } = err as tus.DetailedError
  if (!originalRequest || !originalResponse) return false
  if (originalRequest.getMethod() !== "POST") return false
  return isAlreadyExists(
    originalResponse.getStatus(),
    originalResponse.getBody()
  )
}
