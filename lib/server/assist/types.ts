// Shared types for the offline AI-assistance slice (B09 design §1 to §3).
// Pure: no Supabase, no network, no environment reads.

export const ASSIST_JOB_KEYS = [
  "label_suggest",
  "menu_import_draft",
  "evidence_describe",
  "missing_field_prompts",
] as const

export type AssistJobKey = (typeof ASSIST_JOB_KEYS)[number]

/**
 * Local copy of the B03 question-registry sensitivity values. Replace with the
 * registry type once B03-a to B03-c are frozen.
 */
export type QuestionSensitivity =
  "ordinary" | "sensitive_claim" | "restricted_detail"

export type AssistRequester = "staff" | "manager" | "admin"

export type AssistJobLimits = {
  maxInputBytes: number
  maxImages: number
  maxOutputTokens: number
  timeoutMs: number
  maxRetries: number
}

export type AssistJobDefinition = {
  key: AssistJobKey
  version: number
  schemaVersion: string
  promptVersion: string
  purpose: string
  /** The one place a person decides, and the existing command that records it. */
  decisionPoint: string
  domainCommand: string
  prohibitedInferences: readonly string[]
  requesters: readonly AssistRequester[]
  limits: AssistJobLimits
  /**
   * Product-owner sign-off reference for this version. Null means the version
   * may run only on the offline fixture provider.
   */
  signedOffBy: string | null
}

export type Refusal = { ok: false; reason: string }
export type Allowed = { ok: true }
export type Eligibility = Allowed | Refusal

export type ValidationIssue = { path: string; code: string }

export type ValidationResult<T> =
  | { ok: true; value: T; flags: string[] }
  | { ok: false; issues: ValidationIssue[] }
