// Adapts an UploadFn to the ui track's injected `Uploader`
// (components/nabalens/upload-queue.ts). The types are copied into ./types so
// lib/ never imports from components/.

import { tusFingerprint } from "./tus"
import type {
  FinaliseLabels,
  UploadContext,
  Uploader,
  UploadError,
  UploadFn,
} from "./types"
import type { UploadKeyStore } from "./upload-keys"

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
  /**
   * Keys of unfinished uploads per local file (see `localUploadKeyStore`). A
   * file chosen again after a reload reuses its key, so the server returns the
   * same asset and a TUS transfer resumes. Omit to always start fresh.
   */
  keys?: UploadKeyStore
  /**
   * Who is signed in, for a file whose context does not say (`account`): its
   * resume key is kept for that account only. Null: not scoped.
   */
  account?: () => Promise<string | null>
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
  {
    newKey = () => crypto.randomUUID(),
    keys,
    account: signedIn,
  }: QueueUploaderOptions = {}
): Uploader {
  // Keys of files in flight in this tab: the same file added twice must not
  // share one reservation.
  const inUse = new Set<string>()

  return async (
    file: File,
    context: UploadContext
  ): Promise<void | { assetId: string; labels?: FinaliseLabels }> => {
    // Keys are kept per account: another person signed in on this device never
    // resumes (or even finds) this person's reservation.
    const account =
      context.account ??
      (keys && signedIn
        ? ((await signedIn().catch(() => null)) ?? undefined)
        : undefined)
    const scope = { purpose: context.purpose, account }
    let token = readToken(context.resumeToken)
    if (!token) {
      const stored = keys ? await keys.get(file, scope).catch(() => null) : null
      token = {
        idempotencyKey: stored && !inUse.has(stored) ? stored : newKey(),
      }
      context.setResumeToken(token)
    }
    const { idempotencyKey } = token
    if (inUse.has(idempotencyKey)) {
      throw new QueueUploadError({
        code: "transfer_failed",
        message: "This file is already uploading.",
        retryable: true,
      })
    }
    inUse.add(idempotencyKey)
    await keys?.set(file, idempotencyKey, scope).catch(() => {})

    let result: Awaited<ReturnType<UploadFn>>
    try {
      result = await upload(file, {
        idempotencyKey,
        ...(context.purpose ? { purpose: context.purpose } : {}),
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
          // Labels can be sent for the asset from now on.
          context.onReserved?.(assetId)
        },
      })
    } finally {
      inUse.delete(idempotencyKey)
    }

    // Finished either way: choosing this file again starts a new upload.
    if (
      result.state === "ready" ||
      result.error?.code === "processing_failed"
    ) {
      await keys?.delete(file, scope).catch(() => {})
    } else if (result.error?.code === "reservation_gone") {
      // The reservation was removed or cleaned up, or its key was reserved for
      // the other purpose (the server refuses to resume it as this one): forget
      // the key, so the retry reserves a new asset with this purpose.
      await keys?.delete(file, scope).catch(() => {})
      context.setResumeToken(null)
    }

    if (result.state === "failed") {
      throw new QueueUploadError(
        result.error ?? {
          code: "transfer_failed",
          message: "Upload failed.",
          retryable: true,
        }
      )
    }
    // Ready: report the asset (and what finalise did with labels waiting for
    // it) so the queue can tell when the photo and its labels are saved.
    if (!result.assetId) return undefined
    return result.labels
      ? { assetId: result.assetId, labels: result.labels }
      : { assetId: result.assetId }
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
