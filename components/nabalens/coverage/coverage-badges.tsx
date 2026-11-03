import { StatusChip, type ChipTone } from "../status-chip"

import {
  PRESENCE_LABEL,
  REQUIREMENT_STATUS_LABEL,
  SELF_REVIEW_COPY,
  SUBMISSION_STATE_LABEL,
  labelFor,
} from "./copy"
import type {
  AmenityPresence,
  RequirementStatus,
  SubmissionState,
} from "./types"

type Tone = "positive" | "warning" | "info" | "negative" | "muted" | "closed"

const CHIP_TONE: Record<Tone, ChipTone> = {
  positive: "positive",
  warning: "attention",
  info: "pending",
  negative: "negative",
  muted: "neutral",
  closed: "closed",
}

export function CoverageBadge({
  tone,
  children,
  className,
  title,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <StatusChip tone={CHIP_TONE[tone]} className={className} title={title}>
      {children}
    </StatusChip>
  )
}

export function RequirementStatusBadge({
  status,
  satisfied,
  className,
}: {
  status: RequirementStatus
  /** Active and enough accepted photos. */
  satisfied?: boolean
  className?: string
}) {
  if (status === "active" && satisfied) {
    return <StatusChip state="complete" className={className} />
  }
  return (
    <StatusChip state={status} className={className}>
      {labelFor(REQUIREMENT_STATUS_LABEL, status)}
    </StatusChip>
  )
}

export function SubmissionStateBadge({
  state,
  className,
}: {
  state: SubmissionState
  className?: string
}) {
  return (
    <StatusChip state={state} className={className}>
      {labelFor(SUBMISSION_STATE_LABEL, state)}
    </StatusChip>
  )
}

export function SelfReviewBadge({ className }: { className?: string }) {
  return (
    <StatusChip
      state="self_review"
      className={className}
      title={SELF_REVIEW_COPY}
    />
  )
}

export function OverdueBadge({ className }: { className?: string }) {
  return <StatusChip state="overdue" className={className} />
}

export function NeedsSetupBadge({ className }: { className?: string }) {
  return <StatusChip state="needs_setup" className={className} />
}

export function PresenceBadge({
  presence,
  className,
}: {
  presence: AmenityPresence
  className?: string
}) {
  return (
    <StatusChip state={presence} className={className}>
      {labelFor(PRESENCE_LABEL, presence)}
    </StatusChip>
  )
}
