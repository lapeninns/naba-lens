"use client"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed contributor read; the way back to Review stays. */
export default function ManagerContributorError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.contributor.title}
      what={MANAGER_COPY.couldNotLoad.contributor}
      error={error}
      retry={retry}
      back={{
        href: managerHrefs.review(),
        label: REVIEW_COPY.backToReview,
      }}
    />
  )
}
