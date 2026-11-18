"use server"

import { revalidatePath } from "next/cache"

import { getAmenityActor } from "@/lib/server/amenities"
import { setAlbumBrief, setAlbumPlace } from "@/lib/server/album"
import { actorFailureMessage } from "@/lib/server/media/context"

/**
 * Album A2: place one menu section or amenity category (DESIGN.md §6.2).
 * Reachable by direct POST, so the input is untrusted: the caller is read
 * again here and the database checks the venue and the manager's grant.
 * Failures are returned as values, never thrown.
 */
export async function setAlbumPlaceAction(input: {
  source: unknown
  key: unknown
  subjectId: unknown
}) {
  const auth = await getAmenityActor()
  if (!auth.ok)
    return { ok: false as const, message: actorFailureMessage(auth) }
  const result = await setAlbumPlace(auth.actor, {
    source: input.source,
    key: input.key,
    subjectId: input.subjectId,
  })
  if (!result.ok) return { ok: false as const, message: result.message }
  if (result.changed) {
    revalidatePath("/manager/album")
    revalidatePath("/staff", "layout")
  }
  return { ok: true as const }
}

/**
 * Album AL-4: set or clear the one-line brief of a menu section (by slug) or
 * one dish (DESIGN.md §5 Brief). Untrusted input, as above: the database
 * checks the venue, the manager's grant, the slot and the length.
 */
export async function setAlbumBriefAction(input: {
  source: unknown
  key: unknown
  brief: unknown
}) {
  const auth = await getAmenityActor()
  if (!auth.ok)
    return { ok: false as const, message: actorFailureMessage(auth) }
  const result = await setAlbumBrief(auth.actor, {
    source: input.source,
    key: input.key,
    brief: input.brief,
  })
  if (!result.ok) return { ok: false as const, message: result.message }
  if (result.changed) {
    revalidatePath("/manager/album")
    if (input.source === "menu_item" && typeof input.key === "string")
      revalidatePath(`/manager/menu/${input.key}`)
    revalidatePath("/staff", "layout")
  }
  return { ok: true as const, brief: result.brief }
}
