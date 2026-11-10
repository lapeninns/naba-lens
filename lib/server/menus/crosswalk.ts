import "server-only"

// B04-a server functions (b04-design §4.5): menu sources, snapshots, the
// crosswalk and the field authority manifest. Each acts as the caller
// (`actor.db`); the SECURITY DEFINER RPCs re-read the profile and decide roles
// and venue scope (writes: active admin, OD-B4-2 default; manifest: admin or
// the venue's manager). Expected failures are Outcome values, as in
// lib/server/menus/index.ts. Nothing here confirms a crosswalk row on its own
// or switches a field to NabaLens.

import {
  CROSSWALK_DECISIONS,
  CROSSWALK_ROWS_PAGE,
  CROSSWALK_STATUSES,
  FIELD_AUTHORITIES,
  MENU_CHANNELS,
  MENU_FIELDS,
  MENU_SOURCE_KINDS,
  MENU_SOURCE_LIMITS,
  snapshotDocumentError,
  type CrosswalkDecision,
  type CrosswalkDecisionStatus,
  type CrosswalkRow,
  type CrosswalkRowsCursor,
  type CrosswalkStatus,
  type FieldAuthority,
  type MenuChannel,
  type MenuField,
  type MenuManifest,
  type MenuSourceKind,
  type SnapshotEntry,
} from "@/lib/menus/trading/crosswalk"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { menuRpcFailure, type MenuFailure } from "./errors"
import { isUuid } from "./validate"

type DbError = {
  message?: string
  code?: string
  details?: string | null
} | null

/** The B04-a RPCs are not in the generated types until the next regeneration. */
type CrosswalkRpc = {
  rpc(
    fn:
      | "menu_declare_source"
      | "menu_record_snapshot"
      | "menu_crosswalk_propose"
      | "menu_crosswalk_decide"
      | "menu_set_field_authority"
      | "menu_manifest"
      | "menu_crosswalk_rows",
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: DbError }>
}

const call = (actor: MediaActor) => actor.db as unknown as CrosswalkRpc

const fail = (status: MenuFailure["status"], message: string): MenuFailure => ({
  ok: false,
  status,
  message,
})

const ADMIN_ONLY = fail(403, "Only an active admin can manage menu sources.")
const RETRY_KEY = "This request is invalid. Reload the page and try again."

function isAdmin(actor: MediaActor): boolean {
  return actor.profile.role === "admin" && actor.profile.active
}

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown
): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value)

