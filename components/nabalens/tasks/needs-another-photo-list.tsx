import Link from "next/link"
import { CameraIcon } from "@phosphor-icons/react/dist/ssr"

import { Notice } from "@/components/nabalens/notice"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { buttonVariants } from "@/components/ui/button"

import { formatDate } from "../format"
import { EvidenceThumb } from "./evidence-thumb"
import { periodLabel } from "./copy"
import { StatusChip } from "./status-badges"
import { decisionText, ReviewReason, submissionTitle } from "./submission-list"
import type { PeriodKey, SubmissionView } from "./types"

/** Query parameter naming the "needs another photo" item a send answers. */
export const REPLACES_PARAM = "replaces"

/**
 * "Needs another photo" items not yet answered by a replacement. Archived items
 * (their task was retired or reconciled) are history, never open requests.
 */
export function openReplacementRequests(
  submissions: SubmissionView[]
): SubmissionView[] {
  const answered = new Set(
    submissions.flatMap((s) =>
      s.replacesSubmissionId ? [s.replacesSubmissionId] : []
    )
  )
  return submissions.filter(
    (s) =>
      s.state === "needs_another_photo" && !s.archived && !answered.has(s.id)
  )
}

/**
 * The request a send answers: the one named in the link if it is still open,
 * otherwise the oldest open one (lists are newest first). The database
 * rejects a stale ID, so only open requests are ever passed on.
 */
export function pickReplacement(
  open: SubmissionView[],
  requested: string | null | undefined
): SubmissionView | null {
  return open.find((s) => s.id === requested) ?? open[open.length - 1] ?? null
}

const FALLBACK_REASON = "Your reviewer didn't leave a reason."

/** First name of the person who asked, or a neutral fallback. */
export function askerName(submission: SubmissionView): string {
  const name = submission.decision?.decidedBy.displayName?.trim()
  return name ? name : "Your reviewer"
}

/**
 * What the reviewer asked for, shown above the send controls: who, when, the
 * original photo and always the reason (with a fallback when none was saved).
 * `currentPeriod` adds the last-month line when the request is from earlier.
 */
export function ReplacementNote({
  submission,
  currentPeriod,
  closed = false,
}: {
  submission: SubmissionView
  currentPeriod?: PeriodKey
  closed?: boolean
}) {
  const decision = submission.decision
  const name = askerName(submission)
  const reason = decision?.reason?.trim() || FALLBACK_REASON
  const earlier =
    !closed && currentPeriod && decision
      ? requestPeriod(decision.decidedAt, currentPeriod)
      : null
  return (
    <section
      aria-label="What your reviewer asked for"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <ProfileAvatar name={name} />
        {/* A 12rem basis wraps the chip under the name on phones instead of
            squeezing the name into a one-word column. */}
        <div className="grid min-w-0 flex-[1_1_12rem] leading-snug">
          <p className="font-bold [overflow-wrap:anywhere] text-ink">{name}</p>
          {decision ? (
            <p className="text-meta text-ink-muted">
              Asked for another photo · {formatDate(decision.decidedAt)}
            </p>
          ) : null}
        </div>
        <StatusChip tone="warning">Needs another photo</StatusChip>
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3">
        <EvidenceThumb
          thumbnailUrl={submission.asset.thumbnailUrl}
          previewUrl={submission.asset.previewUrl}
          label={`Photo that needs another, sent ${formatDate(submission.submittedAt)}`}
          className="size-18 rounded-control bg-media-placeholder"
        />
        <p className="font-mono text-meta text-ink-muted tabular-nums">
          Your photo · sent {formatDate(submission.submittedAt)}
        </p>
      </div>
      <div className="grid gap-1.5 rounded-control bg-warn-bg p-3 shadow-[inset_4px_0_0_var(--warn-fg)]">
        <p className="text-lead font-bold text-ink">
          <span className="sr-only">Reason: </span>
          <span className="break-words whitespace-pre-line">{reason}</span>
        </p>
      </div>
      {earlier ? (
        <p className="text-meta text-ink-muted">
          {name.split(" ")[0]} asked in {earlier.asked}. A new photo counts for{" "}
          {earlier.current}, the month you send it.
        </p>
      ) : null}
      {closed ? null : (
        <p className="text-body font-bold text-ink">
          The photos you send now replace this one.
        </p>
      )}
    </section>
  )
}

