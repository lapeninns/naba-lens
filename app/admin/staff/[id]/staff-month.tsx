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
          "flex overflow-hidden rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]",
          compact ? "h-2" : "h-3"
        )}
      >
        <span
          className="bg-ok-fg"
          style={{ width: `${(filled / target) * 100}%` }}
        />
        {pending > 0 ? (
          <span
            className="bg-stripe"
            style={{ width: `${(pending / target) * 100}%` }}
          />
        ) : null}
      </div>
    )
  }
  return (
    <ol aria-hidden className="flex gap-1">
      {Array.from({ length: target }, (_, index) => (
        <li
          key={index}
          className={cn(
            "flex-1 rounded-round",
            compact ? "h-2 max-w-5.5" : "h-3 max-w-14",
            index < filled
              ? "bg-ok-fg"
              : index < filled + pending
                ? "bg-stripe"
                : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
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
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={headingId} className="font-display text-section-title text-ink">
          {inactive
            ? `${monthly.period.label} at ${monthly.venue.name}`
            : `${firstName}'s month`}
        </h2>
        {inactive ? null : (
          <span className="font-mono text-meta text-ink-muted">
            {monthly.period.label}
          </span>
        )}
      </div>
      <div className={cn("grid min-w-0", inactive ? "gap-1.5" : "gap-2")}>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              "tabular-nums",
              inactive ? "text-label" : "font-display text-count"
            )}
          >
            {monthly.accepted}
          </span>
          <span className="text-lead font-bold text-ink-muted">
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
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="inline-block h-2.5 w-[22px] rounded-round bg-stripe"
              />
              {monthly.pending} waiting for review
            </span>
            {target && !needsSetup ? (
              <span className="inline-flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="inline-block h-2.5 w-[22px] rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
                />
                {toTake} to take
              </span>
            ) : null}
          </p>
        )}
      </div>
      <p className="text-body text-ink-muted">
        {inactive
          ? `${firstName}'s open assignments closed on deactivation; those items show Needs reassignment.`
          : `Counts only ${firstName}'s photos at ${monthly.venue.name} this UK month. It's never added to the venue's checklist.`}
      </p>
    </section>
  )
}
