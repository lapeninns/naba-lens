import "server-only"

import { AreaReviewList } from "@/components/nabalens/area-photos/area-review-list"
import { AREA_COPY } from "@/components/nabalens/area-photos/copy"
import { Notice } from "@/components/nabalens/notice"
import { listAreaPhotoQueue } from "@/lib/server/area-photos"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

/**
 * G-9: the venue's area photos waiting for review, then the ones already
 * decided (so an accepted photo can still be withdrawn), under the menu
 * photos on Review (/manager/review and the admin twin). A failed read
 * leaves the menu photos working.
 */
export async function AreaReviewSection({
  ctx,
  venueId,
}: {
  ctx: ManagerPhotoCtx
  /** The admin page names the venue on every decision. */
  venueId?: string
}) {
  // Read in order. A photo decided between the two reads is in both; the
  // later read is current, so it shows once, under Decided.
  const queue = await listAreaPhotoQueue(ctx, "pending")
  const decided = queue.ok ? await listAreaPhotoQueue(ctx, "decided") : queue
  if (!queue.ok || !decided.ok)
    return (
      <Notice tone="negative" role="alert">
        {AREA_COPY.review.failed}
      </Notice>
    )
  return (
    <AreaReviewList
      venueId={venueId}
      initial={queue.cards.filter(
        (q) => !decided.cards.some((d) => d.labelId === q.labelId)
      )}
      decided={decided.cards}
    />
  )
}
