"use client"

import * as React from "react"
import {
  DownloadSimpleIcon,
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
  getPortfolioHref?: (item: MediaItem) => string
  onDelete?: (item: MediaItem) => void
  /** Show contributor and venue. Off on a staff member's own portfolio. */
  showAttribution?: boolean
}

function canPlay(mime: string | null): boolean {
  if (typeof document === "undefined") return true
  if (!mime) return true // let the element try; onError catches failure
  return document.createElement("video").canPlayType(mime) !== ""
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
  const [failed, setFailed] = React.useState(false)

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
    if (!canPlay(item.mimeType)) return <Unavailable />
    return (
      // Never autoplay; the user starts playback with sound under their control.
      <video
        key={item.previewUrl}
        controls
        playsInline
        preload="metadata"
        className="max-h-[65svh] w-full bg-black"
        onError={() => setFailed(true)}
      >
        <source src={item.previewUrl} type={item.mimeType ?? undefined} />
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
      onError={() => setFailed(true)}
    />
  )
}

export function MediaViewer({
  item,
  open,
  onOpenChange,
  getDownloadHref,
  getPortfolioHref,
  onDelete,
  showAttribution = true,
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
