import "server-only"

import {
  buildAdminAlbums,
  type AdminAlbums,
  type AdminAmenityInput,
  type AdminAreaInput,
  type AdminSectionInput,
  type AdminVenueInput,
} from "@/app/admin/albums/albums-model"
import { unavailableFailure } from "@/lib/server/coverage/errors"
import { adminOnly } from "@/lib/server/coverage/context"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"
import type { MediaActor } from "@/lib/server/media/types"

// Album A4, admin albums (docs/design-system/DESIGN.md §6.6). For every
// active venue, two admin-scoped reads:
//   album_admin_counts   dishes by menu section and amenity questions
//                        (20261117140000_album_admin.sql, admins only)
//   album_area_states    each place's own photo (20261117120000, an admin
//                        names the venue)
// app/admin/albums/albums-model.ts builds the matrix and the gaps. A venue
// whose read fails shows "Couldn't load" in those cells, not a failed page.

type Result<T> = ({ ok: true } & T) | CoverageFailure

const rows = (data: unknown, key: string): Record<string, unknown>[] => {
  const list = (data as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : []
}
const count = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0

export function parseAdminCounts(data: unknown): AdminVenueInput["counts"] {
  const state = (data as Record<string, unknown> | null)?.menuState
  if (state !== "ready" && state !== "no_menu") return null
  const sections = rows(data, "sections").flatMap(
    (row): AdminSectionInput[] => {
      const kind = row.kind
      const name = typeof row.name === "string" ? row.name : null
      if ((kind !== "food" && kind !== "drinks") || !name) return []
      return [
        {
          name,
          kind,
          total: count(row.total),
          accepted: count(row.accepted),
          waiting: count(row.waiting),
        },
      ]
    }
  )
  const amenities = rows(data, "amenities").flatMap(
    (row): AdminAmenityInput[] => {
      const progress = row.progress
      const category = typeof row.category === "string" ? row.category : null
      if (
        !category ||
        (progress !== "needs_capture" &&
          progress !== "complete" &&
          progress !== "needs_recheck")
      )
        return []
      return [
        {
          category,
          progress,
          answer: typeof row.answer === "string" ? row.answer : null,
          open: row.open === true,
        },
      ]
    }
  )
  return { menuState: state, sections, amenities }
}

export function parseAreaStates(data: unknown): AdminAreaInput[] {
  return rows(data, "items").flatMap((row): AdminAreaInput[] => {
    const state = row.state
    return isUuid(row.subjectId) &&
      (state === "needed" ||
        state === "waiting" ||
        state === "retake" ||
        state === "accepted")
      ? [{ state }]
      : []
  })
}

async function readVenue(
  actor: MediaActor,
  venue: { id: string; name: string }
): Promise<AdminVenueInput> {
  const [counts, areas] = await Promise.all([
    actor.db.rpc("album_admin_counts", { p_venue_id: venue.id }),
    actor.db.rpc("album_area_states", { p_venue_id: venue.id }),
  ])
  return {
    venueId: venue.id,
    venueName: venue.name,
    counts: counts.error ? null : parseAdminCounts(counts.data),
    areas: areas.error ? null : parseAreaStates(areas.data),
  }
}

/** Every active venue's album, for an active admin. */
export async function loadAdminAlbums(
  actor: MediaActor
): Promise<Result<{ albums: AdminAlbums }>> {
  const admin = await adminOnly(actor)
  if (!admin.ok) return admin
  const { data, error } = await actor.db
    .from("venues")
    .select("id, name")
    .eq("active", true)
    .order("name")
  if (error) return unavailableFailure("admin albums venues", error)
  const venues = ((data ?? []) as Array<{ id: unknown; name: unknown }>)
    .filter(
      (v): v is { id: string; name: string } =>
        isUuid(v.id) && typeof v.name === "string"
    )
    .map((v) => ({ id: v.id, name: v.name }))
  const inputs = await Promise.all(venues.map((v) => readVenue(actor, v)))
  return { ok: true, albums: buildAdminAlbums(inputs) }
}
