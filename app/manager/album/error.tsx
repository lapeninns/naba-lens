"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Places and briefs failed to load; the way back to Spaces stays. */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.albumPlaces.title}
      what={MANAGER_COPY.couldNotLoad.albumPlaces}
      error={error}
      retry={retry}
      back={{ href: managerHrefs.spaces, label: MANAGER_COPY.albumPlaces.back }}
    />
  )
}
