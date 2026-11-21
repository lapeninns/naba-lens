"use client"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed photo review read; the way back to Review stays. */
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
      back={{ href: managerHrefs.reviewList, label: REVIEW_COPY.backToReview }}
    />
  )
}
