import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import { TeamCompletionTargets } from "@/components/nabalens/manager/overview/team-completion-targets"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { Notice } from "@/components/nabalens/notice"
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
/** Amenity findings waiting for this manager; 0 when unreadable. */
async function countToConfirm(): Promise<number> {
  try {
    const auth = await getAmenityActor()
    if (!auth.ok) return 0
    const result = await knowledgeServices.listToConfirm(auth.actor, {})
    return result.ok ? result.view.count : 0
  } catch {
    return 0
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
  return (
    <OverviewBody
      overview={read.overview}
      now={new Date().toISOString()}
      confirmCount={confirmCount}
      staffTargets={
        team.ok ? (
          <TeamCompletionTargets roster={team.roster} />
        ) : (
          <Notice role="status">Staff targets couldn’t be loaded.</Notice>
        )
      }
    />
  )
}
