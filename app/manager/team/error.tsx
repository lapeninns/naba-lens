"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed Team targets read. */
export default function ManagerTeamError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.team.title}
      what={MANAGER_COPY.couldNotLoad.team}
      error={error}
      retry={retry}
    />
  )
}
