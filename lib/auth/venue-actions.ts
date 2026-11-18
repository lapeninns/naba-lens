"use server"

import { revalidatePath } from "next/cache"

import { getAuthState } from "@/lib/auth"
import { homePathFor } from "@/lib/auth/routes"
import {
  acknowledgeContributionNotice,
  switchMyVenue,
  type SwitchVenueResult,
} from "@/lib/auth/venues"
import { createClient } from "@/lib/supabase/server"

// Server Functions for the venue switcher and the first sign-in notice. Every
// input is `unknown` (public POST endpoints); the database re-checks the
// caller's membership on every call.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Switch the active venue. On success the whole app re-renders and `home`
 * is where the new role lands (staff and manager homes differ).
 */
export async function switchVenueAction(
  venueId: unknown
): Promise<SwitchVenueResult & { home?: string }> {
  if (typeof venueId !== "string" || !UUID.test(venueId))
    return { ok: false, code: "not_a_member" }
  const state = await getAuthState()
  if (state.status !== "active") return { ok: false, code: "forbidden" }
  const result = await switchMyVenue(await createClient(), venueId)
  if (!result.ok) return result
  revalidatePath("/", "layout")
  return { ...result, home: homePathFor(result.role) }
}

/** Accept the contribution-use notice shown at first sign-in. */
export async function acknowledgeNoticeAction(): Promise<{ ok: boolean }> {
  const state = await getAuthState()
  if (state.status !== "active") return { ok: false }
  const result = await acknowledgeContributionNotice(await createClient())
  return { ok: result.ok }
}
