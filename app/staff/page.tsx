import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens"
import { todoCount, todoItems } from "@/components/nabalens/tasks"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { workRoleLabel } from "@/lib/config/work-roles"
import {
  getManagerReviewCount,
  getMyTasks,
  listMyMenuPhotoDecisions,
} from "@/lib/server/coverage"
import type { MyMenuPhotoState } from "@/lib/server/coverage/types"
import { getMediaActor } from "@/lib/server/media/context"
import {
  avatarUrl,
  listOwnMedia,
  listOwnMediaByIds,
} from "@/lib/server/media/library"
import type { MediaActor, MediaItemView } from "@/lib/server/media/types"

import { canManageVenue } from "./can-manage"
import { StaffPortfolio } from "./staff-portfolio"

const BLOCKED_COPY = {
  not_staff: "Only staff accounts can upload.",
  no_venue:
    "Your account is not assigned to a venue yet, so uploads are paused. Ask an admin to assign your venue.",
  venue_inactive:
    "Your venue is not taking uploads right now, so uploads are paused. Ask an admin to check your venue.",
} as const

export const metadata = { title: "Your portfolio · Naba-Lens" }

// finaliseUpload (Server Action on this page) decodes HEIC/images; keep the
// bound explicit and below MEDIA_LIMITS.staleProcessingMinutes.
export const maxDuration = 120

type SearchParams = Record<string, string | string[] | undefined>

/** Home's To do count for the shell badge; none when the read fails. */
async function homeTodoCount(
  actor: MediaActor,
  reviewCount: number | undefined
): Promise<number | undefined> {
  try {
    const result = await getMyTasks(actor)
    return result.ok
      ? todoCount(todoItems(result.tasks, new Date(), reviewCount))
      : undefined
  } catch {
    return undefined
  }
}

/** Photos shown per Me decision section (accepted, better photo requested). */
const DECISION_TILES = 24

/**
 * The caller's newest menu decisions and their photos, whichever gallery page
 * the photos are on; Me still works when this fails.
 */
async function menuPhotoDecisions(
  actor: MediaActor
): Promise<{ states: MyMenuPhotoState[]; items: MediaItemView[] }> {
  try {
    const result = await listMyMenuPhotoDecisions(actor)
    if (!result.ok) return { states: [], items: [] }
    const ids: string[] = []
    for (const kind of ["accepted", "better_photo_requested"] as const) {
      const own = new Set<string>()
      for (const state of result.states) {
        if (state.state !== kind || own.size >= DECISION_TILES) continue
        own.add(state.assetId)
      }
      for (const id of own) if (!ids.includes(id)) ids.push(id)
    }
    const media = await listOwnMediaByIds(actor, ids)
    return { states: result.states, items: media.ok ? media.items : [] }
  } catch {
    return { states: [], items: [] }
  }
}

/** Staff home: own profile, Upload action and newest-first own gallery. */
export default async function StaffPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
} = {}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const [page, canManage, params] = await Promise.all([
    listOwnMedia(auth.actor),
    canManageVenue(auth.actor),
    searchParams ?? Promise.resolve({} as SearchParams),
  ])
  if (!page.ok) throw new Error(page.message)
  const blocked = uploadBlockReason(profile)
  // A failed count read keeps the row (Manage re-reads it) without a number.
  const review = canManage ? await getManagerReviewCount(auth.actor) : null
  const reviewCount = review?.ok ? review.count : undefined
  const [todo, menuPhotos] = await Promise.all([
    homeTodoCount(auth.actor, reviewCount),
    menuPhotoDecisions(auth.actor),
  ])
  const work = profile.work ?? null
  const avatar = avatarUrl(profile.id, profile.avatarPath)

  return (
    <AppShell
      variant="staff"
      active="portfolio"
      canManage={canManage}
      reviewCount={reviewCount}
      userName={profile.displayName}
      avatarUrl={avatar}
      todoCount={todo}
      logoutAction={logout}
    >
      <StaffPortfolio
        profile={{
          displayName: profile.displayName,
          jobTitle: profile.jobTitle,
          department: profile.department,
          venueName: profile.venue?.name ?? null,
          avatarUrl: avatar,
          workRole: work?.roleKey
            ? workRoleLabel(work.roleKey, work.roleTitle)
            : null,
        }}
        uploadBlocked={blocked ? BLOCKED_COPY[blocked] : null}
        initialPage={{ items: page.items, nextCursor: page.nextCursor }}
        manage={
          canManage
            ? {
                venueName: profile.venue?.name ?? null,
                reviewCount: reviewCount ?? 0,
              }
            : null
        }
        initialEditOpen={params.edit === "profile"}
        menuPhotos={menuPhotos.states}
        menuPhotoItems={menuPhotos.items}
      />
    </AppShell>
  )
}
