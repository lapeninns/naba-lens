import { getCoverageScope } from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"

/**
 * Whether the staff nav shows *Manage*. Display only: manager pages, actions
 * and RPCs re-check the grant, so a failed scope read just hides the link
 * instead of breaking a portfolio or community page.
 */
export async function canManageVenue(actor: MediaActor): Promise<boolean> {
  const result = await getCoverageScope(actor)
  return result.ok && result.scope.canManageVenue
}
