"use client"

import * as React from "react"
import { XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { GUIDE_ANGLES, guideAlt, type GuideDish } from "@/lib/guide/dish-guide"
import { cn } from "@/lib/utils"

/** Horizontal travel, in CSS pixels, that turns a touch drag into a swipe. */
const SWIPE_PX = 40
const LAST = GUIDE_ANGLES.length - 1
const VIEWER_BUTTON =
  "border-on-viewer/40 bg-transparent text-on-viewer hover:bg-on-viewer/12 hover:text-on-viewer disabled:border-on-viewer/20 disabled:bg-transparent disabled:text-on-viewer-muted"

type GuideViewerProps = {
  dish: GuideDish
  /** The angle shown, 0-3. */
  index: number
  onIndexChange: (index: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes on close: the tile that opened the viewer. */
  returnFocus?: () => HTMLElement | null
}

/**
 * Full-screen example: one angle of one dish on the dark viewer ground, with
 * Previous and Next, arrow keys inside the dialog and a swipe on touch.
 */
export function GuideViewer({
  dish,
  index,
  onIndexChange,
  open,
  onOpenChange,
  returnFocus,
}: GuideViewerProps) {
  const previousRef = React.useRef<HTMLButtonElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)
  /** The touch or pen that started a possible swipe; a second one cancels it. */
  const swipeStart = React.useRef<{ id: number; x: number } | null>(null)
  const angle = GUIDE_ANGLES[index] ?? GUIDE_ANGLES[0]
  const image = dish.images[angle.id]

  function go(to: number) {
    const clamped = Math.max(0, Math.min(LAST, to))
    if (clamped === index) return
    onIndexChange(clamped)
    // A button that becomes disabled drops focus; keep it on the other one.
    if (clamped === 0 && document.activeElement === previousRef.current) {
      nextRef.current?.focus()
    }
    if (clamped === LAST && document.activeElement === nextRef.current) {
      previousRef.current?.focus()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        finalFocus={() => returnFocus?.() ?? true}
        onKeyDown={(event) => {
          // Leave Alt+Arrow (Back/Forward) and other shortcuts to the browser.
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return
          if (event.key === "ArrowRight") {
            event.preventDefault()
            go(index + 1)
          } else if (event.key === "ArrowLeft") {
            event.preventDefault()
            go(index - 1)
          }
        }}
        className={cn(
          // Examples always sit on the dark viewer ground, in both themes.
          "flex flex-col gap-0 bg-viewer p-0 pt-0 pb-0 text-on-viewer before:hidden",
          "max-md:top-0 max-md:max-h-dvh max-md:min-h-dvh max-md:rounded-none",
          "md:max-h-[calc(100dvh-3rem)] md:max-w-[min(56rem,calc(100vw-3rem))] md:p-0"
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-2 md:px-5">
          <p className="font-mono text-meta text-on-viewer-muted tabular-nums">
            {index + 1} of {GUIDE_ANGLES.length} · {dish.name}
          </p>
          {/* Focus stays on Previous/Next, so name the angle that came in. */}
          <p aria-live="polite" className="sr-only">
            {`${index + 1} of ${GUIDE_ANGLES.length}, ${angle.name}. ${angle.tip}`}
          </p>
          <DialogClose
            render={
              <Button
                variant="quiet"
                size="sm"
                className="-mr-2 text-on-viewer hover:bg-on-viewer/12 hover:text-on-viewer active:bg-on-viewer/20"
              />
            }
          >
            <XIcon aria-hidden />
            Close
          </DialogClose>
        </div>
        <div
          // Vertical scroll and pinch-zoom stay with the browser.
          className="grid touch-pan-y touch-pinch-zoom place-items-center px-0 py-3 md:px-5"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") return
            // A second finger means a pinch, never a swipe.
            swipeStart.current = event.isPrimary
              ? { id: event.pointerId, x: event.clientX }
              : null
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current
            if (start === null || start.id !== event.pointerId) return
            swipeStart.current = null
            const dx = event.clientX - start.x
            if (Math.abs(dx) > SWIPE_PX) go(index + (dx < 0 ? 1 : -1))
          }}
          onPointerCancel={() => {
            swipeStart.current = null
          }}
        >
          {/* Pre-sized static example; no image optimiser (no-image-optimiser.test.ts). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={image.src2x}
            src={image.src2x}
            width={image.width2x}
            height={image.height2x}
            alt={guideAlt(dish, angle.id)}
            decoding="async"
            draggable={false}
            className="h-auto max-h-[60svh] w-full object-contain md:rounded-control"
          />
        </div>
        <div className="grid gap-2 px-4 pb-2 md:px-5">
          <div aria-hidden className="flex justify-center gap-1.5">
            {GUIDE_ANGLES.map((a, i) => (
              <span
                key={a.id}
                className={cn(
                  "size-2.5 rounded-round",
                  i === index ? "bg-on-viewer" : "bg-on-viewer/30"
                )}
              />
            ))}
          </div>
          <DialogTitle className="pr-0 font-display text-section-title text-on-viewer">
            {angle.name}
          </DialogTitle>
          <DialogDescription className="max-w-(--size-reading) text-body text-on-viewer-muted">
            {angle.tip}
          </DialogDescription>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-3 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:px-5 md:pb-5">
          <Button
            ref={previousRef}
            variant="outline"
            size="touch"
            disabled={index === 0}
            onClick={() => go(index - 1)}
            className={VIEWER_BUTTON}
          >
            Previous
          </Button>
          <Button
            ref={nextRef}
            variant="outline"
            size="touch"
            disabled={index === LAST}
            onClick={() => go(index + 1)}
            className={VIEWER_BUTTON}
          >
            Next
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
