import {
  isUuid,
  parseAssetDetail,
  parseCollections,
  parseFilterLists,
  parseTags,
  type AssetDetail,
  type LibraryCollection,
  type LibraryFilterLists,
  type LibraryTag,
} from "@/lib/library/model"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

/*
 * The admin Library's reads and writes (S2-LIBRARY, spec §8 A4, §11). The
 * database decides access (admins on an aal2 session only,
 * 20261118116000_library.sql); these calls run as the caller and only map
 * refusals to statuses and plain words. Failures are values, never throws.
 */

type DbError = { code?: string; message?: string } | null

const NOT_FOUND = {
  ok: false,
  status: 404,
  message: "This could not be found. Reload the page.",
} as const
const UNAVAILABLE = {
  ok: false,
  status: 503,
  message: "Couldn't reach Naba-Lens. Try again.",
} as const

type Status = 400 | 403 | 404 | 409 | 503

const MESSAGES: Record<string, { status: Status; message: string }> = {
  not_permitted: { status: 403, message: "Only an admin can do this." },
  not_active_user: { status: 403, message: "Your account is not active." },
  media_asset_not_found: {
    status: 404,
    message: "This photo could not be found. It may have been removed.",
  },
  venue_not_found: { status: 404, message: "Choose a venue from the list." },
  tag_not_found: { status: 404, message: "This tag no longer exists." },
  collection_not_found: {
    status: 404,
    message: "This collection no longer exists.",
  },
  reason_required: {
    status: 400,
    message: "Give a reason of 3 to 500 characters.",
  },
  tag_name_invalid: {
    status: 400,
    message: "A tag name is 1 to 40 characters.",
  },
  tag_name_taken: {
    status: 409,
    message: "A tag with this name already exists.",
  },
  tag_retired: {
    status: 409,
    message: "This tag is retired. Restore it before adding it.",
  },
  tag_conflict: {
    status: 409,
    message: "Someone else changed this tag. Reload and try again.",
  },
  collection_name_invalid: {
    status: 400,
    message: "A collection name is 1 to 80 characters.",
  },
  collection_purpose_invalid: {
    status: 400,
    message: "The purpose is up to 500 characters.",
  },
  collection_archived: {
    status: 409,
    message: "This collection is archived. Restore it before adding photos.",
  },
  collection_conflict: {
    status: 409,
    message: "Someone else changed this collection. Reload and try again.",
  },
  assets_invalid: { status: 400, message: "Choose 1 to 200 photos." },
  venue_unchanged: {
    status: 409,
    message: "The photo is already recorded at this venue.",
  },
  venue_correction_pending: {
    status: 409,
    message:
      "This photo was recorded at the wrong venue, so it stays withdrawn. Add it again at the right venue.",
  },
  asset_withdrawn: {
    status: 409,
    message: "Restore this photo before making it the main photo.",
  },
}

export function libraryFailure(error: DbError): Outcome<never> {
  const known = error?.message ? MESSAGES[error.message] : undefined
  if (known) return { ok: false, status: known.status, message: known.message }
  return UNAVAILABLE
}

/** Admin RPCs not in the generated types yet are called through this. */
type Rpc = (
  fn: string,
  args?: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: DbError }>
const rpc = (actor: MediaActor): Rpc =>
  actor.db.rpc.bind(actor.db) as unknown as Rpc

async function read<T>(
  actor: MediaActor,
  fn: string,
  args: Record<string, unknown>,
  parse: (data: unknown) => T | null
): Promise<Outcome<{ value: T }>> {
  const { data, error } = await rpc(actor)(fn, args)
  if (error) return libraryFailure(error)
  const value = parse(data)
  return value === null ? UNAVAILABLE : { ok: true, value }
}

export async function getAssetDetail(
  actor: MediaActor,
  assetId: unknown
): Promise<Outcome<{ value: AssetDetail }>> {
  if (!isUuid(assetId)) return NOT_FOUND
  return read(
    actor,
    "library_asset_detail",
    { p_asset_id: assetId },
    parseAssetDetail
  )
}

export function listTags(
  actor: MediaActor
): Promise<Outcome<{ value: LibraryTag[] }>> {
  return read(actor, "library_tags", {}, parseTags)
}

