import {
  EVIDENCE_RULE_LABEL,
  LIMITS,
  REDACTION_CONFIRM_KEYS,
  WIFI_KEY,
  evidenceSatisfies,
  type EvidenceKind,
  type EvidenceRule,
  type SubmitInput,
  type WifiMetadata,
} from "@/lib/amenities/contract"
import type {
  FindingKind,
  SubmitKnowledgeInput,
} from "@/lib/knowledge-client/contract"

import type { CaptureDraft } from "./draft"

/** Field names shared with the services' `fieldErrors` where they match. */
export type CaptureField =
  | "answer"
  | "finding"
  | "limitations"
  | "reason"
  | "unknownPreset"
  | "triedText"
  | "changeReason"
  | "confirmOwn"
  | "assetIds"
  | "wifi.testSpot"
  | "wifi.testedOn"
  | "wifi.downloadMbps"
  | "wifi.uploadMbps"
  | "redactionConfirmed"

export type CaptureErrors = Partial<Record<CaptureField, string>>

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Today in London as "YYYY-MM-DD" (the latest allowed Wi-Fi test date). */
export function londonToday(now: Date = new Date()): string {
  return londonDate.format(now)
}

export function needsRedactionConfirm(templateKey: string): boolean {
  return (REDACTION_CONFIRM_KEYS as readonly string[]).includes(templateKey)
}

/** "Add a video to answer Yes." for a rule that the chosen evidence misses. */
export function missingEvidenceText(
  rule: EvidenceRule,
  kinds: readonly EvidenceKind[]
): string | null {
  if (evidenceSatisfies(rule, kinds)) return null
  const photo = kinds.includes("photo")
  const video = kinds.includes("video")
  switch (rule) {
    case "photo":
      return "Add a photo to answer Yes."
    case "video":
      return photo
        ? "A photo isn't enough here. Add a video to answer Yes."
        : "Add a video to answer Yes."
    case "either":
      return "Add a photo or a video to answer Yes."
    case "both":
      return photo
        ? "Add a video as well to answer Yes."
        : video
          ? "Add a photo as well to answer Yes."
          : "Add a photo and a video to answer Yes."
  }
}

function mbps(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 && n <= LIMITS.maxMbps ? n : null
}

type Common = {
  draft: CaptureDraft
  templateKey: string
  rule: EvidenceRule
  /** Kinds of the selected evidence. */
  kinds: readonly EvidenceKind[]
  checkId: string
  today?: string
}

/** Checks every form shares: text limits, evidence for Yes, Wi-Fi notes, the tick. */
function checkCommon({
  draft,
  templateKey,
  rule,
  kinds,
  today = londonToday(),
}: Common) {
  const errors: CaptureErrors = {}
  const { answer } = draft
  const finding = draft.finding.trim()
  const limitations = draft.limitations.trim()
  const reason = draft.reason.trim()
  const wifiCheck = templateKey === WIFI_KEY && answer === "yes"
  const redaction = needsRedactionConfirm(templateKey)

  if (finding.length > LIMITS.finding)
    errors.finding = `Use up to ${LIMITS.finding} characters.`
  if (limitations.length > LIMITS.limitations)
    errors.limitations = `Use up to ${LIMITS.limitations} characters.`
  if (answer === "no" || answer === "not_applicable") {
    if (!reason) errors.reason = "Say why, so your manager knows."
  }
  if (reason.length > LIMITS.reason)
    errors.reason = `Use up to ${LIMITS.reason} characters.`
  if (draft.assetIds.length > LIMITS.maxAssets)
    errors.assetIds = `Choose up to ${LIMITS.maxAssets} photos or videos.`
  else if (answer === "yes") {
    const missing = missingEvidenceText(rule, kinds)
    if (missing)
      errors.assetIds = `${missing} Required: ${EVIDENCE_RULE_LABEL[rule]}.`
  }

  let wifi: WifiMetadata | undefined
  if (wifiCheck) {
    const testSpot = draft.wifi.testSpot.trim()
    const testedOn = draft.wifi.testedOn.trim()
    const down = mbps(draft.wifi.downloadMbps)
    const up = mbps(draft.wifi.uploadMbps)
    if (!testSpot) errors["wifi.testSpot"] = "Say where you tested the Wi-Fi."
    else if (testSpot.length > LIMITS.wifiTestSpot)
      errors["wifi.testSpot"] = `Use up to ${LIMITS.wifiTestSpot} characters.`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(testedOn))
      errors["wifi.testedOn"] = "Enter the date you tested it."
    else if (testedOn > today)
      errors["wifi.testedOn"] = "The test date can't be in the future."
    const range = `Enter a number from 0 to ${LIMITS.maxMbps}.`
    if (down === null) errors["wifi.downloadMbps"] = range
    if (up === null) errors["wifi.uploadMbps"] = range
    if (down !== null && up !== null && testSpot && testedOn)
      wifi = { testSpot, testedOn, downloadMbps: down, uploadMbps: up }
  }

  if (
    redaction &&
    !draft.redactionConfirmed &&
    (answer === "yes" || kinds.includes("photo"))
  ) {
    errors.redactionConfirmed =
      "Tick this once the password and join QR code are covered."
  }

  const text = {
    ...(finding ? { finding } : {}),
    ...(limitations ? { limitations } : {}),
    ...(reason ? { reason } : {}),
    assetIds: draft.assetIds,
    ...(wifi ? { wifi } : {}),
    ...(redaction ? { redactionConfirmed: draft.redactionConfirmed } : {}),
  }
  return { errors, text }
}

