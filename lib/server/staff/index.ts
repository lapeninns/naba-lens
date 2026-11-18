import "server-only"

import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"
import {
  parseMyUploads,
  parseVenueManagers,
  type MonthReplacements,
  type MyUpload,
  type MyUploadsPage,
  type VenueManager,
} from "@/lib/staff/my-uploads"
import {
  parseSlotReport,
  parseSlotReports,
  type SlotReport,
  type SlotReportKind,
  type SlotReportReason,
} from "@/lib/staff/slot-reports"

// Staff Me and Album reads and commands (S2-STAFF; spec §6 S3, S4, S5).
// Every call runs as the signed-in person; the database decides
// (20261118111000_my_uploads.sql, 20261118111100_slot_change_reports.sql,
// 20261118111200_staff_account_reads.sql). Failures are values in the
// shared error shape (lib/server/http/errors.ts), never throws.

type Caller = { db: Db }
type Result<T> = ({ ok: true } & T) | ApiError

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function logged(context: string, error: { code?: string; message?: string }) {
  console.error(`[staff] ${context} failed`, {
    error: redactError(
      new Error(`${error.code ?? "unknown"}: ${error.message ?? ""}`)
    ),
  })
}

/** RPCs added in this task, called by name (the types know them). */
function rpc(caller: Caller, fn: string, args: object = {}) {
  return (
    caller.db.rpc as unknown as (
      fn: string,
      args: object
    ) => PromiseLike<{
      data: unknown
      error: { code?: string; message?: string } | null
    }>
  )(fn, args)
}

const REPORT_ERRORS = {
  subject_not_found: {
    field: "subject",
    message: "That slot or photo is no longer listed. Reload the page.",
  },
  invalid_subject: { field: "subject", message: "Reload the page." },
  invalid_reason: { field: "reason", message: "Choose what has changed." },
  note_required: { field: "note", message: "Say what has changed." },
  invalid_note: {
    field: "note",
    message: "Write 500 characters or fewer.",
  },
  report_not_found: {
    field: "report",
    message: "That report is no longer listed. Reload the page.",
  },
  report_closed: {
    field: "report",
    message: "Your manager has already dealt with this.",
  },
  invalid_decision: { field: "action", message: "Reload the page." },
  invalid_cursor: { field: "cursor", message: "Reload the page." },
} as const

function failed(context: string, error: { code?: string; message?: string }) {
  const mapped = fromDbError(error, REPORT_ERRORS)
  if (mapped.code === "unavailable") logged(context, error)
  return mapped
}

// ---- My uploads -------------------------------------------------------------

/** The caller's own uploads, newest first (spec §6 S4). */
export async function getMyUploads(
  caller: Caller,
  cursor: { before: string; beforeId: string } | null = null,
  limit = 30
): Promise<Result<{ page: MyUploadsPage }>> {
  if (cursor && (!UUID.test(cursor.beforeId) || !cursor.before))
    return apiError("invalid_input", { field: "cursor" })
  const { data, error } = await rpc(caller, "my_uploads", {
    p_limit: limit,
    ...(cursor
      ? { p_before: cursor.before, p_before_id: cursor.beforeId }
      : {}),
  })
  if (error) return failed("my uploads", error)
  const page = parseMyUploads(data)
  return page ? { ok: true, page } : apiError("unavailable")
}

/** One of the caller's own uploads as My uploads shows it, or not_found. */
export async function getMyUpload(
  caller: Caller,
  assetId: string
): Promise<Result<{ upload: MyUpload }>> {
  if (!UUID.test(assetId)) return apiError("not_found", { field: "asset" })
  const { data, error } = await rpc(caller, "my_uploads", {
    p_asset_id: assetId,
    p_limit: 1,
  })
  if (error) return failed("my upload", error)
  const upload = parseMyUploads(data)?.items[0]
  return upload
    ? { ok: true, upload }
    : apiError("not_found", {
        field: "asset",
        message: "This photo is no longer listed. Reload the page.",
      })
}

/**
 * The caller's own photos of one dish or place slot, newest first, however
 * many newer photos were sent since (V14): the slot page reads the
 * reviewer's exact retake reason from here, not from My uploads' first page.
 */
