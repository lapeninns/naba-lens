"use server"

import { revalidatePath } from "next/cache"

import { deleteMedia } from "@/app/_media/actions"
import { requestRemoval } from "@/app/_media/removal-actions"
import type { MatchTarget } from "@/components/nabalens/album/match/model"
import type { NotificationPreferences } from "@/lib/ops/notifications"
import { setAreaLabel } from "@/lib/server/area-photos"
import { getLabellingCatalogue, saveAssetLabels } from "@/lib/server/labels"
import { getMediaActor } from "@/lib/server/media/context"
import { OWN_MEDIA_ROLES, UPLOADER_ROLES } from "@/lib/server/media/roles"
import {
  loadInbox,
  markRead,
  savePreferences,
  type PreferencesPatch,
} from "@/lib/server/notifications"
import {
  getMyUpload,
  getMyUploads,
  reportSlotChange,
  setMyCapturedAt,
  withdrawSlotReport,
} from "@/lib/server/staff"
import type { Inbox } from "@/lib/ops/notifications"
import type { MyUploadsPage } from "@/lib/staff/my-uploads"
import {
  reasonsFor,
  type SlotReport,
  type SlotReportKind,
  type SlotReportReason,
} from "@/lib/staff/slot-reports"

/*
 * Server Functions for Me and the slot page (S2-STAFF; spec §6 S3, S4, S5).
 * Every input is `unknown` (these are public POST endpoints), every call
 * re-authorises, and the database decides. Replies are values: `{ ok: true }`
 * or `{ ok: false, error }` with words safe to show beside the control
 * (DESIGN.md §6.7, no toasts).
 */

export type MeReply<T extends object = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v)
const KINDS = new Set(["dish", "area", "amenity", "photo"])

const refused = (message: string) => ({ ok: false as const, error: message })

/** Report a change on a slot, or ask for a correction on one's own photo. */
export async function reportSlotChangeAction(input: {
  kind: unknown
  subjectId: unknown
  reason: unknown
  note: unknown
}): Promise<MeReply<{ created: boolean; report: SlotReport }>> {
  if (!KINDS.has(input.kind as string) || !isId(input.subjectId))
    return refused("Reload the page.")
  const kind = input.kind as SlotReportKind
  if (!reasonsFor(kind).some((r) => r.key === input.reason))
    return refused("Choose what has changed.")
  const note = typeof input.note === "string" ? input.note : null
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await reportSlotChange(auth.actor, {
    kind,
    subjectId: input.subjectId,
    reason: input.reason as SlotReportReason,
    note,
  })
  if (!result.ok) return refused(result.message)
  return { ok: true, created: result.created, report: result.report }
}

export async function withdrawSlotReportAction(
  reportId: unknown
): Promise<MeReply<{ report: SlotReport }>> {
  if (!isId(reportId)) return refused("Reload the page.")
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await withdrawSlotReport(auth.actor, reportId)
  return result.ok ? result : refused(result.message)
}

/** The next page of My uploads. */
export async function loadMyUploadsAction(
  cursor: unknown
): Promise<MeReply<{ page: MyUploadsPage }>> {
  const c = cursor as { before?: unknown; beforeId?: unknown } | null
  if (!c || typeof c.before !== "string" || !isId(c.beforeId))
    return refused("Reload the page.")
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await getMyUploads(auth.actor, {
    before: c.before,
    beforeId: c.beforeId,
  })
  return result.ok ? result : refused(result.message)
}

const STILL_WAITING =
  "A manager has just checked this photo, so it can't be changed now. Reload the page."

/** Re-reads one own upload: only a photo nobody has decided on yet. */
async function stillWaiting(
  actor: Parameters<typeof getMyUpload>[0],
  assetId: string
) {
  const read = await getMyUpload(actor, assetId)
  if (!read.ok) return { ok: false as const, error: read.message }
  const undecided = read.upload.slots.every(
    (s) => s.outcome === "awaiting_review"
  )
  return undecided
    ? { ok: true as const, upload: read.upload }
    : { ok: false as const, error: STILL_WAITING }
}

/**
 * Withdraw one's own unreviewed photo (FA-21; spec §6 S4). Checked again
 * here and in the database (delete_media_asset refuses an accepted photo).
 */
export async function withdrawUploadAction(assetId: unknown): Promise<MeReply> {
  if (!isId(assetId)) return refused("Reload the page.")
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const check = await stillWaiting(auth.actor, assetId)
  if (!check.ok) return check
  const result = await deleteMedia(assetId)
  if (!result.ok) return result
  revalidatePath("/staff")
  return { ok: true }
}

/**
 * Change the slot of one's own waiting photo (spec §6 S4, §23.6): re-match it
 * to another empty dish or place slot. Refused once a manager has decided on
 * it; the label save carries the photo's label revision, so a change made
 * elsewhere meanwhile is refused too (stale version).
 */
