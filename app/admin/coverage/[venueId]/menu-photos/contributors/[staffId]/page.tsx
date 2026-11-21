import type { Metadata } from "next"

import {
  ContributorBody,
  type ReviewSearch,
} from "@/app/manager/review/_shared/review-page"
import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { ManageFrame } from "@/app/staff/manage/_shared/frame"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

export const metadata: Metadata = {
  title: "Contributor · Venue coverage",
}

/**
 * One contributor's photos at a venue, for an admin (the manager contributor
 * view). A detail page of the venue's Review tab (redesign R5, ia.md).
 */
export default async function AdminMenuPhotoContributorPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string; staffId: string }>
  searchParams: Promise<ReviewSearch>
}) {
  const { venueId, staffId } = await params
  const ctx = await adminVenueContext(venueId)
  const scope = await getManagerPhotoCtx(ctx.venueId)
  if (!scope.ok) throw new Error(`Could not open Review: ${scope.code}`)
  return (
    <ManageFrame
      ctx={ctx}
      section="review"
      adminView={{ tab: "review" }}
      title={REVIEW_COPY.contributorTitle}
      back={{
        href: managerHrefs.adminMenuPhotos(ctx.venueId),
        label: "Review",
      }}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <ContributorBody
        ctx={scope.ctx}
        scope={{ kind: "admin", venueId: ctx.venueId }}
        staffId={staffId}
        search={await searchParams}
        headerLevel="section"
      />
    </ManageFrame>
  )
}
