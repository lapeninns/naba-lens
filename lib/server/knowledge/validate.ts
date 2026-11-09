// Input checks for knowledge services. They give friendly field errors early;
// the database repeats every rule with the same limits (KNOWLEDGE_LIMITS).

import type { WifiMetadata } from "@/lib/amenities/contract"
import {
  CONTRIBUTION_KINDS,
  DECISIONS,
  KNOWLEDGE_ANSWERS,
  KNOWLEDGE_LIMITS as LIMITS,
  UNKNOWN_PRESETS,
  type ContributionKind,
  type Decision,
  type FindingRef,
  type KnowledgeAnswer,
  type KnowledgeFailure,
  type UnknownPreset,
} from "@/lib/knowledge/contract"
import { parseWifi } from "@/lib/server/amenities/validate"
import {
  intInRange,
  isObject,
  isUuid,
  optionalText,
  uuidList,
} from "@/lib/server/coverage/validate"

import { knowledgeFailure, knowledgeInvalid } from "./errors"

export { intInRange, isObject, isUuid }

type Parsed<T> = { ok: true; value: T } | KnowledgeFailure

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })

/** Slot revisions are bigint in the database; any safe integer is accepted. */
const isRevision = (v: unknown): v is number =>
  intInRange(v, 0, Number.MAX_SAFE_INTEGER)

const KEY = /^[a-z][a-z0-9_]{0,63}$/

export const NOT_FOUND = knowledgeFailure(
  "not_found",
  "This question could not be found. Reload the page."
)

const RELOAD = knowledgeInvalid(
  { slotRevision: "Reload the page and try again." },
  "This request is invalid. Reload the page."
)

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

function text(
  errors: Record<string, string>,
  field: string,
  v: unknown,
  max: number
): string | null {
  const value = optionalText(v, max)
  if (value === undefined) {
    errors[field] = `Use up to ${max} characters.`
    return null
  }
  return value
}

export function parseFindingRef(v: unknown): FindingRef | null {
  if (!isObject(v) || !isUuid(v.id)) return null
  if (v.type !== "contribution" && v.type !== "submission") return null
  return { type: v.type, id: v.id }
}

/** `{ checkId }`: an unknown id is not found, as the database would say. */
export function parseCheckId(input: unknown): Parsed<string> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  return ok(input.checkId)
}

export type ParsedKnowledgeSubmit = {
  checkId: string
  slotRevision: number
  idempotencyKey: string
  kind: ContributionKind
  answer: KnowledgeAnswer
  finding: string | null
  limitations: string | null
  reason: string | null
  unknownPreset: UnknownPreset | null
  triedText: string | null
  changeReason: string | null
  respondsTo: string | null
  assetIds: string[]
  wifi: WifiMetadata | null
  redactionConfirmed: boolean | null
  confirmOwn: boolean
}

/**
 * Shape and limits only. Evidence, Wi-Fi notes, the redaction tick, scope,
 * confirmation and the outcome are decided by the database against the slot.
 */
