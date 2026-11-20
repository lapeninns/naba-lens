import { logger } from "@/lib/server/log/logger"
import "server-only"

import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Json } from "@/lib/db/types"
import type { MediaActor } from "@/lib/server/media/types"
import { cleanEvents } from "@/lib/metrics/events"
import {
  parseMetricsOverview,
  parseMyContributions,
  parseVenueMetrics,
  type MetricsOverview,
  type MyContributions,
  type VenueMetrics,
} from "@/lib/metrics/model"

// Metrics and reporting (spec §18; 20261118117000-117100). Every read and
// write runs as the caller: the database decides scope (a venue's manager or
// an admin for venue_metrics, admins for metrics_overview, the person
// themselves for my_contribution_metrics and record_product_events).

export type MetricsCaller = Pick<MediaActor, "db">
export type MetricsResult<T> = ({ ok: true } & T) | ApiError

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function failed(context: string, error: { code?: string; message?: string }) {
  const mapped = fromDbError(error)
  if (mapped.code === "unavailable") {
    logger.error(
      `[metrics] ${context} failed`,
      redactError(
        new Error(`${error.code ?? "unknown"}: ${error.message ?? ""}`)
      )
    )
  }
  return mapped
}

/** One venue's measures over the last `days` days. */
export async function loadVenueMetrics(
  caller: MetricsCaller,
  venueId: string | null,
  days: number
): Promise<MetricsResult<{ metrics: VenueMetrics }>> {
  if (venueId !== null && !UUID.test(venueId))
    return apiError("not_found", { message: "This venue could not be found." })
  const { data, error } = await caller.db.rpc("venue_metrics", {
    ...(venueId ? { p_venue_id: venueId } : {}),
    p_days: days,
  })
  if (error) return failed("venue read", error)
  const metrics = parseVenueMetrics(data)
  return metrics ? { ok: true, metrics } : apiError("unavailable")
}

/** Every active venue's headline measures (admins). */
export async function loadMetricsOverview(
  caller: MetricsCaller,
  days: number
): Promise<MetricsResult<{ overview: MetricsOverview }>> {
  const { data, error } = await caller.db.rpc("metrics_overview", {
    p_days: days,
  })
  if (error) return failed("overview read", error)
  const overview = parseMetricsOverview(data)
  return overview ? { ok: true, overview } : apiError("unavailable")
}

/** The signed-in person's own useful contributions (§18.3). */
export async function loadMyContributions(
  caller: MetricsCaller,
  days: number
): Promise<MetricsResult<{ contributions: MyContributions }>> {
  const { data, error } = await caller.db.rpc("my_contribution_metrics", {
    p_days: days,
  })
  if (error) return failed("own contributions read", error)
  const contributions = parseMyContributions(data)
  return contributions ? { ok: true, contributions } : apiError("unavailable")
}

/**
 * Records workflow events (§18.3). Input is untrusted: only allowlisted,
 * well-formed fields are sent (lib/metrics/events.ts), and the database
 * checks them again with the caller's venue and photos. An event without a
 * venue is recorded at `activeVenueId` (the person's active venue).
 */
export async function recordFlowEvents(
  caller: MetricsCaller,
  input: unknown,
  activeVenueId: string | null = null
): Promise<MetricsResult<{ stored: number }>> {
  const events = cleanEvents(input, activeVenueId)
  if (events.length === 0) return { ok: true, stored: 0 }
  const { data, error } = await caller.db.rpc("record_product_events", {
    p_events: events as unknown as Json,
  })
  if (error) return failed("event write", error)
  return { ok: true, stored: typeof data === "number" ? data : 0 }
}
