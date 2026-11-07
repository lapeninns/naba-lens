"use client"

import * as React from "react"
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react"

import { EvidenceImage } from "@/components/nabalens/tasks/evidence-image"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import type { ListCard } from "./card-model"
import { REVIEW_COPY } from "./review-copy"

/**
 * The large preview of the loaded photos. ArrowLeft and ArrowRight move
 * through the list (no single-key shortcuts for decisions); Esc closes and
 * focus returns to the thumbnail that opened it. The card's own decision
 * buttons sit in the footer.
 */
export function PreviewDialog({
  cards,
  index,
  onIndexChange,
  onClose,
  returnFocus,
  renderActions,
}: {
  cards: ListCard[]
  /** The photo shown; null when closed. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  /** The element focused again on close (the opening thumbnail). */
  returnFocus: () => HTMLElement | null
  renderActions: (card: ListCard) => React.ReactNode
}) {
  const open = index !== null && index >= 0 && index < cards.length
  const card = open ? cards[index] : null
  const large = card ? (card.asset.previewUrl ?? card.asset.thumbnailUrl) : null
  const position = open ? `${index + 1} of ${cards.length}` : ""

  function move(step: number) {
    if (index === null || cards.length === 0) return
    const next = index + step
    if (next >= 0 && next < cards.length) onIndexChange(next)
  }

  const popupRef = React.useRef<HTMLDivElement | null>(null)

  function onArrowKey(event: KeyboardEvent | React.KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    if (event.defaultPrevented) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target instanceof Element ? event.target : null
    // Arrow keys inside a field or a listbox keep their own meaning.
    if (
      target?.closest(
        "input, textarea, select, [contenteditable='true'], [role='listbox']"
      )
    )
      return
    // Another dialog opened over the preview (the item picker) owns its keys.
    const owner = target?.closest("[role='dialog'], [role='alertdialog']")
    if (owner && owner !== popupRef.current) return
    event.preventDefault()
    move(event.key === "ArrowLeft" ? -1 : 1)
  }

  // Base UI moves focus into the popup only after it has opened, so a key
  // pressed straight away still lands on the thumbnail that opened it, outside
  // the popup. Catch those on the document. Keys inside the popup never get
  // there (the popup stops arrow keys propagating), so the popup's own
  // onKeyDown handles them below.
  const onOutsideKey = React.useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Node ? event.target : null
    if (target && popupRef.current?.contains(target)) return
    onArrowKey(event)
  })
  React.useEffect(() => {
    if (!open) return
    const listener = (event: KeyboardEvent) => onOutsideKey(event)
    document.addEventListener("keydown", listener)
    return () => document.removeEventListener("keydown", listener)
  }, [open])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="md:max-w-4xl"
        ref={popupRef}
        onKeyDown={onArrowKey}
        finalFocus={() => {
          const target = returnFocus()
          if (!target) return true
          queueMicrotask(() => target.focus())
          return false
        }}
      >
        {card ? (
          <>
            <DialogHeader>
              <DialogTitle className="break-words">
                {REVIEW_COPY.photoBy(card.contributor.name)}
              </DialogTitle>
              <DialogDescription>
                {card.item
                  ? `${card.item.name}${card.item.variantName ? ` · ${card.item.variantName}` : ""}`
                  : REVIEW_COPY.noMenuItem}
                {" · "}
                {position}
              </DialogDescription>
            </DialogHeader>
            {large ? (
              <EvidenceImage
                key={card.key}
                src={large}
                alt={REVIEW_COPY.photoBy(card.contributor.name)}
                fit="contain"
                className="h-[60svh] w-full rounded-print"
              />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                // aria-disabled, not disabled: a focused button that disables drops
                // focus out of the dialog (and the arrow keys with it).
                aria-disabled={index === 0 || undefined}
                onClick={() => move(-1)}
              >
                <CaretLeftIcon data-icon="inline-start" aria-hidden />
                Previous photo
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-disabled={index === cards.length - 1 || undefined}
                onClick={() => move(1)}
              >
                Next photo
                <CaretRightIcon data-icon="inline-end" aria-hidden />
              </Button>
            </div>
            <DialogFooter className="md:justify-start">
              {renderActions(card)}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
