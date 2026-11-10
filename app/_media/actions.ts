"use server"

import { contributionEntry } from "@/lib/config/contribution-entry"
import { managerTriageSurface } from "@/lib/config/manager-triage"
import { getAmenityActor } from "@/lib/server/amenities"
import { removeMediaAsset } from "@/lib/server/lifecycle/remove"
import { getMediaActor } from "@/lib/server/media/context"
import { UPLOADER_ROLES } from "@/lib/server/media/roles"
import type {
  AssetGroup,
  DeleteImpact,
  GroupSubjectRef,
  PhotoSetReply,
} from "@/lib/work-client/contract"
import { workServices, type WorkRead } from "@/lib/work-client/services"

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

const RETRYABLE = new Set(["unavailable", "unauthenticated"])

function setReply<T extends object>(read: WorkRead<T>): PhotoSetReply<T> {
  if (read.status === "ok") return { status: "ok", ...read.value }
  if (read.status === "missing") return { status: "missing" }
  return { status: "failed", retry: RETRYABLE.has(read.failure.code) }
}

const field = (input: unknown, key: string): unknown =>
  typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)[key]
    : undefined

/**
 * The uploader (staff, or a manager account at its venue), while groups are
 * on for their venue (contributionEntry). The database checks the venue.
 */
async function setUploader() {
  const auth = await getMediaActor(UPLOADER_ROLES)
  if (!auth.ok)
    return {
      ok: false as const,
      reply: {
        status: "failed" as const,
        // Signed out, or the account check failed: a later try may work.
        retry: auth.status === 401 || auth.status >= 500,
      },
    }
  if (contributionEntry(auth.actor.profile?.venueId) !== "b02")
    return { ok: false as const, reply: { status: "missing" as const } }
  return { ok: true as const, actor: auth.actor }
}

/** Starts the caller's set for one pick (retry-safe by its key). */
export async function startPhotoSet(
  input: unknown
): Promise<PhotoSetReply<{ groupId: string }>> {
  const auth = await setUploader()
  if (!auth.ok) return auth.reply
  return setReply(
    await workServices.startGroup(auth.actor, {
      key: field(input, "key") as string,
      subject: field(input, "subject") as GroupSubjectRef,
    })
  )
}

/** Adds the caller's own photos to their set; safe to repeat. */
export async function addToPhotoSet(
  input: unknown
): Promise<PhotoSetReply<{ members: number }>> {
  const auth = await setUploader()
  if (!auth.ok) return auth.reply
  return setReply(
    await workServices.addToGroup(auth.actor, {
      groupId: field(input, "groupId") as string,
      assetIds: field(input, "assetIds") as string[],
    })
  )
}

/**
 * The set of each photo a Review page shows (manager, staff manager or
 * admin), read as that person: only photos they may already see. Off with
 * managerTriage.
 */
export async function readPhotoSets(
  input: unknown
): Promise<PhotoSetReply<{ groups: AssetGroup[] }>> {
  if (managerTriageSurface() !== "b02") return { status: "missing" }
  const auth = await getAmenityActor()
  if (!auth.ok) return { status: "failed", retry: false }
  const read = await workServices.getAssetGroups(
    auth.actor,
    field(input, "assetIds") as string[]
  )
  return read.status === "ok"
    ? { status: "ok", groups: read.value }
    : setReply(read)
}
