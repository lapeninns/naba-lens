import { logger } from "@/lib/server/log/logger"
import "server-only"

import {
  parseRequestDetail,
  parseRequestList,
  parseStaffRequests,
  type IntendedUse,
  type Orientation,
  type Priority,
  type RequestDetail,
  type RequestList,
  type RequestSlotKind,
  type RequestType,
  type ShotListPurpose,
  type StaffRequestList,
  type Team,
} from "@/lib/requests/model"
import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"

// Requests and shot lists (spec §7 M4; FA-5; S2-REQ), on
// 20261118114000_media_requests.sql. Every call runs as the signed-in person;
// the database checks the venue, the role and the input again. Failures use
// the shared error shape (lib/server/http/errors.ts).

export type RequestCaller = { db: Db }
export type RequestResult<T> = ({ ok: true } & T) | ApiError

/** Database exception names onto the form field and the words to show. */
const FIELDS: Record<string, { field: string; message: string }> = {
  invalid_type: { field: "type", message: "Choose the kind of request." },
  brief_required: {
    field: "brief",
    message: "Write one line on what the photo must show.",
  },
  invalid_brief: {
    field: "brief",
    message: "Write the brief as one line of 140 characters or fewer.",
  },
  subject_required: { field: "subject", message: "Write what to photograph." },
  invalid_subject: {
    field: "subject",
    message: "Write the subject as one line of 120 characters or fewer.",
  },
  intended_use_required: { field: "intendedUse", message: "Choose the use." },
  invalid_intended_use: { field: "intendedUse", message: "Choose the use." },
  invalid_team: { field: "team", message: "Choose a team." },
  invalid_priority: { field: "priority", message: "Choose a priority." },
  invalid_photo_count: {
    field: "photoCount",
    message: "Ask for between 1 and 20 photos.",
  },
  invalid_orientation: {
    field: "orientation",
    message: "Choose an orientation.",
  },
  invalid_capture_window: {
    field: "captureWindow",
    message: "Write when to shoot in 80 characters or fewer.",
  },
  invalid_assignee: {
    field: "assigneeId",
    message: "That person is not on this venue's team.",
  },
  assignee_cannot_verify: {
    field: "assigneeId",
    message: "A fact is confirmed by a manager or an admin. Choose one.",
  },
  invalid_date: {
    field: "date",
    message: "Choose a date from today up to a year ahead.",
  },
  invalid_reference: {
    field: "referenceAssetId",
    message: "Use a photo of this venue that has been accepted.",
  },
  invalid_shot_list: {
    field: "shotListId",
    message: "That shot list is closed or belongs to another venue.",
  },
  invalid_slot: { field: "slotId", message: "Choose the slot again." },
  unknown_slot: {
    field: "slotId",
    message: "That slot is no longer listed. Reload the page.",
  },
  slot_not_needed: {
    field: "slotId",
    message: "That slot is marked Not here, so no photo is needed.",
  },
  slot_already_covered: {
    field: "type",
    message:
      "That slot already has a photo in the album. Ask for a replacement instead.",
  },
  slot_has_no_photo: {
    field: "type",
    message: "That slot has no photo yet. Ask for a missing photo instead.",
  },
  unknown_fact: {
    field: "factCheckId",
    message: "That fact is no longer listed. Reload the page.",
  },
  reason_required: { field: "reason", message: "Add a short reason." },
  invalid_reason: {
    field: "reason",
    message: "Write the reason in 500 characters or fewer.",
  },
  name_required: { field: "name", message: "Name the shot list." },
  invalid_name: {
    field: "name",
    message: "Write the name in 80 characters or fewer.",
  },
  invalid_purpose: { field: "purpose", message: "Choose what it is for." },
  invalid_note: {
    field: "note",
    message: "Write the note in 280 characters or fewer.",
  },
  invalid_patch: { field: "form", message: "Reload the page and try again." },
  invalid_state: { field: "form", message: "Reload the page and try again." },
}

