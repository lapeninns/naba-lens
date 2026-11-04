import Link from "next/link"
import { CameraIcon, ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { CountBadge } from "../status-chip"
import { EvidenceThumb } from "./evidence-thumb"
import { replacementHref } from "./needs-another-photo-list"
import { SetupChecklist } from "./setup-checklist"
import { StatusChip } from "./status-badges"
import { ReviewReason, submissionTitle } from "./submission-list"
import type {
  CoverageScope,
  MyAssignment,
  MyTasksView,
  SubmissionView,
} from "./types"

const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000

export type TodoItem =
  | { kind: "setup" }
  | { kind: "replace"; submission: SubmissionView; closed: boolean }
  | { kind: "review"; count: number }
  | { kind: "overdue" | "due-soon"; assignment: MyAssignment }

function isOpenAndUnfinished(a: MyAssignment) {
  return a.canSubmit && !a.requirement.progress.satisfied
}

/**
 * What the person should do next, in order: finish setup, answer a replacement
 * request, photos waiting for a manager, then tasks that are overdue, then
 * tasks due within a week.
 */
export function todoItems(
  tasks: Pick<MyTasksView, "scope" | "assignments" | "needsAnotherPhoto">,
  now: Date = new Date(),
  reviewCount = 0
): TodoItem[] {
  const { scope, assignments, needsAnotherPhoto } = tasks
  const openTaskIds = new Set(
    assignments.filter((a) => a.canSubmit).map((a) => a.requirement.id)
  )
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  const items: TodoItem[] = []
  if (!scope.setup.complete) items.push({ kind: "setup" })
  for (const submission of needsAnotherPhoto) {
    items.push({
      kind: "replace",
      submission,
      closed:
        submission.requirement !== null &&
        !openTaskIds.has(submission.requirement.id),
    })
  }
  if (reviewCount > 0) items.push({ kind: "review", count: reviewCount })
  const pending = assignments.filter(
    (a) => isOpenAndUnfinished(a) && !replacing.has(a.requirement.id)
  )
  for (const assignment of pending) {
    if (assignment.requirement.progress.overdue) {
      items.push({ kind: "overdue", assignment })
    }
  }
  for (const assignment of pending) {
    const { due, progress } = assignment.requirement
    if (progress.overdue || !due) continue
    if (new Date(due.dueAt).getTime() - now.getTime() <= DUE_SOON_MS) {
      items.push({ kind: "due-soon", assignment })
    }
  }
  return items
}

/** Items that still ask for something (a closed replacement needs nothing). */
export function todoCount(items: TodoItem[]): number {
  return items.filter((i) => i.kind !== "replace" || !i.closed).length
}

function cardClass(attention = false) {
  return cn(
    "flex flex-col gap-3 rounded-panel border bg-card p-4",
    attention ? "border-warning/40" : "border-line"
  )
}

function action(primary: boolean) {
  return buttonVariants({
    variant: primary ? "primary" : "secondary",
    size: "touch",
    className: "self-start",
  })
}

function reviewerName(submission: SubmissionView): string {
  return submission.decision?.decidedBy.displayName ?? "Your reviewer"
}

function ReplaceCard({
  submission,
  closed,
  tasksPath,
  canSubmit,
  primary,
}: {
  submission: SubmissionView
  closed: boolean
  tasksPath: string
  canSubmit: boolean
  primary: boolean
}) {
  const title = submissionTitle(submission)
  return (
    <li className={cardClass(true)}>
      <div className="flex gap-3">
        <EvidenceThumb
          thumbnailUrl={submission.asset.thumbnailUrl}
          previewUrl={submission.asset.previewUrl}
          label={`${title}: photo sent ${submission.submittedAt.slice(0, 10)}`}
          className="size-20"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3 className="font-semibold break-words">
            {reviewerName(submission)} asked for another photo
          </h3>
          <div>
            <StatusChip tone="warning">Needs another photo</StatusChip>
          </div>
          <ReviewReason reason={submission.decision?.reason ?? null} />
          <p className="text-meta-touch text-ink-muted md:text-meta">
            For: {title}
          </p>
        </div>
      </div>
      {closed ? (
        <p className="text-meta-touch text-ink-muted md:text-meta">
          This task is no longer open to you, so no replacement is needed.
        </p>
      ) : canSubmit ? (
        <Link
          href={replacementHref(tasksPath, submission)}
          aria-label={`Send another photo for ${title}`}
          className={action(primary)}
        >
          <CameraIcon data-icon="inline-start" aria-hidden />
          Send another photo
        </Link>
      ) : null}
    </li>
  )
}

function ReviewCard({
  count,
  venueName,
  primary,
}: {
  count: number
  venueName: string | null
  primary: boolean
}) {
  return (
    <li className={cardClass()}>
      <div className="flex gap-3">
        <ClipboardTextIcon
          aria-hidden
          className="mt-0.5 size-6 shrink-0 text-ink-muted"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-semibold break-words">
            {count} {count === 1 ? "photo" : "photos"} to review
          </h3>
          {venueName ? (
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {venueName}
            </p>
          ) : null}
        </div>
      </div>
      <Link href="/staff/manage/review" className={action(primary)}>
        Review photos
      </Link>
    </li>
  )
}

function TaskCard({
  kind,
  assignment,
  tasksPath,
  primary,
}: {
  kind: "overdue" | "due-soon"
  assignment: MyAssignment
  tasksPath: string
  primary: boolean
}) {
  const { requirement } = assignment
  const { progress, due } = requirement
  return (
    <li className={cardClass()}>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold break-words">
          {requirement.title} is {kind === "overdue" ? "overdue" : "due soon"}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 text-meta-touch text-ink-muted md:text-meta">
          {kind === "overdue" ? (
            <StatusChip tone="negative">Overdue</StatusChip>
          ) : null}
          {due ? (
            <span>
              {kind === "overdue"
                ? due.label.replace(/^Due /, "Was due ")
                : due.label}
            </span>
          ) : null}
          {progress.target ? (
            <span>
              · {progress.accepted} of {progress.target} accepted
            </span>
          ) : null}
        </div>
      </div>
      <Link
        href={`${tasksPath}/${requirement.id}`}
        aria-label={`Send photos for ${requirement.title}`}
        className={action(primary)}
      >
        <CameraIcon data-icon="inline-start" aria-hidden />
        Send photos
      </Link>
    </li>
  )
}

/**
 * The one thing to do next, first. The first card's button is the page's
 * primary action; the rest are secondary.
 */
export function TodoSection({
  items,
  scope,
  profile,
  tasksPath,
  portfolioPath,
}: {
  items: TodoItem[]
  scope: CoverageScope
  profile: Parameters<typeof SetupChecklist>[0]["profile"]
  tasksPath: string
  portfolioPath: string
}) {
  const count = todoCount(items)
  return (
    <section aria-labelledby="todo-heading" className="flex flex-col gap-3">
      <h2
        id="todo-heading"
        className="flex items-center gap-2 text-section-title-touch md:text-section-title"
      >
        To do
        <CountBadge count={count} label="things to do" />
      </h2>
      {items.length === 0 ? (
        <p className="text-body-touch text-ink-muted md:text-body">
          Nothing to do right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => {
            const primary = index === 0
            switch (item.kind) {
              case "setup":
                return (
                  <li key="setup" className="list-none">
                    <SetupChecklist
                      setup={scope.setup}
                      profile={profile}
                      editProfileHref={portfolioPath}
                    />
                  </li>
                )
              case "replace":
                return (
                  <ReplaceCard
                    key={item.submission.id}
                    submission={item.submission}
                    closed={item.closed}
                    tasksPath={tasksPath}
                    canSubmit={scope.canSubmit}
                    primary={primary}
                  />
                )
              case "review":
                return (
                  <ReviewCard
                    key="review"
                    count={item.count}
                    venueName={scope.venue?.name ?? null}
                    primary={primary}
                  />
                )
              default:
                return (
                  <TaskCard
                    key={`${item.kind}-${item.assignment.requirement.id}`}
                    kind={item.kind}
                    assignment={item.assignment}
                    tasksPath={tasksPath}
                    primary={primary}
                  />
                )
            }
          })}
        </ul>
      )}
    </section>
  )
}
