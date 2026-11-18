"use server"

import { revalidatePath } from "next/cache"

import { getManagerWorkspace } from "@/lib/auth/manager"
import { apiError } from "@/lib/server/http/errors"
import {
  confirmMenuMonth,
  getVenueHistory,
  setVenueReviewer,
} from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"

// Server Functions of the manager Overview and Venue hub (S2-MGR; spec §7
// M1, M5, §9.3). Every input is `unknown` (public POST endpoints). The venue
// is always the manager's workspace venue, never one from the client, and the
// database checks the manager's grant again on every call.

async function scope() {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available") return apiError("forbidden")
  const auth = await getMediaActor("manager")
  if (!auth.ok)
    return apiError(auth.status === 401 ? "unauthenticated" : "forbidden")
  return { ok: true as const, actor: auth.actor, venueId: workspace.venue.id }
}

const fields = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" ? (input as Record<string, unknown>) : {}

/** `{ role: "main" | "backup", profileId: string | null, reason? }` */
export async function setReviewerAction(input: unknown) {
  const s = await scope()
  if (!s.ok) return s
  const result = await setVenueReviewer(s.actor, {
    ...fields(input),
    venueId: s.venueId,
  })
  if (result.ok) {
    revalidatePath("/manager")
    revalidatePath("/manager/venue")
  }
  return result
}

/** `{ note? }`: this month's active menu is still right. */
export async function confirmMenuMonthAction(input: unknown) {
  const s = await scope()
  if (!s.ok) return s
  const result = await confirmMenuMonth(s.actor, {
    note: fields(input).note,
    venueId: s.venueId,
  })
  if (result.ok) {
    revalidatePath("/manager")
    revalidatePath("/manager/venue")
  }
  return result
}

/** `{ source?, before? }`: the next page of the venue's history. */
export async function venueHistoryAction(input: unknown) {
  const s = await scope()
  if (!s.ok) return s
  const i = fields(input)
  return getVenueHistory(s.actor, {
    source: i.source,
    before: i.before,
    venueId: s.venueId,
  })
}
