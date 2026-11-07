"use client"

import * as React from "react"
import {
  DownloadSimpleIcon,
  ImageBrokenIcon,
  PencilSimpleIcon,
  SpinnerGapIcon,
  TagIcon,
  TrashIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { formatBytes, formatDate, formatTime } from "./format"
import { isEmptyLabelSummary, LabelSummary } from "./labels"
import { Notice } from "./notice"
import { ProfileAvatar } from "./profile-avatar"
import type { MediaItem } from "./types"

export const PREVIEW_UNAVAILABLE = "Preview unavailable in this browser"

type MediaViewerProps = {
  item: MediaItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Permission-aware actions: each one renders only when provided. Staff get
   * delete on their own media; admin get download, profile and delete.
   * Download is admin-only, and so is the original file row it brings.
   */
  getDownloadHref?: (item: MediaItem) => string
  /** Called as a download starts (the browser download is not prevented). */
  onDownload?: (item: MediaItem) => void
  /** Why the last download failed, shown in the viewer. */
  downloadError?: string | null
  getPortfolioHref?: (item: MediaItem) => string
  onDelete?: (item: MediaItem) => void
  /** Name the contributor. Off on a staff member's own profile ("You"). */
  showAttribution?: boolean
  /**
   * v0.3 optional labels: opens the label editor for a ready asset. The
   * Labels row shows when this is set or the item carries labels.
   */
  onEditLabels?: (item: MediaItem) => void
  /**
   * The file left the list while it was open (removed elsewhere): the viewer
   * keeps the last view, says so and offers only Close.
   */
  removed?: boolean
}

function noun(item: MediaItem) {
  return item.mediaType === "video" ? "Video" : "Photo"
}

function uploadedAt(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? formatDate(iso)
    : `${formatDate(iso)}, ${formatTime(date)}`
}

function StageMessage({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 px-4 py-16 text-center text-on-viewer-muted">
      {icon}
      <p className="text-body">{children}</p>
    </div>
  )
}

function Unavailable({
  children = PREVIEW_UNAVAILABLE,
}: {
  children?: React.ReactNode
}) {
  return (
    <StageMessage icon={<ImageBrokenIcon className="size-8" aria-hidden />}>
      {children}
    </StageMessage>
  )
}

function Preview({ item, label }: { item: MediaItem; label: string }) {
  // Track the URL that failed so a re-signed URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  const failed = failedUrl !== null && failedUrl === item.previewUrl

  if (item.uploadState === "uploading" || item.uploadState === "processing") {
    return (
      <StageMessage
        icon={
          <SpinnerGapIcon
            className="size-8 motion-safe:animate-spin"
            aria-hidden
          />
        }
      >
        {item.uploadState === "processing"
          ? "Processing. It appears here in a moment."
          : "Still uploading."}
      </StageMessage>
    )
  }
  if (item.uploadState === "failed") {
    return (
      <Unavailable>
        This file could not be processed, so there is no preview.
      </Unavailable>
    )
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
        aria-label={label}
        className="max-h-[65svh] w-full bg-viewer"
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
      alt={label}
      className="mx-auto max-h-[65svh] w-auto max-w-full object-contain"
      onError={() => setFailedUrl(item.previewUrl)}
    />
  )
}

/** A key-value row: the term on the left, the value in bold on the right. */
const KV_ROW =
  "grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5"

function DetailRow({
  term,
  children,
  className,
}: {
  term: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={KV_ROW}>
      <dt className="text-body text-ink-muted">{term}</dt>
      <dd
        className={cn(
          "min-w-0 text-body font-bold [overflow-wrap:anywhere] text-ink",
          className
        )}
      >
        {children}
      </dd>
    </div>
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
  removed = false,
}: MediaViewerProps) {
  const labelsTermId = React.useId()

  const ready = item?.uploadState === "ready"
  const downloadable = !removed && ready && getDownloadHref
  const editLabels = !removed && ready ? onEditLabels : undefined
  const deletable = !removed ? onDelete : undefined
  const profileHref =
    !removed && item && getPortfolioHref ? getPortfolioHref(item) : null
  const labelsEmpty = isEmptyLabelSummary(item?.labels)
  // Ready files show labels when there are some or they can be added; an
  // unfinished file of the owner shows that none can be added yet.
  const labelsShown = ready
    ? onEditLabels !== undefined || !labelsEmpty
    : onEditLabels !== undefined && labelsEmpty

  const label = item
    ? `${noun(item)} by ${item.contributorName}, ${item.venueName}, uploaded ${uploadedAt(item.createdAt)}`
    : ""

  return (
    <Dialog open={open && !!item} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // The stage behind the photo is always near black (DESIGN.md §2),
          // in both themes; the details card below follows the theme.
          // Phones: full screen, details in a card below the media. From
          // md: media beside a 20rem details panel.
          "gap-0 bg-bg p-0 pt-0 pb-0 text-ink before:hidden",
          "max-md:top-0 max-md:max-h-dvh max-md:min-h-dvh max-md:rounded-none",
          "md:max-h-[calc(100dvh-3rem)] md:max-w-[min(64rem,calc(100vw-3rem))] md:grid-cols-[minmax(0,1fr)_20rem] md:p-0"
        )}
      >
        {item ? (
          <>
            <div className="relative grid min-h-75 place-items-center bg-stage pt-15 pb-4 text-on-viewer md:min-h-90 md:px-6 md:pb-6">
              <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
                {/* A labelled Close (DESIGN.md §4): icon and word. */}
                <DialogClose
                  render={
                    <Button
                      variant="quiet"
                      size="sm"
                      className="gap-1.5 px-3 text-on-viewer hover:bg-on-viewer/12 hover:text-on-viewer active:bg-on-viewer/20"
                    />
                  }
                >
                  <XIcon aria-hidden />
                  <span>Close</span>
                </DialogClose>
              </div>
              <Preview key={item.id} item={item} label={label} />
            </div>
            <aside
              aria-label="Details"
              className="grid content-start bg-bg p-(--page-gutter) pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:border-s md:border-line md:p-4"
            >
              <DialogTitle className="sr-only">
                {noun(item)} by {item.contributorName}
              </DialogTitle>
              {/* The details as one white card on the canvas (Common Room). */}
              <div className="grid min-w-0 content-start gap-4 rounded-card bg-surface p-4 shadow-card">
                {removed ? (
                  <Notice tone="attention">
                    This {noun(item).toLowerCase()} was removed a moment ago.
                  </Notice>
                ) : null}
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar name={item.contributorName} />
                  <span className="min-w-0 text-item-title [overflow-wrap:anywhere] text-ink">
                    {showAttribution ? item.contributorName : "You"}
                  </span>
                </div>
                <dl className="grid gap-2.5">
                  <DetailRow term="Venue at upload">{item.venueName}</DetailRow>
                  <DetailRow term="Uploaded" className="tabular-nums">
                    {uploadedAt(item.createdAt)}
                  </DetailRow>
                  {labelsShown ? (
                    <div className={KV_ROW}>
                      <dt
                        id={labelsTermId}
                        className="text-body text-ink-muted"
                      >
                        Labels
                      </dt>
                      <dd className="min-w-0 text-body font-bold [overflow-wrap:anywhere] text-ink">
                        {ready ? (
                          <div role="region" aria-labelledby={labelsTermId}>
                            {labelsEmpty ? (
                              <p className="font-normal text-ink-muted">
                                None yet. Labels are optional.
                              </p>
                            ) : (
                              <LabelSummary labels={item.labels} />
                            )}
                          </div>
                        ) : (
                          <p className="font-normal text-ink-muted">None yet</p>
                        )}
                      </dd>
                    </div>
                  ) : null}
                  {getDownloadHref && item.originalFilename !== null ? (
                    <DetailRow
                      term="Original file"
                      className="font-mono font-semibold"
                    >
                      {[
                        item.originalFilename,
                        item.sizeBytes ? formatBytes(item.sizeBytes) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </DetailRow>
                  ) : null}
                </dl>
                {downloadable && downloadError ? (
                  <Notice tone="negative">{downloadError}</Notice>
                ) : null}
                {removed ? (
                  <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
                    <DialogClose
                      render={<Button variant="secondary" size="touch" />}
                    >
                      Close
                    </DialogClose>
                  </div>
                ) : downloadable || editLabels || profileHref || deletable ? (
                  // Phones stack the actions with the primary last, nearest the
                  // thumb; from md they read in order, primary first.
                  <div className="flex flex-col-reverse gap-2 md:flex-row md:flex-wrap">
                    {downloadable ? (
                      <a
                        href={getDownloadHref(item)}
                        download
                        onClick={
                          onDownload ? () => onDownload(item) : undefined
                        }
                        className={buttonVariants({
                          variant: "primary",
                          size: "touch",
                        })}
                      >
                        <DownloadSimpleIcon
                          data-icon="inline-start"
                          aria-hidden
                        />
                        Download original
                      </a>
                    ) : null}
                    {editLabels ? (
                      <Button
                        variant="secondary"
                        size="touch"
                        onClick={() => editLabels(item)}
                      >
                        {labelsEmpty ? (
                          <TagIcon data-icon="inline-start" aria-hidden />
                        ) : (
                          <PencilSimpleIcon
                            data-icon="inline-start"
                            aria-hidden
                          />
                        )}
                        {labelsEmpty ? "Add labels" : "Edit labels"}
                      </Button>
                    ) : null}
                    {profileHref ? (
                      <Link
                        href={profileHref}
                        className={buttonVariants({
                          variant: "secondary",
                          size: "touch",
                        })}
                      >
                        <UserCircleIcon data-icon="inline-start" aria-hidden />
                        Open profile
                      </Link>
                    ) : null}
                    {deletable ? (
                      <Button
                        variant="danger-quiet"
                        size="touch"
                        onClick={() => deletable(item)}
                      >
                        <TrashIcon data-icon="inline-start" aria-hidden />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </aside>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
