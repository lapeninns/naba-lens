import "server-only"

// B04-b1 server functions (b04-design §5.6): trading proposals, decisions,
// temporary unavailability, availability schedules and the line reads. Each
// acts as the caller (`actor.db`); the SECURITY DEFINER RPCs re-read the
// profile and decide roles and venue scope (admin; the venue's manager or a
// legacy grant holder; staff of the venue for price and temporary
// unavailability reports on active items). Expected failures are Outcome
// values, as in lib/server/menus/index.ts. Inputs are checked here with the
// database's rules first; the database checks everything again.

import { safeDate } from "@/lib/server/knowledge/dates"
import { parsePrice, priceInputText } from "@/lib/menus/trading/price"
import {
  PORTION_UNITS,
  TRADING_CHANNELS,
  TRADING_DECISIONS,
  TRADING_FIELDS,
  TRADING_LIMITS,
  type AvailabilityValue,
  type FieldState,
  type TradingChannel,
  type TradingDecision,
  type TradingField,
  type TradingLinesView,
  type TradingPortion,
  type TradingValue,
} from "@/lib/menus/trading/types"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { menuRpcFailure, type MenuFailure } from "./errors"
import { isUuid } from "./validate"

type DbError = {
  message?: string
  code?: string
  details?: string | null
} | null

/** The B04-b1 RPCs are not in the generated types until the next regeneration. */
type TradingRpc = {
  rpc(
    fn:
      | "menu_trading_propose"
      | "menu_trading_decide"
      | "menu_set_temporarily_unavailable"
      | "menu_availability_schedule_add"
      | "menu_availability_exception_add"
      | "menu_trading_lines_for_item"
      | "menu_trading_history",
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: DbError }>
}

const call = (actor: MediaActor) => actor.db as unknown as TradingRpc

const fail = (status: MenuFailure["status"], message: string): MenuFailure => ({
  ok: false,
  status,
  message,
})

const RETRY_KEY = "This request is invalid. Reload the page and try again."
const PRICE_TEXT =
  'Enter the price in pounds and pence, for example 10.50. Prices such as "from 9.95" or "MP" cannot be confirmed.'

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown
): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value)

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

const CODES: Record<string, [MenuFailure["status"], string]> = {
  not_active_user: [403, "Your account is not active."],
  not_venue_member: [
    403,
    "You can only report menu prices and availability for your own venue.",
  ],
  not_venue_manager: [403, "Only the venue's manager or an admin can do this."],
  staff_field_not_allowed: [
    403,
    "Staff can report prices and temporary unavailability only.",
  ],
  source_mapping_admin_only: [
    403,
    "Only an admin can propose a price from a menu source.",
  ],
  menu_item_not_found: [404, "This menu item could not be found."],
  menu_variant_not_found: [404, "This option could not be found."],
  menu_trading_line_not_found: [404, "This menu line could not be found."],
  menu_trading_assertion_not_found: [404, "This proposal could not be found."],
  menu_schedule_not_found: [
    404,
    "This availability schedule could not be found.",
  ],
  knowledge_check_not_found: [404, "This venue service could not be found."],
  knowledge_check_not_service: [
    409,
    "A menu can follow only a venue service with times.",
  ],
  menu_source_snapshot_not_found: [
    404,
    "This source snapshot could not be found.",
  ],
  menu_item_not_on_active_menu: [
    409,
    "Choose a dish on the venue's active menu.",
  ],
  menu_variant_not_on_active_menu: [
    409,
    "Choose an option on the venue's active menu.",
  ],
  menu_trading_line_retired: [409, "This menu line is no longer sold."],
  menu_trading_not_proposed: [
    409,
    "This proposal was already decided. Reload to see it.",
  ],
  menu_trading_not_confirmed: [409, "Only a confirmed value can be withdrawn."],
  menu_trading_proposal_outdated: [
    409,
    "The confirmed value changed after this proposal was made. Propose the change again.",
  ],
  menu_schedule_linked: [
    409,
    "This schedule follows a venue service. Change the dates on the service instead.",
  ],
  menu_schedule_exception_exists: [409, "This date already has an exception."],
  idempotency_key_reused: [400, RETRY_KEY],
  invalid_request_key: [400, RETRY_KEY],
  invalid_price: [400, PRICE_TEXT],
  invalid_trading_line: [
    400,
    "Choose a menu line, or a dish with its option, portion and channel.",
  ],
  invalid_trading_field: [
    400,
    "Choose price, availability or temporary unavailability.",
  ],
  invalid_trading_channel: [400, "Choose a channel: all, dine-in or takeaway."],
  invalid_portion: [
    400,
    "Give the portion a name (up to 40 characters), with both a measure and a unit or neither.",
  ],
  invalid_trading_value: [400, "This value is not valid for the field."],
  invalid_trading_source: [400, "The source reference is invalid."],
  menu_source_locator_not_found: [
    400,
    "That entry is not in the source snapshot.",
  ],
  menu_source_price_missing: [400, "That source entry has no price."],
  menu_source_text_mismatch: [
    400,
    "The price text does not match the source entry.",
  ],
  menu_source_mapping_unverified: [
    409,
    "That source entry has no reviewed match. Review it in the crosswalk first.",
  ],
  menu_source_mapping_mismatch: [
    409,
    "That source entry is matched to another dish, option or channel.",
  ],
  menu_source_price_scope_unverified: [
    409,
    "That source entry prices the whole dish, not this option or portion. Enter the price instead.",
  ],
  invalid_effective_dates: [
    400,
    "Choose dates from today on, with the end on or after the start.",
  ],
  invalid_observed_on: [400, "Choose a date in the last 30 days."],
  invalid_stated_on: [400, "Choose today or a date in the last 30 days."],
  invalid_until: [400, "Choose a time in the future, or leave it open."],
  invalid_trading_reason: [400, "The note is too long (up to 500 characters)."],
  invalid_trading_decision: [400, "Choose confirm, decline or withdraw."],
  invalid_timezone: [400, "Choose a valid timezone."],
  invalid_value: [400, "The schedule is invalid."],
}

