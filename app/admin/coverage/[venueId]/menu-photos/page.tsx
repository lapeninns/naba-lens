import type { Metadata } from "next"

import {
  ReviewBody,
  type ReviewSearch,
} from "@/app/manager/review/_shared/review-page"
import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { ManageFrame } from "@/app/staff/manage/_shared/frame"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

export const metadata: Metadata = {
  title: "Review menu photos · Venue coverage · Naba-Lens",
}

/**
 * The admin Review page for one venue: the manager workspace's Review screen
 * (relink, old-menu labels and unlabelled photos included), with every action
 * naming the venue. No review badge provider here.
 */
export default async function AdminMenuPhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>
  searchParams: Promise<ReviewSearch>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  const scope = await getManagerPhotoCtx(ctx.venueId)
  if (!scope.ok) throw new Error(`Could not open Review: ${scope.code}`)
  return (
    <ManageFrame
      ctx={ctx}
      section="menu_items"
      title={REVIEW_COPY.adminTitle}
      summary={<p>{REVIEW_COPY.summary}</p>}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <ReviewBody
        ctx={scope.ctx}
        scope={{ kind: "admin", venueId: ctx.venueId }}
        search={await searchParams}
      />
    </ManageFrame>
  )
}
