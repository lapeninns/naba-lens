import {
  EVIDENCE_RULE_LABEL,
  LIMITS,
  REDACTION_CONFIRM_KEYS,
  WIFI_KEY,
  evidenceSatisfies,
  type EvidenceKind,
  type EvidenceRule,
  type SubmitInput,
} from "@/lib/amenities/contract"

import type { CaptureDraft } from "./draft"

/** Field names shared with the services' `fieldErrors` where they match. */
export type CaptureField =
  | "answer"
  | "finding"
  | "limitations"
  | "reason"
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

/**
 * Checks the draft as the services will, so most mistakes show next to the
 * field before anything is sent. Returns the input when valid.
 */
export function validateDraft({
  draft,
  templateKey,
  rule,
  kinds,
  checkId,
  revision,
  today = londonToday(),
}: {
  draft: CaptureDraft
  templateKey: string
  rule: EvidenceRule
  /** Kinds of the selected evidence. */
  kinds: readonly EvidenceKind[]
  checkId: string
  revision: number
  today?: string
}): { ok: true; input: SubmitInput } | { ok: false; errors: CaptureErrors } {
  const errors: CaptureErrors = {}
  const { answer } = draft
  const finding = draft.finding.trim()
  const limitations = draft.limitations.trim()
  const reason = draft.reason.trim()
  const wifiCheck = templateKey === WIFI_KEY && answer === "yes"
  const redaction = needsRedactionConfirm(templateKey)

  if (!answer) errors.answer = "Choose Yes, No or Not applicable."
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

  let wifi: SubmitInput["wifi"]
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

  if (Object.values(errors).some(Boolean) || !answer)
    return { ok: false, errors }
  return {
    ok: true,
    input: {
      checkId,
      revision,
      idempotencyKey: draft.idempotencyKey,
      answer,
      ...(finding ? { finding } : {}),
      ...(limitations ? { limitations } : {}),
      ...(reason ? { reason } : {}),
      assetIds: draft.assetIds,
      ...(wifi ? { wifi } : {}),
      ...(redaction ? { redactionConfirmed: draft.redactionConfirmed } : {}),
    },
  }
}
