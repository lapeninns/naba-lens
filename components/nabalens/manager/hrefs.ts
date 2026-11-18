/**
 * Typed links into the venue manager workspace (/manager). Every manager
 * screen and component builds its URLs here, so the query parameters of
 * Review and Menu stay in one place.
 */

import type {
  MenuItemStatus,
  MenuStatusFilter,
  QueueStatus,
} from "@/lib/server/menu-photos/types"

/** Review queue filter (`?status=`); `pending` is the default queue. */
export type ReviewStatusFilter = QueueStatus

/** An eligible menu item's photo status (`/manager/menu?status=`). */
export type MenuPhotoStatus = MenuItemStatus

export type ReviewQuery = {
  status?: ReviewStatusFilter
  /** Section id. */
  section?: string
  /** Contributor (uploader) id. */
  contributor?: string
  /** Menu item id. */
  item?: string
}

export type MenuQuery = {
  status?: MenuStatusFilter
  /** Section id. */
  section?: string
  q?: string
}

/**
 * Spec §7 navigation (S2-MGR): Overview / Review / Album / Requests / Venue.
 * Album holds the menu and amenity screens (they were two tabs); Venue holds
 * menus and specials, team, reviewers, facts, exports and history.
 */
export type ManagerSection =
  | "overview"
  | "review"
  | "album"
  | "requests"
  | "venue"

function withQuery(
  path: string,
  query: Record<string, string | undefined> | undefined
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    const trimmed = value?.trim()
    if (trimmed) params.set(key, trimmed)
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

export const managerHrefs = {
  overview: "/manager",
  account: "/manager/account",
  /** Monthly photo targets (G-6), linked from Overview; no nav tab. */
  team: "/manager/team",
  /** The manager account's own uploads (B02-c); no nav tab. */
  uploads: "/manager/uploads",
  /**
   * B05-06 asset search, linked from Overview. No nav tab: a fifth tab beside
   * Add does not fit the 390px phone bar.
   */
  search: "/manager/search",
  /** S1-EXPORT: the venue's export packages, under Venue. */
  exports: "/manager/exports",
  /** S2-MGR: the Venue hub (spec §7 M5). */
  venue: "/manager/venue",
  venueFacts: "/manager/venue/facts",
  venueHistory: "/manager/venue/history",
  /** S1-MENUS screens, reached from the Venue hub. */
  menuVersions: "/manager/menu/versions",
  specials: "/manager/menu/specials",
  /** Album places and briefs (Album A2), reached from the Venue hub. */
  albumPlaces: "/manager/album",
  /** S2-REQ: requests and shot lists (spec §7 M4). */
  requests: "/manager/requests",
  review: (q?: ReviewQuery) => withQuery("/manager/review", q),
  contributor: (id: string) =>
    `/manager/review/contributors/${encodeURIComponent(id)}`,
  menu: (q?: MenuQuery) => withQuery("/manager/menu", q),
  item: (id: string) => `/manager/menu/${encodeURIComponent(id)}`,
  /** The admin Review page for a venue (same Review screen, admin layout). */
  adminMenuPhotos: (venueId: string, q?: ReviewQuery) =>
    withQuery(`/admin/coverage/${encodeURIComponent(venueId)}/menu-photos`, q),
  adminContributor: (venueId: string, id: string) =>
    `/admin/coverage/${encodeURIComponent(venueId)}/menu-photos/contributors/${encodeURIComponent(id)}`,
} as const

/** The nav section a workspace path belongs to (Account belongs to none). */
export function managerSectionFor(pathname: string): ManagerSection | null {
  const path = pathname.replace(/\/+$/, "") || "/"
  const under = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`)
  if (under("/manager/review")) return "review"
  if (under("/manager/requests")) return "requests"
  if (
    under("/manager/venue") ||
    under("/manager/team") ||
    under("/manager/exports") ||
    under("/manager/menu/versions") ||
    under("/manager/menu/specials")
  )
    return "venue"
  if (
    under("/manager/menu") ||
    under("/manager/amenities") ||
    under("/manager/album") ||
    under("/manager/search") ||
    under("/manager/uploads")
  )
    return "album"
  if (path === "/manager") return "overview"
  return null
}
