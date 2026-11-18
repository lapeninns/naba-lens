// The signed-in person's venues and active venue (spec §3.1; FA-22), and the
// first sign-in notice (§3.2). The active venue is the profile's venue; the
// role there is the membership's role. Switching only moves between venues
// the person already belongs to: the database refuses anything else, so a
// tampered venue id never grants access (AC13, AC14).
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"

type Db = SupabaseClient<Database>

export type VenueMembershipRole = "staff" | "manager" | "admin"

export type MyVenue = {
  venueId: string
  venueName: string
  role: VenueMembershipRole
  /** The venue the person is working at now. */
  isActive: boolean
}

export type SwitchVenueResult =
  | { ok: true; venueId: string; role: VenueMembershipRole }
  | { ok: false; code: "not_a_member" | "forbidden" | "failed" }

/** Version of the contribution-use notice shown at first sign-in. */
export const CONTRIBUTION_NOTICE_VERSION = "v1"

/**
 * The contribution-use notice (spec §3.2): plain words, shown once per
 * version at first sign-in. Changing the text means a new version.
 */
export const CONTRIBUTION_NOTICE = {
  version: CONTRIBUTION_NOTICE_VERSION,
  title: "How your photos are used",
  points: [
    "Photos and videos you add belong to Lapen Inns and can be used on our websites, menus and social media.",
    "Your name stays on what you added, for credit and history. It is not shown to guests.",
    "A manager checks each photo before it is used. You can withdraw a photo until it is checked.",
  ],
} as const

export type OnboardingState = {
  role: VenueMembershipRole | null
  venueId: string | null
  venueName: string | null
  venueCount: number
  noticeAcknowledgedAt: string | null
}

const ROLES = new Set<VenueMembershipRole>(["staff", "manager", "admin"])

function asRole(value: unknown): VenueMembershipRole | null {
  return typeof value === "string" && ROLES.has(value as VenueMembershipRole)
    ? (value as VenueMembershipRole)
    : null
}

/**
 * The caller's venues, active one first; empty for an inactive account.
 * Admins get every active venue. Throws on a database failure.
 */
export async function listMyVenues(supabase: Db): Promise<MyVenue[]> {
  const { data, error } = await supabase.rpc("my_venue_memberships")
  if (error) {
    throw new Error(`Could not load venues: ${error.code ?? "unknown"}`)
  }
  return (data ?? []).flatMap((r) => {
    const role = asRole(r.role)
    return role
      ? [
          {
            venueId: r.venue_id,
            venueName: r.venue_name,
            role,
            isActive: r.is_active_venue,
          },
        ]
      : []
  })
}

/** Moves the caller to another of their own venues. */
export async function switchMyVenue(
  supabase: Db,
  venueId: string
): Promise<SwitchVenueResult> {
  const { data, error } = await supabase.rpc("switch_active_venue", {
    p_venue_id: venueId,
  })
  if (error) {
    if (error.message === "not_a_member")
      return { ok: false, code: "not_a_member" }
    if (error.code === "42501" || error.message === "admin_has_all_venues")
      return { ok: false, code: "forbidden" }
    return { ok: false, code: "failed" }
  }
  const row = data?.[0]
  const role = asRole(row?.role)
  if (!row || !role) return { ok: false, code: "failed" }
  return { ok: true, venueId: row.venue_id, role }
}

/** What the first sign-in screen shows; null for an inactive account. */
export async function getOnboardingState(
  supabase: Db,
  version: string = CONTRIBUTION_NOTICE_VERSION
): Promise<OnboardingState | null> {
  const { data, error } = await supabase.rpc("my_onboarding_state", {
    p_notice_version: version,
  })
  if (error) {
    throw new Error(`Could not load onboarding: ${error.code ?? "unknown"}`)
  }
  const row = data?.[0]
  if (!row) return null
  return {
    role: asRole(row.role),
    venueId: row.venue_id,
    venueName: row.venue_name,
    venueCount: row.venue_count,
    noticeAcknowledgedAt: row.notice_acknowledged_at,
  }
}

/** Records that the caller accepted this notice version (idempotent). */
export async function acknowledgeContributionNotice(
  supabase: Db,
  version: string = CONTRIBUTION_NOTICE_VERSION
): Promise<{ ok: true; acknowledgedAt: string } | { ok: false }> {
  const { data, error } = await supabase.rpc(
    "acknowledge_contribution_notice",
    { p_version: version }
  )
  if (error || typeof data !== "string") return { ok: false }
  return { ok: true, acknowledgedAt: data }
}

/** Human words for a role at a venue (DESIGN.md §7 plain words). */
export function venueRoleLabel(role: VenueMembershipRole | null): string {
  switch (role) {
    case "admin":
      return "Admin"
    case "manager":
      return "Manager"
    case "staff":
      return "Staff"
    default:
      return "No access"
  }
}
