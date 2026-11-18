"use client"

import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed photo review read. */
export default function ManagerReviewPhotoError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={INBOX_COPY.title}
      what={INBOX_COPY.failedWhat}
      error={error}
      retry={retry}
    />
  )
}
