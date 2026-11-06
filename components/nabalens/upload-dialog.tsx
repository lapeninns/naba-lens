"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CameraIcon,
  FilmStripIcon,
  ImageIcon,
  TagIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

import { formatBytes } from "./format"
import { Notice } from "./notice"
import { useLeaveGuard } from "./shell/leave-guard"
import {
  SignInAgainSheet,
  useSessionGuard,
  useSignedInAgain,
} from "./session-guard"
import type { UploadLimits } from "./types"
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_IMAGE_TYPES,
  guessMediaKind,
  type QueueItem,
  type QueuePause,
  type QueueSummary,
  type RejectedFile,
  SessionExpiredError,
  type Uploader,
} from "./upload-queue"
import { useObjectUrl, useUploadQueue } from "./use-upload-queue"

type UploadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injected transfer function; the page wires it to the real upload routes. */
  uploader: Uploader
  /** Pass MEDIA_LIMITS from lib/config/media.ts. */
  limits: UploadLimits
  /** Called after a run settles with at least one new ready file. */
  onUploaded?: (count: number) => void
  /**
   * Optional labelling after upload (v0.3): shown once a run settles with
   * finished files whose asset IDs are known. Skipping it changes nothing.
   */
  onLabel?: (assetIds: string[]) => void
  /**
   * Called once per settled run with the asset IDs of files that became ready
   * in that run (only files whose uploader reported an asset ID).
   */
  onReady?: (assetIds: string[]) => void
  /**
   * Closing while files upload hides the queue and lets them carry on (the
   * owner stays mounted; Add shows the queue again). Default false: closing
   * is refused until the run ends or is cancelled.
   */
  keepRunningWhenClosed?: boolean
  /**
   * Called when the count of unfinished files changes: running or waiting,
   * failed, and stopped by a sign-out. All zero once the run is finished or
   * the queue is cleared.
   */
  onBusyChange?: (busy: UploadBusy) => void
  /** Offer the camera-capture input as an enhancement. Default true. */
  allowCamera?: boolean
  /** Accept photos only; videos are rejected with a reason. Default false. */
  imagesOnly?: boolean
  /**
   * Files already picked elsewhere (the Add sheet). Each new array is queued
   * once while the dialog is open.
   */
  initialFiles?: File[]
}

export type UploadBusy = { active: number; failed: number; stopped: number }

const IMAGE_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_IMAGE_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
].join(",")

const STATUS_TEXT: Record<QueueItem["status"], string> = {
  selected: "Ready to upload",
  queued: "Waiting",
  uploading: "Uploading",
  processing: "Processing",
  done: "Uploaded",
  failed: "Failed",
  cancelled: "Cancelled",
}

/**
 * The footer status line: what is done, then what is still going on. Offline,
 * running files are "waiting"; after a sign-out, unfinished ones are "stopped".
 */
