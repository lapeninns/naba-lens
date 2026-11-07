import { cn } from "@/lib/utils"

import { formatDate } from "../format"
import { EvidenceThumb } from "./evidence-thumb"
import {
  LateAcceptanceChip,
  StatusChip,
  SubmissionStateChip,
} from "./status-badges"
import type { SubmissionView } from "./types"

/** The reviewer's reason for asking for another photo (the photo's caption). */
export function ReviewReason({ reason }: { reason: string | null }) {
  if (!reason) return null
  return (
    <div className="rounded-control bg-warn-bg px-3 py-2.5 text-body text-ink shadow-[inset_4px_0_0_var(--warn-fg)]">
      <span className="font-bold">Reason: </span>
      <span className="break-words whitespace-pre-line">{reason}</span>
    </div>
  )
}

/** "Reviewed by Sam on 3 Nov 2026" (the name is omitted when not visible). */
export function decisionText(
  decision: NonNullable<SubmissionView["decision"]>
): string {
  const verb = decision.decision === "accept" ? "Accepted" : "Reviewed"
  const by = decision.decidedBy.displayName
    ? ` by ${decision.decidedBy.displayName}`
    : ""
  return `${verb}${by} on ${formatDate(decision.decidedAt)}`
}

/** What the photo was sent for: its task, or this month's photos. */
export function submissionTitle(submission: SubmissionView): string {
  if (!submission.requirement) return "Monthly photo"
  return submission.requirement.title ?? "Task"
}

const ORIGIN_NOTE: Partial<Record<SubmissionView["origin"], string>> = {
  attached: "Added to this task by a manager",
  reconciled: "Carried over from an earlier menu",
}

type SubmissionVariant = "row" | "post"

/** One sent photo with its review state, reason and markers. */
export function SubmissionRow({
  submission,
  showTask = false,
  variant = "row",
}: {
  submission: SubmissionView
  /** Name the task (or "Monthly photo") the photo was sent to. */
  showTask?: boolean
  /**
   * `row`: a 64px thumbnail row in a list card (Monthly photos).
   * `post`: the photo edge to edge as a post in the task thread.
   */
  variant?: SubmissionVariant
}) {
  const sentOn = formatDate(submission.submittedAt)
  const title = submissionTitle(submission)
  const originNote = ORIGIN_NOTE[submission.origin]
  const post = variant === "post"
  const chips = (
    <span className="flex flex-wrap items-center gap-1.5">
      <SubmissionStateChip state={submission.state} />
      {submission.decision?.lateAcceptance ? (
        <LateAcceptanceChip period={submission.period} />
      ) : null}
      {!submission.asset.available ? (
        <StatusChip tone="negative">Photo removed</StatusChip>
      ) : null}
      {submission.archived ? (
        <StatusChip tone="muted">Task closed</StatusChip>
      ) : null}
    </span>
  )
  const lines = (
    <>
      {showTask ? (
        <p className="text-item-title [overflow-wrap:anywhere] text-ink">
          {title}
        </p>
      ) : null}
      <p className="text-meta text-ink-muted">
        {originNote ? `${originNote} on ${sentOn}` : `Sent ${sentOn}`}
      </p>
      {submission.state === "needs_another_photo" ? (
        <ReviewReason reason={submission.decision?.reason ?? null} />
      ) : null}
      {submission.decision ? (
        <p className="text-meta text-ink-muted">
          {decisionText(submission.decision)}
        </p>
      ) : null}
      {!submission.countsTowardMonthly ? (
        <p className="text-meta text-ink-muted">
          Counts for the task only, not your monthly target.
        </p>
      ) : null}
    </>
  )
  const label = `${showTask ? `${title}: photo` : "Photo"} sent ${sentOn}`

  if (post) {
    // Waiting photos get the full 4:3 frame; decided ones are shorter (16:9).
    const waiting = submission.state === "submitted"
    return (
      <li className="grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card">
        <EvidenceThumb
          thumbnailUrl={submission.asset.thumbnailUrl}
          previewUrl={submission.asset.previewUrl}
          label={label}
          className={cn(
            "w-full rounded-none",
            waiting ? "aspect-[4/3]" : "aspect-video"
          )}
        />
        <div className="grid min-w-0 gap-1.5 p-3">
          {chips}
          {lines}
        </div>
      </li>
    )
  }

  return (
    <li className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3">
      <EvidenceThumb
        thumbnailUrl={submission.asset.thumbnailUrl}
        previewUrl={submission.asset.previewUrl}
        label={label}
        className="size-16 rounded-control sm:size-20"
      />
      <div className="flex min-w-0 flex-col gap-1">
        {lines}
        <span className="mt-0.5">{chips}</span>
      </div>
    </li>
  )
}

export function SubmissionList({
  submissions,
  label,
  showTask = false,
  empty,
  variant = "row",
}: {
  submissions: SubmissionView[]
  /** Accessible name of the list. */
  label: string
  showTask?: boolean
  empty: React.ReactNode
  /** `row` (one list card) or `post` (one card per photo, the task thread). */
  variant?: SubmissionVariant
}) {
  if (submissions.length === 0) {
    return (
      <p className="rounded-card bg-surface p-4 text-body text-ink-muted shadow-card">
        {empty}
      </p>
    )
  }
  return (
    <ul
      aria-label={label}
      className={
        variant === "post"
          ? "grid gap-(--gutter)"
          : "grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
      }
    >
      {submissions.map((submission) => (
        <SubmissionRow
          key={submission.id}
          submission={submission}
          showTask={showTask}
          variant={variant}
        />
      ))}
    </ul>
  )
}
