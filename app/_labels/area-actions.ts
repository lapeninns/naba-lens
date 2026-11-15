"use server"

import {
  getMyAreaLabels,
  listAreaPlaces,
  setAreaLabel,
  type AreaLabel,
  type AreaPlace,
} from "@/lib/server/area-photos"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { getMediaActor } from "@/lib/server/media/context"
import { OWN_MEDIA_ROLES } from "@/lib/server/media/roles"

// G-9: the venue-area label on a staff member's own photos. Staff only: an
// area label earns month credit, and only the uploader's own label does. The
// database re-checks the uploader, the venue and the place.

type Refused = { ok: false; message: string }

/** The venue's places and the area on each of `assetIds` (own photos). */
export async function loadAreaLabelsAction(
  assetIds: unknown
): Promise<
  | { ok: true; offered: boolean; places: AreaPlace[]; labels: AreaLabel[] }
  | Refused
  | CoverageFailure
> {
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return { ok: false, message: auth.message }
  // Manager accounts and admins earn no month: no area choice to offer.
  if (auth.actor.profile.role !== "staff")
    return { ok: true, offered: false, places: [], labels: [] }
  const ids = Array.isArray(assetIds) ? assetIds : []
  const [places, labels] = await Promise.all([
    listAreaPlaces(auth.actor),
    getMyAreaLabels(auth.actor, ids as string[]),
  ])
  if (!places.ok) return places
  if (!labels.ok) return labels
  return {
    ok: true,
    offered: true,
    places: places.places,
    labels: labels.labels,
  }
}

/** Sets (subjectId) or clears (null) the area of one own photo. */
export async function setAreaLabelAction(
  assetId: unknown,
  subjectId: unknown
): Promise<{ ok: true; subjectId: string | null } | Refused | CoverageFailure> {
  const auth = await getMediaActor(["staff"])
  if (!auth.ok) return { ok: false, message: auth.message }
  return setAreaLabel(auth.actor, assetId, subjectId ?? null)
}
