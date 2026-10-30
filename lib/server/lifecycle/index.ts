import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  runMediaCleanup,
  touchMediaReservation,
  type CleanupOptions,
  type CleanupReport,
} from "@/lib/server/lifecycle/cleanup"

export {
  removeMediaAsset,
  type RemoveMediaAssetResult,
} from "@/lib/server/lifecycle/remove"
export type {
  CleanupOptions,
  CleanupReport,
} from "@/lib/server/lifecycle/cleanup"

/** One cleanup pass with the app's service-role client (see runMediaCleanup). */
export async function runCleanup(
  options: CleanupOptions = {}
): Promise<CleanupReport> {
  return runMediaCleanup(createAdminClient(), options)
}

/** Records upload activity on a reservation (see touchMediaReservation). */
export async function recordUploadActivity(assetId: string): Promise<void> {
  return touchMediaReservation(createAdminClient(), assetId)
}
