import "server-only"

// Venue-level menu operations (Full App v1, S1-MENUS; spec §3.3, §4.3, §4.4,
// §7 M5, §8 A3): the active and future menus, temporary availability, local
// display names, presentation changes, dated specials, catalogue change
// requests, retirement impact and collection scope. Every function acts as
// the caller (`actor.db`); the SECURITY DEFINER functions re-check who may
// act at which venue (manager of that venue, admin, or for a few reads and
// special suggestions, staff of the venue). Inputs are validated here first
// so a bad request never reaches the database.

import type { Db, MediaActor, Outcome } from "@/lib/server/media/types"

import { menuRpcFailure } from "./errors"
import { isUuid } from "./validate"

type Json = unknown
type Rpc = (
  fn: string,
  args?: object
) => PromiseLike<{
  data: Json
  error: { message?: string; code?: string; details?: string | null } | null
}>

// New functions are not all in the generated types' overloads; one typed
// door keeps the casts in one place.
const rpc = (db: Db) => (db.rpc as unknown as Rpc).bind(db)

const invalid = (message: string) =>
  ({ ok: false, status: 400, message }) as const
const notFound = (message: string) =>
  ({ ok: false, status: 404, message }) as const

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (v: unknown): v is string =>
  typeof v === "string" &&
  DATE.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** Trimmed text of 1..max characters, or null. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t && [...t].length <= max ? t : null
}

async function call<T>(
  actor: MediaActor,
  fn: string,
  args: object,
  read: (data: Json) => T | null | undefined
): Promise<Outcome<{ value: T }>> {
  const { data, error } = await rpc(actor.db)(fn, args)
  if (error) return menuRpcFailure(error, fn)
  const value = read(data)
  if (value == null) return menuRpcFailure(null, `${fn} (unexpected shape)`)
  return { ok: true, value }
}

const items = (data: Json): unknown[] | null =>
  isObject(data) && Array.isArray(data.items) ? data.items : null

// ---------------------------------------------------------------------------
// Active and future menus
// ---------------------------------------------------------------------------

export type VenueMenuVersionState = "active" | "scheduled" | "retired"

export type VenueMenuVersion = {
  versionId: string
  title: string
  state: VenueMenuVersionState
  scheduledFor: string | null
  activatedAt: string | null
  retiredAt: string | null
  sourceKind: "manual" | "json" | "csv"
  sourceLabel: string | null
  itemCount: number
  /** Scheduled only: items the active menu does not have yet (Upcoming). */
  upcomingCount: number | null
  /** Scheduled only: current items it will retire. */
  retiringCount: number | null
}

function toVersion(v: unknown): VenueMenuVersion | null {
  if (!isObject(v)) return null
  const id = str(v.versionId)
  const state = v.state
  if (
    !id ||
    (state !== "active" && state !== "scheduled" && state !== "retired")
  )
    return null
  const kind = v.sourceKind
  return {
    versionId: id,
    title: str(v.title) ?? "",
    state,
    scheduledFor: str(v.scheduledFor),
    activatedAt: str(v.activatedAt),
    retiredAt: str(v.retiredAt),
    sourceKind: kind === "json" || kind === "csv" ? kind : "manual",
    sourceLabel: str(v.sourceLabel),
    itemCount: num(v.itemCount) ?? 0,
    upcomingCount: num(v.upcomingCount),
    retiringCount: num(v.retiringCount),
  }
}

/**
 * The venue's active menu and scheduled drafts; with `includeArchived` also
 * retired versions (spec §4.1 archive filter, §7 M5). Activates any due
 * schedule first.
 */
export async function listVenueMenuVersions(
  actor: MediaActor,
  input: { venueId: string; includeArchived?: boolean }
): Promise<Outcome<{ versions: VenueMenuVersion[] }>> {
  if (!isUuid(input?.venueId)) return notFound("This venue could not be found.")
  const due = await rpc(actor.db)("menu_activate_due", {
    p_venue_id: input.venueId,
  })
  if (due.error) return menuRpcFailure(due.error, "menu_activate_due")
  const result = await call(
    actor,
    "menu_versions_for_venue",
    {
      p_venue_id: input.venueId,
      p_include_archived: input.includeArchived === true,
    },
    (data) => items(data)?.map(toVersion)
  )
  if (!result.ok) return result
  return {
    ok: true,
    versions: result.value.filter((v): v is VenueMenuVersion => v !== null),
  }
}

// ---------------------------------------------------------------------------
// Offering state: availability, display name, presentation
// ---------------------------------------------------------------------------

