// Input checks for amenity services. They give friendly field errors early;
// the database repeats every rule with the same limits (contract LIMITS).

import {
  LIMITS,
  REOPEN_PRESETS,
  SUBMIT_ANSWERS,
  type AmenityFailure,
  type ReopenPreset,
  type SubmitAnswer,
  type WifiMetadata,
} from "@/lib/amenities/contract"
import { isLocalDate, localDateOf } from "@/lib/server/coverage/time"
import {
  intInRange,
  isObject,
  isUuid,
  optionalText,
  optionalUuid,
  uuidList,
} from "@/lib/server/coverage/validate"

import { invalid, NOT_FOUND } from "./errors"

export { isObject, isUuid }

const MAX_REVISION = 2 ** 31 - 1
const KEY = /^[a-z][a-z0-9_]{0,63}$/

type Parsed<T> = { ok: true; value: T } | AmenityFailure

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })

const BAD_REVISION = invalid(
  { revision: "Reload the page and try again." },
  "This request is invalid. Reload the page."
)

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

/** `{ checkId }`: an unknown id is not found, as the database would say. */
export function parseCheckId(input: unknown): Parsed<string> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  return ok(input.checkId)
}

function parseRevisioned(input: unknown): Parsed<{
  checkId: string
  revision: number
  input: Record<string, unknown>
}> {
  if (!isObject(input) || !isUuid(input.checkId)) return NOT_FOUND
  if (!intInRange(input.revision, 0, MAX_REVISION)) return BAD_REVISION
  return ok({ checkId: input.checkId, revision: input.revision, input })
}

export function parseRevisionInput(
  input: unknown
): Parsed<{ checkId: string; revision: number }> {
  const parsed = parseRevisioned(input)
  if (!parsed.ok) return parsed
  return ok({ checkId: parsed.value.checkId, revision: parsed.value.revision })
}

export function parseVenueId(input: unknown): Parsed<string | null> {
  const venueId = isObject(input) ? optionalUuid(input.venueId) : null
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  return ok(venueId)
}

/** Distinct catalogue keys, 1..LIMITS.maxAddKeys of them. */
export function parseKeys(input: unknown): Parsed<string[]> {
  const keys = isObject(input) ? input.keys : undefined
  if (
    !Array.isArray(keys) ||
    keys.length < 1 ||
    keys.length > LIMITS.maxAddKeys ||
    !keys.every((k): k is string => typeof k === "string" && KEY.test(k)) ||
    new Set(keys).size !== keys.length
  )
    return invalid({ keys: "Choose at least one catalogue entry." })
  return ok(keys)
}

export function parseAssign(
  input: unknown
): Parsed<{ checkId: string; revision: number; assigneeId: string | null }> {
  const parsed = parseRevisioned(input)
  if (!parsed.ok) return parsed
  const assigneeId = optionalUuid(parsed.value.input.assigneeId)
  if (assigneeId === undefined)
    return invalid({ assigneeId: "Choose a person." })
  const { checkId, revision } = parsed.value
  return ok({ checkId, revision, assigneeId })
}

export function parseNotes(
  input: unknown
): Parsed<{ checkId: string; revision: number; notes: string }> {
  const parsed = parseRevisioned(input)
  if (!parsed.ok) return parsed
  const notes = optionalText(parsed.value.input.notes, LIMITS.notes)
  if (notes === undefined)
    return invalid({ notes: `Use up to ${LIMITS.notes} characters.` })
  const { checkId, revision } = parsed.value
  return ok({ checkId, revision, notes: notes ?? "" })
}

export function parseReopen(input: unknown): Parsed<{
  checkId: string
  revision: number
  preset: ReopenPreset
  reason: string | null
}> {
  const parsed = parseRevisioned(input)
  if (!parsed.ok) return parsed
  const { checkId, revision, input: raw } = parsed.value
  if (!oneOf(REOPEN_PRESETS, raw.preset))
    return invalid({ preset: "Choose a reason." })
  const reason = optionalText(raw.reason, LIMITS.reason)
  if (reason === undefined)
    return invalid({ reason: `Use up to ${LIMITS.reason} characters.` })
  if (raw.preset === "other" && !reason)
    return invalid({ reason: "Enter a reason." })
  return ok({ checkId, revision, preset: raw.preset, reason })
}

const MBPS = /^\d+(\.\d+)?$/

function mbps(v: unknown): number | undefined {
  const n = typeof v === "string" && MBPS.test(v.trim()) ? Number(v) : v
  return typeof n === "number" &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= LIMITS.maxMbps
    ? n
    : undefined
}

