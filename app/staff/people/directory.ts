import "server-only"

import {
  listCommunityMembers,
  type CommunityMember,
  type CommunityMemberFilters,
} from "@/lib/server/community"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

/** The service's largest page. */
const BATCH = 100

/**
 * The first `shown` people matching the search, in the service's order (A to
 * Z by display name), and whether anyone comes after them. It reads at most
 * `shown + 1` members, so a page costs what it shows, not the size of the
 * organisation. The prefix is read again on every page because the list
 * grows in place (Next people adds below the people already shown).
 */
export async function listPeople(
  actor: MediaActor,
  filters: Omit<CommunityMemberFilters, "offset" | "limit">,
  shown: number
): Promise<Outcome<{ members: CommunityMember[]; more: boolean }>> {
  const want = shown + 1
  const read = (offset: number) =>
    listCommunityMembers(actor, {
      ...filters,
      offset,
      limit: Math.min(BATCH, want - offset),
    })
  // Most searches fit in one read, so the rest waits for the first.
  const first = await read(0)
  if (!first.ok) return first
  const members: CommunityMember[] = [...first.members]
  if (first.nextOffset !== null && want > BATCH) {
    const offsets: number[] = []
    for (let offset = BATCH; offset < want; offset += BATCH)
      offsets.push(offset)
    const pages = await Promise.all(offsets.map(read))
    for (const page of pages) {
      if (!page.ok) return page
      members.push(...page.members)
      if (page.nextOffset === null) break
    }
  }
  return {
    ok: true,
    members: members.slice(0, shown),
    more: members.length > shown,
  }
}
