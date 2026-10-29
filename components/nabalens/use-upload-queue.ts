"use client"

import * as React from "react"

import type { UploadLimits } from "./types"
import { summarize, UploadQueue, type Uploader } from "./upload-queue"

export type UseUploadQueueOptions = {
  /** Injected upload function; see `Uploader`. */
  upload: Uploader
  limits: UploadLimits
  /** Warn before leaving the page while transfers are active. Default true. */
  warnBeforeUnload?: boolean
}

export function useUploadQueue({
  upload,
  limits,
  warnBeforeUnload = true,
}: UseUploadQueueOptions) {
  const [queue] = React.useState(() => new UploadQueue(upload, limits))

  React.useEffect(() => {
    queue.setUploader(upload)
    queue.setLimits(limits)
  }, [queue, upload, limits])

  // Abort anything still running when the owner unmounts.
  React.useEffect(() => () => queue.reset(), [queue])

  const items = React.useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot
  )
  const summary = React.useMemo(() => summarize(items), [items])
  const isActive = summary.active > 0

  React.useEffect(() => {
    if (!warnBeforeUnload || !isActive) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers need returnValue set to show the prompt.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isActive, warnBeforeUnload])

  return {
    items,
    summary,
    isActive,
    add: React.useCallback(
      (files: Iterable<File>) => queue.add(files),
      [queue]
    ),
    remove: React.useCallback((id: string) => queue.remove(id), [queue]),
    start: React.useCallback(() => queue.start(), [queue]),
    cancel: React.useCallback((id: string) => queue.cancel(id), [queue]),
    cancelAll: React.useCallback(() => queue.cancelAll(), [queue]),
    retry: React.useCallback((id: string) => queue.retry(id), [queue]),
    retryFailed: React.useCallback(() => queue.retryFailed(), [queue]),
    reset: React.useCallback(() => queue.reset(), [queue]),
  }
}

/** Object URL for a local file preview, revoked on change/unmount. */
export function useObjectUrl(file: File | null | undefined): string | null {
  const [entry, setEntry] = React.useState<{ file: File; url: string } | null>(
    null
  )
  React.useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return
    const url = URL.createObjectURL(file)
    // Subscribing to an external resource (the object URL) is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  // Ignore a stale URL from a previous file until the effect catches up.
  return entry && entry.file === file ? entry.url : null
}
