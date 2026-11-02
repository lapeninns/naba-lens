import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"

import { fail } from "../../_respond"

/**
 * Video playback for the owner, an admin or an active colleague (organisation
 * community). Every Range request is authorised again and proxied, so long
 * videos keep playing past the 60 s signing window and the response carries the
 * validated type and nosniff headers. The owner and admins get an attachment
 * disposition with the original filename; a colleague gets `inline` with no
 * filename. Colleague playback still delivers the original file, including any
 * embedded metadata such as location: the owner chose to keep it rather than
 * hide colleagues' videos until a sanitised derivative exists.
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
