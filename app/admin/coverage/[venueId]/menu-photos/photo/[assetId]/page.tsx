import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { imagesOf } from "@/app/manager/review/_shared/photo-images"
import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { ManageFrame } from "@/app/staff/manage/_shared/frame"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { InboxPhotoDetail } from "@/components/nabalens/manager/review/inbox-photo-detail"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { buttonVariants } from "@/components/ui/button"
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
 * another venue is not found.
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
      section="menu_items"
      title={INBOX_COPY.title}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <Link
        href={managerHrefs.adminMenuPhotos(ctx.venueId)}
        className={buttonVariants({
          variant: "link",
          className: "justify-self-start",
        })}
      >
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        {REVIEW_COPY.adminTitle}
      </Link>
      <InboxPhotoDetail
        detail={read.detail}
        images={imagesOf(read.detail)}
        venueId={ctx.venueId}
      />
    </ManageFrame>
  )
}
