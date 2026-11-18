import {
  ADMIN_LIBRARY_PARAMS,
  listLibrary,
  parseAdminLibraryFilters,
} from "@/lib/server/media/library"

import { mediaPageResponse } from "../_media-page"

/**
 * An admin library page as JSON, with the same params as /admin (`venue`,
 * `staff`, `type`, `item`, `variant`, `category`, `content`, `labels`, `q`,
 * `from`, `to`, and the S2-LIBRARY `use`, `review`, `shot_from`, `shot_to`,
 * `orientation`, `request`, `collection`, `destination`, `tag`) plus `cursor`.
 */
export function GET(request: Request) {
  return mediaPageResponse(request, "admin", (actor, params) =>
    listLibrary(
      actor,
      parseAdminLibraryFilters(
        Object.fromEntries(
          ADMIN_LIBRARY_PARAMS.map((key) => [key, params.get(key)])
        )
      ),
      params.get("cursor")
    )
  )
}
