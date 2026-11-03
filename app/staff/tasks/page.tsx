import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import {
  TasksOverview,
  todoCount,
  todoItems,
  type JustSent,
} from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor, getMyTasks } from "@/lib/server/coverage"
import { listCommunityMedia } from "@/lib/server/community"
import { avatarUrl } from "@/lib/server/media/library"
import { getMediaActor } from "@/lib/server/media/context"

import { PORTFOLIO_PATH, TASKS_PATH, unwrap } from "./result"

export const metadata = { title: "Home · Naba-Lens" }

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** `?sent=2&task=<id>` or `?replaced=1&task=<id>` after a send. */
function parseJustSent(
  params: SearchParams,
  titleOf: (id: string | undefined) => string | null
): JustSent | null {
  const taskTitle = titleOf(first(params.task))
  if (first(params.replaced)) return { kind: "replaced", taskTitle }
  const count = Number.parseInt(first(params.sent) ?? "", 10)
  return count > 0 && count <= 10 ? { kind: "sent", count, taskTitle } : null
}

/** The newest colleague photos; Home still works when this read fails. */
async function recentColleaguePhotos() {
  try {
    const auth = await getMediaActor("staff")
    if (!auth.ok) return []
    const page = await listCommunityMedia(auth.actor)
    return page.ok ? page.items : []
  } catch {
    return []
  }
}

/** Staff Home: the next thing to do, this month's photos and all tasks. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const [{ tasks }, colleagues, params] = await Promise.all([
    getMyTasks(actor).then(unwrap),
    recentColleaguePhotos(),
    searchParams,
  ])

  const justSent = parseJustSent(
    params,
    (id) =>
      tasks.assignments.find((a) => a.requirement.id === id)?.requirement
        .title ?? null
  )

  return (
    <AppShell
      variant="staff"
      active="tasks"
      canManage={tasks.scope.canManageVenue}
      userName={profile.displayName}
      avatarUrl={avatarUrl(profile.id, profile.avatarPath)}
      todoCount={todoCount(todoItems(tasks))}
      logoutAction={logout}
    >
      <OfflineNotice className="mb-4" />
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
        justSent={justSent}
        colleagues={colleagues}
      />
    </AppShell>
  )
}
