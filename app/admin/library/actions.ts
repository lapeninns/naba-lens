"use server"

import { revalidatePath } from "next/cache"

import { setSlotPrimaryPhoto } from "@/lib/server/album"
import { setPrimaryItemPhoto } from "@/lib/server/coverage/menu-items"
import {
  correctAssetVenue,
  restoreAsset,
  saveCollection,
  saveTag,
  setCollectionItems,
  tagAssets,
  withdrawAsset,
} from "@/lib/server/library/service"
import {
  actorFailureMessage,
  getMediaActor,
} from "@/lib/server/media/context"

/*
 * Server Functions for the admin Library (S2-LIBRARY, spec §8 A4). Reachable
 * by direct POST, so every input is untrusted: the caller is read again here
 * and the database decides (admins on an aal2 session only). Failures are
 * returned as values, never thrown.
 */

export type LibraryReply<T extends object = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: string }

/**
 * The admin, or the failure in its own words (S3-R6, V6): signed out, the
 * second sign-in step, an inactive account or a failed account check.
 */
async function admin() {
  const auth = await getMediaActor("admin")
  return auth.ok
    ? { ok: true as const, actor: auth.actor }
    : { ok: false as const, error: actorFailureMessage(auth) }
}

function refresh(assetId?: unknown) {
  revalidatePath("/admin/library", "layout")
  if (typeof assetId === "string") revalidatePath(`/admin/library/${assetId}`)
}

type Outcome =
  { ok: true; data: Record<string, unknown> } | { ok: false; message: string }

function reply(result: Outcome): LibraryReply<{ changed: boolean }> {
  if (!result.ok) return { ok: false, error: result.message }
  const changed = result.data.changed
  return {
    ok: true,
    changed: typeof changed === "number" ? changed > 0 : changed !== false,
  }
}

export async function withdrawAssetAction(input: {
  assetId: unknown
  reason: unknown
}) {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await withdrawAsset(a, input ?? {})
  if (result.ok) refresh(input?.assetId)
  return reply(result)
}

export async function restoreAssetAction(input: {
  assetId: unknown
  reason: unknown
}) {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await restoreAsset(a, input ?? {})
  if (result.ok) refresh(input?.assetId)
  return reply(result)
}

export async function correctVenueAction(input: {
  assetId: unknown
  venueId: unknown
  reason: unknown
}) {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await correctAssetVenue(a, input ?? {})
  if (result.ok) refresh(input?.assetId)
  return reply(result)
}

export async function tagAssetsAction(input: {
  assetIds: unknown
  tagId: unknown
  add: unknown
}) {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await tagAssets(a, input ?? {})
  if (result.ok && Array.isArray(input?.assetIds))
    input.assetIds.forEach((id) => refresh(id))
  return reply(result)
}

export async function saveTagAction(input: {
  tagId?: unknown
  name: unknown
  active?: unknown
  revision?: unknown
}): Promise<LibraryReply<{ tagId: string }>> {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await saveTag(a, input ?? {})
  if (!result.ok) return { ok: false, error: result.message }
  refresh()
  return { ok: true, tagId: String(result.data.id) }
}

export async function saveCollectionAction(input: {
  collectionId?: unknown
  name: unknown
  purpose?: unknown
  archived?: unknown
  revision?: unknown
}): Promise<LibraryReply<{ collectionId: string }>> {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await saveCollection(a, input ?? {})
  if (!result.ok) return { ok: false, error: result.message }
  refresh()
  return { ok: true, collectionId: String(result.data.id) }
}

export async function setCollectionItemsAction(input: {
  collectionId: unknown
  assetIds: unknown
  add: unknown
}) {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await setCollectionItems(a, input ?? {})
  if (result.ok && Array.isArray(input?.assetIds))
    input.assetIds.forEach((id) => refresh(id))
  return reply(result)
}

/**
 * Select primary (spec §8 A4, AC35) for any slot kind: a dish through
 * set_menu_item_primary_photo (with its item revision), a place or facility
 * through set_slot_primary_photo (S1-COV). One effective primary per slot.
 */
export async function selectPrimaryAction(input: {
  assetId: unknown
  kind: unknown
  slotId: unknown
  photoId?: unknown
  itemRevision?: unknown
}): Promise<LibraryReply> {
  const auth = await admin()
  if (!auth.ok) return auth
  const a = auth.actor
  if (input?.kind === "dish") {
    const result = await setPrimaryItemPhoto(a, {
      requestId: `lib-${crypto.randomUUID()}`,
      photoId: input.photoId,
      expectedRevision: input.itemRevision,
    })
    if (!result.ok) return { ok: false, error: result.message }
  } else {
    const result = await setSlotPrimaryPhoto(a, {
      slotKind: input?.kind,
      slotId: input?.slotId,
      assetId: input?.assetId,
    })
    if (!result.ok) return { ok: false, error: result.message }
  }
  refresh(input?.assetId)
  return { ok: true }
}
