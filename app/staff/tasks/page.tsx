import { cookies } from "next/headers"

import { logout } from "@/app/_media/actions"
import { AmenityTaskList } from "@/components/nabalens/amenities/capture"
import { AppShell } from "@/components/nabalens/app-shell"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import type { OurMenuProgress } from "@/components/nabalens/home/our-menu-card"
import {
  TasksOverview,
  todoCount,
  FIRST_RUN_COOKIE,
  showWelcomeEntry,
  todoItems,
  type JustSent,
} from "@/components/nabalens/tasks"
import type { MyAmenityTask } from "@/lib/amenities/contract"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { homePrompt } from "@/lib/config/work-roles"
import { getMyAmenityTasks } from "@/lib/server/amenities"
import {
  getCoverageActor,
  getManagerReviewCount,
  getMyTasks,
  getOurMenu,
} from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"
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

/**
 * Whether the person has any photo or video of their own (one id, no URLs).
 * A failed read counts as yes, so Start here stays away rather than nag.
 */
async function hasOwnMedia(actor: MediaActor): Promise<boolean> {
  try {
    const { data, error } = await actor.db
      .from("media_assets")
      .select("id")
      .eq("uploader_id", actor.profile.id)
      .limit(1)
    return error ? true : (data?.length ?? 0) > 0
  } catch {
    return true
  }
}

/** Our menu for the person's venue; a failed read never breaks Home. */
async function ourMenuProgress(
  actor: MediaActor,
  hasVenue: boolean
): Promise<OurMenuProgress | null> {
  if (!hasVenue) return null
  try {
    const result = await getOurMenu(actor, {})
    if (!result.ok)
      return result.code === "needs_setup" ? null : { state: "unavailable" }
    const { menuState, totals } = result.menu
    return menuState === "ready"
      ? { state: "ready", covered: totals.covered, total: totals.eligible }
      : { state: menuState }
  } catch {
    return { state: "unavailable" }
  }
}

/** Amenity checks assigned to me; a failed read hides the section, never Home. */
async function myAmenityTasks(actor: MediaActor): Promise<MyAmenityTask[]> {
  try {
    const result = await getMyAmenityTasks(actor, {})
    return result.ok ? result.tasks : []
  } catch {
    return []
  }
}

const UPLOAD_BLOCKED = {
  not_staff: "Only staff accounts can add photos.",
  no_venue: "You can't add photos until an admin assigns your venue.",
  venue_inactive:
    "Your venue isn't taking photos right now, so you can't add any. Ask an admin to check your venue.",
} as const

/** Staff Home: the next thing to do, this month's photos and all tasks. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const myTasks = getMyTasks(actor).then(unwrap)
  const dismissedAt = profile.work?.welcomeDismissedAt ?? null
  const [
    { tasks },
    colleagues,
    params,
    review,
    ownMedia,
    ourMenu,
    jar,
    amenityTasks,
  ] = await Promise.all([
    myTasks,
    recentColleaguePhotos(),
    searchParams,
    myTasks.then(({ tasks }) =>
      tasks.scope.canManageVenue ? getManagerReviewCount(actor) : null
    ),
    // Once dismissed, Start here never shows, so skip the read.
    dismissedAt ? true : hasOwnMedia(actor),
    ourMenuProgress(actor, Boolean(profile.venueId)),
    cookies(),
    myAmenityTasks(actor),
  ])
  const reviewCount = review?.ok ? review.count : undefined
  const blockedReason = uploadBlockReason(profile)

  // The legacy cookie is still read (people who saw the old welcome keep it
  // dismissed) but no longer written: dismissal lives in the database.
  const showWelcome = showWelcomeEntry({
    dismissedAt,
    legacyCookie: jar.has(FIRST_RUN_COOKIE),
    hasOwnMedia: ownMedia,
  })

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
      <OfflineNotice className="mb-3" />
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
        welcomeHref={showWelcome ? WELCOME_PATH : null}
        contribute={{
          prompt: homePrompt(profile.work?.roleKey),
          blocked: blockedReason ? UPLOAD_BLOCKED[blockedReason] : null,
        }}
        ourMenu={ourMenu}
        amenityChecks={<AmenityTaskList tasks={amenityTasks} />}
      />
    </AppShell>
  )
}
