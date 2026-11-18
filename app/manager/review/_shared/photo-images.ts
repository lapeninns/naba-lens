import "server-only"

import type { DetailImages } from "@/components/nabalens/manager/review/inbox-photo-detail"
import { evidenceHref } from "@/lib/amenities/contract"
import type { PhotoDetail } from "@/lib/review/inbox"
import { areaPhotoRoutes } from "@/lib/server/area-photos"
import { menuPhotoRoutes } from "@/lib/server/coverage/menu-items"
import { mediaRoutes } from "@/lib/server/media/library"

// Shared by the manager photo review and its admin twin (S3-R11, V18).

/**
 * The image routes for a detail. Each kind of slot has its own scoped route
 * (the database decides who may see which photo); the photo itself uses the
 * route of the slot it is for, and photos with no slot the general one.
 */
export function imagesOf(detail: PhotoDetail): DetailImages {
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
