"use server"

import { getMediaActor } from "@/lib/server/media/context"
import {
  finaliseAsset,
  type FinaliseResponse,
} from "@/lib/server/media/finalise"
import { listOwnMedia } from "@/lib/server/media/library"
import { reserveAsset, type ReserveResponse } from "@/lib/server/media/reserve"
import type { MediaPage } from "@/lib/server/media/types"

// Expected failures are returned, not thrown: Next replaces thrown messages in
// production, and the upload dialog must show the real reason.
type Result<T> =
  ({ ok: true } & T) | { ok: false; message: string; status?: number }

/** lib/upload `reserve`. Owner, venue, asset ID and key come from the server. */
export async function reserveUpload(
  input: unknown
): Promise<Result<{ reservation: ReserveResponse }>> {
  const auth = await getMediaActor("staff")
  if (!auth.ok) return { ok: false, message: auth.message, status: auth.status }
  const result = await reserveAsset(
    auth.actor,
    (input ?? {}) as Parameters<typeof reserveAsset>[1]
  )
  if (!result.ok)
    return { ok: false, message: result.message, status: result.status }
  const { ok: _ok, ...reservation } = result
  void _ok
  return { ok: true, reservation }
}

/** lib/upload `finalise`: validate the stored bytes and mark ready or failed. */
export async function finaliseUpload(
  input: unknown
): Promise<Result<{ result: FinaliseResponse }>> {
  const auth = await getMediaActor("staff")
  if (!auth.ok) return { ok: false, message: auth.message, status: auth.status }
  const result = await finaliseAsset(
    auth.actor,
    (input ?? {}) as Parameters<typeof finaliseAsset>[1]
  )
  if (!result.ok)
    return { ok: false, message: result.message, status: result.status }
  return {
    ok: true,
    result:
      result.state === "ready"
        ? { state: "ready" }
        : { state: "failed", error: result.error },
  }
}

/** Next page (or, without a cursor, a fresh first page) of the own portfolio. */
export async function loadMyMedia(
  cursor: string | null
): Promise<Result<{ page: MediaPage }>> {
  const auth = await getMediaActor("staff")
  if (!auth.ok) return { ok: false, message: auth.message, status: auth.status }
  const result = await listOwnMedia(auth.actor, cursor)
  if (!result.ok) return { ok: false, message: result.message }
  return {
    ok: true,
    page: { items: result.items, nextCursor: result.nextCursor },
  }
}
