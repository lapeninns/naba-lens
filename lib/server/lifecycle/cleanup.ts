import { randomUUID } from "node:crypto"

import {
  abandonedUploadInterval,
  MEDIA_LIMITS,
  staleProcessingInterval,
} from "@/lib/config/media"
import type { Database } from "@/lib/db/types"
import {
  storageRemover,
  type RemoveObjects,
  type ServiceClient,
} from "@/lib/server/lifecycle/storage"

type UploadState = Database["public"]["Enums"]["upload_state"]

export const CLEANUP_LEASE = "media_cleanup"

export type CleanupOptions = {
  /**
   * Instant the 24-hour abandoned window is measured from. Defaults to the
   * database's now(), so the app host's clock never decides what is abandoned.
   * The stale-processing reaper always uses database time.
   */
  now?: Date
  /** Tombstoned assets claimed per batch (the database caps it at 1000). */
  batchSize?: number
  /** Batches per run; the next scheduled run picks up the rest. */
  maxBatches?: number
  /** Lease lifetime; must exceed the longest expected run. */
  leaseSeconds?: number
  removeObjects?: RemoveObjects
}

export type CleanupReport =
  | { status: "skipped"; reason: "locked" }
  | {
      status: "completed"
      /**
       * Finalise claims older than MEDIA_LIMITS.staleProcessingMinutes (crashed
       * finalises) that this run moved from `processing` to `failed`, reason
       * "stale_processing". Their bytes are kept so the uploader can retry.
       */
      reaped: { assetIds: string[]; reason: "stale_processing" }
      /** Assets whose remaining objects were removed in this run, by state at removal. */
      removed: {
        assets: number
        objects: number
        byState: Record<UploadState, number>
      }
      /** Assets whose removal failed; they stay hidden and are retried next run. */
      failed: { assetId: string; error: string }[]
      /** True when the batch limit stopped the run with work possibly left. */
      more: boolean
    }

/**
 * One cleanup pass (spec §5, §7), run with the service role:
 *  0. `fail_stale_media_processing` marks finalise claims stuck in `processing`
 *     for longer than MEDIA_LIMITS.staleProcessingMinutes as `failed` (database
 *     clock, from the claim's own timestamp, so an in-flight finalise is never
 *     touched). The uploader then sees a real failure and can retry or delete;
 *     if neither happens the failed row is abandoned 24 h later like any other;
 *  1. `prepare_media_cleanup` tombstones reservations and failed uploads untouched
 *     for `MEDIA_LIMITS.abandonedUploadWindowHours` whose objects are also older
 *     than the window (active transfers are kept), then lists every tombstoned
 *     asset that still has objects in storage: user removals whose physical delete
 *     failed, abandoned reservations' partial objects and failed uploads' leftovers;
 *  2. those objects are removed through the Storage API.
 * Storage itself is the record of what is left, so a failed removal simply shows up
 * again on the next run. Idempotent; a lease makes concurrent runs skip.
 */
export async function runMediaCleanup(
  service: ServiceClient,
  options: CleanupOptions = {}
): Promise<CleanupReport> {
  const batchSize = options.batchSize ?? 100
  const maxBatches = options.maxBatches ?? 10
  const removeObjects = options.removeObjects ?? storageRemover(service)
  const holder = randomUUID()

  const lease = await service.rpc("acquire_maintenance_lease", {
    p_name: CLEANUP_LEASE,
    p_holder: holder,
    p_ttl: `${options.leaseSeconds ?? 600} seconds`,
  })
  if (lease.error)
    throw new Error(`cleanup_lease_failed: ${lease.error.message}`)
  if (!lease.data) return { status: "skipped", reason: "locked" }

  const byState: Record<UploadState, number> = {
    uploading: 0,
    processing: 0,
    ready: 0,
    failed: 0,
  }
  let assets = 0
  let objects = 0
  const failed = new Map<string, string>()
  let more = false
  const reaped: string[] = []

  try {
    const stale = await service.rpc("fail_stale_media_processing", {
      p_stale_after: staleProcessingInterval(MEDIA_LIMITS),
    })
    if (stale.error)
      throw new Error(
        `fail_stale_media_processing_failed: ${stale.error.message}`
      )
    reaped.push(...stale.data.map((row) => row.asset_id))

    for (let batch = 0; ; batch++) {
      const { data, error } = await service.rpc("prepare_media_cleanup", {
        p_abandoned_after: abandonedUploadInterval(MEDIA_LIMITS),
        p_limit: batchSize,
        // Omitted: the database uses its own now().
        ...(options.now ? { p_now: options.now.toISOString() } : {}),
      })
      if (error)
        throw new Error(`prepare_media_cleanup_failed: ${error.message}`)

      // Assets that already failed in this run wait for the next run.
      const todo = data.filter((row) => !failed.has(row.asset_id))
      if (todo.length === 0) break
      if (batch >= maxBatches) {
        more = true
        break
      }

      for (const row of todo) {
        try {
          await removeObjects(row.object_names)
          assets++
          objects += row.object_names.length
          byState[row.upload_state]++
        } catch (err) {
          failed.set(
            row.asset_id,
            err instanceof Error ? err.message : "storage_remove_failed"
          )
        }
      }
    }
  } finally {
    await service.rpc("release_maintenance_lease", {
      p_name: CLEANUP_LEASE,
      p_holder: holder,
    })
  }

  return {
    status: "completed",
    reaped: { assetIds: reaped, reason: "stale_processing" },
    removed: { assets, objects, byState },
    failed: [...failed].map(([assetId, error]) => ({ assetId, error })),
    more,
  }
}

/**
 * Marks upload activity on a live reservation so cleanup never treats it as
 * abandoned. Call it (service role, after authorising the caller) when an upload
 * attempt starts, including idempotent reserve retries that resume a TUS
 * transfer, and when finalise begins. In-progress TUS data is invisible to the
 * database, so this row timestamp is cleanup's only signal for it.
 */
export async function touchMediaReservation(
  service: ServiceClient,
  assetId: string
): Promise<void> {
  // updated_at is set by the media_assets_set_updated_at trigger.
  const { error } = await service
    .from("media_assets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .is("deleted_at", null)
    .neq("upload_state", "ready")
  if (error) throw new Error(`touch_reservation_failed: ${error.message}`)
}
