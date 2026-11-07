import "server-only"

import {
  failure,
  invalid,
  NOT_PERMITTED,
  unavailableFailure,
  WRONG_VENUE,
} from "@/lib/server/coverage/errors"
import { optionalUuid } from "@/lib/server/coverage/validate"
import { getMediaActor, ROLE_NOT_ALLOWED } from "@/lib/server/media/context"
import type { MediaActor } from "@/lib/server/media/types"

import type { MenuPhotoResult } from "./types"

/** Who is deciding, for which venue. Built fresh on every request; never cached. */
export type ManagerPhotoCtx = {
  actor: MediaActor
  venueId: string
  role: "manager" | "admin"
}

const NO_WORKSPACE = failure(
  "not_permitted",
  "You do not have access to this venue's workspace. Reload the page."
)

/**
 * The manager workspace scope of an authorised actor. A manager account acts
 * on the venue `manager_workspace_scope` reports as effective (a different
 * `venueId` is `wrong_venue`); an admin must name the venue. Every database
 * function re-checks the scope in its own transaction.
 */
export async function managerPhotoCtxFor(
  actor: MediaActor,
  venueId?: unknown
): Promise<MenuPhotoResult<{ ctx: ManagerPhotoCtx }>> {
  const requested = optionalUuid(venueId)
  if (requested === undefined) return invalid({ venueId: "Choose a venue." })
  if (!actor.profile.active)
    return failure("account_inactive", "Your account is not active.")
  if (actor.profile.role === "admin") {
    if (!requested) return invalid({ venueId: "Choose a venue." })
    return { ok: true, ctx: { actor, venueId: requested, role: "admin" } }
  }
  if (actor.profile.role !== "manager") return NOT_PERMITTED
  const { data, error } = await actor.db.rpc("manager_workspace_scope")
  if (error) return unavailableFailure("manager workspace scope", error)
  const row = data?.[0]
  if (!row?.effective || !row.venue_id) return NO_WORKSPACE
  if (requested && requested !== row.venue_id) return WRONG_VENUE
  return { ok: true, ctx: { actor, venueId: row.venue_id, role: "manager" } }
}

/** The current request's manager or admin, with the venue it acts on. */
export async function getManagerPhotoCtx(
  venueId?: unknown
): Promise<MenuPhotoResult<{ ctx: ManagerPhotoCtx }>> {
  const auth = await getMediaActor(["manager", "admin"])
  if (!auth.ok) {
    if (auth.status === 401) return failure("unauthenticated", auth.message)
    if (auth.message === ROLE_NOT_ALLOWED.message) return NOT_PERMITTED
    if (auth.status === 403) return failure("account_inactive", auth.message)
    return failure("unavailable", auth.message)
  }
  return managerPhotoCtxFor(auth.actor, venueId)
}
