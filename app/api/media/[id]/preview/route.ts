import { signDerivative } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"

import { fail, redirectTo } from "../../_respond"

/**
 * Image preview (server-made WebP) for the owner or an admin: authorise, then
 * redirect to a signed URL issued for this request only (60 s).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getMediaActor()
  if (!auth.ok) return fail(auth.status, auth.message)
  const { id } = await ctx.params
  const signed = await signDerivative(auth.actor, id, "preview")
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
