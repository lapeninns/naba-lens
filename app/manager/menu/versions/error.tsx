"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Menus and change requests failed to load; the way back to Venue stays. */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.menuVersions.title}
      what={MANAGER_COPY.couldNotLoad.menuVersions}
      error={error}
      retry={retry}
      back={{ href: managerHrefs.venue, label: MANAGER_COPY.venue.title }}
    />
  )
}
