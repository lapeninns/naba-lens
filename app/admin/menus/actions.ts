"use server"

import { revalidatePath } from "next/cache"

import type { MenuDocument, MenuSource } from "@/lib/menus/types"
import { getMediaActor } from "@/lib/server/media/context"
import type { MediaActor, Outcome } from "@/lib/server/media/types"
import {
  activateMenuVersion,
  createDraftFromActive,
  createMenuDraft,
  discardMenuDraft,
  resolveMenuSuggestion,
  retireMenuVersion,
  saveMenuDraft,
  setMenuItemArchived,
} from "@/lib/server/menus"

// Server Functions are reachable by direct POST, so every argument is treated
// as untrusted: each action re-authorises the caller (fresh profile read) and
// lib/server/menus validates every id and shape before calling an RPC as the
// caller. Expected failures are returned, never thrown (Next hides thrown
// messages in production).

export type MenuActionError = {
  ok: false
  error: string
  /** 409: the draft was saved elsewhere, or its state changed. */
  conflict?: boolean
}
export type MenuAction<T = Record<never, never>> =
  ({ ok: true } & T) | MenuActionError

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

const BAD_REQUEST: MenuActionError = {
  ok: false,
  error: "This request is invalid. Reload the page and try again.",
}

/** Every menus page reads catalogue state; re-render them all. */
function refreshMenus() {
  revalidatePath("/admin/menus", "layout")
}

async function asAdmin<T>(
  run: (actor: MediaActor) => Promise<Outcome<T>>
): Promise<MenuAction<T>> {
  const auth = await getMediaActor("admin")
  if (!auth.ok) return { ok: false, error: auth.message }
  const result = await run(auth.actor)
  if (!result.ok) {
    return result.status === 409
      ? { ok: false, error: result.message, conflict: true }
      : { ok: false, error: result.message }
  }
  refreshMenus()
  const { ok: _ok, ...rest } = result
  void _ok
  return { ok: true, ...(rest as T) }
}

export async function createDraftAction(
  input: unknown
): Promise<MenuAction<{ versionId: string }>> {
  if (!isObject(input) || typeof input.venueId !== "string") return BAD_REQUEST
  const { venueId, title, source, document, basedOnVersionId } = input
  return asAdmin((actor) =>
    createMenuDraft(actor, {
      venueId,
      title: title as string,
      source: source as MenuSource,
      document: document as MenuDocument,
      basedOnVersionId:
        typeof basedOnVersionId === "string" ? basedOnVersionId : null,
    })
  )
}

/** A new, empty draft entered by hand. */
export async function createEmptyDraftAction(
  venueId: unknown
): Promise<MenuAction<{ versionId: string }>> {
  if (typeof venueId !== "string") return BAD_REQUEST
  return asAdmin((actor) =>
    createMenuDraft(actor, {
      venueId,
      title: "New menu",
      source: {
        kind: "manual",
        label: null,
        sha256: null,
        revision: null,
        capturedAt: null,
        notes: null,
      },
      document: { title: "New menu", sections: [] },
      basedOnVersionId: null,
    })
  )
}

/** A new draft copied from the venue's active menu (item ids carried). */
export async function createDraftFromActiveAction(
  venueId: unknown
): Promise<MenuAction<{ versionId: string }>> {
  if (typeof venueId !== "string") return BAD_REQUEST
  return asAdmin((actor) => createDraftFromActive(actor, venueId))
}

export async function saveDraftAction(
  input: unknown
): Promise<MenuAction<{ revision: number }>> {
  if (!isObject(input) || typeof input.versionId !== "string")
    return BAD_REQUEST
  const { versionId, expectedRevision, document } = input
  return asAdmin((actor) =>
    saveMenuDraft(actor, {
      versionId,
      expectedRevision: expectedRevision as number,
      document: document as MenuDocument,
    })
  )
}

export async function activateVersionAction(
  input: unknown
): Promise<MenuAction> {
  if (!isObject(input) || typeof input.versionId !== "string")
    return BAD_REQUEST
  const { versionId, expectedRevision } = input
  return asAdmin((actor) =>
    activateMenuVersion(actor, {
      versionId,
      expectedRevision: expectedRevision as number,
    })
  )
}

export async function retireVersionAction(
  versionId: unknown
): Promise<MenuAction> {
  if (typeof versionId !== "string") return BAD_REQUEST
  return asAdmin((actor) => retireMenuVersion(actor, versionId))
}

export async function discardDraftAction(
  versionId: unknown
): Promise<MenuAction> {
  if (typeof versionId !== "string") return BAD_REQUEST
  return asAdmin((actor) => discardMenuDraft(actor, versionId))
}

export async function setItemArchivedAction(
  itemId: unknown,
  archived: unknown
): Promise<MenuAction> {
  if (typeof itemId !== "string" || typeof archived !== "boolean")
    return BAD_REQUEST
  return asAdmin((actor) => setMenuItemArchived(actor, { itemId, archived }))
}

export async function resolveSuggestionAction(
  input: unknown
): Promise<MenuAction> {
  if (!isObject(input) || typeof input.suggestionId !== "string")
    return BAD_REQUEST
  const { suggestionId, status, itemId, note } = input
  if (status !== "resolved" && status !== "dismissed") return BAD_REQUEST
  return asAdmin((actor) =>
    resolveMenuSuggestion(actor, {
      suggestionId,
      status,
      itemId: typeof itemId === "string" ? itemId : null,
      note: typeof note === "string" ? note : null,
    })
  )
}
