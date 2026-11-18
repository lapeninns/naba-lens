"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** S2-MGR: a failed venueHistory read (Try again). */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.venueHistory.title}
      what={MANAGER_COPY.couldNotLoad.venueHistory}
      error={error}
      retry={retry}
    />
  )
}
