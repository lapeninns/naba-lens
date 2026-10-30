"use client"

import * as React from "react"
import {
  DownloadSimpleIcon,
  PencilSimpleIcon,
  TrashIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { formatBytes, formatDate, formatDuration } from "./format"
import { isEmptyLabelSummary, LabelSummary } from "./labels"
import type { MediaItem } from "./types"
import { UploadStateBadge } from "./upload-state-badge"

export const PREVIEW_UNAVAILABLE = "Preview unavailable in this browser"

type MediaViewerProps = {
  item: MediaItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Permission-aware actions: each one renders only when provided. Staff get
   * delete on their own media; admin get download, portfolio and delete.
   */
  getDownloadHref?: (item: MediaItem) => string
  /** Called as a download starts (the browser download is not prevented). */
  onDownload?: (item: MediaItem) => void
  /** Why the last download failed, shown in the viewer. */
  downloadError?: string | null
  getPortfolioHref?: (item: MediaItem) => string
  onDelete?: (item: MediaItem) => void
  /** Show contributor and venue. Off on a staff member's own portfolio. */
  showAttribution?: boolean
  /**
   * v0.3 optional labels: opens the label editor for a ready asset. The
   * Labels section shows when this is set or the item carries labels.
   */
  onEditLabels?: (item: MediaItem) => void
}

function Unavailable({
  children = PREVIEW_UNAVAILABLE,
}: {
  children?: React.ReactNode
}) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/80">
      <WarningCircleIcon className="size-6" aria-hidden />
      <p className="font-medium text-white">{children}</p>
    </div>
  )
}

function Preview({ item }: { item: MediaItem }) {
  // Track the URL that failed so a re-signed URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  const failed = failedUrl !== null && failedUrl === item.previewUrl

  if (item.uploadState !== "ready") {
    const message =
      item.uploadState === "failed"
        ? "This file could not be processed, so there is no preview."
        : item.uploadState === "processing"
          ? "Still processing. The preview appears once the file is ready."
          : "Still uploading."
    return <Unavailable>{message}</Unavailable>
  }
  if (!item.previewUrl || failed) return <Unavailable />

  if (item.mediaType === "video") {
    // No canPlayType() pre-check and no <source type>: the container type says
    // little about the codec (Chromium answers "" for video/quicktime yet plays
    // H.264 MOV, and "maybe" for an HEVC MP4 it cannot decode). The element reads
    // the actual bytes; a real decode or format failure fires `error` on the
    // <video> itself and swaps in the explicit fallback.
    return (
      // Never autoplay; the user starts playback with sound under their control.
      <video
        key={item.previewUrl}
        src={item.previewUrl}
        controls
        playsInline
        preload="metadata"
        className="max-h-[65svh] w-full bg-black"
        onError={() => setFailedUrl(item.previewUrl)}
      >
        {PREVIEW_UNAVAILABLE}
      </video>
    )
  }

  return (
    // Full, uncropped image. Signed private URL, so no next/image optimiser.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={item.previewUrl}
      src={item.previewUrl}
      alt={`Photo ${item.originalFilename}`}
      className="mx-auto max-h-[65svh] w-auto max-w-full object-contain"
      onError={() => setFailedUrl(item.previewUrl)}
    />
  )
}

export function MediaViewer({
  item,
  open,
  onOpenChange,
  getDownloadHref,
  onDownload,
  downloadError,
  getPortfolioHref,
  onDelete,
  showAttribution = true,
  onEditLabels,
}: MediaViewerProps) {
  const details: [string, React.ReactNode][] = item
    ? [
        ...(showAttribution
          ? ([
              ["Contributor", item.contributorName],
              ["Venue at upload", item.venueName],
            ] as [string, React.ReactNode][])
          : []),
        ["Uploaded", formatDate(item.createdAt)],
        ["File", item.originalFilename],
        [
          "Type",
          [
            item.mediaType === "video" ? "Video" : "Photo",
            item.sizeBytes ? formatBytes(item.sizeBytes) : null,
            item.width && item.height ? `${item.width} × ${item.height}` : null,
            item.durationSeconds ? formatDuration(item.durationSeconds) : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ],
      ]
    : []

  const downloadable = item?.uploadState === "ready" && getDownloadHref
  const labelsShown =
    item?.uploadState === "ready" &&
    (onEditLabels !== undefined || !isEmptyLabelSummary(item.labels))
  const labelsHeadingId = React.useId()

  return (
    <Dialog open={open && !!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-1rem)] gap-0 overflow-y-auto p-0 sm:max-w-4xl">
        {item ? (
          <>
            <DialogHeader className="gap-1 px-4 pt-4 pr-12 pb-3">
              <DialogTitle className="truncate text-base">
                {item.mediaType === "video" ? "Video" : "Photo"}
                {showAttribution ? ` by ${item.contributorName}` : ""}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span className="truncate">{item.originalFilename}</span>
                {item.uploadState !== "ready" ? (
                  <UploadStateBadge state={item.uploadState} />
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center bg-neutral-950">
              <Preview key={item.id} item={item} />
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[max-content_1fr]">
              {details.map(([term, value]) => (
                <div key={term} className="contents">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="-mt-1.5 min-w-0 break-words sm:mt-0">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {labelsShown ? (
              <section
                aria-labelledby={labelsHeadingId}
                className="mx-4 mb-4 flex flex-col gap-2 border-t pt-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id={labelsHeadingId} className="text-sm font-medium">
                    Labels
                  </h3>
                  {onEditLabels ? (
                    <Button
                      variant="outline"
                      size="touch"
                      onClick={() => onEditLabels(item)}
                    >
                      <PencilSimpleIcon data-icon="inline-start" aria-hidden />
                      {isEmptyLabelSummary(item.labels)
                        ? "Add labels"
                        : "Edit labels"}
                    </Button>
                  ) : null}
                </div>
                <LabelSummary labels={item.labels} />
              </section>
            ) : null}
            {downloadable && downloadError ? (
              <p
                role="alert"
                className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-negative/40 px-4 py-2 text-sm"
              >
                <WarningCircleIcon
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
                {downloadError}
              </p>
            ) : null}
            {downloadable || getPortfolioHref || onDelete ? (
              // Sticky so Delete/Download stay on screen below a tall preview.
              <DialogFooter className="sticky bottom-0 mx-0 mb-0 bg-popover sm:justify-between">
                {onDelete ? (
                  <Button
                    variant="destructive"
                    size="touch"
                    onClick={() => onDelete(item)}
                  >
                    <TrashIcon data-icon="inline-start" aria-hidden />
                    Delete
                  </Button>
                ) : (
                  <span className="hidden sm:block" />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {getPortfolioHref ? (
                    <Link
                      href={getPortfolioHref(item)}
                      className={buttonVariants({
                        variant: "outline",
                        size: "touch",
                      })}
                    >
                      <UserCircleIcon data-icon="inline-start" aria-hidden />
                      Open portfolio
                    </Link>
                  ) : null}
                  {downloadable ? (
                    <a
                      href={getDownloadHref(item)}
                      download
                      onClick={onDownload ? () => onDownload(item) : undefined}
                      className={cn(buttonVariants({ size: "touch" }))}
                    >
                      <DownloadSimpleIcon
                        data-icon="inline-start"
                        aria-hidden
                      />
                      Download original
                    </a>
                  ) : null}
                </div>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
