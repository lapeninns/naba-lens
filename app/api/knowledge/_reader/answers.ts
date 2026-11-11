import { createHash } from "node:crypto"

import {
  ANSWER_VALUES,
  REDACTION_KEYS,
  SOURCE_KINDS,
  SOURCE_ORIGINS,
  STAFF_TEXT_AUDIENCES,
  UNAVAILABLE_DETAILS,
  UNRECORDED_SOURCE_KIND,
  type Audience,
  type ReaderAnswer,
  type ResolverReason,
} from "./contract"
import { UUID } from "./credentials"

/** The wrapper's columns that the reader may use (WS1 B01 design §5.2-5.3). */
export type ResolverRow = {
  question_key: string
  status: "available" | "unavailable"
  /** WS1's row type also allows `not_enabled`; it is read as unknown / not_enabled. */
  reason: ResolverReason | "not_enabled" | null
  detail: string | null
  revision: number
  question_version: number | null
  value: string | null
  current_submission_id: string | null
  current_contribution_id: string | null
  /** Which ID names the current answer; null when there is no current answer. */
  contribution_kind: "contribution" | "submission" | null
  source_basis: "staff" | "venue_manager" | "admin" | null
  /**
   * Where an imported answer came from (B03-f). Optional: null or absent for
   * every answer a person observed.
   */
  source_origin: (typeof SOURCE_ORIGINS)[number] | null
  finding: string | null
  limitations: string | null
  reason_text: string | null
  confirmation_required: boolean
  confirmation_state:
    "not_required" | "pending" | "confirmed" | "revoked" | null
  confirmation_basis: "venue_manager" | "admin" | null
  confirmation_self: boolean | null
  confirmation_saved_at: string | null
  evidence_photos: number
  evidence_videos: number
  redaction_proof: "recorded" | "not_recorded" | "not_applicable" | null
  saved_at: string | null
  observed_at: string | null
  next_check_due: string | null
  /** Null on unavailable rows; required on available ones (B03-e fills it). */
  freshness_state: "current" | "due_soon" | "unrated" | null
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[]
): T | null | undefined {
  if (v === null || v === undefined) return null
  return allowed.includes(v as T) ? (v as T) : undefined
}
function text(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null
  return typeof v === "string" ? v : undefined
}
function time(v: unknown): string | null | undefined {
  const s = text(v)
  if (s === null || s === undefined) return s
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}
function count(v: unknown): number | undefined {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0
    ? n
    : undefined
}
function id(v: unknown): string | null | undefined {
  const s = text(v)
  if (s === null || s === undefined) return s
  return UUID.test(s) ? s : undefined
}

/**
 * Accepts a wrapper row only when every column the reader uses has the
 * documented type. Columns not listed here are never read, so an extra column
 * (a name, notes, internal metadata) cannot reach a response.
 */
export function parseResolverRow(raw: unknown): ResolverRow | null {
  if (!isObject(raw)) return null
  const reasons = [
    ...(Object.keys(UNAVAILABLE_DETAILS) as ResolverReason[]),
    "not_enabled" as const,
  ]
  const row = {
    question_key:
      typeof raw.question_key === "string" ? raw.question_key : undefined,
    status: oneOf(raw.status, ["available", "unavailable"] as const),
    reason: oneOf(raw.reason, reasons),
    detail: text(raw.detail),
    revision: count(raw.revision),
    question_version:
      raw.question_version === null || raw.question_version === undefined
        ? null
        : count(raw.question_version),
    value: text(raw.value),
    current_submission_id: id(raw.current_submission_id),
    current_contribution_id: id(raw.current_contribution_id),
    contribution_kind: oneOf(raw.contribution_kind, [
      "contribution",
      "submission",
    ] as const),
    source_origin: oneOf(raw.source_origin, SOURCE_ORIGINS),
    source_basis: oneOf(raw.source_basis, [
      "staff",
      "venue_manager",
      "admin",
    ] as const),
    finding: text(raw.finding),
    limitations: text(raw.limitations),
    reason_text: text(raw.reason_text),
    confirmation_required:
      typeof raw.confirmation_required === "boolean"
        ? raw.confirmation_required
        : undefined,
    confirmation_state: oneOf(raw.confirmation_state, [
      "not_required",
      "pending",
      "confirmed",
      "revoked",
    ] as const),
    confirmation_basis: oneOf(raw.confirmation_basis, [
      "venue_manager",
      "admin",
    ] as const),
    confirmation_self:
      raw.confirmation_self === null || raw.confirmation_self === undefined
        ? null
        : typeof raw.confirmation_self === "boolean"
          ? raw.confirmation_self
          : undefined,
    confirmation_saved_at: time(raw.confirmation_saved_at),
    evidence_photos: count(raw.evidence_photos ?? 0),
    evidence_videos: count(raw.evidence_videos ?? 0),
    redaction_proof: oneOf(raw.redaction_proof, [
      "recorded",
      "not_recorded",
      "not_applicable",
    ] as const),
    saved_at: time(raw.saved_at),
    observed_at: time(raw.observed_at),
    next_check_due: time(raw.next_check_due),
    freshness_state: oneOf(raw.freshness_state, [
      "current",
      "due_soon",
      "unrated",
    ] as const),
  }
  if (Object.values(row).some((v) => v === undefined)) return null
  if (row.status === null) return null
  return row as ResolverRow
}

