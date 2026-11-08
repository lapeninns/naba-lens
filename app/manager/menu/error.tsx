"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed Menu read. */
export default function ManagerMenuError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.menu.title}
      what={MANAGER_COPY.couldNotLoad.menu}
      error={error}
      retry={retry}
    />
  )
}
