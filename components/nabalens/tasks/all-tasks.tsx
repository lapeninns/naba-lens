import type { MyAmenityTask } from "@/lib/amenities/contract"

import { AmenityTaskList } from "../amenities/capture/amenity-task-list"
import { EmptyState } from "../empty-state"
import { Notice } from "../notice"
import { CountBadge } from "../status-chip"
import { AssignmentList } from "./assignment-list"
import type { MyTasksView } from "./types"

/**
 * Other jobs (G-4): the assignments that stay tasks, everything but menu
 * sections (decision 8). Menu work, and sending section shots (decision 15),
 * lives on Our menu and the month.
 */
export function otherJobs<T extends Pick<MyTasksView, "assignments">>(
  tasks: T
): T {
  return {
    ...tasks,
    assignments: tasks.assignments.filter(
      (a) => a.requirement.kind !== "menu_section"
    ),
  }
}

/**
 * The assignment list on Other jobs (`/staff/tasks/other`): every task
 * assigned to me this month, then my amenity checks. Home links here (§5a).
 */
export function AllTasks({
  tasks,
  tasksPath,
  amenityTasks = [],
}: {
  tasks: Pick<MyTasksView, "scope" | "assignments" | "needsAnotherPhoto">
  /** "/staff/tasks" */
  tasksPath: string
  /** Null when they couldn't be read. */
  amenityTasks?: MyAmenityTask[] | null
}) {
  const { scope, assignments, needsAnotherPhoto } = tasks
  const venue = scope.venue?.name ?? "your venue"
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  return (
    <>
      <section aria-labelledby="assigned-heading" className="grid gap-gutter">
        <h2
          id="assigned-heading"
          className="flex items-center gap-2 px-1 pt-2 type-section-title text-ink"
        >
          Assigned to you
          <CountBadge count={assignments.length} label="tasks" />
        </h2>
        {assignments.length > 0 ? (
          <AssignmentList
            assignments={assignments}
            tasksPath={tasksPath}
            needsAnotherPhoto={replacing}
          />
        ) : (
          <EmptyState
            variant="done"
            className="rounded-card bg-surface px-4 shadow-card"
            title="Nothing is assigned to you this month."
            description={`Your manager assigns tasks at ${venue}. You can still add photos to your profile.`}
          />
        )}
      </section>
      {amenityTasks === null ? (
        <Notice tone="negative">
          {"We couldn't check your amenity checks."}
        </Notice>
      ) : (
        <AmenityTaskList tasks={amenityTasks} />
      )}
    </>
  )
}
