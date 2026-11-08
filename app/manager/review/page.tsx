import {
  ReviewBody,
  type ReviewSearch,
} from "@/app/manager/review/_shared/review-page"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireManagerVenue } from "@/lib/auth/manager"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

import { failedRead } from "../load-overview"

export const metadata = { title: "Review · Naba-Lens" }

/**
 * Review: photos staff labelled with a menu item at the manager's venue,
 * filtered by status, section, contributor and item (`?status=&section=
 * &contributor=&item=`). Decisions update the list in place.
 */
export default async function ManagerReviewPage({
  searchParams,
}: {
  searchParams: Promise<ReviewSearch>
}) {
  const { venue } = await requireManagerVenue()
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, "Review")
  return (
    <div className="grid gap-6">
      <PageHeader
        scope={venue.name}
        venueScope
        title={REVIEW_COPY.title}
        summary={<p>{REVIEW_COPY.summary}</p>}
        className="pb-0 md:pb-0"
      />
      <ReviewBody
        ctx={scope.ctx}
        scope={{ kind: "manager" }}
        search={await searchParams}
      />
    </div>
  )
}