function detailJson(error: DbError): Record<string, unknown> | null {
  if (!error?.details) return null
  try {
    const value: unknown = JSON.parse(error.details)
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Maps by error message (= code), then falls back to the catalogue mapping
 * (menuRpcFailure: 40001 and unknown failures).
 */
export function tradingRpcFailure(
  error: DbError,
  context: string
): MenuFailure {
  const message = error?.message ?? ""
  if (message === "menu_trading_conflict") {
    const revision = detailJson(error)?.revision
    return fail(
      409,
      typeof revision === "number"
        ? `This line changed elsewhere (now revision ${revision}). Reload and decide again.`
        : "This line changed elsewhere. Reload and decide again."
    )
  }
  if (message in CODES) {
    const [status, text] = CODES[message]
    return fail(status, text)
  }
  return menuRpcFailure(error, `trading ${context}`)
}

function cleanText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return null
  return [...text].length <= max ? text : undefined
}

const dateOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : (safeDate(v) ?? undefined)

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type TradingLineTarget =
  | { lineId: string }
  | {
      itemId: string
      variantId: string | null
      portion: TradingPortion | null
      channel: TradingChannel
    }

/** What a caller proposes per field (the database stores the parsed value). */
export type TradingProposalValue =
  | { field: "price"; amount: string | number; currency?: "GBP" }
  | { field: "availability"; value: AvailabilityValue }
  | {
      field: "temporary_unavailability"
      value:
        | { state: "temporarily_unavailable"; until: string | null }
        | { state: "back_in_service" }
    }

export type TradingProposeResult = {
  assertionId: string
  lineId: string
  lineRevision: number
  field: TradingField
  /** Always 'proposed': nothing on the menu changes until a decision (L4). */
  state: "proposed"
  value: TradingValue
  /** The line's confirmed value for this field now, separate from the proposal. */
  current: FieldState
  replayed: boolean
}

function portionArg(
  portion: TradingPortion | null
): Record<string, unknown> | null | undefined {
  if (portion === null) return null
  if (!isObject(portion)) return undefined
  const label = cleanText(portion.label, TRADING_LIMITS.portionLabelMax)
  if (!label) return undefined
  const out: Record<string, unknown> = { label }
  const hasQuantity =
    portion.quantity !== undefined && portion.quantity !== null
  const hasUnit = portion.unit !== undefined && portion.unit !== null
  if (hasQuantity !== hasUnit) return undefined
  if (hasQuantity) {
    if (
      typeof portion.quantity !== "number" ||
      !(portion.quantity > 0) ||
      !TRADING_LIMITS.portionQuantityPattern.test(String(portion.quantity)) ||
      !oneOf(PORTION_UNITS, portion.unit)
    )
      return undefined
    out.quantity = portion.quantity
    out.unit = portion.unit
  }
  return out
}

/**
 * A staff report, a manager's or admin's statement, or (admin) a price read
 * from a menu source. It stays proposed until a decision; the result carries
 * the line's confirmed value separately (L4). A source price is the cited
 * snapshot entry's own price text (rawText, when given, must equal it), and
 * the source's reviewed crosswalk must map that entry to this line.
 */
export async function proposeTradingValue(
  actor: MediaActor,
  input: {
    target: TradingLineTarget
    proposal: TradingProposalValue
    effectiveFrom?: string | null
    effectiveTo?: string | null
    observedOn?: string | null
    reason?: string | null
    source?: { snapshotId: string; locator: string; rawText?: string } | null
    requestKey: string
  }
): Promise<Outcome<TradingProposeResult>> {
  if (!isUuid(input?.requestKey)) return fail(400, RETRY_KEY)
  const target = input.target
  let line: Record<string, unknown>
  if (isObject(target) && "lineId" in target) {
    if (!isUuid(target.lineId))
      return fail(404, "This menu line could not be found.")
    line = {
      p_line: target.lineId,
      p_item: null,
      p_variant: null,
      p_portion: null,
      p_channel: null,
    }
  } else if (isObject(target) && isUuid(target.itemId)) {
    if (target.variantId !== null && !isUuid(target.variantId))
      return fail(404, "This option could not be found.")
    if (!oneOf(TRADING_CHANNELS, target.channel))
      return fail(400, CODES.invalid_trading_channel[1])
    const portion = portionArg(target.portion)
    if (portion === undefined) return fail(400, CODES.invalid_portion[1])
    line = {
      p_line: null,
      p_item: target.itemId,
      p_variant: target.variantId,
      p_portion: portion,
      p_channel: target.channel,
    }
  } else return fail(404, "This menu item could not be found.")

  const proposal = input.proposal
  if (!isObject(proposal) || !oneOf(TRADING_FIELDS, proposal.field))
    return fail(400, CODES.invalid_trading_field[1])
  let source: Record<string, string> | null = null
  let value: Record<string, unknown> | null = null
  if (input.source) {
    const { snapshotId, locator, rawText } = input.source
    if (
      proposal.field !== "price" ||
      !isUuid(snapshotId) ||
      typeof locator !== "string" ||
      [...locator].length < 1 ||
      [...locator].length > TRADING_LIMITS.sourceLocatorMax ||
      (rawText !== undefined &&
        (typeof rawText !== "string" ||
          [...rawText].length < 1 ||
          [...rawText].length > TRADING_LIMITS.rawTextMax))
    )
      return fail(400, CODES.invalid_trading_source[1])
    source =
      rawText === undefined
        ? { snapshotId, locator }
        : { snapshotId, locator, rawText }
  } else if (proposal.field === "price") {
    const currency = proposal.currency ?? "GBP"
    const text = priceInputText(proposal.amount)
    if (text === null || !parsePrice(text, currency).ok)
      return fail(400, PRICE_TEXT)
    // Sent as text, so the database parses the same characters (§3 Money).
    value = { amount: text, currency }
  } else {
    if (!isObject(proposal.value))
      return fail(400, CODES.invalid_trading_value[1])
    value = proposal.value as Record<string, unknown>
  }
  const effectiveFrom = dateOrNull(input.effectiveFrom)
  const effectiveTo = dateOrNull(input.effectiveTo)
  if (effectiveFrom === undefined || effectiveTo === undefined)
    return fail(400, CODES.invalid_effective_dates[1])
  const observedOn = dateOrNull(input.observedOn)
  if (observedOn === undefined) return fail(400, CODES.invalid_observed_on[1])
  const reason = cleanText(input.reason, TRADING_LIMITS.reasonMax)
  if (reason === undefined) return fail(400, CODES.invalid_trading_reason[1])

  const { data, error } = await call(actor).rpc("menu_trading_propose", {
    ...line,
    p_field: proposal.field,
    p_value: value,
    p_effective_from: effectiveFrom,
    p_effective_to: effectiveTo,
    p_observed_on: observedOn,
    p_reason: reason,
    p_source: source,
    p_request_key: input.requestKey,
  })
  if (error) return tradingRpcFailure(error, "propose")
  if (
    !isObject(data) ||
    !isUuid(data.assertionId) ||
    !isUuid(data.lineId) ||
    !Number.isInteger(data.lineRevision) ||
    data.state !== "proposed" ||
    !isObject(data.current)
  )
    return tradingRpcFailure(null, "propose (no assertion)")
  return {
    ok: true,
    assertionId: data.assertionId,
    lineId: data.lineId,
    lineRevision: data.lineRevision as number,
    field: proposal.field,
    state: "proposed",
    value: data.value as TradingValue,
    current: data.current as FieldState,
    replayed: data.replayed === true,
  }
}

/**
 * Confirm, decline or withdraw one proposal. `expectedLineRevision` is the
 * line revision the decider saw. `statedOn` (confirm only): null records
 * today as the form default; a date up to 30 days earlier is recorded as
 * chosen (A1-2).
 */
export async function decideTradingAssertion(
  actor: MediaActor,
  input: {
    assertionId: string
    expectedLineRevision: number
    decision: TradingDecision
    reason?: string | null
    statedOn?: string | null
    requestKey: string
  }
): Promise<
  Outcome<{
    decisionId: string
    assertionId: string
    lineId: string
    lineRevision: number
    decision: TradingDecision
    statedOn: string | null
    statedOnSource: "form_default" | "chosen" | null
    current: FieldState
    replayed: boolean
  }>
> {
  if (!isUuid(input?.assertionId))
    return fail(404, "This proposal could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (
    !Number.isInteger(input.expectedLineRevision) ||
    input.expectedLineRevision < 1
  )
    return fail(400, "Reload the line and try again.")
  if (!oneOf(TRADING_DECISIONS, input.decision))
    return fail(400, CODES.invalid_trading_decision[1])
  const reason = cleanText(input.reason, TRADING_LIMITS.reasonMax)
  if (reason === undefined) return fail(400, CODES.invalid_trading_reason[1])
  const statedOn = dateOrNull(input.statedOn)
  if (
    statedOn === undefined ||
    (statedOn !== null && input.decision !== "confirmed")
  )
    return fail(400, CODES.invalid_stated_on[1])

  const { data, error } = await call(actor).rpc("menu_trading_decide", {
    p_assertion: input.assertionId,
    p_expected_line_revision: input.expectedLineRevision,
    p_decision: input.decision,
    p_reason: reason,
    p_stated_on: statedOn,
    p_request_key: input.requestKey,
  })
  if (error) return tradingRpcFailure(error, "decide")
  if (
    !isObject(data) ||
    !isUuid(data.decisionId) ||
    !isUuid(data.lineId) ||
    !Number.isInteger(data.lineRevision) ||
    !isObject(data.current)
  )
    return tradingRpcFailure(null, "decide (no decision)")
  return {
    ok: true,
    decisionId: data.decisionId,
    assertionId: input.assertionId,
    lineId: data.lineId,
    lineRevision: data.lineRevision as number,
    decision: input.decision,
    statedOn: typeof data.statedOn === "string" ? data.statedOn : null,
    statedOnSource:
      data.statedOnSource === "form_default" || data.statedOnSource === "chosen"
        ? data.statedOnSource
        : null,
    current: data.current as FieldState,
    replayed: data.replayed === true,
  }
}

/** A manager's statement, current at once, on every live line of the item. */
export async function setTemporarilyUnavailable(
  actor: MediaActor,
  input: {
    itemId: string
    variantId: string | null
    until: string | null
    reason?: string | null
    requestKey: string
  }
): Promise<
  Outcome<{
    lines: {
      lineId: string
      lineRevision: number
      assertionId: string
      decisionId: string
    }[]
    replayed: boolean
  }>
> {
  if (!isUuid(input?.itemId))
    return fail(404, "This menu item could not be found.")
  if (input.variantId !== null && !isUuid(input.variantId))
    return fail(404, "This option could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  let until: string | null = null
  if (input.until !== null) {
    const time = typeof input.until === "string" ? Date.parse(input.until) : NaN
    if (!Number.isFinite(time)) return fail(400, CODES.invalid_until[1])
    until = new Date(time).toISOString()
  }
  const reason = cleanText(input.reason, TRADING_LIMITS.reasonMax)
  if (reason === undefined) return fail(400, CODES.invalid_trading_reason[1])

  const { data, error } = await call(actor).rpc(
    "menu_set_temporarily_unavailable",
    {
      p_item: input.itemId,
      p_variant: input.variantId,
      p_until: until,
      p_reason: reason,
      p_request_key: input.requestKey,
    }
  )
  if (error) return tradingRpcFailure(error, "set temporarily unavailable")
  if (!isObject(data) || !Array.isArray(data.lines))
    return tradingRpcFailure(null, "set temporarily unavailable (no lines)")
  return {
    ok: true,
    lines: data.lines as {
      lineId: string
      lineRevision: number
      assertionId: string
      decisionId: string
    }[],
    replayed: data.replayed === true,
  }
}

/**
 * An availability schedule: B03's shape ({ effectiveFrom, effectiveTo?,
 * recurrence, windows }), or a link to a same-venue B03 service check with
 * the menu's own { effectiveFrom, effectiveTo? }.
 */
export async function addAvailabilitySchedule(
  actor: MediaActor,
  input: {
    venueId: string
    schedule: Record<string, unknown>
    timezone?: string | null
    knowledgeCheckId?: string | null
    supersedes?: string | null
    requestKey: string
  }
): Promise<Outcome<{ scheduleId: string; replayed: boolean }>> {
  if (!isUuid(input?.venueId))
    return fail(404, "This venue could not be found.")
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!isObject(input.schedule)) return fail(400, CODES.invalid_value[1])
  const check = input.knowledgeCheckId ?? null
  if (check !== null && !isUuid(check))
    return fail(404, CODES.knowledge_check_not_found[1])
  const supersedes = input.supersedes ?? null
  if (supersedes !== null && !isUuid(supersedes))
    return fail(404, CODES.menu_schedule_not_found[1])
  const { data, error } = await call(actor).rpc(
    "menu_availability_schedule_add",
    {
      p_venue: input.venueId,
      p_schedule: input.schedule,
      p_timezone: input.timezone ?? null,
      p_knowledge_check_id: check,
      p_supersedes: supersedes,
      p_request_key: input.requestKey,
    }
  )
  if (error) return tradingRpcFailure(error, "add schedule")
  if (!isObject(data) || !isUuid(data.scheduleId))
    return tradingRpcFailure(null, "add schedule (no id)")
  return {
    ok: true,
    scheduleId: data.scheduleId,
    replayed: data.replayed === true,
  }
}

/** A dated exception on an own schedule. */
export async function addAvailabilityException(
  actor: MediaActor,
  input: {
    scheduleId: string
    localDate: string
    kind: "cancelled" | "changed_window" | "extra"
    windows: { start: string; end: string }[] | null
    note?: string | null
    requestKey: string
  }
): Promise<Outcome<{ exceptionId: string; replayed: boolean }>> {
  if (!isUuid(input?.scheduleId))
    return fail(404, CODES.menu_schedule_not_found[1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  if (!safeDate(input.localDate)) return fail(400, CODES.invalid_value[1])
  if (!oneOf(["cancelled", "changed_window", "extra"] as const, input.kind))
    return fail(400, CODES.invalid_value[1])
  const note = cleanText(input.note, TRADING_LIMITS.noteMax)
  if (note === undefined) return fail(400, "The note is too long.")
  const { data, error } = await call(actor).rpc(
    "menu_availability_exception_add",
    {
      p_schedule: input.scheduleId,
      p_local_date: input.localDate,
      p_kind: input.kind,
      p_windows: input.kind === "cancelled" ? null : input.windows,
      p_note: note,
      p_request_key: input.requestKey,
    }
  )
  if (error) return tradingRpcFailure(error, "add exception")
  if (!isObject(data) || !isUuid(data.exceptionId))
    return tradingRpcFailure(null, "add exception (no id)")
  return {
    ok: true,
    exceptionId: data.exceptionId,
    replayed: data.replayed === true,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** An item's lines as the caller may read them now (staff: active items). */
export async function tradingLinesForItem(
  actor: MediaActor,
  itemId: string
): Promise<Outcome<{ view: TradingLinesView }>> {
  if (!isUuid(itemId)) return fail(404, CODES.menu_item_not_found[1])
  const { data, error } = await call(actor).rpc("menu_trading_lines_for_item", {
    p_item: itemId,
  })
  if (error) return tradingRpcFailure(error, "lines for item")
  if (!isObject(data) || !Array.isArray(data.lines))
    return tradingRpcFailure(null, "lines for item (no lines)")
  return { ok: true, view: data as unknown as TradingLinesView }
}

/** A line's history and the values in force at `at` (admin and manager). */
export async function tradingHistory(
  actor: MediaActor,
  lineId: string,
  at: string | null = null
): Promise<Outcome<{ history: Record<string, unknown> }>> {
  if (!isUuid(lineId)) return fail(404, CODES.menu_trading_line_not_found[1])
  let instant: string | null = null
  if (at !== null) {
    const time = Date.parse(at)
    if (!Number.isFinite(time)) return fail(400, "Choose a valid time.")
    instant = new Date(time).toISOString()
  }
  const { data, error } = await call(actor).rpc("menu_trading_history", {
    p_line: lineId,
    p_at: instant,
  })
  if (error) return tradingRpcFailure(error, "history")
  if (!isObject(data) || !Array.isArray(data.assertions))
    return tradingRpcFailure(null, "history (no assertions)")
  return { ok: true, history: data }
}