const LONDON_MONTH = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Europe/London",
})

function periodKeyOfInstant(iso: string): PeriodKey {
  const parts = LONDON_MONTH.formatToParts(new Date(iso))
  const get = (type: string) => parts.find((x) => x.type === type)?.value
  return `${get("year")}-${get("month")}`
}

/** The month a request was made and this month, when they differ. */
function requestPeriod(decidedAt: string, current: PeriodKey) {
  const asked = periodKeyOfInstant(decidedAt)
  if (asked >= current) return null
  return {
    asked: periodLabel(asked),
    current: periodLabel(current).split(" ")[0],
  }
}

/** The request's task closed before a replacement was sent. */
export function ReplacementClosed({
  submission,
  homeHref,
}: {
  submission: SubmissionView
  homeHref: string
}) {
  return (
    <div className="grid gap-(--gutter)">
      <Notice
        tone="attention"
        title="This task has closed"
        action={
          <Link
            href={homeHref}
            className={buttonVariants({
              variant: "secondary",
              size: "touch",
              className: "w-full sm:w-auto",
            })}
          >
            Back to Home
          </Link>
        }
      >
        {submissionTitle(submission)} closed before you sent a new photo, so
        there&apos;s nothing to replace. Your photos stay in Photos and on your
        profile.
      </Notice>
      <ReplacementNote submission={submission} closed />
    </div>
  )
}

/** Where to send a replacement for `submission`. */
export function replacementHref(
  tasksPath: string,
  submission: SubmissionView
): string {
  const base = submission.requirement
    ? `${tasksPath}/${submission.requirement.id}`
    : `${tasksPath}/month`
  return `${base}?${REPLACES_PARAM}=${submission.id}`
}

/**
 * Open replacement requests: the reviewer's reason and a way to send another
 * photo (to the task, or to this month's photos when it had no task).
 */
export function NeedsAnotherPhotoList({
  submissions,
  tasksPath,
  canSubmit,
  openTaskIds,
}: {
  submissions: SubmissionView[]
  /** "/staff/tasks": tasks live at `${tasksPath}/[id]`, monthly photos at `${tasksPath}/month`. */
  tasksPath: string
  canSubmit: boolean
  /** Tasks the person can still send photos to. */
  openTaskIds: ReadonlySet<string>
}) {
  if (submissions.length === 0) return null
  return (
    <section aria-labelledby="replace-heading" className="grid gap-(--gutter)">
      <div className="px-1 pt-2">
        <h2
          id="replace-heading"
          className="font-display text-section-title text-ink"
        >
          Needs another photo
        </h2>
      </div>
      <ul className="grid gap-(--gutter)">
        {submissions.map((submission) => {
          const title = submissionTitle(submission)
          const closed =
            submission.requirement !== null &&
            !openTaskIds.has(submission.requirement.id)
          return (
            <li
              key={submission.id}
              className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 rounded-card bg-surface p-3 shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]"
            >
              <EvidenceThumb
                thumbnailUrl={submission.asset.thumbnailUrl}
                previewUrl={submission.asset.previewUrl}
                label={`${title}: photo sent ${formatDate(submission.submittedAt)}`}
                className="size-18 rounded-control bg-media-placeholder"
              />
              <div className="grid min-w-0 gap-2">
                <p className="text-item-title [overflow-wrap:anywhere] text-ink">
                  {title}
                </p>
                <ReviewReason reason={submission.decision?.reason ?? null} />
                {submission.decision ? (
                  <p className="text-meta text-ink-muted">
                    {decisionText(submission.decision)}
                  </p>
                ) : null}
                {closed ? (
                  <p className="text-meta text-ink-muted">
                    This task is no longer open to you, so no replacement is
                    needed.
                  </p>
                ) : canSubmit ? (
                  <Link
                    href={replacementHref(tasksPath, submission)}
                    aria-label={`Send another photo for ${title}`}
                    className={buttonVariants({
                      size: "touch",
                      className: "w-full sm:w-auto sm:justify-self-start",
                    })}
                  >
                    <CameraIcon data-icon="inline-start" aria-hidden />
                    Send another photo
                  </Link>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
