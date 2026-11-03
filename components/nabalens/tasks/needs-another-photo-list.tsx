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
      className="bg-surface flex flex-col gap-3 rounded-panel border border-line p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProfileAvatar name={name} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-medium break-words">{name}</p>
          {decision ? (
            <p className="text-sm text-muted-foreground">
              Asked for another photo · {formatDate(decision.decidedAt)}
            </p>
          ) : null}
        </div>
        <StatusChip tone="warning">Needs another photo</StatusChip>
      </div>
      <div className="flex gap-3">
        <EvidenceThumb
          thumbnailUrl={submission.asset.thumbnailUrl}
          previewUrl={submission.asset.previewUrl}
          label={`Photo that needs another, sent ${formatDate(submission.submittedAt)}`}
          className="size-20"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            Your photo · sent {formatDate(submission.submittedAt)}
          </p>
          <p className="text-sm font-medium">
            <span className="sr-only">Reason: </span>
            <span className="break-words whitespace-pre-line">{reason}</span>
          </p>
        </div>
      </div>
      {earlier ? (
        <p className="text-sm text-muted-foreground">
          {name.split(" ")[0]} asked in {earlier.asked}. A new photo counts for{" "}
          {earlier.current}, the month you send it.
        </p>
      ) : null}
      {closed ? null : (
        <p className="text-sm font-medium">
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
    <div className="flex flex-col gap-4">
      <Notice
        tone="attention"
        title="This task has closed"
        action={
          <Link
            href={homeHref}
            className={buttonVariants({ variant: "secondary", size: "touch" })}
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
    <section aria-labelledby="replace-heading" className="flex flex-col gap-3">
      <h2 id="replace-heading" className="text-lg font-semibold">
        Needs another photo
      </h2>
      <ul className="flex flex-col gap-3">
        {submissions.map((submission) => {
          const title = submissionTitle(submission)
          const closed =
            submission.requirement !== null &&
            !openTaskIds.has(submission.requirement.id)
          return (
            <li
              key={submission.id}
              className="flex gap-3 rounded-xl border border-warning/40 bg-card p-3"
            >
              <EvidenceThumb
                thumbnailUrl={submission.asset.thumbnailUrl}
                previewUrl={submission.asset.previewUrl}
                label={`${title}: photo sent ${formatDate(submission.submittedAt)}`}
                className="size-20"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="font-medium break-words">{title}</p>
                <ReviewReason reason={submission.decision?.reason ?? null} />
                {submission.decision ? (
                  <p className="text-sm text-muted-foreground">
                    {decisionText(submission.decision)}
                  </p>
                ) : null}
                {closed ? (
                  <p className="text-sm text-muted-foreground">
                    This task is no longer open to you, so no replacement is
                    needed.
                  </p>
                ) : canSubmit ? (
                  <Link
                    href={replacementHref(tasksPath, submission)}
                    aria-label={`Send another photo for ${title}`}
                    className={buttonVariants({
                      size: "touch",
                      className: "self-start",
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
