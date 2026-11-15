import { fail, redirectTo } from "@/app/api/media/_respond"
import { signEvidence } from "@/lib/server/coverage/evidence"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Venue area photo thumbnail (G-9) for the venue's
 * manager (account or grant) or an admin reviewing it, and the uploader. The
 * same path as menu review's /api/menu-photos: the caller-scoped
 * area_photo_asset check, then a signed URL of at most 60 s, private and
 * uncached. Unknown and forbidden are the same 404.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const auth = await getMediaActor(["staff", "manager", "admin"])
  if (!auth.ok) return fail(auth.status, auth.message)
  const { assetId } = await ctx.params
  const signed = await signEvidence(
    auth.actor,
    assetId,
    "thumbnail",
    "area_photo_asset"
  )
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
