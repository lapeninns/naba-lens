import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { StatusChip } from "./status-badges"
import type { MonthlyProgress } from "./types"

type FrameState = "accepted" | "waiting" | "open"

/** One frame per photo of the target: accepted, waiting for review, still to take. */
function frames(monthly: MonthlyProgress): FrameState[] {
  const target = monthly.targetCount ?? 0
  const accepted = Math.min(monthly.accepted, target)
  const waiting = Math.min(monthly.pending, target - accepted)
  return Array.from({ length: target }, (_, i) =>
    i < accepted ? "accepted" : i < accepted + waiting ? "waiting" : "open"
  )
}

const FRAME_CLASS: Record<FrameState, string> = {
  accepted: "border-positive bg-positive",
  waiting: "border-dashed border-ink-muted bg-transparent",
  open: "border-line-control bg-transparent",
}

/**
 * One person's photos for one month against their target. A missing target or
 * team reads Needs setup, never complete. Monthly numbers stay here and are
 * never added to a venue's checklist progress.
 */
export function MonthCard({
  monthly,
  periodLabel,
  venueName,
  readOnly = false,
  replaceHref = null,
  replaceCount = 0,
  addHref = null,
}: {
  monthly: MonthlyProgress | null
  /** "November 2026", for the heading and a month with no target row. */
  periodLabel: string
  /** Name the venue when a month spans a transfer. */
  venueName?: string | null
  readOnly?: boolean
  /** Lead action while a photo needs replacing this month. */
  replaceHref?: string | null
  replaceCount?: number
  /** Secondary action: where to add photos, or null to hide it. */
  addHref?: string | null
}) {
  const heading = `Your photos for ${periodLabel}${venueName ? ` at ${venueName}` : ""}`
  const headingId = `month-${monthly?.venue.id ?? "none"}`
  const needsSetup = monthly?.status === "needs_setup"
  const target = monthly?.targetCount ?? 0
  const strip = monthly && !needsSetup ? frames(monthly) : []
  const toTake = monthly
    ? Math.max(0, target - monthly.accepted - monthly.pending)
    : 0

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 rounded-panel border border-line bg-panel p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id={headingId}
          className="text-section-title-touch text-ink md:text-section-title"
        >
          {heading}
        </h2>
        {needsSetup ? (
          <StatusChip tone="warning">Needs setup</StatusChip>
        ) : null}
        {readOnly ? <StatusChip tone="muted">Read-only</StatusChip> : null}
      </div>

      {monthly && !needsSetup ? (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-count text-ink tabular-nums">
              {monthly.accepted}
            </span>
            <span className="text-body-touch text-ink-muted md:text-body">
              of {target} accepted
            </span>
            {monthly.complete ? (
              <StatusChip tone="positive">Target met</StatusChip>
            ) : null}
          </p>
          <div
            role="img"
            aria-label={`${monthly.accepted} of ${target} photos accepted`}
          >
            <ol aria-hidden className="flex gap-1.5">
              {strip.map((state, index) => (
                <li
                  key={index}
                  className={cn(
                    "h-3 min-w-0 flex-1 rounded-chip border",
                    FRAME_CLASS[state]
                  )}
                />
              ))}
            </ol>
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-body-touch text-ink-muted md:text-body-sm">
            {monthly.pending > 0 ? (
              <span>
                {monthly.pending}
                {monthly.complete ? " more" : ""} waiting for review
              </span>
            ) : null}
            {toTake > 0 ? <span>{toTake} to take</span> : null}
          </p>
        </div>
      ) : null}

      {!monthly ? (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          There&apos;s no photo target for you this month.
        </p>
      ) : null}

      {replaceHref && replaceCount > 0 ? (
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warning">Needs another photo</StatusChip>
          <Link
            href={replaceHref}
            className={buttonVariants({ variant: "link", size: "touch" })}
          >
            {replaceCount === 1
              ? "1 photo to replace"
              : `${replaceCount} photos to replace`}
          </Link>
        </p>
      ) : null}

      {monthly?.due && !readOnly ? (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          {monthly.due.label}
        </p>
      ) : null}

      {addHref ? (
        <div>
          <Link
            href={addHref}
            className={buttonVariants({ variant: "secondary", size: "touch" })}
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            Add photos for this month
          </Link>
        </div>
      ) : null}
    </section>
  )
}
