import Link from "next/link"
import { CameraIcon, ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import {
  EVIDENCE_RULE_LABEL,
  PROGRESS_LABEL,
  staffCaptureHref,
  type MyAmenityTask,
} from "@/lib/amenities/contract"
import { cn } from "@/lib/utils"

import { orderAmenityTasks } from "../amenities/capture/amenity-task-list"
import { Notice } from "../notice"
import { CountBadge } from "../status-chip"
import { EvidenceThumb } from "./evidence-thumb"
import { replacementHref } from "./needs-another-photo-list"
import { SetupChecklist, setupHasAction } from "./setup-checklist"
import { StatusChip } from "./status-badges"
import { ReviewReason, submissionTitle } from "./submission-list"
import type {
  CoverageScope,
  MyAssignment,
  MyTasksView,
  SubmissionView,
} from "./types"

const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000

const thingsToDo = (count: number) =>
  count === 1 ? "thing to do" : "things to do"

/** To do's heading: focusable, for a notice above it that goes away. */
export const TODO_HEADING_ID = "todo-heading"

export type TodoItem =
  | { kind: "setup" }
  | { kind: "replace"; submission: SubmissionView; closed: boolean }
  | { kind: "review"; count: number }
  | { kind: "overdue" | "due-soon"; assignment: MyAssignment }
  /** Amenity checks assigned to me, recheck first; each one counts. */
  | { kind: "amenity"; checks: MyAmenityTask[] }

function isOpenAndUnfinished(a: MyAssignment) {
  return a.canSubmit && !a.requirement.progress.satisfied
}

/**
 * What the person should do next, in order: finish setup, answer a replacement
 * request, photos waiting for a manager, tasks that are overdue, amenity
 * checks, then tasks due within a week.
 */
export function todoItems(
  tasks: Pick<MyTasksView, "scope" | "assignments" | "needsAnotherPhoto">,
  now: Date = new Date(),
  reviewCount = 0,
  amenityChecks: readonly MyAmenityTask[] = []
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
  if (amenityChecks.length > 0)
    items.push({ kind: "amenity", checks: orderAmenityTasks(amenityChecks) })
  for (const assignment of pending) {
    const { due, progress } = assignment.requirement
    if (progress.overdue || !due) continue
    if (new Date(due.dueAt).getTime() - now.getTime() <= DUE_SOON_MS) {
      items.push({ kind: "due-soon", assignment })
    }
  }
  return items
}

/** Things that still ask for something (a closed replacement needs nothing). */
export function todoCount(items: TodoItem[]): number {
  let count = 0
  for (const item of items) {
    if (item.kind === "amenity") count += item.checks.length
    else if (item.kind !== "replace" || !item.closed) count += 1
  }
  return count
}

type Tone = "warn" | "info"

/**
 * The first item is the lead card (DESIGN.md §4): a 4px bar along the top in
 * its tone and the page's one blue action. The rest are plain cards with a
 * 4px bar on the left and a grey action.
 */
function cardClass(primary: boolean, tone?: Tone) {
  return cn(
    "relative grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card",
    primary &&
      tone === "warn" &&
      "pt-5 shadow-[var(--elevation-card),inset_0_4px_0_var(--warn-fg)]",
    primary &&
      tone === "info" &&
      "pt-5 shadow-[var(--elevation-card),inset_0_4px_0_var(--info-fg)]",
    !primary &&
      tone === "warn" &&
      "shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]",
    !primary &&
      tone === "info" &&
      "shadow-[var(--elevation-card),inset_4px_0_0_var(--info-fg)]"
  )
}

function titleClass(primary: boolean) {
  return cn(
    "[overflow-wrap:anywhere] text-ink",
    primary ? "font-display text-card-title" : "text-item-title"
  )
}

/** Kicker on the left, state chip on the right (the lead card's top row). */
function TopRow({
  kicker,
  chip,
}: {
  kicker?: React.ReactNode
  chip?: React.ReactNode
}) {
  if (!kicker && !chip) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {kicker ? (
        <span className="min-w-0 text-meta font-semibold [overflow-wrap:anywhere] text-ink-muted">
          {kicker}
        </span>
      ) : (
        <span />
      )}
      {chip}
    </div>
  )
}

