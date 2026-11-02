import { formatDate } from "../format"
import { EvidenceThumb } from "./evidence-thumb"
import {
  LateAcceptanceChip,
  StatusChip,
  SubmissionStateChip,
} from "./status-badges"
import type { SubmissionView } from "./types"

/** The reviewer's reason for asking for another photo. */
export function ReviewReason({ reason }: { reason: string | null }) {
  if (!reason) return null
  return (
    <div className="rounded-md border-l-4 border-warning bg-warning-surface px-3 py-2 text-sm">
      <span className="font-medium">Reason: </span>
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

/** One sent photo with its review state, reason and markers. */
export function SubmissionRow({
  submission,
  showTask = false,
}: {
  submission: SubmissionView
  /** Name the task (or "Monthly photo") the photo was sent to. */
  showTask?: boolean
}) {
  const sentOn = formatDate(submission.submittedAt)
  const title = submissionTitle(submission)
  const originNote = ORIGIN_NOTE[submission.origin]
  return (
    <li className="flex gap-3 py-3">
      <EvidenceThumb
        thumbnailUrl={submission.asset.thumbnailUrl}
        previewUrl={submission.asset.previewUrl}
        label={`${showTask ? `${title}: photo` : "Photo"} sent ${sentOn}`}
        className="size-20 sm:size-24"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
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
        </div>
        {showTask ? <p className="font-medium break-words">{title}</p> : null}
        <p className="text-sm text-muted-foreground">
          {originNote ? `${originNote} on ${sentOn}` : `Sent ${sentOn}`}
        </p>
        {submission.state === "needs_another_photo" ? (
          <ReviewReason reason={submission.decision?.reason ?? null} />
        ) : null}
        {submission.decision ? (
          <p className="text-sm text-muted-foreground">
            {decisionText(submission.decision)}
          </p>
        ) : null}
        {!submission.countsTowardMonthly ? (
          <p className="text-sm text-muted-foreground">
            Counts for the task only, not your monthly target.
          </p>
        ) : null}
      </div>
    </li>
  )
}

export function SubmissionList({
  submissions,
  label,
  showTask = false,
  empty,
}: {
  submissions: SubmissionView[]
  /** Accessible name of the list. */
  label: string
  showTask?: boolean
  empty: React.ReactNode
}) {
  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <ul aria-label={label} className="-my-3 divide-y">
      {submissions.map((submission) => (
        <SubmissionRow
          key={submission.id}
          submission={submission}
          showTask={showTask}
        />
      ))}
    </ul>
  )
}
