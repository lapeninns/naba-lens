/**
 * The place a person last opened in Album (DESIGN.md §5a step 3), kept in a
 * cookie on their phone so Album opens on it next time. It holds a place's
 * id (a knowledge subject id, or "unplaced") and nothing about the person.
 * The server never trusts it: an unknown or stale id falls back to the place
 * with the most empty slots (`currentPlace` in `lib/album/model.ts`).
 */
export const ALBUM_PLACE_COOKIE = "nl_album_place"

/** Half a year: long enough to outlast a holiday, short enough to forget. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 182

const PLACE_ID = /^[A-Za-z0-9-]{1,64}$/

/** The cookie's value as a place id, or null when it is missing or malformed. */
export function parseAlbumPlace(
  value: string | null | undefined
): string | null {
  return value && PLACE_ID.test(value) ? value : null
}

/** The `document.cookie` assignment that remembers this place. */
export function albumPlaceCookie(placeId: string, secure = false): string {
  return [
    `${ALBUM_PLACE_COOKIE}=${placeId}`,
    "Path=/staff",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ")
}

/** Remember the place just opened. Browser only; a bad id is ignored. */
export function rememberAlbumPlace(placeId: string): void {
  if (typeof document === "undefined" || !parseAlbumPlace(placeId)) return
  document.cookie = albumPlaceCookie(
    placeId,
    window.location.protocol === "https:"
  )
}

/**
 * The state filter a person last chose on purpose in a place (spec §6 S3:
 * "preserve an intentional browsing choice"), kept like the place. A prompt
 * that opens a place on Needed passes `?show=needed` and is not remembered.
 */
export const ALBUM_SHOW_COOKIE = "nl_album_show"

const SHOW = /^(needed|waiting|in-album|updating|all)$/

/** The cookie's value as a filter key, or null when missing or malformed. */
export function parseAlbumShowCookie(
  value: string | null | undefined
): string | null {
  return value && SHOW.test(value) ? value : null
}

/** Remember a filter the person chose. Browser only; a bad key is ignored. */
export function rememberAlbumShow(show: string): void {
  if (typeof document === "undefined" || !parseAlbumShowCookie(show)) return
  document.cookie = [
    `${ALBUM_SHOW_COOKIE}=${show}`,
    "Path=/staff",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(window.location.protocol === "https:" ? ["Secure"] : []),
  ].join("; ")
}
