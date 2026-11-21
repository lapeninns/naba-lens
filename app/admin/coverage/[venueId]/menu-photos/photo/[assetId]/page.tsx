import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { imagesOf } from "@/app/manager/review/_shared/photo-images"
import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { ManageFrame } from "@/app/staff/manage/_shared/frame"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { InboxPhotoDetail } from "@/components/nabalens/manager/review/inbox-photo-detail"
import { isUuid } from "@/lib/server/coverage/validate"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import { getPhotoDetail } from "@/lib/server/review/inbox"

export const metadata: Metadata = {
  title: "Photo review · Venue coverage",
}

/**
 * One photo's review for an admin (S3-R11, review V18): the manager photo
 * review, with every decision naming the venue. The admin Review page links
 * here from its facility photos, which have no other admin screen. A photo at
 * another venue is not found. A detail page of the venue's Review tab, so
 * its BackLink names Review (redesign R5, ia.md).
 */
export default async function AdminPhotoReviewPage({
  params,
}: {
  params: Promise<{ venueId: string; assetId: string }>
}) {
  const { venueId, assetId } = await params
  const ctx = await adminVenueContext(venueId)
  if (!isUuid(assetId)) notFound()
  const scope = await getManagerPhotoCtx(ctx.venueId)
  if (!scope.ok) throw new Error(`Could not open Review: ${scope.code}`)
  const read = await getPhotoDetail(scope.ctx, assetId)
  if (!read.ok) {
    if (read.code === "not_found" || read.code === "forbidden") notFound()
    throw new Error(`Could not load the photo: ${read.code}`)
  }
  return (
    <ManageFrame
      ctx={ctx}
      section="review"
      adminView={{ tab: "review" }}
      title={INBOX_COPY.title}
      back={{
        href: managerHrefs.adminMenuPhotos(ctx.venueId),
        label: "Review",
      }}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <InboxPhotoDetail
        detail={read.detail}
        images={imagesOf(read.detail)}
        venueId={ctx.venueId}
      />
    </ManageFrame>
  )
}
