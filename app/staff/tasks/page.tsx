import { cookies } from "next/headers"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import {
  TasksOverview,
  todoCount,
  FIRST_RUN_COOKIE,
  isNewStarter,
  todoItems,
  type JustSent,
} from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import {
  getCoverageActor,
  getManagerReviewCount,
  getMyTasks,
} from "@/lib/server/coverage"
import { listCommunityMedia } from "@/lib/server/community"
import { avatarUrl } from "@/lib/server/media/library"
import { getMediaActor } from "@/lib/server/media/context"

import { WELCOME_PATH, PORTFOLIO_PATH, TASKS_PATH, unwrap } from "./result"

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
  const myTasks = getMyTasks(actor).then(unwrap)
  const [{ tasks }, colleagues, params, review] = await Promise.all([
    myTasks,
    recentColleaguePhotos(),
    searchParams,
    myTasks.then(({ tasks }) =>
      tasks.scope.canManageVenue ? getManagerReviewCount(actor) : null
    ),
  ])
  const reviewCount = review?.ok ? review.count : undefined

  const seenWelcome = (await cookies()).has(FIRST_RUN_COOKIE)

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
      todoCount={todoCount(todoItems(tasks, new Date(), reviewCount))}
      reviewCount={reviewCount}
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
        reviewCount={reviewCount}
        justSent={justSent}
        colleagues={colleagues}
        welcomeHref={!seenWelcome && isNewStarter(tasks) ? WELCOME_PATH : null}
      />
    </AppShell>
  )
}
