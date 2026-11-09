import { Card } from "@/components/nabalens/common-room"
import { Frames } from "@/components/nabalens/coverage/layout"
import { StatusChip } from "@/components/nabalens/status-chip"
import { completionBreakdown } from "@/components/nabalens/tasks/copy"
import type { MonthlyProgress } from "@/lib/server/coverage/types"

export function TeamCompletionTargets({
  roster,
}: {
  roster: MonthlyProgress[]
}) {
  if (!roster.length) return null
  return (
    <section
      aria-labelledby="team-completion-targets"
      className="grid gap-(--gutter)"
    >
      <div className="grid gap-1 px-1">
        <h2
          id="team-completion-targets"
          className="font-display text-section-title text-ink"
        >
          Staff targets for {roster[0].period.label}
        </h2>
        <p className="text-body text-ink-muted">
          Each accepted menu item and completed amenity check counts once.
        </p>
      </div>
      <Card>
        <ul className="grid divide-y divide-line">
          {roster.map(
            ({ person, completionProgress, targetCount, complete, status }) =>
              completionProgress && targetCount != null ? (
                <li
                  key={person.id}
                  className="grid gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <p className="text-item-title [overflow-wrap:anywhere] text-ink">
                    {person.displayName}
                  </p>
                  <Frames
                    compact
                    accepted={completionProgress.total}
                    target={targetCount}
                    verb="completed"
                    chip={
                      status === "needs_setup" ? (
                        <StatusChip state="needs_setup" />
                      ) : complete ? (
                        <StatusChip state="target_met" />
                      ) : null
                    }
                  />
                  <p className="text-meta text-ink-muted">
                    {completionBreakdown(completionProgress)}
                  </p>
                </li>
              ) : null
          )}
        </ul>
      </Card>
    </section>
  )
}
