import "server-only"

import type { Database } from "@/lib/db/types"
import { redactError } from "@/lib/server/log/redact"
import type { MediaActor } from "@/lib/server/media/types"

import { readAccess, resolveVenue } from "./context"
import {
  coverageRpcFailure,
  failure,
  invalid,
  NOT_FOUND,
  NOT_PERMITTED,
  unavailableFailure,
  WRONG_VENUE,
} from "./errors"
import { isPeriodKey, periodView } from "./time"
import type {
  CoverageResult,
  EvidenceAsset,
  ItemPhotoCandidate,
  ItemPhotoSelfReviewView,
  ItemPhotoState,
  MenuItemVariant,
  MyMenuPhotoState,
  OurMenuItem,
  OurMenuReviewFigures,
  OurMenuSection,
  OurMenuState,
  OurMenuView,
  Page,
  PrimaryItemPhoto,
  ReviewedItemPhoto,
  WithdrawnItemPhoto,
} from "./types"
import {
  intInRange,
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalText,
  optionalUuid,
  uuidList,
} from "./validate"
import { decodeKey, encodeKey } from "./views"

// Our menu: menu items with an accepted photo. A separate measure from the
// monthly targets and section coverage. Staff (managers included) read their
// current venue; the venue's manager and admins also review. Every function
// re-reads the caller's scope, and the database re-checks it (and the asset's
// original upload venue) in the same transaction.

type Fns = Database["public"]["Functions"]
type SummaryRow = Fns["menu_item_photo_summary"]["Returns"][number]
type ItemRow = Fns["menu_item_photo_items"]["Returns"][number]
type CandidateRow = Fns["menu_item_photo_candidates"]["Returns"][number]

const BAD_REQUEST = invalid({}, "This request is invalid. Reload the page.")
const MAX_REVISION = 2 ** 31 - 1
const ITEMS_PAGE = 50
const QUERY_MAX = 80
const STATES_MAX = 100
const LIVE_STATES = ["accepted", "better_photo_requested", "needs_recheck"]

/** Scoped item-photo routes: authorise per request, then sign for 60 s. */
export const menuPhotoRoutes = {
  thumbnail: (assetId: string) => `/api/menu-photos/${assetId}/thumb`,
  preview: (assetId: string) => `/api/menu-photos/${assetId}/preview`,
}

function menuPhotoAsset(
  id: string,
  hasThumbnail: boolean,
  hasPreview: boolean,
  width: number | null,
  height: number | null,
  available = true
): EvidenceAsset {
  return {
    id,
    thumbnailUrl:
      available && hasThumbnail ? menuPhotoRoutes.thumbnail(id) : null,
    previewUrl: available && hasPreview ? menuPhotoRoutes.preview(id) : null,
    width,
    height,
    available,
  }
}

const objectOrEmpty = (input: unknown) =>
  isObject(input) ? input : input == null ? {} : null

/**
 * The venue an Our menu read is for: staff (managers included) their current
 * venue (another `venueId` is `wrong_venue`), an admin the venue they name.
 */
async function readVenue(
  actor: MediaActor,
  raw: unknown
): Promise<CoverageResult<{ venueId: string; canReview: boolean }>> {
  const venueId = optionalUuid(raw)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  const read = await readAccess(actor)
  if (!read.ok) return read
  const { access } = read
  if (access.isAdmin) {
    if (!venueId) return invalid({ venueId: "Choose a venue." })
    return { ok: true, venueId, canReview: true }
  }
  if (!access.isStaff) return NOT_PERMITTED
  if (!access.venueId)
    return failure("needs_setup", "You need to be assigned to a venue first.")
  if (venueId && venueId !== access.venueId) return WRONG_VENUE
  return {
    ok: true,
    venueId: access.venueId,
    canReview: access.managerVenueId === access.venueId,
  }
}

function reviewFigures(
  pending: number | null,
  oldest: string | null
): OurMenuReviewFigures | null {
  return pending === null || pending === undefined
    ? null
    : { pendingCandidates: pending, oldestCandidateAt: oldest ?? null }
}

