// Maps knowledge RPC failures (docs/knowledge/b01-design.md §4.1) by message
// or SQLSTATE. Knowledge-only codes first, then the amenity mapping, which
// already covers the shared messages and maps any other NL-class SQLSTATE to
// state_conflict. Nothing here maps a refusal to `unavailable`.

import type {
  DraftSentReason,
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
  draft_already_sent: 409,
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
  draft_already_sent: ["draft_already_sent", "This finding was already sent."],
  knowledge_venue_not_found: ["not_found", "This venue could not be found."],
  wrong_venue: ["wrong_venue", "This is not your venue. Reload the page."],
  knowledge_question_not_found: [
    "not_found",
    "This question could not be found.",
  ],
  contribution_group_not_found: [
    "not_found",
    "This group of photos could not be found. Reload the page.",
  ],
  contribution_subject_not_found: [
    "not_found",
    "What these photos show is no longer here. Choose again.",
  ],
  asset_in_other_group: [
    "state_conflict",
    "A photo is already in another group. Reload the page.",
  ],
  contribution_group_full: [
    "state_conflict",
    "A group holds at most 10 photos or videos.",
  ],
  media_asset_not_found: [
    "not_found",
    "This photo could not be found. It may have been deleted.",
  ],
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
  NLK09: "draft_already_sent",
}

const FIELD_ERRORS: Record<string, [field: string, message: string]> = {
  invalid_kind: ["kind", "Choose what you are sending."],
  invalid_answer: [
    "answer",
    "Choose Yes, No, Not applicable or Couldn't establish.",
  ],
  invalid_unknown_preset: [
    "unknownPreset",
    "Choose why it couldn't be established.",
  ],
  tried_text_required: ["triedText", "Say what you tried."],
  invalid_tried_text: ["triedText", "Use up to 500 characters."],
  change_reason_required: ["changeReason", "Say what has changed."],
  invalid_change_reason: ["changeReason", "Use up to 500 characters."],
  invalid_note: ["note", "Use up to 500 characters."],
  invalid_decision: [
    "decision",
    "This action isn't available here. Reload the page.",
  ],
  invalid_draft: ["payload", "This draft is too large to save."],
  invalid_cursor: ["cursor", "Reload the page."],
  venue_required: ["venueId", "Choose a venue."],
  invalid_group_key: ["key", "Reload the page and try again."],
  invalid_subject: ["subject", "Choose what these photos show."],
}

function detailOf(error: DbError): Record<string, unknown> {
  try {
    const parsed = JSON.parse(error?.details ?? "null") as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function draftRevisionOf(error: DbError): number | null {
  const value = detailOf(error).draftRevision
  return typeof value === "number" ? value : null
}

/** draft_already_sent detail: {reason, sentAt}. */
function alreadySentOf(error: DbError): {
  sentReason?: DraftSentReason
  sentAt: string | null
} {
  const { reason, sentAt } = detailOf(error)
  return {
    ...(reason === "key_sent" || reason === "newer_send"
      ? { sentReason: reason }
      : {}),
    sentAt: typeof sentAt === "string" ? sentAt : null,
  }
}

const PROBLEM_TEXT: Record<string, string> = {
  required: "Fill this in.",
  not_allowed: "This isn't allowed here.",
  invalid: "Check this value.",
  too_long: "This is too long.",
  out_of_range: "This is out of range.",
  no_entrances_listed:
    "Add the venue's entrances under Places first, or send Couldn't establish.",
  unknown_subject: "Choose a place at this venue.",
}

/** invalid_value detail: { fields: [{ path, problem }] }, keyed by path (b03-design §14.3). */
function valueFieldErrors(error: DbError): Record<string, string> {
  const fields = detailOf(error).fields
  const out: Record<string, string> = {}
  if (Array.isArray(fields))
    for (const f of fields)
      if (f && typeof f === "object" && typeof f.path === "string")
        out[f.path] =
          PROBLEM_TEXT[String((f as { problem?: unknown }).problem)] ??
          PROBLEM_TEXT.invalid!
  return out
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
      mapped === "draft_conflict"
        ? { draftRevision: draftRevisionOf(error) }
        : mapped === "draft_already_sent"
          ? alreadySentOf(error)
          : {}
    )
  }
  if (message === "invalid_value")
    return knowledgeInvalid(valueFieldErrors(error))
  if (message === "unknown_value_schema")
    return knowledgeInvalid(
      {},
      "This answer's format isn't supported here. Reload the page."
    )
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
