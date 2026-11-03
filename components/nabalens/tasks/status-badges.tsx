import { cn } from "@/lib/utils"

import {
  StatusChip as SystemChip,
  type ChipStateKey,
  type ChipTone,
} from "../status-chip"

import { periodLabel, submissionStateLabel, type ReviewedState } from "./copy"
import type { DueView, PeriodKey, SubmissionState } from "./types"

type Tone = "info" | "positive" | "warning" | "negative" | "muted"

const CHIP_TONE: Record<Tone, ChipTone> = {
  info: "pending",
  positive: "positive",
  warning: "attention",
  negative: "negative",
  muted: "closed",
}

/** Words that have a fixed state key get its icon as well as its tone. */
const WORD_STATE: Record<string, ChipStateKey> = {
  "Needs setup": "needs_setup",
  "Target met": "target_met",
  Complete: "complete",
  "Needs another photo": "needs_another_photo",
  Overdue: "overdue",
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
  const state = typeof children === "string" ? WORD_STATE[children] : undefined
  return state ? (
    <SystemChip state={state} className={className} />
  ) : (
    <SystemChip tone={CHIP_TONE[tone]} className={className}>
      {children}
    </SystemChip>
  )
}

const STATE_TONE: Record<ReviewedState, Tone> = {
  submitted: "info",
  accepted: "positive",
  needs_another_photo: "warning",
}

/** Review state of one sent photo. Completion only; sharing is never gated. */
export function SubmissionStateChip({ state }: { state: SubmissionState }) {
  return Object.hasOwn(STATE_TONE, state) ? (
    <SystemChip state={state} />
  ) : (
    <SystemChip state="closed">{submissionStateLabel(state)}</SystemChip>
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
        "inline-flex flex-wrap items-center gap-1.5 text-body-touch md:text-body-sm",
        overdue ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {overdue ? <StatusChip tone="negative">Overdue</StatusChip> : null}
      <span>{due.label}</span>
    </span>
  )
}