const CODES: Record<string, [MenuFailure["status"], string]> = {
  not_venue_manager: [
    403,
    "You can only see the menu manifest of a venue you manage.",
  ],
  menu_source_not_found: [404, "This menu source could not be found."],
  menu_source_snapshot_not_found: [
    404,
    "This source snapshot could not be found.",
  ],
  crosswalk_row_not_found: [404, "This crosswalk row could not be found."],
  menu_source_exists: [
    409,
    "This venue already has a source of this kind with this label.",
  ],
  menu_source_retired: [409, "This menu source is retired."],
  snapshot_revision_conflict: [
    409,
    "This source revision was already recorded with different content. Record it under a new revision.",
  ],
  snapshot_not_latest: [
    409,
    "A newer snapshot of this source exists. Propose from the newest one.",
  ],
  crosswalk_conflict: [
    409,
    "Another source entry is already confirmed to this dish, or this entry is already confirmed to another one. Reject that mapping first.",
  ],
  crosswalk_stale: [
    409,
    "This row changed elsewhere. Reload the review list and try again.",
  ],
  crosswalk_reconcile_pending: [
    409,
    "A newer snapshot of this source has not been matched yet. Run the matcher on it, then review.",
  ],
  crosswalk_not_on_source: [
    409,
    "This entry is not in the source's newest snapshot as shown. Reload the review list.",
  ],
  invalid_crosswalk_cursor: [400, "Reload the list and try again."],
  crosswalk_parent_not_confirmed: [409, "Confirm the dish before its options."],
  menu_item_not_on_active_menu: [
    409,
    "Choose a dish on the venue's active menu.",
  ],
  authority_switch_not_enabled: [
    409,
    "Fields cannot be switched to NabaLens yet. They need a reconciliation report and the owner's approval first.",
  ],
  menu_authority_conflict: [
    409,
    "This field's authority changed elsewhere. Reload and try again.",
  ],
  idempotency_key_reused: [400, RETRY_KEY],
  invalid_request_key: [400, RETRY_KEY],
  invalid_menu_source_kind: [400, "Choose a source kind."],
  invalid_menu_source_label: [
    400,
    "Give the source a label (up to 200 characters).",
  ],
  invalid_menu_source_locator: [
    400,
    "The source reference is too long (up to 500 characters).",
  ],
  invalid_snapshot_revision: [
    400,
    "Give the source revision (up to 80 characters).",
  ],
  invalid_snapshot_sha256: [400, "The snapshot hash is invalid."],
  invalid_crosswalk_status: [400, "Choose confirm, reject or no match."],
  invalid_crosswalk_channel: [
    400,
    "Choose a channel: all, dine-in or takeaway.",
  ],
  invalid_crosswalk_decision: [
    400,
    "A rejected or unmatched row names no dish.",
  ],
  crosswalk_item_required: [400, "Choose the dish this entry is."],
  crosswalk_variant_required: [400, "Choose the option this entry is."],
  crosswalk_variant_wrong_item: [400, "That option belongs to another dish."],
  invalid_menu_field: [400, "Choose a menu field."],
  invalid_field_authority: [400, "Choose an authority for this field."],
  invalid_authority_reason: [400, "Give a reason (up to 500 characters)."],
  menu_source_required: [400, "Choose the source this authority refers to."],
  menu_source_kind_mismatch: [
    400,
    "That source is not of a kind this authority can use.",
  ],
}

