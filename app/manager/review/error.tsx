"use client"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed Review read. */
export default function ManagerReviewError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.review.title}
      what={MANAGER_COPY.couldNotLoad.review}
      error={error}
      retry={retry}
    />
  )
}
