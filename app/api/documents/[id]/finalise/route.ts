import { finaliseDocument } from "@/lib/server/documents"
import { getMediaActor } from "@/lib/server/media/context"
import { PRIVATE_HEADERS } from "@/lib/server/media/access"

/**
 * Validates an uploaded evidence document (PDF signature, size, not
 * encrypted) and records it as ready or failed. The uploader only; the
 * database checks they still hold the venue.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getMediaActor(["staff", "manager", "admin"])
  if (!auth.ok)
    return Response.json(
      { message: auth.message },
      { status: auth.status, headers: PRIVATE_HEADERS }
    )
  const { id } = await ctx.params
  const result = await finaliseDocument(auth.actor, id)
  if (!result.ok)
    return Response.json(
      { code: result.code, fileCode: result.fileCode, message: result.message },
      { status: result.status, headers: PRIVATE_HEADERS }
    )
  return Response.json(
    { documentId: result.documentId, state: result.state },
    { headers: PRIVATE_HEADERS }
  )
}
