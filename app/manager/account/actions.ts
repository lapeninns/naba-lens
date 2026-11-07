"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/components/nabalens/types"
import { getMediaActor } from "@/lib/server/media/context"
import { updateOwnProfile } from "@/lib/server/media/profile"

/**
 * A manager renames their own account: the same own-profile update staff use
 * (trimmed, 1-80 characters, written as the caller so RLS and the column
 * grants decide), without a photo. Role, venue and access are not touched.
 */
export async function updateManagerDisplayNameAction(
  input: unknown
): Promise<ActionResult> {
  const auth = await getMediaActor("manager")
  if (!auth.ok) return { ok: false, error: auth.message }
  const displayName =
    input && typeof input === "object" && "displayName" in input
      ? input.displayName
      : undefined
  if (typeof displayName !== "string") {
    return {
      ok: false,
      error: "Check the highlighted field.",
      fieldErrors: { displayName: "Enter a name of up to 80 characters." },
    }
  }
  const result = await updateOwnProfile(auth.actor, {
    displayName,
    avatar: null,
  })
  if (!result.ok) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors }
  }
  revalidatePath("/manager", "layout")
  return { ok: true }
}
