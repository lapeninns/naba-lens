import "server-only"

import { cookies } from "next/headers"

import {
  ALBUM_PLACE_COOKIE,
  parseAlbumPlace,
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
