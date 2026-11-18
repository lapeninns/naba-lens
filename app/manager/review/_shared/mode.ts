import { ROUTES } from "@/lib/auth/routes"

import type { ReviewSearch } from "./review-page"

/*
 * Which Review the manager sees (DESIGN.md §6.5). The bare page is Review in
 * a thumb: the waiting photos, one at a time. Any list filter (status,
 * section, contributor, item) or `?view=list` opens the full list, which
 * keeps every other decision (recheck, matches, decided photos, withdraw).
 */
export type ReviewMode = "thumb" | "list"

const LIST_KEYS = ["section", "contributor", "item"] as const

export function reviewModeOf(search: ReviewSearch): ReviewMode {
  if (search.view === "list") return "list"
  const status = search.status
  if (status !== undefined && status !== "pending") return "list"
  return LIST_KEYS.some((key) => search[key] !== undefined) ? "list" : "thumb"
}

/** The full list of waiting photos, from Review in a thumb. */
export const REVIEW_LIST_HREF = `${ROUTES.managerReview}?view=list`

/**
 * Whether the place and amenity sections belong under the list (S3-R8 W4,
 * K11). Their queues hold photos only (area_photo_queue and
 * private.amenity_photo_rows read images), so with Videos chosen they would
 * list photos under a Videos view: they are left out. Photos or no media
 * filter keeps them.
 */
export function showsPhotoOnlySections(search: ReviewSearch): boolean {
  return search.media !== "video"
}
