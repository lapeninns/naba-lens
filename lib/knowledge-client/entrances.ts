import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { needsEntranceLabels, withEntranceLabels } from "./adapt"
import type { WorkingList } from "./contract"
import { knowledgeServices } from "./services"

/**
 * A working list whose step-free Yes rows name their entrances (B03 UI
 * design §3.5): one read of the list venue's places, only when a row needs
 * it. For the screens that show the rows; unreadable, they name no place.
 */
export async function withWorkingListEntrances(
  actor: MediaActor,
  list: WorkingList
): Promise<WorkingList> {
  if (!list.slots.some((slot) => needsEntranceLabels(slot.answerInUse)))
    return list
  const read = await knowledgeServices
    .listPlaces(actor, { venueId: list.venue.id })
    .then((result) => (result.ok ? result : null))
    .catch(() => null)
  return {
    ...list,
    slots: list.slots.map((slot) => ({
      ...slot,
      answerInUse: withEntranceLabels(slot.answerInUse, list.venue.id, read),
    })),
  }
}
