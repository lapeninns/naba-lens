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
  const read = (offset: number) =>
    listCommunityMembers(actor, { ...filters, offset, limit: BATCH })
  // Most searches fit on one page, so the parallel waves wait for a second.
  const first = await read(0)
  if (!first.ok) return first
  const members: CommunityMember[] = [...first.members]
  let offset = BATCH
  let more = first.nextOffset !== null
  while (more && members.length < MAX_PEOPLE) {
    const pages = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => read(offset + i * BATCH))
    )
    for (const page of pages) {
      if (!page.ok) return page
      members.push(...page.members)
      if (page.nextOffset === null) {
        more = false
        break
      }
    }
    offset += PARALLEL * BATCH
  }
  return { ok: true, members: sortPeople(members.slice(0, MAX_PEOPLE)) }
}
