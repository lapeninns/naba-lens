import { ManagerShell } from "@/components/nabalens/manager/manager-shell"
import { VenueAccessUnavailablePage } from "@/components/nabalens/manager/venue-access-unavailable"
import { getManagerWorkspace } from "@/lib/auth/manager"

/**
 * Early gate for /manager: non-manager accounts are redirected to their own
 * home, and a manager without an effective venue grant sees Venue access
 * unavailable with no nav. Not the authorisation boundary (layouts do not
 * re-render on client navigation, and pages render regardless): every page
 * and Server Function checks the workspace again.
 */
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available") {
    return <VenueAccessUnavailablePage reason={workspace.reason} />
  }
  return (
    <ManagerShell
      venueName={workspace.venue.name}
      userName={workspace.profile.displayName}
    >
      {children}
    </ManagerShell>
  )
}
