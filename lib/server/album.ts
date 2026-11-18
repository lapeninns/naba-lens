import "server-only"

import {
  BRIEF_MAX,
  buildAlbum,
  isBriefText,
  type AlbumBriefs,
  type AlbumInput,
  type AlbumView,
  type AmenityInput,
  type AreaInput,
  type DishInput,
  type PlacementInput,
} from "@/lib/album/model"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import {
  failure,
  NOT_PERMITTED,
  unavailableFailure,
  type DbError,
} from "@/lib/server/coverage/errors"
import { listOurMenuItems } from "@/lib/server/coverage/menu-items"
import { listMyRetakeNotes } from "@/lib/server/coverage/retake-notes"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"
import type { MediaActor } from "@/lib/server/media/types"

// Album A2 (docs/design-system/DESIGN.md §5a, §6.2): every slot at the
// caller's venue, grouped by place. The sources are the loaders the app
// already has (Our menu, the amenity working list, G-9 area labels) plus the
// placements in 20261117120000_album_places.sql; lib/album/model.ts groups
// them. Each read is scoped again by the database. AL-7 adds the current
// photo of accepted or waiting area slots and accepted amenity slots
// (20261117150000_album_slot_photos.sql), served by /api/album/[id]/thumb.

type Result<T> = ({ ok: true } & T) | CoverageFailure

const MESSAGES: Record<string, CoverageFailure> = {
  not_active_user: NOT_PERMITTED,
  not_venue_manager: NOT_PERMITTED,
  wrong_venue: NOT_PERMITTED,
  not_admin: NOT_PERMITTED,
  venue_inactive: failure(
    "state_conflict",
    "This venue is turned off, so changes are paused. Ask an admin to check the venue."
  ),
  venue_required: failure("invalid_input", "Choose a venue first."),
  invalid_source: failure("invalid_input", "Reload the page."),
  invalid_key: failure("invalid_input", "Reload the page."),
  unknown_place: failure(
    "state_conflict",
    "That place is no longer listed for this venue. Reload the page."
  ),
  invalid_brief: failure(
    "invalid_input",
    `Write the brief as one line of ${BRIEF_MAX} characters or fewer.`
  ),
  unknown_slot: failure(
    "state_conflict",
    "That section, dish or category is no longer listed. Reload the page."
  ),
}

function albumFailure(error: DbError, context: string): CoverageFailure {
  const known = error?.message ? MESSAGES[error.message] : undefined
  return known ?? unavailableFailure(context, error)
}

