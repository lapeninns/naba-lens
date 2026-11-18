import "server-only"

import Link from "next/link"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import {
  dayOf,
  INBOX_COPY,
} from "@/components/nabalens/manager/review/inbox-copy"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { evidenceHref } from "@/lib/amenities/contract"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"
import { listAmenityPhotoQueue } from "@/lib/server/review/inbox"

const A = INBOX_COPY.amenities

/**
 * S2-REVIEW (FA-32, spec §7 M2): amenity photos waiting for review, oldest
 * first, under the menu and place photos on /manager/review. Each opens its
 * photo review, where it is approved for public use, kept as reference,
 * asked again or not used. A failed read leaves the rest of Review working.
 * The admin Review page mounts it too, naming the venue (S3-R11, V18).
 */
export async function AmenityReviewSection({
  ctx,
  venueId,
}: {
  ctx: ManagerPhotoCtx
  /** The admin Review page: each photo opens the admin photo review (V18). */
  venueId?: string
}) {
  const read = await listAmenityPhotoQueue(ctx)
  return (
    <section aria-labelledby="review-amenities" className="grid gap-3">
      <h2 id="review-amenities" className="type-section-title text-ink">
        {A.heading}
      </h2>
      {!read.ok ? (
        <Notice tone="negative" role="alert">
          {A.failed}
        </Notice>
      ) : read.rows.length === 0 ? (
        <EmptyState variant="done" title={A.empty} />
      ) : (
        <>
          <ul className="grid gap-2" data-review-amenities>
            {read.rows.map((r) => (
              <li key={`${r.checkId}:${r.assetId}`}>
                <Link
                  href={
                    venueId
                      ? managerHrefs.adminPhoto(venueId, r.assetId)
                      : managerHrefs.photo(r.assetId)
                  }
                  className="flex items-center gap-3 rounded-card border border-line p-2 focus-ring outline-none hover:bg-surface-2"
                >
                  <EvidenceThumb
                    src={
                      r.hasThumbnail ? evidenceHref(r.assetId, "thumb") : null
                    }
                    className="aspect-square w-16 shrink-0 rounded-control"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-label break-words text-ink">
                      {r.question}
                    </span>
                    <span className="text-meta text-ink-muted">
                      {A.by(r.uploaderName, dayOf(r.uploadedAt))}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {read.more ? (
            <p className="text-meta text-ink-muted">{A.more}</p>
          ) : null}
        </>
      )}
    </section>
  )
}
