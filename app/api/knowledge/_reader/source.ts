import "server-only"

import { readKnowledgeAnswers } from "@/lib/server/knowledge"
import type { Db } from "@/lib/server/media/types"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * The reader's only data access: `public.knowledge_reader_answers_v1`
 * through WS1's `readKnowledgeAnswers` (service_role only, a STABLE
 * PL/pgSQL function, so one snapshot per call). Rows are untrusted until
 * `parseResolverRow` accepts them.
 */
export type ReaderSourceResult =
  | { ok: true; rows: readonly unknown[] }
  | { ok: false; error: "venue_not_found" | "unavailable" }

/**
 * `keys` may be empty (none of the requested keys is permitted). The source
 * must still check the venue and report `venue_not_found`, so an inactive or
 * unknown venue is a 404 whatever was asked.
 */
export type ReaderSource = (input: {
  venueId: string
  keys: readonly string[]
  signal: AbortSignal
}) => Promise<ReaderSourceResult>

let service: Db | null = null

export const databaseSource: ReaderSource = async ({
  venueId,
  keys,
  signal,
}) => {
  service ??= createAdminClient()
  const result = await readKnowledgeAnswers(service, venueId, keys, { signal })
  if (result.ok) return { ok: true, rows: result.rows }
  // invalid_input cannot follow a parsed request (a UUID and at most 20
  // keys), so it is treated as the source being unusable, not as a 400.
  return {
    ok: false,
    error:
      result.code === "venue_not_found" ? "venue_not_found" : "unavailable",
  }
}
