"use server"

import type { InviteResult } from "@/components/nabalens/invite-staff-dialog"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { inviteStaffToVenue, removeVenueMember } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import {
  setPersonTarget,
  setVenueDefaultTarget,
  applyVenueDefaultForPerson,
} from "@/lib/server/coverage/targets"

// Server Functions of the manager team screen (G-6). Every input is
// `unknown` (public POST endpoints) and every call re-authorises: a manager's
// venue comes from the workspace scope (another `venueId` is wrong_venue),
// and the database checks the grant again. The screen re-reads itself after a
// save (router.refresh), so nothing is revalidated here.

const FORBIDDEN = "You do not have permission to do that."

const venueOf = (input: unknown) =>
  input && typeof input === "object" && "venueId" in input
    ? input.venueId
    : undefined

/** `{ targetCount: number | null, reason?, expectedRevision }` */
export async function setVenueDefaultTargetAction(input: unknown) {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return setVenueDefaultTarget(scope.ctx, input)
}

/** `{ staffId, targetCount, reason?, expectedRevision }`, this month only. */
export async function setPersonTargetAction(input: unknown) {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return setPersonTarget(scope.ctx, input)
}

/** `{ staffId, reason, expectedRevision }`: back to the venue default. */
export async function backToVenueDefaultAction(input: unknown) {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return applyVenueDefaultForPerson(scope.ctx, input)
}

// People at the venue (S1-PEOPLE; spec §3.1, §7 M5, AC40, AC34). The venue
// is always the manager's workspace venue, never one from the client, and
// the database checks the grant again on every call.

/** `{ displayName, email, jobTitle }`: invite ORDINARY STAFF to this venue. */
export async function inviteVenueStaffAction(
  input: unknown
): Promise<InviteResult> {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return { status: "error", error: FORBIDDEN }
  const raw = (input ?? {}) as Record<string, unknown>
  const outcome = await inviteStaffToVenue(await accountsContext(), {
    displayName: raw.displayName,
    email: raw.email,
    jobTitle: raw.jobTitle,
    venueId: workspace.venue.id,
  })
  switch (outcome.status) {
    case "sent":
      return { status: "sent" }
    case "partial":
      return { status: "partial", message: outcome.message }
    case "added":
      return {
        status: "added",
        message: `They already have a Naba-Lens account. They can now add photos at ${workspace.venue.name} too, and keep their other venues.`,
      }
    case "already_member":
      return {
        status: "added",
        message: `They already work at ${workspace.venue.name}. Nothing changed.`,
      }
    case "error":
      return outcome.fieldErrors
        ? {
            status: "error",
            error: outcome.error,
            fieldErrors: outcome.fieldErrors,
          }
        : { status: "error", error: outcome.error }
  }
}

/** `{ profileId, reason, replacementId? }`: remove ordinary staff from this venue. */
export async function removeVenueStaffAction(input: unknown) {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return { ok: false as const, error: FORBIDDEN }
  const raw = (input ?? {}) as Record<string, unknown>
  return removeVenueMember(await accountsContext(), {
    profileId: raw.profileId,
    reason: raw.reason,
    replacementId: raw.replacementId ?? null,
    venueId: workspace.venue.id,
  })
}
