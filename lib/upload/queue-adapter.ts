// Adapts an UploadFn to the ui track's injected `Uploader` signature
// (components/nabalens/upload-queue.ts). Typed structurally so lib/ never
// imports from components/.

import type { UploadError, UploadFn } from "./types"

export type QueueUploadContext = {
  signal: AbortSignal
  onProgress: (fraction: number) => void
  onProcessing: () => void
  resumeToken: unknown
  setResumeToken: (token: unknown) => void
}

/** Rejection reason of a queue upload; `error` carries the code. */
export class QueueUploadError extends Error {
  constructor(readonly error: UploadError) {
    super(error.message)
    this.name = error.code === "aborted" ? "AbortError" : "QueueUploadError"
  }
}

/**
 * The idempotency key is created on the first attempt and stored as the
 * queue's resume token, so `retry()` reserves (and resumes) the same asset.
 */
export function toQueueUploader(
  upload: UploadFn,
  newKey: () => string = () => crypto.randomUUID()
) {
  return async (file: File, context: QueueUploadContext): Promise<void> => {
    let idempotencyKey = context.resumeToken
    if (typeof idempotencyKey !== "string") {
      idempotencyKey = newKey()
      context.setResumeToken(idempotencyKey)
    }
    const result = await upload(file, {
      idempotencyKey: idempotencyKey as string,
      signal: context.signal,
      onProgress: context.onProgress,
      onStateChange: (state) => {
        if (state === "processing") context.onProcessing()
      },
    })
    if (result.state === "failed") {
      throw new QueueUploadError(
        result.error ?? {
          code: "transfer_failed",
          message: "Upload failed.",
          retryable: true,
        }
      )
    }
  }
}
