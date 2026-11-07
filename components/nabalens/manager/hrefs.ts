/**
 * Typed links into the venue manager workspace (/manager). Every manager
 * screen and component builds its URLs here, so the query parameters of
 * Review and Menu stay in one place.
 */

/** Review queue filter (`?status=`); `pending` is the default queue. */
export type ReviewStatusFilter =
  "pending" | "needs_another_photo" | "accepted" | "recheck" | "all"

/** An eligible menu item's photo status (`/manager/menu?status=`). */
export type MenuPhotoStatus = "covered" | "awaiting_review" | "needs_photo"

export type ReviewQuery = {
  status?: ReviewStatusFilter
  section?: string
  contributor?: string
  item?: string
}

export type MenuQuery = {
  status?: MenuPhotoStatus | "recheck"
  section?: string
  q?: string
}

export type ManagerSection = "overview" | "review" | "menu"

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
  review: (q?: ReviewQuery) => withQuery("/manager/review", q),
  contributor: (id: string) =>
    `/manager/review/contributors/${encodeURIComponent(id)}`,
  menu: (q?: MenuQuery) => withQuery("/manager/menu", q),
  item: (id: string) => `/manager/menu/${encodeURIComponent(id)}`,
} as const

/** The nav section a workspace path belongs to (Account belongs to none). */
export function managerSectionFor(pathname: string): ManagerSection | null {
  const path = pathname.replace(/\/+$/, "") || "/"
  const under = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`)
  if (under("/manager/review")) return "review"
  if (under("/manager/menu")) return "menu"
  if (path === "/manager") return "overview"
  return null
}
