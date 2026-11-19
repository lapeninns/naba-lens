import "server-only"

// Admin venues and the group overview (Full App v1, S2-ADMIN; spec §8 A1,
// A2). Every call runs as the signed-in caller; the SECURITY DEFINER
// functions in 20261118115000_admin_venues.sql and
// 20261118115100_admin_group_overview.sql refuse anyone but an active admin
// on a second-factor session. Inputs are checked here first so a bad request
// never reaches the database. Failures use the shared error shape
// (lib/server/http/errors.ts).

import {
  parseOverview,
  periodRange,
  type OverviewFilters,
  type OverviewRow,
} from "@/lib/admin/overview"
import {
  parseArchiveImpact,
  parseScopeImpact,
  parseTemplatePreview,
  parseVenueDetail,
  parseVenueList,
  validateVenueForm,
  VENUE_ERRORS,
  type AdminVenue,
  type AdminVenueDetail,
  type ArchiveImpact,
  type OperatingStatus,
  type ReviewerResponsibility,
  type ScopeImpact,
  type TemplatePreview,
  type VenueField,
  type VenueForm,
} from "@/lib/admin/venues"
import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"

export type AdminCaller = { db: Db }
export type AdminResult<T> = ({ ok: true } & T) | ApiError

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v)

type RpcError = { message?: string; code?: string; details?: string | null }
type Rpc = (
  fn: string,
  args?: object
) => PromiseLike<{ data: unknown; error: RpcError | null }>
const rpc = (db: Db) => (db.rpc as unknown as Rpc).bind(db)

function failed(context: string, error: RpcError | null): ApiError {
  if (
    error?.message === "venue_conflict" ||
    error?.message === "reviewer_conflict"
  )
    return apiError("stale_version")
  const known = error?.message ? VENUE_ERRORS[error.message] : undefined
  if (known)
    return apiError("invalid_input", {
      field: known.field,
      message: known.message,
    })
  if (
    error?.message === "venue_not_found" ||
    error?.message === "profile_not_found"
  )
    return apiError("not_found", { message: "This venue could not be found." })
  if (error?.message === "mfa_reset_self")
    return apiError("forbidden", {
      message: "Another admin must reset your own authenticator.",
      nextAction: "Ask another admin.",
    })
  const mapped = fromDbError(error)
  if (mapped.code === "unavailable")
    console.error(`[admin] ${context} failed`, {
      error: redactError(
        new Error(`${error?.code ?? "unknown"}: ${error?.message ?? ""}`)
      ),
    })
  return mapped
}

async function call<T>(
  caller: AdminCaller,
  fn: string,
  args: object,
  read: (data: unknown) => T | null
): Promise<AdminResult<{ value: T }>> {
  const { data, error } = await rpc(caller.db)(fn, args)
  if (error) return failed(fn, error)
  const value = read(data)
  if (value === null) return failed(`${fn} (unexpected shape)`, null)
  return { ok: true, value }
}

const invalid = (field: VenueField, message: string) =>
  apiError("invalid_input", { field, message })

/** Trimmed text of 1..max characters, else null. */
function reasonText(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t && [...t].length <= max ? t : null
}

// ---- reads -------------------------------------------------------------------

export async function listAdminVenues(
  caller: AdminCaller,
  includeArchived = false
): Promise<AdminResult<{ venues: AdminVenue[] }>> {
  const r = await call(
    caller,
    "admin_venues_list",
    { p_include_archived: includeArchived },
    parseVenueList
  )
  return r.ok ? { ok: true, venues: r.value } : r
}

export async function getAdminVenue(
  caller: AdminCaller,
  venueId: string
): Promise<AdminResult<{ venue: AdminVenueDetail }>> {
  if (!isUuid(venueId))
    return apiError("not_found", { message: "This venue could not be found." })
  const r = await call(
    caller,
    "admin_venue_detail",
    { p_venue_id: venueId },
    parseVenueDetail
  )
  return r.ok ? { ok: true, venue: r.value } : r
}