function detailJson(error: DbError): Record<string, unknown> | null {
  if (!error?.details) return null
  try {
    const value: unknown = JSON.parse(error.details)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Maps by error message (= code), then falls back to the catalogue mapping. */
export function crosswalkRpcFailure(
  error: DbError,
  context: string
): MenuFailure {
  const message = error?.message ?? ""
  if (message === "invalid_snapshot_document") {
    const detail = detailJson(error)
    const path = typeof detail?.path === "string" ? detail.path : ""
    const reason =
      typeof detail?.message === "string" ? detail.message : "Invalid value"
    return fail(
      400,
      `The snapshot is invalid. ${path ? `${path}: ` : ""}${reason}`
    )
  }
  if (message === "not_active_admin") return ADMIN_ONLY
  if (message in CODES) {
    const [status, text] = CODES[message]
    return fail(status, text)
  }
  return menuRpcFailure(error, `crosswalk ${context}`)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

function cleanText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return null
  return [...text].length <= max ? text : undefined
}

// ---------------------------------------------------------------------------
// Sources and snapshots
// ---------------------------------------------------------------------------

export async function declareMenuSource(
  actor: MediaActor,
  input: {
    venueId: string
    kind: MenuSourceKind
    label: string
    locator: string | null
    requestKey: string
  }
): Promise<Outcome<{ sourceId: string; replayed: boolean }>> {
  if (!isAdmin(actor)) return ADMIN_ONLY
  if (!isUuid(input?.venueId))
    return fail(404, "This venue could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!oneOf(MENU_SOURCE_KINDS, input.kind))
    return fail(400, "Choose a source kind.")
  const label = cleanText(input.label, MENU_SOURCE_LIMITS.labelMax)
  if (!label)
    return fail(400, "Give the source a label (up to 200 characters).")
  const locator = cleanText(input.locator, MENU_SOURCE_LIMITS.locatorMax)
  if (locator === undefined)
    return fail(400, "The source reference is too long (up to 500 characters).")

  const { data, error } = await call(actor).rpc("menu_declare_source", {
    p_venue: input.venueId,
    p_kind: input.kind,
    p_label: label,
    p_locator: locator,
    p_request_key: input.requestKey,
  })
  if (error) return crosswalkRpcFailure(error, "declare source")
  if (!isObject(data) || !isUuid(data.sourceId))
    return crosswalkRpcFailure(null, "declare source (no id)")
  return { ok: true, sourceId: data.sourceId, replayed: data.replayed === true }
}

/**
 * Stores a normalised snapshot. `sha256` is of the bytes read from the source;
 * `capturedAt` is the source's own time, or null when unknown (never the
 * import time, R30). Entries are checked here with the database's rules first.
 */
export async function recordMenuSnapshot(
  actor: MediaActor,
  input: {
    sourceId: string
    revision: string
    sha256: string
    capturedAt: string | null
    entries: SnapshotEntry[]
    requestKey: string
  }
): Promise<
  Outcome<{
    snapshotId: string
    entryCount: number
    unchanged: boolean
    replayed: boolean
  }>
> {
  if (!isAdmin(actor)) return ADMIN_ONLY
  if (!isUuid(input?.sourceId))
    return fail(404, "This menu source could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const revision = cleanText(input.revision, MENU_SOURCE_LIMITS.revisionMax)
  if (!revision)
    return fail(400, "Give the source revision (up to 80 characters).")
  if (typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sha256))
    return fail(400, "The snapshot hash is invalid.")
  let capturedAt: string | null = null
  if (input.capturedAt !== null) {
    const time =
      typeof input.capturedAt === "string" ? Date.parse(input.capturedAt) : NaN
    if (!Number.isFinite(time)) return fail(400, "The source time is invalid.")
    capturedAt = new Date(time).toISOString()
  }
  const issue = snapshotDocumentError(input.entries)
  if (issue)
    return fail(
      400,
      `The snapshot is invalid. ${issue.path ? `${issue.path}: ` : ""}${issue.message}`
    )

  const { data, error } = await call(actor).rpc("menu_record_snapshot", {
    p_source: input.sourceId,
    p_revision: revision,
    p_sha256: input.sha256,
    p_captured_at: capturedAt,
    p_document: input.entries,
    p_request_key: input.requestKey,
  })
  if (error) return crosswalkRpcFailure(error, "record snapshot")
  if (
    !isObject(data) ||
    !isUuid(data.snapshotId) ||
    typeof data.entryCount !== "number"
  )
    return crosswalkRpcFailure(null, "record snapshot (no id)")
  return {
    ok: true,
    snapshotId: data.snapshotId,
    entryCount: data.entryCount,
    unchanged: data.unchanged === true,
    replayed: data.replayed === true,
  }
}

// ---------------------------------------------------------------------------
// Crosswalk
// ---------------------------------------------------------------------------

export type ProposeCounts = {
  proposed: number
  ambiguous: number
  carried: number
  needsReview: number
  notOnSource: number
  skipped: number
}

const COUNT_KEYS = [
  "proposed",
  "ambiguous",
  "carried",
  "needsReview",
  "notOnSource",
  "skipped",
] as const

/** Runs the matcher on the source's newest snapshot. Proposals only. */
export async function proposeMenuCrosswalk(
  actor: MediaActor,
  input: { snapshotId: string; requestKey: string }
): Promise<
  Outcome<{ snapshotId: string; counts: ProposeCounts; replayed: boolean }>
> {
  if (!isAdmin(actor)) return ADMIN_ONLY
  if (!isUuid(input?.snapshotId))
    return fail(404, "This source snapshot could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const { data, error } = await call(actor).rpc("menu_crosswalk_propose", {
    p_snapshot: input.snapshotId,
    p_request_key: input.requestKey,
  })
  if (error) return crosswalkRpcFailure(error, "propose")
  const counts = isObject(data) && isObject(data.counts) ? data.counts : null
  if (
    !isObject(data) ||
    !isUuid(data.snapshotId) ||
    !counts ||
    !COUNT_KEYS.every((k) => Number.isInteger(counts[k]))
  )
    return crosswalkRpcFailure(null, "propose (no counts)")
  return {
    ok: true,
    snapshotId: data.snapshotId,
    counts: Object.fromEntries(
      COUNT_KEYS.map((k) => [k, counts[k]])
    ) as ProposeCounts,
    replayed: data.replayed === true,
  }
}

/**
 * A reviewer's decision on the row in force for its locator. `expectedRevision`
 * is that row's head revision from the manifest review list.
 */
export async function decideMenuCrosswalk(
  actor: MediaActor,
  input: {
    rowId: string
    expectedRevision: number
    decision: CrosswalkDecision
    reason: string | null
    requestKey: string
  }
): Promise<
  Outcome<{
    rowId: string
    status: CrosswalkDecisionStatus
    revision: number
    replayed: boolean
  }>
> {
  if (!isAdmin(actor)) return ADMIN_ONLY
  if (!isUuid(input?.rowId))
    return fail(404, "This crosswalk row could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
    return fail(400, "Reload the review list and try again.")
  const decision = input.decision
  if (!isObject(decision) || !oneOf(CROSSWALK_DECISIONS, decision.status))
    return fail(400, "Choose confirm, reject or no match.")
  const reason = cleanText(input.reason, MENU_SOURCE_LIMITS.reasonMax)
  if (reason === undefined) return fail(400, "The note is too long.")
  let item: string | null = null,
    variant: string | null = null,
    channel: MenuChannel = "all"
  if (decision.status === "confirmed") {
    if (!isUuid(decision.itemId))
      return fail(400, "Choose the dish this entry is.")
    if (decision.variantId !== null && !isUuid(decision.variantId))
      return fail(400, "Choose the option this entry is.")
    if (!oneOf(MENU_CHANNELS, decision.channel))
      return fail(400, "Choose a channel: all, dine-in or takeaway.")
    item = decision.itemId
    variant = decision.variantId
    channel = decision.channel
  }

  const { data, error } = await call(actor).rpc("menu_crosswalk_decide", {
    p_row: input.rowId,
    p_expected: input.expectedRevision,
    p_status: decision.status,
    p_item: item,
    p_variant: variant,
    p_channel: channel,
    p_reason: reason,
    p_request_key: input.requestKey,
  })
  if (error) return crosswalkRpcFailure(error, "decide")
  if (
    !isObject(data) ||
    !isUuid(data.rowId) ||
    !oneOf(CROSSWALK_DECISIONS, data.status) ||
    !Number.isInteger(data.revision)
  )
    return crosswalkRpcFailure(null, "decide (no row)")
  return {
    ok: true,
    rowId: data.rowId,
    status: data.status,
    revision: data.revision as number,
    replayed: data.replayed === true,
  }
}

// ---------------------------------------------------------------------------
// Field authority and the manifest
// ---------------------------------------------------------------------------

/**
 * Records the owner's approved authority for one field of one venue (admin).
 * A switch to `nabalens` is refused by the database for every field that is
 * not NabaLens's already.
 */
export async function setMenuFieldAuthority(
  actor: MediaActor,
  input: {
    venueId: string
    field: MenuField
    channel: MenuChannel
    authority: FieldAuthority
    sourceId: string | null
    reason: string
    requestKey: string
  }
): Promise<
  Outcome<{ authorityId: string; unchanged: boolean; replayed: boolean }>
> {
  if (!isAdmin(actor)) return ADMIN_ONLY
  if (!isUuid(input?.venueId))
    return fail(404, "This venue could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!oneOf(MENU_FIELDS, input.field)) return fail(400, "Choose a menu field.")
  if (!oneOf(MENU_CHANNELS, input.channel))
    return fail(400, "Choose a channel: all, dine-in or takeaway.")
  if (!oneOf(FIELD_AUTHORITIES, input.authority))
    return fail(400, "Choose an authority for this field.")
  if (input.sourceId !== null && !isUuid(input.sourceId))
    return fail(404, "This menu source could not be found.")
  const reason = cleanText(input.reason, MENU_SOURCE_LIMITS.authorityReasonMax)
  if (!reason) return fail(400, "Give a reason (up to 500 characters).")

  const { data, error } = await call(actor).rpc("menu_set_field_authority", {
    p_venue: input.venueId,
    p_field: input.field,
    p_channel: input.channel,
    p_authority: input.authority,
    p_source: input.sourceId,
    p_reason: reason,
    p_request_key: input.requestKey,
  })
  if (error) return crosswalkRpcFailure(error, "set field authority")
  if (!isObject(data) || !isUuid(data.authorityId))
    return crosswalkRpcFailure(null, "set field authority (no id)")
  return {
    ok: true,
    authorityId: data.authorityId,
    unchanged: data.unchanged === true,
    replayed: data.replayed === true,
  }
}

/** The B04-01d report for one venue (admin, or that venue's manager). */
export async function readMenuManifest(
  actor: MediaActor,
  venueId: string
): Promise<Outcome<{ manifest: MenuManifest }>> {
  if (!actor.profile.active) return fail(403, CODES.not_venue_manager[1])
  if (!isUuid(venueId)) return fail(404, "This venue could not be found.")
  const { data, error } = await call(actor).rpc("menu_manifest", {
    p_venue: venueId,
  })
  if (error) return crosswalkRpcFailure(error, "manifest")
  if (
    !isObject(data) ||
    data.schema !== "1.0" ||
    data.venueId !== venueId ||
    !Array.isArray(data.fields) ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.entries)
  )
    return crosswalkRpcFailure(null, "manifest (unexpected shape)")
  return { ok: true, manifest: data as unknown as MenuManifest }
}

const isCursor = (v: unknown): v is CrosswalkRowsCursor =>
  isObject(v) &&
  isUuid(v.sourceId) &&
  typeof v.locator === "string" &&
  v.locator.length > 0

/**
 * One page of a venue's crosswalk rows in force (admin). With no `statuses`
 * it continues the manifest's review list (`reviewNext` is the first
 * `after`); with `["confirmed", "carried"]` it finds the current mappings,
 * each with the row id and revision `decideMenuCrosswalk` needs to reject
 * one. `next` is null on the last page.
 */
export async function listMenuCrosswalkRows(
  actor: MediaActor,
  input: {
    venueId: string
    statuses?: CrosswalkStatus[] | null
    sourceId?: string | null
    itemId?: string | null
    after?: CrosswalkRowsCursor | null
    limit?: number | null
  }
): Promise<
  Outcome<{ rows: CrosswalkRow[]; next: CrosswalkRowsCursor | null }>
> {
  if (!isAdmin(actor)) return ADMIN_ONLY
  if (!isUuid(input?.venueId))
    return fail(404, "This venue could not be found.")
  const statuses = input.statuses ?? null
  if (
    statuses !== null &&
    (!Array.isArray(statuses) ||
      statuses.length === 0 ||
      !statuses.every((s) => oneOf(CROSSWALK_STATUSES, s)))
  )
    return fail(400, "Choose the row statuses to list.")
  const sourceId = input.sourceId ?? null
  if (sourceId !== null && !isUuid(sourceId))
    return fail(404, "This menu source could not be found.")
  const itemId = input.itemId ?? null
  if (itemId !== null && !isUuid(itemId))
    return fail(400, "Choose a dish on the venue's menu.")
  const after = input.after ?? null
  if (after !== null && !isCursor(after))
    return fail(400, CODES.invalid_crosswalk_cursor[1])
  const limit = input.limit ?? null
  if (
    limit !== null &&
    (!Number.isInteger(limit) || limit < 1 || limit > CROSSWALK_ROWS_PAGE.max)
  )
    return fail(400, `Ask for 1 to ${CROSSWALK_ROWS_PAGE.max} rows at a time.`)

  const { data, error } = await call(actor).rpc("menu_crosswalk_rows", {
    p_venue: input.venueId,
    p_statuses: statuses,
    p_source: sourceId,
    p_item: itemId,
    p_after_source: after?.sourceId ?? null,
    p_after_locator: after?.locator ?? null,
    p_limit: limit,
  })
  if (error) return crosswalkRpcFailure(error, "rows")
  if (
    !isObject(data) ||
    data.venueId !== input.venueId ||
    !Array.isArray(data.rows) ||
    !(data.next === null || isCursor(data.next))
  )
    return crosswalkRpcFailure(null, "rows (unexpected shape)")
  return {
    ok: true,
    rows: data.rows as CrosswalkRow[],
    next: data.next,
  }
}
