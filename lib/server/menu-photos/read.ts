import "server-only"

import { menuPhotoRoutes } from "@/lib/server/coverage/menu-items"
import { invalid } from "@/lib/server/coverage/errors"
import {
  isObject,
  isUuid,
  optionalText,
  optionalUuid,
} from "@/lib/server/coverage/validate"
import type { Database } from "@/lib/db/types"

import type { ManagerPhotoCtx } from "./context"
import { eventsCursor, itemsCursor, queueCursor } from "./cursor"
import { BAD_REQUEST, menuPhotoFailure } from "./errors"
import type {
  Contributor,
  ContributorStatus,
  ItemEvent,
  ItemEventAction,
  ItemPhoto,
  ManagerItemDetail,
  ManagerMenuItem,
  ManagerMenuState,
  ManagerOverview,
  MenuItemStatus,
  MenuPhotoResult,
  OverviewSection,
  Page,
  PhotoAsset,
  PhotoBasis,
  PhotoState,
  QueueCard,
  QueueCardKind,
  QueueStatus,
  RecheckKind,
  SectionKind,
  StaffLabel,
} from "./types"
import { isMenuStatus, isQueueStatus } from "./validate"

// Manager reads (Overview, Menu, Review, item, contributors) through the
// manager_menu_photo_* functions. Each names the context's venue; the database
// re-checks the caller's scope and raises not_venue_manager otherwise, so a
// failed read is never an empty one. Id reads outside the venue are empty.

type Fns = Database["public"]["Functions"]
type ItemRow = Fns["manager_menu_photo_items"]["Returns"][number]
type QueueRow = Fns["manager_menu_photo_queue"]["Returns"][number]
type ContributorRow = Fns["manager_menu_photo_contributor"]["Returns"][number]

export const MENU_PAGE = 50
export const QUEUE_PAGE = 24
export const EVENTS_PAGE = 20
const QUERY_MAX = 80
const BAD_CURSOR = invalid({ cursor: "Invalid page cursor." })

const objectOrEmpty = (input: unknown) =>
  isObject(input) ? input : input == null ? {} : null

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : null)

const RECHECK_KINDS: readonly string[] = [
  "name_changed",
  "section_changed",
  "variant_removed",
]
const recheckKind = (v: unknown): RecheckKind | null =>
  typeof v === "string" && RECHECK_KINDS.includes(v) ? (v as RecheckKind) : null
const basisOf = (v: unknown): PhotoBasis | null =>
  v === "staff_label" || v === "reviewer" ? v : null
const contributorStatus = (v: unknown): ContributorStatus =>
  v === "here" || v === "moved" || v === "left" || v === "manager" ? v : "left"

export function photoAsset(
  assetId: string,
  hasThumbnail: boolean,
  hasPreview: boolean,
  width: number | null,
  height: number | null
): PhotoAsset {
  return {
    assetId,
    thumbnailUrl: hasThumbnail ? menuPhotoRoutes.thumbnail(assetId) : null,
    previewUrl: hasPreview ? menuPhotoRoutes.preview(assetId) : null,
    width,
    height,
  }
}

function variantsOf(value: unknown): ManagerMenuItem["variants"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v) =>
    isObject(v) && isUuid(v.variantId) && typeof v.name === "string"
      ? [{ variantId: v.variantId, name: v.name }]
      : []
  )
}

// ---- Overview ----------------------------------------------------------------------

function sectionsOf(value: unknown): OverviewSection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((s) =>
    isObject(s) && isUuid(s.sectionId) && typeof s.name === "string"
      ? [
          {
            sectionId: s.sectionId,
            name: s.name,
            kind: (s.kind === "drinks" ? "drinks" : "food") as SectionKind,
            position: num(s.position) ?? 0,
            eligible: num(s.eligible) ?? 0,
            covered: num(s.covered) ?? 0,
            awaitingReview: num(s.awaitingReview) ?? 0,
            needsPhoto: num(s.needsPhoto) ?? 0,
          },
        ]
      : []
  )
}

