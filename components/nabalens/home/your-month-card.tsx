import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { CardHead } from "../common-room"
import { StatusChip } from "../status-chip"
import { TargetProgress, TargetSetup } from "../tasks/monthly-progress-card"
import type { MonthlyProgress } from "../tasks/types"

const LINK =
  "inline-flex min-h-11 w-fit items-center gap-1 rounded-control text-body font-bold text-ink underline underline-offset-3 focus-ring outline-none"

// TEMP copy (G-1): G-5 moves these into the copy files.
const COPY = {
  title: "Your month",
  private: "Only you, your manager and admins see this.",
  noTarget: "There's no photo target for you this month.",
  seeMonth: "See your month",
} as const

/**
 * Your month, one person's goal (v0.5 §1): the monthly target and how far
 * it has got, private to the person, their venue manager and admins. No due
 * date and no Overdue (rule 23); the month ends with the calendar month. G-2
 * replaces what it reads; the card takes the month as a prop.
 */
export function YourMonthCard({
  monthly,
  monthHref = "/staff/tasks/month",
}: {
  monthly: MonthlyProgress | null
  monthHref?: string
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

      <Link href={monthHref} className={LINK}>
        {COPY.seeMonth}
        <CaretRightIcon aria-hidden weight="bold" className="size-5" />
      </Link>
    </section>
  )
}
