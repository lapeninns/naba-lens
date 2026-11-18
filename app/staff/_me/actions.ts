"use server"

import { revalidatePath } from "next/cache"

import { deleteMedia } from "@/app/_media/actions"
import { requestRemoval } from "@/app/_media/removal-actions"
import {
  SHARED_KINDS,
  type MatchTarget,
  type SharedKind,
} from "@/components/nabalens/album/match/model"
import type { NotificationPreferences } from "@/lib/ops/notifications"
import { getLabellingCatalogue } from "@/lib/server/labels"
import { getMediaActor } from "@/lib/server/media/context"
import { OWN_MEDIA_ROLES, UPLOADER_ROLES } from "@/lib/server/media/roles"
import {
  loadInbox,
  markRead,
  saveNotificationPreferences,
  type PreferencesPatch,
} from "@/lib/server/notifications"
import {
  getMyUpload,
  getMyUploads,
  moveMyUploadSlot,
  MOVE_SLOT_WORDS,
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

/** Where Change slot moves a waiting photo: a slot, or a shared photo. */
export type ChangeTarget =
  MatchTarget | { kind: "shared"; sharedKind: SharedKind }

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

const STILL_WAITING = MOVE_SLOT_WORDS.decided

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
 * to another empty dish or place slot, or make it a shared photo. One
 * database transaction (move_my_upload_slot; V5): it is refused once a
 * manager has decided on the photo or its labels changed elsewhere (the
 * label revision), and any refusal leaves the photo in its old slot.
 */
export async function changeUploadSlotAction(input: {
  assetId: unknown
  expectedRevision: unknown
  target: unknown
}): Promise<MeReply> {
  const target = input.target as ChangeTarget | null
  const valid =
    target &&
    (target.kind === "dish"
      ? isId(target.itemId)
      : target.kind === "area"
        ? isId(target.subjectId)
        : target.kind === "shared" &&
          (SHARED_KINDS as readonly string[]).includes(target.sharedKind))
  if (
    !isId(input.assetId) ||
    typeof input.expectedRevision !== "number" ||
    !Number.isInteger(input.expectedRevision) ||
    !target ||
    !valid
  )
    return refused("Reload the page.")
  const assetId = input.assetId
  const auth = await getMediaActor(UPLOADER_ROLES)
  if (!auth.ok) return refused(auth.message)
  const check = await getMyUpload(auth.actor, assetId)
  if (!check.ok) return refused(check.message)
  // V13: the slots offered are the current venue's; a photo sent to another
  // venue is moved from there.
  if (
    auth.actor.profile.venueId &&
    check.upload.venueId !== auth.actor.profile.venueId
  )
    return refused(MOVE_SLOT_WORDS.wrongVenue)

  // The dish must be on the photo's venue's active menu (the database checks
  // the version again).
  let catalogueVersionId: string | null = null
  if (target.kind === "dish") {
    const catalogue = await getLabellingCatalogue(
      auth.actor,
      check.upload.venueId
    )
    catalogueVersionId =
      catalogue.ok && catalogue.catalogue.status === "active"
        ? catalogue.catalogue.versionId
        : null
  }
  const moved = await moveMyUploadSlot(auth.actor, {
    assetId,
    expectedRevision: input.expectedRevision,
    catalogueVersionId,
    target:
      target.kind === "dish"
        ? { kind: "dish", itemId: target.itemId }
        : target.kind === "area"
          ? { kind: "area", subjectId: target.subjectId }
          : { kind: "shared", sharedKind: target.sharedKind },
  })
  if (!moved.ok) return refused(moved.message)
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
  const result = await saveNotificationPreferences(auth.actor, clean)
  return result.ok ? result : refused(result.message)
}
