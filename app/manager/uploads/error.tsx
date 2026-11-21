"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** Your photos failed to load; the way back to Account stays. */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.uploads.title}
      what={MANAGER_COPY.couldNotLoad.uploads}
      error={error}
      retry={retry}
      back={{
        href: managerHrefs.account,
        label: MANAGER_COPY.accountPage.title,
      }}
    />
  )
}