function menuView(
  rows: SummaryRow[],
  venueId: string,
  canReview: boolean
): OurMenuView {
  const first = rows[0]
  const state = (first?.menu_state ?? "no_menu") as OurMenuState
  const sections: OurMenuSection[] =
    state === "ready"
      ? rows.map((r) => ({
          sectionId: r.section_id,
          name: r.section_name,
          kind: r.section_kind as OurMenuSection["kind"],
          position: r.section_position,
          eligible: r.eligible_items,
          covered: r.covered_items,
          needsRecheck: r.needs_recheck_items,
          review: canReview
            ? reviewFigures(r.pending_candidates, r.oldest_candidate_at)
            : null,
        }))
      : []
  const eligible = sections.reduce((n, s) => n + s.eligible, 0)
  const covered = sections.reduce((n, s) => n + s.covered, 0)
  const oldest = sections
    .map((s) => s.review?.oldestCandidateAt ?? null)
    .filter((at): at is string => !!at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return {
    venue: { id: first?.venue_id ?? venueId, name: first?.venue_name ?? "" },
    menuState: state,
    menuVersionId: first?.menu_version_id ?? null,
    totals: {
      eligible,
      covered,
      gaps: eligible - covered,
      needsRecheck: sections.reduce((n, s) => n + s.needsRecheck, 0),
    },
    sections,
    review: canReview
      ? {
          pendingCandidates: sections.reduce(
            (n, s) => n + (s.review?.pendingCandidates ?? 0),
            0
          ),
          oldestCandidateAt: oldest ?? null,
        }
      : null,
    canReview,
  }
}

/**
 * Our menu totals for the caller's venue: eligible items, items with an
 * accepted photo and gaps, overall and per food or drinks section, with the
 * `no_menu` / `empty` / `ready` state. Reviewers also get waiting photos.
 */
export async function getOurMenu(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ menu: OurMenuView }>> {
  const args = objectOrEmpty(input)
  if (!args) return BAD_REQUEST
  const venue = await readVenue(actor, args.venueId)
  if (!venue.ok) return venue
  const { data, error } = await actor.db.rpc("menu_item_photo_summary", {
    p_venue_id: venue.venueId,
  })
  if (error) return coverageRpcFailure(error, "our menu")
  return {
    ok: true,
    menu: menuView(data ?? [], venue.venueId, venue.canReview),
  }
}

function encodeItemCursor(row: ItemRow): string {
  return Buffer.from(
    JSON.stringify([row.section_position, row.entry_position, row.item_id])
  ).toString("base64url")
}

function decodeItemCursor(
  cursor: string
): { section: number; entry: number; itemId: string } | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      Array.isArray(value) &&
      intInRange(value[0], 0, MAX_REVISION) &&
      intInRange(value[1], 0, MAX_REVISION) &&
      isUuid(value[2])
    )
      return { section: value[0], entry: value[1], itemId: value[2] }
  } catch {}
  return null
}

function variantsOf(value: unknown): MenuItemVariant[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v) =>
    isObject(v) && isUuid(v.variantId) && typeof v.name === "string"
      ? [{ variantId: v.variantId, name: v.name }]
      : []
  )
}

function itemView(row: ItemRow, canReview: boolean): OurMenuItem {
  return {
    itemId: row.item_id,
    sectionId: row.section_id,
    sectionName: row.section_name,
    sectionKind: row.section_kind as OurMenuItem["sectionKind"],
    name: row.name,
    description: row.description ?? null,
    variants: variantsOf(row.variants),
    covered: row.covered,
    acceptedCount: row.accepted_count,
    needsRecheck: row.needs_recheck_count > 0,
    primary:
      row.primary_photo_id && row.primary_asset_id
        ? {
            photoId: row.primary_photo_id,
            asset: menuPhotoAsset(
              row.primary_asset_id,
              row.primary_has_thumbnail,
              row.primary_has_preview,
              row.primary_width ?? null,
              row.primary_height ?? null
            ),
          }
        : null,
    itemRevision: row.item_revision,
    review:
      canReview && row.candidate_count !== null
        ? {
            candidates: row.candidate_count ?? 0,
            oldestCandidateAt: row.oldest_candidate_at ?? null,
          }
        : null,
  }
}

/**
 * Eligible items in menu order, with search (name or alias), a section filter
 * and "Still needs a photo" (`gapsOnly`). Paged with an opaque cursor.
 */
