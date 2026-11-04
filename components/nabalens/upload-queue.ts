// Upload queue state machine. Framework-free so it can be unit tested with a
// fake uploader; `useUploadQueue` wraps it for React.
//
// Item lifecycle:
//   selected --start()--> queued --> uploading --> processing --> done
//                                          \             \
//                                           +--> failed <-+   (retry() -> queued)
//   selected|queued|uploading|processing --cancel()--> cancelled (retry() -> queued)
//
// The queue pauses while the device is offline or the session has ended: queued
// files wait instead of starting. A transfer that fails while offline goes back
// to the queue (its resume token keeps it from being sent twice); one that fails
// because the session ended is "stopped" and needs the person's Retry.
//
// "selected" items are previewed and can be removed before the upload starts.
// At most `concurrency` items run at once. The uploader reports progress and the
// switch to server-side processing; whatever token it stores with
// `setResumeToken` (for example the server-reserved asset ID) is handed back on
// retry so a retried file finalises the same asset instead of creating a
// duplicate.

import type { MediaType, UploadLimits } from "./types"

export type QueueItemStatus =
  | "selected"
  | "queued"
  | "uploading"
  | "processing"
  | "done"
  | "failed"
  | "cancelled"

export type QueueItem = {
  id: string
  file: File
  kind: MediaType
  status: QueueItemStatus
  /** 0..1 while uploading. */
  progress: number
  error: string | null
  attempts: number
  /** Failed because the session ended; Retry once signed in again. */
  stopped?: boolean
  /** Server asset ID once done, when the uploader reports it (labelling). */
  assetId?: string
}

export type UploadContext = {
  signal: AbortSignal
  /** Report transfer progress as a fraction between 0 and 1. */
  onProgress: (fraction: number) => void
  /** Call once the bytes are stored and the server is validating them. */
  onProcessing: () => void
  /** Token stored by a previous attempt for this file, if any. */
  resumeToken: unknown
  setResumeToken: (token: unknown) => void
  attempt: number
}

/**
 * Injected upload function. Resolve when the asset is ready (optionally with
 * its server asset ID, so the UI can offer labelling); reject on failure.
 */
export type Uploader = (
  file: File,
  context: UploadContext
) => Promise<void | { assetId: string }>

export type RejectedFile = { name: string; reason: string }

export type AddResult = { added: number; rejected: RejectedFile[] }

export type QueueSummary = {
  total: number
  done: number
  /** Failed for a reason of their own; excludes `stopped`. */
  failed: number
  /** Failed because the session ended. */
  stopped: number
  cancelled: number
  /** queued + uploading + processing. */
  active: number
  /** Queued, not yet transferring. */
  waiting: number
  selected: number
}

export type QueuePause = "offline" | "signed-out" | null

export const SIGNED_OUT_MESSAGE =
  "You were signed out. Sign in again, then choose the same file to finish."

/**
 * Thrown by an uploader when the request failed because the person is no
 * longer signed in. The queue stops that file and pauses until `resume()`.
 */
export class SessionExpiredError extends Error {
  constructor(message = SIGNED_OUT_MESSAGE) {
    super(message)
    this.name = "SessionExpiredError"
  }
}

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const

export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"]
const VIDEO_EXTENSIONS = ["mp4", "mov", "webm"]

/** `accept` attribute value for the file inputs. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_VIDEO_TYPES,
  ...IMAGE_EXTENSIONS.map((e) => `.${e}`),
  ...VIDEO_EXTENSIONS.map((e) => `.${e}`),
].join(",")

/**
 * Early client-side type guess for useful feedback only. The server validates
 * the real content; never treat this as a security check.
 */
export function guessMediaKind(file: File): MediaType | null {
  const type = file.type.toLowerCase()
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) return "image"
  if ((ACCEPTED_VIDEO_TYPES as readonly string[]).includes(type)) return "video"
  // Some phones send HEIC/MOV with an empty or generic MIME type.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (IMAGE_EXTENSIONS.includes(ext)) return "image"
  if (VIDEO_EXTENSIONS.includes(ext)) return "video"
  return null
}