function action(primary: boolean) {
  return buttonVariants({
    variant: primary ? "primary" : "secondary",
    size: primary ? "lg" : "touch",
    className: primary ? "w-full" : "w-full sm:w-auto sm:justify-self-start",
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
    <li className={cardClass(primary, "warn")}>
      <TopRow
        kicker={<>For: {title}</>}
        chip={<StatusChip tone="warning">Needs another photo</StatusChip>}
      />
      <h3 className={titleClass(primary)}>
        {reviewerName(submission)} asked for another photo
      </h3>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3">
        <EvidenceThumb
          thumbnailUrl={submission.asset.thumbnailUrl}
          previewUrl={submission.asset.previewUrl}
          label={`${title}: photo sent ${submission.submittedAt.slice(0, 10)}`}
          className="size-18 rounded-control bg-media-placeholder"
        />
        <div className="min-w-0">
          <ReviewReason reason={submission.decision?.reason ?? null} />
        </div>
      </div>
      {closed ? (
        <p className="text-meta text-ink-muted">
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
    <li className={cardClass(primary, "info")}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-round bg-info-bg text-info-fg"
        >
          <ClipboardTextIcon className="size-6" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h3 className={titleClass(primary)}>
            {count} {count === 1 ? "photo" : "photos"} to review
          </h3>
          {venueName ? (
            <p className="text-meta font-semibold text-ink-muted">
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
  const overdue = kind === "overdue"
  return (
    <li className={cardClass(primary, overdue ? "warn" : undefined)}>
      <TopRow
        chip={overdue ? <StatusChip tone="negative">Overdue</StatusChip> : null}
      />
      <h3 className={titleClass(primary)}>
        {requirement.title} is {overdue ? "overdue" : "due soon"}
      </h3>
      {due || progress.target ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-body text-ink-muted">
          {due ? (
            <span>
              {overdue ? due.label.replace(/^Due /, "Was due ") : due.label}
            </span>
          ) : null}
          {progress.target ? (
            <span>
              · {progress.accepted} of {progress.target} accepted
            </span>
          ) : null}
        </p>
      ) : null}
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
 * Amenity checks as one card: the first check (a recheck when there is one)
 * is a tap away; the full list follows To do.
 */
function AmenityCard({
  checks,
  primary,
}: {
  checks: MyAmenityTask[]
  primary: boolean
}) {
  const [first] = checks
  const recheck = first.progress === "needs_recheck"
  const more = checks.length - 1
  return (
    <li className={cardClass(primary, recheck ? "warn" : "info")}>
      <TopRow
        kicker={<>Amenity check: {first.entry.category}</>}
        chip={
          <StatusChip tone={recheck ? "warning" : "info"}>
            {PROGRESS_LABEL[first.progress]}
          </StatusChip>
        }
      />
      <h3 className={titleClass(primary)}>{first.entry.question}</h3>
      {recheck && first.recheckReason ? (
        <p className="text-body [overflow-wrap:anywhere] text-ink">
          <span className="font-semibold">Recheck reason:</span>{" "}
          {first.recheckReason}
        </p>
      ) : null}
      <p className="text-body text-ink-muted">
        Evidence: {EVIDENCE_RULE_LABEL[first.entry.evidenceRule]}
        {more > 0
          ? ` · ${more} more ${more === 1 ? "check" : "checks"} below`
          : null}
      </p>
      <Link
        href={staffCaptureHref(first.id)}
        aria-label={`Start check: ${first.entry.question}`}
        className={action(primary)}
      >
        Start check
      </Link>
    </li>
  )
}

/** Whether the card ends in an action button. */
function hasAction(
  item: TodoItem,
  scope: CoverageScope,
  profile: Parameters<typeof setupHasAction>[0]
): boolean {
  switch (item.kind) {
    case "setup":
      return setupHasAction(profile)
    case "replace":
      return !item.closed && scope.canSubmit
    default:
      return true
  }
}

/**
 * The one thing to do next, first. The first card with an action leads: its
 * button is the page's primary action; the rest are secondary.
 */
export function TodoSection({
  items,
  scope,
  profile,
  tasksPath,
  portfolioPath,
  amenityError = false,
}: {
  items: TodoItem[]
  scope: CoverageScope
  profile: Parameters<typeof SetupChecklist>[0]["profile"]
  tasksPath: string
  portfolioPath: string
  /** The amenity checks couldn't be read, so To do may be incomplete. */
  amenityError?: boolean
}) {
  const count = todoCount(items)
  const lead = items.findIndex((item) => hasAction(item, scope, profile))
  return (
    <section aria-labelledby={TODO_HEADING_ID} className="grid gap-(--gutter)">
      <div className="px-1 pt-2">
        <h2
          id={TODO_HEADING_ID}
          tabIndex={-1}
          // Chrome puts a space before the count badge (an inline-grid) when
          // it names the heading: "To do , 2 things to do".
          aria-label={
            count > 0 ? `To do, ${count} ${thingsToDo(count)}` : "To do"
          }
          className="flex items-center gap-2 rounded-control font-display text-section-title text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          To do
          <CountBadge count={count} label={thingsToDo(count)} />
        </h2>
      </div>
      {amenityError ? (
        <Notice
          tone="negative"
          action={
            <Link
              href={tasksPath}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              Try again
            </Link>
          }
        >
          {"We couldn't check your amenity checks."}
        </Notice>
      ) : null}
      {items.length === 0 ? (
        amenityError ? null : (
          <div className="rounded-card bg-surface p-4 shadow-card">
            <p className="font-display text-section-title text-ink">
              Nothing to do right now.
            </p>
          </div>
        )
      ) : (
        <ul className="grid gap-(--gutter)">
          {items.map((item, index) => {
            const primary = index === lead
            switch (item.kind) {
              case "setup":
                return (
                  <li key="setup" className="list-none">
                    <SetupChecklist
                      setup={scope.setup}
                      profile={profile}
                      editProfileHref={`${portfolioPath}?edit=profile`}
                      actionClassName={action(primary)}
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
              case "amenity":
                return (
                  <AmenityCard
                    key="amenity"
                    checks={item.checks}
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
