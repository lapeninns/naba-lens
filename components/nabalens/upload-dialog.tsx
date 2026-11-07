"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  FilmStripIcon,
  HourglassIcon,
  ImageIcon,
  TagIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import type { Icon } from "@phosphor-icons/react"

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
import { PhotoSourceActions, photoInputProps } from "./photo-source"
import { useLeaveGuard } from "./shell/leave-guard"
import {
  SignInAgainSheet,
  useSessionGuard,
  useSignedInAgain,
} from "./session-guard"
import type { UploadLimits } from "./types"
import {
  useUploadLabelDrafts,
  type UploadLabelDrafts,
} from "./upload-label-drafts"
import {
  guessMediaKind,
  type QueueItem,
  type QueuePause,
  type QueueSummary,
  type RejectedFile,
  SessionExpiredError,
  type Uploader,
  type UploadPurpose,
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
   * in that run (only files whose uploader reported an asset ID), and the
   * picked File of each, in the same order (so an owner can tell its own).
   */
  onReady?: (
    assetIds: string[],
    files: File[],
    draftAssetIds?: string[]
  ) => void
  draftLabels?: UploadLabelDrafts
  /**
   * Closing while files upload hides the queue and lets them carry on (the
   * owner stays mounted; Add shows the queue again). Default false: closing
   * is refused until the run ends or is cancelled.
   */
  keepRunningWhenClosed?: boolean
  /**
   * Counts unfinished uploads and files that only have labels left to save.
   */
  onBusyChange?: (busy: UploadBusy) => void
  /** Offer the camera-capture input as an enhancement. Default true. */
  allowCamera?: boolean
  /**
   * Accept photos only; videos are rejected with a reason. Default false. It
   * applies to files added while it is set, so a shared queue can take photos
   * for a task screen and videos from Me.
   */
  imagesOnly?: boolean
  /**
   * Files already picked elsewhere (the Add sheet or Add's own picker). Each
   * new array is queued once while the dialog is open.
   */
  initialFiles?: File[]
  /** Called when files are picked, here or as `initialFiles` (not on cancel). */
  onPick?: (files: File[]) => void
  /**
   * Why these files are uploaded. "amenity" keeps them out of the
   * organisation community (amenity evidence). Default "general".
   */
  purpose?: UploadPurpose
}

export type UploadBusy = {
  active: number
  failed: number
  stopped: number
  labels?: number
}

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

/** The mono state word's icon and tone (DESIGN.md §3 upload states). */
const STATUS_LOOK: Record<QueueItem["status"], { icon?: Icon; tone: string }> =
  {
    selected: { tone: "text-ink-muted" },
    queued: { icon: ClockIcon, tone: "text-ink-muted" },
    uploading: { icon: ArrowUpIcon, tone: "text-ink" },
    processing: { icon: HourglassIcon, tone: "text-ink" },
    done: { icon: CheckIcon, tone: "text-ok-fg" },
    failed: { icon: WarningCircleIcon, tone: "text-warn-fg" },
    cancelled: { icon: XIcon, tone: "text-ink-muted" },
  }

/** Icon for a file that was not added, from its reason. */
function rejectedIcon(file: RejectedFile): Icon {
  const kind = guessMediaKind({ name: file.name, type: "" } as File)
  return kind === "video"
    ? FilmStripIcon
    : kind === "image"
      ? ImageIcon
      : FileIcon
}

function mb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function FileThumb({ item }: { item: QueueItem }) {
  const url = useObjectUrl(item.kind === "image" ? item.file : null)
  const [failed, setFailed] = React.useState(false)
  const Icon = item.kind === "video" ? FilmStripIcon : ImageIcon
  return (
    <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-media-placeholder text-ink-muted">
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
        <Icon className="size-6" aria-hidden />
      )}
    </span>
  )
}

