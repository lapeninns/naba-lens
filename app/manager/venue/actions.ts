"use server"

import { revalidatePath } from "next/cache"

import { getManagerWorkspace } from "@/lib/auth/manager"
import { parseReportDecision } from "@/lib/manager/slot-reports"
import { apiError } from "@/lib/server/http/errors"
import {
  confirmMenuMonth,
  getVenueHistory,
  setVenueReviewer,
} from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"
import { decideSlotReport } from "@/lib/server/staff"

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

/**
 * S3-R5 (K3): `{ reportId, action: "resolved" | "dismissed", note? }`. The
 * database checks the report is at a venue the caller manages (S2-STAFF's
 * decide_slot_change_report); a report never changes anything by itself.
 */
export async function decideSlotReportAction(input: unknown) {
  const s = await scope()
  if (!s.ok) return s
  const decision = parseReportDecision(input)
  if (!decision)
    return apiError("invalid_input", {
      message: "Check the note: up to 500 characters.",
    })
  const result = await decideSlotReport(s.actor, decision)
  if (!result.ok && result.field === "report")
    return {
      ...result,
      // report_closed or report_not_found: the staff wording speaks to the
      // reporter ("Your manager has already dealt with this").
      message: "Someone has already dealt with this report. Reload the page.",
    }
  if (result.ok) {
    revalidatePath("/manager/venue")
    revalidatePath("/manager/venue/reports")
  }
  return result
}
