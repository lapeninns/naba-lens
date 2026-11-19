import type { MediaActor } from "@/lib/server/media/types"

/**
 * Whether the person has any photo or video of their own (one id, no URLs).
 * A failed read counts as yes, so Start here stays away rather than nag.
 * Shared by Album (DESIGN.md §5a) and Home (§5c).
 */
export async function hasOwnMedia(actor: MediaActor): Promise<boolean> {
  try {
    const { data, error } = await actor.db
      .from("media_assets")
      .select("id")
      .eq("uploader_id", actor.profile.id)
      .limit(1)
    return error ? true : (data?.length ?? 0) > 0
  } catch {
    return true
  }
}
