// Maps knowledge RPC failures (docs/knowledge/b01-design.md §4.1) by message
// or SQLSTATE. Knowledge-only codes first, then the amenity mapping, which
// already covers the shared messages and maps any other NL-class SQLSTATE to
// state_conflict. Nothing here maps a refusal to `unavailable`.

import type {
  KnowledgeErrorCode,
  KnowledgeFailure,
} from "@/lib/knowledge/contract"
import { amenityRpcFailure, type DbError } from "@/lib/server/amenities/errors"

const STATUS: Record<KnowledgeErrorCode, KnowledgeFailure["status"]> = {
  unauthenticated: 401,
  account_inactive: 403,
  not_permitted: 403,
  wrong_venue: 403,
  not_found: 404,
  invalid_input: 400,
  needs_setup: 409,
  revision_conflict: 409,
  state_conflict: 409,
  asset_ineligible: 409,
  evidence_rule_unmet: 400,
  knowledge_path_required: 409,
  knowledge_slot_out_of_scope: 409,
  already_decided: 409,
  self_confirmation_not_permitted: 403,
  draft_conflict: 409,
  unavailable: 503,
}

export function knowledgeFailure(
  code: KnowledgeErrorCode,
  message: string,
  extra: Omit<KnowledgeFailure, "ok" | "code" | "status" | "message"> = {}
): KnowledgeFailure {
  return { ok: false, code, status: STATUS[code], message, ...extra }
}

export function knowledgeInvalid(
  fieldErrors: Partial<Record<string, string>>,
  message = "Check the highlighted fields."
): KnowledgeFailure {
  return knowledgeFailure("invalid_input", message, { fieldErrors })
}

type Mapping = [code: KnowledgeErrorCode, message: string]

/** By message, and by SQLSTATE for the NL class. */
const KNOWLEDGE: Record<string, Mapping> = {
  already_decided: [
    "already_decided",
    "Someone has already decided this. Reload the page to see what changed.",
  ],
  self_confirmation_not_permitted: [
    "self_confirmation_not_permitted",
    "Another manager needs to confirm your own finding for this question.",
  ],
  draft_conflict: [
    "draft_conflict",
    "This draft was saved somewhere else. Reload it before saving again.",
  ],
  knowledge_venue_not_found: ["not_found", "This venue could not be found."],
  knowledge_not_adoptable: [
    "state_conflict",
    "A Couldn't establish finding can't become the answer in use.",
  ],
  knowledge_not_current: [
    "state_conflict",
    "This answer is no longer the one in use. Reload the page.",
  ],
  knowledge_finding_not_found: [
    "not_found",
    "This finding could not be found. Reload the page.",
  ],
  invalid_responds_to: [
    "state_conflict",
    "The request for more detail has already been dealt with. Reload the page.",
  ],
  knowledge_rule_missing: [
    "invalid_input",
    "A question has no knowledge rule yet, so it can't be added.",
  ],
}

const BY_SQLSTATE: Record<string, string> = {
  NLK03: "already_decided",
  NLK04: "self_confirmation_not_permitted",
  NLK05: "draft_conflict",
  NLK06: "knowledge_venue_not_found",
  NLK07: "knowledge_not_adoptable",
  NLK08: "knowledge_not_current",
}

const FIELD_ERRORS: Record<string, [field: string, message: string]> = {
  invalid_kind: ["kind", "Choose what you are sending."],
  invalid_answer: ["answer", "Choose Yes, No, Not applicable or Couldn't establish."],
  invalid_unknown_preset: ["unknownPreset", "Choose why it couldn't be established."],
  tried_text_required: ["triedText", "Say what you tried."],
  invalid_tried_text: ["triedText", "Use up to 500 characters."],
  change_reason_required: ["changeReason", "Say what has changed."],
  invalid_change_reason: ["changeReason", "Use up to 500 characters."],
  invalid_note: ["note", "Use up to 500 characters."],
  invalid_decision: ["decision", "This action isn't available here. Reload the page."],
  invalid_draft: ["payload", "This draft is too large to save."],
  invalid_cursor: ["cursor", "Reload the page."],
}

function draftRevisionOf(error: DbError): number | null {
  try {
    const parsed = JSON.parse(error?.details ?? "null") as unknown
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as { draftRevision?: unknown }).draftRevision
        : null
    return typeof value === "number" ? value : null
  } catch {
    return null
  }
}

/**
 * `context` names the operation in the redacted server log for unexpected
 * failures; expected failures are not logged.
 */
export function knowledgeRpcFailure(
  error: DbError,
  context: string
): KnowledgeFailure {
  const raw = error?.message ?? ""
  const code = error?.code ?? ""
  const message = raw in KNOWLEDGE ? raw : (BY_SQLSTATE[code] ?? raw)
  if (message in KNOWLEDGE) {
    const [mapped, text] = KNOWLEDGE[message]!
    return knowledgeFailure(
      mapped,
      text,
      mapped === "draft_conflict" ? { draftRevision: draftRevisionOf(error) } : {}
    )
  }
  if (message in FIELD_ERRORS) {
    const [field, text] = FIELD_ERRORS[message]!
    return knowledgeInvalid({ [field]: text })
  }
  // A unique violation is a lost race with an identical request: reload.
  if (code === "23505")
    return knowledgeFailure(
      "state_conflict",
      "This changed while you were looking at it. Reload the page."
    )
  return amenityRpcFailure(error, context)
}
