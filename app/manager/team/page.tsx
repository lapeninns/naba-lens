import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { TeamTargets } from "@/components/nabalens/manager/team/team-targets"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { PageHeader } from "@/components/nabalens/page-header"
import { Card } from "@/components/nabalens/common-room"
import { VenueSwitcher } from "@/components/nabalens/venue-switcher"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { switchVenueAction } from "@/lib/auth/venue-actions"
import { listMyVenues } from "@/lib/auth/venues"
import { listVenueTeam } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import { getVenueTargets } from "@/lib/server/coverage/targets"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

import { failedRead, isRefusal } from "../load-overview"
import { VenuePeople } from "./venue-people"
import {
  inviteVenueStaffAction,
  removeVenueStaffAction,
  setPersonTargetAction,
  setVenueDefaultTargetAction,
  backToVenueDefaultAction,
} from "./actions"

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
  // People at the venue and the person's own venues (S1-PEOPLE, FA-22).
  const ctx = await accountsContext()
  const [team, venues] = await Promise.all([
    listVenueTeam(ctx, workspace.venue.id),
    listMyVenues(ctx.caller),
  ])
  if (!team.ok) {
    if (team.code === "forbidden")
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    failedRead(
      "database_failed",
      MANAGER_COPY.couldNotLoad.team,
      "/manager/team"
    )
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
        title={MANAGER_COPY.venue.title}
        summary={copy.summary(view.period.label)}
        className="pb-0 md:pb-0"
      />
      <ManagerTabs section="venue" active="team" />
      <TeamTargets
        view={view}
        onSetDefault={setVenueDefaultTargetAction}
        onSetPerson={setPersonTargetAction}
        onUseDefault={backToVenueDefaultAction}
      />
      <VenuePeople
        venue={workspace.venue}
        selfId={workspace.profile.id}
        people={team.members.map((m) => ({
          profileId: m.profileId,
          displayName: m.displayName,
          jobTitle: m.jobTitle,
          role: m.membershipRole,
          workingHere: m.isActiveVenue,
        }))}
        onInvite={inviteVenueStaffAction}
        onRemove={removeVenueStaffAction}
      />
      {venues.length > 1 ? (
        <Card>
          <VenueSwitcher venues={venues} onSwitch={switchVenueAction} />
        </Card>
      ) : null}
    </div>
  )
}
