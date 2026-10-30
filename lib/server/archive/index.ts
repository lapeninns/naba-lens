import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@/lib/db/types"

import { readArchiveConfig } from "./config"
import { archiveOriginal, type ArchiveSource } from "./core"
import { createArchiveStore, prepareOriginal } from "./object-store"

type Service = SupabaseClient<Database>

export async function ensureMediaOriginalArchived(
  service: Service,
  assetId: string,
  validated?: { sizeBytes: number; mimeType: string },
  signal: AbortSignal = AbortSignal.timeout(45_000)
): Promise<void> {
  const config = readArchiveConfig()
  if (!config) return
  const { data: asset, error } = await service
    .from("media_assets")
    .select(
      "id,uploader_id,venue_id,original_filename,original_path,media_type,size_bytes,validated_mime_type,created_at,upload_state"
    )
    .eq("id", assetId)
    .single()
  if (error || !asset || (!validated && asset.upload_state !== "ready")) {
    throw new Error("archive_asset_unavailable")
  }
  const size = validated?.sizeBytes ?? asset.size_bytes
  const mime = validated?.mimeType ?? asset.validated_mime_type
  if (!size || !mime) throw new Error("archive_asset_not_validated")
  const [uploader, venue] = await Promise.all([
    service
      .from("profiles")
      .select("display_name")
      .eq("id", asset.uploader_id)
      .single(),
    service.from("venues").select("name").eq("id", asset.venue_id).single(),
  ])
  if (uploader.error || venue.error || !uploader.data || !venue.data) {
    throw new Error("archive_attribution_unavailable")
  }
  const source: ArchiveSource = {
    assetId: asset.id,
    uploaderId: asset.uploader_id,
    venueId: asset.venue_id,
    uploaderName: uploader.data.display_name,
    venueName: venue.data.name,
    originalFilename: asset.original_filename,
    originalPath: asset.original_path,
    mediaType: asset.media_type,
    mimeType: mime,
    sizeBytes: size,
    uploadedAt: asset.created_at,
  }
  const store = createArchiveStore(config, signal)
  try {
    await archiveOriginal(source, {
      projectRef: config.sourceProjectRef,
      prepare: (input) => prepareOriginal(config, input, signal),
      store,
      async record(receipt) {
        const { error: recordError } = await service
          .from("media_archive_receipts")
          .upsert(
            {
              ...receipt,
              manifest: receipt.manifest as unknown as Json,
            },
            {
              onConflict: "asset_id,sha256,manifest_sha256",
              ignoreDuplicates: true,
            }
          )
        if (recordError) throw new Error("archive_receipt_write_failed")
      },
    })
  } finally {
    store.close?.()
  }
}

/** Called only after the existing caller/DB deletion checks. Tombstones stay hidden. */
export async function ensureArchiveBeforeRemoval(
  service: Service,
  keys: string[],
  signal: AbortSignal
): Promise<void> {
  if (!readArchiveConfig() || keys.length === 0) return
  const { data, error } = await service
    .from("media_assets")
    .select("id")
    .in("original_path", keys)
    .eq("upload_state", "ready")
  if (error) throw new Error("archive_removal_check_failed")
  for (const asset of data ?? []) {
    signal.throwIfAborted()
    await ensureMediaOriginalArchived(service, asset.id, undefined, signal)
  }
}
