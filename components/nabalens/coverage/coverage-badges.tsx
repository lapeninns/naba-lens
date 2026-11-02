import { cn } from "@/lib/utils"

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

const base =
  "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium"

type Tone = "positive" | "warning" | "info" | "negative" | "muted"

const TONE: Record<Tone, string> = {
  positive: "bg-positive-surface text-positive",
  warning: "bg-warning-surface text-warning",
  info: "bg-info-surface text-info",
  negative: "bg-negative-surface text-negative",
  muted: "bg-muted text-muted-foreground",
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
    <span className={cn(base, TONE[tone], className)} title={title}>
      {children}
    </span>
  )
}

/** String-keyed so a new service status still renders (neutral tone). */
type ToneMap = Readonly<Record<string, Tone>>

const toneFor = (map: ToneMap, key: string): Tone =>
  Object.hasOwn(map, key) ? map[key] : "muted"

const STATUS_TONE: ToneMap = {
  needs_setup: "warning",
  active: "info",
  not_applicable: "muted",
  retired: "muted",
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
    return (
      <CoverageBadge tone="positive" className={className}>
        Complete
      </CoverageBadge>
    )
  }
  return (
    <CoverageBadge tone={toneFor(STATUS_TONE, status)} className={className}>
      {labelFor(REQUIREMENT_STATUS_LABEL, status)}
    </CoverageBadge>
  )
}

const STATE_TONE: ToneMap = {
  submitted: "info",
  accepted: "positive",
  needs_another_photo: "warning",
}

export function SubmissionStateBadge({
  state,
  className,
}: {
  state: SubmissionState
  className?: string
}) {
  return (
    <CoverageBadge tone={toneFor(STATE_TONE, state)} className={className}>
      {labelFor(SUBMISSION_STATE_LABEL, state)}
    </CoverageBadge>
  )
}

export function SelfReviewBadge({ className }: { className?: string }) {
  return (
    <CoverageBadge
      tone="warning"
      className={className}
      title={SELF_REVIEW_COPY}
    >
      Self-review
    </CoverageBadge>
  )
}

export function OverdueBadge({ className }: { className?: string }) {
  return (
    <CoverageBadge tone="negative" className={className}>
      Overdue
    </CoverageBadge>
  )
}

export function NeedsSetupBadge({ className }: { className?: string }) {
  return (
    <CoverageBadge tone="warning" className={className}>
      Needs setup
    </CoverageBadge>
  )
}

const PRESENCE_TONE: ToneMap = {
  present: "positive",
  absent: "muted",
  unknown: "warning",
}

export function PresenceBadge({
  presence,
  className,
}: {
  presence: AmenityPresence
  className?: string
}) {
  return (
    <CoverageBadge
      tone={toneFor(PRESENCE_TONE, presence)}
      className={className}
    >
      {labelFor(PRESENCE_LABEL, presence)}
    </CoverageBadge>
  )
}