const unavailable = (
  key: string,
  reason: ReaderAnswer["unavailable"] & object,
  revision: number | null,
  questionVersion: number | null
): ReaderAnswer => ({
  key,
  questionVersion,
  status: "unavailable",
  value: null,
  summary: null,
  conditions: [],
  provenance: null,
  revision,
  freshness: null,
  unavailable: reason,
})

/** A key this credential may not read: nothing about it, not even a revision. */
export function notPermittedAnswer(key: string): ReaderAnswer {
  return unavailable(key, { reason: "not_permitted", detail: null }, null, null)
}

/**
 * One answer from a resolver row under the audience's allowlist, or null when
 * the row breaks the resolver contract (the caller fails closed).
 */
export function toAnswer(
  row: ResolverRow,
  audience: Audience
): ReaderAnswer | null {
  const key = row.question_key
  if (row.status === "unavailable") {
    if (!row.reason) return null
    // One reason set for consumers: out of scope is always unknown/not_enabled.
    if (row.reason === "not_enabled") {
      if (row.detail !== null && row.detail !== "not_enabled") return null
      return unavailable(
        key,
        { reason: "unknown", detail: "not_enabled" },
        row.revision,
        row.question_version
      )
    }
    const details: readonly string[] = UNAVAILABLE_DETAILS[row.reason]
    if (row.detail === null || !details.includes(row.detail)) return null
    return unavailable(
      key,
      { reason: row.reason, detail: row.detail },
      row.revision,
      row.question_version
    )
  }

  if (row.reason !== null || row.detail !== null) return null
  if (row.value === null) return null
  // A value type v1.0 cannot represent is withheld, never misread.
  if (!(ANSWER_VALUES as readonly string[]).includes(row.value))
    return unavailable(
      key,
      { reason: "unsupported_version", detail: null },
      row.revision,
      row.question_version
    )
  const idKind = row.contribution_kind
  const contributionId =
    idKind === "contribution"
      ? row.current_contribution_id
      : idKind === "submission"
        ? row.current_submission_id
        : null
  if (!idKind || !contributionId || !row.saved_at) return null
  if (row.freshness_state === null) return null

  let confirmation: NonNullable<ReaderAnswer["provenance"]>["confirmation"] =
    null
  if (row.confirmation_required) {
    if (
      row.confirmation_state !== "confirmed" ||
      !row.confirmation_basis ||
      !row.confirmation_saved_at
    )
      return null
    confirmation = {
      authority: row.confirmation_basis,
      selfConfirmed: row.confirmation_self === true,
      savedAt: row.confirmation_saved_at,
    }
  }

  const redaction = REDACTION_KEYS.includes(key)
  let redactionProof: "recorded" | "not_recorded" | null = null
  if (redaction) {
    if (
      row.redaction_proof !== "recorded" &&
      row.redaction_proof !== "not_recorded"
    )
      return null
    redactionProof = row.redaction_proof
  }

  const withText = !redaction && STAFF_TEXT_AUDIENCES.includes(audience)
  const conditions: ReaderAnswer["conditions"] = []
  if (withText && row.limitations)
    conditions.push({ kind: "limitation", text: row.limitations })
  if (withText && row.reason_text)
    conditions.push({ kind: "reason", text: row.reason_text })

  return {
    key,
    questionVersion: row.question_version,
    status: "available",
    value: {
      type: "yes_no_na",
      answer: row.value as (typeof ANSWER_VALUES)[number],
    },
    summary: withText ? row.finding : null,
    conditions,
    provenance: {
      // An import is stored with basis admin (the admin ran it); its origin,
      // not that basis, says where the answer came from.
      sourceKind:
        row.source_origin ??
        (row.source_basis
          ? SOURCE_KINDS[row.source_basis]
          : UNRECORDED_SOURCE_KIND),
      contributionId,
      idKind,
      confirmation,
      redactionProof,
      evidence: { photos: row.evidence_photos, videos: row.evidence_videos },
    },
    revision: row.revision,
    freshness: {
      savedAt: row.saved_at,
      observedAt: row.observed_at,
      nextCheckDue: row.next_check_due,
      state: row.freshness_state,
    },
    unavailable: null,
  }
}

/**
 * Changes whenever any answer's status, reason, revision or value changes.
 * The value is included because it can change with no write: a service with
 * a later stop date reads Yes, then No from that date at the same revision
 * (B03 A40), and that must never answer 304.
 */
export function snapshotEtag(parts: {
  venueId: string
  audience: string
  schema: string
  answers: readonly ReaderAnswer[]
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        parts.venueId,
        parts.audience,
        parts.schema,
        parts.answers.map((a) => [
          a.key,
          a.status,
          a.unavailable?.reason ?? null,
          a.unavailable?.detail ?? null,
          a.revision,
          a.value?.answer ?? null,
        ]),
      ])
    )
    .digest("hex")
  return `"k1-${digest.slice(0, 32)}"`
}

/** If-None-Match (a list, weak or strong) names this ETag. */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === etag || candidate === "*")
}
