"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { EvidenceImage } from "./evidence-image"

/**
 * A sent photo's thumbnail that opens its larger preview. Both images come
 * from authorised routes and re-sign themselves if a link has expired.
 */
export function EvidenceThumb({
  thumbnailUrl,
  previewUrl,
  label,
  className,
}: {
  thumbnailUrl: string | null
  previewUrl: string | null
  /** Names the photo, e.g. "Photo sent 2 Nov 2026". */
  label: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const preview = previewUrl ?? thumbnailUrl
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-control bg-media-placeholder",
        className
      )}
    >
      <EvidenceImage src={thumbnailUrl} className="size-full" />
      {preview ? (
        <>
          {/* A sibling overlay, so the image's own Try again stays a separate button. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`View larger: ${label}`}
            className="absolute inset-0 z-10 cursor-zoom-in rounded-[inherit] outline-none focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="md:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{label}</DialogTitle>
              </DialogHeader>
              {open ? (
                <EvidenceImage
                  src={preview}
                  alt={label}
                  fit="contain"
                  className="h-[min(70svh,40rem)] w-full rounded-control bg-stage"
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </span>
  )
}
