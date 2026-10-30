import { listLibrary, parseLibraryFilters } from "@/lib/server/media/library"

import { mediaPageResponse } from "../_media-page"

/** An admin library page (`?venue=&staff=&type=&cursor=`, as in /admin), as JSON. */
export function GET(request: Request) {
  return mediaPageResponse(request, "admin", (actor, params) =>
    listLibrary(
      actor,
      parseLibraryFilters({
        venue: params.get("venue"),
        staff: params.get("staff"),
        type: params.get("type"),
      }),
      params.get("cursor")
    )
  )
}
