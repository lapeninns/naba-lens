import Link from "next/link"
import { CameraIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"

import { formatDate } from "../format"
import { EvidenceThumb } from "./evidence-thumb"
import { decisionText, ReviewReason, submissionTitle } from "./submission-list"
import type { SubmissionView } from "./types"

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

/** Shown above the send controls when the send answers a replacement request. */
export function ReplacementNote({
  submission,
}: {
  submission: SubmissionView
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning-surface/40 p-3">
      <EvidenceThumb
        thumbnailUrl={submission.asset.thumbnailUrl}
        previewUrl={submission.asset.previewUrl}
        label={`Photo that needs another, sent ${formatDate(submission.submittedAt)}`}
        className="size-16"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">
          The photos you send now replace this one.
        </p>
        <ReviewReason reason={submission.decision?.reason ?? null} />
      </div>
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
