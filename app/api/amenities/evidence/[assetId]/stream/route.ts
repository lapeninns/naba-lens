import { fail } from "@/app/api/media/_respond"
import { AMENITY_ROLES } from "@/lib/server/amenities/context"
import { amenityVideo } from "@/lib/server/amenities/media"
import { streamOriginal } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Amenity evidence video playback for the submitter, the venue's manager or an
 * admin, and for the caller's own submittable videos. Every Range request is
 * authorised again and proxied with an `inline` disposition and no filename:
 * there is no original download here. Unknown and forbidden are the same 404.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const auth = await getMediaActor(AMENITY_ROLES)
  if (!auth.ok) return fail(auth.status, auth.message)
  const { assetId } = await ctx.params
  const found = await amenityVideo(auth.actor, assetId)
  if (!found.ok) return fail(found.status, found.message)
  return streamOriginal(auth.actor, found.asset, request.headers.get("range"))
}
