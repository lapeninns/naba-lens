import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"
import type { AppRole } from "@/lib/auth/routes"

export type CurrentVenue = {
  id: string
  name: string
  slug: string
  active: boolean
}

export type CurrentProfile = {
  id: string
  email: string | null
  displayName: string
  avatarPath: string | null
  jobTitle: string | null
  role: AppRole
  venueId: string | null
  /** Null when unassigned, or when the account is inactive (venues are then unreadable). */
  venue: CurrentVenue | null
  active: boolean
}

export type AuthState =
  | { status: "signed_out" }
  | { status: "no_profile"; userId: string; email: string | null }
  | { status: "inactive"; profile: CurrentProfile }
  | { status: "active"; profile: CurrentProfile }

/**
 * Reads the caller's profile through their own RLS-scoped client. Always hits the
 * database: role, activation and venue are never taken from the session token or
 * user metadata, so a deactivation applies to existing sessions on the next call.
 */
export async function loadProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string | null
): Promise<CurrentProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, avatar_path, job_title, role, venue_id, active, venue:venues(id, name, slug, active)"
    )
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not load profile: ${error.code ?? "unknown"}`)
  }
  if (!data) {
    return null
  }

  return {
    id: data.id,
    email,
    displayName: data.display_name,
    avatarPath: data.avatar_path,
    jobTitle: data.job_title,
    role: data.role,
    venueId: data.venue_id,
    venue: data.venue ?? null,
    active: data.active,
  }
}

export function toAuthState(
  user: { id: string; email: string | null } | null,
  profile: CurrentProfile | null
): AuthState {
  if (!user) return { status: "signed_out" }
  if (!profile)
    return { status: "no_profile", userId: user.id, email: user.email }
  if (!profile.active) return { status: "inactive", profile }
  return { status: "active", profile }
}

export type UploadBlockReason = "not_staff" | "no_venue" | "venue_inactive"

/**
 * Why an active profile may not upload, or null when it may. The database repeats
 * this check in reserve_media_asset and the storage insert policy.
 */
export function uploadBlockReason(
  profile: CurrentProfile
): UploadBlockReason | null {
  if (profile.role !== "staff") return "not_staff"
  if (!profile.venueId || !profile.venue) return "no_venue"
  if (!profile.venue.active) return "venue_inactive"
  return null
}