export async function listOurMenuItems(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<OurMenuItem>>> {
  const args = objectOrEmpty(input)
  if (!args) return BAD_REQUEST
  const sectionId = optionalUuid(args.sectionId)
  if (sectionId === undefined)
    return invalid({ sectionId: "Choose a section." })
  if (args.gapsOnly != null && typeof args.gapsOnly !== "boolean")
    return BAD_REQUEST
  const query = optionalText(args.query, QUERY_MAX)
  if (query === undefined)
    return invalid({ query: `Use up to ${QUERY_MAX} characters.` })
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  if (args.cursor != null && typeof args.cursor !== "string")
    return invalid({ cursor: "Invalid page cursor." })
  const after = cursor ? decodeItemCursor(cursor) : null
  if (cursor && !after) return invalid({ cursor: "Invalid page cursor." })
  const venue = await readVenue(actor, args.venueId)
  if (!venue.ok) return venue

  const { data, error } = await actor.db.rpc("menu_item_photo_items", {
    p_venue_id: venue.venueId,
    ...(sectionId ? { p_section_id: sectionId } : {}),
    p_gaps_only: args.gapsOnly === true,
    ...(query ? { p_query: query } : {}),
    ...(after
      ? {
          p_after_section_position: after.section,
          p_after_entry_position: after.entry,
          p_after_item_id: after.itemId,
        }
      : {}),
    p_limit: ITEMS_PAGE + 1,
  })
  if (error) return coverageRpcFailure(error, "our menu items")
  const rows = data ?? []
  const page = rows.slice(0, ITEMS_PAGE)
  const last = rows.length > ITEMS_PAGE ? page[page.length - 1] : null
  const mine = await myWaitingByItem(
    actor,
    venue.venueId,
    page.map((r) => r.item_id)
  )
  return {
    ok: true,
    items: page.map((r) => {
      const view = itemView(r, venue.canReview)
      return mine ? { ...view, myWaiting: mine.get(r.item_id) ?? 0 } : view
    }),
    nextCursor: last ? encodeItemCursor(last) : null,
  }
}

type WaitingRpc = {
  rpc(
    fn: "my_menu_waiting_items",
    args: { p_venue_id: string; p_item_ids: string[] }
  ): PromiseLike<{
    data: { item_id: string; waiting: number }[] | null
    error: { message?: string; code?: string; details?: string | null } | null
  }>
}

/**
 * The caller's own waiting photos per listed item (my_menu_waiting_items), or
 * null when that read fails: the list is still served, without myWaiting.
 */
async function myWaitingByItem(
  actor: MediaActor,
  venueId: string,
  itemIds: string[]
): Promise<Map<string, number> | null> {
  if (itemIds.length === 0) return new Map()
  const { data, error } = await (actor.db as unknown as WaitingRpc).rpc(
    "my_menu_waiting_items",
    { p_venue_id: venueId, p_item_ids: itemIds }
  )
  if (error) {
    console.error("[coverage] our menu own waiting failed", {
      error: redactError(
        new Error(`${error.code || "unknown"}: ${error.message ?? ""}`)
      ),
    })
    return null
  }
  return new Map((data ?? []).map((r) => [r.item_id, r.waiting]))
}

function candidateView(row: CandidateRow): ItemPhotoCandidate {
  const state = row.photo_state as ItemPhotoState | null
  return {
    labelId: row.label_id,
    asset: menuPhotoAsset(
      row.asset_id,
      row.has_thumbnail,
      row.has_preview,
      row.width ?? null,
      row.height ?? null
    ),
    uploadedAt: row.created_at,
    labelledAt: row.labelled_at,
    item: {
      id: row.item_id,
      name: row.item_name,
      sectionName: row.section_name,
    },
    variant:
      row.variant_id && row.variant_name
        ? { variantId: row.variant_id, name: row.variant_name }
        : null,
    variantRemoved: !!row.variant_id && !row.variant_name,
    uploader: {
      id: row.uploader_id,
      displayName: row.uploader_name,
      active: row.uploader_active,
    },
    self: row.is_self,
    photo:
      row.photo_id && state && state !== "withdrawn" && state !== "invalidated"
        ? { id: row.photo_id, state, isPrimary: row.is_primary }
        : null,
    itemRevision: row.item_revision,
  }
}

/**
 * Labelled, ready photos waiting for a decision (or a recheck after a menu
 * change), oldest upload first; for the venue's manager or an admin. With
 * `itemId` and `includeReviewed`, an item's full review screen.
 */
export async function listItemPhotoCandidates(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<ItemPhotoCandidate>>> {
  const args = objectOrEmpty(input)
  if (!args) return BAD_REQUEST
  const itemId = optionalUuid(args.itemId)
  if (itemId === undefined) return NOT_FOUND
  if (args.includeReviewed != null && typeof args.includeReviewed !== "boolean")
    return BAD_REQUEST
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  if (args.cursor != null && typeof args.cursor !== "string")
    return invalid({ cursor: "Invalid page cursor." })
  const after = decodeKey(cursor)
  if (cursor && (!after || !isUuid(after.id)))
    return invalid({ cursor: "Invalid page cursor." })
  const venue = await resolveVenue(actor, args.venueId)
  if (!venue.ok) return venue

  const { data, error } = await actor.db.rpc("menu_item_photo_candidates", {
    p_venue_id: venue.venueId,
    ...(itemId ? { p_item_id: itemId } : {}),
    p_include_reviewed: args.includeReviewed === true,
    ...(after
      ? { p_after_created_at: after.at, p_after_label_id: after.id }
      : {}),
    p_limit: LIMITS.pageSize + 1,
  })
  if (error) return coverageRpcFailure(error, "menu photo candidates")
  const rows = data ?? []
  const page = rows.slice(0, LIMITS.pageSize)
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map(candidateView),
    nextCursor: last ? encodeKey(last.created_at, last.label_id) : null,
  }
}

/**
 * Accept a labelled photo for one item, or ask for a better photo with a
 * reason. Reviewing your own photo is allowed and recorded as self-review. A
 * stale `expectedRevision` (the item's `itemRevision`) is a revision conflict;
 * repeating a decision is a replay.
 */
export async function reviewItemPhoto(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ photo: ReviewedItemPhoto; replayed: boolean }>> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  if (!isUuid(input.assetId) || !isUuid(input.itemId)) return NOT_FOUND
  const variantId = optionalUuid(input.variantId)
  if (variantId === undefined) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const decision = input.decision
  if (decision !== "accept" && decision !== "better_photo")
    return invalid({ decision: "Choose accept or ask for a better photo." })
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  if (decision === "better_photo" && !reason)
    return invalid({ reason: "Say what a better photo needs." })
  if (input.makePrimary != null && typeof input.makePrimary !== "boolean")
    return BAD_REQUEST

  const { data, error } = await actor.db.rpc("review_menu_item_photo", {
    p_asset_id: input.assetId,
    p_item_id: input.itemId,
    // supabase-js serialises null; the generated type says string.
    p_variant_id: variantId as string,
    p_decision: decision === "accept" ? "accepted" : "better_photo_requested",
    p_expected_revision: input.expectedRevision,
    ...(reason ? { p_reason: reason } : {}),
    p_make_primary: input.makePrimary === true,
    p_client_request_key: input.requestId,
  })
  if (error)
    return coverageRpcFailure(error, "review menu photo", [input.assetId])
  const row = data?.[0]
  if (!row) return unavailableFailure("review menu photo")
  return {
    ok: true,
    photo: {
      photoId: row.photo_id,
      itemId: row.item_id,
      state: row.state as ItemPhotoState,
      isPrimary: row.is_primary,
      itemRevision: row.item_revision,
      selfReview: row.self_review,
    },
    replayed: row.replayed,
  }
}

