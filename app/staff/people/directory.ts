import "server-only"

import {
  listCommunityMembers,
  type CommunityMember,
  type CommunityMemberFilters,
} from "@/lib/server/community"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { sortPeople } from "./people"

const BATCH = 100
/** Pages read at the same time; the service reports no total to plan by. */
const PARALLEL = 4
/**
 * Known limit: past this many matches the list (and its "of N") stops here.
 * A surname order in the service would remove the full read.
 */
const MAX_PEOPLE = 5_000

/**
 * Everyone matching the search, A to Z by surname. The service orders by the
 * whole display name (first name first), so a page of its results cannot be
 * re-sorted on its own: the list is read in full, then sorted and paged here.
 */
export async function listPeople(
  actor: MediaActor,
  filters: Omit<CommunityMemberFilters, "offset" | "limit">
): Promise<Outcome<{ members: CommunityMember[] }>> {
  const members: CommunityMember[] = []
  let offset = 0
  while (members.length < MAX_PEOPLE) {
    const pages = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        listCommunityMembers(actor, {
          ...filters,
          offset: offset + i * BATCH,
          limit: BATCH,
        })
      )
    )
    let more = true
    for (const page of pages) {
      if (!page.ok) return page
      members.push(...page.members)
      if (page.nextOffset === null) {
        more = false
        break
      }
    }
    if (!more) break
    offset += PARALLEL * BATCH
  }
  return { ok: true, members: sortPeople(members.slice(0, MAX_PEOPLE)) }
}
