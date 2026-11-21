"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Local specials failed to load; the way back to Venue stays. */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.specials.title}
      what={MANAGER_COPY.couldNotLoad.specials}
      error={error}
      retry={retry}
      back={{ href: managerHrefs.venue, label: MANAGER_COPY.venue.title }}
    />
  )
}
