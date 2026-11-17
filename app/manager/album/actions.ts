"use server"

import { revalidatePath } from "next/cache"

import { getAmenityActor } from "@/lib/server/amenities"
import { setAlbumPlace } from "@/lib/server/album"

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
  if (!auth.ok) return { ok: false as const, message: "Sign in again." }
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
