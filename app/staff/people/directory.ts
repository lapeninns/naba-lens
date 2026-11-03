import "server-only"

import {
  listCommunityMembers,
  type CommunityMember,
  type CommunityMemberFilters,
} from "@/lib/server/community"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { sortPeople } from "./people"

const BATCH = 100
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
  for (;;) {
    const page = await listCommunityMembers(actor, {
      ...filters,
      offset,
      limit: BATCH,
    })
    if (!page.ok) return page
    members.push(...page.members)
    if (page.nextOffset === null || members.length >= MAX_PEOPLE) break
    offset = page.nextOffset
  }
  return { ok: true, members: sortPeople(members) }
}
