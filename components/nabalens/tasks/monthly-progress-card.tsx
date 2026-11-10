import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"

import { CardFoot, CardHead } from "../common-room"
import { pendingLines } from "../knowledge/copy"
import { completionBreakdown, plural } from "./copy"
import { PhotoSegments } from "./month-card"
import { DueLine, StatusChip } from "./status-badges"
import type { MonthlyProgress } from "./types"

/**
 * This month's target. A missing target or incomplete profile shows
 * Needs setup and never reads as complete; overdue is shown for follow-up and
 * sending stays available.
 */
export function MonthlyProgressCard({
  monthly,
  periodLabel,
  addHref,
  canSubmit,
  headingLevel = 2,
  showVenue = false,
  alsoPending = null,
}: {
  monthly: MonthlyProgress | null
  /** Shown when there is no target row ("November 2026"). */
  periodLabel: string
  /** Link to send monthly photos, or null to hide it (past months). */
  addHref: string | null
  canSubmit: boolean
  headingLevel?: 2 | 3
  /** Name the venue (a month spanning a transfer has one card per venue). */
  showVenue?: boolean
  /**
   * Amenity findings this month outside the target number (S14): waiting
   * for confirmation, or recorded as Couldn't establish. Nothing at zero.
   */
  alsoPending?: { awaitingConfirmation: number; unknownRecorded: number } | null
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  const label =
    (monthly?.period.label ?? periodLabel) +
    (showVenue && monthly ? ` at ${monthly.venue.name}` : "")
  const headingId = `monthly-${monthly?.period.key ?? "none"}-${monthly?.venue.id ?? "none"}`
  const also = pendingLines(alsoPending)
  const alsoLines =
    also.length > 0 ? (
      // Separate from the bar and its number: these aren't counted.
      <div className="grid gap-1 border-t border-line pt-3 text-meta text-ink-muted">
        {also.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    ) : null

  if (!monthly) {
    return (
      <section
        aria-labelledby={headingId}
        className="grid min-w-0 gap-2 rounded-card bg-surface p-4 shadow-card"
      >
        <Heading
          id={headingId}
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          Your photos for {label}
        </Heading>
        <p className="text-body text-ink-muted">
          There&apos;s no photo target for you this month.
        </p>
        {alsoLines}
      </section>
    )
  }

  const needsSetup = monthly.status === "needs_setup"
  const target = monthly.targetCount
  const completion = monthly.completionProgress
  const count = completion?.total ?? monthly.accepted
  const unit = completion ? "completed" : "accepted"
  const remaining = target ? Math.max(0, target - count) : null
  // A target row without a number reads as a count alone: no bar, no "of".
  const hasTarget = typeof target === "number" && target > 0

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <CardHead>
        <Heading
          id={headingId}
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          {completion ? "Your target for" : "Your photos for"} {label}
        </Heading>
        {needsSetup ? (
          <StatusChip tone="warning">Needs setup</StatusChip>
        ) : monthly.complete ? (
          <StatusChip tone="positive">Target met</StatusChip>
        ) : null}
      </CardHead>

      {needsSetup ? (
        <div className="grid gap-1 text-body text-ink">
          {monthly.setupMissing.includes("target") ? (
            <p>Your target appears here once your manager sets it.</p>
          ) : null}
          {monthly.setupMissing.includes("team") ? (
            <p>
              Your team (FOH or BOH) isn&apos;t set yet, so this month
              can&apos;t be completed. Ask an admin to set it.
            </p>
          ) : null}
          <p className="text-meta text-ink-muted">
            {completion
              ? completionBreakdown(completion)
              : `${plural(count, "photo", "photos")} accepted so far.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-count text-ink tabular-nums">
              {count}
            </span>
            <span className="font-display text-section-title text-ink-muted">
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
              <PhotoSegments
                accepted={count}
                pending={completion ? 0 : monthly.pending}
                target={target}
              />
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
      )}

      {completion ? (
        !needsSetup && (
          <p className="text-meta text-ink-muted">
            {completionBreakdown(completion)}
          </p>
        )
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted">
          <li>{monthly.pending} waiting for review</li>
          {monthly.needsAnotherPhoto > 0 ? (
            <li className="font-semibold text-ink">
              {plural(monthly.needsAnotherPhoto, "photo needs", "photos need")}{" "}
              replacing
            </li>
          ) : null}
          {monthly.lateAcceptances > 0 ? (
            <li>
              {plural(
                monthly.lateAcceptances,
                "late acceptance",
                "late acceptances"
              )}{" "}
              included
            </li>
          ) : null}
          {monthly.evidenceRemoved > 0 ? (
            <li>
              {plural(
                monthly.evidenceRemoved,
                "accepted photo",
                "accepted photos"
              )}{" "}
              later removed (still counted)
            </li>
          ) : null}
        </ul>
      )}

      {alsoLines}

      {monthly.due ? (
        <div className="grid gap-1">
          <DueLine due={monthly.due} done={monthly.complete} />
          {!completion && monthly.due.overdue && !monthly.complete ? (
            <p className="text-meta text-ink-muted">
              You can still send photos.
            </p>
          ) : null}
        </div>
      ) : null}

      {addHref ? (
        <CardFoot>
          <Link
            href={addHref}
            className={buttonVariants({
              variant: "secondary",
              size: "touch",
              className: "w-full sm:w-auto",
            })}
          >
            {completion ? (
              "See this month's target"
            ) : canSubmit ? (
              <>
                <PlusIcon data-icon="inline-start" aria-hidden />
                Add photos for this month
              </>
            ) : (
              "See this month's photos"
            )}
          </Link>
        </CardFoot>
      ) : null}
    </section>
  )
}
