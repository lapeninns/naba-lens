import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr"

import { StatusChip } from "@/components/nabalens/status-chip"
import { dayLabel } from "@/lib/server/coverage/time"
import type { NeededBy } from "@/lib/server/coverage/types"

// G-7: a manager's "needed by" date on a still-needed dish (v0.5 rule 24).
// It is never Overdue: after the date the word is "Needed" and the chip keeps
// its quiet shape, never the Overdue square (DESIGN.md §3).
//
// Temporary copy: G-5 moves these words into the copy files (its "Needed by
// …" / "Needed" formatter, separate from dueView).

export const NEEDED_BY_COPY = {
  /** The heading over dishes with a date, which lead the list. */
  groupTitle: "Needed soon",
  label: (neededBy: NeededBy) =>
    neededBy.passed ? "Needed" : `Needed by ${dayLabel(neededBy.date)}`,
}

/** "Needed by 20 Nov 2026", or "Needed" once the date has passed. */
export function NeededByChip({ neededBy }: { neededBy: NeededBy }) {
  return (
    <StatusChip tone="neutral">
      <CalendarBlankIcon aria-hidden weight="bold" />
      {NEEDED_BY_COPY.label(neededBy)}
    </StatusChip>
  )
}