export async function changeUploadSlotAction(input: {
  assetId: unknown
  expectedRevision: unknown
  target: unknown
}): Promise<MeReply> {
  const target = input.target as MatchTarget | null
  if (
    !isId(input.assetId) ||
    typeof input.expectedRevision !== "number" ||
    !Number.isInteger(input.expectedRevision) ||
    !target ||
    (target.kind === "dish" ? !isId(target.itemId) : false) ||
    (target.kind === "area" ? !isId(target.subjectId) : false) ||
    (target.kind !== "dish" && target.kind !== "area")
  )
    return refused("Reload the page.")
  const assetId = input.assetId
  const auth = await getMediaActor(UPLOADER_ROLES)
  if (!auth.ok) return refused(auth.message)
  const check = await stillWaiting(auth.actor, assetId)
  if (!check.ok) return check
  const from = check.upload.slots[0]
  if (!from || check.upload.slots.length !== 1 || from.kind === "amenity")
    return refused(STILL_WAITING)

  const saveItems = async (items: { itemId: string; variantId: null }[]) => {
    const catalogue = await getLabellingCatalogue(
      auth.actor,
      check.upload.venueId
    )
    const versionId =
      catalogue.ok && catalogue.catalogue.status === "active"
        ? catalogue.catalogue.versionId
        : null
    const saved = await saveAssetLabels(auth.actor, {
      assetId,
      expectedRevision: input.expectedRevision as number,
      catalogueVersionId: versionId,
      contentTypes: [],
      note: null,
      items,
      missingItem: null,
    })
    return saved.ok
      ? null
      : saved.code === "conflict"
        ? "This photo was changed just now. Reload the page."
        : saved.message || "The slot couldn't be changed. Try again."
  }

  let problem: string | null = null
  if (target.kind === "dish") {
    if (from.kind === "area") {
      const cleared = await setAreaLabel(auth.actor, assetId, null)
      if (!cleared.ok) return refused(cleared.message)
    }
    problem = await saveItems([{ itemId: target.itemId, variantId: null }])
  } else {
    if (from.kind === "dish") problem = await saveItems([])
    if (!problem) {
      const set = await setAreaLabel(auth.actor, assetId, target.subjectId)
      if (!set.ok) problem = set.message
    }
  }
  if (problem) return refused(problem)
  revalidatePath("/staff")
  return { ok: true }
}

/** Correct when one's own photo was taken; null means "I don't know". */
export async function setCapturedAtAction(
  assetId: unknown,
  capturedAt: unknown
): Promise<MeReply<{ capturedAt: string | null }>> {
  if (!isId(assetId)) return refused("Reload the page.")
  if (capturedAt !== null && typeof capturedAt !== "string")
    return refused("Give a date and time.")
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await setMyCapturedAt(auth.actor, assetId, capturedAt)
  if (!result.ok) return refused(result.message)
  revalidatePath("/staff")
  return result
}

/** Ask an admin to remove one's own accepted photo (FA-21). */
export async function requestUploadRemovalAction(
  assetId: unknown,
  reason: unknown
): Promise<MeReply> {
  if (!isId(assetId)) return refused("Reload the page.")
  const text = typeof reason === "string" ? reason.trim() : ""
  if (text.length < 3 || text.length > 500)
    return refused("Say why in a few words (3 to 500 characters).")
  const result = await requestRemoval(assetId, text)
  if (!result.ok) return result
  revalidatePath("/staff")
  return { ok: true }
}

// ---- Notifications (FA-10: an inbox list and badges, never toasts) ---------

export async function loadInboxAction(
  before: unknown
): Promise<MeReply<{ inbox: Inbox }>> {
  if (before !== null && (typeof before !== "number" || before <= 0))
    return refused("Reload the page.")
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await loadInbox(auth.actor, before)
  return result.ok ? result : refused(result.message)
}

export async function markNotificationsReadAction(
  ids: unknown
): Promise<MeReply<{ changed: number }>> {
  if (
    ids !== null &&
    !(Array.isArray(ids) && ids.every((id) => Number.isSafeInteger(id)))
  )
    return refused("Reload the page.")
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await markRead(auth.actor, ids as number[] | null)
  if (!result.ok) return refused(result.message)
  revalidatePath("/staff", "layout")
  return result
}

const PREF_KEYS = ["retakes", "assignments", "uploadProblems"] as const

export async function saveNotificationPreferencesAction(
  patch: unknown
): Promise<MeReply<{ preferences: NotificationPreferences }>> {
  const p = (patch ?? {}) as Record<string, unknown>
  const clean: PreferencesPatch = {}
  for (const key of PREF_KEYS)
    if (typeof p[key] === "boolean") clean[key] = p[key] as boolean
  for (const key of ["quietStart", "quietEnd"] as const)
    if (p[key] === null || typeof p[key] === "string")
      clean[key] = p[key] as string | null
  const auth = await getMediaActor(OWN_MEDIA_ROLES)
  if (!auth.ok) return refused(auth.message)
  const result = await savePreferences(auth.actor, clean)
  return result.ok ? result : refused(result.message)
}
