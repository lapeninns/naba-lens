import { downloadDocument } from "@/lib/server/documents"
import { getMediaActor } from "@/lib/server/media/context"

import { fail } from "../../../media/_respond"

/**
 * Download of an evidence document for a holder (the venue's effective
 * manager, an admin or its allergen authority). Streamed through this route
 * as an attachment; never shown inline. Anyone else gets the same 404 as an
 * unknown document.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getMediaActor(["staff", "manager", "admin"])
  if (!auth.ok) {
    if (auth.status === 503) return fail(503, auth.message)
    return fail(auth.status === 401 ? 401 : 404, "Not found.")
  }
  const { id } = await ctx.params
  const result = await downloadDocument(auth.actor, id)
  if (!result.ok)
    return fail(
      result.status === 503 ? 503 : 404,
      result.status === 503 ? result.message : "Not found."
    )
  return result.response
}
