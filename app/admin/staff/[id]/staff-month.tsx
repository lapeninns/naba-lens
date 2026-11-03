import { StatusChip } from "@/components/nabalens/status-chip"
import type { MonthlyProgress } from "@/lib/server/coverage/types"
import { cn } from "@/lib/utils"

/** Above this many, the strip becomes one bar with the same encoding. */
const MAX_FRAMES = 24

function Frames({
  target,
  accepted,
  waiting,
  compact,
}: {
  target: number
  accepted: number
  waiting: number
  compact: boolean
}) {
  const filled = Math.min(accepted, target)
  const pending = Math.min(waiting, target - filled)
  if (target > MAX_FRAMES) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex overflow-hidden rounded-print border border-line-control",
          compact ? "h-2" : "h-3"
        )}
      >
        <span
          className="bg-positive-fill"
          style={{ width: `${(filled / target) * 100}%` }}
        />
        <span
          className="border-2 border-dashed border-ink-muted"
          style={{ width: `${(pending / target) * 100}%` }}
        />
      </div>
    )
  }
  return (
    <ol aria-hidden className="flex gap-1">
      {Array.from({ length: target }, (_, index) => (
        <li
          key={index}
          className={cn(
            "flex-1 rounded-print border border-line-control",
            compact ? "h-2 max-w-5.5" : "h-3 max-w-14",
            index < filled && "border-positive-fill bg-positive-fill",
            index >= filled &&
              index < filled + pending &&
              "border-2 border-dashed border-ink-muted"
          )}
        />
      ))}
    </ol>
  )
}

/**
 * One person's photo target for the month at their venue, as on A7: counted
 * apart from the venue's checklist. Inactive accounts get the compact form
 * and the note that deactivation closed their assignments.
 */
export function StaffMonth({
  monthly,
  firstName,
  inactive,
}: {
  monthly: MonthlyProgress
  firstName: string
  inactive: boolean
}) {
  const target = monthly.targetCount
  const needsSetup = monthly.status === "needs_setup" || !target
  const toTake = target
    ? Math.max(0, target - monthly.accepted - monthly.pending)
    : 0
  const headingId = `month-${monthly.period.key}`

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={headingId}
          className="text-section-title-touch text-ink md:text-section-title"
        >
          {inactive
            ? `${monthly.period.label} at ${monthly.venue.name}`
            : `${firstName}'s month`}
        </h2>
        {inactive ? null : (
          <span className="text-meta-touch text-ink-muted md:text-meta">
            {monthly.period.label}
          </span>
        )}
      </div>
      <div className={cn("grid min-w-0", inactive ? "gap-1.5" : "gap-2")}>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              "tabular-nums",
              inactive
                ? "text-label-touch md:text-label"
                : "font-display text-count-touch md:text-count"
            )}
          >
            {monthly.accepted}
          </span>
          <span className="text-body-touch text-ink-muted md:text-body">
            {needsSetup ? "accepted" : `of ${target} accepted`}
          </span>
          {needsSetup ? (
            <StatusChip state="needs_setup" className="self-center" />
          ) : null}
        </p>
        {target && !needsSetup ? (
          <Frames
            target={target}
            accepted={monthly.accepted}
            waiting={monthly.pending}
            compact={inactive}
          />
        ) : null}
        {inactive ? null : (
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-meta-touch text-ink-muted tabular-nums md:text-meta">
            <span className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="inline-block h-2 w-3.5 rounded-print border-2 border-dashed border-ink-muted"
              />
              {monthly.pending} waiting for review
            </span>
            {target && !needsSetup ? (
              <span className="inline-flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="inline-block h-2 w-3.5 rounded-print border border-line-control"
                />
                {toTake} to take
              </span>
            ) : null}
          </p>
        )}
      </div>
      <p className="text-body-touch text-ink-muted md:text-body-sm">
        {inactive
          ? `${firstName}'s open assignments closed on deactivation; those items show Needs reassignment.`
          : `Counts only ${firstName}'s photos at ${monthly.venue.name} this UK month. It's never added to the venue's checklist.`}
      </p>
    </section>
  )
}
