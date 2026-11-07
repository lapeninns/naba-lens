import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { requireActiveManager, type CurrentProfile } from "@/lib/auth"
import { ROUTES } from "@/lib/auth/routes"
import { createClient } from "@/lib/supabase/server"

export type ManagerVenue = { id: string; name: string }

export type ManagerGrant = { id: string; venueId: string }

/** Why a manager account has no workspace right now (shown on the unavailable state). */
export type ManagerUnavailableReason =
  "no_grant" | "venue_inactive" | "venue_mismatch"

export type ManagerWorkspace =
  | {
      status: "available"
      profile: CurrentProfile
      venue: ManagerVenue
      grant: ManagerGrant
    }
  | {
      status: "unavailable"
      profile: CurrentProfile
      reason: ManagerUnavailableReason
    }

export type AvailableManagerWorkspace = Extract<
  ManagerWorkspace,
  { status: "available" }
>

/**
 * The signed-in manager's venue workspace, read fresh from the database
 * (`manager_workspace_scope`, never JWT claims). Non-manager accounts are
 * redirected to their own home by `requireActiveManager()`. The workspace is
 * available only when the database reports the grant as effective: an active
 * manager account, an open grant for the profile's venue, and an active venue.
 * `effective` is never recomputed here; the reason only explains a refusal.
 * A database failure throws (the route's error boundary). Memoised per render
 * pass, so the layout and page share one read.
 */
export const getManagerWorkspace = cache(
  async (): Promise<ManagerWorkspace> => {
    const profile = await requireActiveManager()
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("manager_workspace_scope")
    if (error) {
      throw new Error(
        `Could not load the manager workspace: ${error.code ?? "unknown"}`
      )
    }
    const row = data?.[0]
    if (!row) return { status: "unavailable", profile, reason: "no_grant" }

    if (row.effective && row.venue_id && row.grant_id) {
      return {
        status: "available",
        profile,
        venue: { id: row.venue_id, name: row.venue_name ?? "" },
        grant: {
          id: row.grant_id,
          venueId: row.grant_venue_id ?? row.venue_id,
        },
      }
    }
    return { status: "unavailable", profile, reason: reasonOf(row) }
  }
)

function reasonOf(row: {
  grant_id: string | null
  grant_venue_id: string | null
  venue_id: string | null
  venue_active: boolean
}): ManagerUnavailableReason {
  if (!row.grant_id) return "no_grant"
  if (!row.venue_active) return "venue_inactive"
  if (row.grant_venue_id !== row.venue_id) return "venue_mismatch"
  return "no_grant"
}

/**
 * For manager pages below Overview: the available workspace, or a redirect to
 * `/manager`, whose layout renders the Venue access unavailable state. Do not
 * call it from `/manager` itself (that would redirect to itself).
 */
export async function requireManagerVenue(): Promise<AvailableManagerWorkspace> {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available") redirect(ROUTES.managerHome)
  return workspace
}
