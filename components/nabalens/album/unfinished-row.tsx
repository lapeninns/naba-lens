"use client"

import { CaretRightIcon, WarningIcon } from "@phosphor-icons/react"

import { useAddContext } from "@/components/nabalens/shell/add-context"

/*
 * Album Home's unfinished row (spec §6 S1, DESIGN.md §5a): under the retake
 * row, photos that need the person — they stopped or failed in this visit,
 * or were picked in an earlier visit and never finished. Same shape as the
 * other Home rows. Tapping it opens Add, which shows them first with Retry;
 * a retry never sends a photo twice (S1-UPLOAD). Nothing shows while there
 * are none, so a photo only sending never reads as a problem.
 */

export const UNFINISHED_COPY = {
  title: (n: number) =>
    n === 1 ? "1 photo didn't finish" : `${n} photos didn't finish`,
  line: "Open them to send again. Nothing is sent twice.",
} as const

export function UnfinishedRow() {
  const add = useAddContext()
  const count = (add?.failed ?? 0) + (add?.earlier ?? 0)
  if (!add || count <= 0) return null
  return (
    <button
      type="button"
      data-slot="unfinished-row"
      onClick={() => add.openAdd()}
      className="flex min-h-16 w-full items-center gap-3 rounded-card bg-warn-bg px-3 py-2 text-start text-ink edge focus-ring"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-surface [&_svg]:size-6">
        <WarningIcon aria-hidden weight="bold" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-label">{UNFINISHED_COPY.title(count)}</span>
        <span className="text-body text-ink-muted">{UNFINISHED_COPY.line}</span>
      </span>
      <CaretRightIcon aria-hidden className="size-5 shrink-0" />
    </button>
  )
}
