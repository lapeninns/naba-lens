import {
  discardKnowledgeDraftAction,
  listMyFindingsAction,
  loadMoreContributionsAction,
} from "@/app/_knowledge/actions"
import {
  changeUploadSlotAction,
  loadMyUploadsAction,
  reportSlotChangeAction,
  requestUploadRemovalAction,
  setCapturedAtAction,
  withdrawUploadAction,
} from "@/app/staff/_me/actions"
import { loadMatchBoardAction } from "@/app/staff/_shell/match-actions"
import { AppShell } from "@/components/nabalens"
import { CANT_ADD_HREF } from "@/components/nabalens/guide"
import { MeAccount } from "@/components/nabalens/me/me-account"
import { MyUploads } from "@/components/nabalens/me/my-uploads"
import type { VenueSwitcherVenue } from "@/components/nabalens/venue-switcher"
import { listMyVenues } from "@/lib/auth/venues"
import { switchVenueAction } from "@/lib/auth/venue-actions"
import {
  getMonthReplacements,
  getMyUploads,
  getMyVenueManagers,
  listMySlotReports,
} from "@/lib/server/staff"
import { YourMonthCard } from "@/components/nabalens/album/your-month-card"
import { YourFindings } from "@/components/nabalens/knowledge/findings-history"
import { MyContributions } from "@/components/nabalens/knowledge/my-contributions"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import {
  myContributionsSurface,
  type MyContributionsSurface,
} from "@/lib/config/my-contributions"
import { workRoleLabel } from "@/lib/config/work-roles"
import type { ContributionsFeedPage } from "@/lib/knowledge/contract"
import {
  listMyMenuPhotoDecisions,
  listMyRetakeNotes,
} from "@/lib/server/coverage"
import type { MyMenuPhotoState, RetakeNote } from "@/lib/server/coverage/types"
import { getMediaActor } from "@/lib/server/media/context"
import { listOwnMedia, listOwnMediaByIds } from "@/lib/server/media/library"
import type { MediaActor, MediaItemView } from "@/lib/server/media/types"
import type {
  FindingSummary,
  FindingsPage,
} from "@/lib/knowledge-client/contract"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { workServices } from "@/lib/work-client/services"

import {
  myOtherJobsCount,
  myUnreadNotices,
  myWorkingList,
  ownMonth,
  staffShellStatus,
} from "./_shell/shell-status"
import { getMyAreaLabels } from "@/lib/server/area-photos"
import { isMenuUse } from "@/lib/staff/my-uploads"

import { ADD_BLOCKED } from "./add-blocked"
import { StaffPortfolio } from "./staff-portfolio"

export const metadata = { title: "Me" }

// finaliseUpload (Server Action on this page) decodes HEIC/images; keep the
// bound explicit and below MEDIA_LIMITS.staleProcessingMinutes.
export const maxDuration = 120

type SearchParams = Record<string, string | string[] | undefined>

/** Photos shown in Me's "Accepted for menu use". */
const DECISION_TILES = 24

/**
 * The caller's newest menu decisions accepted for public use (X9: not a
 * photo kept as reference) and their photos, whichever
 * gallery page the photos are on; Me still works when this fails. Retake
 * notes are read separately (my_retake_notes).
 */
async function menuPhotoDecisions(
  actor: MediaActor
): Promise<{ states: MyMenuPhotoState[]; items: MediaItemView[] }> {
  try {
    const result = await listMyMenuPhotoDecisions(actor)
    if (!result.ok) return { states: [], items: [] }
    const ids = new Set<string>()
    for (const state of result.states) {
      if (!isMenuUse(state) || ids.size >= DECISION_TILES) continue
      ids.add(state.assetId)
    }
    const media = await listOwnMediaByIds(actor, [...ids])
    return { states: result.states, items: media.ok ? media.items : [] }
  } catch {
    return { states: [], items: [] }
  }
}

/**
 * Photos on Me's first page that carry my venue area (G-9): they are
 * labelled, so "Needs labels" leaves them out. A failed read leaves none out.
 */
