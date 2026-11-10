// Input selection and sanitisation rules (B09 design §1.3, §1.4, §2.3). Pure.

import { REDACTION_CONFIRM_KEYS } from "@/lib/amenities/contract"

import type { AssistRequester, Eligibility, QuestionSensitivity } from "./types"

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
// Phone-number candidates; replacePhones keeps only those starting with + or 0
// and holding 10 to 15 digits, so prices and dates pass.
const PHONE_CANDIDATE = /\+?\d[\d ().-]{7,}\d/g
const CREDENTIAL =
  /\b(?:password|passcode|passwd|pwd|pin|wi-?fi|ssid|network\s+key|wpa2?|key)\s*[:=]\s*\S+/gi
// Long random-looking tokens: 20+ characters mixing letters and digits.
const TOKEN =
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g

export const REMOVED = "[removed]"

export type RedactionCounts = {
  email: number
  url: number
  phone: number
  credential: number
  token: number
}

export type RedactedText = {
  text: string
  removed: RedactionCounts
  credentialLike: boolean
}

function replaceAll(
  text: string,
  pattern: RegExp,
  count: (n: number) => void
): string {
  let n = 0
  const out = text.replace(pattern, () => {
    n += 1
    return REMOVED
  })
  count(n)
  return out
}

/** Removes emails, URLs, phone numbers and credential-like strings from free text. */
export function redactText(input: string): RedactedText {
  const removed: RedactionCounts = {
    email: 0,
    url: 0,
    phone: 0,
    credential: 0,
    token: 0,
  }
  let text = input
  text = replaceAll(text, CREDENTIAL, (n) => (removed.credential = n))
  text = replaceAll(text, EMAIL, (n) => (removed.email = n))
  text = replaceAll(text, URL_LIKE, (n) => (removed.url = n))
  text = replaceAll(text, TOKEN, (n) => (removed.token = n))
  text = text.replace(PHONE_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, "").length
    if (!/^[+0]/.test(match) || digits < 10 || digits > 15) return match
    removed.phone += 1
    return REMOVED
  })
  return {
    text,
    removed,
    credentialLike: removed.credential > 0 || removed.token > 0,
  }
}

export function looksLikeCredential(text: string): boolean {
  return (
    new RegExp(CREDENTIAL.source, "i").test(text) ||
    new RegExp(TOKEN.source).test(text)
  )
}

function isExcludedQuestion(
  questionKey: string,
  sensitivity: QuestionSensitivity
): boolean {
  return (
    (REDACTION_CONFIRM_KEYS as readonly string[]).includes(questionKey) ||
    sensitivity === "restricted_detail"
  )
}

export type AssetFacts = {
  purpose: "general" | "amenity"
  mediaType: "image" | "video"
  uploadState: "uploading" | "processing" | "ready" | "failed"
  deleted: boolean
  /** The requesting person can already open it through the existing gates. */
  viewerCanOpen: boolean
  ownUpload: boolean
}

function assetRefusal(asset: AssetFacts): Eligibility | null {
  if (!asset.viewerCanOpen) return { ok: false, reason: "asset_not_found" }
  if (asset.deleted) return { ok: false, reason: "asset_deleted" }
  if (asset.uploadState !== "ready")
    return { ok: false, reason: "asset_not_ready" }
  if (asset.mediaType !== "image")
    return { ok: false, reason: "video_not_supported" }
  return null
}

/** J1. A colleague's photo is eligible only in Review, and only once OD-B9-3 allows it. */
export function checkLabelSuggestInput(input: {
  asset: AssetFacts
  requester: AssistRequester
  reviewTriggerEnabled: boolean
}): Eligibility {
  const refused = assetRefusal(input.asset)
  if (refused) return refused
  if (input.asset.purpose !== "general")
    return { ok: false, reason: "asset_purpose_excluded" }
  if (
    !input.asset.ownUpload &&
    !(input.requester === "manager" && input.reviewTriggerEnabled)
  )
    return { ok: false, reason: "review_trigger_not_enabled" }
  return { ok: true }
}

/** J2. Only a declared operator document, within the page and byte limits. */
export function checkMenuImportInput(input: {
  sourceKind: string
  requester: AssistRequester
  pageCount: number
  totalBytes: number
  maxPages: number
  maxBytes: number
}): Eligibility {
  if (input.requester !== "admin")
    return { ok: false, reason: "requester_not_allowed" }
  if (input.sourceKind !== "operator_document")
    return { ok: false, reason: "source_not_operator_document" }
  if (input.pageCount < 1 || input.pageCount > input.maxPages)
    return { ok: false, reason: "too_many_pages" }
  if (input.totalBytes > input.maxBytes)
    return { ok: false, reason: "input_too_large" }
  return { ok: true }
}

/** J3. Never for Wi-Fi or other redaction keys, restricted keys, or someone else's photo. */
export function checkEvidenceDescribeInput(input: {
  questionKey: string
  sensitivity: QuestionSensitivity
  asset: AssetFacts
}): Eligibility {
  if (isExcludedQuestion(input.questionKey, input.sensitivity))
    return { ok: false, reason: "question_excluded" }
  const refused = assetRefusal(input.asset)
  if (refused) return refused
  if (!input.asset.ownUpload) return { ok: false, reason: "asset_not_own" }
  return { ok: true }
}

/**
 * J4. The person's own unsent note, redacted. A note that held anything
 * credential-like is refused outright rather than sent with the gap.
 */
export function prepareMissingFieldInput(input: {
  questionKey: string
  sensitivity: QuestionSensitivity
  note: string
  maxBytes: number
}): ({ ok: true } & RedactedText) | { ok: false; reason: string } {
  if (isExcludedQuestion(input.questionKey, input.sensitivity))
    return { ok: false, reason: "question_excluded" }
  const redacted = redactText(input.note)
  if (redacted.credentialLike)
    return { ok: false, reason: "credential_like_text" }
  if (new TextEncoder().encode(redacted.text).length > input.maxBytes)
    return { ok: false, reason: "input_too_large" }
  return { ok: true, ...redacted }
}
