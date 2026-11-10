// Offline harness (B09-05b): one attempt through selection output, prompt,
// provider, classification, validation and code mapping. No database writes;
// the runner and ledger arrive with B09-m1.

import type { AssistJobDefinition, AssistRequester } from "./types"
import { mayRequest, mayRunOn } from "./catalogue"
import type { CandidateCodes } from "./codes"
import {
  classifyAttempt,
  costActionFor,
  mayRetry,
  type AttemptOutcome,
  type CostAction,
} from "./outcomes"
import { buildPrompt, sha256Hex, type DataBlock } from "./prompt"
import type { AssistProvider, ProviderImage } from "./providers/types"
import {
  parseOutput,
  validateEvidenceDescribe,
  validateLabelSuggest,
  validateMenuImportDraft,
  validateMissingFieldPrompts,
} from "./validate"
import type { ValidationIssue } from "./types"

export type OutputContext =
  | { job: "label_suggest"; codes: CandidateCodes }
  | { job: "menu_import_draft"; maxPage: number }
  | { job: "evidence_describe" }
  | {
      job: "missing_field_prompts"
      fieldNames: readonly string[]
      note: string
    }

export type OfflineAttempt = {
  job: AssistJobDefinition
  blocks: readonly DataBlock[]
  images: readonly ProviderImage[]
  context: OutputContext
  idempotencyKey: string
  requester: AssistRequester
  attemptsSoFar: number
  signal?: AbortSignal
}

export type OfflineResult = {
  outcome: AttemptOutcome | "refused"
  retry: boolean
  cost: CostAction | "none"
  suggestion: unknown
  issues: ValidationIssue[]
  flags: string[]
  versions: {
    jobKey: string
    jobVersion: number
    schemaVersion: string
    promptVersion: string
    templateSha256: string
    providerId: string
    inputDigest: string
  }
}

function validateFor(context: OutputContext, value: unknown) {
  switch (context.job) {
    case "label_suggest":
      return validateLabelSuggest(value, context.codes)
    case "menu_import_draft":
      return validateMenuImportDraft(value, { maxPage: context.maxPage })
    case "evidence_describe":
      return validateEvidenceDescribe(value)
    case "missing_field_prompts":
      return validateMissingFieldPrompts(value, context)
  }
}

export async function runOfflineAttempt(
  attempt: OfflineAttempt,
  provider: AssistProvider
): Promise<OfflineResult> {
  const { job } = attempt
  const prompt = buildPrompt(job.key, attempt.blocks)
  const inputDigest = sha256Hex(
    [
      prompt.promptSha256,
      ...attempt.images.map((i) => sha256Hex(i.bytes)),
    ].join(":")
  )
  const versions = {
    jobKey: job.key,
    jobVersion: job.version,
    schemaVersion: job.schemaVersion,
    promptVersion: job.promptVersion,
    templateSha256: prompt.templateSha256,
    providerId: provider.id,
    inputDigest,
  }
  const refused = (code: string): OfflineResult => ({
    outcome: "refused",
    retry: false,
    cost: "none",
    suggestion: null,
    issues: [{ path: "$", code }],
    flags: [],
    versions,
  })
  if (attempt.context.job !== job.key) return refused("context_mismatch")
  if (!mayRequest(job, attempt.requester))
    return refused("requester_not_allowed")
  if (!mayRunOn(job, provider.id)) return refused("job_not_signed_off")
  if (attempt.images.length > job.limits.maxImages)
    return refused("too_many_images")
  const inputBytes =
    new TextEncoder().encode(prompt.text).length +
    attempt.images.reduce((n, i) => n + i.bytes.length, 0)
  if (inputBytes > job.limits.maxInputBytes) return refused("input_too_large")

  const event = await provider.call(
    {
      promptText: prompt.text,
      images: attempt.images,
      maxOutputTokens: job.limits.maxOutputTokens,
      idempotencyKey: attempt.idempotencyKey,
    },
    { signal: attempt.signal ?? new AbortController().signal }
  )
  let outcome = classifyAttempt(event, provider)
  let suggestion: unknown = null
  let issues: ValidationIssue[] = []
  let flags: string[] = []
  if (outcome === "ok" && event.kind === "response") {
    const parsed = parseOutput(event.body)
    const checked = parsed.ok
      ? validateFor(attempt.context, parsed.value)
      : { ok: false as const, issues: parsed.issues }
    if (checked.ok) {
      suggestion = checked.value
      flags = checked.flags
    } else {
      outcome = "invalid_output"
      issues = checked.issues
    }
  }
  return {
    outcome,
    retry: mayRetry(outcome, {
      attemptsSoFar: attempt.attemptsSoFar,
      maxRetries: job.limits.maxRetries,
      providerIdempotent: provider.idempotentRequests,
    }),
    cost: costActionFor(outcome, event),
    suggestion,
    issues,
    flags,
    versions,
  }
}
