import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { CardHead } from "@/components/nabalens/common-room"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  completionBreakdown,
  HOME_MONTH_COPY as COPY,
  plural,
} from "@/components/nabalens/tasks/copy"
import { Progress } from "@/components/ui/progress"
import type { MonthlyProgress } from "@/components/nabalens/tasks/types"

// Moved from tasks/monthly-progress-card.tsx (deleted in A5) for Me (AL-2).

/**
 * What a needs-setup month is missing, and what counts so far. Shared with
 * Home's This month card.
 */
export function TargetSetup({ monthly }: { monthly: MonthlyProgress }) {
  const completion = monthly.completionProgress
  const count = completion?.total ?? monthly.accepted
  return (
    <div className="grid gap-1 text-body text-ink">
      {monthly.setupMissing.includes("target") ? (
        <p>Your target appears here once your manager sets it.</p>
      ) : null}
      {monthly.setupMissing.includes("team") ? (
        <p>
          Your team (FOH or BOH) isn&apos;t set yet, so this month can&apos;t be
          completed. Ask an admin to set it.
        </p>
      ) : null}
      <p className="text-meta text-ink-muted">
        {completion
          ? completionBreakdown(completion)
          : `${plural(count, "photo", "photos")} accepted so far.`}
      </p>
    </div>
  )
}

/**
 * The target line ("{n} of {target} completed/accepted"), its bar and what is
 * left. Shared with Home's This month card, so both say the same.
 */
export function TargetProgress({ monthly }: { monthly: MonthlyProgress }) {
  const target = monthly.targetCount
  const completion = monthly.completionProgress
  const count = completion?.total ?? monthly.accepted
  const unit = completion ? "completed" : "accepted"
  const remaining = target ? Math.max(0, target - count) : null
  // A target row without a number reads as a count alone: no bar, no "of".
  const hasTarget = typeof target === "number" && target > 0
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="type-count text-ink tabular-nums">{count}</span>
        <span className="type-section-title text-ink-muted">
          {" "}
          {hasTarget ? `of ${target} ${unit}` : unit}
        </span>
      </p>
      {hasTarget ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={Math.min(count, target)}
          aria-label={`${count} of ${target} ${completion ? "items completed" : "photos accepted"}`}
        >
          {/* Decision 13: accepted, waiting, needs another photo, to take. */}
          <div aria-hidden>
            <Progress
              mode="segments"
              aria-label="Photo progress"
              accepted={count}
              submitted={completion ? 0 : monthly.pending}
              needsAnother={completion ? 0 : monthly.needsAnotherPhoto}
              total={target}
            />
          </div>
        </div>
      ) : null}
      {remaining ? (
        <p className="text-body text-ink">
          {completion
            ? plural(remaining, "more completion", "more completions")
            : plural(remaining, "more photo", "more photos")}{" "}
          to go.
        </p>
      ) : null}
    </div>
  )
}

/**
 * This month's target. A missing target or incomplete profile shows
 * Needs setup and never reads as complete; overdue is shown for follow-up and
 * sending stays available.
 */

const LINK =
  "inline-flex min-h-12 w-fit items-center gap-1 rounded-control text-body font-bold text-ink underline underline-offset-3 focus-ring outline-none"

/**
 * Your month, one person's goal (v0.5 §1): the monthly target and how far
 * it has got, private to the person, their venue manager and admins. No due
 * date and no Overdue (rule 23); the month ends with the calendar month. G-2
 * replaces what it reads; the card takes the month as a prop.
 */
/**
 * The spec's two figures for the month (§6 S4; S2-STAFF): slots the
 * person's photos now fill in the album, and how many of those replaced an
 * outdated photo. Personal only, never compared (FA-34).
 */
export function replacementsLine(r: { covered: number; replaced: number }) {
  const slots = `${plural(r.covered, "slot", "slots")} in the album from your photos`
  return r.replaced > 0
    ? `${slots} · ${plural(r.replaced, "outdated photo", "outdated photos")} replaced`
    : slots
}

export function YourMonthCard({
  monthly,
  monthHref = "/staff/tasks/month",
  replacements = null,
}: {
  monthly: MonthlyProgress | null
  monthHref?: string
  /** This month's slots filled and outdated photos replaced, when read. */
  replacements?: { covered: number; replaced: number } | null
}) {
  const needsSetup = monthly?.status === "needs_setup"
  return (
    <section
      aria-labelledby="your-month-heading"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <CardHead>
        <h2
          id="your-month-heading"
          className="type-section-title [overflow-wrap:anywhere] text-ink"
        >
          {COPY.title}
        </h2>
        {needsSetup ? (
          <StatusChip state="needs_setup" />
        ) : monthly?.complete ? (
          <StatusChip state="target_met" />
        ) : null}
      </CardHead>
      <p className="text-meta text-ink-muted">{COPY.private}</p>

      {!monthly ? (
        <p className="text-body text-ink-muted">{COPY.noTarget}</p>
      ) : needsSetup ? (
        <TargetSetup monthly={monthly} />
      ) : (
        <TargetProgress monthly={monthly} />
      )}

      {replacements ? (
        <p className="text-body text-ink" data-slot="month-replacements">
          {replacementsLine(replacements)}
        </p>
      ) : null}

      <p className="max-w-reading text-meta text-ink-muted">{COPY.counts}</p>

      <Link href={monthHref} className={LINK}>
        {COPY.seeMonth}
        <CaretRightIcon aria-hidden weight="bold" className="size-5" />
      </Link>
    </section>
  )
}
