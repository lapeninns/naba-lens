"use client"

import * as React from "react"

import { isLeavingDeliberately } from "@/lib/upload/before-unload"

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
  const pause = React.useSyncExternalStore(
    queue.subscribe,
    queue.getPause,
    queue.getPause
  )
  const summary = React.useMemo(() => summarize(items), [items])
  const isActive = summary.active > 0
  // Leaving stops only files still waiting or transferring; a processing file
  // is the server's to finish, so it alone does not warn.
  const stoppable = items.some(
    (i) => i.status === "queued" || i.status === "uploading"
  )

  // Files wait while the device is offline and start again on `online`.
  React.useEffect(() => {
    const sync = () => queue.setOnline(navigator.onLine !== false)
    sync()
    window.addEventListener("online", sync)
    window.addEventListener("offline", sync)
    return () => {
      window.removeEventListener("online", sync)
      window.removeEventListener("offline", sync)
    }
  }, [queue])

  React.useEffect(() => {
    if (!warnBeforeUnload || !stoppable) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isLeavingDeliberately()) return
      event.preventDefault()
      // Legacy browsers need returnValue set to show the prompt.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [stoppable, warnBeforeUnload])

  return {
    items,
    summary,
    isActive,
    /** Why waiting files are not starting, if they are paused. */
    pause,
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
    resume: React.useCallback(() => queue.resume(), [queue]),
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
