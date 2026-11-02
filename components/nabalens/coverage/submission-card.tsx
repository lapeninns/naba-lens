"use client"

import { formatDateTime } from "@/components/nabalens/menus/copy"
import { cn } from "@/lib/utils"

import {
  SELF_REVIEW_PENDING_COPY,
  SUBMISSION_ORIGIN_LABEL,
  labelFor,
} from "./copy"
import {
  CoverageBadge,
  SelfReviewBadge,
  SubmissionStateBadge,
} from "./coverage-badges"
import { EvidencePreviewButton } from "./evidence-image"
import type { SubmissionView } from "./types"

/** True when the viewer took the photo (reviewing it is a self-review). */
export function isOwnPhoto(submission: SubmissionView, viewerId: string) {
  return submission.author.id === viewerId
}

function monthlyText(submission: SubmissionView): string {
  if (submission.countsTowardMonthly) {
    return "Counts toward the photographer’s monthly target once accepted"
  }
  if (submission.origin === "submitted") {
    return "Venue coverage only (uploaded in an earlier month)"
  }
  return `${labelFor(SUBMISSION_ORIGIN_LABEL, submission.origin)}: venue coverage only`
}

/** One submitted photo with who took it, what it is for and its decision. */
export function SubmissionCard({
  submission,
  viewerId,
  actions,
  footer,
  className,
}: {
  submission: SubmissionView
  viewerId: string
  actions?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const { author, decision } = submission
  const own = isOwnPhoto(submission, viewerId)
  const purpose = submission.requirement
    ? (submission.requirement.title ?? "Checklist item")
    : "Monthly photo"
  const decidedBy = decision
    ? decision.decidedBy.id === viewerId
      ? "you"
      : (decision.decidedBy.displayName ?? "a reviewer")
    : null
  return (
    <article
      aria-label={`${purpose}: photo by ${author.displayName}`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-3",
        className
      )}
    >
      <EvidencePreviewButton
        thumbnailUrl={
          submission.asset.available ? submission.asset.thumbnailUrl : null
        }
        previewUrl={
          submission.asset.available ? submission.asset.previewUrl : null
        }
        label={`Photo by ${author.displayName}`}
        description={purpose}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <SubmissionStateBadge state={submission.state} />
        {decision?.selfReview ? <SelfReviewBadge /> : null}
        {submission.origin !== "submitted" ? (
          <CoverageBadge tone="muted">
            {submission.origin === "attached" ? "Attached" : "Carried over"}
          </CoverageBadge>
        ) : null}
        {!submission.asset.available ? (
          <CoverageBadge tone="negative">Photo removed</CoverageBadge>
        ) : null}
        {decision?.lateAcceptance ? (
          <CoverageBadge tone="muted">Accepted late</CoverageBadge>
        ) : null}
        {submission.archived ? (
          <CoverageBadge tone="muted">History</CoverageBadge>
        ) : null}
      </div>
      <div className="grid gap-1">
        <p className="font-medium break-words">{purpose}</p>
        <p className="text-sm break-words">
          {author.displayName}
          {own ? " (you)" : null}
          {!author.active ? (
            <span className="text-muted-foreground"> · no longer active</span>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">
          Submitted {formatDateTime(submission.submittedAt)}
          {submission.origin === "attached" &&
          submission.submittedById === viewerId
            ? " by you"
            : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {monthlyText(submission)}
        </p>
        {decision ? (
          <p className="text-sm">
            {decision.decision === "accept"
              ? "Accepted"
              : "Needs another photo"}{" "}
            by {decidedBy}, {formatDateTime(decision.decidedAt)}
            {decision.reason ? (
              <span className="block text-muted-foreground">
                Reason: {decision.reason}
              </span>
            ) : null}
          </p>
        ) : null}
        {own && submission.state === "submitted" ? (
          <p className="text-sm text-warning">{SELF_REVIEW_PENDING_COPY}</p>
        ) : null}
      </div>
      {actions ? <div className="mt-auto grid gap-2">{actions}</div> : null}
      {footer}
    </article>
  )
}
