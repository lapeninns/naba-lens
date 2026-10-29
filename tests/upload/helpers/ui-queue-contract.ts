// Verbatim copy of the injected-uploader contract from the ui track's
// components/nabalens/upload-queue.ts (branch feat/nl-ui), so this branch can
// prove `toQueueUploader` fits it without depending on components/.

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

/** Injected upload function. Resolve when the asset is ready; reject on failure. */
export type Uploader = (file: File, context: UploadContext) => Promise<void>

/**
 * Drives an `Uploader` the way UploadQueue does for one item: a fresh
 * AbortController and incremented `attempt` per run, the resume token kept
 * only from the current run and handed back on retry, AbortError -> cancelled,
 * other rejections -> failed with the error's message.
 */
export function createQueueItemDriver(uploader: Uploader, file: File) {
  let resumeToken: unknown
  let attempt = 0
  let controller: AbortController | null = null
  const item = {
    status: "selected" as string,
    progress: 0,
    error: null as string | null,
    processingCalls: 0,
    get resumeToken() {
      return resumeToken
    },
    get attempts() {
      return attempt
    },
    async run() {
      attempt += 1
      const run = new AbortController()
      controller = run
      const active = () => controller === run
      item.status = "uploading"
      item.progress = 0
      item.error = null
      try {
        await uploader(file, {
          signal: run.signal,
          onProgress: (fraction) => {
            if (active()) item.progress = fraction
          },
          onProcessing: () => {
            if (!active()) return
            item.processingCalls += 1
            item.status = "processing"
          },
          resumeToken,
          setResumeToken: (token) => {
            if (active()) resumeToken = token
          },
          attempt,
        })
        if (active()) item.status = "done"
      } catch (error) {
        if (!active()) return
        if (run.signal.aborted) item.status = "cancelled"
        else {
          item.status = "failed"
          item.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
        if (active()) controller = null
      }
    },
    cancel() {
      controller?.abort()
    },
  }
  return item
}
