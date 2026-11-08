"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed Account read. */
export default function ManagerAccountError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.accountPage.title}
      what={MANAGER_COPY.couldNotLoad.account}
      error={error}
      retry={retry}
    />
  )
}
