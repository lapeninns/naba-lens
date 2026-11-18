import "server-only"

import {
  isActivitySource,
  parseActivityPage,
  type ActivityCursor,
  type ActivityPage,
} from "@/lib/ops/activity"
import { apiError, fromDbError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { OpsCaller, OpsResult } from "@/lib/server/ops/types"

// The admin Activity log (spec §8 A7; checklist A7-activity-log). One read
// over activity_events and every existing history table
// (20261118106000_ops_activity.sql). Admins only: the database refuses
// anyone else. New important changes are recorded in SQL with
// private.record_activity (actor and role come from the session).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION = /^[a-z][a-z_]{0,59}$/

export type ActivityFilters = {
  venueId?: string | null
  actorId?: string | null
  action?: string | null
  source?: string | null
  before?: ActivityCursor | null
  limit?: number
}

/** Unknown or malformed filters are dropped, never sent to the database. */
export function cleanActivityFilters(f: ActivityFilters) {
  return {
    p_venue_id: f.venueId && UUID.test(f.venueId) ? f.venueId : null,
    p_actor_id: f.actorId && UUID.test(f.actorId) ? f.actorId : null,
    p_action: f.action && ACTION.test(f.action) ? f.action : null,
    p_source: isActivitySource(f.source) ? f.source : null,
    p_before: f.before ?? null,
    p_limit: Math.min(Math.max(f.limit ?? 50, 1), 200),
  }
}

export async function loadActivity(
  caller: OpsCaller,
  filters: ActivityFilters = {}
): Promise<OpsResult<{ page: ActivityPage }>> {
  const { data, error } = await caller.db.rpc(
    "admin_activity",
    cleanActivityFilters(filters) as never
  )
  if (error) {
    const mapped = fromDbError(error)
    if (mapped.code === "unavailable")
      console.error("[ops] activity read failed", {
        error: redactError(new Error(`${error.code}: ${error.message}`)),
      })
    return mapped
  }
  const page = parseActivityPage(data)
  return page ? { ok: true, page } : apiError("unavailable")
}
