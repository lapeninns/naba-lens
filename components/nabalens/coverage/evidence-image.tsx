"use client"

import * as React from "react"
import { ImageIcon } from "@phosphor-icons/react"

import { EvidenceImage } from "@/components/nabalens/tasks/evidence-image"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const THUMB = "aspect-[4/3] w-full rounded-control bg-media-placeholder"

function Unavailable({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex flex-col items-center justify-center gap-1 bg-media-placeholder text-meta text-ink-muted",
        className
      )}
    >
      <ImageIcon className="size-6" aria-hidden />
      Preview unavailable
    </span>
  )
}

/**
 * Evidence thumbnail from an authorised route that signs a 60 s link per
 * request. EvidenceImage re-requests an expired link once, then offers
 * "Try again"; no route (deleted photo) shows a plain placeholder.
 */
export function EvidenceThumb({
  src,
  className,
}: {
  src: string | null
  className?: string
}) {
  if (!src) return <Unavailable className={cn(THUMB, className)} />
  return <EvidenceImage src={src} className={cn(THUMB, className)} />
}

/** Thumbnail that opens the larger preview in a dialog. */
export function EvidencePreviewButton({
  thumbnailUrl,
  previewUrl,
  label,
  description,
  edge = false,
  className,
}: {
  thumbnailUrl: string | null
  previewUrl: string | null
  /** Accessible name, e.g. "Photo by Sam Lee". */
  label: string
  description?: React.ReactNode
  /** Edge to edge in a post: no radius, fills its box. */
  edge?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const thumb = thumbnailUrl ?? previewUrl
  const large = previewUrl ?? thumbnailUrl
  return (
    <div className={cn("relative", className)}>
      <EvidenceThumb
        src={thumb}
        className={edge ? "aspect-auto h-full rounded-none" : undefined}
      />
      {large ? (
        // Overlay (z-10) under EvidenceImage's own "Try again" (z-20), so a
        // failed thumbnail can be retried without opening the dialog.
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${label}`}
          className={cn(
            "absolute inset-0 z-10 outline-none focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-solid",
            edge
              ? "focus-visible:-outline-offset-3"
              : "rounded-control focus-visible:outline-offset-2"
          )}
        />
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {open && large ? (
            <EvidenceImage
              src={large}
              alt={label}
              fit="contain"
              className="h-[60svh] w-full rounded-control"
            />
          ) : (
            <Unavailable className="h-40 w-full rounded-control" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