function mib(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

const ACTIVE: QueueItemStatus[] = ["queued", "uploading", "processing"]

type Listener = () => void

let idCounter = 0
function nextId() {
  idCounter += 1
  return `upload-${Date.now().toString(36)}-${idCounter}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Upload failed. Check your connection and try again."
}

export class UploadQueue {
  private items: QueueItem[] = []
  private listeners = new Set<Listener>()
  private controllers = new Map<string, AbortController>()
  private resumeTokens = new Map<string, unknown>()
  // Incremented per attempt so late callbacks from a cancelled run are ignored.
  private runIds = new Map<string, number>()
  private offline = false
  private signedOut = false
  private pause: QueuePause = null

  constructor(
    private uploader: Uploader,
    private limits: UploadLimits
  ) {}

  setUploader(uploader: Uploader) {
    this.uploader = uploader
  }

  setLimits(limits: UploadLimits) {
    this.limits = limits
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.items

  getPause = () => this.pause

  private setPause() {
    const next: QueuePause = this.signedOut
      ? "signed-out"
      : this.offline
        ? "offline"
        : null
    if (next === this.pause) return false
    this.pause = next
    return true
  }

  /** Track the device's connection. Going online resumes waiting files. */
  setOnline(online: boolean) {
    this.offline = !online
    if (this.setPause()) this.emit()
    this.pump()
  }

  /** The session is back: waiting files start; stopped files wait for Retry. */
  resume() {
    this.signedOut = false
    if (this.setPause()) this.emit()
    this.pump()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private update(id: string, patch: Partial<QueueItem>) {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    )
    this.emit()
  }

  private get concurrency() {
    return Math.max(1, this.limits.maxParallelUploads)
  }

  /** Add files to the selection, rejecting unsupported, oversized or excess files. */
  add(files: Iterable<File>): AddResult {
    const rejected: RejectedFile[] = []
    const added: QueueItem[] = []
    // The batch limit counts files that are waiting or in flight, not finished ones.
    let pending = this.items.filter(
      (i) => i.status === "selected" || ACTIVE.includes(i.status)
    ).length

    for (const file of files) {
      const kind = guessMediaKind(file)
      if (!kind) {
        rejected.push({
          name: file.name,
          reason:
            "This file type is not supported. Use JPEG, PNG, WebP, HEIC, MP4, MOV or WebM.",
        })
        continue
      }
      const max =
        kind === "image" ? this.limits.maxPhotoBytes : this.limits.maxVideoBytes
      if (file.size > max) {
        rejected.push({
          name: file.name,
          reason: `${kind === "image" ? "Photos" : "Videos"} can be up to ${mib(max)}.`,
        })
        continue
      }
      if (file.size === 0) {
        rejected.push({ name: file.name, reason: "This file is empty." })
        continue
      }
      if (pending >= this.limits.maxBatchFiles) {
        rejected.push({
          name: file.name,
          reason: `You can upload up to ${this.limits.maxBatchFiles} files at a time.`,
        })
        continue
      }
      pending += 1
      added.push({
        id: nextId(),
        file,
        kind,
        status: "selected",
        progress: 0,
        error: null,
        attempts: 0,
      })
    }

    if (added.length > 0) {
      this.items = [...this.items, ...added]
      this.emit()
    }
    return { added: added.length, rejected }
  }

  /** Remove an item that is not currently transferring. */
  remove(id: string) {
    const item = this.items.find((i) => i.id === id)
    if (!item || item.status === "uploading" || item.status === "processing")
      return
    this.items = this.items.filter((i) => i.id !== id)
    this.resumeTokens.delete(id)
    this.runIds.delete(id)
    this.emit()
  }

  /** Queue every selected file and start transferring. */
  start() {
    let changed = false
    this.items = this.items.map((item) => {
      if (item.status !== "selected") return item
      changed = true
      return { ...item, status: "queued" as const }
    })
    if (changed) this.emit()
    this.pump()
  }

  cancel(id: string) {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    if (item.status === "selected" || item.status === "queued") {
      this.update(id, { status: "cancelled", error: null, stopped: false })
      return
    }
    if (item.status === "uploading" || item.status === "processing") {
      this.runIds.set(id, (this.runIds.get(id) ?? 0) + 1)
      this.controllers.get(id)?.abort()
      this.controllers.delete(id)
      this.update(id, { status: "cancelled", error: null })
      this.pump()
    }
  }

  cancelAll() {
    for (const item of this.items) {
      if (item.status === "selected" || ACTIVE.includes(item.status))
        this.cancel(item.id)
    }
  }

  retry(id: string) {
    const item = this.items.find((i) => i.id === id)
    if (!item || (item.status !== "failed" && item.status !== "cancelled"))
      return
    this.update(id, {
      status: "queued",
      error: null,
      progress: 0,
      stopped: false,
    })
    this.pump()
  }

  /** Retry every file that failed for its own reason (not stopped ones). */
  retryFailed() {
    for (const item of this.items)
      if (item.status === "failed" && !item.stopped) this.retry(item.id)
  }

  /** Drop everything. Active transfers are aborted. */
  reset() {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.resumeTokens.clear()
    this.runIds.clear()
    this.items = []
    this.signedOut = false
    this.setPause()
    this.emit()
  }

  private pump() {
    if (this.pause) return
    let running = this.items.filter(
      (i) => i.status === "uploading" || i.status === "processing"
    ).length
    for (const item of this.items) {
      if (running >= this.concurrency) break
      if (item.status !== "queued") continue
      running += 1
      void this.run(item.id)
    }
  }

  private async run(id: string) {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    const runId = (this.runIds.get(id) ?? 0) + 1
    this.runIds.set(id, runId)
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const attempt = item.attempts + 1
    this.update(id, {
      status: "uploading",
      progress: 0,
      error: null,
      attempts: attempt,
    })

    const current = () => this.runIds.get(id) === runId
    const context: UploadContext = {
      signal: controller.signal,
      attempt,
      resumeToken: this.resumeTokens.get(id),
      setResumeToken: (token) => {
        if (this.runIds.has(id)) this.resumeTokens.set(id, token)
      },
      onProgress: (fraction) => {
        if (!current()) return
        const progress = Math.min(1, Math.max(0, fraction))
        const latest = this.items.find((i) => i.id === id)
        if (latest?.status === "uploading" && latest.progress !== progress) {
          this.update(id, { progress })
        }
      },
      onProcessing: () => {
        if (current()) this.update(id, { status: "processing", progress: 1 })
      },
    }

    try {
      const result = await this.uploader(item.file, context)
      if (!current()) return
      this.update(id, {
        status: "done",
        progress: 1,
        ...(result?.assetId ? { assetId: result.assetId } : {}),
      })
    } catch (error) {
      if (!current()) return
      if (controller.signal.aborted) {
        this.update(id, { status: "cancelled", error: null })
      } else if (error instanceof SessionExpiredError) {
        this.signedOut = true
        this.setPause()
        this.update(id, {
          status: "failed",
          error: error.message,
          stopped: true,
        })
      } else if (
        (this.offline || isNavigatorOffline()) &&
        isRetryableTransfer(error)
      ) {
        // Lost the signal mid-transfer: wait for it rather than fail.
        this.offline = true
        this.setPause()
        this.update(id, { status: "queued", progress: 0, error: null })
      } else {
        this.update(id, { status: "failed", error: errorMessage(error) })
      }
    } finally {
      if (current()) {
        this.controllers.delete(id)
        this.pump()
      }
    }
  }
}

function isNavigatorOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

// Only a request that never got through may wait for the signal. A file the
// server rejected (processing failed, reservation removed) fails as usual even
// if the signal dropped at the same moment. Errors without a code come from a
// plain fetch and count as transfer errors.
const TRANSFER_CODES = new Set([
  "reserve_failed",
  "transfer_failed",
  "finalise_failed",
])

function isRetryableTransfer(error: unknown): boolean {
  const detail =
    error && typeof error === "object" && "error" in error
      ? (error as { error?: { code?: unknown; retryable?: unknown } }).error
      : undefined
  if (!detail || typeof detail.code !== "string") return true
  return TRANSFER_CODES.has(detail.code) && detail.retryable !== false
}

export function summarize(items: readonly QueueItem[]): QueueSummary {
  const summary: QueueSummary = {
    total: items.length,
    done: 0,
    failed: 0,
    stopped: 0,
    cancelled: 0,
    active: 0,
    waiting: 0,
    selected: 0,
  }
  for (const item of items) {
    if (item.status === "done") summary.done += 1
    else if (item.status === "failed") {
      if (item.stopped) summary.stopped += 1
      else summary.failed += 1
    } else if (item.status === "cancelled") summary.cancelled += 1
    else if (item.status === "selected") summary.selected += 1
    else {
      summary.active += 1
      if (item.status === "queued") summary.waiting += 1
    }
  }
  return summary
}
