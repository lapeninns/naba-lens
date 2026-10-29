// Adapts an UploadFn to the ui track's injected `Uploader`
// (components/nabalens/upload-queue.ts). The types are copied into ./types so
// lib/ never imports from components/.

import { tusFingerprint } from "./tus"
import type { UploadContext, Uploader, UploadError, UploadFn } from "./types"

/**
 * What the adapter stores with `setResumeToken`. The queue hands it back on
 * retry: the same idempotency key makes `reserve` return the same asset, whose
 * tus fingerprint finds the stored upload URL so the transfer resumes.
 */
export type QueueResumeToken = {
  idempotencyKey: string
  /** Set once the server has reserved the asset. */
  assetId?: string
  /** Set for resumable (TUS) transfers. */
  tusFingerprint?: string
}

export type QueueUploaderOptions = {
  /** Creates the idempotency key on a file's first attempt. */
  newKey?: () => string
}

/** Rejection reason of a queue upload; `error` carries the code. */
export class QueueUploadError extends Error {
  constructor(readonly error: UploadError) {
    super(error.message)
    this.name = error.code === "aborted" ? "AbortError" : "QueueUploadError"
  }
}

export function toQueueUploader(
  upload: UploadFn,
  { newKey = () => crypto.randomUUID() }: QueueUploaderOptions = {}
): Uploader {
  return async (file: File, context: UploadContext): Promise<void> => {
    let token = readToken(context.resumeToken)
    if (!token) {
      token = { idempotencyKey: newKey() }
      context.setResumeToken(token)
    }
    const { idempotencyKey } = token

    const result = await upload(file, {
      idempotencyKey,
      signal: context.signal,
      onProgress: context.onProgress,
      onStateChange: (state) => {
        if (state === "processing") context.onProcessing()
      },
      onReserved: ({ assetId, resumable }) => {
        context.setResumeToken({
          idempotencyKey,
          assetId,
          tusFingerprint: resumable ? tusFingerprint(assetId) : undefined,
        } satisfies QueueResumeToken)
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

function readToken(value: unknown): QueueResumeToken | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as QueueResumeToken).idempotencyKey === "string"
  ) {
    return value as QueueResumeToken
  }
  return null
}
