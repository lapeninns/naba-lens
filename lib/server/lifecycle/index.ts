import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  runMediaCleanup,
  touchMediaReservation,
  type CleanupOptions,
  type CleanupReport,
} from "@/lib/server/lifecycle/cleanup"
import { recordJobRun } from "@/lib/server/notifications"
import { orphanCleanupInterval } from "@/lib/server/ops/cleanup-window"

export {
  removeMediaAsset,
  type RemoveMediaAssetResult,
} from "@/lib/server/lifecycle/remove"
export type {
  CleanupOptions,
  CleanupReport,
} from "@/lib/server/lifecycle/cleanup"

/**
 * One cleanup pass with the app's service-role client (see runMediaCleanup).
 * Unfinished and failed uploads are abandoned after the admin's orphan window
 * (Settings, default 7 days, spec §16); ready and referenced assets are never
 * touched. The run is recorded in ops_job_runs for monitoring.
 */
export async function runCleanup(
  options: CleanupOptions = {}
): Promise<CleanupReport> {
  const service = createAdminClient()
  const startedAt = new Date().toISOString()
  const abandonedAfter =
    options.abandonedAfter ?? (await orphanCleanupInterval(service))
  try {
    const report = await runMediaCleanup(service, {
      ...options,
      abandonedAfter,
    })
    if (report.status === "completed")
      await recordJobRun(service, {
        job: "media_cleanup",
        state: report.failed.length > 0 ? "failed" : "succeeded",
        startedAt,
        errorCode:
          report.failed.length > 0 ? "storage_remove_failed" : undefined,
        detail: {
          removedAssets: report.removed.assets,
          reaped: report.reaped.assetIds.length,
          failed: report.failed.length,
          more: report.more,
        },
      })
    return report
  } catch (error) {
    await recordJobRun(service, {
      job: "media_cleanup",
      state: "failed",
      startedAt,
      errorCode: "cleanup_failed",
    })
    throw error
  }
}

/** Records upload activity on a reservation (see touchMediaReservation). */
export async function recordUploadActivity(assetId: string): Promise<void> {
  return touchMediaReservation(createAdminClient(), assetId)
}
