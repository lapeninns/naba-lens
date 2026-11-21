"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Venue › Team failed to load (redesign R4, ia.md). */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.venue.title}
      what={MANAGER_COPY.couldNotLoad.team}
      error={error}
      retry={retry}
    />
  )
}
