/** Local phone preview for the two-route upload design (DESIGN.md §6.1a). */
export const ALBUM_UPLOAD_TRAY =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_NABALENS_UPLOAD_TRAY === "1"

export const STAFF_PHOTO_ROUTES = {
  home: "/staff/home",
  album: "/staff/album",
  me: "/staff/me",
} as const
