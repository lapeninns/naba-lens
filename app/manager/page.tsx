import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import { TeamCompletionTargets } from "@/components/nabalens/manager/overview/team-completion-targets"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { ROUTES } from "@/lib/auth/routes"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getAmenityActor } from "@/lib/server/amenities"
import { getManagerCompletionRoster } from "@/lib/server/coverage/venue"

import { failedRead, isRefusal, loadManagerOverview } from "./load-overview"

export const metadata = { title: "Overview · Naba-Lens" }

/**
 * Overview: the venue's menu photo progress and what is waiting for a
 * decision. It reads the workspace itself rather than calling
 * requireManagerVenue(), which redirects here, as does a read the database
 * refuses on any page below. A failed read goes to error.tsx (Try again).
 */
/** Amenity findings waiting for this manager; null when unreadable (MG-03). */
async function countToConfirm(): Promise<number | null> {
  try {
    const auth = await getAmenityActor()
    if (!auth.ok) return null
    const result = await knowledgeServices.listToConfirm(auth.actor, {})
    return result.ok ? result.view.count : null
  } catch {
    return null
  }
}

export default async function ManagerOverviewPage() {
  const workspace = await getManagerWorkspace()
  // After a grant ends mid-session the layout is not re-rendered on client
  // navigation, so the page carries the unavailable state itself and asks
  // for a refresh that replaces the shell.
  if (workspace.status !== "available") {
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  }
  const read = await loadManagerOverview()
  if (!read.ok) {
    // Ended between the workspace read and this one; never redirect to
    // ourselves.
    if (isRefusal(read.code))
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    failedRead(read.code, "the overview", ROUTES.managerHome)
  }
  const [team, confirmCount] = await Promise.all([
    getManagerCompletionRoster(read.ctx),
    countToConfirm(),
  ])
  if (!team.ok && isRefusal(team.code)) {
    return <VenueAccessUnavailable reason="no_grant" refreshShell />
  }
  // The layout's time stops describing a page once it is navigated to, so
  // each page says when it was rendered itself.
  const now = new Date().toISOString()
  return (
    <>
      <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
      <OverviewBody
        overview={read.overview}
        now={now}
        confirmCount={confirmCount}
        staffTargets={
          team.ok ? (
            <TeamCompletionTargets roster={team.roster} />
          ) : (
            <Notice role="status">Staff targets couldn’t be loaded.</Notice>
          )
        }
      />
    </>
  )
}
