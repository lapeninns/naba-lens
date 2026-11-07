import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { WorkspacePending } from "@/components/nabalens/manager/workspace-pending"
import { getManagerWorkspace } from "@/lib/auth/manager"

export const metadata = { title: "Overview · Naba-Lens" }

/**
 * Overview. Phase 1: a neutral note until item review is switched on for the
 * venue. It reads the workspace itself rather than calling
 * requireManagerVenue(), which redirects here.
 */
export default async function ManagerOverviewPage() {
  const workspace = await getManagerWorkspace()
  // After a grant ends mid-session the layout is not re-rendered on client
  // navigation, so the page carries the unavailable state itself.
  if (workspace.status !== "available") {
    return <VenueAccessUnavailable reason={workspace.reason} />
  }
  const copy = MANAGER_COPY.overview
  return (
    <WorkspacePending
      venueName={workspace.venue.name}
      title={copy.title}
      noteTitle={copy.pendingTitle}
      note={copy.pendingBody}
    />
  )
}
