"use server"

import { redirect } from "next/navigation"

import { removeMediaAsset } from "@/lib/server/lifecycle/remove"
import { createClient } from "@/lib/supabase/server"

export type DeleteMediaResult = { ok: true } | { ok: false; error: string }

/**
 * Delete from the staff portfolio or the admin library. lifecycle's
 * removeMediaAsset re-authorises the caller (staff: own; admin: any), writes the
 * tombstone and removes the objects, retrying later if storage fails.
 */
export async function deleteMedia(assetId: string): Promise<DeleteMediaResult> {
  if (typeof assetId !== "string") {
    return { ok: false, error: "This file could not be found." }
  }
  const result = await removeMediaAsset(assetId)
  if (result.ok) return { ok: true }
  switch (result.status) {
    case 401:
      return { ok: false, error: "Sign in again to continue." }
    case 403:
      return { ok: false, error: "You cannot remove this file." }
    case 404:
      return { ok: false, error: "This file could not be found." }
    default:
      return { ok: false, error: "Could not remove the file. Try again." }
  }
}

/** Log out from the app shell (same as POST /auth/logout). */
export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  redirect("/login?signed_out=1")
}
