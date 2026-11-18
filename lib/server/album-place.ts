import "server-only"

import { cookies } from "next/headers"

import {
  ALBUM_PLACE_COOKIE,
  ALBUM_SHOW_COOKIE,
  parseAlbumPlace,
  parseAlbumShowCookie,
} from "@/lib/album/remembered-place"

/**
 * The place this phone last opened in Album (DESIGN.md §5a step 3), or null.
 * Never throws: Album without it opens on the place with most empty slots.
 */
export async function rememberedAlbumPlace(): Promise<string | null> {
  try {
    const jar = await cookies()
    return parseAlbumPlace(jar.get(ALBUM_PLACE_COOKIE)?.value)
  } catch {
    return null
  }
}

/** The state filter this phone last chose in a place, or null (never throws). */
export async function rememberedAlbumShow(): Promise<string | null> {
  try {
    const jar = await cookies()
    return parseAlbumShowCookie(jar.get(ALBUM_SHOW_COOKIE)?.value)
  } catch {
    return null
  }
}
