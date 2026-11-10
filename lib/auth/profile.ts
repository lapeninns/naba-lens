import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"
import { isDepartment, type Department } from "@/lib/config/departments"
import {
  isWorkArea,
  isWorkRoleKey,
  type WorkArea,
  type WorkRoleKey,
} from "@/lib/config/work-roles"
import type { AppRole } from "@/lib/auth/routes"

export type CurrentVenue = {
  id: string
  name: string
  slug: string
  active: boolean
}

/**
 * Self-described work details (public.staff_work_profiles). Ordering and prompts
 * only: never access, team or labels. Null until the person saves, skips or
 * dismisses the welcome guide, and for anyone who cannot read their own row.
 */
export type WorkProfile = {
  roleKey: WorkRoleKey | null
  /** The person's own title, only for role "other". */
  roleTitle: string | null
  workAreas: WorkArea[]
  completedAt: string | null
  skippedAt: string | null
  welcomeDismissedAt: string | null
}

type WorkProfileRow = Pick<
  Database["public"]["Tables"]["staff_work_profiles"]["Row"],
  | "role_key"
  | "role_title"
  | "work_areas"
  | "completed_at"
  | "skipped_at"
  | "welcome_dismissed_at"
>

/** Maps a staff_work_profiles row, dropping keys this app version does not know. */
export function toWorkProfile(
  row: WorkProfileRow | null | undefined
): WorkProfile | null {
  if (!row) return null
  return {
    roleKey: isWorkRoleKey(row.role_key) ? row.role_key : null,
    roleTitle: row.role_key === "other" ? row.role_title : null,
    workAreas: (row.work_areas ?? []).filter(isWorkArea),
    completedAt: row.completed_at,
    skippedAt: row.skipped_at,
    welcomeDismissedAt: row.welcome_dismissed_at,
  }
}

export type CurrentProfile = {
  id: string
  email: string | null
  displayName: string
  avatarPath: string | null
  jobTitle: string | null
  department?: Department | null
  role: AppRole
  venueId: string | null
  /** Null when unassigned, or when the account is inactive (venues are then unreadable). */
  venue: CurrentVenue | null
  active: boolean
  work: WorkProfile | null
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
      "id, display_name, avatar_path, job_title, department, role, venue_id, active, venue:venues(id, name, slug, active), work:staff_work_profiles(role_key, role_title, work_areas, completed_at, skipped_at, welcome_dismissed_at)"
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
    department: isDepartment(data.department) ? data.department : null,
    role: data.role,
    venueId: data.venue_id,
    venue: data.venue ?? null,
    active: data.active,
    // One-to-one embed (staff_id is the key): null when there is no row yet.
    work: toWorkProfile(data.work),
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
  // Manager accounts upload at their managed venue (B02-c); the database
  // checks the grant.
  if (profile.role !== "staff" && profile.role !== "manager") return "not_staff"
  if (!profile.venueId || !profile.venue) return "no_venue"
  if (!profile.venue.active) return "venue_inactive"
  return null
}
