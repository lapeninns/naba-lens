import "server-only"

import {
  SOURCE_KINDS,
  type KnowledgeResult,
  type LegacyMappingsView,
  type LegacyNarrativeItem,
  type MappingKind,
  type ReconcileResult,
  type ReconciliationRunView,
  type SourceAssertionInput,
  type SourceKind,
  type SourceView,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import {
  knowledgeFailure,
  knowledgeInvalid,
  knowledgeRpcFailure,
} from "./errors"
import { knowledgeRpc } from "./rpc"
import { isObject, isUuid, optionalVenueId } from "./validate"

// Reconciliation (B03-f, b03-design §8, A13): admin-only sources, imports,
// mapping reviews and runs, and the legacy narrative for managers. Imports
// are proposals awaiting confirmation; nothing becomes current by itself.

const RELOAD = knowledgeInvalid(
  { idempotencyKey: "Reload the page and try again." },
  "This request is invalid. Reload the page."
)
const KEY = /^[a-z0-9_]{1,40}$/
const MAPPING_KINDS: readonly MappingKind[] = ["exact", "candidate", "none"]
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max
    ? v.trim()
    : null

export async function declareSource(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ sourceId: string; replayed: boolean }>> {
  if (!isObject(input)) return knowledgeInvalid({ kind: "Choose a kind." })
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const errors: Record<string, string> = {}
  if (!SOURCE_KINDS.includes(input.kind as SourceKind))
    errors.kind = "Choose what kind of source this is."
  const label = text(input.label, 80)
  if (!label) errors.label = "Enter a name of up to 80 characters."
  const venueId = input.venueId ?? null
  if (venueId !== null && !isUuid(venueId)) errors.venueId = "Choose a venue."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_source_declare",
    {
      p_kind: input.kind as SourceKind,
      p_label: label!,
      p_venue_id: venueId as string | null,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge source declare")
  return { ok: true, ...data }
}

export async function retireSource(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ sourceId: string; replayed: boolean }>> {
  if (!isObject(input) || !isUuid(input.sourceId))
    return knowledgeFailure("not_found", "This source could not be found.")
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const reason = text(input.reason, 500)
  if (!reason) return knowledgeInvalid({ reason: "Enter a reason." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_source_retire",
    {
      p_source_id: input.sourceId,
      p_reason: reason,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge source retire")
  return { ok: true, sourceId: data.sourceId, replayed: data.replayed }
}

/** What a source said at one revision (at most 500 lines); a revision imports once. */
export async function importSourceAssertions(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ imported: number; replayed: boolean }>> {
  if (!isObject(input) || !isUuid(input.sourceId))
    return knowledgeFailure("not_found", "This source could not be found.")
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const errors: Record<string, string> = {}
  const revision = text(input.sourceRevision, 200)
  if (!revision) errors.sourceRevision = "Enter the version that was read."
  const retrievedAt =
    typeof input.retrievedAt === "string" &&
    !Number.isNaN(Date.parse(input.retrievedAt))
      ? input.retrievedAt
      : null
  if (!retrievedAt) errors.retrievedAt = "Enter when it was read."
  if (
    !Array.isArray(input.assertions) ||
    input.assertions.length < 1 ||
    input.assertions.length > 500
  )
    errors.assertions = "Add between 1 and 500 statements."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_source_import",
    {
      p_source_id: input.sourceId,
      p_source_revision: revision!,
      p_retrieved_at: retrievedAt!,
      p_assertions: input.assertions as SourceAssertionInput[],
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge source import")
  return { ok: true, imported: data.imported, replayed: data.replayed }
}

export async function reviewMapping(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ mappingId: string; replayed: boolean }>> {
  if (!isObject(input) || !isUuid(input.legacyFactId))
    return knowledgeFailure(
      "not_found",
      "This legacy record could not be found."
    )
  if (!isUuid(input.idempotencyKey)) return RELOAD
  const errors: Record<string, string> = {}
  if (
    typeof input.legacyRevision !== "number" ||
    !Number.isInteger(input.legacyRevision) ||
    input.legacyRevision < 1
  )
    errors.legacyRevision = "Reload the page and try again."
  if (typeof input.questionKey !== "string" || !KEY.test(input.questionKey))
    errors.questionKey = "Choose a question."
  if (!MAPPING_KINDS.includes(input.kind as MappingKind))
    errors.kind = "Choose exact, candidate or none."
  const reason = text(input.reason, 500)
  if (!reason) errors.reason = "Enter a reason."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_mapping_review",
    {
      p_legacy_fact_id: input.legacyFactId,
      p_legacy_revision: input.legacyRevision as number,
      p_question_key: input.questionKey as string,
      p_kind: input.kind as MappingKind,
      p_reason: reason!,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge mapping review")
  return { ok: true, ...data }
}

/** A dry run, or an apply that needs a matching dry run from the last 24 hours. */
export async function reconcile(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ result: ReconcileResult }>> {
  if (!isObject(input))
    return knowledgeInvalid({ kind: "Choose legacy or external." })
  const errors: Record<string, string> = {}
  if (input.kind !== "legacy" && input.kind !== "external")
    errors.kind = "Choose legacy or external."
  if (input.mode !== "dry_run" && input.mode !== "apply")
    errors.mode = "Choose a dry run or apply."
  if (Object.keys(errors).length) return knowledgeInvalid(errors)
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_reconcile", {
    p_kind: input.kind as "legacy" | "external",
    p_mode: input.mode as "dry_run" | "apply",
    p_venue_id: venueId.value,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge reconcile")
  return { ok: true, result: data }
}

export async function listSources(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ sources: SourceView[] }>> {
  const includeRetired = isObject(input) && input.includeRetired === true
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_sources", {
    p_include_retired: includeRetired,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge sources")
  return { ok: true, sources: data.items }
}

export async function listLegacyMappings(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ page: LegacyMappingsView }>> {
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const cursor = isObject(input) ? (input.cursor ?? null) : null
  if (cursor !== null && !isUuid(cursor))
    return knowledgeInvalid({ cursor: "Reload the page." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_legacy_mappings",
    {
      p_venue_id: venueId.value,
      p_cursor: cursor as string | null,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge legacy mappings")
  return { ok: true, page: data }
}

export async function listReconciliationRuns(
  actor: MediaActor,
  input: unknown
): Promise<
  KnowledgeResult<{
    page: { items: Record<string, unknown>[]; nextCursor: string | null }
  }>
> {
  const cursor = isObject(input) ? (input.cursor ?? null) : null
  if (cursor !== null && !isUuid(cursor))
    return knowledgeInvalid({ cursor: "Reload the page." })
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_reconciliation_runs",
    {
      p_cursor: cursor as string | null,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge reconciliation runs")
  return { ok: true, page: data }
}

export async function getReconciliationRun(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ run: ReconciliationRunView }>> {
  if (!isObject(input) || !isUuid(input.runId))
    return knowledgeFailure("not_found", "This run could not be found.")
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_reconciliation_run",
    {
      p_run_id: input.runId,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge reconciliation run")
  return { ok: true, run: data }
}

/** Managers and admins: every legacy fact as narrative (§8.2 L5). */
export async function getLegacyNarrative(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ venueId: string; items: LegacyNarrativeItem[] }>> {
  const venueId = optionalVenueId(input)
  if (!venueId.ok) return venueId
  const { data, error } = await knowledgeRpc(
    actor.db,
    "knowledge_legacy_narrative",
    {
      p_venue_id: venueId.value,
    }
  )
  if (error) return knowledgeRpcFailure(error, "knowledge legacy narrative")
  return { ok: true, venueId: data.venueId, items: data.items }
}