export async function getMySlotUploads(
  caller: Caller,
  slot: { kind: "dish" | "area"; slotId: string }
): Promise<Result<{ page: MyUploadsPage }>> {
  if (!UUID.test(slot.slotId)) return apiError("not_found", { field: "slot" })
  const { data, error } = await rpc(caller, "my_uploads", {
    p_limit: 60,
    p_slot_kind: slot.kind,
    p_slot_id: slot.slotId,
  })
  if (error) return failed("my slot uploads", error)
  const page = parseMyUploads(data)
  return page ? { ok: true, page } : apiError("unavailable")
}

/** Words for a refused Change slot (move_my_upload_slot), safe to show. */
export const MOVE_SLOT_WORDS = {
  decided:
    "A manager has just checked this photo, so it can't be changed now. Reload the page.",
  noSlot:
    "This photo has no slot now. Match it again from Album, under Match later.",
  conflict: "This photo was changed just now. Reload the page.",
  catalogue:
    "The menu changed just now. Reload the page and choose the dish again.",
  itemGone: "That dish is no longer on the menu. Choose another.",
  placeGone: "That place is no longer listed for this venue. Choose another.",
  wrongVenue:
    "That slot belongs to another venue. Switch to the venue the photo was sent to.",
  withdrawn:
    "A reviewer withdrew this photo's place, so it can't be given another one.",
  failed: "The slot couldn't be changed. Try again.",
} as const

const MOVE_ERRORS: Record<string, string> = {
  upload_decided: MOVE_SLOT_WORDS.decided,
  upload_no_slot: MOVE_SLOT_WORDS.noSlot,
  label_conflict: MOVE_SLOT_WORDS.conflict,
  menu_catalogue_conflict: MOVE_SLOT_WORDS.catalogue,
  menu_item_unavailable: MOVE_SLOT_WORDS.itemGone,
  area_unavailable: MOVE_SLOT_WORDS.placeGone,
  menu_item_wrong_venue: MOVE_SLOT_WORDS.wrongVenue,
  area_wrong_venue: MOVE_SLOT_WORDS.wrongVenue,
  area_photo_withdrawn: MOVE_SLOT_WORDS.withdrawn,
  area_photo_decided: MOVE_SLOT_WORDS.decided,
}

/**
 * Change slot on the caller's own waiting photo, in one transaction
 * (move_my_upload_slot, 20261118123100; V5): a refused move keeps the old
 * slot. The words for each refusal are MOVE_SLOT_WORDS.
 */
export async function moveMyUploadSlot(
  caller: Caller,
  input: {
    assetId: string
    expectedRevision: number
    catalogueVersionId: string | null
    target:
      | { kind: "dish"; itemId: string }
      | { kind: "area"; subjectId: string }
      | { kind: "shared"; sharedKind: string }
  }
): Promise<{ ok: true; changed: boolean } | { ok: false; message: string }> {
  const { target } = input
  const { data, error } = await rpc(caller, "move_my_upload_slot", {
    p_asset_id: input.assetId,
    p_expected_revision: input.expectedRevision,
    p_catalogue_version_id: input.catalogueVersionId,
    p_target_kind: target.kind,
    p_target_id:
      target.kind === "dish"
        ? target.itemId
        : target.kind === "area"
          ? target.subjectId
          : null,
    p_shared_kind: target.kind === "shared" ? target.sharedKind : null,
  })
  if (error) {
    const known = error.message ? MOVE_ERRORS[error.message] : undefined
    if (known) return { ok: false, message: known }
    const mapped = failed("move slot", error)
    return {
      ok: false,
      message:
        mapped.code === "unavailable" ? MOVE_SLOT_WORDS.failed : mapped.message,
    }
  }
  return {
    ok: true,
    changed: (data as { changed?: unknown } | null)?.changed !== false,
  }
}

/**
 * Corrects when the caller's own photo was taken (S1-UPLOAD
 * set_media_captured_at): an instant, or null for "I don't know".
 */
export async function setMyCapturedAt(
  caller: Caller,
  assetId: string,
  capturedAt: string | null
): Promise<Result<{ capturedAt: string | null }>> {
  if (!UUID.test(assetId)) return apiError("not_found", { field: "asset" })
  if (capturedAt !== null && Number.isNaN(Date.parse(capturedAt)))
    return apiError("invalid_input", {
      field: "capturedAt",
      message: "Give a date and time.",
    })
  const { error } = await caller.db.rpc("set_media_captured_at", {
    p_asset_id: assetId,
    // Null means unknown; the generator types the argument non-null.
    p_captured_at: capturedAt as string,
  })
  if (error)
    return failed("captured at", error).code === "invalid_input"
      ? apiError("invalid_input", {
          field: "capturedAt",
          message: "Choose a date that is not in the future.",
        })
      : fromDbError(error, {
          invalid_captured_at: {
            field: "capturedAt",
            message: "Choose a date between 1990 and today.",
          },
          media_asset_not_found: {
            field: "asset",
            message: "This photo is no longer listed. Reload the page.",
          },
        })
  return { ok: true, capturedAt }
}