function QueueRow({
  item,
  onRemove,
  onCancel,
  onRetry,
  labels,
}: {
  item: QueueItem
  onRemove: () => void
  onCancel: () => void
  onRetry: () => void
  labels?: React.ReactNode
}) {
  const percent = Math.round(item.progress * 100)
  const statusId = `${item.id}-status`
  const look = STATUS_LOOK[item.status]
  const StatusIcon = look.icon
  return (
    <li
      className="flex min-w-0 items-center gap-3 rounded-card bg-surface p-3 shadow-card"
      aria-describedby={statusId}
    >
      <FileThumb item={item} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="truncate text-label text-ink">{item.file.name}</p>
        <p
          id={statusId}
          className={cn(
            "font-mono text-meta-strong [overflow-wrap:anywhere] tabular-nums",
            look.tone
          )}
        >
          {StatusIcon ? (
            <StatusIcon
              aria-hidden
              weight="bold"
              className="me-1.5 inline size-[18px] -translate-y-px align-middle"
            />
          ) : null}
          {formatBytes(item.file.size)} · {STATUS_TEXT[item.status]}
          {item.status === "uploading" ? ` ${percent}%` : null}
          {item.status === "failed" && item.error ? ` — ${item.error}` : null}
        </p>
        {item.status === "uploading" || item.status === "processing" ? (
          <Progress
            value={item.status === "processing" ? null : percent}
            aria-label={`${item.file.name} ${STATUS_TEXT[item.status]}`}
            tone="neutral"
            className="mt-1.5"
          />
        ) : null}
        {labels}
      </div>
      {item.status === "selected" ? (
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onRemove}
          aria-label={`Remove ${item.file.name}`}
        >
          <XIcon aria-hidden />
        </Button>
      ) : item.status === "queued" || item.status === "uploading" ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          aria-label={`Cancel ${item.file.name}`}
        >
          Cancel
        </Button>
      ) : item.status === "failed" || item.status === "cancelled" ? (
        <Button
          variant="secondary"
          size="sm"
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
  draftLabels,
  keepRunningWhenClosed = false,
  onBusyChange,
  allowCamera = true,
  imagesOnly = false,
  initialFiles,
  onPick,
  purpose = "general",
}: UploadDialogProps) {
  const guard = useSessionGuard()
  const isSignedIn = guard?.isSignedIn
  // Check the session before each attempt and after a failure, so an ended
  // session stops the file (and pauses the rest) instead of failing it with a
  // transport error.
  const upload = React.useMemo<Uploader>(() => {
    const send: Uploader =
      purpose === "general"
        ? uploader
        : (file, context) => uploader(file, { ...context, purpose })
    if (!isSignedIn) return send
    return async (file, context) => {
      if (!(await isSignedIn())) throw new SessionExpiredError()
      try {
        return await send(file, context)
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
  }, [uploader, isSignedIn, purpose])
  const queue = useUploadQueue({ upload, limits })
  const { items, summary, isActive, pause } = queue
  const {
    drafts,
    waiting: waitingLabels,
    stage,
    retry,
    discard,
    reset,
  } = useUploadLabelDrafts(items, draftLabels, pause !== null)
  // Active and failed uploads are already counted by the Add badge.
  const labelsOnly = items.filter(
    (item) =>
      (item.status === "done" || item.status === "cancelled") &&
      drafts[item.id] &&
      drafts[item.id].status !== "saved"
  ).length
  const [draftItems, setDraftItems] = React.useState<
    readonly QueueItem[] | null
  >(null)
  useLeaveGuard(summary.active, queue.cancelAll)
  const { active, failed, stopped } = summary
  React.useEffect(() => {
    onBusyChange?.({
      active,
      failed,
      stopped,
      ...(labelsOnly ? { labels: labelsOnly } : {}),
    })
  }, [active, failed, stopped, labelsOnly, onBusyChange])
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
        ? [{ id: i.assetId, file: i.file, drafted: !!drafts[i.id] }]
        : []
    )
    if (fresh.length === 0) return
    for (const { id } of fresh) reportedReady.current.add(id)
    const ids = fresh.map((f) => f.id)
    const files = fresh.map((f) => f.file)
    const drafted = fresh.filter((f) => f.drafted).map((f) => f.id)
    if (drafted.length) onReady(ids, files, drafted)
    else onReady(ids, files)
  }, [isActive, items, onReady, drafts])

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
    onPick?.(files)
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
    if (!next && waitingLabels > 0 && keepRunningWhenClosed) {
      onOpenChange(false)
      return
    }
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
      reset()
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
        i.status === "done" && i.assetId && !drafts[i.id] ? [i.assetId] : []
      )
    : []
  const draftable =
    draftLabels && !signedOut
      ? items.filter(
          (i) =>
            !drafts[i.id] &&
            (i.status === "selected" ||
              i.status === "queued" ||
              i.status === "uploading" ||
              i.status === "processing") &&
            (draftLabels.canDraft?.(i.file) ?? true)
        )
      : []

  const uploadDialog = (
    <Dialog open={open && draftItems === null} onOpenChange={handleOpenChange}>
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

        <div>
          <PhotoSourceActions
            layout="row"
            // One blue button per screen: once files are queued, the footer
            // action is the primary and choosing more goes grey.
            libraryVariant={items.length > 0 ? "secondary" : "primary"}
            describedBy={limitsId}
            onChoose={(source) =>
              (source === "library" ? fileInput : cameraInput).current?.click()
            }
            cameraHidden={!allowCamera}
          />
          <input
            ref={fileInput}
            {...photoInputProps("library", { imagesOnly })}
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
              {...photoInputProps("camera", { imagesOnly })}
              className="sr-only"
              tabIndex={-1}
              aria-label={imagesOnly ? "Take a photo" : "Take a photo or video"}
              onChange={(e) => addFiles(e.currentTarget.files, e.currentTarget)}
            />
          ) : null}
        </div>

        {rejected.length > 0 ? (
          // A warn card: what wasn't added, then each file with its reason.
          <div
            role="alert"
            className="grid gap-2 rounded-card bg-surface p-3 ps-4 shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]"
          >
            <p className="flex items-center gap-2 font-display text-section-title text-ink">
              <WarningCircleIcon
                aria-hidden
                weight="bold"
                className="size-6 shrink-0 text-warn-fg"
              />
              {rejected.length === 1
                ? "1 file was not added"
                : `${rejected.length} files were not added`}
            </p>
            <ul className="grid list-none divide-y divide-line rounded-card border border-line">
              {rejected.map((r, i) => {
                const FileKind = rejectedIcon(r)
                return (
                  <li
                    key={`${r.name}-${i}`}
                    className="flex min-w-0 items-start gap-3 p-3"
                  >
                    <span
                      aria-hidden
                      className="grid size-11 shrink-0 place-items-center rounded-round bg-warn-bg text-warn-fg"
                    >
                      <FileKind className="size-5" />
                    </span>
                    <span className="min-w-0 text-body [overflow-wrap:anywhere] text-ink-muted">
                      <span className="block text-label text-ink">
                        {r.name}
                        <span className="sr-only">:</span>
                      </span>{" "}
                      {r.reason}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {signedOut ? (
          <Notice tone="negative" title="You were signed out">
            Nothing is sent twice. We&apos;ll email you a sign-in link and code
            and keep this page.
          </Notice>
        ) : pause === "offline" && isActive ? (
          <Notice tone="attention" role="status">
            Waiting for a signal. Keep this page open; nothing is sent twice.
          </Notice>
        ) : !pause && isActive ? (
          <Notice>Keep this page open while files upload.</Notice>
        ) : null}

        {items.length > 0 ? (
          // Each file as a white row on the grey canvas (Common Room queue).
          <ul
            aria-label="Files"
            className="-mx-1 grid gap-2 rounded-card bg-bg p-1.5"
          >
            {items.map((item) => {
              const draft = drafts[item.id]
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  onRemove={() => {
                    discard(item.id)
                    queue.remove(item.id)
                  }}
                  onCancel={() => queue.cancel(item.id)}
                  onRetry={() => queue.retry(item.id)}
                  labels={
                    draft && (
                      <div className="text-body text-ink-muted">
                        <p role="status">
                          {draft.status === "saved"
                            ? "Labels saved"
                            : draft.status === "error"
                              ? draft.message
                              : item.status === "done"
                                ? "Labels pending"
                                : "Labels will save when this file is ready"}
                        </p>
                        {draft.status === "error" && draft.retryable && (
                          <Button
                            variant="link"
                            size="touch"
                            onClick={() => retry(item.id)}
                          >
                            Retry labels
                          </Button>
                        )}
                        {(draft.status === "error" ||
                          item.status === "failed" ||
                          item.status === "cancelled") && (
                          <Button
                            variant="link"
                            size="touch"
                            onClick={() => discard(item.id)}
                          >
                            Discard label draft
                          </Button>
                        )}
                      </div>
                    )
                  }
                />
              )
            })}
          </ul>
        ) : null}

        <div aria-live="polite" className="grid gap-1 text-body">
          {closeBlocked && isActive ? (
            <p className="flex items-start gap-2 font-semibold text-warn-fg">
              <WarningCircleIcon
                aria-hidden
                className="mt-0.5 size-5 shrink-0"
              />
              <span>
                Uploads are still running. Keep this open, or cancel them first.
              </span>
            </p>
          ) : null}
          {onLabel && labelIds.length > 0 ? (
            <p className="text-ink-muted">
              Optional: add menu items or details now, or later from each file.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {items.length > 0 && status ? (
            <p
              role="status"
              className="font-mono text-meta-strong text-ink-muted tabular-nums md:mr-auto md:self-center"
            >
              {status}
            </p>
          ) : null}
          {isActive ? (
            <Button variant="secondary" size="touch" onClick={queue.cancelAll}>
              Cancel all
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="touch"
              onClick={() => handleOpenChange(false)}
            >
              {waitingLabels > 0 ? "Close" : settled ? "Done" : "Cancel"}
            </Button>
          )}
          {onLabel && labelIds.length > 0 ? (
            <Button
              variant={
                summary.failed + summary.stopped > 0 ? "secondary" : "primary"
              }
              size="touch"
              onClick={() => {
                const ids = labelIds
                // Failed or stopped files stay in the queue (hidden, not
                // cleared) so they can still be retried afterwards.
                if (summary.failed + summary.stopped > 0) onOpenChange(false)
                else handleOpenChange(false)
                onLabel(ids)
              }}
            >
              <TagIcon data-icon="inline-start" aria-hidden />
              {labelIds.length === 1 ? "Label this file" : "Label these files"}
            </Button>
          ) : null}
          {draftable.length > 0 ? (
            <Button
              variant="secondary"
              size="touch"
              onClick={() => {
                setDraftItems(draftable)
                if (draftable.some((i) => i.status === "selected")) {
                  setRejected([])
                  queue.start()
                }
              }}
            >
              <TagIcon data-icon="inline-start" aria-hidden />
              {draftable.some((i) => i.status === "selected")
                ? "Upload and label"
                : "Label while uploading"}
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
            onSignedIn={() => {
              setSignInOpen(false)
              resume()
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )

  return (
    <>
      {uploadDialog}
      {draftItems &&
        draftLabels?.renderEditor({
          items: draftItems,
          onClose: () => setDraftItems(null),
          onQueue: stage,
        })}
    </>
  )
}