export function parseKnowledgeSubmit(
  input: unknown,
  now: Date = new Date()
): Parsed<ParsedKnowledgeSubmit> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  if (!isRevision(input.slotRevision)) return RELOAD
  if (!isUuid(input.idempotencyKey))
    return knowledgeInvalid(
      { idempotencyKey: "Reload the page and try again." },
      "This request is invalid. Reload the page."
    )
  const kind = input.kind ?? "finding"
  if (!oneOf(CONTRIBUTION_KINDS, kind))
    return knowledgeInvalid({ kind: "Choose what you are sending." })
  if (!oneOf(KNOWLEDGE_ANSWERS, input.answer))
    return knowledgeInvalid({
      answer: "Choose Yes, No, Not applicable or Couldn't establish.",
    })
  const answer = input.answer
  const errors: Record<string, string> = {}
  const finding = text(errors, "finding", input.finding, LIMITS.finding)
  const limitations = text(errors, "limitations", input.limitations, LIMITS.limitations)
  const reason = text(errors, "reason", input.reason, LIMITS.reason)
  if ((answer === "no" || answer === "not_applicable") && !reason && !errors.reason)
    errors.reason = "Enter a reason."
  let unknownPreset: UnknownPreset | null = null
  let triedText: string | null = null
  if (answer === "unknown") {
    if (oneOf(UNKNOWN_PRESETS, input.unknownPreset)) unknownPreset = input.unknownPreset
    else errors.unknownPreset = "Choose why it couldn't be established."
    triedText = text(errors, "triedText", input.triedText, LIMITS.triedText)
    if (!triedText && !errors.triedText) errors.triedText = "Say what you tried."
  }
  const changeReason = text(errors, "changeReason", input.changeReason, LIMITS.changeReason)
  if (kind === "change_report" && !changeReason && !errors.changeReason)
    errors.changeReason = "Say what has changed."
  let respondsTo: string | null = null
  if (kind === "detail") {
    if (isUuid(input.respondsTo)) respondsTo = input.respondsTo
    else errors.respondsTo = "Reload the page and try again."
  }
  const assetIds = uuidList(input.assetIds ?? [], 0, LIMITS.maxAssets)
  if (!assetIds) errors.assetIds = `Choose up to ${LIMITS.maxAssets} photos or videos.`
  const redaction = input.redactionConfirmed
  if (redaction !== undefined && redaction !== null && typeof redaction !== "boolean")
    errors.redactionConfirmed = "Confirm the Wi-Fi password and join QR code are covered."
  if (input.confirmOwn !== undefined && typeof input.confirmOwn !== "boolean")
    errors.confirmOwn = "Reload the page and try again."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)

  let wifi: WifiMetadata | null = null
  if (input.wifi !== undefined && input.wifi !== null) {
    const parsed = parseWifi(input.wifi, now)
    if (!parsed.ok) return parsed
    wifi = parsed.value
  }
  return ok({
    checkId: input.checkId,
    slotRevision: input.slotRevision,
    idempotencyKey: input.idempotencyKey,
    kind,
    answer,
    finding,
    limitations,
    reason,
    unknownPreset,
    triedText,
    changeReason,
    respondsTo,
    assetIds: assetIds ?? [],
    wifi,
    redactionConfirmed: typeof redaction === "boolean" ? redaction : null,
    confirmOwn: input.confirmOwn === true,
  })
}

export type ParsedDecide = {
  target: FindingRef
  decision: Decision
  slotRevision: number
  idempotencyKey: string
  note: string | null
}

/** Request detail, decline and revoke need a note (the reason shown to the sender). */
export function parseDecide(input: unknown, decision: Decision): Parsed<ParsedDecide> {
  if (!oneOf(DECISIONS, decision)) return knowledgeInvalid({ decision: "Reload the page." })
  const target = isObject(input) ? parseFindingRef(input.findingRef) : null
  if (!isObject(input) || !target)
    return knowledgeFailure("not_found", "This finding could not be found. Reload the page.")
  if (!isRevision(input.slotRevision)) return RELOAD
  if (!isUuid(input.idempotencyKey))
    return knowledgeInvalid(
      { idempotencyKey: "Reload the page and try again." },
      "This request is invalid. Reload the page."
    )
  const errors: Record<string, string> = {}
  const note = text(errors, "note", input.note, LIMITS.note)
  if (
    (decision === "request_detail" || decision === "decline" || decision === "revoke") &&
    !note &&
    !errors.note
  )
    errors.note = "Enter a reason."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  return ok({
    target,
    decision,
    slotRevision: input.slotRevision,
    idempotencyKey: input.idempotencyKey,
    note,
  })
}

export type ParsedResolve = {
  checkId: string
  slotRevision: number
  idempotencyKey: string
  /** null keeps the answer in use. */
  choose: string | null
  reason: string
}

