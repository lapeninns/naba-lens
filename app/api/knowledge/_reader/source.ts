/**
 * The reader's only data access. In production this calls
 * `public.knowledge_reader_answers_v1(p_venue_id, p_keys)` (WS1, service_role
 * only, a STABLE PL/pgSQL function, so one snapshot per call), and maps its
 * `knowledge_venue_not_found` error to `venue_not_found`. Rows are untrusted
 * until `parseResolverRow` accepts them.
 */
export type ReaderSourceResult =
  | { ok: true; rows: readonly unknown[] }
  | { ok: false; error: "venue_not_found" | "unavailable" }

export type ReaderSource = (input: {
  venueId: string
  keys: readonly string[]
  signal: AbortSignal
}) => Promise<ReaderSourceResult>

/** Until the resolver is integrated, the reader answers 503 for every read. */
export const notIntegratedSource: ReaderSource = async () => ({
  ok: false,
  error: "unavailable",
})
