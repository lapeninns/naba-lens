import { fail, redirectTo } from "@/app/api/media/_respond"
import { AMENITY_ROLES } from "@/lib/server/amenities/context"
import { signEvidence } from "@/lib/server/coverage/evidence"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Amenity evidence photo thumbnail for the submitter, the venue's manager or an
 * admin, and for the caller's own submittable photos. Redirects to a signed
 * URL of at most 60 s; unknown and forbidden are the same 404.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const auth = await getMediaActor(AMENITY_ROLES)
  if (!auth.ok) return fail(auth.status, auth.message)
  const { assetId } = await ctx.params
  const signed = await signEvidence(
    auth.actor,
    assetId,
    "thumbnail",
    "amenity_evidence_asset"
  )
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