/** Menu photo totals, waiting and recheck counts and the active menu for the venue. */
export async function getManagerOverview(
  ctx: ManagerPhotoCtx
): Promise<MenuPhotoResult<{ overview: ManagerOverview }>> {
  const { data, error } = await ctx.actor.db.rpc(
    "manager_menu_photo_overview",
    { p_venue_id: ctx.venueId }
  )
  if (error) return menuPhotoFailure(error, "manager menu overview")
  const r = data?.[0]
  if (!r) return menuPhotoFailure(null, "manager menu overview")
  const state = (
    ["no_menu", "empty", "ready"].includes(r.menu_state)
      ? r.menu_state
      : "no_menu"
  ) as ManagerMenuState
  return {
    ok: true,
    overview: {
      venueId: r.venue_id,
      venueName: r.venue_name ?? "",
      menuState: state,
      menu: r.menu_version_id
        ? {
            versionId: r.menu_version_id,
            title: r.menu_title ?? "",
            activatedAt: r.activated_at ?? null,
          }
        : null,
      eligible: r.eligible_items,
      covered: r.covered_items,
      awaitingReviewItems: r.awaiting_review_items,
      needsPhotoItems: r.needs_photo_items,
      replacementPendingItems: r.replacement_pending_items,
      needsRecheckItems: r.needs_recheck_items,
      pendingPhotos: r.pending_photos,
      ownWaitingPhotos: r.own_waiting_photos,
      oldestPendingAt: r.oldest_pending_at ?? null,
      carriedItems: r.carried_items,
      newItems: r.new_items,
      sections: sectionsOf(r.sections),
    },
  }
}

// ---- Menu items --------------------------------------------------------------------

function menuItemView(r: ItemRow): ManagerMenuItem {
  return {
    itemId: r.item_id,
    name: r.name,
    description: r.description ?? null,
    section: {
      id: r.section_id,
      name: r.section_name,
      kind: r.section_kind === "drinks" ? "drinks" : "food",
      position: r.section_position,
    },
    entryPosition: r.entry_position,
    variants: variantsOf(r.variants),
    status: r.status as MenuItemStatus,
    hasPendingReplacement: r.has_pending_replacement,
    needsRecheck: r.needs_recheck,
    ownWaiting: r.own_waiting,
    othersWaiting: r.others_waiting,
    acceptedCount: r.accepted_count,
    candidateCount: r.candidate_count ?? 0,
    preferred: r.primary_asset_id
      ? photoAsset(
          r.primary_asset_id,
          r.primary_has_thumbnail,
          r.primary_has_preview,
          r.primary_width ?? null,
          r.primary_height ?? null
        )
      : null,
    itemRevision: r.item_revision,
  }
}

/**
 * Eligible items in menu order: a status filter (`covered`, `awaiting_review`,
 * `needs_photo`, `recheck`, `replacement`), a section and a name or alias
 * search, 50 a page. Also the item picker's source.
 */
export async function listManagerMenuItems(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<MenuPhotoResult<Page<ManagerMenuItem>>> {
  const args = objectOrEmpty(input)
  if (!args) return BAD_REQUEST
  if (args.status != null && !isMenuStatus(args.status))
    return invalid({ status: "Choose a status." })
  const sectionId = optionalUuid(args.sectionId)
  if (sectionId === undefined)
    return invalid({ sectionId: "Choose a section." })
  const query = optionalText(args.query, QUERY_MAX)
  if (query === undefined)
    return invalid({ query: `Use up to ${QUERY_MAX} characters.` })
  if (args.cursor != null && typeof args.cursor !== "string") return BAD_CURSOR
  const after = args.cursor ? itemsCursor.decode(args.cursor as string) : null
  if (args.cursor && !after) return BAD_CURSOR

  const { data, error } = await ctx.actor.db.rpc("manager_menu_photo_items", {
    p_venue_id: ctx.venueId,
    ...(args.status ? { p_status: args.status as string } : {}),
    ...(sectionId ? { p_section_id: sectionId } : {}),
    ...(query ? { p_query: query } : {}),
    ...(after
      ? {
          p_after_section_position: after.section,
          p_after_entry_position: after.entry,
          p_after_item_id: after.itemId,
        }
      : {}),
    p_limit: MENU_PAGE + 1,
  })
  if (error) return menuPhotoFailure(error, "manager menu items")
  const rows = data ?? []
  const page = rows.slice(0, MENU_PAGE)
  const last = rows.length > MENU_PAGE ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map(menuItemView),
    nextCursor: last
      ? itemsCursor.encode({
          section: last.section_position,
          entry: last.entry_position,
          itemId: last.item_id,
        })
      : null,
  }
}

// ---- Review queue ------------------------------------------------------------------