export type OfferingState = {
  itemId: string
  available: boolean
  unavailableUntil: string | null
  unavailableReason: string | null
  displayName: string | null
  presentationRevision: number
}

function toState(v: unknown): OfferingState | null {
  if (!isObject(v) || !str(v.itemId)) return null
  return {
    itemId: str(v.itemId)!,
    available: v.available !== false,
    unavailableUntil: str(v.unavailableUntil),
    unavailableReason: str(v.unavailableReason),
    displayName: str(v.displayName),
    presentationRevision: num(v.presentationRevision) ?? 1,
  }
}

/**
 * Local state of the venue's dishes that have any (others are available,
 * with their menu name, at presentation revision 1). Staff may read it.
 */
export async function getOfferingStates(
  actor: MediaActor,
  venueId?: string
): Promise<Outcome<{ states: Record<string, OfferingState> }>> {
  if (venueId !== undefined && !isUuid(venueId))
    return notFound("This venue could not be found.")
  const result = await call(
    actor,
    "menu_offering_states",
    venueId ? { p_venue_id: venueId } : {},
    (data) => items(data)?.map(toState)
  )
  if (!result.ok) return result
  const states: Record<string, OfferingState> = {}
  for (const s of result.value) if (s) states[s.itemId] = s
  return { ok: true, states }
}

export const AVAILABILITY_REASON_MAX = 300

