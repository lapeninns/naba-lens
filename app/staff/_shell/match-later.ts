import "server-only"

import type { MatchLaterPhoto } from "@/components/nabalens/album/match/match-later"
import { getMyAreaLabels } from "@/lib/server/area-photos"
import { myLabelHelp } from "@/lib/server/label-help"
import { listOwnMedia } from "@/lib/server/media/library"
import type { MediaActor, MediaItemView } from "@/lib/server/media/types"

/** Pages of own media read for Match later (24 a page). */
const PAGES = 4

/** A photo that waits under Match later: ready, an image, with no label. */
function waiting(item: MediaItemView) {
  return (
    item.uploadState === "ready" &&
    item.mediaType === "image" &&
    item.labels !== null &&
    !item.labels.hasLabels
  )
}

/**
 * The caller's photos under Match later (DESIGN.md §2.8, §6.1): their own
 * ready photos with no dish, content or area label, newest first, from the
 * newest few pages of their portfolio. The same rule as "needs labels"
 * (`private.asset_needs_labels`), read through the caller's own session, but
 * photos only: Match takes no videos. Null when it could not be read.
 *
 * Only photos sent to the active venue (V9, spec §3.1): Match later offers
 * that venue's slots, and a photo at another venue could never be matched
 * there. It waits until the person works at its venue again.
 */
export async function listMatchLater(
  actor: MediaActor
): Promise<MatchLaterPhoto[] | null> {
  const venueId = actor.profile.venueId
  if (!venueId) return []
  const found: MediaItemView[] = []
  let cursor: string | null = null
  for (let page = 0; page < PAGES; page += 1) {
    const result = await listOwnMedia(actor, cursor, { venueId })
    if (!result.ok) return page === 0 ? null : toPhotos(actor, found)
    found.push(...result.items.filter(waiting))
    cursor = result.nextCursor
    if (!cursor) break
  }
  return toPhotos(actor, found)
}

async function toPhotos(
  actor: MediaActor,
  items: MediaItemView[]
): Promise<MatchLaterPhoto[]> {
  // A photo labelled with a venue area is matched (G-9); one sent to the
  // manager as "I'm not sure" (FA-4) is theirs to label now.
  const ids = items.slice(0, 100).map((item) => item.id)
  let areaLabelled = new Set<string>()
  let withManager = new Set<string>()
  if (ids.length > 0) {
    const [labels, help] = await Promise.all([
      getMyAreaLabels(actor, ids).catch(() => null),
      myLabelHelp(actor, ids).catch(() => null),
    ])
    if (labels?.ok)
      areaLabelled = new Set(labels.labels.map((label) => label.assetId))
    if (help?.ok) withManager = help.assetIds
  }
  return items
    .filter((item) => !areaLabelled.has(item.id) && !withManager.has(item.id))
    .map((item) => ({
      id: item.id,
      thumbnailUrl: item.previewUrl ?? item.thumbnailUrl,
      createdAt: item.createdAt,
      revision: item.labels?.revision ?? 0,
    }))
}
