import type { Metadata } from "next"

import { logout } from "@/app/_media/actions"
import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { CaptureScreen } from "@/app/staff/tasks/amenities/_capture/screen"
import { AppShell } from "@/components/nabalens/app-shell"
import { amenityHrefs } from "@/lib/amenities/contract"

export const metadata: Metadata = {
  title: "Capture amenity · Venue coverage · Naba-Lens",
}

/**
 * "Capture myself" for an admin. Admins can't upload, so they only choose
 * from media the services list as submittable for this check.
 */
export default async function AdminAmenityCapturePage({
  params,
}: {
  params: Promise<{ venueId: string; checkId: string }>
}) {
  const { venueId, checkId } = await params
  const ctx = await adminVenueContext(venueId)
  const checkHref = amenityHrefs(ctx.basePath).check(checkId)
  return (
    <AppShell
      variant="admin"
      active="coverage"
      userName={ctx.viewerName}
      logoutAction={logout}
    >
      <CaptureScreen
        actor={ctx.actor}
        checkId={checkId}
        mode="admin"
        venueId={ctx.venueId}
        venueName={ctx.venue.name}
        backHref={checkHref}
        backLabel="Back to the check"
        doneHref={checkHref}
      />
    </AppShell>
  )
}
