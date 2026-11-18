"use server"

import { getMediaActor } from "@/lib/server/media/context"
import { recordFlowEvents } from "@/lib/server/metrics"

// Server Functions are reachable by direct POST, so the argument is
// untrusted: the caller is re-read, the events are cleaned to the allowlist
// and the database re-checks venue and photo. Recording never throws: a lost
// event must never interrupt someone adding photos.

export async function recordFlowEventsAction(
  events: unknown
): Promise<{ ok: boolean; stored: number }> {
  try {
    const auth = await getMediaActor(["staff", "manager", "admin"])
    if (!auth.ok) return { ok: false, stored: 0 }
    const result = await recordFlowEvents(
      auth.actor,
      events,
      auth.actor.profile.venueId
    )
    return result.ok
      ? { ok: true, stored: result.stored }
      : { ok: false, stored: 0 }
  } catch {
    return { ok: false, stored: 0 }
  }
}
