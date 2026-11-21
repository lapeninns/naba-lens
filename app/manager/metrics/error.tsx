"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Venue › Progress failed to load (redesign R4, ia.md). */
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
      what={METRICS_COPY.what}
      error={error}
      retry={retry}
    />
  )
}
