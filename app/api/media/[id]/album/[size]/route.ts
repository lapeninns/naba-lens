import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"
import { STORAGE_BUCKETS } from "@/lib/config/storage"
import { signedUrlTtlSeconds } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"
import { UPLOADER_ROLES } from "@/lib/server/media/roles"
import { isUuid } from "@/lib/server/menus/validate"

import { fail, redirectTo } from "../../../_respond"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; size: string }> }
) {
  const { id, size } = await params
  if (
    !STAFF_ALBUM_POSTS ||
    !isUuid(id) ||
    (size !== "thumb" && size !== "preview")
  )
    return fail(404, "Not found.")
  const auth = await getMediaActor(UPLOADER_ROLES)
  if (!auth.ok) return fail(auth.status, auth.message)
  const { db, service } = auth.actor
  const allowed = await db.rpc("staff_album_can_view", { p_asset_id: id })
  if (allowed.error) return fail(503, "Try again.")
  if (!allowed.data) return fail(404, "Not found.")
  const { data, error } = await service
    .from("media_assets")
    .select("thumbnail_path, preview_path")
    .eq("id", id)
    .eq("upload_state", "ready")
    .is("deleted_at", null)
    .maybeSingle()
  if (error) return fail(503, "Try again.")
  const path = size === "thumb" ? data?.thumbnail_path : data?.preview_path
  if (!path) return fail(404, "Not found.")
  const signed = await service.storage
    .from(STORAGE_BUCKETS.media)
    .createSignedUrl(path, signedUrlTtlSeconds())
  return signed.data
    ? redirectTo(signed.data.signedUrl)
    : fail(404, "Not found.")
}
