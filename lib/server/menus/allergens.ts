import "server-only"

// B04-c1 server functions (b04-design §6; task B04-03): modifiers, dietary
// claims, allergen statements, evidence and the item safety read. Each acts as
// the caller (`actor.db`); the SECURITY DEFINER RPCs re-read the profile and
// decide roles and venue scope. Managers and admins propose and decline; only
// the venue's named authority confirms or revokes, which no venue has until
// the owner decides (OD-B4-7, OD-B4-8). Expected failures are Outcome values,
// as in lib/server/menus/trading.ts. Inputs are checked here first; the
// database checks everything again.

import {
  allergenProblems,
  DIETARY_CLAIMS,
  EVIDENCE_KINDS,
  MODIFIER_SELECTIONS,
  SAFETY_DECISIONS,
  SAFETY_LIMITS,
  type AllergenMap,
  type AllergenOutcome,
  type DietaryClaim,
  type EvidenceKind,
  type ItemModifiers,
  type ItemSafety,
  type ModifierSelection,
  type SafetyDecision,
} from "@/lib/menus/trading/safety"
import {
  TRADING_CHANNELS,
  type TradingChannel,
} from "@/lib/menus/trading/types"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

import { menuRpcFailure, type MenuFailure } from "./errors"
import { isUuid } from "./validate"

type DbError = {
  message?: string
  code?: string
  details?: string | null
} | null

/** The B04-c1 RPCs are not in the generated types until the next regeneration. */
type SafetyRpc = {
  rpc(
    fn:
      | "menu_modifier_group_add"
      | "menu_modifier_option_add"
      | "menu_item_modifier_group_attach"
      | "menu_modifier_retire"
      | "menu_modifier_option_line"
      | "menu_item_modifiers"
      | "menu_dietary_claim_propose"
      | "menu_dietary_claim_decide"
      | "menu_allergen_statement_propose"
      | "menu_allergen_evidence_attach"
      | "menu_allergen_statement_decide"
      | "menu_item_safety",
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: DbError }>
}

const call = (actor: MediaActor) => actor.db as unknown as SafetyRpc

const fail = (status: MenuFailure["status"], message: string): MenuFailure => ({
  ok: false,
  status,
  message,
})

const RETRY_KEY = "This request is invalid. Reload the page and try again."

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown
): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value)

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

const ITEM_NOT_FOUND = "This dish could not be found."

const CODES: Record<string, [MenuFailure["status"], string]> = {
  not_active_user: [403, "Your account is not active."],
  not_venue_manager: [403, "Only the venue's manager or an admin can do this."],
  menu_item_not_found: [404, ITEM_NOT_FOUND],
  venue_not_found: [404, "This venue could not be found."],
  menu_item_not_on_active_menu: [409, "This dish is not on the active menu."],
  invalid_modifier: [
    400,
    "Check the name and how many choices can be made (one, or a range).",
  ],
  invalid_channel: [400, "Choose all, dine-in or takeaway."],
  invalid_effective_dates: [
    400,
    "Choose dates from today on, with the end on or after the start.",
  ],
  menu_modifier_not_found: [404, "This choice could not be found."],
  menu_modifier_retired: [409, "This choice is no longer offered."],
  menu_modifier_already_attached: [
    409,
    "These choices are already offered with this dish from that date.",
  ],
  menu_modifier_not_offered: [
    409,
    "Offer these choices with the dish before pricing them.",
  ],
  invalid_dietary_claim: [400, "Choose vegetarian or vegan, and yes or no."],
  invalid_allergen_statement: [
    400,
    "Choose contains or may contain for each allergen, and say whether every allergen was assessed.",
  ],
  invalid_safety_decision: [400, "Choose confirm, decline or revoke."],
  invalid_evidence_kind: [400, "Choose the kind of evidence."],
  menu_allergen_statement_not_found: [
    404,
    "This allergen statement could not be found.",
  ],
  menu_dietary_claim_not_found: [404, "This dietary claim could not be found."],
  menu_safety_not_proposed: [409, "This has already been decided."],
  menu_safety_not_confirmed: [
    409,
    "Only a confirmed statement can be revoked.",
  ],
  menu_safety_stale_recipe: [
    409,
    "The recipe has changed since this was written. Write a new statement for the current recipe.",
  ],
  allergen_authority_missing: [
    403,
    "No one has been named to confirm allergen information for this venue yet.",
  ],
  not_allergen_authority: [
    403,
    "Only the person named for allergen information at this venue can confirm or revoke it.",
  ],
  dietary_authority_missing: [
    403,
    "No one has been named to confirm dietary information for this venue yet.",
  ],
  not_dietary_authority: [
    403,
    "Only the person named for dietary information at this venue can confirm or revoke it.",
  ],
  allergen_evidence_missing: [
    409,
    "Add evidence (a recipe or supplier specification, or your own statement) before confirming.",
  ],
  photo_not_allergen_evidence: [
    400,
    "A photo cannot show allergens. Add a specification document or your own statement.",
  ],
  document_not_found: [404, "This document could not be found."],
}

