"use server"

import { revalidatePath } from "next/cache"

import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import type { Outcome } from "@/lib/server/media/types"
import type { MediaActor } from "@/lib/server/media/types"
import {
  createChangeRequest,
  createSpecial,
  decideSpecial,
  markPresentationChanged,
  reviewSpecial,
  setItemAvailability,
  setItemDisplayName,
  setItemPackaging,
  withdrawChangeRequest,
} from "@/lib/server/menus/local"

// Manager menu actions (S1-MENUS; spec §7 M5). Server Functions are reachable
// by direct POST: each re-authorises the caller as the venue's manager (or an
// admin naming the venue), lib/server/menus/local validates every field, and
// the database re-checks the venue in its own transaction. Expected failures
// are returned, never thrown.

export type LocalAction<T = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

async function asManager<T>(
  input: unknown,
  run: (
    actor: MediaActor,
    venueId: string,
    input: Record<string, unknown>
  ) => Promise<Outcome<T>>
): Promise<LocalAction<T>> {
  if (!isObject(input))
    return { ok: false, error: "This request is invalid. Reload the page." }
  const scope = await getManagerPhotoCtx(input.venueId ?? undefined)
  if (!scope.ok) return { ok: false, error: scope.message }
  const result = await run(scope.ctx.actor, scope.ctx.venueId, input)
  if (!result.ok) return { ok: false, error: result.message }
  revalidatePath("/manager/menu", "layout")
  const { ok: _ok, ...rest } = result
  void _ok
  return { ok: true, ...(rest as T) }
}

export async function setAvailabilityAction(input: unknown) {
  return asManager(input, (actor, _venue, i) => setItemAvailability(actor, i))
}

export async function setDisplayNameAction(input: unknown) {
  return asManager(input, (actor, _venue, i) => setItemDisplayName(actor, i))
}

export async function presentationChangedAction(input: unknown) {
  return asManager(input, (actor, _venue, i) =>
    markPresentationChanged(actor, i)
  )
}

export async function requestChangeAction(input: unknown) {
  return asManager(input, (actor, venueId, i) =>
    createChangeRequest(actor, { ...i, venueId })
  )
}

export async function withdrawChangeAction(input: unknown) {
  return asManager(input, (actor, _venue, i) => withdrawChangeRequest(actor, i))
}

export async function createSpecialAction(input: unknown) {
  return asManager(input, (actor, venueId, i) =>
    createSpecial(actor, { ...i, venueId })
  )
}

export async function decideSpecialAction(input: unknown) {
  return asManager(input, (actor, _venue, i) => decideSpecial(actor, i))
}

export async function reviewSpecialAction(input: unknown) {
  return asManager(input, (actor, _venue, i) => reviewSpecial(actor, i))
}

/** FA-51: Packaged and Photo wanted on one item (no reason). */
export async function setPackagingAction(input: unknown) {
  return asManager(input, (actor, _venue, i) => setItemPackaging(actor, i))
}
