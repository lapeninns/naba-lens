import "server-only"

import { AreaReviewList } from "@/components/nabalens/area-photos/area-review-list"
import { AREA_COPY } from "@/components/nabalens/area-photos/copy"
import { Notice } from "@/components/nabalens/notice"
import { listAreaPhotoQueue } from "@/lib/server/area-photos"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

/**
 * G-9: the venue's area photos waiting for review, under the menu photos on
 * Review (/manager/review and the admin twin). A failed read leaves the menu
 * photos working.
 */
export async function AreaReviewSection({
  ctx,
  venueId,
}: {
  ctx: ManagerPhotoCtx
  /** The admin page names the venue on every decision. */
  venueId?: string
}) {
  const queue = await listAreaPhotoQueue(ctx, "pending")
  if (!queue.ok)
    return (
      <Notice tone="negative" role="alert">
        {AREA_COPY.review.failed}
      </Notice>
    )
  return <AreaReviewList venueId={venueId} initial={queue.cards} />
}
