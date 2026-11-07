"use client"

import { CheckIcon } from "@phosphor-icons/react"

import { Post } from "@/components/nabalens/common-room"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Notice } from "@/components/nabalens/notice"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { StatusChip } from "@/components/nabalens/status-chip"

import { SELF_REVIEW_PENDING_COPY, periodKeyLabel } from "./copy"
import {
  CoverageBadge,
  SelfReviewBadge,
  SubmissionStateBadge,
} from "./coverage-badges"
import { EvidencePreviewButton } from "./evidence-image"
import { Quote } from "./layout"
import type { PeriodKey, SubmissionView } from "./types"

/** True when the viewer took the photo (reviewing it is a self-review). */
export function isOwnPhoto(submission: SubmissionView, viewerId: string) {
  return submission.author.id === viewerId
}

/** First name for running text: "Priya" for "Priya Gurung". */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName
}

/** "Priya's" or "your", for "…'s November target". */
function ownerOf(submission: SubmissionView, viewerId: string): string {
  return isOwnPhoto(submission, viewerId)
    ? "your"
    : `${firstName(submission.author.displayName)}'s`
}

function countsText(
  submission: SubmissionView,
  viewerId: string,
  currentPeriod: PeriodKey | undefined
): string {
  const periodLabel = periodKeyLabel(submission.period)
  if (currentPeriod && submission.period < currentPeriod) {
    const month = periodLabel.split(" ")[0]
    return `Sent in ${month}, so it counts for ${periodLabel} if accepted.`
  }
  if (submission.countsTowardMonthly) {
    const target = `${ownerOf(submission, viewerId)} ${periodLabel.split(" ")[0]} target`
    return submission.requirement
      ? `Counts toward the task and ${target} once accepted.`
      : `Counts toward ${target} once accepted.`
  }
  if (submission.origin === "attached") {
    return "Attached by a manager: counts toward the task only."
  }
  if (submission.origin === "reconciled") {
    return "Carried over from the previous menu: counts toward the task only."
  }
  return "Uploaded in an earlier month: counts toward the task only."
}

/**
 * One submitted photo: what it is for, who took it, what it counts toward and
 * its decision. Decisions are final, so a decided photo shows who decided and
 * when instead of actions.
 */
export function SubmissionCard({
  submission,
  viewerId,
  currentPeriod,
  actions,
  footer,
  className,
}: {
  submission: SubmissionView
  viewerId: string
  /** This month; an older period gets the "Sent in October…" line. */
  currentPeriod?: PeriodKey
  actions?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const { author, decision } = submission
  const own = isOwnPhoto(submission, viewerId)
  const purpose = submission.requirement
    ? (submission.requirement.title ?? "Checklist item")
    : "Monthly photo"
  const decidedByYou = decision?.decidedBy.id === viewerId
  const decidedBy = decision
    ? decidedByYou
      ? "you"
      : decision.decidedBy.displayName
        ? firstName(decision.decidedBy.displayName)
        : "a reviewer"
    : null
  const decidedAt = decision ? formatDateTime(decision.decidedAt) : null
  const lateAccepted =
    submission.state === "accepted" && decision?.lateAcceptance === true
  return (
    <Post
      aria-label={`${purpose}: photo by ${author.displayName}`}
      className={className}
      avatar={<ProfileAvatar name={author.displayName} />}
      name={
        <>
          {own ? "You" : author.displayName}
          {!author.active ? (
            <span className="font-normal text-ink-muted">
              {" "}
              · no longer active
            </span>
          ) : null}
        </>
      }
      meta={
        <span className="tabular-nums">
          Submitted {formatDateTime(submission.submittedAt)}
          {submission.origin === "attached" &&
          submission.submittedById === viewerId
            ? " by you"
            : null}
        </span>
      }
      media={
        <EvidencePreviewButton
          thumbnailUrl={
            submission.asset.available ? submission.asset.thumbnailUrl : null
          }
          previewUrl={
            submission.asset.available ? submission.asset.previewUrl : null
          }
          label={`Photo by ${author.displayName}`}
          description={purpose}
          edge
          className="size-full"
        />
      }
    >
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {lateAccepted ? (
            <StatusChip tone="closed">
              Accepted late · counts for {periodKeyLabel(submission.period)}
            </StatusChip>
          ) : (
            <SubmissionStateBadge state={submission.state} />
          )}
          {decision?.selfReview ? <SelfReviewBadge /> : null}
          {submission.origin !== "submitted" ? (
            <CoverageBadge tone="muted">
              {submission.origin === "attached" ? "Attached" : "Carried over"}
            </CoverageBadge>
          ) : null}
          {!submission.asset.available ? (
            <CoverageBadge tone="negative">Photo removed</CoverageBadge>
          ) : null}
          {submission.archived ? (
            <CoverageBadge tone="muted">History</CoverageBadge>
          ) : null}
        </div>
        <div className="grid gap-0.5">
          <p className="text-meta font-semibold text-ink-muted">
            {submission.requirement ? "Checklist item" : "Monthly target"}
          </p>
          <h3 className="text-item-title [overflow-wrap:anywhere] text-ink">
            {purpose}
          </h3>
        </div>
        <p className="text-body text-ink-muted">
          {countsText(submission, viewerId, currentPeriod)}
        </p>
        {decision?.decision === "needs_another_photo" && decision.reason ? (
          <>
            <Quote by={`${decidedByYou ? "You" : decidedBy} · ${decidedAt}`}>
              {decision.reason}
            </Quote>
            <p className="text-meta text-ink-muted">
              Decisions are final. {own ? "You" : firstName(author.displayName)}{" "}
              can send a replacement from the task.
            </p>
          </>
        ) : decision ? (
          <p className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
            {decision.decision === "accept" ? (
              <CheckIcon aria-hidden className="size-[18px] shrink-0" />
            ) : null}
            {decision.decision === "accept"
              ? "Accepted"
              : "Needs another photo"}{" "}
            by {decidedBy} · {decidedAt}. Decisions are final.
          </p>
        ) : null}
        {own && submission.state === "submitted" && actions ? (
          <Notice tone="info">{SELF_REVIEW_PENDING_COPY}</Notice>
        ) : null}
        {actions}
        {footer}
      </div>
    </Post>
  )
}