function staffLabelsOf(value: unknown): StaffLabel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((l) =>
    isObject(l) && isUuid(l.itemId)
      ? [
          {
            itemId: l.itemId,
            variantId: isUuid(l.variantId) ? l.variantId : null,
            itemName: str(l.itemName) ?? "",
            variantName: str(l.variantName),
            onMenu: l.onMenu === true,
          },
        ]
      : []
  )
}

export function queueCardView(r: QueueRow): QueueCard {
  return {
    key: r.sort_key,
    kind: r.kind as QueueCardKind,
    labelId: r.label_id ?? null,
    photoId: r.photo_id ?? null,
    asset: photoAsset(
      r.asset_id,
      r.has_thumbnail,
      r.has_preview,
      r.width ?? null,
      r.height ?? null
    ),
    uploadedAt: r.created_at,
    labelledAt: r.labelled_at ?? null,
    contributor: {
      id: r.uploader_id,
      name: r.uploader_name,
      status: contributorStatus(r.contributor_status),
      canFollowUp: r.can_follow_up,
    },
    isSelf: r.is_self,
    item:
      r.item_id && r.item_name && r.section_id
        ? {
            itemId: r.item_id,
            name: r.item_name,
            sectionId: r.section_id,
            sectionName: r.section_name ?? "",
            variantId: r.variant_id ?? null,
            variantName: r.variant_name ?? null,
            covered: r.item_covered,
          }
        : null,
    staffLabels: staffLabelsOf(r.staff_label),
    state: (r.photo_state as PhotoState | null) ?? null,
    isPrimary: r.is_primary,
    isEffectivePrimary: r.is_effective_primary,
    basis: basisOf(r.basis),
    reason: r.reason ?? null,
    recheckKind: recheckKind(r.recheck_kind),
    correctsItemId: r.corrects_item_id ?? null,
    correctsVariantId: r.corrects_variant_id ?? null,
    correctsItemName: r.corrects_item_name ?? null,
    itemRevision: r.item_revision ?? 0,
    groupCount: r.group_count,
  }
}

/**
 * Photos to review, oldest upload first, 24 a page. `status` picks the set
 * (default `pending`); `sectionId`, `contributorId` and `itemId` narrow it
 * (section and item do not apply to `stale_label` and `unlabelled`).
 */
export async function listReviewQueue(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<MenuPhotoResult<Page<QueueCard>>> {
  const args = objectOrEmpty(input)
  if (!args) return BAD_REQUEST
  if (args.status != null && !isQueueStatus(args.status))
    return invalid({ status: "Choose a status." })
  const status: QueueStatus = (args.status as QueueStatus) ?? "pending"
  const sectionId = optionalUuid(args.sectionId)
  const contributorId = optionalUuid(args.contributorId)
  const itemId = optionalUuid(args.itemId)
  if (
    sectionId === undefined ||
    contributorId === undefined ||
    itemId === undefined
  )
    return BAD_REQUEST
  if (args.cursor != null && typeof args.cursor !== "string") return BAD_CURSOR
  const after = args.cursor ? queueCursor.decode(args.cursor as string) : null
  if (args.cursor && !after) return BAD_CURSOR

  const { data, error } = await ctx.actor.db.rpc("manager_menu_photo_queue", {
    p_venue_id: ctx.venueId,
    p_status: status,
    ...(sectionId ? { p_section_id: sectionId } : {}),
    ...(contributorId ? { p_contributor_id: contributorId } : {}),
    ...(itemId ? { p_item_id: itemId } : {}),
    ...(after
      ? { p_after_created_at: after.createdAt, p_after_key: after.key }
      : {}),
    p_limit: QUEUE_PAGE + 1,
  })
  if (error) return menuPhotoFailure(error, "manager review queue")
  const rows = data ?? []
  const page = rows.slice(0, QUEUE_PAGE)
  const last = rows.length > QUEUE_PAGE ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map(queueCardView),
    nextCursor: last
      ? queueCursor.encode({ createdAt: last.created_at, key: last.sort_key })
      : null,
  }
}

// ---- One item ----------------------------------------------------------------------