/**
 * Wi-Fi test notes: a test spot (1..120 characters), a London date that is
 * not in the future, and download/upload speeds from 0 to LIMITS.maxMbps.
 * Field errors are keyed `wifi.<field>`.
 */
export function parseWifi(
  v: unknown,
  now: Date = new Date()
): Parsed<WifiMetadata> {
  if (!isObject(v)) return invalid({ wifi: "Enter the Wi-Fi test details." })
  const errors: Record<string, string> = {}
  const testSpot = optionalText(v.testSpot, LIMITS.wifiTestSpot)
  if (!testSpot)
    errors["wifi.testSpot"] =
      `Say where you tested, in up to ${LIMITS.wifiTestSpot} characters.`
  const testedOn = typeof v.testedOn === "string" ? v.testedOn.trim() : ""
  if (!isLocalDate(testedOn) || testedOn > localDateOf(now))
    errors["wifi.testedOn"] = "Choose the test date (today or earlier)."
  const downloadMbps = mbps(v.downloadMbps)
  if (downloadMbps === undefined)
    errors["wifi.downloadMbps"] =
      `Enter the download speed (0 to ${LIMITS.maxMbps} Mbps).`
  const uploadMbps = mbps(v.uploadMbps)
  if (uploadMbps === undefined)
    errors["wifi.uploadMbps"] =
      `Enter the upload speed (0 to ${LIMITS.maxMbps} Mbps).`
  if (Object.keys(errors).length) return invalid(errors)
  return ok({
    testSpot: testSpot as string,
    testedOn,
    downloadMbps: downloadMbps as number,
    uploadMbps: uploadMbps as number,
  })
}

export type ParsedSubmit = {
  checkId: string
  revision: number
  idempotencyKey: string
  answer: SubmitAnswer
  finding: string | null
  limitations: string | null
  reason: string | null
  assetIds: string[]
  wifi: WifiMetadata | null
  redactionConfirmed: boolean
}

/**
 * Shape and limits only. Whether Yes meets the evidence rule, whether this
 * check needs Wi-Fi notes and the redaction tick, and whether each asset may be
 * attached are decided by the database against the check's current state.
 */
export function parseSubmit(
  input: unknown,
  now: Date = new Date()
): Parsed<ParsedSubmit> {
  const parsed = parseRevisioned(input)
  if (!parsed.ok) return parsed
  const { checkId, revision, input: raw } = parsed.value
  if (!isUuid(raw.idempotencyKey))
    return invalid(
      { idempotencyKey: "Reload the page and try again." },
      "This request is invalid. Reload the page."
    )
  if (!oneOf(SUBMIT_ANSWERS, raw.answer))
    return invalid({ answer: "Choose Yes, No or Not applicable." })
  const answer = raw.answer
  const errors: Record<string, string> = {}
  const finding = optionalText(raw.finding, LIMITS.finding)
  if (finding === undefined)
    errors.finding = `Use up to ${LIMITS.finding} characters.`
  const limitations = optionalText(raw.limitations, LIMITS.limitations)
  if (limitations === undefined)
    errors.limitations = `Use up to ${LIMITS.limitations} characters.`
  const reason = optionalText(raw.reason, LIMITS.reason)
  if (reason === undefined)
    errors.reason = `Use up to ${LIMITS.reason} characters.`
  else if (answer !== "yes" && !reason) errors.reason = "Enter a reason."
  const assetIds = uuidList(raw.assetIds ?? [], 0, LIMITS.maxAssets)
  if (!assetIds)
    errors.assetIds = `Choose up to ${LIMITS.maxAssets} photos or videos.`
  if (
    raw.redactionConfirmed !== undefined &&
    typeof raw.redactionConfirmed !== "boolean"
  )
    errors.redactionConfirmed =
      "Confirm the Wi-Fi password and join QR code are covered."
  if (Object.keys(errors).length) return invalid(errors)

  let wifi: WifiMetadata | null = null
  if (raw.wifi !== undefined && raw.wifi !== null) {
    const parsedWifi = parseWifi(raw.wifi, now)
    if (!parsedWifi.ok) return parsedWifi
    wifi = parsedWifi.value
  }
  return ok({
    checkId,
    revision,
    idempotencyKey: raw.idempotencyKey,
    answer,
    finding: finding ?? null,
    limitations: limitations ?? null,
    reason: reason ?? null,
    assetIds: assetIds ?? [],
    wifi,
    redactionConfirmed: raw.redactionConfirmed === true,
  })
}
