"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CameraIcon,
  FilmStripIcon,
  ImageIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import type { UploadLimits } from "./types"
import {
  ACCEPT_ATTRIBUTE,
  type QueueItem,
  type RejectedFile,
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
  /** Offer the camera-capture input as an enhancement. Default true. */
  allowCamera?: boolean
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
  allowCamera = true,
}: UploadDialogProps) {
  const queue = useUploadQueue({ upload: uploader, limits })
  const { items, summary, isActive } = queue
  const [rejected, setRejected] = React.useState<RejectedFile[]>([])
  const [closeBlocked, setCloseBlocked] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const cameraInput = React.useRef<HTMLInputElement>(null)
  const limitsId = React.useId()

  // Report newly finished files once per settled run.
  const reported = React.useRef(0)
  React.useEffect(() => {
    if (isActive) return
    const fresh = summary.done - reported.current
    if (fresh > 0) {
      reported.current = summary.done
      onUploaded?.(fresh)
    }
  }, [isActive, summary.done, onUploaded])

  function addFiles(list: FileList | null, input: HTMLInputElement | null) {
    if (!list || list.length === 0) return
    const result = queue.add(Array.from(list))
    setRejected(result.rejected)
    setCloseBlocked(false)
    // Allow picking the same file again after removing it.
    if (input) input.value = ""
  }

  function handleOpenChange(next: boolean) {
    if (!next && isActive) {
      setCloseBlocked(true)
      return
    }
    if (!next) {
      queue.reset()
      reported.current = 0
      setRejected([])
      setCloseBlocked(false)
    }
    onOpenChange(next)
  }

  const started = items.some((i) => i.status !== "selected")
  const settled = started && !isActive && summary.selected === 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload photos or videos</DialogTitle>
          <DialogDescription id={limitsId}>
            Up to {limits.maxBatchFiles} files at a time. Photos up to{" "}
            {mb(limits.maxPhotoBytes)} (JPEG, PNG, WebP, HEIC), videos up to{" "}
            {mb(limits.maxVideoBytes)} (MP4, MOV, WebM).
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
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose photos or videos"
            onChange={(e) => addFiles(e.currentTarget.files, e.currentTarget)}
          />
          {allowCamera ? (
            <input
              ref={cameraInput}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-label="Take a photo or video"
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
          {settled ? (
            <p className="font-medium" role="status">
              {[
                `${summary.done} uploaded`,
                summary.failed ? `${summary.failed} failed` : null,
                summary.cancelled ? `${summary.cancelled} cancelled` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
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
          {settled && summary.failed > 0 ? (
            <Button size="touch" onClick={queue.retryFailed}>
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              Retry failed
            </Button>
          ) : summary.selected > 0 ? (
            <Button size="touch" onClick={queue.start}>
              <UploadSimpleIcon data-icon="inline-start" aria-hidden />
              Upload {summary.selected}{" "}
              {summary.selected === 1 ? "file" : "files"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