/**
 * Undo an acceptance (or a better-photo request or pending recheck) with a
 * reason. A withdrawn primary hands over to the earliest other accepted photo,
 * or the item becomes a gap again. The photo stays in the portfolio.
 */
export async function withdrawItemPhoto(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ photo: WithdrawnItemPhoto; replayed: boolean }>> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  if (!isUuid(input.photoId)) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  if (!reason) return invalid({ reason: "Say why this photo is withdrawn." })

  const { data, error } = await actor.db.rpc("withdraw_menu_item_photo", {
    p_photo_id: input.photoId,
    p_expected_revision: input.expectedRevision,
    p_reason: reason,
    p_client_request_key: input.requestId,
  })
  if (error) return coverageRpcFailure(error, "withdraw menu photo")
  const row = data?.[0]
  if (!row) return unavailableFailure("withdraw menu photo")
  return {
    ok: true,
    photo: {
      photoId: row.photo_id,
      state: row.state as ItemPhotoState,
      itemRevision: row.item_revision,
      newPrimaryPhotoId: row.new_primary_photo_id ?? null,
    },
    replayed: row.replayed,
  }
}

/** Make an accepted photo the item's primary; the previous one stays accepted. */
export async function setPrimaryItemPhoto(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ photo: PrimaryItemPhoto; replayed: boolean }>> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  if (!isUuid(input.photoId)) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST

  const { data, error } = await actor.db.rpc("set_menu_item_primary_photo", {
    p_photo_id: input.photoId,
    p_expected_revision: input.expectedRevision,
    p_client_request_key: input.requestId,
  })
  if (error) return coverageRpcFailure(error, "set primary menu photo")
  const row = data?.[0]
  if (!row) return unavailableFailure("set primary menu photo")
  return {
    ok: true,
    photo: { photoId: row.photo_id, itemRevision: row.item_revision },
    replayed: row.replayed,
  }
}

