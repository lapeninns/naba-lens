import "server-only"

import {
  KNOWLEDGE_LIMITS,
  type KnowledgeReaderRow,
} from "@/lib/knowledge/contract"
import type { DbError } from "@/lib/server/amenities/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"

import { knowledgeRpc } from "./rpc"

export type KnowledgeReaderResult =
  | { ok: true; rows: KnowledgeReaderRow[] }
  | { ok: false; code: "venue_not_found" | "invalid_input" | "unavailable" }

/**
 * The reader's single read of answers (docs/knowledge/b01-design.md §5.3):
 * `public.knowledge_reader_answers_v1` with the service client, which is the
 * only role allowed to call it. One statement, so one snapshot. Rows come back
 * in `keys` order, allowlisted columns only; an empty `keys` still checks the
 * venue. The caller decides which keys the requester may see.
 */
export async function readKnowledgeAnswers(
  service: Db,
  venueId: string,
  keys: readonly string[]
): Promise<KnowledgeReaderResult> {
  if (keys.length > KNOWLEDGE_LIMITS.maxReaderKeys)
    return { ok: false, code: "invalid_input" }
  const { data, error } = await knowledgeRpc(service, "knowledge_reader_answers_v1", {
    p_venue_id: venueId,
    p_keys: [...keys],
  })
  if (!error) return { ok: true, rows: data }
  return { ok: false, code: readerCode(error) }
}

function readerCode(error: DbError): "venue_not_found" | "invalid_input" | "unavailable" {
  if (error?.code === "NLK06" || error?.message === "knowledge_venue_not_found")
    return "venue_not_found"
  if (error?.code === "22023" || error?.code === "22P02") return "invalid_input"
  console.error("[knowledge] reader answers failed", {
    error: redactError(new Error(`${error?.code || "unknown"}: ${error?.message ?? ""}`)),
  })
  return "unavailable"
}