/** `choose`: a contribution findingRef, or "keep_in_use". */
export function parseResolve(input: unknown): Parsed<ParsedResolve> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  if (!isRevision(input.slotRevision)) return RELOAD
  if (!isUuid(input.idempotencyKey))
    return knowledgeInvalid(
      { idempotencyKey: "Reload the page and try again." },
      "This request is invalid. Reload the page."
    )
  let choose: string | null = null
  if (input.choose !== "keep_in_use") {
    const ref = parseFindingRef(input.choose)
    if (!ref || ref.type !== "contribution")
      return knowledgeInvalid({ choose: "Choose a finding, or keep the answer in use." })
    choose = ref.id
  }
  const errors: Record<string, string> = {}
  const reason = text(errors, "reason", input.reason, LIMITS.reason)
  if (!reason && !errors.reason) errors.reason = "Enter a reason."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  return ok({
    checkId: input.checkId,
    slotRevision: input.slotRevision,
    idempotencyKey: input.idempotencyKey,
    choose,
    reason: reason!,
  })
}

export type ParsedDraft = {
  checkId: string
  draftRevision: number | null
  payload: Record<string, unknown>
  assetIds: string[]
  idempotencyKey: string
}

export function parseDraft(input: unknown): Parsed<ParsedDraft> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  const revision = input.draftRevision ?? null
  if (revision !== null && !intInRange(revision, 1, 2 ** 31 - 1))
    return knowledgeInvalid({ draftRevision: "Reload the draft and try again." })
  if (!isUuid(input.idempotencyKey))
    return knowledgeInvalid({ idempotencyKey: "Reload the page and try again." })
  if (
    !isObject(input.payload) ||
    new TextEncoder().encode(JSON.stringify(input.payload)).length > LIMITS.draftPayload
  )
    return knowledgeInvalid({ payload: "This draft is too large to save." })
  const assetIds = uuidList(input.assetIds ?? [], 0, LIMITS.maxAssets)
  if (!assetIds)
    return knowledgeInvalid({ assetIds: `Choose up to ${LIMITS.maxAssets} photos or videos.` })
  return ok({
    checkId: input.checkId,
    draftRevision: revision as number | null,
    payload: input.payload,
    assetIds,
    idempotencyKey: input.idempotencyKey,
  })
}

export type ParsedWorkingList = {
  venueId: string
  keys: string[]
  enabled: boolean
  reason: string | null
}

export function parseWorkingList(input: unknown): Parsed<ParsedWorkingList> {
  if (!isObject(input) || !isUuid(input.venueId))
    return knowledgeInvalid({ venueId: "Choose a venue." })
  const keys = input.keys
  if (
    !Array.isArray(keys) ||
    keys.length < 1 ||
    keys.length > 39 ||
    !keys.every((k): k is string => typeof k === "string" && KEY.test(k)) ||
    new Set(keys).size !== keys.length
  )
    return knowledgeInvalid({ keys: "Choose at least one question." })
  if (typeof input.enabled !== "boolean")
    return knowledgeInvalid({ enabled: "Choose whether to add or remove the questions." })
  const errors: Record<string, string> = {}
  const reason = text(errors, "reason", input.reason, LIMITS.reason)
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  return ok({ venueId: input.venueId, keys, enabled: input.enabled, reason })
}

const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[cse]:[0-9a-f-]{1,36}$/

/** A previous page's `nextCursor` ("<UTC instant>|<key>"), or none. */
export function parseCursor(v: unknown): Parsed<string | null> {
  if (v === undefined || v === null || v === "") return ok(null)
  if (typeof v !== "string" || !CURSOR.test(v))
    return knowledgeInvalid({ cursor: "Reload the page." })
  return ok(v)
}

/** A London month as "YYYY-MM-01", or none for the current month. */
export function parsePeriod(v: unknown): Parsed<string | null> {
  if (v === undefined || v === null) return ok(null)
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(v))
    return knowledgeInvalid({ period: "Choose a month." })
  return ok(v)
}