function statusLine(
  summary: QueueSummary,
  pause: QueuePause,
  started: boolean,
  maxBatchFiles: number
) {
  if (!started) {
    return summary.selected > 0
      ? `${summary.selected} ready · up to ${maxBatchFiles} at a time`
      : null
  }
  const running =
    summary.active === 0
      ? null
      : pause === "offline" || (pause && summary.active === summary.waiting)
        ? `${summary.active} waiting`
        : `${summary.active} in progress`
  return [
    `${summary.done} uploaded`,
    running,
    summary.failed ? `${summary.failed} failed` : null,
    summary.stopped ? `${summary.stopped} stopped` : null,
    summary.cancelled ? `${summary.cancelled} cancelled` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function mb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function FileThumb({ item }: { item: QueueItem }) {
  const url = useObjectUrl(item.kind === "image" ? item.file : null)
  const [failed, setFailed] = React.useState(false)
  const Icon = item.kind === "video" ? FilmStripIcon : ImageIcon
  return (
    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-media-placeholder text-muted-foreground">
      {url && !failed ? (
        // Local object URL preview; HEIC and similar fall back to the icon.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-5" aria-hidden />
      )}
    </span>
  )
}

function QueueRow({
  item,
  onRemove,
  onCancel,
  onRetry,
}: {
  item: QueueItem
  onRemove: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const percent = Math.round(item.progress * 100)
  const statusId = `${item.id}-status`
  return (
    <li className="flex items-center gap-3 py-2.5" aria-describedby={statusId}>
      <FileThumb item={item} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.file.name}</p>
        <p
          id={statusId}
          className={cn(
            "text-xs text-muted-foreground tabular-nums",
            item.status === "failed" && "text-negative",
            item.status === "done" && "text-positive"
          )}
        >
          {formatBytes(item.file.size)} · {STATUS_TEXT[item.status]}
          {item.status === "uploading" ? ` ${percent}%` : null}
          {item.status === "failed" && item.error ? ` — ${item.error}` : null}
        </p>
        {item.status === "uploading" || item.status === "processing" ? (
          <Progress
            value={item.status === "processing" ? null : percent}
            aria-label={`${item.file.name} ${STATUS_TEXT[item.status]}`}
            className="mt-1.5"
          />
        ) : null}
      </div>
      {item.status === "selected" ? (
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11 sm:size-9"
          onClick={onRemove}
          aria-label={`Remove ${item.file.name}`}
        >
          <XIcon aria-hidden />
        </Button>
      ) : item.status === "queued" || item.status === "uploading" ? (
        <Button
          variant="ghost"
          size="touch"
          onClick={onCancel}
          aria-label={`Cancel ${item.file.name}`}
        >
          Cancel
        </Button>
      ) : item.status === "failed" || item.status === "cancelled" ? (
        <Button
          variant="outline"
          size="touch"
          onClick={onRetry}
          aria-label={`Retry ${item.file.name}`}
        >
          <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
          Retry
        </Button>
      ) : null}
    </li>
  )
}

export function UploadDialog({
  open,
  onOpenChange,
  uploader,
  limits,
  onUploaded,
  onLabel,
  onReady,
  keepRunningWhenClosed = false,
  onBusyChange,
  allowCamera = true,
  imagesOnly = false,
  initialFiles,
}: UploadDialogProps) {
  const guard = useSessionGuard()
  const isSignedIn = guard?.isSignedIn
  // Check the session before each attempt and after a failure, so an ended
  // session stops the file (and pauses the rest) instead of failing it with a
  // transport error.
  const upload = React.useMemo<Uploader>(() => {
    if (!isSignedIn) return uploader
    return async (file, context) => {
      if (!(await isSignedIn())) throw new SessionExpiredError()
      try {
        return await uploader(file, context)
      } catch (error) {
        if (
          !context.signal.aborted &&
          !(error instanceof SessionExpiredError) &&
          !(await isSignedIn())
        )
          throw new SessionExpiredError()
        throw error
      }
    }
  }, [uploader, isSignedIn])
  const queue = useUploadQueue({ upload, limits })
  const { items, summary, isActive, pause } = queue
  useLeaveGuard(summary.active, queue.cancelAll)
  const { active, failed, stopped } = summary
  React.useEffect(() => {
    onBusyChange?.({ active, failed, stopped })
  }, [active, failed, stopped, onBusyChange])
  const signedOut = pause === "signed-out"
  const [signInOpen, setSignInOpen] = React.useState(false)

  // Show E7 over the queue when the session ends; it stays reachable from
  // "Sign in again" after "Not now".
  const wasSignedOut = React.useRef(false)
  React.useEffect(() => {
    if (signedOut && !wasSignedOut.current && guard) {
      // Opening the sheet follows the queue's external state.
      setSignInOpen(true)
      if (!open) onOpenChange(true)
    }
    wasSignedOut.current = signedOut
  }, [signedOut, guard, open, onOpenChange])

  const { resume } = queue
  useSignedInAgain(signedOut, isSignedIn, () => {
    setSignInOpen(false)
    resume()
  })
  const [rejected, setRejected] = React.useState<RejectedFile[]>([])
  const [closeBlocked, setCloseBlocked] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const cameraInput = React.useRef<HTMLInputElement>(null)
  const limitsId = React.useId()

  // Report newly finished files once per settled run.
  const reported = React.useRef(0)
  React.useEffect(() => {
    // A refresh while signed out would send the page to /login; wait.
    if (isActive || signedOut) return
    const fresh = summary.done - reported.current
    if (fresh > 0) {
      reported.current = summary.done
      onUploaded?.(fresh)
    }
  }, [isActive, signedOut, summary.done, onUploaded])

  const reportedReady = React.useRef(new Set<string>())
  React.useEffect(() => {
    if (isActive || !onReady) return
    const fresh = items.flatMap((i) =>
      i.status === "done" && i.assetId && !reportedReady.current.has(i.assetId)
        ? [i.assetId]
        : []
    )
    if (fresh.length === 0) return
    for (const id of fresh) reportedReady.current.add(id)
    onReady(fresh)
  }, [isActive, items, onReady])

  const queuedInitial = React.useRef<File[] | null>(null)
  React.useEffect(() => {
    if (!open || !initialFiles?.length) return
    if (queuedInitial.current === initialFiles) return
    queuedInitial.current = initialFiles
    addFiles(initialFiles, null)
  })

  function addFiles(
    list: FileList | File[] | null,
    input: HTMLInputElement | null
  ) {
    if (!list || list.length === 0) return
    const files = Array.from(list)
    const notPhotos: RejectedFile[] = []
    const accepted = imagesOnly
      ? files.filter((file) => {
          const kind = guessMediaKind(file)
          if (kind === "image") return true
          notPhotos.push({
            name: file.name,
            reason:
              kind === "video"
                ? "Only photos can be added here. Upload videos from your portfolio."
                : "This file type is not supported. Use JPEG, PNG, WebP or HEIC.",
          })
          return false
        })
      : files
    const result = queue.add(accepted)
    setRejected([...notPhotos, ...result.rejected])
    setCloseBlocked(false)
    // Allow picking the same file again after removing it.
    if (input) input.value = ""
  }

  function handleOpenChange(next: boolean) {
    if (!next && isActive) {
      if (keepRunningWhenClosed) {
        onOpenChange(false)
        return
      }
      setCloseBlocked(true)
      return
    }
    if (!next) {
      queue.reset()
      reported.current = 0
      reportedReady.current.clear()
      setRejected([])
      setCloseBlocked(false)
    }
    onOpenChange(next)
  }

  const started = items.some((i) => i.status !== "selected")
  const settled = started && !isActive && summary.selected === 0
  const status = statusLine(summary, pause, started, limits.maxBatchFiles)
  const labelIds = settled
    ? items.flatMap((i) =>
        i.status === "done" && i.assetId ? [i.assetId] : []
      )
    : []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {imagesOnly ? "Upload photos" : "Upload photos or videos"}
          </DialogTitle>
          <DialogDescription id={limitsId}>
            {imagesOnly ? (
              <>
                Up to {limits.maxBatchFiles} photos at a time, each up to{" "}
                {mb(limits.maxPhotoBytes)} (JPEG, PNG, WebP, HEIC).
              </>
            ) : (
              <>
                Up to {limits.maxBatchFiles} files at a time. Photos up to{" "}
                {mb(limits.maxPhotoBytes)} (JPEG, PNG, WebP, HEIC), videos up to{" "}
                {mb(limits.maxVideoBytes)} (MP4, MOV, WebM).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="touch"
            className="sm:flex-1"
            onClick={() => fileInput.current?.click()}
            aria-describedby={limitsId}
          >
            <UploadSimpleIcon data-icon="inline-start" aria-hidden />
            Choose files
          </Button>
          {allowCamera ? (
            <Button
              variant="outline"
              size="touch"
              className="sm:flex-1"
              onClick={() => cameraInput.current?.click()}
            >
              <CameraIcon data-icon="inline-start" aria-hidden />
              Use camera
            </Button>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={imagesOnly ? IMAGE_ACCEPT_ATTRIBUTE : ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            aria-label={
              imagesOnly ? "Choose photos" : "Choose photos or videos"
            }
            onChange={(e) => addFiles(e.currentTarget.files, e.currentTarget)}
          />
          {allowCamera ? (
            <input
              ref={cameraInput}
              type="file"
              accept={imagesOnly ? "image/*" : "image/*,video/*"}
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-label={imagesOnly ? "Take a photo" : "Take a photo or video"}
              onChange={(e) => addFiles(e.currentTarget.files, e.currentTarget)}
            />
          ) : null}
        </div>

        {rejected.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>
              {rejected.length === 1
                ? "1 file was not added"
                : `${rejected.length} files were not added`}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-none">
                {rejected.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="break-words">
                    <span className="font-medium">{r.name}</span>: {r.reason}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {signedOut ? (
          <Notice tone="negative" title="You were signed out">
            Nothing is sent twice. We&apos;ll email you a sign-in link and keep
            this page.
          </Notice>
        ) : pause === "offline" && isActive ? (
          <Notice tone="attention" role="status">
            Waiting for a signal. Keep this page open; nothing is sent twice.
          </Notice>
        ) : !pause && isActive ? (
          <Notice>Keep this page open while files upload.</Notice>
        ) : null}

        {items.length > 0 ? (
          <ul aria-label="Files" className="-my-1 divide-y">
            {items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                onRemove={() => queue.remove(item.id)}
                onCancel={() => queue.cancel(item.id)}
                onRetry={() => queue.retry(item.id)}
              />
            ))}
          </ul>
        ) : null}

        <div aria-live="polite" className="text-sm">
          {closeBlocked && isActive ? (
            <p className="text-warning">
              Uploads are still running. Keep this open, or cancel them first.
            </p>
          ) : null}
          {onLabel && labelIds.length > 0 ? (
            <p className="mt-1 text-muted-foreground">
              Optional: add menu items or details now, or later from each file.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {items.length > 0 && status ? (
            <p
              role="status"
              className="text-meta-touch text-ink-muted tabular-nums md:mr-auto md:self-center md:text-meta"
            >
              {status}
            </p>
          ) : null}
          {isActive ? (
            <Button variant="outline" size="touch" onClick={queue.cancelAll}>
              Cancel all
            </Button>
          ) : (
            <Button
              variant="outline"
              size="touch"
              onClick={() => handleOpenChange(false)}
            >
              {settled ? "Done" : "Cancel"}
            </Button>
          )}
          {onLabel && labelIds.length > 0 ? (
            <Button
              variant={
                summary.failed + summary.stopped > 0 ? "outline" : "default"
              }
              size="touch"
              onClick={() => {
                const ids = labelIds
                handleOpenChange(false)
                onLabel(ids)
              }}
            >
              <TagIcon data-icon="inline-start" aria-hidden />
              {labelIds.length === 1 ? "Label this file" : "Label these files"}
            </Button>
          ) : null}
          {signedOut ? (
            guard ? (
              <Button
                variant="primary"
                size="touch"
                onClick={() => setSignInOpen(true)}
              >
                Sign in again
              </Button>
            ) : (
              <a
                href="/login"
                target="_blank"
                rel="noopener"
                className={buttonVariants({
                  variant: "primary",
                  size: "touch",
                })}
              >
                Sign in again
              </a>
            )
          ) : settled && summary.failed > 0 ? (
            <Button variant="primary" size="touch" onClick={queue.retryFailed}>
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              Retry {summary.failed} failed
            </Button>
          ) : summary.selected > 0 ? (
            <Button
              size="touch"
              onClick={() => {
                setRejected([])
                queue.start()
              }}
            >
              <UploadSimpleIcon data-icon="inline-start" aria-hidden />
              Upload {summary.selected}{" "}
              {summary.selected === 1 ? "file" : "files"}
            </Button>
          ) : null}
        </DialogFooter>
        {guard ? (
          <SignInAgainSheet
            open={signInOpen}
            onOpenChange={setSignInOpen}
            guard={guard}
            done={summary.done}
            stopped={summary.stopped}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
