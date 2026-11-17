/*
 * The place the person last matched a photo in, on this phone only (§6.1
 * step 4): Match suggests its empty slots after the current place's. A
 * convenience, so a browser that keeps nothing simply suggests less.
 */
const KEY = "nabalens.match.last-place"

export function readLastPlace(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeLastPlace(place: string) {
  try {
    window.localStorage.setItem(KEY, place)
  } catch {
    // Private mode or storage blocked: nothing to remember.
  }
}