/**
 * The caller's own live item decisions for these photos (for "Accepted for
 * menu use" on their portfolio). Takes the asset ids, or `{ assetIds }`.
 * Other people's photos are never returned.
 */
export async function getMyMenuPhotoStates(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ states: MyMenuPhotoState[] }>> {
  const raw = Array.isArray(input)
    ? input
    : isObject(input)
      ? input.assetIds
      : undefined
  const assetIds = uuidList(raw, 0, STATES_MAX)
  if (!assetIds)
    return invalid({ assetIds: `Choose up to ${STATES_MAX} photos.` })
  if (!actor.profile.active)
    return failure("account_inactive", "Your account is not active.")
  if (!assetIds.length) return { ok: true, states: [] }

  const { data, error } = await actor.db
    .from("menu_item_photos")
    .select(MY_STATE_COLUMNS)
    .eq("author_id", actor.profile.id)
    .in("asset_id", assetIds)
    .in("state", LIVE_STATES)
    .order("decided_at")
  if (error) return unavailableFailure("my menu photos", error)
  return { ok: true, states: (data ?? []).map(myStateView) }
}

const MY_STATE_COLUMNS =
  "id, asset_id, item_id, item_name, variant_id, variant_name, state, is_primary, reason, decided_at"

function myStateView(r: {
  id: string
  asset_id: string
  item_id: string
  item_name: string
  variant_id: string | null
  variant_name: string | null
  state: string
  is_primary: boolean
  reason: string | null
  decided_at: string
}): MyMenuPhotoState {
  return {
    photoId: r.id,
    assetId: r.asset_id,
    itemId: r.item_id,
    itemName: r.item_name,
    variantId: r.variant_id,
    variantName: r.variant_name,
    state: r.state as MyMenuPhotoState["state"],
    isPrimary: r.is_primary,
    reason: r.reason,
    decidedAt: r.decided_at,
  }
}

/**
 * The caller's own accepted and better-photo-requested decisions, newest
 * decision first, whichever of their photos they are on (Me's "Accepted for
 * menu use" and "Better photo requested", not limited to the loaded page).
 * `requestsOnly` returns only the better-photo requests (To do, B02 R2).
 */