const text = (value: unknown) => (typeof value === "string" ? value : null)
const rows = (data: unknown, key: string): Record<string, unknown>[] => {
  const list = (data as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : []
}

export type AlbumPlacements = {
  places: Array<{ subjectId: string; kind: string; label: string }>
  placements: PlacementInput[]
  sections: Array<{ sectionId: string; slug: string; name: string }>
}

type PlacementReads = {
  places: { ok: true; places: AlbumPlacements["places"] } | CoverageFailure
  placed:
    | ({ ok: true } & Pick<AlbumPlacements, "placements" | "sections">)
    | CoverageFailure
}

/** The two placement reads, each parsed on its own so a caller can keep one. */
async function readAlbumPlacements(
  actor: MediaActor,
  venueId?: string
): Promise<PlacementReads> {
  const args = venueId ? { p_venue_id: venueId } : {}
  const [placesRead, placedRead] = await Promise.all([
    Promise.resolve(actor.db.rpc("knowledge_subjects", args)).catch(
      (error: unknown) => ({ data: null, error: error as DbError })
    ),
    Promise.resolve(actor.db.rpc("album_places", args)).catch(
      (error: unknown) => ({ data: null, error: error as DbError })
    ),
  ])
  const places: PlacementReads["places"] = placesRead.error
    ? albumFailure(placesRead.error, "album places")
    : {
        ok: true,
        places: rows(placesRead.data, "items").flatMap((row) => {
          const label = text(row.label)
          const kind = text(row.kind)
          return isUuid(row.subjectId) && row.active !== false && label && kind
            ? [{ subjectId: row.subjectId, kind, label }]
            : []
        }),
      }
  if (placedRead.error)
    return {
      places,
      placed: albumFailure(placedRead.error, "album placements"),
    }
  const placements = rows(placedRead.data, "items").flatMap(
    (row): PlacementInput[] => {
      const key = text(row.key)
      const source = row.source
      return isUuid(row.subjectId) &&
        key &&
        (source === "menu_section" || source === "amenity_category")
        ? [{ source, key, subjectId: row.subjectId }]
        : []
    }
  )
  const sections = rows(placedRead.data, "sections").flatMap((row) => {
    const slug = text(row.slug)
    const name = text(row.name)
    return isUuid(row.sectionId) && slug && name
      ? [{ sectionId: row.sectionId, slug, name }]
      : []
  })
  return { places, placed: { ok: true, placements, sections } }
}

/** The venue's places, where each group is placed, and the active menu's sections. */
export async function getAlbumPlacements(
  actor: MediaActor,
  venueId?: string
): Promise<Result<AlbumPlacements>> {
  const { places, placed } = await readAlbumPlacements(actor, venueId)
  if (!places.ok) return places
  if (!placed.ok) return placed
  return {
    ok: true,
    places: places.places,
    placements: placed.placements,
    sections: placed.sections,
  }
}

/**
 * For staff Home: a failed read never fails the album. A failed placements
 * read (album_places) reads as nothing placed, so every slot shows under Not
 * placed yet; a failed places read leaves the area slots out as well.
 */
async function placementsOrNone(actor: MediaActor): Promise<AlbumPlacements> {
  const { places, placed } = await readAlbumPlacements(actor)
  return {
    places: places.ok ? places.places : [],
    placements: placed.ok ? placed.placements : [],
    sections: placed.ok ? placed.sections : [],
  }
}

/** Places a menu section (by slug) or amenity category, or clears it with null. */
export async function setAlbumPlace(
  actor: MediaActor,
  input: {
    venueId?: string | null
    source: unknown
    key: unknown
    subjectId: unknown
  }
): Promise<Result<{ changed: boolean }>> {
  if (input.source !== "menu_section" && input.source !== "amenity_category")
    return MESSAGES.invalid_source
  if (typeof input.key !== "string" || !input.key.trim())
    return MESSAGES.invalid_key
  if (input.subjectId !== null && !isUuid(input.subjectId))
    return MESSAGES.unknown_place
  const { data, error } = await actor.db.rpc("album_place_set", {
    // The generated types do not know null is allowed; the function takes it.
    p_venue_id: (input.venueId ?? null) as string,
    p_source: input.source,
    p_key: input.key,
    p_subject_id: input.subjectId as string,
  })
  if (error) return albumFailure(error, "album place set")
  return {
    ok: true,
    changed: (data as { changed?: unknown } | null)?.changed === true,
  }
}

export type BriefSource = "menu_section" | "menu_item"

/**
 * The venue's briefs (Album AL-4, 20261117130000_album_briefs.sql): each
 * section's (by slug) and dish's own, and the catalogue's capture brief for
 * each amenity question. Staff, managers and admins of the venue.
 */
export async function getAlbumBriefs(
  actor: MediaActor,
  venueId?: string
): Promise<Result<{ briefs: AlbumBriefs }>> {
  const { data, error } = await actor.db.rpc(
    "album_briefs",
    venueId ? { p_venue_id: venueId } : {}
  )
  if (error) return albumFailure(error, "album briefs")
  const sections = new Map<string, string>()
  const items = new Map<string, string>()
  for (const row of rows(data, "items")) {
    const key = text(row.key)
    const brief = text(row.brief)
    if (!key || !brief) continue
    if (row.source === "menu_section") sections.set(key, brief)
    else if (row.source === "menu_item") items.set(key, brief)
  }
  const amenities = new Map<string, string>()
  for (const row of rows(data, "amenities")) {
    const key = text(row.key)
    const brief = text(row.brief)
    if (key && brief) amenities.set(key, brief)
  }
  return { ok: true, briefs: { sections, items, amenities } }
}

/**
 * One dish's own brief and its section's, for the manager's menu item page.
 * Null when either read fails: the page then shows no brief field and its own
 * reads decide what happens.
 */
export async function getDishBriefs(
  actor: MediaActor,
  venueId: string | undefined,
  input: { itemId: string; sectionId: string }
): Promise<{ own: string | null; section: string | null } | null> {
  try {
    const [briefs, placements] = await Promise.all([
      getAlbumBriefs(actor, venueId),
      getAlbumPlacements(actor, venueId),
    ])
    if (!briefs.ok || !placements.ok) return null
    const slug = placements.sections.find(
      (s) => s.sectionId === input.sectionId
    )?.slug
    return {
      own: briefs.briefs.items.get(input.itemId) ?? null,
      section: slug ? (briefs.briefs.sections.get(slug) ?? null) : null,
    }
  } catch {
    return null
  }
}

/** Sets a section's (by slug) or a dish's brief, or clears it with null or blank. */
export async function setAlbumBrief(
  actor: MediaActor,
  input: {
    venueId?: string | null
    source: unknown
    key: unknown
    brief: unknown
  }
): Promise<Result<{ changed: boolean; brief: string | null }>> {
  if (input.source !== "menu_section" && input.source !== "menu_item")
    return MESSAGES.invalid_source
  if (typeof input.key !== "string" || !input.key.trim())
    return MESSAGES.invalid_key
  if (input.source === "menu_item" && !isUuid(input.key))
    return MESSAGES.unknown_slot
  if (input.brief !== null && typeof input.brief !== "string")
    return MESSAGES.invalid_brief
  const brief = input.brief?.trim() || null
  if (brief && !isBriefText(brief)) return MESSAGES.invalid_brief
  const { data, error } = await actor.db.rpc("album_brief_set", {
    // The generated types do not know null is allowed; the function takes it.
    p_venue_id: (input.venueId ?? null) as string,
    p_source: input.source,
    p_key: input.key,
    p_brief: brief as string,
  })
  if (error) return albumFailure(error, "album brief set")
  const result = data as { changed?: unknown; brief?: unknown } | null
  return {
    ok: true,
    changed: result?.changed === true,
    brief: text(result?.brief),
  }
}

/** Every dish on the active menu, page by page (50 a page). */
async function allDishes(actor: MediaActor): Promise<DishInput[] | null> {
  const dishes: DishInput[] = []
  let cursor: string | null = null
  for (let page = 0; page < 40; page += 1) {
    const result = await listOurMenuItems(actor, { cursor, limit: 50 })
    if (!result.ok) return null
    for (const item of result.items)
      dishes.push({
        itemId: item.itemId,
        name: item.name,
        sectionId: item.sectionId,
        sectionName: item.sectionName,
        covered: item.covered,
        needsRecheck: item.needsRecheck,
        thumbnailUrl: item.primary?.asset.available
          ? item.primary.asset.thumbnailUrl
          : null,
        myWaiting: item.myWaiting ?? 0,
        reviewState: item.reviewState ?? null,
        neededBy: item.neededBy ?? null,
      })
    cursor = result.nextCursor
    if (!cursor) break
  }
  return dishes
}

/** The thumbnail route for a slot photo (AL-7): signed per request, 60 s. */
export const albumThumbUrl = (assetId: string) =>
  `/api/album/${encodeURIComponent(assetId)}/thumb`

export type SlotPhotos = {
  amenity: Map<string, string>
  area: Map<string, string>
}

/**
 * AL-7: the current photo of each accepted or waiting area slot and each
 * accepted amenity slot at the caller's venue, as thumbnail URLs by slot id.
 * The database picks the photo (album_slot_photos) and checks it again on
 * every thumbnail (album_slot_asset). A failed read shows no photos.
 */
export async function slotPhotos(actor: MediaActor): Promise<SlotPhotos> {
  const photos: SlotPhotos = { amenity: new Map(), area: new Map() }
  const read = await Promise.resolve(
    actor.db.rpc("album_slot_photos", {})
  ).catch(() => null)
  if (!read || read.error) return photos
  const data = read.data
  for (const row of rows(data, "items")) {
    const kind = row.kind
    if (
      (kind === "amenity" || kind === "area") &&
      isUuid(row.slotId) &&
      isUuid(row.assetId)
    )
      photos[kind].set(row.slotId, albumThumbUrl(row.assetId))
  }
  return photos
}

async function allAmenities(
  actor: MediaActor,
  photos: Promise<SlotPhotos>
): Promise<AmenityInput[]> {
  const [result, thumbs] = await Promise.all([
    knowledgeServices.getWorkingList(actor, {}),
    photos,
  ])
  if (!result.ok || !result.view) return []
  return result.view.slots.map((slot) => ({
    checkId: slot.checkId,
    key: slot.key,
    question: slot.question,
    category: slot.category,
    progress: slot.progress,
    answer:
      slot.answerInUse.status === "available"
        ? (slot.answerInUse.value ?? null)
        : null,
    myLatestState: slot.myLatest?.state ?? null,
    thumbnailUrl: thumbs.amenity.get(slot.checkId) ?? null,
  }))
}

async function allAreas(
  actor: MediaActor,
  photos: Promise<SlotPhotos>
): Promise<AreaInput[]> {
  const [{ data, error }, thumbs] = await Promise.all([
    actor.db.rpc("album_area_states", {}),
    photos,
  ])
  if (error) return []
  return rows(data, "items").flatMap((row): AreaInput[] => {
    const label = text(row.label)
    const state = row.state
    return isUuid(row.subjectId) &&
      label &&
      (state === "needed" ||
        state === "waiting" ||
        state === "retake" ||
        state === "accepted")
      ? [
          {
            subjectId: row.subjectId,
            label,
            state,
            thumbnailUrl: thumbs.area.get(row.subjectId) ?? null,
          },
        ]
      : []
  })
}

async function myRetakeItems(actor: MediaActor): Promise<Set<string>> {
  const result = await listMyRetakeNotes(actor)
  if (!result.ok) return new Set()
  return new Set(
    result.notes.flatMap((note) =>
      note.kind === "menu" &&
      note.dish &&
      note.canRetake &&
      (note.status === "open" || note.status === "set_aside")
        ? [note.dish.itemId]
        : []
    )
  )
}

async function briefsOrNone(
  actor: MediaActor
): Promise<AlbumBriefs | undefined> {
  const result = await getAlbumBriefs(actor)
  return result.ok ? result.briefs : undefined
}

/**
 * The caller's album. Placement, amenity, area and brief reads that fail
 * leave those placements, slots (or briefs) out rather than failing Home; the
 * menu read is required.
 */
export async function loadAlbum(
  actor: MediaActor
): Promise<Result<{ album: AlbumView; placements: AlbumPlacements }>> {
  // One slot-photo read, shared by the amenity and area loaders.
  const photos = slotPhotos(actor)
  const [placements, dishes, amenities, areas, retakes, briefs] =
    await Promise.all([
      placementsOrNone(actor),
      allDishes(actor),
      allAmenities(actor, photos),
      allAreas(actor, photos),
      myRetakeItems(actor),
      briefsOrNone(actor),
    ])
  if (!dishes) return unavailableFailure("album dishes", null)
  const input: AlbumInput = {
    places: placements.places,
    placements: placements.placements,
    sections: placements.sections,
    dishes,
    amenities,
    areas,
    myRetakeItemIds: retakes,
    briefs,
  }
  return { ok: true, album: buildAlbum(input), placements }
}
