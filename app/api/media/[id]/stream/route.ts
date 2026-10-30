import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"

import { fail } from "../../_respond"

/**
 * Video playback for the owner or an admin. Every Range request is authorised
 * again and proxied, so long videos keep playing past the 60 s signing window
 * and the response carries the validated type, attachment and nosniff headers.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getMediaActor()
  if (!auth.ok) return fail(auth.status, auth.message)
  const { id } = await ctx.params
  const found = await getReadableAsset(auth.actor, id)
  if (!found.ok) return fail(found.status, found.message)
  if (found.asset.mediaType !== "video") return fail(404, "Not found.")
  return streamOriginal(auth.actor, found.asset, request.headers.get("range"))
}
