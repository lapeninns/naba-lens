// The injected-uploader contract, taken from the ui track's real source so the
// type-equality test in queue-adapter.test.ts fails if lib/upload/types.ts
// (which copies it to keep lib/ free of components/ imports) drifts.
import type {
  UploadContext,
  Uploader,
} from "../../../components/nabalens/upload-queue"

export type { UploadContext, Uploader }

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