/** Who manages the caller's current venue (spec §6 S5). */
export async function getMyVenueManagers(
  caller: Caller
): Promise<Result<{ managers: VenueManager[] }>> {
  const { data, error } = await rpc(caller, "my_venue_managers")
  if (error) return failed("venue managers", error)
  const managers = parseVenueManagers(data)
  return managers ? { ok: true, managers } : apiError("unavailable")
}

/** The caller's month in the spec's two figures (§6 S4; FA-34). */
export async function getMonthReplacements(
  caller: Caller
): Promise<Result<{ month: MonthReplacements }>> {
  const { data, error } = await rpc(caller, "my_month_replacements")
  if (error) return failed("month replacements", error)
  const r = (data ?? {}) as Record<string, unknown>
  if (typeof r.covered !== "number" || typeof r.replaced !== "number")
    return apiError("unavailable")
  return { ok: true, month: { covered: r.covered, replaced: r.replaced } }
}

// ---- Report a change / request correction ------------------------------------

export async function reportSlotChange(
  caller: Caller,
  input: {
    kind: SlotReportKind
    subjectId: string
    reason: SlotReportReason
    note: string | null
  }
): Promise<Result<{ created: boolean; report: SlotReport }>> {
  if (!UUID.test(input.subjectId))
    return apiError("not_found", { field: "subject" })
  const { data, error } = await rpc(caller, "report_slot_change", {
    p_kind: input.kind,
    p_subject_id: input.subjectId,
    p_reason: input.reason,
    p_note: input.note?.trim() || null,
  })
  if (error) return failed("report slot change", error)
  const r = (data ?? {}) as Record<string, unknown>
  const report = parseSlotReport(r.report)
  return report
    ? { ok: true, created: r.created === true, report }
    : apiError("unavailable")
}

/** The caller's own reports, newest first. */
export async function listMySlotReports(
  caller: Caller
): Promise<Result<{ reports: SlotReport[] }>> {
  const { data, error } = await rpc(caller, "my_slot_change_reports")
  if (error) return failed("my slot reports", error)
  const reports = parseSlotReports(data)
  return reports ? { ok: true, reports } : apiError("unavailable")
}

export async function withdrawSlotReport(
  caller: Caller,
  reportId: string
): Promise<Result<{ report: SlotReport }>> {
  if (!UUID.test(reportId)) return apiError("not_found", { field: "report" })
  const { data, error } = await rpc(caller, "withdraw_slot_change_report", {
    p_report_id: reportId,
  })
  if (error) return failed("withdraw slot report", error)
  const report = parseSlotReport((data as { report?: unknown } | null)?.report)
  return report ? { ok: true, report } : apiError("unavailable")
}

/**
 * For the manager's review (S2-REVIEW / S2-MGR): the venue's reports, oldest
 * first. The venue's manager, or an admin naming the venue.
 */
export async function listVenueSlotReports(
  caller: Caller,
  input: { venueId?: string | null; state?: SlotReport["state"] | null } = {}
): Promise<Result<{ reports: SlotReport[] }>> {
  const { data, error } = await rpc(caller, "slot_change_reports", {
    ...(input.venueId ? { p_venue_id: input.venueId } : {}),
    p_state: input.state === undefined ? "open" : input.state,
  })
  if (error) return failed("venue slot reports", error)
  const reports = parseSlotReports(data)
  return reports ? { ok: true, reports } : apiError("unavailable")
}

/** The manager resolves or dismisses a report, with an optional note. */
export async function decideSlotReport(
  caller: Caller,
  input: { reportId: string; action: "resolved" | "dismissed"; note?: string }
): Promise<Result<{ report: SlotReport }>> {
  if (!UUID.test(input.reportId))
    return apiError("not_found", { field: "report" })
  const { data, error } = await rpc(caller, "decide_slot_change_report", {
    p_report_id: input.reportId,
    p_action: input.action,
    p_note: input.note?.trim() || null,
  })
  if (error) return failed("decide slot report", error)
  const report = parseSlotReport((data as { report?: unknown } | null)?.report)
  return report ? { ok: true, report } : apiError("unavailable")
}
