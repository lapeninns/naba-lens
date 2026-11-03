import type { Department } from "@/lib/config/departments"

import { Notice } from "../notice"
import { PageHeader } from "../page-header"
import { AssignmentList } from "./assignment-list"
import { MonthlyProgressCard } from "./monthly-progress-card"
import { todoItems, TodoSection } from "./todo-list"
import type { CoverageScope, MyTasksView } from "./types"

/** Why sending is paused (no venue, or an inactive venue), or null. */
export function submitBlockedCopy(scope: CoverageScope): string | null {
  if (scope.canSubmit) return null
  if (!scope.venue) {
    return "You can't send photos until an admin assigns your venue."
  }
  return "Sending photos is paused because your venue isn't taking photos right now. Ask an admin to check your venue."
}

/** A send the person just made, announced above To do. */
export type JustSent =
  | { kind: "sent"; count: number; taskTitle: string | null }
  | { kind: "replaced"; taskTitle: string | null }

export const RULE_SENTENCE =
  "Ready photos are already in Photos and on your profile. Review decides whether they count, not whether they are shared."

function sentNotice(justSent: JustSent) {
  const task = justSent.taskTitle ?? "this month's photos"
  return justSent.kind === "replaced"
    ? `Your new photo for ${task} is waiting for review.`
    : `${justSent.count === 1 ? "1 photo" : `${justSent.count} photos`} sent to ${task}. A reviewer reviews ${justSent.count === 1 ? "it" : "them"} next.`
}

/** Staff Home: the one thing to do next, this month's photos, then all tasks. */
export function TasksOverview({
  tasks,
  profile,
  tasksPath,
  portfolioPath,
  justSent = null,
}: {
  tasks: MyTasksView
  profile: {
    displayName: string
    venueName: string | null
    department: Department | null
    hasAvatar: boolean
  }
  /** "/staff/tasks" */
  tasksPath: string
  /** Where Edit profile lives ("/staff"). */
  portfolioPath: string
  justSent?: JustSent | null
}) {
  const { scope, period, monthly, assignments, needsAnotherPhoto } = tasks
  const blocked = submitBlockedCopy(scope)
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  const items = todoItems(tasks)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        scope={[scope.venue?.name, period.label]}
        venueScope={Boolean(scope.venue)}
        title="Home"
      />

      {justSent ? (
        <Notice tone="positive" role="status">
          {sentNotice(justSent)}
        </Notice>
      ) : null}

      {blocked && scope.venue ? <Notice role="status">{blocked}</Notice> : null}

      <TodoSection
        items={items}
        scope={scope}
        profile={profile}
        tasksPath={tasksPath}
        portfolioPath={portfolioPath}
      />

      <MonthlyProgressCard
        monthly={monthly}
        periodLabel={period.label}
        addHref={`${tasksPath}/month`}
        canSubmit={scope.canSubmit}
      />

      <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body">
        {RULE_SENTENCE}
      </p>

      <section
        aria-labelledby="assigned-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="assigned-heading" className="text-lg font-semibold">
          Assigned to you
        </h2>
        {assignments.length > 0 ? (
          <AssignmentList
            assignments={assignments}
            tasksPath={tasksPath}
            needsAnotherPhoto={replacing}
          />
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing is assigned to you right now. You can still add photos for
            this month.
          </p>
        )}
      </section>
    </div>
  )
}