const hasErrors = (errors: CaptureErrors) => Object.values(errors).some(Boolean)

/**
 * Checks the draft as the services will, so most mistakes show next to the
 * field before anything is sent. Returns the input when valid.
 */
export function validateDraft({
  revision,
  ...common
}: Common & { revision: number }):
  { ok: true; input: SubmitInput } | { ok: false; errors: CaptureErrors } {
  const { errors, text } = checkCommon(common)
  const { answer } = common.draft
  if (!answer) errors.answer = "Choose Yes, No or Not applicable."
  else if (answer === "unknown")
    errors.answer =
      "Couldn't establish can't be sent with this form. Choose another answer, or ask your manager."
  if (hasErrors(errors) || !answer || answer === "unknown")
    return { ok: false, errors }
  return {
    ok: true,
    input: {
      checkId: common.checkId,
      revision,
      idempotencyKey: common.draft.idempotencyKey,
      answer,
      ...text,
    },
  }
}

/**
 * The knowledge form's checks: everything above, plus Couldn't establish (a
 * reason preset and what was tried), a change report's "What changed?" and a
 * manager's choice of who confirms the answer.
 */
export function validateKnowledgeDraft({
  slotRevision,
  kind,
  respondsTo,
  askConfirmOwn,
  ...common
}: Common & {
  slotRevision: number
  kind: FindingKind
  respondsTo: string | null
  /** A manager on a confirmation-required question must choose. */
  askConfirmOwn: boolean
}):
  | { ok: true; input: SubmitKnowledgeInput }
  | { ok: false; errors: CaptureErrors } {
  const { errors, text } = checkCommon(common)
  const { draft } = common
  const { answer } = draft
  const tried = draft.triedText.trim()
  const changed = draft.changeReason.trim()

  if (!answer) errors.answer = "Choose an answer, or Save for later."
  if (answer === "unknown") {
    if (!draft.unknownPreset)
      errors.unknownPreset = "Choose why you couldn't establish it."
    if (!tried) errors.triedText = "Say what you tried."
    else if (tried.length > LIMITS.reason)
      errors.triedText = `Use up to ${LIMITS.reason} characters.`
  }
  if (kind === "change_report") {
    if (!changed) errors.changeReason = "Say what changed."
    else if (changed.length > LIMITS.reason)
      errors.changeReason = `Use up to ${LIMITS.reason} characters.`
  }
  if (askConfirmOwn && draft.confirmOwn === null)
    errors.confirmOwn = "Choose who confirms this answer."

  if (hasErrors(errors) || !answer) return { ok: false, errors }
  // A reason belongs to No and Not applicable only (the server's row check).
  const { reason, ...rest } = text
  return {
    ok: true,
    input: {
      checkId: common.checkId,
      slotRevision,
      idempotencyKey: draft.idempotencyKey,
      kind,
      answer,
      ...rest,
      ...(reason && (answer === "no" || answer === "not_applicable")
        ? { reason }
        : {}),
      ...(answer === "unknown"
        ? { unknownPreset: draft.unknownPreset!, triedText: tried }
        : {}),
      ...(kind === "change_report" ? { changeReason: changed } : {}),
      ...(kind === "detail" && respondsTo ? { respondsTo } : {}),
      ...(askConfirmOwn ? { confirmOwn: draft.confirmOwn === true } : {}),
    },
  }
}
