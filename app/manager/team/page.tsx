import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { TeamTargets } from "@/components/nabalens/manager/team/team-targets"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { getVenueTargets } from "@/lib/server/coverage/targets"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

import { failedRead, isRefusal } from "../load-overview"
import { setPersonTargetAction, setVenueDefaultTargetAction } from "./actions"

export const metadata = { title: "Team targets" }

/**
 * Team targets (G-6, decisions 16 and 17): the venue default monthly photo
 * target and each person's own number, this month. The layout is not
 * re-rendered on client navigation, so a grant that ended mid-session is met
 * here; every save checks the grant again in the database.
 */
export default async function ManagerTeamPage() {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available") {
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  }
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) {
    if (isRefusal(scope.code))
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    failedRead(scope.code, MANAGER_COPY.couldNotLoad.team, "/manager/team")
  }
  const read = await getVenueTargets(scope.ctx)
  if (!read.ok) {
    if (isRefusal(read.code))
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    failedRead(read.code, MANAGER_COPY.couldNotLoad.team, "/manager/team")
  }
  const copy = MANAGER_COPY.team
  const { view } = read
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <PageHeader
        scope={workspace.venue.name}
        venueScope
        title={copy.title}
        summary={copy.summary(view.period.label)}
        className="pb-0 md:pb-0"
      />
      <TeamTargets
        view={view}
        onSetDefault={setVenueDefaultTargetAction}
        onSetPerson={setPersonTargetAction}
      />
    </div>
  )
}
