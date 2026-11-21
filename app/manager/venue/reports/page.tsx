import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { SlotReportsList } from "@/components/nabalens/manager/venue/slot-reports-list"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { getMediaActor } from "@/lib/server/media/context"
import { listVenueSlotReports } from "@/lib/server/staff"

export const metadata = { title: "Reported changes" }

/**
 * Venue › Reported changes (S3-R5, K3; spec §6 S3, S4, §7 M5): the venue's
 * open slot change reports and photo correction requests, oldest first, each
 * with a link to what it is about, Dealt with and Dismiss. The database lists
 * only the manager's own venue (S2-STAFF's slot_change_reports).
 */
export default async function ManagerVenueReportsPage() {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  const auth = await getMediaActor("manager")
  if (!auth.ok) {
    if (auth.status === 403)
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    throw new Error(auth.message)
  }
  const result = await listVenueSlotReports(auth.actor, {
    venueId: workspace.venue.id,
    state: "open",
  }).catch(() => null)
  if (result && !result.ok && result.code === "forbidden")
    return <VenueAccessUnavailable reason="no_grant" refreshShell />
  const copy = MANAGER_COPY.venueReports
  const reports = result?.ok ? result.reports : null

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <BackLink href={managerHrefs.venue} compact>
          Venue
        </BackLink>
        <PageHeader
          scope={workspace.venue.name}
          venueScope
          title={copy.title}
          summary={copy.summary}
          className="pb-0 md:pb-0"
        />
      </div>
      {reports === null ? (
        <p role="status" className="text-body text-ink-muted">
          {copy.failed}
        </p>
      ) : (
        // Rendered empty too, so a decision's refresh keeps the list's state.
        <SlotReportsList
          label={copy.listLabel}
          empty={copy.empty}
          reports={reports}
        />
      )}
    </div>
  )
}
