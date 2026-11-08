"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed Overview read (pages with their own boundary name their content). */
export default function ManagerError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.overview.title}
      what={MANAGER_COPY.couldNotLoad.overview}
      error={error}
      retry={retry}
    />
  )
}
