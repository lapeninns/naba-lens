import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import { plural } from "./copy"
import { DueLine, StatusChip } from "./status-badges"
import type { MonthlyProgress } from "./types"

/**
 * This month's photo target. A missing target or incomplete profile shows
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
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  const label =
    (monthly?.period.label ?? periodLabel) +
    (showVenue && monthly ? ` at ${monthly.venue.name}` : "")
  const headingId = `monthly-${monthly?.period.key ?? "none"}-${monthly?.venue.id ?? "none"}`

  if (!monthly) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-2 rounded-xl border bg-card p-4"
      >
        <Heading id={headingId} className="text-base font-semibold">
          Your photos for {label}
        </Heading>
        <p className="text-meta-touch text-ink-muted md:text-meta">
          There&apos;s no photo target for you this month.
        </p>
      </section>
    )
  }

  const needsSetup = monthly.status === "needs_setup"
  const target = monthly.targetCount
  const percent =
    !needsSetup && target ? Math.min(100, (monthly.accepted / target) * 100) : 0
  const remaining = target ? Math.max(0, target - monthly.accepted) : null

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Heading id={headingId} className="text-base font-semibold">
          Your photos for {label}
        </Heading>
        {needsSetup ? (
          <StatusChip tone="warning">Needs setup</StatusChip>
        ) : monthly.complete ? (
          <StatusChip tone="positive">Target met</StatusChip>
        ) : null}
      </div>

      {needsSetup ? (
        <div className="flex flex-col gap-1 text-body-touch md:text-body-sm">
          {monthly.setupMissing.includes("target") ? (
            <p>Your target appears here once your manager sets it.</p>
          ) : null}
          {monthly.setupMissing.includes("team") ? (
            <p>
              Your team (FOH or BOH) isn&apos;t set yet, so this month
              can&apos;t be completed. Ask an admin to set it.
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {plural(monthly.accepted, "photo", "photos")} accepted so far.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-semibold tabular-nums">
            {monthly.accepted}
            <span className="text-base font-normal text-muted-foreground">
              {" "}
              of {target} accepted
            </span>
          </p>
          <Progress
            value={percent}
            aria-label={`${monthly.accepted} of ${target} photos accepted`}
          />
          {remaining ? (
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {plural(remaining, "more photo", "more photos")} to go.
            </p>
          ) : null}
        </div>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta-touch text-ink-muted md:text-meta">
        <li>{monthly.pending} waiting for review</li>
        {monthly.needsAnotherPhoto > 0 ? (
          <li className="text-foreground">
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

      {monthly.due ? (
        <div className="flex flex-col gap-1">
          <DueLine due={monthly.due} done={monthly.complete} />
          {monthly.due.overdue && !monthly.complete ? (
            <p className="text-meta-touch text-ink-muted md:text-meta">
              You can still send photos.
            </p>
          ) : null}
        </div>
      ) : null}

      {addHref ? (
        <Link
          href={addHref}
          className={buttonVariants({
            variant: "outline",
            size: "touch",
            className: "self-start",
          })}
        >
          {canSubmit ? (
            <>
              <PlusIcon data-icon="inline-start" aria-hidden />
              Add photos for this month
            </>
          ) : (
            "See this month's photos"
          )}
        </Link>
      ) : null}
    </section>
  )
}