export async function getArchiveImpact(
  caller: AdminCaller,
  venueId: string
): Promise<AdminResult<{ impact: ArchiveImpact }>> {
  if (!isUuid(venueId)) return apiError("not_found")
  const r = await call(
    caller,
    "admin_venue_archive_impact",
    { p_venue_id: venueId },
    parseArchiveImpact
  )
  return r.ok ? { ok: true, impact: r.value } : r
}

export async function previewTemplate(
  caller: AdminCaller,
  venueId: string,
  sourceVenueId: string | null
): Promise<AdminResult<{ preview: TemplatePreview }>> {
  if (!isUuid(venueId)) return apiError("not_found")
  if (sourceVenueId !== null && !isUuid(sourceVenueId))
    return invalid("reason", "Choose another venue to copy from.")
  const r = await call(
    caller,
    "admin_venue_template_preview",
    { p_venue_id: venueId, p_source_venue_id: sourceVenueId },
    parseTemplatePreview
  )
  return r.ok ? { ok: true, preview: r.value } : r
}

export async function previewScopeChange(
  caller: AdminCaller,
  venueId: string,
  applicable: boolean
): Promise<AdminResult<{ impact: ScopeImpact }>> {
  if (!isUuid(venueId)) return apiError("not_found")
  const r = await call(
    caller,
    "venue_scope_impact",
    { p_venue_id: venueId, p_key: "accommodation", p_applicable: applicable },
    parseScopeImpact
  )
  return r.ok ? { ok: true, impact: r.value } : r
}

export async function loadGroupOverview(
  caller: AdminCaller,
  filters: OverviewFilters
): Promise<AdminResult<{ rows: OverviewRow[] }>> {
  const { from, to } = periodRange(filters.period)
  const r = await call(
    caller,
    "admin_group_overview",
    {
      p_venue_ids: filters.venueId ? [filters.venueId] : null,
      p_menu: filters.menu,
      p_from: from,
      p_to: to,
    },
    parseOverview
  )
  return r.ok ? { ok: true, rows: r.value } : r
}

// ---- writes ------------------------------------------------------------------

/** Create (venueId null) or edit a venue's name and location. */
export async function saveVenue(
  caller: AdminCaller,
  venueId: string | null,
  form: VenueForm,
  revision: number
): Promise<
  | AdminResult<{ venueId: string; changed: boolean; created: boolean }>
  | (ApiError & { fieldErrors: Partial<Record<VenueField, string>> })
> {
  if (venueId !== null && !isUuid(venueId)) return apiError("not_found")
  const fieldErrors = validateVenueForm(form)
  if (fieldErrors) {
    const [field, message] = Object.entries(fieldErrors)[0]!
    return {
      ...apiError("invalid_input", { field, message }),
      fieldErrors,
    }
  }
  if (venueId !== null && (!Number.isInteger(revision) || revision < 1))
    return apiError("stale_version")
  const r = await call(
    caller,
    "admin_venue_save",
    {
      p_venue_id: venueId,
      p_name: form.name.trim(),
      p_locality: form.locality.trim(),
      p_address: form.address.trim(),
      p_timezone: form.timezone.trim(),
      p_revision: venueId === null ? 0 : revision,
      p_reason: form.reason.trim() || null,
    },
    (d) =>
      d &&
      typeof d === "object" &&
      typeof (d as { id?: unknown }).id === "string"
        ? (d as { id: string; changed?: boolean; created?: boolean })
        : null
  )
  return r.ok
    ? {
        ok: true,
        venueId: r.value.id,
        changed: r.value.changed === true,
        created: r.value.created === true,
      }
    : r
}

export async function setVenueStatus(
  caller: AdminCaller,
  input: {
    venueId: unknown
    status: unknown
    reason: unknown
    revision: unknown
  }
): Promise<AdminResult<{ changed: boolean }>> {
  if (!isUuid(input.venueId)) return apiError("not_found")
  const status = input.status
  if (
    status !== "open" &&
    status !== "temporarily_closed" &&
    status !== "permanently_closed"
  )
    return invalid("reason", "Choose a status.")
  const reason = reasonText(input.reason)
  if (!reason) return invalid("reason", "Say why the status is changing.")
  if (typeof input.revision !== "number" || !Number.isInteger(input.revision))
    return apiError("stale_version")
  const r = await call(
    caller,
    "admin_venue_set_status",
    {
      p_venue_id: input.venueId,
      p_status: status satisfies OperatingStatus,
      p_reason: reason,
      p_revision: input.revision,
    },
    (d) => (d && typeof d === "object" ? (d as { changed?: boolean }) : null)
  )
  return r.ok ? { ok: true, changed: r.value.changed === true } : r
}