function itemPhotosOf(value: unknown): ItemPhoto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((p): ItemPhoto[] => {
    if (!isObject(p) || !isUuid(p.photoId) || !isUuid(p.assetId)) return []
    const state = p.state
    if (
      state !== "accepted" &&
      state !== "better_photo_requested" &&
      state !== "needs_recheck"
    )
      return []
    return [
      {
        photoId: p.photoId,
        asset: photoAsset(
          p.assetId,
          p.hasThumbnail === true,
          p.hasPreview === true,
          num(p.width),
          num(p.height)
        ),
        state,
        basis: basisOf(p.basis) ?? "staff_label",
        isPrimary: p.isPrimary === true,
        isEffective: p.isEffective === true,
        variantId: isUuid(p.variantId) ? p.variantId : null,
        variantName: str(p.variantName),
        recheckKind: recheckKind(p.recheckKind),
        reason: str(p.reason),
        decidedAt: str(p.decidedAt) ?? "",
        decidedByName: str(p.decidedByName),
        author: {
          id: str(p.authorId) ?? "",
          name: str(p.authorName) ?? "",
          status: contributorStatus(p.contributorStatus),
          canFollowUp: p.canFollowUp === true,
        },
        isSelf: p.isSelf === true,
        correctsItemId: isUuid(p.correctsItemId) ? p.correctsItemId : null,
        correctsVariantId: isUuid(p.correctsVariantId)
          ? p.correctsVariantId
          : null,
        correctsItemName: str(p.correctsItemName),
      },
    ]
  })
}

/**
 * The item's Menu row (counts and headline). The item read has no paging
 * position, so the row is found through the section's list, searched by the
 * item's name; at most a few pages are read.
 */
async function findMenuItemRow(
  ctx: ManagerPhotoCtx,
  itemId: string,
  sectionId: string,
  name: string
): Promise<{ row: ItemRow | null } | { error: { message?: string } }> {
  let after: ItemRow | null = null
  for (let page = 0; page < 5; page++) {
    const { data, error } = await ctx.actor.db.rpc("manager_menu_photo_items", {
      p_venue_id: ctx.venueId,
      p_section_id: sectionId,
      p_query: name.slice(0, QUERY_MAX),
      ...(after
        ? {
            p_after_section_position: after.section_position,
            p_after_entry_position: after.entry_position,
            p_after_item_id: after.item_id,
          }
        : {}),
      p_limit: 101,
    })
    if (error) return { error }
    const rows: ItemRow[] = data ?? []
    const hit = rows.find((r) => r.item_id === itemId)
    if (hit) return { row: hit }
    if (rows.length < 101) return { row: null }
    after = rows[rows.length - 1]
  }
  return { row: null }
}

/**
 * An item of the venue's active menu: its menu photo (with the fallback
 * flag), accepted alternatives, asked-for-another and recheck decisions, and
 * the first page of photos waiting for the caller. Null for any other id.
 */
export async function getManagerItem(
  ctx: ManagerPhotoCtx,
  itemId: unknown
): Promise<MenuPhotoResult<{ detail: ManagerItemDetail | null }>> {
  if (!isUuid(itemId)) return { ok: true, detail: null }
  const { data, error } = await ctx.actor.db.rpc("manager_menu_photo_item", {
    p_venue_id: ctx.venueId,
    p_item_id: itemId,
  })
  if (error) return menuPhotoFailure(error, "manager menu item")
  const r = data?.[0]
  if (!r) return { ok: true, detail: null }

  const [found, waiting] = await Promise.all([
    findMenuItemRow(ctx, itemId, r.section_id, r.name),
    listReviewQueue(ctx, { status: "pending", itemId }),
  ])
  if ("error" in found)
    return menuPhotoFailure(found.error, "manager menu item row")
  if (!waiting.ok) return waiting

  const photos = itemPhotosOf(r.photos)
  const effective = photos.find((p) => p.isEffective) ?? null
  const item: ManagerMenuItem = found.row
    ? menuItemView(found.row)
    : {
        itemId: r.item_id,
        name: r.name,
        description: r.description ?? null,
        section: {
          id: r.section_id,
          name: r.section_name,
          kind: r.section_kind === "drinks" ? "drinks" : "food",
          position: 0,
        },
        entryPosition: 0,
        variants: variantsOf(r.variants),
        status: r.status as MenuItemStatus,
        hasPendingReplacement: false,
        needsRecheck: photos.some((p) => p.state === "needs_recheck"),
        ownWaiting: 0,
        othersWaiting: 0,
        acceptedCount: photos.filter((p) => p.state === "accepted").length,
        candidateCount: waiting.items.length,
        preferred: effective?.asset ?? null,
        itemRevision: r.item_revision,
      }
  return {
    ok: true,
    detail: {
      item,
      preferred: effective
        ? { ...effective, fallback: r.preferred_is_fallback }
        : null,
      alternatives: photos.filter(
        (p) => p.state === "accepted" && !p.isEffective
      ),
      askedForAnother: photos.filter(
        (p) => p.state === "better_photo_requested"
      ),
      recheck: photos.filter((p) => p.state === "needs_recheck"),
      waiting: { items: waiting.items, nextCursor: waiting.nextCursor },
    },
  }
}

