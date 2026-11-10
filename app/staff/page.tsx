import {
  discardKnowledgeDraftAction,
  listMyFindingsAction,
  loadMoreContributionsAction,
} from "@/app/_knowledge/actions"
import { AppShell } from "@/components/nabalens"
import { YourFindings } from "@/components/nabalens/knowledge/findings-history"
import { MyContributions } from "@/components/nabalens/knowledge/my-contributions"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import {
  myContributionsSurface,
  type MyContributionsSurface,
} from "@/lib/config/my-contributions"
import { workRoleLabel } from "@/lib/config/work-roles"
import type { ContributionsFeedPage } from "@/lib/knowledge/contract"
import { listMyMenuPhotoDecisions } from "@/lib/server/coverage"
import type { MyMenuPhotoState } from "@/lib/server/coverage/types"
import { getMediaActor } from "@/lib/server/media/context"
import { listOwnMedia, listOwnMediaByIds } from "@/lib/server/media/library"
import type { MediaActor, MediaItemView } from "@/lib/server/media/types"
import type {
  FindingSummary,
  FindingsPage,
} from "@/lib/knowledge-client/contract"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { workServices } from "@/lib/work-client/services"

import { myWorkingList, staffShellStatus } from "./_shell/shell-status"
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

/**
 * The first page of "Your findings", and whether to show the section: when
 * there is history, or my venue has questions to answer. A venue outside the
 * knowledge pilot with nothing sent shows nothing, and a failed read is only
 * reported where there is a list to answer.
 */
async function yourFindings(
  actor: MediaActor
): Promise<{ show: boolean; page: FindingsPage | null }> {
  const [result, list] = await Promise.all([
    // Me still works when this read fails or throws.
    (async () => knowledgeServices.listMyFindings(actor, {}))().catch(
      () => null
    ),
    myWorkingList(actor),
  ])
  const page = result?.ok ? result.page : null
  const onList = (list?.slots.length ?? 0) > 0
  const history =
    page !== null &&
    (page.items.length > 0 || page.hiddenEarlierVenues.length > 0)
  return { show: history || onList, page }
}

type History =
  | { kind: "b01"; show: boolean; page: FindingsPage | null }
  | {
      kind: "b02"
      show: boolean
      page: ContributionsFeedPage | null
      drafts: FindingSummary[] | null
    }

/**
 * Me's history: My contributions (B02 §6.1) when switched on and the
 * database has its read; otherwise B01's "Your findings". Shown, as B01, when
 * there is history or my venue has questions to answer.
 */
async function history(
  actor: MediaActor,
  surface: MyContributionsSurface
): Promise<History> {
  if (surface === "b01") return { kind: "b01", ...(await yourFindings(actor)) }
  const [feed, findings, list] = await Promise.all([
    (async () => workServices.getContributions(actor))().catch(() => null),
    (async () => knowledgeServices.listMyFindings(actor, {}))().catch(
      () => null
    ),
    myWorkingList(actor),
  ])
  if (feed?.status === "missing")
    return { kind: "b01", ...(await yourFindings(actor)) }
  const page = feed?.status === "ok" ? feed.value : null
  // The feed doesn't page drafts; they stay B01's.
  const drafts = findings?.ok
    ? findings.page.items.filter((item) => item.state === "saved")
    : null
  const onList = (list?.slots.length ?? 0) > 0
  const sent = (page?.items.length ?? 0) > 0 || (drafts?.length ?? 0) > 0
  return { kind: "b02", show: sent || onList, page, drafts }
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
  const [page, shell, params, menuPhotos, findings] = await Promise.all([
    listOwnMedia(auth.actor),
    staffShellStatus(auth.actor, profile),
    searchParams ?? Promise.resolve({} as SearchParams),
    menuPhotoDecisions(auth.actor),
    history(auth.actor, myContributionsSurface()),
  ])
  if (!page.ok) throw new Error(page.message)
  const blocked = uploadBlockReason(profile)
  // A failed count read keeps the row (Manage re-reads it) without a number.
  const { canManage, reviewCount, avatarUrl: avatar } = shell
  const work = profile.work ?? null
  const venue =
    profile.venueId && profile.venue
      ? { id: profile.venueId, name: profile.venue.name }
      : null

  return (
    <AppShell
      variant="staff"
      active="portfolio"
      {...shell}
      userName={profile.displayName}
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
        findings={
          !findings.show ? null : findings.kind === "b02" ? (
            <MyContributions
              initial={findings.page}
              drafts={findings.drafts}
              venue={venue}
              offMenuPhotoIds={menuPhotos.states.flatMap((state) =>
                state.state === "better_photo_requested" &&
                state.canRetake === false
                  ? [state.photoId]
                  : []
              )}
              loadMore={loadMoreContributionsAction}
              onDiscardDraft={discardKnowledgeDraftAction}
              viewerId={profile.id}
            />
          ) : (
            <YourFindings
              initial={findings.page}
              venue={venue}
              loadMore={listMyFindingsAction}
              onDiscardDraft={discardKnowledgeDraftAction}
              viewerId={profile.id}
            />
          )
        }
      />
    </AppShell>
  )
}
