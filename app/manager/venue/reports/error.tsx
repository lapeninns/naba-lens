"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Reported changes failed to load; the way back to Venue stays. */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.venueReports.title}
      what={MANAGER_COPY.couldNotLoad.venueReports}
      error={error}
      retry={retry}
      back={{ href: managerHrefs.venue, label: MANAGER_COPY.venue.title }}
    />
  )
}
