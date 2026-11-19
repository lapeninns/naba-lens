"use server"

import { revalidatePath } from "next/cache"

import { getCoverageActor } from "@/lib/server/coverage"
import { setSingleReviewer } from "@/lib/server/review/single-reviewer"

// FA-9 (S3-R1 K6). Reachable by direct POST: the caller is re-read here and
// the database refuses anyone but an active admin on a second-factor session.

export type SingleReviewerState =
  | { status: "idle" }
  | { status: "saved"; changed: boolean }
  | { status: "error"; message: string; field?: "reason" }

export async function setSingleReviewerAction(
  _prev: SingleReviewerState,
  form: FormData
): Promise<SingleReviewerState> {
  const auth = await getCoverageActor()
  if (!auth.ok) return { status: "error", message: auth.message }
  const venueId = String(form.get("venueId") ?? "")
  const result = await setSingleReviewer(auth.actor, {
    venueId,
    enabled: form.get("enabled") === "on",
    reason: form.get("reason"),
    revision: Number(form.get("revision")),
  })
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      ...(result.field === "reason" ? { field: "reason" as const } : {}),
    }
  if (result.changed) revalidatePath(`/admin/venues/${venueId}`)
  return { status: "saved", changed: result.changed }
}
