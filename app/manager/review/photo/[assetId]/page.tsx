import Link from "next/link"
import { notFound } from "next/navigation"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import {
  InboxPhotoDetail,
  type DetailImages,
} from "@/components/nabalens/manager/review/inbox-photo-detail"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { evidenceHref } from "@/lib/amenities/contract"
import { requireManagerVenue } from "@/lib/auth/manager"
import type { PhotoDetail } from "@/lib/review/inbox"
import { areaPhotoRoutes } from "@/lib/server/area-photos"
import { menuPhotoRoutes } from "@/lib/server/coverage/menu-items"
import { isUuid } from "@/lib/server/coverage/validate"
import { mediaRoutes } from "@/lib/server/media/library"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import { getPhotoDetail } from "@/lib/server/review/inbox"

import { failedRead } from "../../../load-overview"

export const metadata = { title: "Photo review" }

/**
 * The image routes for a detail. Each kind of slot has its own scoped route
 * (the database decides who may see which photo); the photo itself uses the
 * route of the slot it is for, and photos with no slot the general one.
 */
function imagesOf(detail: PhotoDetail): DetailImages {
  const own =
    detail.dishes.length > 0 || detail.needsLabel
      ? menuPhotoRoutes
      : detail.places.length > 0
        ? areaPhotoRoutes
        : detail.amenities.length > 0
          ? {
              thumbnail: (id: string) => evidenceHref(id, "thumb"),
              preview: (id: string) => evidenceHref(id, "preview"),
            }
          : mediaRoutes
  const thumbs: Record<string, string> = {}
  for (const d of detail.dishes)
    for (const p of d.publicPhotos)
      thumbs[p.assetId] = menuPhotoRoutes.thumbnail(p.assetId)
  for (const pl of detail.places)
    for (const p of pl.publicPhotos)
      thumbs[p.assetId] = areaPhotoRoutes.thumbnail(p.assetId)
  for (const a of detail.amenities)
    for (const p of a.publicPhotos)
      thumbs[p.assetId] = evidenceHref(p.assetId, "thumb")
  for (const p of [...detail.group, ...detail.possibleDuplicates])
    thumbs[p.assetId] ??= mediaRoutes.thumbnail(p.assetId)
  return {
    main: {
      thumbnail: own.thumbnail(detail.assetId),
      preview: own.preview(detail.assetId),
    },
    thumbs,
  }
}

/**
 * One photo's review (S2-REVIEW; spec §7 M2): provenance, group, note,
 * possible duplicates, its slots with the album's photos to compare, history,
 * and every decision. The venue's manager only; any photo not at the venue
 * is not found.
 */
export default async function ManagerReviewPhotoPage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const { venue } = await requireManagerVenue()
  const { assetId } = await params
  if (!isUuid(assetId)) notFound()
  const here = managerHrefs.photo(assetId)
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, undefined, here)
  const read = await getPhotoDetail(scope.ctx, assetId)
  if (!read.ok) {
    if (read.code === "not_found") notFound()
    if (read.code === "forbidden") failedRead("not_permitted", undefined, here)
    if (read.code === "account_inactive" || read.code === "unauthenticated")
      failedRead(read.code, undefined, here)
    throw new Error(`Could not load the photo: ${read.code}`)
  }
  return (
    <div className="grid gap-6">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <Link
        href={`${managerHrefs.review()}?view=list`}
        className={buttonVariants({
          variant: "row-link",
          className: "justify-self-start",
        })}
      >
        {INBOX_COPY.back}
      </Link>
      <PageHeader
        scope={venue.name}
        venueScope
        title={INBOX_COPY.title}
        className="pb-0 md:pb-0"
      />
      <InboxPhotoDetail detail={read.detail} images={imagesOf(read.detail)} />
    </div>
  )
}
