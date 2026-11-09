import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { CardHead } from "../common-room"
import { completionBreakdown } from "./copy"
import { StatusChip } from "./status-badges"
import type { MonthlyProgress } from "./types"

type FrameState = "accepted" | "waiting" | "open"

/** One frame per photo of the target: accepted, waiting for review, still to take. */
function frames(
  target: number,
  accepted: number,
  pending: number
): FrameState[] {
  const ok = Math.min(Math.max(0, accepted), target)
  const waiting = Math.min(Math.max(0, pending), target - ok)
  return Array.from({ length: target }, (_, i) =>
    i < ok ? "accepted" : i < ok + waiting ? "waiting" : "open"
  )
}

/** Common Room segment fills (DESIGN.md §4): green, striped, grey with an edge. */
const SEGMENT_CLASS: Record<FrameState, string> = {
  accepted: "bg-ok-fg",
  waiting: "bg-stripe",
  open: "bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]",
}

/**
 * Photo progress as one rounded segment per photo (green accepted, striped
 * waiting, grey still needed); above 12 photos the segments merge into one
 * bar. Decorative: the words beside it always carry the numbers. Blue never
 * marks progress.
 */
export function PhotoSegments({
  accepted,
  pending = 0,
  target,
  className,
}: {
  accepted: number
  pending?: number
  target: number
  className?: string
}) {
  const total = Math.max(0, Math.floor(target))
  if (total === 0) return null
  if (total > 12) {
    const ok = Math.min(Math.max(0, accepted), total)
    const sent = Math.min(Math.max(0, pending), total - ok)
    return (
      <div
        aria-hidden
        className={cn(
          "flex h-3 overflow-hidden rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]",
          className
        )}
      >
        <i
          className="block bg-ok-fg"
          style={{ width: `${(ok / total) * 100}%` }}
        />
        <i
          className="block bg-stripe"
          style={{ width: `${(sent / total) * 100}%` }}
        />
      </div>
    )
  }
  return (
    <ol
      aria-hidden
      className={cn("grid gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
    >
      {frames(total, accepted, pending).map((state, index) => (
        <li
          key={index}
          className={cn("block h-3 rounded-round", SEGMENT_CLASS[state])}
        />
      ))}
    </ol>
  )
}

/**
 * One person's progress for a month against their target. A missing target or
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
  const completion = monthly?.completionProgress
  const heading = `${completion ? "Your target for" : "Your photos for"} ${periodLabel}${venueName ? ` at ${venueName}` : ""}`
  const headingId = `month-${monthly?.venue.id ?? "none"}`
  const needsSetup = monthly?.status === "needs_setup"
  const target = monthly?.targetCount ?? 0
  const count = completion?.total ?? monthly?.accepted ?? 0
  const pending = completion ? 0 : (monthly?.pending ?? 0)
  const toTake = Math.max(0, target - count - pending)

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card"
    >
      <CardHead>
        <h2
          id={headingId}
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          {heading}
        </h2>
        {needsSetup || readOnly ? (
          <span className="flex flex-wrap gap-1.5">
            {needsSetup ? (
              <StatusChip tone="warning">Needs setup</StatusChip>
            ) : null}
            {readOnly ? <StatusChip tone="muted">Read-only</StatusChip> : null}
          </span>
        ) : null}
      </CardHead>

      {monthly && !needsSetup ? (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-count text-ink tabular-nums">
              {count}
            </span>
            <span className="font-display text-section-title text-ink-muted">
              of {target} {completion ? "completed" : "accepted"}
            </span>
            {monthly.complete ? (
              <StatusChip tone="positive">Target met</StatusChip>
            ) : null}
          </p>
          <div
            role="img"
            aria-label={`${count} of ${target} ${completion ? "items completed" : "photos accepted"}`}
          >
            <PhotoSegments accepted={count} pending={pending} target={target} />
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted">
            {pending > 0 ? (
              <span>
                {pending}
                {monthly.complete ? " more" : ""} waiting for review
              </span>
            ) : null}
            {toTake > 0 ? (
              <span>
                {toTake} {completion ? "to complete" : "to take"}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {completion ? (
        <p className="text-meta text-ink-muted">
          {completionBreakdown(completion)}
        </p>
      ) : null}

      {!monthly ? (
        <p className="text-body text-ink-muted">
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
        <p className="font-mono text-meta text-ink-muted tabular-nums">
          {monthly.due.label}
        </p>
      ) : null}

      {addHref ? (
        <div className="border-t border-line pt-3">
          <Link
            href={addHref}
            className={buttonVariants({
              variant: "secondary",
              size: "touch",
              className: "w-full sm:w-auto",
            })}
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            Add photos for this month
          </Link>
        </div>
      ) : null}
    </section>
  )
}
