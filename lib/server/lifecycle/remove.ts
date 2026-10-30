import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  removeMediaAssetWith,
  type RemoveMediaAssetResult,
} from "@/lib/server/lifecycle/remove-media"

export type { RemoveMediaAssetResult } from "@/lib/server/lifecycle/remove-media"

/**
 * Removes a media asset for the signed-in caller: staff their own, admins any.
 * Call it from the delete Server Functions after the user confirms (spec §7 copy:
 * "Remove this file from your portfolio and the admin library? Previously
 * downloaded copies cannot be recalled."). Returns `{ ok: false, status }` with
 * 401/403/404 instead of throwing; see removeMediaAssetWith for the details.
 */
export async function removeMediaAsset(
  assetId: string
): Promise<RemoveMediaAssetResult> {
  return removeMediaAssetWith(
    { user: await createClient(), service: createAdminClient() },
    assetId
  )
}