export async function setItemAvailability(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ changed: boolean }>> {
  if (!isObject(input) || !isUuid(input.itemId))
    return notFound("This dish could not be found.")
  if (typeof input.available !== "boolean")
    return invalid("This request is invalid.")
  let until: string | null = null
  let reason: string | null = null
  if (!input.available) {
    reason = text(input.reason, AVAILABILITY_REASON_MAX)
    if (!reason)
      return invalid("Say why it is unavailable (up to 300 characters).")
    if (input.until != null && input.until !== "") {
      if (!isDate(input.until)) return invalid("Choose a valid date.")
      until = input.until
    }
  }
  return call(
    actor,
    "menu_item_availability_set",
    {
      p_item_id: input.itemId,
      p_available: input.available,
      p_until: until,
      p_reason: reason,
    },
    (data) => (isObject(data) ? { changed: data.changed === true } : null)
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

export async function setItemDisplayName(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ changed: boolean; displayName: string | null }>> {
  if (!isObject(input) || !isUuid(input.itemId))
    return notFound("This dish could not be found.")
  const raw = typeof input.name === "string" ? input.name.trim() : ""
  const name = raw ? text(raw, 120) : null
  if (raw && !name) return invalid("Give a name of up to 120 characters.")
  const reason = text(input.reason, 300)
  if (name && !reason) return invalid("Say why the local name differs.")
  return call(
    actor,
    "menu_item_display_name_set",
    { p_item_id: input.itemId, p_name: name, p_reason: reason },
    (data) =>
      isObject(data)
        ? { changed: data.changed === true, displayName: str(data.displayName) }
        : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

export async function markPresentationChanged(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ presentationRevision: number; photosToRecheck: number }>> {
  if (!isObject(input) || !isUuid(input.itemId))
    return notFound("This dish could not be found.")
  const note = text(input.note, 300)
  if (!note) return invalid("Say what changed (up to 300 characters).")
  return call(
    actor,
    "menu_item_presentation_changed",
    { p_item_id: input.itemId, p_note: note },
    (data) =>
      isObject(data) && num(data.presentationRevision) !== null
        ? {
            presentationRevision: num(data.presentationRevision)!,
            photosToRecheck: num(data.photosToRecheck) ?? 0,
          }
        : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

// ---------------------------------------------------------------------------
// Specials
// ---------------------------------------------------------------------------

export type SpecialState =
  "suggested" | "upcoming" | "running" | "review_due" | "declined" | "ended"

const SPECIAL_STATES: readonly string[] = [
  "suggested",
  "upcoming",
  "running",
  "review_due",
  "declined",
  "ended",
]

export type MenuSpecial = {
  specialId: string
  itemId: string
  name: string
  description: string | null
  kind: "food" | "drinks"
  startsOn: string
  endsOn: string
  state: SpecialState
  /** The caller suggested or created it. */
  mine: boolean
  decisionReason: string | null
  revision: number
}

function toSpecial(v: unknown): MenuSpecial | null {
  if (!isObject(v)) return null
  const id = str(v.specialId)
  const state = str(v.state)
  if (!id || !state || !SPECIAL_STATES.includes(state)) return null
  return {
    specialId: id,
    itemId: str(v.itemId) ?? "",
    name: str(v.name) ?? "",
    description: str(v.description),
    kind: v.kind === "drinks" ? "drinks" : "food",
    startsOn: str(v.startsOn) ?? "",
    endsOn: str(v.endsOn) ?? "",
    state: state as SpecialState,
    mine: v.mine === true,
    decisionReason: str(v.decisionReason),
    revision: num(v.revision) ?? 1,
  }
}

export async function listSpecials(
  actor: MediaActor,
  input: { venueId?: string; includeArchived?: boolean } = {}
): Promise<Outcome<{ today: string; specials: MenuSpecial[] }>> {
  if (input.venueId !== undefined && !isUuid(input.venueId))
    return notFound("This venue could not be found.")
  const result = await call(
    actor,
    "menu_specials_list",
    {
      ...(input.venueId ? { p_venue_id: input.venueId } : {}),
      p_include_archived: input.includeArchived === true,
    },
    (data) => {
      const list = items(data)
      return list && isObject(data)
        ? { today: str(data.today) ?? "", specials: list.map(toSpecial) }
        : null
    }
  )
  if (!result.ok) return result
  return {
    ok: true,
    today: result.value.today,
    specials: result.value.specials.filter((s): s is MenuSpecial => !!s),
  }
}

export async function createSpecial(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ specialId: string; status: "suggested" | "running" }>> {
  if (!isObject(input) || !isUuid(input.venueId))
    return notFound("This venue could not be found.")
  const name = text(input.name, 120)
  if (!name) return invalid("Give the special a name (up to 120 characters).")
  const description =
    input.description == null || input.description === ""
      ? null
      : text(input.description, 600)
  if (input.description && !description)
    return invalid("The description is too long (up to 600 characters).")
  if (input.kind !== "food" && input.kind !== "drinks")
    return invalid("Choose food or drinks.")
  if (!isDate(input.startsOn) || !isDate(input.endsOn))
    return invalid("Choose a start and an end date.")
  if (input.endsOn < input.startsOn)
    return invalid("The end date is before the start date.")
  return call(
    actor,
    "menu_special_create",
    {
      p_venue_id: input.venueId,
      p_name: name,
      p_description: description,
      p_kind: input.kind,
      p_starts_on: input.startsOn,
      p_ends_on: input.endsOn,
    },
    (data) =>
      isObject(data) &&
      str(data.specialId) &&
      (data.status === "suggested" || data.status === "running")
        ? {
            specialId: str(data.specialId)!,
            status: data.status as "suggested" | "running",
          }
        : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

function revision(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null
}

/** Approve or decline a staff suggestion (a reason is needed to decline). */
export async function decideSpecial(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ status: string }>> {
  if (!isObject(input) || !isUuid(input.specialId))
    return notFound("This special could not be found.")
  if (typeof input.approve !== "boolean" || !revision(input.revision))
    return invalid("This request is invalid.")
  const reason = input.reason == null ? null : text(input.reason, 300)
  if (!input.approve && !reason) return invalid("Say why it is declined.")
  return call(
    actor,
    "menu_special_decide",
    {
      p_special_id: input.specialId,
      p_approve: input.approve,
      p_reason: reason,
      p_revision: input.revision,
    },
    (data) =>
      isObject(data) && str(data.status) ? { status: str(data.status)! } : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

/** End a special, or extend it to a new end date. */
export async function reviewSpecial(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ status: string }>> {
  if (!isObject(input) || !isUuid(input.specialId))
    return notFound("This special could not be found.")
  if (
    (input.action !== "end" && input.action !== "extend") ||
    !revision(input.revision)
  )
    return invalid("This request is invalid.")
  if (input.action === "extend" && !isDate(input.endsOn))
    return invalid("Choose the new end date.")
  return call(
    actor,
    "menu_special_review",
    {
      p_special_id: input.specialId,
      p_action: input.action,
      p_ends_on: input.action === "extend" ? input.endsOn : null,
      p_reason: input.reason == null ? null : text(input.reason, 300),
      p_revision: input.revision,
    },
    (data) =>
      isObject(data) && str(data.status) ? { status: str(data.status)! } : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

// ---------------------------------------------------------------------------
// Change requests and retirement impact
// ---------------------------------------------------------------------------

export type ChangeRequestKind =
  "add" | "rename" | "remove" | "presentation" | "other"
export type ChangeRequestStatus =
  "open" | "approved" | "declined" | "clarification_requested" | "withdrawn"

const KINDS: readonly string[] = [
  "add",
  "rename",
  "remove",
  "presentation",
  "other",
]
const STATUSES: readonly string[] = [
  "open",
  "approved",
  "declined",
  "clarification_requested",
  "withdrawn",
]

export type MenuChangeRequest = {
  requestId: string
  venueId: string
  venueName: string
  itemId: string | null
  itemName: string | null
  kind: ChangeRequestKind
  detail: string
  status: ChangeRequestStatus
  requestedByName: string | null
  requestedAt: string
  decidedAt: string | null
  decisionReason: string | null
  revision: number
}

function toRequest(v: unknown): MenuChangeRequest | null {
  if (!isObject(v)) return null
  const id = str(v.requestId)
  const kind = str(v.kind)
  const status = str(v.status)
  if (
    !id ||
    !kind ||
    !KINDS.includes(kind) ||
    !status ||
    !STATUSES.includes(status)
  )
    return null
  return {
    requestId: id,
    venueId: str(v.venueId) ?? "",
    venueName: str(v.venueName) ?? "",
    itemId: str(v.itemId),
    itemName: str(v.itemName),
    kind: kind as ChangeRequestKind,
    detail: str(v.detail) ?? "",
    status: status as ChangeRequestStatus,
    requestedByName: str(v.requestedByName),
    requestedAt: str(v.requestedAt) ?? "",
    decidedAt: str(v.decidedAt),
    decisionReason: str(v.decisionReason),
    revision: num(v.revision) ?? 1,
  }
}

/** A manager names their venue; an admin may pass none for every venue. */
export async function listChangeRequests(
  actor: MediaActor,
  input: { venueId?: string | null; status?: ChangeRequestStatus | null } = {}
): Promise<Outcome<{ requests: MenuChangeRequest[] }>> {
  if (input.venueId != null && !isUuid(input.venueId))
    return notFound("This venue could not be found.")
  if (input.status != null && !STATUSES.includes(input.status))
    return invalid("This request is invalid.")
  const result = await call(
    actor,
    "menu_change_requests_list",
    { p_venue_id: input.venueId ?? null, p_status: input.status ?? null },
    (data) => items(data)?.map(toRequest)
  )
  if (!result.ok) return result
  return {
    ok: true,
    requests: result.value.filter((r): r is MenuChangeRequest => !!r),
  }
}

export async function createChangeRequest(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ requestId: string }>> {
  if (!isObject(input) || !isUuid(input.venueId))
    return notFound("This venue could not be found.")
  if (typeof input.kind !== "string" || !KINDS.includes(input.kind))
    return invalid("Choose what kind of change this is.")
  const itemId =
    input.itemId == null || input.itemId === "" ? null : input.itemId
  if (itemId !== null && !isUuid(itemId))
    return notFound("This dish could not be found.")
  if (itemId === null && input.kind !== "add" && input.kind !== "other")
    return invalid("Choose the dish this change is about.")
  const detail = text(input.detail, 1000)
  if (!detail) return invalid("Describe the change (up to 1000 characters).")
  return call(
    actor,
    "menu_change_request_create",
    {
      p_venue_id: input.venueId,
      p_item_id: itemId,
      p_kind: input.kind,
      p_detail: detail,
    },
    (data) =>
      isObject(data) && str(data.requestId)
        ? { requestId: str(data.requestId)! }
        : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

/** Admin only: approved | declined | clarification_requested. */
export async function decideChangeRequest(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ status: string }>> {
  if (!isObject(input) || !isUuid(input.requestId))
    return notFound("This request could not be found.")
  const decision = input.decision
  if (
    (decision !== "approved" &&
      decision !== "declined" &&
      decision !== "clarification_requested") ||
    !revision(input.revision)
  )
    return invalid("This request is invalid.")
  const reason = input.reason == null ? null : text(input.reason, 500)
  if (decision !== "approved" && !reason) return invalid("Give a reason.")
  return call(
    actor,
    "menu_change_request_decide",
    {
      p_request_id: input.requestId,
      p_decision: decision,
      p_reason: reason,
      p_revision: input.revision,
    },
    (data) =>
      isObject(data) && str(data.status) ? { status: str(data.status)! } : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

export async function withdrawChangeRequest(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ status: string }>> {
  if (!isObject(input) || !isUuid(input.requestId))
    return notFound("This request could not be found.")
  if (!revision(input.revision)) return invalid("This request is invalid.")
  return call(
    actor,
    "menu_change_request_withdraw",
    { p_request_id: input.requestId, p_revision: input.revision },
    (data) =>
      isObject(data) && str(data.status) ? { status: str(data.status)! } : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

export type RetirementImpact = {
  itemId: string
  onActiveMenu: boolean
  onScheduledMenu: boolean
  acceptedPhotos: number
  recheckPhotos: number
  hasPrimary: boolean
  labelledPhotos: number
  openRequests: number
  temporarilyUnavailable: boolean
}

export async function getRetirementImpact(
  actor: MediaActor,
  itemId: string
): Promise<Outcome<{ impact: RetirementImpact }>> {
  if (!isUuid(itemId)) return notFound("This dish could not be found.")
  const result = await call(
    actor,
    "menu_item_retirement_impact",
    { p_item_id: itemId },
    (data) =>
      isObject(data)
        ? {
            itemId,
            onActiveMenu: data.onActiveMenu === true,
            onScheduledMenu: data.onScheduledMenu === true,
            acceptedPhotos: num(data.acceptedPhotos) ?? 0,
            recheckPhotos: num(data.recheckPhotos) ?? 0,
            hasPrimary: data.hasPrimary === true,
            labelledPhotos: num(data.labelledPhotos) ?? 0,
            openRequests: num(data.openRequests) ?? 0,
            temporarilyUnavailable: data.temporarilyUnavailable === true,
          }
        : null
  )
  return result.ok ? { ok: true, impact: result.value } : result
}

// ---------------------------------------------------------------------------
// Collection scope (spec §4.4, AC29)
// ---------------------------------------------------------------------------

export type ScopeKey = "accommodation"

export type VenueScope = {
  key: ScopeKey
  applicable: boolean
  /** An admin has recorded a decision (else the default: not applicable). */
  decided: boolean
  reason: string | null
  setAt: string | null
  revision: number
}

export async function getVenueScope(
  actor: MediaActor,
  venueId?: string
): Promise<Outcome<{ scope: VenueScope[] }>> {
  if (venueId !== undefined && !isUuid(venueId))
    return notFound("This venue could not be found.")
  const result = await call(
    actor,
    "venue_scope_read",
    venueId ? { p_venue_id: venueId } : {},
    (data) =>
      items(data)?.map((v) =>
        isObject(v) && v.key === "accommodation"
          ? {
              key: "accommodation" as const,
              applicable: v.applicable === true,
              decided: v.decided === true,
              reason: str(v.reason),
              setAt: str(v.setAt),
              revision: num(v.revision) ?? 0,
            }
          : null
      )
  )
  if (!result.ok) return result
  return {
    ok: true,
    scope: result.value.filter((s): s is VenueScope => !!s),
  }
}

/** Admin only; a reason is always required (spec §4.4). */
export async function setVenueScope(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ changed: boolean }>> {
  if (!isObject(input) || !isUuid(input.venueId))
    return notFound("This venue could not be found.")
  if (input.key !== "accommodation" || typeof input.applicable !== "boolean")
    return invalid("This request is invalid.")
  const reason = text(input.reason, 500)
  if (!reason) return invalid("Give a reason for the change.")
  if (
    typeof input.revision !== "number" ||
    !Number.isInteger(input.revision) ||
    input.revision < 0
  )
    return invalid("Reload the page and try again.")
  return call(
    actor,
    "venue_scope_set",
    {
      p_venue_id: input.venueId,
      p_key: input.key,
      p_applicable: input.applicable,
      p_reason: reason,
      p_revision: input.revision,
    },
    (data) => (isObject(data) ? { changed: data.changed === true } : null)
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}

/** Archive (not applicable) or restore one amenity check, with a reason. */
export async function setAmenityApplicability(
  actor: MediaActor,
  input: unknown
): Promise<Outcome<{ revision: number }>> {
  if (!isObject(input) || !isUuid(input.checkId))
    return notFound("This check could not be found.")
  if (typeof input.applicable !== "boolean" || !revision(input.revision))
    return invalid("This request is invalid.")
  if (!isUuid(input.idempotencyKey)) return invalid("This request is invalid.")
  const reason = text(input.reason, 500)
  if (!reason) return invalid("Give a reason for the change.")
  return call(
    actor,
    "amenity_check_set_applicability",
    {
      p_check_id: input.checkId,
      p_applicable: input.applicable,
      p_reason: reason,
      p_revision: input.revision,
      p_idempotency_key: input.idempotencyKey,
    },
    (data) =>
      isObject(data) && num(data.revision) !== null
        ? { revision: num(data.revision)! }
        : null
  ).then((r) => (r.ok ? { ok: true, ...r.value } : r))
}