/**
 * Maps by error message (= code), then falls back to the catalogue mapping
 * (menuRpcFailure: 40001, idempotency and unknown failures).
 */
export function safetyRpcFailure(error: DbError, context: string): MenuFailure {
  const message = error?.message ?? ""
  if (message in CODES) {
    const [status, text] = CODES[message]!
    return fail(status, text)
  }
  return menuRpcFailure(error, `safety ${context}`)
}

function cleanText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return null
  return [...text].length <= max ? text : undefined
}

const uuidOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : isUuid(v) ? v : undefined

const dateOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined
    ? null
    : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? v
      : undefined

type Result = Record<string, unknown> & { replayed: boolean }

async function run(
  actor: MediaActor,
  fn: Parameters<SafetyRpc["rpc"]>[0],
  args: Record<string, unknown>,
  context: string,
  idKey: string
): Promise<Outcome<{ result: Result }>> {
  const { data, error } = await call(actor).rpc(fn, args)
  if (error) return safetyRpcFailure(error, context)
  if (!isObject(data) || !isUuid(data[idKey]))
    return safetyRpcFailure(null, `${context} (no result)`)
  return {
    ok: true,
    result: { ...data, replayed: data.replayed === true } as Result,
  }
}

// ---------------------------------------------------------------------------
// Modifiers (B04-03a)
// ---------------------------------------------------------------------------

export async function addModifierGroup(
  actor: MediaActor,
  input: {
    venueId: string
    name: string
    selection: ModifierSelection
    minSelect?: number
    maxSelect?: number | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.venueId)) return fail(404, CODES.venue_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const name = cleanText(input.name, SAFETY_LIMITS.modifierNameMax)
  const min = input.minSelect ?? 0
  const max = input.maxSelect ?? null
  if (
    !name ||
    !oneOf(MODIFIER_SELECTIONS, input.selection) ||
    !Number.isInteger(min) ||
    min < 0 ||
    (max !== null && (!Number.isInteger(max) || max < 1 || max < min)) ||
    (input.selection === "single" && ((max ?? 1) !== 1 || min > 1))
  )
    return fail(400, CODES.invalid_modifier![1])
  return run(
    actor,
    "menu_modifier_group_add",
    {
      p_venue: input.venueId,
      p_name: name,
      p_selection: input.selection,
      p_min: min,
      p_max: max,
      p_request_key: input.requestKey,
    },
    "group add",
    "groupId"
  )
}

export async function addModifierOption(
  actor: MediaActor,
  input: {
    groupId: string
    name: string
    position?: number
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.groupId))
    return fail(404, CODES.menu_modifier_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const name = cleanText(input.name, SAFETY_LIMITS.modifierNameMax)
  const position = input.position ?? 0
  if (!name || !Number.isInteger(position) || position < 0)
    return fail(400, CODES.invalid_modifier![1])
  return run(
    actor,
    "menu_modifier_option_add",
    {
      p_group: input.groupId,
      p_name: name,
      p_position: position,
      p_request_key: input.requestKey,
    },
    "option add",
    "optionId"
  )
}

