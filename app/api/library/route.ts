import {
  LIBRARY_PARAMS,
  listLibrary,
  parseLibraryFilters,
} from "@/lib/server/media/library"

import { mediaPageResponse } from "../_media-page"

/**
 * An admin library page as JSON, with the same params as /admin (`venue`,
 * `staff`, `type`, `item`, `variant`, `category`, `content`, `labels`, `q`,
 * `from`, `to`) plus `cursor`.
 */
export function GET(request: Request) {
  return mediaPageResponse(request, "admin", (actor, params) =>
    listLibrary(
      actor,
      parseLibraryFilters(
        Object.fromEntries(LIBRARY_PARAMS.map((key) => [key, params.get(key)]))
      ),
      params.get("cursor")
    )
  )
}