/** A request RPC error onto the shared shape. Exported for tests. */
export function requestError(
  error: { message?: string; code?: string } | null | undefined
): ApiError {
  switch (error?.message) {
    case "request_conflict":
      return apiError("stale_version")
    case "request_closed":
      return apiError("conflict", {
        message: "This request is already closed.",
      })
    case "completes_automatically":
      return apiError("conflict", {
        message:
          "This request completes on its own when its photo is accepted or its fact is confirmed.",
        nextAction: "Cancel it with a reason instead, if it is not needed.",
      })
    case "request_exists":
      return apiError("conflict", {
        message: "An open request already asks for this.",
        nextAction: "Open the existing request and change it there.",
      })
    case "request_not_found":
    case "shot_list_not_found":
      return apiError("not_found", {
        message: "This request is no longer available.",
      })
    case "venue_inactive":
      return apiError("conflict", {
        message: "This venue is turned off, so changes are paused.",
        nextAction: "Ask an admin to check the venue.",
      })
    case "not_venue_manager":
    case "wrong_venue":
      return apiError("forbidden")
    case "venue_required":
      return apiError("invalid_input", {
        field: "venue",
        message: "Choose a venue first.",
      })
  }
  const mapped = fromDbError(error, FIELDS)
  if (mapped.code === "unavailable")
    logger.error(
      "[requests] database call failed",
      redactError(
        new Error(`${error?.code ?? "unknown"}: ${error?.message ?? ""}`)
      )
    )
  return mapped
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string =>
  typeof v === "string" && uuid.test(v)
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

// ---- reads -------------------------------------------------------------------

/** Every request and shot list at the venue, for its managers and admins. */
export async function listRequests(
  caller: RequestCaller,
  input: { venueId?: string; includeClosed?: boolean } = {}
): Promise<RequestResult<{ list: RequestList }>> {
  if (input.venueId !== undefined && !isUuid(input.venueId))
    return apiError("invalid_input", { field: "venue" })
  const { data, error } = await caller.db.rpc("media_requests", {
    ...(input.venueId ? { p_venue_id: input.venueId } : {}),
    p_include_closed: input.includeClosed ?? false,
  })
  if (error) return requestError(error)
  const list = parseRequestList(data)
  return list ? { ok: true, list } : apiError("unavailable")
}

/** One request with its history. */
export async function getRequest(
  caller: RequestCaller,
  requestId: string
): Promise<RequestResult<{ request: RequestDetail }>> {
  if (!isUuid(requestId)) return apiError("not_found")
  const { data, error } = await caller.db.rpc("media_request_detail", {
    p_request_id: requestId,
  })
  if (error) return requestError(error)
  const request = parseRequestDetail(data)
  return request ? { ok: true, request } : apiError("unavailable")
}

/** The open media requests at the caller's venue, as staff read them. */
export async function listMyRequests(
  caller: RequestCaller,
  venueId?: string
): Promise<RequestResult<{ list: StaffRequestList }>> {
  const { data, error } = await caller.db.rpc(
    "my_media_requests",
    venueId ? { p_venue_id: venueId } : {}
  )
  if (error) return requestError(error)
  const list = parseStaffRequests(data)
  return list ? { ok: true, list } : apiError("unavailable")
}

// ---- writes --------------------------------------------------------------------

export type CreateRequestInput = {
  venueId?: string | null
  type: RequestType
  slotKind?: RequestSlotKind | null
  slotId?: string | null
  factCheckId?: string | null
  subject?: string | null
  brief?: string | null
  intendedUse?: IntendedUse | null
  team?: Team | null
  photoCount?: number
  priority?: Priority
  assigneeId?: string | null
  date?: string | null
  referenceAssetId?: string | null
  orientation?: Orientation | null
  wantsVideo?: boolean
  captureWindow?: string | null
  shotListId?: string | null
}

const optionalUuid = (v: unknown) => v === undefined || v === null || isUuid(v)

export async function createManagerRequest(
  caller: RequestCaller,
  input: CreateRequestInput
): Promise<RequestResult<{ id: string; revision: number }>> {
  for (const [field, value] of Object.entries({
    venue: input.venueId,
    slotId: input.slotId,
    factCheckId: input.factCheckId,
    assigneeId: input.assigneeId,
    referenceAssetId: input.referenceAssetId,
    shotListId: input.shotListId,
  }))
    if (!optionalUuid(value)) return apiError("invalid_input", { field })
  if (input.date && !isDate(input.date))
    return apiError("invalid_input", {
      field: "date",
      message: FIELDS.invalid_date!.message,
    })
  const { data, error } = await caller.db.rpc("media_request_create", {
    p_venue_id: input.venueId ?? undefined,
    p_type: input.type,
    p_brief: input.brief ?? undefined,
    p_intended_use: input.intendedUse ?? undefined,
    p_slot_kind: input.slotKind ?? undefined,
    p_slot_id: input.slotId ?? undefined,
    p_fact_check_id: input.factCheckId ?? undefined,
    p_subject: input.subject ?? undefined,
    p_team: input.team ?? undefined,
    p_photo_count: input.photoCount ?? 1,
    p_priority: input.priority ?? "normal",
    p_assignee_id: input.assigneeId ?? undefined,
    p_due_on: input.date ?? undefined,
    p_reference_asset_id: input.referenceAssetId ?? undefined,
    p_orientation: input.orientation ?? undefined,
    p_wants_video: input.wantsVideo ?? false,
    p_capture_window: input.captureWindow ?? undefined,
    p_shot_list_id: input.shotListId ?? undefined,
  })
  if (error) return requestError(error)
  const out = data as { id?: unknown; revision?: unknown } | null
  return isUuid(out?.id) && typeof out?.revision === "number"
    ? { ok: true, id: out.id, revision: out.revision }
    : apiError("unavailable")
}

/** Fields a manager may change on an open request; null clears an optional one. */
export type RequestPatch = Partial<{
  brief: string
  intendedUse: IntendedUse
  team: Team
  photoCount: number
  priority: Priority
  assigneeId: string | null
  date: string | null
  referenceAssetId: string | null
  orientation: Orientation | null
  wantsVideo: boolean
  captureWindow: string | null
  shotListId: string | null
}>

export async function editRequest(
  caller: RequestCaller,
  input: { requestId: string; revision: number; patch: RequestPatch }
): Promise<RequestResult<{ revision: number; changed: boolean }>> {
  if (!isUuid(input.requestId)) return apiError("not_found")
  if (!Number.isInteger(input.revision)) return apiError("stale_version")
  const { data, error } = await caller.db.rpc("media_request_edit", {
    p_request_id: input.requestId,
    p_revision: input.revision,
    p_patch: input.patch,
  })
  if (error) return requestError(error)
  const out = data as { revision?: unknown; changed?: unknown } | null
  return typeof out?.revision === "number"
    ? { ok: true, revision: out.revision, changed: out.changed === true }
    : apiError("unavailable")
}

/** Blocks an open request with a reason, or unblocks it with null. */
export async function setRequestBlocked(
  caller: RequestCaller,
  input: { requestId: string; revision: number; reason: string | null }
): Promise<RequestResult<{ revision: number }>> {
  if (!isUuid(input.requestId)) return apiError("not_found")
  const { data, error } = await caller.db.rpc("media_request_set_blocked", {
    p_request_id: input.requestId,
    p_revision: input.revision,
    p_reason: input.reason ?? undefined,
  })
  if (error) return requestError(error)
  const out = data as { revision?: unknown } | null
  return typeof out?.revision === "number"
    ? { ok: true, revision: out.revision }
    : apiError("unavailable")
}

/** Cancels with a reason, or completes by hand a request with no slot. */
export async function closeRequest(
  caller: RequestCaller,
  input: {
    requestId: string
    revision: number
    state: "completed" | "cancelled"
    reason?: string | null
  }
): Promise<RequestResult<{ revision: number }>> {
  if (!isUuid(input.requestId)) return apiError("not_found")
  const { data, error } = await caller.db.rpc("media_request_close", {
    p_request_id: input.requestId,
    p_revision: input.revision,
    p_state: input.state,
    p_reason: input.reason ?? undefined,
  })
  if (error) return requestError(error)
  const out = data as { revision?: unknown } | null
  return typeof out?.revision === "number"
    ? { ok: true, revision: out.revision }
    : apiError("unavailable")
}

export async function createShotList(
  caller: RequestCaller,
  input: {
    venueId?: string | null
    name: string
    purpose: ShotListPurpose
    date?: string | null
    note?: string | null
  }
): Promise<RequestResult<{ id: string }>> {
  if (!optionalUuid(input.venueId))
    return apiError("invalid_input", { field: "venue" })
  if (input.date && !isDate(input.date))
    return apiError("invalid_input", {
      field: "date",
      message: FIELDS.invalid_date!.message,
    })
  const { data, error } = await caller.db.rpc("shot_list_create", {
    p_venue_id: input.venueId ?? undefined,
    p_name: input.name,
    p_purpose: input.purpose,
    p_due_on: input.date ?? undefined,
    p_note: input.note ?? undefined,
  })
  if (error) return requestError(error)
  const out = data as { id?: unknown } | null
  return isUuid(out?.id) ? { ok: true, id: out.id } : apiError("unavailable")
}

/** Cancels a shot list and its open requests with one reason. */
export async function cancelShotList(
  caller: RequestCaller,
  input: { shotListId: string; revision: number; reason: string }
): Promise<RequestResult<{ requestsCancelled: number }>> {
  if (!isUuid(input.shotListId)) return apiError("not_found")
  const { data, error } = await caller.db.rpc("shot_list_cancel", {
    p_shot_list_id: input.shotListId,
    p_revision: input.revision,
    p_reason: input.reason,
  })
  if (error) return requestError(error)
  const out = data as { requestsCancelled?: unknown } | null
  return typeof out?.requestsCancelled === "number"
    ? { ok: true, requestsCancelled: out.requestsCancelled }
    : apiError("unavailable")
}
