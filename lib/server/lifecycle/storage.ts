import type { SupabaseClient } from "@supabase/supabase-js"

import { STORAGE_BUCKETS } from "@/lib/config/storage"
import type { Database } from "@/lib/db/types"

export type ServiceClient = SupabaseClient<Database>

/**
 * Removes object keys from the private `media` bucket with the service role.
 * Resolves on success (keys that are already gone count as removed) and throws on
 * a storage error. Injectable so tests can simulate a failing storage backend.
 */
export type RemoveObjects = (keys: string[]) => Promise<void>

export function storageRemover(service: ServiceClient): RemoveObjects {
  return async (keys) => {
    if (keys.length === 0) return
    const { error } = await service.storage
      .from(STORAGE_BUCKETS.media)
      .remove(keys)
    if (error) throw new Error(`storage_remove_failed: ${error.message}`)
  }
}

/** Every object stored under one asset's key prefix, `{uploader}/{asset}/...`. */
export async function listAssetObjects(
  service: ServiceClient,
  uploaderId: string,
  assetId: string
): Promise<string[]> {
  const prefix = `${uploaderId}/${assetId}`
  const { data, error } = await service.storage
    .from(STORAGE_BUCKETS.media)
    .list(prefix, { limit: 100 })
  if (error) throw new Error(`storage_list_failed: ${error.message}`)
  // Folder placeholders have no id; asset prefixes only hold files.
  return (data ?? []).filter((o) => o.id).map((o) => `${prefix}/${o.name}`)
}