export async function listMyMenuPhotoDecisions(
  actor: MediaActor,
  options: { requestsOnly?: boolean } = {}
): Promise<CoverageResult<{ states: MyMenuPhotoState[] }>> {
  if (!actor.profile.active)
    return failure("account_inactive", "Your account is not active.")
  const { data, error } = await actor.db
    .from("menu_item_photos")
    .select(MY_STATE_COLUMNS)
    .eq("author_id", actor.profile.id)
    .in(
      "state",
      options.requestsOnly
        ? ["better_photo_requested"]
        : ["accepted", "better_photo_requested"]
    )
    .order("decided_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(STATES_MAX)
  if (error) return unavailableFailure("my menu photos", error)
  const states = (data ?? []).map(myStateView)
  const dishes = await retakeableDishes(actor, states)
  if (!dishes) return { ok: true, states }
  return {
    ok: true,
    states: states.map((state) =>
      state.state === "better_photo_requested"
        ? { ...state, canRetake: dishes.has(dishKey(state)) }
        : state
    ),
  }
}

const dishKey = (ref: { itemId: string; variantId: string | null }) =>
  `${ref.itemId}:${ref.variantId ?? ""}`

/**
 * The dishes of open better-photo requests that the caller's current venue's
 * active menu offers in a food or drinks section, not archived (with the
 * variant, when one was asked for). A retake is labelled from that menu, so
 * a dish that left it, or a request from a venue the person has moved from,
 * can't be answered. Null when the menu can't be read.
 */
async function retakeableDishes(
  actor: MediaActor,
  states: readonly MyMenuPhotoState[]
): Promise<Set<string> | null> {
  const itemIds = [
    ...new Set(
      states
        .filter((s) => s.state === "better_photo_requested")
        .map((s) => s.itemId)
    ),
  ]
  const venueId = actor.profile.venueId
  if (itemIds.length === 0 || !venueId) return new Set()
  const version = await actor.db
    .from("menu_versions")
    .select("id")
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle()
  if (version.error) return null
  if (!version.data) return new Set()
  const entries = await actor.db
    .from("menu_entries")
    .select(
      "item_id, menu_sections!inner(kind), menu_items!inner(archived_at), menu_entry_variants(variant_id)"
    )
    .eq("version_id", version.data.id)
    .in("item_id", itemIds)
    .in("menu_sections.kind", ["food", "drinks"])
    .is("menu_items.archived_at", null)
  if (entries.error) return null
  const offered = new Set<string>()
  for (const entry of entries.data ?? []) {
    offered.add(dishKey({ itemId: entry.item_id, variantId: null }))
    for (const variant of entry.menu_entry_variants ?? [])
      offered.add(
        dishKey({ itemId: entry.item_id, variantId: variant.variant_id })
      )
  }
  return offered
}

/** Item-photo decisions where the reviewer was the photo's author, newest first (admins). */
export async function listItemPhotoSelfReviews(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<ItemPhotoSelfReviewView>>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const venueId = optionalUuid(args.venueId)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  if (args.period != null && !isPeriodKey(args.period))
    return invalid({ period: "Choose a month." })
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  const after = decodeKey(cursor)
  if (cursor && (!after || !/^\d+$/.test(after.id)))
    return invalid({ cursor: "Invalid page cursor." })
  const read = await readAccess(actor)
  if (!read.ok) return read
  if (!read.access.isAdmin)
    return failure("not_permitted", "Only an active admin can do this.")

  let query = actor.db
    .from("menu_item_photo_events")
    .select(
      "id, photo_id, venue_id, author_id, item_id, asset_id, action, reason, created_at, venue:venues(name), author:profiles!menu_item_photo_events_author_id_fkey(display_name), photo:menu_item_photos!menu_item_photo_events_photo_id_fkey(item_name, variant_name)"
    )
    .eq("self_review", true)
    .in("action", ["accepted", "better_photo_requested"])
  if (venueId) query = query.eq("venue_id", venueId)
  if (args.period) {
    const view = periodView(args.period as string)
    query = query.gte("created_at", view.startsAt).lt("created_at", view.endsAt)
  }
  if (after)
    query = query.or(
      `created_at.lt."${after.at}",and(created_at.eq."${after.at}",id.lt.${after.id})`
    )
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMITS.pageSize + 1)
  if (error) return unavailableFailure("menu photo self reviews", error)
  const rows = data ?? []
  const page = rows.slice(0, LIMITS.pageSize)

  const assetIds = [...new Set(page.map((r) => r.asset_id))]
  const assets = assetIds.length
    ? await actor.db
        .from("media_assets")
        .select(
          "id, thumbnail_path, preview_path, width, height, upload_state, deleted_at"
        )
        .in("id", assetIds)
    : { data: [], error: null }
  if (assets.error)
    return unavailableFailure("menu photo self review photos", assets.error)
  const byId = new Map((assets.data ?? []).map((a) => [a.id, a]))
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map((r) => {
      const a = byId.get(r.asset_id)
      return {
        eventId: String(r.id),
        photoId: r.photo_id,
        venue: { id: r.venue_id, name: r.venue?.name ?? "" },
        author: {
          id: r.author_id,
          displayName: r.author?.display_name ?? null,
        },
        item: {
          id: r.item_id,
          name: r.photo?.item_name ?? "",
          variantName: r.photo?.variant_name ?? null,
        },
        decision: r.action === "accepted" ? "accept" : "better_photo",
        reason: r.reason,
        decidedAt: r.created_at,
        asset: menuPhotoAsset(
          r.asset_id,
          !!a?.thumbnail_path,
          !!a?.preview_path,
          a?.width ?? null,
          a?.height ?? null,
          !!a && a.upload_state === "ready" && !a.deleted_at
        ),
      }
    }),
    nextCursor: last ? encodeKey(last.created_at, last.id) : null,
  }
}
