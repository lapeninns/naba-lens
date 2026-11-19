import { fail, redirectTo } from "@/app/api/media/_respond"
import { signEvidence } from "@/lib/server/coverage/evidence"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Thumbnail on the export screens (S1-EXPORT): a photo the caller may export
 * now, or one in a package they may open. The caller-scoped
 * export_asset_thumb check runs first, then a signed URL of at most 60 s,
 * private and uncached. Thumbnails only. Unknown and forbidden are the same
 * 404.
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
    "export_asset_thumb"
  )
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
