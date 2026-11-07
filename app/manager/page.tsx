import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { getManagerWorkspace } from "@/lib/auth/manager"

import { failedRead, loadManagerOverview } from "./load-overview"

export const metadata = { title: "Overview · Naba-Lens" }

/**
 * Overview: the venue's menu photo progress and what is waiting for a
 * decision. It reads the workspace itself rather than calling
 * requireManagerVenue(), which redirects here. A failed read goes to
 * error.tsx (Try again).
 */
export default async function ManagerOverviewPage() {
  const workspace = await getManagerWorkspace()
  // After a grant ends mid-session the layout is not re-rendered on client
  // navigation, so the page carries the unavailable state itself.
  if (workspace.status !== "available") {
    return <VenueAccessUnavailable reason={workspace.reason} />
  }
  const read = await loadManagerOverview()
  if (!read.ok) failedRead(read.code)
  return (
    <OverviewBody overview={read.overview} now={new Date().toISOString()} />
  )
}
