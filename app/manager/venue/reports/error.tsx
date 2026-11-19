"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** S3-R5: a failed venueReports read (Try again). */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.venueReports.title}
      what={MANAGER_COPY.couldNotLoad.venueReports}
      error={error}
      retry={retry}
    />
  )
}
