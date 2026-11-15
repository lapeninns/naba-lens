import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr"

import { StatusChip } from "@/components/nabalens/status-chip"
import type { NeededBy } from "@/lib/server/coverage/types"

import { NEEDED_BY_COPY } from "./copy"

// G-7: a manager's "needed by" date on a still-needed dish (v0.5 rule 24).
// It is never Overdue: after the date the word is "Needed" and the chip keeps
// its quiet shape, never the Overdue square (DESIGN.md §3).

export { NEEDED_BY_COPY }

/** "Needed by 20 Nov 2026", or "Needed" once the date has passed. */
export function NeededByChip({ neededBy }: { neededBy: NeededBy }) {
  return (
    <StatusChip tone="neutral">
      <CalendarBlankIcon aria-hidden weight="bold" />
      {NEEDED_BY_COPY.label(neededBy)}
    </StatusChip>
  )
}
