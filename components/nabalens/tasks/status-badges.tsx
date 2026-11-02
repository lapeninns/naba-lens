import { cn } from "@/lib/utils"

import { periodLabel, submissionStateLabel, type ReviewedState } from "./copy"
import type { DueView, PeriodKey, SubmissionState } from "./types"

type Tone = "info" | "positive" | "warning" | "negative" | "muted"

const TONE: Record<Tone, string> = {
  info: "bg-info-surface text-info",
  positive: "bg-positive-surface text-positive",
  warning: "bg-warning-surface text-warning",
  negative: "bg-negative-surface text-negative",
  muted: "bg-muted text-muted-foreground",
}

/** Small status chip. The text carries the meaning; colour only repeats it. */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded-sm px-1.5 text-xs font-medium",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

const STATE_TONE: Record<ReviewedState, Tone> = {
  submitted: "info",
  accepted: "positive",
  needs_another_photo: "warning",
}

/** Review state of one sent photo. Completion only; sharing is never gated. */
export function SubmissionStateChip({ state }: { state: SubmissionState }) {
  return (
    <StatusChip tone={STATE_TONE[state as ReviewedState] ?? "muted"}>
      {submissionStateLabel(state)}
    </StatusChip>
  )
}

/** Accepted after its month ended; it still counts for the month it was sent. */
export function LateAcceptanceChip({ period }: { period: PeriodKey }) {
  return (
    <StatusChip tone="muted">
      Accepted late · counts for {periodLabel(period)}
    </StatusChip>
  )
}

/** Due date, with an Overdue chip. Overdue is for follow-up and never blocks. */
export function DueLine({
  due,
  done = false,
  className,
}: {
  due: DueView
  /** Hide the overdue state once the work is complete. */
  done?: boolean
  className?: string
}) {
  const overdue = due.overdue && !done
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 text-sm",
        overdue ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {overdue ? <StatusChip tone="negative">Overdue</StatusChip> : null}
      <span>{due.label}</span>
    </span>
  )
}
