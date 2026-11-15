import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { AllTasks, BackToTasks } from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"

import {
  myAmenityTasks,
  myTasks,
  staffShellStatus,
} from "../../_shell/shell-status"
import { TASKS_PATH, unwrap } from "../result"

export const metadata = { title: "All tasks" }

/** Every task and amenity check assigned to me; Home links here (§5a). */
export default async function AllTasksPage() {
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
          title="All tasks"
          summary="Overdue tasks still take photos."
        />
        <AllTasks
          tasks={tasks}
          tasksPath={TASKS_PATH}
          amenityTasks={amenityTasks}
        />
      </div>
    </AppShell>
  )
}