export async function attachModifierGroup(
  actor: MediaActor,
  input: {
    itemId: string
    groupId: string
    effectiveFrom?: string | null
    effectiveTo?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.itemId)) return fail(404, ITEM_NOT_FOUND)
  if (!isUuid(input.groupId))
    return fail(404, CODES.menu_modifier_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const from = dateOrNull(input.effectiveFrom)
  const to = dateOrNull(input.effectiveTo)
  if (from === undefined || to === undefined || (from && to && to < from))
    return fail(400, CODES.invalid_effective_dates![1])
  return run(
    actor,
    "menu_item_modifier_group_attach",
    {
      p_item: input.itemId,
      p_group: input.groupId,
      p_effective_from: from,
      p_effective_to: to,
      p_request_key: input.requestKey,
    },
    "attach",
    "attachmentId"
  )
}

export async function retireModifier(
  actor: MediaActor,
  input: ({ groupId: string } | { optionId: string }) & { requestKey: string }
): Promise<Outcome<{ retired: true }>> {
  const group = "groupId" in input ? input.groupId : null
  const option = "optionId" in input ? input.optionId : null
  if ((group === null) === (option === null) || !isUuid(group ?? option))
    return fail(404, CODES.menu_modifier_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const { error } = await call(actor).rpc("menu_modifier_retire", {
    p_group: group,
    p_option: option,
    p_request_key: input.requestKey,
  })
  if (error) return safetyRpcFailure(error, "retire")
  return { ok: true, retired: true }
}

/** The option's price-delta line for the dish; price it as any trading line. */
export async function modifierOptionLine(
  actor: MediaActor,
  input: {
    itemId: string
    optionId: string
    channel?: TradingChannel
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.itemId)) return fail(404, ITEM_NOT_FOUND)
  if (!isUuid(input.optionId))
    return fail(404, CODES.menu_modifier_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const channel = input.channel ?? "all"
  if (!oneOf(TRADING_CHANNELS, channel))
    return fail(400, CODES.invalid_channel![1])
  return run(
    actor,
    "menu_modifier_option_line",
    {
      p_item: input.itemId,
      p_option: input.optionId,
      p_channel: channel,
      p_request_key: input.requestKey,
    },
    "option line",
    "lineId"
  )
}

export async function itemModifiers(
  actor: MediaActor,
  itemId: string
): Promise<Outcome<{ modifiers: ItemModifiers }>> {
  if (!isUuid(itemId)) return fail(404, ITEM_NOT_FOUND)
  const { data, error } = await call(actor).rpc("menu_item_modifiers", {
    p_item: itemId,
  })
  if (error) return safetyRpcFailure(error, "modifiers")
  if (!isObject(data) || !Array.isArray(data.groups))
    return safetyRpcFailure(null, "modifiers (no groups)")
  return { ok: true, modifiers: data as unknown as ItemModifiers }
}

// ---------------------------------------------------------------------------
// Dietary claims (B04-03b)
// ---------------------------------------------------------------------------

export async function proposeDietaryClaim(
  actor: MediaActor,
  input: {
    itemId: string
    variantId?: string | null
    claim: DietaryClaim
    value: "yes" | "no"
    reason?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.itemId)) return fail(404, ITEM_NOT_FOUND)
  const variant = uuidOrNull(input.variantId)
  if (variant === undefined) return fail(404, ITEM_NOT_FOUND)
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const reason = cleanText(input.reason, SAFETY_LIMITS.reasonMax)
  if (
    !oneOf(DIETARY_CLAIMS, input.claim) ||
    (input.value !== "yes" && input.value !== "no") ||
    reason === undefined
  )
    return fail(400, CODES.invalid_dietary_claim![1])
  return run(
    actor,
    "menu_dietary_claim_propose",
    {
      p_item: input.itemId,
      p_variant: variant,
      p_claim: input.claim,
      p_value: input.value,
      p_reason: reason,
      p_request_key: input.requestKey,
    },
    "dietary propose",
    "claimId"
  )
}

