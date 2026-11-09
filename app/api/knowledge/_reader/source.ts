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

/** Until the resolver is integrated, the reader answers 503 for every read. */
export const notIntegratedSource: ReaderSource = async () => ({
  ok: false,
  error: "unavailable",
})
