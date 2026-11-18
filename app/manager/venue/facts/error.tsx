"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** S2-MGR: a failed venueFacts read (Try again). */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.venueFacts.title}
      what={MANAGER_COPY.couldNotLoad.venueFacts}
      error={error}
      retry={retry}
    />
  )
}
