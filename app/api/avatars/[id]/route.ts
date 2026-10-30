import { getMediaActor } from "@/lib/server/media/context"
import { signAvatar } from "@/lib/server/media/profile"

import { fail, redirectTo } from "../../media/_respond"

/** Profile photo: own, or any as an admin. Redirects to a 60 s signed URL. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getMediaActor()
  if (!auth.ok) return fail(auth.status, auth.message)
  const { id } = await ctx.params
  const signed = await signAvatar(auth.actor, id)
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
