import "server-only"

import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import type { MediaActor } from "@/lib/server/media/types"

/*
 * "I'm not sure" (FA-4, spec §5.3; 20261118112000_label_help.sql). A person
 * adding photos sends one to the venue's managers as Needs label; the
 * managers' list also holds photos left unmatched for 7 days. Every call runs
 * as the caller, so the database decides who may ask and who may read.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LabelHelpRequest = {
  assetId: string
  venueId: string
  requestedAt: string
  /** False when the photo had been sent as Needs label already. */
  created: boolean
}

export type LabelHelpItem = {
  assetId: string
  /** "not_sure": the person asked; "unmatched": left in Match later 7 days. */
  /** The one unlabelled rule's reason (S3-R1 K1). */
  reason: "not_sure" | "no_dish" | "unmatched"
  note: string | null
  uploaderId: string
  uploaderName: string
  mediaType: "image" | "video"
  createdAt: string
  capturedAt: string | null
  requestedAt: string | null
  hasThumbnail: boolean
}

export type LabelHelpQueue = {
  venueId: string
  unmatchedDays: number
  total: number
  notSure: number
  items: LabelHelpItem[]
}

const REFUSALS: Record<string, { field: string; message: string }> = {
  label_help_not_allowed: {
    field: "assetId",
    message: "Only a photo added for the album can go to your manager.",
  },
}

/** Sends one of the caller's own photos to their managers as Needs label. */
export async function requestLabelHelp(
  actor: MediaActor,
  assetId: unknown
): Promise<{ ok: true; request: LabelHelpRequest } | ApiError> {
  if (typeof assetId !== "string" || !UUID.test(assetId))
    return apiError("invalid_input", { field: "assetId" })
  const { data, error } = await actor.db.rpc("request_label_help", {
    p_asset_id: assetId,
  })
  if (error) {
    if (error.message === "upload_access_ended")
      return apiError("forbidden", {
        message: "You can no longer add photos at this venue.",
        nextAction: "Open the album for the venue you are at now.",
        fileId: assetId,
      })
    return { ...fromDbError(error, REFUSALS), fileId: assetId }
  }
  const request = parseRequest(data)
  if (!request) return apiError("unavailable")
  return { ok: true, request }
}

/** Which of `assetIds` (the caller's own) are waiting as Needs label. */
export async function myLabelHelp(
  actor: MediaActor,
  assetIds: readonly string[]
): Promise<{ ok: true; assetIds: Set<string> } | ApiError> {
  const ids = assetIds.filter((id) => UUID.test(id)).slice(0, 200)
  if (ids.length === 0) return { ok: true, assetIds: new Set() }
  const { data, error } = await actor.db.rpc("my_label_help", {
    p_asset_ids: ids,
  })
  if (error) return fromDbError(error)
  return {
    ok: true,
    assetIds: new Set(
      (Array.isArray(data) ? data : []).filter(
        (id): id is string => typeof id === "string"
      )
    ),
  }
}

/** The venue's Needs label list, oldest first (managers; admins name the venue). */
export async function getLabelHelpQueue(
  actor: MediaActor,
  opts: { venueId?: string | null; limit?: number } = {}
): Promise<{ ok: true; queue: LabelHelpQueue } | ApiError> {
  const { data, error } = await actor.db.rpc("label_help_queue", {
    ...(opts.venueId ? { p_venue_id: opts.venueId } : {}),
    ...(opts.limit ? { p_limit: opts.limit } : {}),
  })
  if (error) return fromDbError(error)
  const queue = parseLabelHelpQueue(data)
  if (!queue) return apiError("unavailable")
  return { ok: true, queue }
}

const str = (value: unknown) => (typeof value === "string" ? value : null)

function parseRequest(data: unknown): LabelHelpRequest | null {
  if (!data || typeof data !== "object") return null
  const row = data as Record<string, unknown>
  const assetId = str(row.assetId)
  const venueId = str(row.venueId)
  const requestedAt = str(row.requestedAt)
  if (!assetId || !venueId || !requestedAt) return null
  return { assetId, venueId, requestedAt, created: row.created === true }
}

/** The database's queue, read defensively (pure; tests/unit/label-help.test.ts). */
export function parseLabelHelpQueue(data: unknown): LabelHelpQueue | null {
  if (!data || typeof data !== "object") return null
  const row = data as Record<string, unknown>
  const venueId = str(row.venueId)
  if (!venueId || !Array.isArray(row.items)) return null
  const items = row.items.flatMap((raw): LabelHelpItem[] => {
    if (!raw || typeof raw !== "object") return []
    const item = raw as Record<string, unknown>
    const assetId = str(item.assetId)
    const uploaderId = str(item.uploaderId)
    const createdAt = str(item.createdAt)
    if (!assetId || !uploaderId || !createdAt) return []
    return [
      {
        assetId,
        reason:
          item.reason === "not_sure" || item.reason === "no_dish"
            ? item.reason
            : "unmatched",
        note: str(item.note),
        uploaderId,
        uploaderName: str(item.uploaderName) ?? "",
        mediaType: item.mediaType === "video" ? "video" : "image",
        createdAt,
        capturedAt: str(item.capturedAt),
        requestedAt: str(item.requestedAt),
        hasThumbnail: item.hasThumbnail === true,
      },
    ]
  })
  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback
  return {
    venueId,
    unmatchedDays: num(row.unmatchedDays, 7),
    total: num(row.total, items.length),
    notSure: num(
      row.notSure,
      items.filter((item) => item.reason === "not_sure").length
    ),
    items,
  }
}
