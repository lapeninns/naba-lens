import { cookies } from "next/headers"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { FINDING_SENT_PARAM } from "@/components/nabalens/amenities/capture/finding-sent"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import type { OurMenuProgress } from "@/components/nabalens/home/our-menu-card"
import {
  TasksOverview,
  FIRST_RUN_COOKIE,
  showWelcomeEntry,
  type JustSent,
} from "@/components/nabalens/tasks"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { homePrompt } from "@/lib/config/work-roles"
import { getCheck } from "@/lib/server/amenities"
import { getCoverageActor, getOurMenu } from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"
import { listCommunityMedia } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import {
  myAmenityTasks,
  myTasks,
  staffShellStatus,
} from "../_shell/shell-status"
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

/**
 * The question of the amenity check named by `?finding_sent=<id>`, but only
 * once the database shows it complete and answered by me: the notice is never
 * shown on the word of the URL alone.
 */
async function sentFinding(
  actor: MediaActor,
  params: SearchParams
): Promise<string | null> {
  const checkId = first(params[FINDING_SENT_PARAM])
  if (!checkId) return null
  try {
    const result = await getCheck(actor, { checkId })
    if (!result.ok) return null
    const { check } = result.detail
    return check.progress === "complete" &&
      check.answeredBy?.id === actor.profile.id
      ? check.entry.question
      : null
  } catch {
    return null
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
  const dismissedAt = profile.work?.welcomeDismissedAt ?? null
  const [
    { tasks },
    colleagues,
    params,
    shell,
    ownMedia,
    ourMenu,
    jar,
    amenityTasks,
    findingSent,
  ] = await Promise.all([
    myTasks(actor).then(unwrap),
    recentColleaguePhotos(),
    searchParams,
    staffShellStatus(actor, profile),
    // Once dismissed, Start here never shows, so skip the read.
    dismissedAt ? true : hasOwnMedia(actor),
    ourMenuProgress(actor, Boolean(profile.venueId)),
    cookies(),
    myAmenityTasks(actor),
    searchParams.then((p) => sentFinding(actor, p)),
  ])
  const { reviewCount } = shell
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
      {...shell}
      userName={profile.displayName}
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
        amenityTasks={amenityTasks}
        findingSent={findingSent}
      />
    </AppShell>
  )
}