async function myAreaLabelled(
  actor: MediaActor,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  try {
    const result = await getMyAreaLabels(actor, ids.slice(0, 100))
    return result.ok ? result.labels.map((label) => label.assetId) : []
  } catch {
    return []
  }
}

/**
 * My retake notes (G-3), shared with Home; Me still works when this fails
 * (the block is left out).
 */
async function retakeNotes(actor: MediaActor): Promise<RetakeNote[]> {
  try {
    const result = await listMyRetakeNotes(actor)
    return result.ok ? result.notes : []
  } catch {
    return []
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

/**
 * Me's own reads for My uploads and Help and account (S2-STAFF). Each one
 * that fails is left out or marked unread on its own; Me never fails for
 * them.
 */
async function meReads(actor: MediaActor) {
  const safe = <T,>(p: Promise<T>) => p.catch(() => null)
  const [uploads, venues, unread, managers, month, reports] = await Promise.all(
    [
      safe(getMyUploads(actor)),
      safe(listMyVenues(actor.db)),
      safe(myUnreadNotices(actor)),
      safe(getMyVenueManagers(actor)),
      safe(getMonthReplacements(actor)),
      safe(listMySlotReports(actor)),
    ]
  )
  return {
    uploads: uploads?.ok ? uploads.page : null,
    venues: venues as VenueSwitcherVenue[] | null,
    unread,
    managers: managers?.ok ? managers.managers : null,
    month: month?.ok ? month.month : null,
    correctionsAsked: reports?.ok
      ? reports.reports
          .filter((r) => r.subjectKind === "photo" && r.state === "open")
          .map((r) => r.subjectId)
      : [],
  }
}

/** Me: own profile, Add photos, own month and links, and newest-first own gallery. */
export default async function StaffPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
} = {}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const [
    page,
    shell,
    params,
    menuPhotos,
    findings,
    notes,
    month,
    otherJobs,
    me,
  ] = await Promise.all([
    listOwnMedia(auth.actor),
    staffShellStatus(auth.actor, profile),
    searchParams ?? Promise.resolve({} as SearchParams),
    menuPhotoDecisions(auth.actor),
    history(auth.actor, myContributionsSurface()),
    retakeNotes(auth.actor),
    ownMonth(auth.actor),
    myOtherJobsCount(auth.actor),
    meReads(auth.actor),
  ])
  if (!page.ok) throw new Error(page.message)
  const areaLabelled = await myAreaLabelled(
    auth.actor,
    page.items.map((item) => item.id)
  )
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
      venueName={profile.venue?.name}
      monthly={month}
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
        uploadBlocked={blocked ? ADD_BLOCKED[blocked] : null}
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
        retakeNotes={notes}
        areaLabelled={areaLabelled}
        month={<YourMonthCard monthly={month} replacements={me.month} />}
        myUploads={
          <MyUploads
            initial={me.uploads}
            currentVenueId={profile.venueId ?? null}
            correctionsAsked={me.correctionsAsked}
            actions={{
              loadMore: loadMyUploadsAction,
              withdraw: withdrawUploadAction,
              changeSlot: changeUploadSlotAction,
              loadBoard: loadMatchBoardAction,
              setCapturedAt: setCapturedAtAction,
              requestRemoval: requestUploadRemovalAction,
              report: reportSlotChangeAction,
            }}
          />
        }
        account={
          <MeAccount
            venues={me.venues}
            switchVenue={switchVenueAction}
            managers={me.managers}
            unread={me.unread}
            helpHref={CANT_ADD_HREF}
          />
        }
        otherJobs={otherJobs}
        findings={
          !findings.show ? null : findings.kind === "b02" ? (
            <MyContributions
              initial={findings.page}
              drafts={findings.drafts}
              venue={venue}
              offMenuPhotoIds={notes.flatMap((note) =>
                note.kind === "menu" &&
                note.status !== "cleared" &&
                !note.canRetake
                  ? [note.noteId]
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
