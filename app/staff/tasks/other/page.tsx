import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { AllTasks, BackToTasks, otherJobs } from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"

import {
  myAmenityTasks,
  myTasks,
  staffShellStatus,
} from "../../_shell/shell-status"
import { TASKS_PATH, unwrap } from "../result"

export const metadata = { title: "Other jobs" }

/**
 * Other jobs (decisions 8 and 10, docs/plans/goals-not-tasks.md): the
 * service, venue-specific and amenity tasks and amenity checks assigned to me,
 * with their due dates (rule 28). Menu sections are left out: menu work is on
 * Our menu, and Home links here only when there is something to list.
 */
export default async function OtherJobsPage() {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const [{ tasks }, amenityTasks, shell] = await Promise.all([
    myTasks(actor).then(unwrap),
    myAmenityTasks(actor),
    staffShellStatus(actor, profile),
  ])

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter pb-4">
        <BackToTasks href={TASKS_PATH} />
        <PageHeader
          scope={[tasks.scope.venue?.name, tasks.period.label]}
          venueScope={Boolean(tasks.scope.venue)}
          title="Other jobs"
          summary="Overdue jobs still take photos."
        />
        <AllTasks
          tasks={otherJobs(tasks)}
          tasksPath={TASKS_PATH}
          amenityTasks={amenityTasks}
        />
      </div>
    </AppShell>
  )
}
