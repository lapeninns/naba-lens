"use server"

import type {
  RemovalImpact,
  RemovalRequest,
  RemovalRequestState,
} from "@/lib/media/removal"
import {
  cancelMediaRemovalRequest,
  declineMediaRemovalRequest,
  getRemovalImpact,
  listMediaRemovalRequests,
  removeAcceptedMediaAsset,
  requestMediaRemoval,
} from "@/lib/server/lifecycle/removal"
import { getMediaActor } from "@/lib/server/media/context"
import { OWN_MEDIA_ROLES } from "@/lib/server/media/roles"

/*
 * Server Functions for removing accepted media (FA-21). Screens (Me, the
 * manager's album, the admin library: Sprint 2) call these; every call
 * re-authorises and the database decides. Replies are values, never throws.
 */

export type RemovalReply<T extends object = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: string }

type Failure = { ok: false; status: number; message: string }

const reply = <T extends object>(
  result: ({ ok: true } & T) | Failure
): RemovalReply<T> =>
  result.ok ? result : { ok: false, error: result.message }

const signedOut = { ok: false as const, error: "Sign in again to continue." }

const MANAGING_ROLES = ["manager", "staff", "admin"] as const

/** Ask an admin to remove an accepted photo (its uploader or the manager). */
export async function requestRemoval(
  assetId: string,
  reason: string
): Promise<RemovalReply<{ requestId: string; created: boolean }>> {
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return { ok: false, error: auth.message }
  return reply(await requestMediaRemoval(auth.actor, String(assetId), reason))
}

/** Withdraw one's own open request. */
export async function cancelRemovalRequest(
  requestId: string
): Promise<RemovalReply> {
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return { ok: false, error: auth.message }
  return reply(await cancelMediaRemovalRequest(auth.actor, String(requestId)))
}

/** Requests the caller may see (admins all, managers their venue). */
export async function readRemovalRequests(
  state: RemovalRequestState | null = "open"
): Promise<RemovalReply<{ requests: RemovalRequest[] }>> {
  const auth = await getMediaActor(MANAGING_ROLES)
  if (!auth.ok)
    return auth.status === 401 ? signedOut : { ok: false, error: auth.message }
  return reply(await listMediaRemovalRequests(auth.actor, { state }))
}

/** The impact preview (admins, and the venue's manager). */
export async function readRemovalImpact(
  assetId: string
): Promise<RemovalReply<{ impact: RemovalImpact }>> {
  const auth = await getMediaActor(MANAGING_ROLES)
  if (!auth.ok) return { ok: false, error: auth.message }
  return reply(await getRemovalImpact(auth.actor, String(assetId)))
}

/** Admin: remove with a reason and the preview's token. */
export async function removeAcceptedMedia(input: {
  assetId: string
  reason: string
  impactToken: string
}): Promise<RemovalReply<{ storage: "removed" | "pending" }>> {
  const auth = await getMediaActor("admin")
  if (!auth.ok) return { ok: false, error: auth.message }
  const result = await removeAcceptedMediaAsset(auth.actor, {
    assetId: String(input?.assetId),
    reason: input?.reason,
    impactToken: String(input?.impactToken ?? ""),
  })
  return result.ok ? { ok: true, storage: result.storage } : reply(result)
}

/** Admin: keep the photo and close the request with a reason. */
export async function declineRemovalRequest(
  requestId: string,
  reason: string
): Promise<RemovalReply> {
  const auth = await getMediaActor("admin")
  if (!auth.ok) return { ok: false, error: auth.message }
  return reply(
    await declineMediaRemovalRequest(auth.actor, String(requestId), reason)
  )
}
