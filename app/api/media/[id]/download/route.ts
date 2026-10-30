import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"

import { fail } from "../../_respond"

/**
 * Admin download of the unchanged original (never a derivative). Streamed
 * through this route rather than a signed storage URL, because storage serves
 * the uploader's Content-Type and no nosniff header (checked on the local stack).
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getMediaActor("admin")
  if (!auth.ok) return fail(auth.status === 401 ? 401 : 404, "Not found.")
  const { id } = await ctx.params
  const found = await getReadableAsset(auth.actor, id)
  if (!found.ok) return fail(found.status, found.message)
  return streamOriginal(auth.actor, found.asset, request.headers.get("range"))
}
