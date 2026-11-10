import "server-only"

import {
  KNOWLEDGE_LIMITS as LIMITS,
  PLACE_KINDS,
  type KnowledgeResult,
  type PlaceKind,
  type SubjectView,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import {
  knowledgeFailure,
  knowledgeInvalid,
  knowledgeRpcFailure,
} from "./errors"
import { knowledgeRpc } from "./rpc"
import { isObject, isUuid, optionalVenueId } from "./validate"

// Places (B03-b, b03-design §4.1, A2): a venue's entrances, routes, areas,
// rooms and facility points. Staff read the active ones for the capture
// form; a venue's manager or an admin adds and retires them. Never deleted.

const SUBJECT_NOT_FOUND = knowledgeFailure(
  "not_found",
  "This place could not be found. Reload the page."
)

const RELOAD = knowledgeInvalid(
  { idempotencyKey: "Reload the page and try again." },
  "This request is invalid. Reload the page."
)

/** `venueId` when given (admins name one); none means the caller's own. */
export async function listPlaces(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ venueId: string; places: SubjectView[] }>> {
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_subjects", {
    p_venue_id: venueId.value,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge places")
  return { ok: true, venueId: data.venueId, places: data.items }
}

/**
 * Adds a place. An active place with the same kind and label (any case) is
 * `state_conflict` with its `subjectId`, so the form can offer it instead.
 */
export async function addPlace(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ subjectId: string; replayed: boolean }>> {
  if (!isObject(input)) return knowledgeInvalid({ kind: "Choose a kind." })
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const errors: Record<string, string> = {}
  if (!PLACE_KINDS.includes(input.kind as PlaceKind))
    errors.kind = "Choose what kind of place this is."
  const label = typeof input.label === "string" ? input.label.trim() : ""
  if (!label || Array.from(label).length > LIMITS.placeLabel)
    errors.label = `Enter a name of up to ${LIMITS.placeLabel} characters.`
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_subject_add",
    {
      p_venue_id: venueId.value,
      p_kind: input.kind as PlaceKind,
      p_label: label,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge place add")
  return { ok: true, subjectId: data.subjectId, replayed: data.replayed }
}

/** Retires a place; findings that named it keep it. `reason` is required. */
export async function retirePlace(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ subjectId: string; replayed: boolean }>> {
  if (!isObject(input) || !isUuid(input.subjectId)) return SUBJECT_NOT_FOUND
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason) return knowledgeInvalid({ reason: "Enter a reason." })
  if (Array.from(reason).length > LIMITS.reason)
    return knowledgeInvalid({
      reason: `Use up to ${LIMITS.reason} characters.`,
    })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_subject_retire",
    {
      p_subject_id: input.subjectId,
      p_reason: reason,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge place retire")
  return { ok: true, subjectId: data.subjectId, replayed: data.replayed }
}
