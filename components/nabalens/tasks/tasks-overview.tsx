import type { Department } from "@/lib/config/departments"

import { AssignmentList } from "./assignment-list"
import { plural } from "./copy"
import { MonthlyProgressCard } from "./monthly-progress-card"
import { NeedsAnotherPhotoList } from "./needs-another-photo-list"
import { SetupChecklist } from "./setup-checklist"
import type { CoverageScope, MyTasksView } from "./types"

/** Why sending is paused (no venue, or an inactive venue), or null. */
export function submitBlockedCopy(scope: CoverageScope): string | null {
  if (scope.canSubmit) return null
  if (!scope.venue) {
    return "You can't send photos until an admin assigns your venue."
  }
  return "Sending photos is paused because your venue isn't taking photos right now. Ask an admin to check your venue."
}

/** Staff landing: setup, this month, replacements and assigned tasks. */
export function TasksOverview({
  tasks,
  profile,
  tasksPath,
  portfolioPath,
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
}) {
  const { scope, period, monthly, assignments, needsAnotherPhoto } = tasks
  const blocked = submitBlockedCopy(scope)
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  const openTaskIds = new Set(
    assignments.filter((a) => a.canSubmit).map((a) => a.requirement.id)
  )
  const overdue = assignments.filter(
    (a) => a.requirement.progress.overdue && !a.requirement.progress.satisfied
  ).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {[scope.venue?.name, period.label].filter(Boolean).join(" · ")}
        </p>
        <h1 className="font-display text-page-title-compact md:text-page-title">
          My tasks
        </h1>
        <ul
          aria-label="At a glance"
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
        >
          <li>{tasks.pendingReview} waiting for review</li>
          <li>
            {plural(needsAnotherPhoto.length, "photo needs", "photos need")}{" "}
            replacing
          </li>
          <li>
            {plural(assignments.length, "task", "tasks")} assigned
            {overdue > 0 ? ` (${overdue} overdue)` : ""}
          </li>
        </ul>
      </div>

      <SetupChecklist
        setup={scope.setup}
        profile={profile}
        editProfileHref={portfolioPath}
      />

      {blocked && scope.venue ? (
        <p
          role="status"
          className="rounded-md border bg-muted/40 px-4 py-3 text-sm"
        >
          {blocked}
        </p>
      ) : null}

      <MonthlyProgressCard
        monthly={monthly}
        periodLabel={period.label}
        addHref={`${tasksPath}/month`}
        canSubmit={scope.canSubmit}
      />

      <NeedsAnotherPhotoList
        submissions={needsAnotherPhoto}
        tasksPath={tasksPath}
        canSubmit={scope.canSubmit}
        openTaskIds={openTaskIds}
      />

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
