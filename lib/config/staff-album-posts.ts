// D20: immediate staff Album posting (DESIGN.md §6.1), on by default since
// 21 Nov 2026. Set NEXT_PUBLIC_NABALENS_STAFF_ALBUM_POSTS=0 to turn it off.
export const STAFF_ALBUM_POSTS =
  process.env.NEXT_PUBLIC_NABALENS_STAFF_ALBUM_POSTS !== "0"

export const RECENT_STAFF_POSTS = "/staff/album/recent"
export const MANAGER_STAFF_ALBUM = "/manager/review/album"
export const STAFF_POSTED = "Posted"
export const staffPostHref = (id: string) =>
  `${RECENT_STAFF_POSTS}/${encodeURIComponent(id)}`
export const staffPostImage = (id: string, size: "thumb" | "preview") =>
  `/api/media/${encodeURIComponent(id)}/album/${size}`