export async function setVenueReviewer(
  caller: AdminCaller,
  input: {
    venueId: unknown
    responsibility: unknown
    profileId: unknown
    reason: unknown
    revision: unknown
  }
): Promise<AdminResult<{ changed: boolean }>> {
  if (!isUuid(input.venueId)) return apiError("not_found")
  const responsibility = input.responsibility
  if (responsibility !== "main" && responsibility !== "backup")
    return invalid("reason", "Choose main or backup.")
  const profileId = input.profileId === "" ? null : input.profileId
  if (profileId !== null && !isUuid(profileId))
    return invalid("reason", "Choose a person from the list.")
  if (typeof input.reason === "string" && [...input.reason.trim()].length > 500)
    return invalid("reason", "At most 500 characters.")
  if (typeof input.revision !== "number" || !Number.isInteger(input.revision))
    return apiError("stale_version")
  const r = await call(
    caller,
    "admin_set_venue_reviewer",
    {
      p_venue_id: input.venueId,
      p_responsibility: responsibility satisfies ReviewerResponsibility,
      p_profile_id: profileId,
      p_reason: reasonText(input.reason),
      p_revision: input.revision,
    },
    (d) => (d && typeof d === "object" ? (d as { changed?: boolean }) : null)
  )
  return r.ok ? { ok: true, changed: r.value.changed === true } : r
}

export async function applyTemplate(
  caller: AdminCaller,
  input: { venueId: unknown; sourceVenueId: unknown; reason: unknown }
): Promise<AdminResult<{ questions: number; places: number }>> {
  if (!isUuid(input.venueId)) return apiError("not_found")
  const source = input.sourceVenueId === "" ? null : input.sourceVenueId
  if (source !== null && !isUuid(source))
    return invalid("reason", "Choose another venue to copy from.")
  const reason = reasonText(input.reason)
  if (!reason) return invalid("reason", "Say why you are copying this.")
  const r = await call(
    caller,
    "admin_venue_apply_template",
    {
      p_venue_id: input.venueId,
      p_source_venue_id: source,
      p_reason: reason,
    },
    (d) =>
      d && typeof d === "object"
        ? (d as { questions?: number; places?: number })
        : null
  )
  return r.ok
    ? {
        ok: true,
        questions: r.value.questions ?? 0,
        places: r.value.places ?? 0,
      }
    : r
}

/**
 * An admin resets another person's lost authenticator (FA-23). The database
 * checks and records it first; the factors are then removed with the Auth
 * admin API (service role), which is the only supported way to do it.
 */
export async function resetMfa(
  caller: AdminCaller,
  service: Db,
  input: { profileId: unknown; reason: unknown }
): Promise<AdminResult<{ removed: number }>> {
  if (!isUuid(input.profileId)) return apiError("not_found")
  const reason = reasonText(input.reason)
  if (!reason) return invalid("reason", "Say why the authenticator is reset.")
  const r = await call(
    caller,
    "admin_reset_mfa_authorise",
    { p_profile_id: input.profileId, p_reason: reason },
    (d) => (d && typeof d === "object" ? d : null)
  )
  if (!r.ok) return r
  const listed = await service.auth.admin.mfa.listFactors({
    userId: input.profileId,
  })
  if (listed.error) return failed("mfa list factors", { message: "auth" })
  let removed = 0
  for (const factor of listed.data?.factors ?? []) {
    const { error } = await service.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: input.profileId,
    })
    if (error) return failed("mfa delete factor", { message: "auth" })
    removed += 1
  }
  return { ok: true, removed }
}
