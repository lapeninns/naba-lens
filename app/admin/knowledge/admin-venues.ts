import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

/** Every venue, by name, for an admin's choices; empty when unreadable. */
export async function adminVenues(
  actor: MediaActor
): Promise<{ id: string; name: string }[]> {
  try {
    const { data } = await actor.db
      .from("venues")
      .select("id, name")
      .order("name")
    return ((data ?? []) as { id: string; name: string }[]).filter(
      (v) => typeof v.id === "string" && typeof v.name === "string"
    )
  } catch {
    return []
  }
}
