// Adapts an UploadFn to the ui track's injected `Uploader`
// (components/nabalens/upload-queue.ts). The types are copied into ./types so
// lib/ never imports from components/.

import {
  bindCapture,
  captureAnnotation,
  type CaptureSession,
} from "./capture-session"
import { guessContentType } from "./preflight"
import { tusFingerprint } from "./tus"
import type {
  FinaliseLabels,
  UploadContext,
  Uploader,
  UploadError,
  UploadFn,
} from "./types"
import { fileIdentity, type UploadKeyStore } from "./upload-keys"

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
  /**
   * The capture journal for the signed-in account (B05-05c), or null. Asked
   * before the file's upload key is read, so the account has claimed this
   * device's capture data first.
   */
  capture?: (account: string) => Promise<CaptureSession | null>
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
    capture,
  }: QueueUploaderOptions = {}
): Uploader {
  // Keys of files in flight in this tab, with the run holding each: the same
  // file added twice must not share one reservation. A run the queue gave up
  // on (aborted, e.g. a finalise retried after its stale window) frees its key
  // at once, so the retry is not refused while the old reply is still out.
  const inUse = new Map<string, AbortSignal>()

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
    // Claims the device for this account before any key is read (OD-B5-05-1).
    const session =
      capture && account ? await capture(account).catch(() => null) : null
    let token = readToken(context.resumeToken)
    // The same file picked again (another visit): its stored key reserves
    // the earlier upload.
    let resumed = false
    if (!token) {
      const stored = keys ? await keys.get(file, scope).catch(() => null) : null
      resumed = !!stored && !inUse.has(stored)
      token = {
        idempotencyKey: resumed && stored ? stored : newKey(),
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
    inUse.set(idempotencyKey, context.signal)
    const release = () => {
      if (inUse.get(idempotencyKey) === context.signal)
        inUse.delete(idempotencyKey)
    }
    context.signal?.addEventListener("abort", release, { once: true })
    await keys?.set(file, idempotencyKey, scope).catch(() => {})
    const entryId = session
      ? await record(session, file, idempotencyKey, context, scope)
      : null
    const journal = entryId ? session!.journal : null

    let result: Awaited<ReturnType<UploadFn>>
    try {
      result = await upload(file, {
        idempotencyKey,
        ...(context.purpose ? { purpose: context.purpose } : {}),
        signal: context.signal,
        onProgress: (fraction) => {
          context.onProgress(fraction)
          if (journal && entryId)
            void journal.progress(entryId, Math.round(fraction * file.size))
        },
        onStateChange: (state) => {
          if (state === "processing") {
            context.onProcessing()
            if (journal && entryId)
              void journal.update(entryId, { state: "finalising" })
          }
        },
        onReserved: ({ assetId, resumable }) => {
          context.setResumeToken({
            idempotencyKey,
            assetId,
            tusFingerprint: resumable ? tusFingerprint(assetId) : undefined,
          } satisfies QueueResumeToken)
          // Labels can be sent for the asset from now on.
          context.onReserved?.(assetId, resumed)
          if (journal && entryId)
            void journal.update(entryId, { state: "reserved", assetId })
        },
      })
    } finally {
      context.signal?.removeEventListener("abort", release)
      release()
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

    if (journal && entryId) await settleEntry(journal, entryId, result)

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

/** The file's journal entry at its key point (OD-B5-05-4); its id, or null. */
async function record(
  session: CaptureSession,
  file: File,
  uploadKey: string,
  context: UploadContext,
  scope: { purpose?: UploadContext["purpose"]; account?: string }
): Promise<string | null> {
  const known = captureAnnotation(file)
  const entry = await session.journal
    .pick({
      purpose: context.purpose ?? "general",
      subject: known?.subject ?? { kind: "none", id: null },
      groupKey: known?.groupKey ?? null,
      uploadKey,
      fileFingerprint:
        (await fileIdentity(file, scope).catch(() => null)) ?? "",
      // The File itself: IndexedDB keeps its name, type and lastModified, so
      // a continued file has the same identity (and upload key).
      file,
      mediaType: guessContentType(file).startsWith("video/")
        ? "video"
        : "image",
      ...(known?.pendingLabels !== undefined
        ? { pendingLabels: known.pendingLabels }
        : {}),
    })
    .catch(() => null)
  if (!entry) return null
  bindCapture(file, session.journal, entry.id)
  return entry.id
}

/** How an upload's end changes its entry (OD-B5-05-6). */
async function settleEntry(
  journal: CaptureSession["journal"],
  id: string,
  result: Awaited<ReturnType<UploadFn>>
) {
  if (result.state === "ready") return journal.done(id)
  const error = result.error
  if (!error || error.code === "aborted") return
  // The retry makes a new key, so a new entry.
  if (error.code === "reservation_gone") return journal.done(id)
  // Picking the same file fails again; access ended (worded as sign in again).
  if (
    (error.code === "processing_failed" && !error.retryable) ||
    error.code === "finalise_refused"
  )
    return journal.fail(id, error.code, true)
  // Offline: the state stays, the queue waits for the signal.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return
  return journal.fail(id, error.code, false)
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
