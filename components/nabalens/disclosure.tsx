import * as React from "react"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

/**
 * Reference sections folded shut (second handoff, decision 4): a card of
 * rows, each a native `<details>` that opens in place. A closed disclosure
 * holds a whole existing section, unchanged inside; nothing is removed.
 * The label is the section's own heading and the quiet line says what is
 * inside. Server-safe: no state, no handlers.
 */
export function DisclosureList({
  children,
  className,
  label,
}: {
  children: React.ReactNode
  className?: string
  /** Names the group for assistive tech, e.g. "More about these numbers". */
  label?: string
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      data-slot="disclosure-list"
      className={cn(
        "grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface",
        className
      )}
    >
      {children}
    </div>
  )
}

export function Disclosure({
  title,
  summary,
  id,
  defaultOpen = false,
  children,
}: {
  /** The section's heading, unchanged. */
  title: React.ReactNode
  /** One quiet line: what the section holds, e.g. "Every slot, by state". */
  summary?: React.ReactNode
  /** Anchor for links into the section; also used by tests. */
  id?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      id={id}
      open={defaultOpen || undefined}
      data-slot="disclosure"
      className="group/disclosure scroll-mt-4"
    >
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-3 focus-ring outline-none hover:bg-raised [&::-webkit-details-marker]:hidden">
        <span className="font-semibold text-ink">{title}</span>
        {summary != null ? (
          <span className="min-w-0 text-meta [overflow-wrap:anywhere] text-ink-muted">
            {summary}
          </span>
        ) : null}
        <CaretDownIcon
          aria-hidden
          className="ms-auto size-5 shrink-0 text-ink-muted transition-transform duration-quick group-open/disclosure:rotate-180"
        />
      </summary>
      <div className="grid gap-gutter border-t border-line bg-canvas px-3 py-4 md:px-4">
        {children}
      </div>
    </details>
  )
}
