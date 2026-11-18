import "server-only"

import {
  BRIEF_MAX,
  buildAlbum,
  coverageSlotsByAlbumId,
  isBriefText,
  parseCoverage,
  type AlbumBriefs,
  type AlbumInput,
  type AlbumView,
  type AmenityInput,
  type AreaInput,
  type CoverageState,
  type CoverageView,
  type DishInput,
  type PlacementInput,
} from "@/lib/album/model"
import type { SlotBriefs } from "@/lib/album/brief"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { factVerificationState } from "@/lib/knowledge/facts"
import {
  failure,
  NOT_PERMITTED,
  unavailableFailure,
  type DbError,
} from "@/lib/server/coverage/errors"
import { listOurMenuItems } from "@/lib/server/coverage/menu-items"
import { listMyRetakeNotes } from "@/lib/server/coverage/retake-notes"
import { loadSlotBriefs } from "@/lib/server/shot-templates"
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
// Full App v1 (S1-COV): every slot's state comes from one coverage rule,
// public.coverage_slots (20261118100200_coverage_slots.sql), the same rule
// admin albums and Our menu's summary read.

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
  // Coverage decisions (20261118100100_coverage_decisions.sql).
  invalid_level: failure("invalid_input", "Reload the page."),
  invalid_decision: failure("invalid_input", "Reload the page."),
  invalid_slot_kind: failure("invalid_input", "Reload the page."),
  reason_required: failure("invalid_input", "Add a short reason."),
  invalid_reason: failure(
    "invalid_input",
    "Write the reason in 500 characters or fewer."
  ),
  self_review_not_allowed: failure(
    "not_permitted",
    "Someone else at the venue decides on your own photo."
  ),
  media_asset_not_found: failure(
    "not_found",
    "That photo is no longer available. Reload the page."
  ),
  area_photo_not_found: failure(
    "not_found",
    "That photo is no longer available. Reload the page."
  ),
  amenity_photo_not_found: failure(
    "not_found",
    "That photo is no longer available. Reload the page."
  ),
  slot_not_found: failure(
    "not_found",
    "That slot is no longer listed. Reload the page."
  ),
  photo_not_eligible: failure(
    "asset_ineligible",
    "Only a photo accepted for public use can be the main photo."
  ),
  photo_reference_only: failure(
    "state_conflict",
    "Only a photo accepted for public use can be the main photo."
  ),
  coverage_conflict: failure(
    "revision_conflict",
    "Someone else changed this item just now. Reload the page."
  ),
  // S3-R1 V15: the photo was set aside (Not used or Mark duplicate) since
  // the screen was read; it is not accepted.
  review_conflict: failure(
    "revision_conflict",
    "Someone else decided this photo just now. Reload the page."
  ),
  area_photo_conflict: failure(
    "revision_conflict",
    "This photo was decided just now. Reload the page."
  ),
  amenity_photo_conflict: failure(
    "revision_conflict",
    "This photo was decided just now. Reload the page."
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
    verification: factVerificationState(
      slot.answerInUse.status,
      slot.answerInUse.reason,
      slot.answerInUse.detail
    ),
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
        state === "accepted" ||
        state === "check_due")
      ? [
          {
            subjectId: row.subjectId,
            label,
            state: state === "check_due" ? "check-due" : state,
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

/** FA-52: every slot's brief, resolved once (public.slot_briefs). */
async function slotBriefsOrNone(
  actor: MediaActor
): Promise<SlotBriefs | undefined> {
  const result = await loadSlotBriefs(actor).catch(() => null)
  return result?.ok ? result.briefs : undefined
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
  const [placements, dishes, amenities, areas, retakes, briefs, coverage] =
    await Promise.all([
      placementsOrNone(actor),
      allDishes(actor),
      allAmenities(actor, photos),
      allAreas(actor, photos),
      myRetakeItems(actor),
      slotBriefsOrNone(actor),
      coverageOrNone(actor),
    ])
  if (!dishes) return unavailableFailure("album dishes", null)
  // The coverage rule's state on each slot; a failed read leaves the older
  // per-source rules in lib/album/model.ts to decide. Its category and
  // waiting count feed Album's filters and tiles (S2-STAFF, spec §6 S3).
  const rows = coverageSlotsByAlbumId(coverage)
  const extras = (id: string) => {
    const row = rows.get(id)
    return row
      ? {
          coverage: row.state as CoverageState,
          coverageCategory: row.category,
          pendingCount: row.pendingCount,
        }
      : {}
  }
  const input: AlbumInput = {
    places: placements.places,
    placements: placements.placements,
    sections: placements.sections,
    dishes: dishes.map((d) => ({ ...d, ...extras(`dish:${d.itemId}`) })),
    amenities: amenities.map((a) => ({
      ...a,
      ...extras(`amenity:${a.checkId}`),
    })),
    // An area keeps its own state read (album_area_states); the coverage row
    // adds its category, waiting count and whether it needs updating.
    areas: areas.map((a) => ({ ...a, ...extras(`area:${a.subjectId}`) })),
    myRetakeItemIds: retakes,
    // FA-52: request, manager, catalogue, then the category's shot template.
    slotBriefs: briefs,
  }
  return { ok: true, album: buildAlbum(input), placements }
}

// ---- coverage (Full App v1, S1-COV) ------------------------------------------

/**
 * Every slot's coverage at the caller's venue (public.coverage_slots): its
 * state, category (Food, Drinks, Spaces, Facilities, Other), effective
 * primary and waiting count, with n of N per category. Staff and managers at
 * their venue; an admin names one.
 */
export async function getCoverageSlots(
  actor: MediaActor,
  venueId?: string
): Promise<Result<{ coverage: CoverageView }>> {
  const { data, error } = await actor.db.rpc(
    "coverage_slots",
    venueId ? { p_venue_id: venueId } : {}
  )
  if (error) return albumFailure(error, "coverage slots")
  const coverage = parseCoverage(data)
  if (!coverage) return unavailableFailure("coverage slots shape", null)
  return { ok: true, coverage }
}

async function coverageOrNone(actor: MediaActor): Promise<CoverageView | null> {
  const result = await Promise.resolve(getCoverageSlots(actor)).catch(
    () => null
  )
  return result?.ok ? result.coverage : null
}

export type ReviewLevel = "public" | "reference"
const isLevel = (v: unknown): v is ReviewLevel =>
  v === "public" || v === "reference"

/**
 * Keep as reference, or Approve for public use, on a dish photo (a label
 * tuple). A waiting or rechecking tuple is accepted at that level; an
 * accepted one changes level. `expectedRevision` is the item's revision.
 */
export async function setMenuItemPhotoLevel(
  actor: MediaActor,
  input: {
    assetId: unknown
    itemId: unknown
    variantId?: unknown
    level: unknown
    expectedRevision: unknown
    reason?: string | null
    requestKey?: string | null
  }
): Promise<
  Result<{
    photoId: string
    level: ReviewLevel
    isPrimary: boolean
    itemRevision: number
  }>
> {
  if (!isUuid(input.assetId) || !isUuid(input.itemId))
    return MESSAGES.unknown_slot
  if (input.variantId != null && !isUuid(input.variantId))
    return MESSAGES.unknown_slot
  if (!isLevel(input.level)) return MESSAGES.invalid_level
  if (
    typeof input.expectedRevision !== "number" ||
    !Number.isInteger(input.expectedRevision)
  )
    return MESSAGES.coverage_conflict
  const { data, error } = await actor.db.rpc("set_menu_item_photo_level", {
    p_asset_id: input.assetId,
    p_item_id: input.itemId,
    p_variant_id: (input.variantId ?? null) as string,
    p_level: input.level,
    p_expected_revision: input.expectedRevision,
    p_reason: (input.reason?.trim() || null) as string,
    p_client_request_key: (input.requestKey ?? null) as string,
  })
  if (error) return albumFailure(error, "menu item photo level")
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null
  if (!row || !isUuid(row.photo_id) || !isLevel(row.review_level))
    return unavailableFailure("menu item photo level shape", null)
  return {
    ok: true,
    photoId: row.photo_id,
    level: row.review_level,
    isPrimary: row.is_primary === true,
    itemRevision: typeof row.item_revision === "number" ? row.item_revision : 1,
  }
}

export type PhotoDecision =
  "accepted" | "needs_another_photo" | "not_used" | "withdrawn"
const isDecision = (v: unknown): v is PhotoDecision =>
  v === "accepted" ||
  v === "needs_another_photo" ||
  v === "not_used" ||
  v === "withdrawn"

/** One decision on a place's photo, with a level on an acceptance. */
export async function decideAreaPhoto(
  actor: MediaActor,
  input: {
    labelId: unknown
    action: unknown
    level?: unknown
    reason?: string | null
  }
): Promise<Result<{ state: string; level: ReviewLevel; changed: boolean }>> {
  if (!isUuid(input.labelId)) return MESSAGES.area_photo_not_found
  if (!isDecision(input.action)) return MESSAGES.invalid_decision
  const level = input.level ?? "public"
  if (!isLevel(level)) return MESSAGES.invalid_level
  const { data, error } = await actor.db.rpc("decide_area_photo_level", {
    p_label_id: input.labelId,
    p_action: input.action,
    p_level: level,
    p_reason: (input.reason?.trim() || null) as string,
  })
  if (error) return albumFailure(error, "area photo decision")
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null
  return {
    ok: true,
    state: text(row?.state) ?? input.action,
    level: isLevel(row?.review_level) ? row.review_level : level,
    changed: row?.changed === true,
  }
}

/** One photo decision for an amenity check (FA-32); the fact is untouched. */
export async function decideAmenityPhoto(
  actor: MediaActor,
  input: {
    checkId: unknown
    assetId: unknown
    action: unknown
    level?: unknown
    reason?: string | null
  }
): Promise<Result<{ state: string; level: ReviewLevel; changed: boolean }>> {
  if (!isUuid(input.checkId) || !isUuid(input.assetId))
    return MESSAGES.amenity_photo_not_found
  if (!isDecision(input.action)) return MESSAGES.invalid_decision
  const level = input.level ?? "public"
  if (!isLevel(level)) return MESSAGES.invalid_level
  const { data, error } = await actor.db.rpc("decide_amenity_photo", {
    p_check_id: input.checkId,
    p_asset_id: input.assetId,
    p_action: input.action,
    p_level: level,
    p_reason: (input.reason?.trim() || null) as string,
  })
  if (error) return albumFailure(error, "amenity photo decision")
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null
  return {
    ok: true,
    state: text(row?.state) ?? input.action,
    level: isLevel(row?.review_level) ? row.review_level : level,
    changed: row?.changed === true,
  }
}

/**
 * Select primary for a place or amenity slot (dishes keep
 * set_menu_item_primary_photo). The photo must be accepted for public use.
 */
export async function setSlotPrimaryPhoto(
  actor: MediaActor,
  input: {
    slotKind: unknown
    slotId: unknown
    assetId: unknown
    reason?: string | null
  }
): Promise<
  Result<{ assetId: string; previousAssetId: string | null; changed: boolean }>
> {
  if (input.slotKind !== "area" && input.slotKind !== "amenity")
    return MESSAGES.invalid_slot_kind
  if (!isUuid(input.slotId)) return MESSAGES.slot_not_found
  if (!isUuid(input.assetId)) return MESSAGES.photo_not_eligible
  const { data, error } = await actor.db.rpc("set_slot_primary_photo", {
    p_slot_kind: input.slotKind,
    p_slot_id: input.slotId,
    p_asset_id: input.assetId,
    p_reason: (input.reason?.trim() || null) as string,
  })
  if (error) return albumFailure(error, "slot primary photo")
  const row = data as Record<string, unknown> | null
  return {
    ok: true,
    assetId: input.assetId,
    previousAssetId: isUuid(row?.previousAssetId) ? row.previousAssetId : null,
    changed: row?.changed === true,
  }
}