export async function decideDietaryClaim(
  actor: MediaActor,
  input: {
    claimId: string
    decision: SafetyDecision
    reason?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.claimId))
    return fail(404, CODES.menu_dietary_claim_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const reason = cleanText(input.reason, SAFETY_LIMITS.reasonMax)
  if (!oneOf(SAFETY_DECISIONS, input.decision) || reason === undefined)
    return fail(400, CODES.invalid_safety_decision![1])
  return run(
    actor,
    "menu_dietary_claim_decide",
    {
      p_claim: input.claimId,
      p_decision: input.decision,
      p_reason: reason,
      p_request_key: input.requestKey,
    },
    "dietary decide",
    "decisionId"
  )
}

// ---------------------------------------------------------------------------
// Allergen statements and evidence (B04-03c)
// ---------------------------------------------------------------------------

export async function proposeAllergenStatement(
  actor: MediaActor,
  input: {
    itemId: string
    variantId?: string | null
    allergens: AllergenMap
    complete: boolean
    reason?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.itemId)) return fail(404, ITEM_NOT_FOUND)
  const variant = uuidOrNull(input.variantId)
  if (variant === undefined) return fail(404, ITEM_NOT_FOUND)
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const reason = cleanText(input.reason, SAFETY_LIMITS.reasonMax)
  if (
    allergenProblems(input.allergens).length > 0 ||
    typeof input.complete !== "boolean" ||
    reason === undefined
  )
    return fail(400, CODES.invalid_allergen_statement![1])
  return run(
    actor,
    "menu_allergen_statement_propose",
    {
      p_item: input.itemId,
      p_variant: variant,
      p_allergens: input.allergens,
      p_complete: input.complete,
      p_reason: reason,
      p_request_key: input.requestKey,
    },
    "allergen propose",
    "statementId"
  )
}

/** c1: authority statements only; documents attach once c2 lands. */
export async function attachAllergenEvidence(
  actor: MediaActor,
  input: {
    statementId: string
    kind: EvidenceKind
    documentId?: string | null
    note?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result }>> {
  if (!isUuid(input?.statementId))
    return fail(404, CODES.menu_allergen_statement_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const document = uuidOrNull(input.documentId)
  const note = cleanText(input.note, SAFETY_LIMITS.noteMax)
  if (!oneOf(EVIDENCE_KINDS, input.kind) || note === undefined)
    return fail(400, CODES.invalid_evidence_kind![1])
  if (document === undefined) return fail(404, CODES.document_not_found![1])
  return run(
    actor,
    "menu_allergen_evidence_attach",
    {
      p_statement: input.statementId,
      p_kind: input.kind,
      p_document: document,
      p_note: note,
      p_request_key: input.requestKey,
    },
    "evidence",
    "evidenceId"
  )
}

export async function decideAllergenStatement(
  actor: MediaActor,
  input: {
    statementId: string
    decision: SafetyDecision
    reason?: string | null
    requestKey: string
  }
): Promise<Outcome<{ result: Result & { allergens?: AllergenOutcome } }>> {
  if (!isUuid(input?.statementId))
    return fail(404, CODES.menu_allergen_statement_not_found![1])
  if (!isUuid(input.requestKey)) return fail(400, RETRY_KEY)
  const reason = cleanText(input.reason, SAFETY_LIMITS.reasonMax)
  if (!oneOf(SAFETY_DECISIONS, input.decision) || reason === undefined)
    return fail(400, CODES.invalid_safety_decision![1])
  return run(
    actor,
    "menu_allergen_statement_decide",
    {
      p_statement: input.statementId,
      p_decision: input.decision,
      p_reason: reason,
      p_request_key: input.requestKey,
    },
    "allergen decide",
    "decisionId"
  )
}

/** The dish's allergen outcome and dietary claims, as the caller may read them. */
export async function itemSafety(
  actor: MediaActor,
  itemId: string
): Promise<Outcome<{ safety: ItemSafety }>> {
  if (!isUuid(itemId)) return fail(404, ITEM_NOT_FOUND)
  const { data, error } = await call(actor).rpc("menu_item_safety", {
    p_item: itemId,
  })
  if (error) return safetyRpcFailure(error, "item safety")
  if (
    !isObject(data) ||
    !isObject(data.allergens) ||
    !Array.isArray(data.dietary)
  )
    return safetyRpcFailure(null, "item safety (no outcome)")
  return { ok: true, safety: data as unknown as ItemSafety }
}