export function listCollections(
  actor: MediaActor,
  includeArchived = false
): Promise<Outcome<{ value: LibraryCollection[] }>> {
  return read(
    actor,
    "library_collections",
    { p_include_archived: includeArchived },
    parseCollections
  )
}

export function getFilterLists(
  actor: MediaActor
): Promise<Outcome<{ value: LibraryFilterLists }>> {
  return read(actor, "library_filter_lists", {}, parseFilterLists)
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length >= 1 && v.length <= 200 && v.every(isUuid)
    ? Array.from(new Set(v as string[]))
    : null

async function write(
  actor: MediaActor,
  fn: string,
  args: Record<string, unknown>
): Promise<Outcome<{ data: Record<string, unknown> }>> {
  const { data, error } = await rpc(actor)(fn, args)
  if (error) return libraryFailure(error)
  return {
    ok: true,
    data: (data ?? {}) as Record<string, unknown>,
  }
}

export function withdrawAsset(
  actor: MediaActor,
  input: { assetId: unknown; reason: unknown }
) {
  if (!isUuid(input.assetId)) return Promise.resolve(NOT_FOUND)
  return write(actor, "library_withdraw_asset", {
    p_asset_id: input.assetId,
    p_reason: text(input.reason),
  })
}

export function restoreAsset(
  actor: MediaActor,
  input: { assetId: unknown; reason: unknown }
) {
  if (!isUuid(input.assetId)) return Promise.resolve(NOT_FOUND)
  return write(actor, "library_restore_asset", {
    p_asset_id: input.assetId,
    p_reason: text(input.reason),
  })
}

export function correctAssetVenue(
  actor: MediaActor,
  input: { assetId: unknown; venueId: unknown; reason: unknown }
) {
  if (!isUuid(input.assetId)) return Promise.resolve(NOT_FOUND)
  if (!isUuid(input.venueId))
    return Promise.resolve(libraryFailure({ message: "venue_not_found" }))
  return write(actor, "admin_correct_asset_venue", {
    p_asset_id: input.assetId,
    p_venue_id: input.venueId,
    p_reason: text(input.reason),
  })
}

export function saveTag(
  actor: MediaActor,
  input: {
    tagId?: unknown
    name: unknown
    active?: unknown
    revision?: unknown
  }
) {
  if (input.tagId != null && !isUuid(input.tagId))
    return Promise.resolve(libraryFailure({ message: "tag_not_found" }))
  return write(actor, "library_tag_save", {
    p_tag_id: input.tagId ?? null,
    p_name: text(input.name),
    p_active: input.active === false ? false : true,
    p_expected_revision:
      typeof input.revision === "number" ? input.revision : null,
  })
}

export function tagAssets(
  actor: MediaActor,
  input: { assetIds: unknown; tagId: unknown; add: unknown }
) {
  const list = ids(input.assetIds)
  if (!list)
    return Promise.resolve(libraryFailure({ message: "assets_invalid" }))
  if (!isUuid(input.tagId))
    return Promise.resolve(libraryFailure({ message: "tag_not_found" }))
  return write(actor, "library_asset_tag", {
    p_asset_ids: list,
    p_tag_id: input.tagId,
    p_add: input.add === true,
  })
}

export function saveCollection(
  actor: MediaActor,
  input: {
    collectionId?: unknown
    name: unknown
    purpose?: unknown
    archived?: unknown
    revision?: unknown
  }
) {
  if (input.collectionId != null && !isUuid(input.collectionId))
    return Promise.resolve(libraryFailure({ message: "collection_not_found" }))
  return write(actor, "library_collection_save", {
    p_collection_id: input.collectionId ?? null,
    p_name: text(input.name),
    p_purpose: text(input.purpose) || null,
    p_archived: input.archived === true,
    p_expected_revision:
      typeof input.revision === "number" ? input.revision : null,
  })
}

export function setCollectionItems(
  actor: MediaActor,
  input: { collectionId: unknown; assetIds: unknown; add: unknown }
) {
  const list = ids(input.assetIds)
  if (!list)
    return Promise.resolve(libraryFailure({ message: "assets_invalid" }))
  if (!isUuid(input.collectionId))
    return Promise.resolve(libraryFailure({ message: "collection_not_found" }))
  return write(actor, "library_collection_set_items", {
    p_collection_id: input.collectionId,
    p_asset_ids: list,
    p_add: input.add === true,
  })
}
