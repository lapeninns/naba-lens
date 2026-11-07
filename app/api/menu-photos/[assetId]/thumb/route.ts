import { fail, redirectTo } from "@/app/api/media/_respond"
import { signEvidence } from "@/lib/server/coverage/evidence"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Our menu photo thumbnail: for the venue's manager or an admin (labelled
 * photos taken at the venue), staff at the venue (an item's primary photo
 * only) and the uploader. Redirects to a signed URL of at most 60 s, private
 * and uncached; unknown and forbidden are the same 404.
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
    "menu_item_photo_asset"
  )
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
