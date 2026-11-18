// "Asked for" pairing (spec §7 M4, AC01; FA-5). Pure and server-safe: the
// staff Home server page and the client "Asked for" section both call it, so
// it must not live in a "use client" module (S3-E2E-2 D1: a server page
// cannot call a function exported from a client module).

import type { AlbumSlot } from "@/lib/album/model"
import type { StaffRequest } from "@/lib/requests/model"

export type AskedForItem = {
  request: StaffRequest
  /** The album's own slot, when the request is on one the album shows. */
  slot: AlbumSlot | null
}

/** Pairs each request with the album slot it points at. */
export function askedForItems(
  requests: StaffRequest[],
  slots: ReadonlyMap<string, AlbumSlot>
): AskedForItem[] {
  return requests.flatMap((request): AskedForItem[] => {
    if (!request.slot) return [{ request, slot: null }]
    const slot = slots.get(`${request.slot.kind}:${request.slot.slotId}`)
    // A slot the album no longer shows (Not here, retired) is left out.
    return slot ? [{ request, slot }] : []
  })
}
