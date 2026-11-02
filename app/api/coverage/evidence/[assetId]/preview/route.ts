import { fail, redirectTo } from "@/app/api/media/_respond"
import { signEvidence } from "@/lib/server/coverage/evidence"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Task evidence preview (the display derivative, never the original) for its
 * author, the venue's manager or an admin. Redirects to a signed URL of at
 * most 60 s; unknown and forbidden are the same 404.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const auth = await getMediaActor()
  if (!auth.ok) return fail(auth.status, auth.message)
  const { assetId } = await ctx.params
  const signed = await signEvidence(auth.actor, assetId, "preview")
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
