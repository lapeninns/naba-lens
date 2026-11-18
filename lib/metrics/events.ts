// Workflow events (spec §18.3; 20261118117000_metrics_instrumentation.sql).
// Pure and client-safe. An event carries ids, a route, a count, a stage and a
// short code, and nothing else: never location, file names, notes, EXIF or
// photo content (§18.3, AC13). The database refuses any other field; this
// module drops them first, so a caller's mistake costs an event, not a
// refused batch.

export const FLOW_EVENT_NAMES = [
  "flow_started",
  "subject_selected",
  "label_uncertain",
  "match_later",
  "not_for_slot",
  "batch_grouped",
  "submitted",
  "transfer_failed",
  "transfer_retried",
] as const
export type FlowEventName = (typeof FLOW_EVENT_NAMES)[number]

/** How a photo was started (spec §5.2). */
export const CAPTURE_ROUTES = [
  "slot",
  "gallery",
  "request",
  "match_later",
] as const
export type CaptureRoute = (typeof CAPTURE_ROUTES)[number]

export const EVENT_STAGES = ["transfer", "processing", "label"] as const
export type EventStage = (typeof EVENT_STAGES)[number]

export type SubjectKind = "dish" | "area" | "amenity"

/** What a caller may say about an event. */
export type FlowEventInput = {
  name: FlowEventName
  /** Defaults, on the server, to the person's active venue. */
  venueId?: string | null
  route?: CaptureRoute | null
  batchId?: string | null
  assetId?: string | null
  subjectKind?: SubjectKind | null
  subjectId?: string | null
  count?: number | null
  stage?: EventStage | null
  /** A short code such as `waiting` or `too_large`; never free text. */
  outcome?: string | null
}

/** The wire shape public.record_product_events takes. */
export type FlowEvent = FlowEventInput & {
  venueId: string
  clientEventId: string
  occurredAt: string
}

/** Exactly the database's allowlist (private.product_event_fields). */
export const EVENT_FIELDS = [
  "name",
  "route",
  "venueId",
  "batchId",
  "assetId",
  "subjectKind",
  "subjectId",
  "count",
  "stage",
  "outcome",
  "clientEventId",
  "occurredAt",
] as const

/** At most this many events go in one call (the database's limit). */
export const EVENT_BATCH_MAX = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[a-z][a-z_]{0,39}$/
const SUBJECTS: readonly string[] = ["dish", "area", "amenity"]

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v)
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v)

/**
 * The event with only allowed, well-formed fields, or null when it can't be
 * sent at all (unknown name, no venue, no client id). An event without a
 * venue takes `fallbackVenue`. An optional field that is malformed is
 * dropped, never sent; a subject is kept only with both its kind and id.
 */
export function cleanEvent(
  raw: unknown,
  fallbackVenue: string | null = null
): FlowEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  if (!oneOf(FLOW_EVENT_NAMES, e.name)) return null
  const venueId = isUuid(e.venueId) ? e.venueId : fallbackVenue
  if (!isUuid(venueId) || !isUuid(e.clientEventId)) return null
  const at =
    typeof e.occurredAt === "string" && !Number.isNaN(Date.parse(e.occurredAt))
      ? new Date(e.occurredAt).toISOString()
      : new Date().toISOString()
  const event: FlowEvent = {
    name: e.name,
    venueId,
    clientEventId: e.clientEventId,
    occurredAt: at,
  }
  if (oneOf(CAPTURE_ROUTES, e.route)) event.route = e.route
  if (isUuid(e.batchId)) event.batchId = e.batchId
  if (isUuid(e.assetId)) event.assetId = e.assetId
  if (oneOf(SUBJECTS, e.subjectKind) && isUuid(e.subjectId)) {
    event.subjectKind = e.subjectKind as SubjectKind
    event.subjectId = e.subjectId
  }
  if (
    typeof e.count === "number" &&
    Number.isInteger(e.count) &&
    e.count >= 0 &&
    e.count <= 1000
  )
    event.count = e.count
  if (oneOf(EVENT_STAGES, e.stage)) event.stage = e.stage
  if (typeof e.outcome === "string" && CODE.test(e.outcome))
    event.outcome = e.outcome
  return event
}

/** Cleans a list, keeping at most EVENT_BATCH_MAX sendable events. */
export function cleanEvents(
  raw: unknown,
  fallbackVenue: string | null = null
): FlowEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => cleanEvent(e, fallbackVenue))
    .filter((e): e is FlowEvent => e !== null)
    .slice(0, EVENT_BATCH_MAX)
}