const EVENT_ACTIONS: readonly string[] = [
  "accepted",
  "better_photo_requested",
  "withdrawn",
  "primary_set",
  "primary_cleared",
  "invalidated",
  "needs_recheck",
  "carried",
]
const ACTOR_ROLES: readonly string[] = ["staff", "manager", "admin", "system"]

/** The item's decision history, newest first, 20 a page (`before` is the cursor). */
export async function listItemEvents(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<MenuPhotoResult<Page<ItemEvent>>> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isUuid(input.itemId)) return { ok: true, items: [], nextCursor: null }
  if (input.before != null && typeof input.before !== "string")
    return BAD_CURSOR
  const before = input.before
    ? eventsCursor.decode(input.before as string)
    : null
  if (input.before && !before) return BAD_CURSOR

  const { data, error } = await ctx.actor.db.rpc(
    "manager_menu_photo_item_events",
    {
      p_venue_id: ctx.venueId,
      p_item_id: input.itemId,
      ...(before ? { p_before_id: before.before } : {}),
      p_limit: EVENTS_PAGE + 1,
    }
  )
  if (error) return menuPhotoFailure(error, "manager item history")
  const rows = data ?? []
  const page = rows.slice(0, EVENTS_PAGE)
  const last = rows.length > EVENTS_PAGE ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.flatMap((e): ItemEvent[] => {
      if (!EVENT_ACTIONS.includes(e.action)) return []
      const detail = isObject(e.detail) ? e.detail : {}
      return [
        {
          id: String(e.id),
          action: e.action as ItemEventAction,
          photoId: e.photo_id,
          actorName: e.actor_name ?? null,
          actorRole: (ACTOR_ROLES.includes(e.actor_role)
            ? e.actor_role
            : "system") as ItemEvent["actorRole"],
          reason: e.reason ?? null,
          basis: basisOf(detail.basis),
          correctsItemName: str(detail.correctsItemName),
          recheckKind:
            e.action === "needs_recheck" ? recheckKind(detail.kind) : null,
          createdAt: e.created_at,
        },
      ]
    }),
    nextCursor: last ? eventsCursor.encode({ before: last.id }) : null,
  }
}

// ---- Contributors ------------------------------------------------------------------

function contributorView(r: ContributorRow): Contributor {
  return {
    id: r.contributor_id,
    name: r.display_name,
    status: contributorStatus(r.status),
    labelledPhotos: r.labelled_photos,
    acceptedItems: r.accepted_items,
    openFollowUps: r.open_follow_ups,
    lastUploadAt: r.last_upload_at ?? null,
  }
}

/** People whose photos at the venue the caller may decide on (never the caller). */
export async function listContributors(
  ctx: ManagerPhotoCtx
): Promise<MenuPhotoResult<{ contributors: Contributor[] }>> {
  const { data, error } = await ctx.actor.db.rpc(
    "manager_menu_photo_contributors",
    { p_venue_id: ctx.venueId }
  )
  if (error) return menuPhotoFailure(error, "manager contributors")
  return { ok: true, contributors: (data ?? []).map(contributorView) }
}

/** One contributor at the venue; null for an unknown id, the caller, or no qualifying photo. */
export async function getContributor(
  ctx: ManagerPhotoCtx,
  contributorId: unknown
): Promise<MenuPhotoResult<{ contributor: Contributor | null }>> {
  if (!isUuid(contributorId)) return { ok: true, contributor: null }
  const { data, error } = await ctx.actor.db.rpc(
    "manager_menu_photo_contributor",
    { p_venue_id: ctx.venueId, p_contributor_id: contributorId }
  )
  if (error) return menuPhotoFailure(error, "manager contributor")
  const row = data?.[0]
  return { ok: true, contributor: row ? contributorView(row) : null }
}
