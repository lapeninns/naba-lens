import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { TasksOverview } from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor, getMyTasks } from "@/lib/server/coverage"

import { PORTFOLIO_PATH, TASKS_PATH, unwrap } from "./result"

export const metadata = { title: "My tasks · Naba-Lens" }

/** Staff landing: setup, this month's photos, replacements and assigned tasks. */
export default async function TasksPage() {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const { tasks } = unwrap(await getMyTasks(actor))

  return (
    <AppShell
      variant="staff"
      active="tasks"
      canManage={tasks.scope.canManageVenue}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <TasksOverview
        tasks={tasks}
        profile={{
          displayName: profile.displayName,
          venueName: profile.venue?.name ?? null,
          department: profile.department ?? null,
          hasAvatar: profile.avatarPath !== null,
        }}
        tasksPath={TASKS_PATH}
        portfolioPath={PORTFOLIO_PATH}
      />
    </AppShell>
  )
}
