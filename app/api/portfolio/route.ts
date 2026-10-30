import { listOwnMedia } from "@/lib/server/media/library"

import { mediaPageResponse } from "../_media-page"

/** The signed-in staff member's own portfolio page (`?cursor=`), as JSON. */
export function GET(request: Request) {
  return mediaPageResponse(request, "staff", (actor, params) =>
    listOwnMedia(actor, params.get("cursor"))
  )
}
