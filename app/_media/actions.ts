"use server"

import { removeMediaAsset } from "@/lib/server/lifecycle/remove"
import { getMediaActor } from "@/lib/server/media/context"
import type { DeleteImpact } from "@/lib/work-client/contract"
import { workServices } from "@/lib/work-client/services"

export type DeleteMediaResult = { ok: true } | { ok: false; error: string }

/**
 * `missing`: the database predates B02, so the dialog stays as it was;
 * `failed`: the read failed, so the dialog says it couldn't check.
 */
export type DeleteEvidenceResult =
  | { status: "ok"; impact: DeleteImpact }
  | { status: "missing" }
  | { status: "failed" }

/**
 * What deleting the caller's own photo does to venue answers (HM-04), read
 * as that staff member: the database answers for the uploader only.
 */
export async function readDeleteEvidence(
  assetId: string
): Promise<DeleteEvidenceResult> {
  if (typeof assetId !== "string") return { status: "failed" }
  const auth = await getMediaActor("staff")
  if (!auth.ok) return { status: "failed" }
  const read = await workServices.getDeleteImpact(auth.actor, assetId)
  if (read.status === "ok") return { status: "ok", impact: read.value }
  return { status: read.status }
}

/**
 * Delete from the staff portfolio or the admin library. lifecycle's
 * removeMediaAsset re-authorises the caller (staff: own; admin: any), writes the
 * tombstone and removes the objects, retrying later if storage fails.
 */
export async function deleteMedia(assetId: string): Promise<DeleteMediaResult> {
  if (typeof assetId !== "string") {
    return { ok: false, error: "This file could not be found." }
  }
  const result = await removeMediaAsset(assetId)
  if (result.ok) return { ok: true }
  switch (result.status) {
    case 401:
      return { ok: false, error: "Sign in again to continue." }
    case 403:
      return {
        ok: false,
        error: "Your account is not active, so files cannot be removed.",
      }
    case 404:
      return { ok: false, error: "This file could not be found." }
    default:
      return { ok: false, error: "Could not remove the file. Try again." }
  }
}
