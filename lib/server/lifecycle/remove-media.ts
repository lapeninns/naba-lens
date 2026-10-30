import type { SupabaseClient } from "@supabase/supabase-js"

import { loadProfile, toAuthState } from "@/lib/auth/profile"
import type { Database } from "@/lib/db/types"
import {
  listAssetObjects,
  storageRemover,
  type RemoveObjects,
  type ServiceClient,
} from "@/lib/server/lifecycle/storage"

export type RemoveMediaAssetResult =
  | {
      ok: true
      assetId: string
      /**
       * `removed`: no object is left under the asset's keys. `pending`: storage
       * removal failed or is incomplete; the cleanup job retries it. The asset is
       * hidden and unsignable either way.
       */
      storage: "removed" | "pending"
    }
  | {
      ok: false
      status: 401 | 403 | 404 | 500
      error:
        "unauthenticated" | "inactive" | "forbidden" | "not_found" | "failed"
    }

export type RemoveMediaDeps = {
  /** The caller's own client (cookies session); RLS and auth.uid() apply. */
  user: SupabaseClient<Database>
  /** Service-role client, used only after the database has authorised the caller. */
  service: ServiceClient
  removeObjects?: RemoveObjects
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Removes a media asset for the signed-in caller (spec §7): staff their own,
 * admins any. Hides it immediately through `delete_media_asset` (tombstone), then
 * tries to delete the original and derivatives. A storage failure leaves the asset
 * hidden and is retried by the cleanup job. Idempotent: removing a removed asset
 * succeeds again. Missing assets and other staff members' assets both answer 404,
 * so staff cannot probe for asset IDs. Errors are returned, never thrown.
 */
export async function removeMediaAssetWith(
  deps: RemoveMediaDeps,
  assetId: string
): Promise<RemoveMediaAssetResult> {
  const { user, service } = deps

  const { data: claimData, error: claimsError } = await user.auth.getClaims()
  const claims = claimsError ? null : claimData?.claims
  if (!claims?.sub) return { ok: false, status: 401, error: "unauthenticated" }

  // Current role/activation from the database, never from the session token.
  let state
  try {
    const email = typeof claims.email === "string" ? claims.email : null
    state = toAuthState(
      { id: claims.sub, email },
      await loadProfile(user, claims.sub, email)
    )
  } catch {
    return { ok: false, status: 500, error: "failed" }
  }
  if (state.status === "no_profile") {
    return { ok: false, status: 403, error: "forbidden" }
  }
  if (state.status !== "active") {
    return { ok: false, status: 403, error: "inactive" }
  }

  if (!UUID.test(assetId)) return { ok: false, status: 404, error: "not_found" }

  // The database re-checks ownership/role from current data and writes the tombstone.
  const { error: deleteError } = await user.rpc("delete_media_asset", {
    p_asset_id: assetId,
  })
  if (deleteError) {
    if (
      deleteError.code === "P0002" ||
      deleteError.message === "media_asset_not_found"
    ) {
      return { ok: false, status: 404, error: "not_found" }
    }
    if (deleteError.code === "42501") {
      return { ok: false, status: 403, error: "forbidden" }
    }
    return { ok: false, status: 500, error: "failed" }
  }

  // Authorised and tombstoned: physical removal with the service role.
  const storage = await removeStoredObjects(
    service,
    assetId,
    deps.removeObjects ?? storageRemover(service)
  )
  return { ok: true, assetId, storage }
}

async function removeStoredObjects(
  service: ServiceClient,
  assetId: string,
  removeObjects: RemoveObjects
): Promise<"removed" | "pending"> {
  try {
    const { data: asset, error } = await service
      .from("media_assets")
      .select("uploader_id, deleted_at")
      .eq("id", assetId)
      .single()
    if (error || !asset.deleted_at) return "pending"

    const keys = await listAssetObjects(service, asset.uploader_id, assetId)
    if (keys.length === 0) return "removed"
    await removeObjects(keys)
    const left = await listAssetObjects(service, asset.uploader_id, assetId)
    return left.length === 0 ? "removed" : "pending"
  } catch {
    return "pending"
  }
}
