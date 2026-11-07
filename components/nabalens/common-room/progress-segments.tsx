import { cn } from "@/lib/utils"

type ProgressSegmentsProps = {
  /** Photos accepted (green segments). */
  accepted: number
  /** Photos sent and waiting for a decision (striped segments). */
  submitted?: number
  /** Photos needed in all; the rest are grey. */
  target: number
  /**
   * The words that always go with the bar, from the area's copy (for
   * example "3 of 5 accepted"). Required: the bar is never colour alone.
   */
  label: React.ReactNode
  /**
   * Key words for the segment kinds, from the area's copy. Shown as a key
   * under the bar when given; pass only the kinds that appear.
   */
  keyLabels?: { accepted?: string; submitted?: string; needed?: string }
  className?: string
}

/**
 * Progress as one rounded segment per photo (DESIGN.md §4): green accepted,
 * striped submitted, grey still needed, always paired with the words. Blue
 * never marks progress. Above 12 photos the segments merge into a bar.
 */
export function ProgressSegments({
  accepted,
  submitted = 0,
  target,
  label,
  keyLabels,
  className,
}: ProgressSegmentsProps) {
  const total = Math.max(0, Math.floor(target))
  const ok = Math.min(Math.max(0, accepted), total)
  const sent = Math.min(Math.max(0, submitted), total - ok)
  const segmented = total > 0 && total <= 12
  return (
    <div data-slot="cr-progress" className={cn("grid gap-2", className)}>
      <p className="font-mono text-meta-strong text-ink tabular-nums">
        {label}
      </p>
      {segmented ? (
        <div
          aria-hidden
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: total }, (_, index) => (
            <i
              key={index}
              className={cn(
                "block h-3 rounded-round",
                index < ok
                  ? "bg-ok-fg"
                  : index < ok + sent
                    ? "bg-stripe"
                    : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
              )}
            />
          ))}
        </div>
      ) : (
        <div
          aria-hidden
          className="flex h-3 overflow-hidden rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
        >
          <i
            className="block bg-ok-fg"
            style={{ width: total ? `${(ok / total) * 100}%` : 0 }}
          />
          <i
            className="block bg-stripe"
            style={{ width: total ? `${(sent / total) * 100}%` : 0 }}
          />
        </div>
      )}
      {keyLabels ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted">
          {keyLabels.accepted ? (
            <span className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="block h-2.5 w-[22px] rounded-round bg-ok-fg"
              />
              {keyLabels.accepted}
            </span>
          ) : null}
          {keyLabels.submitted ? (
            <span className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="block h-2.5 w-[22px] rounded-round bg-stripe"
              />
              {keyLabels.submitted}
            </span>
          ) : null}
          {keyLabels.needed ? (
            <span className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="block h-2.5 w-[22px] rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
              />
              {keyLabels.needed}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
