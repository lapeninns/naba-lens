import "server-only"

import { cache } from "react"

import { contributionEntry } from "@/lib/config/contribution-entry"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getMediaActor } from "@/lib/server/media/context"
import type { VenueCapabilities } from "@/lib/work-client/contract"
import { entryMenu, type EntryMenu } from "@/lib/work-client/entry"
import { workServices } from "@/lib/work-client/services"

/**
 * This manager account's capabilities (R8) at its workspace venue, read once
 * per request; null when the read fails or names another venue.
 */
export const managerCapabilities = cache(
  async (venueId: string): Promise<VenueCapabilities | null> => {
    try {
      const auth = await getMediaActor("manager")
      if (!auth.ok) return null
      const read = await workServices.getCapabilities(auth.actor)
      if (read.status !== "ok" || read.value.venueId !== venueId) return null
      return read.value
    } catch {
      return null
    }
  }
)

/**
 * The shared entry's choices for Add in the manager workspace (B02-c), or
 * null for today's workspace: the entry is off for the venue, or R8 can't be
 * read or says the account can't upload. Questions come from the working
 * list; one that can't be read leaves them out.
 */
export const managerAddEntry = cache(
  async (venueId: string, venueName: string): Promise<EntryMenu | null> => {
    if (contributionEntry(venueId) !== "b02") return null
    try {
      const [capabilities, list] = await Promise.all([
        managerCapabilities(venueId),
        managerWorkingList(),
      ])
      if (!capabilities?.canUpload) return null
      const slots = list && list.venue.id === venueId ? list.slots : []
      return entryMenu(capabilities, { venueName, slots, tasks: [] })
    } catch {
      return null
    }
  }
)

async function managerWorkingList() {
  try {
    const auth = await getMediaActor("manager")
    if (!auth.ok) return null
    const result = await knowledgeServices.getWorkingList(auth.actor, {})
    return result.ok ? result.view : null
  } catch {
    return null
  }
}
