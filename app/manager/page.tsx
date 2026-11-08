import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { ROUTES } from "@/lib/auth/routes"

import { failedRead, isRefusal, loadManagerOverview } from "./load-overview"

export const metadata = { title: "Overview · Naba-Lens" }

/**
 * Overview: the venue's menu photo progress and what is waiting for a
 * decision. It reads the workspace itself rather than calling
 * requireManagerVenue(), which redirects here, as does a read the database
 * refuses on any page below. A failed read goes to error.tsx (Try again).
 */
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
  return (
    <OverviewBody overview={read.overview} now={new Date().toISOString()} />
  )
}
