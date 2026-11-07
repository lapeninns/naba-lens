import Link from "next/link"
import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  CaretRightIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

import { plural, requirementKindLabel } from "./copy"
import { PhotoSegments } from "./month-card"
import { DueLine, StatusChip } from "./status-badges"
import type { MyAssignment } from "./types"

/** Aggregate progress of a task shared by its assignees. */
export function SharedProgress({
  assignment,
}: {
  assignment: Pick<MyAssignment, "requirement" | "myAccepted" | "myPending">
}) {
  const { progress, assignees } = assignment.requirement
  const others = Math.max(0, assignees.length - 1)
  return (
    <div className="grid gap-1.5">
      {progress.target ? (
        <>
          <p className="text-body text-ink-muted">
            <span className="font-bold text-ink tabular-nums">
              {progress.accepted} of {progress.target}
            </span>{" "}
            photos accepted
            {others > 0 ? (
              <span>
                {" "}
                · shared with {plural(others, "colleague", "colleagues")}
              </span>
            ) : null}
          </p>
          <div
            role="img"
            aria-label={`${progress.accepted} of ${progress.target} photos accepted`}
          >
            <PhotoSegments
              accepted={progress.accepted}
              target={progress.target}
            />
          </div>
        </>
      ) : null}
      <p className="text-meta text-ink-muted">
        You: {assignment.myAccepted} accepted · {assignment.myPending} waiting
        for review
      </p>
    </div>
  )
}

/** Overdue first, then due soonest (no due date last), complete tasks at the end. */
export function sortByUrgency(assignments: MyAssignment[]): MyAssignment[] {
  const rank = (a: MyAssignment) => {
    const { progress, due } = a.requirement
    if (progress.satisfied) return 2
    return progress.overdue || due?.overdue ? 0 : 1
  }
  const dueAt = (a: MyAssignment) =>
    a.requirement.due ? new Date(a.requirement.due.dueAt).getTime() : Infinity
  return [...assignments].sort(
    (a, b) => rank(a) - rank(b) || dueAt(a) - dueAt(b)
  )
}

/** Tasks assigned to me, most urgent first. */
export function AssignmentList({
  assignments,
  tasksPath,
  needsAnotherPhoto,
}: {
  assignments: MyAssignment[]
  tasksPath: string
  /** Requirement IDs with an open "needs another photo" request. */
  needsAnotherPhoto: ReadonlySet<string>
}) {
  return (
    <ul
      aria-label="Assigned tasks"
      className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
    >
      {sortByUrgency(assignments).map((assignment) => {
        const { requirement } = assignment
        const satisfied = requirement.progress.satisfied
        const closed = !requirement.isCurrent
        const replacing = needsAnotherPhoto.has(requirement.id)
        const overdue =
          !satisfied &&
          Boolean(requirement.progress.overdue || requirement.due?.overdue)
        const tone = replacing || overdue ? "warn" : satisfied ? "ok" : null
        const Icon = replacing
          ? ArrowCounterClockwiseIcon
          : overdue
            ? ClockIcon
            : satisfied
              ? CheckIcon
              : closed
                ? LockIcon
                : CalendarBlankIcon
        return (
          <li
            key={requirement.id}
            className="relative grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 transition-colors duration-(--duration-quick) hover:bg-surface-2 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-focus has-[a:focus-visible]:ring-inset"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-round [&_svg]:size-6",
                tone === "warn"
                  ? "bg-warn-bg text-warn-fg"
                  : tone === "ok"
                    ? "bg-ok-bg text-ok-fg"
                    : "bg-surface-2 text-ink"
              )}
            >
              <Icon />
            </span>
            <div className="grid min-w-0 gap-1.5">
              <div className="grid gap-0.5">
                <span className="font-mono text-meta text-ink-muted">
                  {requirementKindLabel(requirement.kind)}
                </span>
                <h3 className="text-item-title [overflow-wrap:anywhere] text-ink">
                  {/* The whole row is the link target; the name stays the title. */}
                  <Link
                    href={`${tasksPath}/${requirement.id}`}
                    className="outline-none after:absolute after:inset-0"
                  >
                    {requirement.title}
                  </Link>
                </h3>
              </div>
              <SharedProgress assignment={assignment} />
              {requirement.due ? (
                <DueLine due={requirement.due} done={satisfied} />
              ) : (
                <span className="text-meta text-ink-muted">No due date</span>
              )}
              {satisfied || closed || replacing ? (
                <div className="flex flex-wrap gap-1.5">
                  {satisfied ? (
                    <StatusChip tone="positive">Complete</StatusChip>
                  ) : null}
                  {closed ? <StatusChip tone="muted">Closed</StatusChip> : null}
                  {replacing ? (
                    <StatusChip tone="warning">Needs another photo</StatusChip>
                  ) : null}
                </div>
              ) : null}
            </div>
            <CaretRightIcon
              aria-hidden
              weight="bold"
              className="size-5 shrink-0 text-ink-muted"
            />
          </li>
        )
      })}
    </ul>
  )
}
