import "server-only"

import { getCoverageActor, listManagerGrants } from "@/lib/server/coverage"
import type { ManagerGrantView } from "@/lib/server/coverage/types"

import type { ManagerGrant } from "./account-controls"

/**
 * Venue manager grants for the staff pages, through the same admin-only read
 * as Venue managers. They only add context (a chip, what a move ends), so a
 * failed read leaves them out instead of failing the page.
 */
export async function loadManagerGrants({
  includeEnded = false,
}: { includeEnded?: boolean } = {}): Promise<ManagerGrantView[] | null> {
  const auth = await getCoverageActor()
  if (!auth.ok) return null
  const result = await listManagerGrants(auth.actor, {
    includeRevoked: includeEnded,
  })
  if (!result.ok) {
    console.error("[staff] manager grants unavailable", { code: result.code })
    return null
  }
  return result.grants
}

export function effectiveGrants(grants: ManagerGrantView[] | null) {
  return (grants ?? [])
    .filter((grant) => grant.effective && !grant.revokedAt)
    .map((grant): ManagerGrant => ({
      staffId: grant.staff.id,
      venueId: grant.venue.id,
      venueName: grant.venue.name,
    }))
}
