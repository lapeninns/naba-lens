import { fail, redirectTo } from "@/app/api/media/_respond"
import { signEvidence } from "@/lib/server/coverage/evidence"
import { getMediaActor } from "@/lib/server/media/context"

/**
 * Album slot photo thumbnail (AL-7, DESIGN.md §4, §5 Slot tile): the current
 * photo of an accepted or waiting area slot, or of an accepted amenity slot,
 * for everyone at the venue (staff, its manager, an admin). Review never
 * gates visibility. The caller-scoped album_slot_asset check runs first,
 * then a signed URL of at most 60 s, private and uncached, as
 * /api/area-photos. Thumbnails only: no preview, original or download.
 * Unknown and forbidden are the same 404.
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
    "album_slot_asset"
  )
  if (!signed.ok) return fail(signed.status, signed.message)
  return redirectTo(signed.url)
}
