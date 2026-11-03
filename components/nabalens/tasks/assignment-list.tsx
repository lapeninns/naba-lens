import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { Progress } from "@/components/ui/progress"

import { plural, requirementKindLabel } from "./copy"
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
    <div className="flex flex-col gap-1.5">
      {progress.target ? (
        <>
          <p className="text-body-touch md:text-body-sm">
            <span className="font-medium tabular-nums">
              {progress.accepted} of {progress.target}
            </span>{" "}
            photos accepted
            {others > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                · shared with {plural(others, "colleague", "colleagues")}
              </span>
            ) : null}
          </p>
          <Progress
            value={Math.min(100, (progress.accepted / progress.target) * 100)}
            aria-label={`${progress.accepted} of ${progress.target} photos accepted`}
          />
        </>
      ) : null}
      <p className="text-meta-touch text-ink-muted md:text-meta">
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
    <ul aria-label="Assigned tasks" className="grid gap-3 sm:grid-cols-2">
      {sortByUrgency(assignments).map((assignment) => {
        const { requirement } = assignment
        const satisfied = requirement.progress.satisfied
        return (
          <li
            key={requirement.id}
            className="relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {requirementKindLabel(requirement.kind)}
              </span>
              {satisfied ? (
                <StatusChip tone="positive">Complete</StatusChip>
              ) : null}
              {!requirement.isCurrent ? (
                <StatusChip tone="muted">Closed</StatusChip>
              ) : null}
              {needsAnotherPhoto.has(requirement.id) ? (
                <StatusChip tone="warning">Needs another photo</StatusChip>
              ) : null}
            </div>
            <h3 className="font-semibold break-words">
              {/* The whole card is the link target; the name stays the title. */}
              <Link
                href={`${tasksPath}/${requirement.id}`}
                className="outline-none after:absolute after:inset-0 after:rounded-xl"
              >
                {requirement.title}
              </Link>
            </h3>
            <SharedProgress assignment={assignment} />
            <div className="mt-auto flex items-center justify-between gap-3">
              {requirement.due ? (
                <DueLine due={requirement.due} done={satisfied} />
              ) : (
                <span className="text-meta-touch text-ink-muted md:text-meta">
                  No due date
                </span>
              )}
              <CaretRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
