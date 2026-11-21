"use server"

import { revalidatePath } from "next/cache"

import {
  STAFF_ALBUM_POSTS,
  staffPostHref,
} from "@/lib/config/staff-album-posts"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import { isUuid } from "@/lib/server/menus/validate"
import { photoHref } from "@/lib/staff/my-uploads"

export type AlbumModerationReply = { message: string; ok: boolean } | null

export async function moderateAlbumPost(
  assetId: string,
  _previous: AlbumModerationReply,
  form: FormData
): Promise<AlbumModerationReply> {
  if (!STAFF_ALBUM_POSTS || !isUuid(assetId))
    return { ok: false, message: "Photo not found." }
  const action = form.get("action")
  if (
    action !== "feedback" &&
    action !== "retake" &&
    action !== "remove" &&
    action !== "label"
  )
    return { ok: false, message: "Choose an action." }
  const rawNote = form.get("note")
  const note = typeof rawNote === "string" ? rawNote.trim() : ""
  if (note.length > 500 || (action !== "label" && !note))
    return { ok: false, message: "Write a short note of up to 500 characters." }
  const selection = form.get("label")
  const [kind, id] =
    action === "label" && typeof selection === "string"
      ? selection.split(":")
      : []
  if (
    action === "label" &&
    ((kind !== "dish" && kind !== "area") || !isUuid(id))
  )
    return { ok: false, message: "Choose a dish, drink or space." }

  const scope = await getManagerPhotoCtx()
  if (!scope.ok) return { ok: false, message: scope.message }
  const { error } = await scope.ctx.actor.db.rpc("staff_album_moderate", {
    p_asset_id: assetId,
    p_action: action,
    ...(note && { p_note: note }),
    ...(action === "label" && { p_label_kind: kind, p_label_id: id }),
  })
  if (error)
    return {
      ok: false,
      message:
        error.message === "album_photo_removed"
          ? "This photo has been removed from Album."
          : "The change could not be saved. Reload the photo and try again.",
    }

  revalidatePath(`/manager/review/photo/${assetId}`)
  revalidatePath(staffPostHref(assetId))
  revalidatePath(photoHref(assetId))
  return {
    ok: true,
    message: {
      feedback: "Feedback sent.",
      retake: "Another photo requested.",
      remove: "Removed from Album.",
      label: "Album label corrected.",
    }[action],
  }
}
