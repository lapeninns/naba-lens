"use client"

import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed Requests read. */
export default function ManagerRequestsError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title="Requests"
      what="requests"
      error={error}
      retry={retry}
    />
  )
}
